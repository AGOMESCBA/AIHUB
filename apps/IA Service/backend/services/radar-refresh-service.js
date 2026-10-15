'use strict';

/**
 * Refresh do Radar — mesmo mecanismo para o botão ↻ e para o auto-refresh
 * (ambos entram por sincronizarAntesDaFila).
 *
 * Cada execução, por fonte:
 *  1. Importação incremental por janela de data (inalterada) — chamados novos.
 *  2. Atualização por ID, independente da data de abertura:
 *     - snapshot leve dos abertos na origem (situacao-snapshot-service,
 *       compartilhado com o gate de pesquisa externa);
 *     - candidatos = chamados da TELA do consultor + os que mudaram na origem
 *       (situação/responsável/última transição/posicionamentos) + não vistos
 *       + abertos locais ausentes do snapshot (verificados por ID, ausência
 *       NÃO é prova de encerramento);
 *     - relê só os candidatos (mesmo _processarChamado da importação) e
 *       reconstrói as mensagens importadas dos que mudaram.
 *  Chamados com turno de IA em andamento NÃO são modificados (retentados no
 *  próximo ciclo). Resultados parciais são sinalizados (`parcial`), nunca
 *  apresentados como sincronização completa.
 */

const chamadoRepo = require('../repositories/chamado-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const anexoRepo = require('../repositories/anexo-repository');
const anexosSoftExpertService = require('./anexos-softexpert-service');
const historicalSyncService = require('./import/historical-sync-service');
const historicalImportService = require('./import/historical-import-service');
const snapshotService = require('./situacao-snapshot-service');
const radarService = require('./radar-service');

const INTERVALO_MINIMO_MS = 60 * 1000;
const AGUARDAR_PADRAO_MS = 8000;
const MAX_ATUALIZACOES_POR_CICLO = 60;
const MAX_CICLOS_EXTRAS = 3;
// Durações (DIAS_DUR* da view) custam de ~0,35 s até ~2,5 s POR chamado na origem
// (medido em produção). Ficam fora do caminho crítico: o ciclo usa leitura leve
// (as durações gravadas são preservadas) e só chamados NOVOS vêm completos. As
// durações da tela são renovadas depois do ciclo, em segundo plano, poucos
// chamados por vez e no máximo a cada 30 min por chamado.
const REFRESH_COMPLETO_TELA_MS = 30 * 60 * 1000;
const MAX_COMPLETOS_POR_CICLO = 10;
const MAX_DURACOES_SEGUNDO_PLANO = 3;
const duracoesEmAndamento = new Set(); // `${empresaId}:${fonteId}`
// Anexos: o ciclo NÃO baixa binários a cada Refresh. Compara só metadados do
// snapshot (contagem + última criação do grid de anexos) e baixa os de UM
// chamado apenas quando o conjunto mudou (ou o chat tem menos anexos da
// origem do que a origem informa, na primeira observação).
const MAX_SINCRONIZACOES_ANEXOS_POR_CICLO = 5;
const assinaturaAnexosPorFonte = new Map(); // `${empresaId}:${fonteId}` -> Map<numero, assinatura>
const PRIO_PRIORITARIA_MAX = 2; // tela(0), situação divergente(1), marca alterada(2)
const SISTEMA_ORIGEM = 'softexpert';

const estadoPorEmpresa = new Map();
const marcasPorFonte = new Map(); // `${empresaId}:${fonteId}` -> Map<numero, marca>
const ultimaLeituraCompleta = new Map(); // `${empresaId}:${fonteId}:${numero}` -> timestamp

function _norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function _assinaturasAnexos(empresaId, fonteId) {
  const chave = `${Number(empresaId)}:${fonteId}`;
  if (!assinaturaAnexosPorFonte.has(chave)) assinaturaAnexosPorFonte.set(chave, new Map());
  return assinaturaAnexosPorFonte.get(chave);
}

/**
 * Sincroniza anexos (binários) SOMENTE dos chamados cujo conjunto de anexos
 * mudou segundo os metadados do snapshot. Ocupado/limite/erro → parcial e
 * retentado no próximo ciclo (assinatura só é gravada após sucesso).
 */
async function sincronizarAnexosModificados(empresaId, fonte, snap, saida) {
  if (!snap.ok) return;
  const assinaturas = _assinaturasAnexos(empresaId, fonte.id);
  let feitos = 0;
  for (const [numero, item] of snap.mapa) {
    if (item.anexosSig == null) continue; // origem não informou metadados de anexos
    const anterior = assinaturas.get(numero);
    if (anterior === item.anexosSig) continue;

    const chamado = chamadoRepo.getChamadoPorNumero(empresaId, numero, SISTEMA_ORIGEM);
    const atendimento = chamado
      ? atendimentoRepo.getAtendimentoPorReferencia(empresaId, { origem: chamado.sistemaOrigem || SISTEMA_ORIGEM, referenciaExterna: chamado.numero })
      : null;
    // Sem chat: nada a baixar agora e NÃO grava a assinatura — quando o chat existir,
    // a primeira observação confere se ele tem menos anexos da origem do que a origem informa.
    if (!chamado || !atendimento) continue;

    if (anterior === undefined) {
      // Primeira observação neste processo: só baixa se o chat tem MENOS anexos da
      // origem do que a origem informa (evita baixar tudo de novo a cada restart).
      const locais = anexoRepo.listarAnexos(empresaId, atendimento.id).filter(a => a.origemSistema === SISTEMA_ORIGEM).length;
      if (item.nAnexos != null && locais >= item.nAnexos) { assinaturas.set(numero, item.anexosSig); continue; }
    }
    if (radarService.chamadoOcupadoPorNumero(empresaId, numero)) { marcarParcial(saida, `anexos_adiados_turno_em_andamento:${numero}`); continue; }
    if (feitos >= MAX_SINCRONIZACOES_ANEXOS_POR_CICLO) { marcarParcial(saida, `anexos_adiados_limite_por_ciclo:${MAX_SINCRONIZACOES_ANEXOS_POR_CICLO}`); continue; }
    try {
      const baixados = await anexosSoftExpertService.sincronizarAnexosParaAtendimento(empresaId, chamado.id, atendimento.id);
      assinaturas.set(numero, item.anexosSig);
      feitos++;
      saida.anexosSincronizados.push({ numero, novos: Array.isArray(baixados) ? baixados.length : 0 });
    } catch (err) {
      saida.erros.push({ numero, erro: `sincronizacao_anexos: ${err.message}` });
      marcarParcial(saida, `anexos_falha:${numero}: ${err.message}`);
    }
  }
}

/**
 * Marca um resultado como parcial E registra o motivo (identificável na tela,
 * na trilha técnica e no log). Nunca marque parcial sem motivo.
 */
function marcarParcial(alvo, motivo) {
  alvo.parcial = true;
  alvo.motivosParcial = alvo.motivosParcial || [];
  if (motivo && !alvo.motivosParcial.includes(motivo)) alvo.motivosParcial.push(motivo);
}

function _marcas(empresaId, fonteId) {
  const chave = `${Number(empresaId)}:${fonteId}`;
  if (!marcasPorFonte.has(chave)) marcasPorFonte.set(chave, new Map());
  return marcasPorFonte.get(chave);
}

/**
 * Decide quem precisa ser relido. Pura sobre (snapshot, base local, marcas):
 * exportada para teste. Retorna Map<numero, {motivo, prio}>.
 */
function selecionarCandidatos({ empresaId, fonteId, snap, chamadoIdsTela = [], marcas }) {
  const candidatos = new Map();
  const add = (numero, motivo, prio) => {
    const atual = candidatos.get(numero);
    if (!atual || prio < atual.prio) candidatos.set(numero, { motivo, prio });
  };

  // 1) Tudo o que está na tela do consultor, qualquer idade.
  for (const id of chamadoIdsTela) {
    const c = chamadoRepo.getChamado(empresaId, id);
    if (c && c.fonteId === fonteId) add(String(c.numero), 'na_tela', 0);
  }

  if (!snap?.ok) return candidatos;

  // 2) O que mudou na origem.
  for (const [numero, item] of snap.mapa) {
    const local = chamadoRepo.getChamadoPorNumero(empresaId, numero, SISTEMA_ORIGEM);
    if (!local) { add(numero, 'novo_na_base', 3); continue; }
    if (_norm(local.aguardandoConsolidado) !== _norm(item.aguardando)) { add(numero, 'situacao_divergente', 1); continue; }
    const marca = snapshotService.marcaDe(item);
    const anterior = marcas.get(numero);
    if (anterior == null) {
      // Primeira observação neste processo: só "semeia" se o banco já tem a mesma
      // quantidade de posicionamentos; senão há posicionamento novo a trazer.
      if (item.nPos != null && chamadoRepo.contarPosicionamentosDoChamado(empresaId, local.id) === item.nPos) {
        marcas.set(numero, marca);
      } else {
        add(numero, 'posicionamentos_divergentes', 2);
      }
    } else if (anterior !== marca) {
      // Inclui posicionamento novo SEM mudança de situação/responsável (nPos/ultPos).
      add(numero, 'marca_alterada', 2);
    }
  }

  // 3) Abertos locais ausentes do snapshot: verificar por ID (nunca assumir
  //    encerramento). Com snapshot truncado a ausência não significa nada.
  if (!snap.truncado) {
    for (const numero of chamadoRepo.listarNumerosAbertos(empresaId, fonteId)) {
      if (!snap.mapa.has(String(numero))) add(String(numero), 'ausente_do_snapshot', 4);
    }
  }
  return candidatos;
}

async function atualizarPorSnapshot(empresaId, fonte, { chamadoIds = [], prioMin = 0, prioMax = 99, forcarSnapshot = true } = {}) {
  const t0 = Date.now();
  const antes = snapshotService.lerMetricas();
  const saida = {
    fonteId: fonte.id,
    snapshot: { ok: false },
    candidatos: {},
    atualizados: 0,
    reconstruidos: 0,
    chamadoIdsAtualizados: [],
    anexosSincronizados: [],
    ignoradosOcupados: [],
    naoEncontradosNaOrigem: [],
    erros: [],
    pendentes: 0,
    parcial: false,
    motivosParcial: [],
    consultasOrigem: 0,
    duracaoMs: 0,
  };

  const snap = await snapshotService.obterSnapshot(empresaId, fonte.id, { force: forcarSnapshot });
  saida.snapshot = {
    ok: !!snap.ok, origem: snap.origem || null, truncado: !!snap.truncado,
    itens: snap.mapa ? snap.mapa.size : 0, erro: snap.erro || null,
  };
  if (!snap.ok) marcarParcial(saida, `snapshot_indisponivel: ${snap.erro || 'sem detalhe'}`);
  else if (snap.origem === 'cache_antigo') marcarParcial(saida, `snapshot_em_cache_antigo: ${snap.erro || 'origem indisponivel'}`);
  if (snap.ok && snap.truncado) marcarParcial(saida, 'snapshot_truncado');

  const marcas = _marcas(empresaId, fonte.id);
  const candidatosTodos = selecionarCandidatos({ empresaId, fonteId: fonte.id, snap, chamadoIdsTela: chamadoIds, marcas });
  const candidatos = new Map([...candidatosTodos].filter(([, v]) => v.prio >= prioMin && v.prio <= prioMax));
  for (const { motivo } of candidatos.values()) saida.candidatos[motivo] = (saida.candidatos[motivo] || 0) + 1;

  const ordenados = [...candidatos.entries()].sort((a, b) => a[1].prio - b[1].prio).map(([n]) => n);
  const lote = ordenados.slice(0, MAX_ATUALIZACOES_POR_CICLO);
  saida.pendentes = ordenados.length - lote.length;
  if (saida.pendentes > 0) marcarParcial(saida, `atualizacoes_adiadas_por_limite:${saida.pendentes}`);

  if (lote.length) {
    // Leitura completa (com durações): novos na base e tela com leitura completa
    // antiga; o resto vai leve. Limita o custo por ciclo.
    const agora = Date.now();
    const completos = new Set();
    for (const numero of lote) {
      if (completos.size >= MAX_COMPLETOS_POR_CICLO) break;
      const { motivo } = candidatos.get(numero);
      if (motivo === 'novo_na_base') completos.add(numero);
    }
    const r = await historicalImportService.atualizarChamadosPorIds(empresaId, fonte.id, lote, {
      deveIgnorar: (numero) => radarService.chamadoOcupadoPorNumero(empresaId, numero),
      numerosCompletos: completos,
    });
    for (const numero of completos) ultimaLeituraCompleta.set(`${empresaId}:${fonte.id}:${numero}`, agora);
    saida.consultasOrigem += r.consultasOrigem;
    saida.ignoradosOcupados = r.ignorados;
    saida.naoEncontradosNaOrigem = r.naoEncontrados;
    saida.erros = r.erros;
    if (r.ignorados.length) marcarParcial(saida, `chamados_ocupados:${r.ignorados.join(',')}`);
    if (r.erros.length) marcarParcial(saida, `erros_leitura_por_id:${r.erros.map(e => `${e.numero}: ${e.erro}`).join('; ')}`);

    const reconstruirFalhou = new Set();
    for (const a of r.atualizados) {
      saida.atualizados++;
      saida.chamadoIdsAtualizados.push(a.chamadoId);
      try {
        const rec = radarService.reconstruirHistoricoDoChamado(empresaId, a.chamadoId);
        if (rec.reconstruido) saida.reconstruidos++;
        else if (rec.motivo === 'turno_em_andamento' || rec.motivo === 'pre_analise_em_andamento') {
          reconstruirFalhou.add(a.numero); // retenta no próximo ciclo (marca não é gravada)
          marcarParcial(saida, `reconstrucao_adiada_${rec.motivo}:${a.numero}`);
        }
      } catch (err) {
        reconstruirFalhou.add(a.numero);
        saida.erros.push({ numero: a.numero, erro: `reconstrucao_historico: ${err.message}` });
        marcarParcial(saida, `reconstrucao_falhou:${a.numero}: ${err.message}`);
      }
    }

    // Marcas só dos chamados efetivamente processados (ocupados/erro/não
    // encontrados ficam sem marca → serão candidatos de novo).
    const naoMarcar = new Set([
      ...r.ignorados, ...r.naoEncontrados, ...r.erros.map(e => e.numero), ...reconstruirFalhou,
    ]);
    if (snap.ok) {
      for (const numero of lote) {
        if (naoMarcar.has(numero)) continue;
        const item = snap.mapa.get(numero);
        if (item) marcas.set(numero, snapshotService.marcaDe(item));
      }
    }
  }

  // Etapa final (depois da janela): reconciliações que dependem do banco já
  // atualizado pela janela — chat desatualizado e anexos novos por metadados.
  const etapaFinal = prioMax > PRIO_PRIORITARIA_MAX;
  if (etapaFinal) {
    try {
      await sincronizarAnexosModificados(empresaId, fonte, snap, saida);
    } catch (err) {
      saida.erros.push({ numero: null, erro: `anexos: ${err.message}` });
      marcarParcial(saida, `anexos_falha_geral: ${err.message}`);
    }
  }

  // Chat desatualizado mesmo sem leitura por ID: a importação por janela traz
  // posicionamentos novos ao banco, mas só o chat selecionado os reconstruía.
  // Reconcilia (barato, só banco local) tela + abertos do snapshot.
  if (etapaFinal) {
    const jaReconstruidos = new Set(saida.chamadoIdsAtualizados);
    const numerosVerificar = new Set(chamadoIds.map((id) => {
      const c = chamadoRepo.getChamado(empresaId, id);
      return c ? String(c.numero) : null;
    }).filter(Boolean));
    if (snap.ok) for (const n of snap.mapa.keys()) numerosVerificar.add(n);
    for (const numero of numerosVerificar) {
      const c = chamadoRepo.getChamadoPorNumero(empresaId, numero, SISTEMA_ORIGEM);
      if (!c || jaReconstruidos.has(c.id)) continue;
      try {
        if (radarService.historicoImportadoDesatualizado(empresaId, c.id)) {
          const rec = radarService.reconstruirHistoricoDoChamado(empresaId, c.id);
          if (rec.reconstruido) { saida.reconstruidos++; saida.chamadoIdsAtualizados.push(c.id); }
          else if (rec.motivo === 'turno_em_andamento' || rec.motivo === 'pre_analise_em_andamento') marcarParcial(saida, `reconciliacao_adiada_${rec.motivo}:${numero}`);
        }
      } catch (err) {
        saida.erros.push({ numero, erro: `reconciliacao_historico: ${err.message}` });
        marcarParcial(saida, `reconciliacao_falhou:${numero}: ${err.message}`);
      }
    }
  }

  const depois = snapshotService.lerMetricas();
  saida.consultasOrigem += depois.consultasOrigem - antes.consultasOrigem;
  saida.duracaoMs = Date.now() - t0;
  return saida;
}

/**
 * Renova as durações (leitura completa) de poucos chamados da tela, depois do
 * ciclo e sem bloquear nada: nunca entra na promise do Refresh, nunca roda em
 * paralelo para a mesma fonte e falha em silêncio (só log).
 */
async function renovarDuracoesEmSegundoPlano(empresaId, fonte, chamadoIds) {
  if (process.env.IA_SERVICE_REFRESH_DURACOES === '0') return { executado: false, motivo: 'desligado' };
  const chaveFonte = `${empresaId}:${fonte.id}`;
  if (duracoesEmAndamento.has(chaveFonte)) return { executado: false, motivo: 'em_andamento' };
  const agora = Date.now();
  const numeros = [];
  for (const id of chamadoIds || []) {
    const c = chamadoRepo.getChamado(empresaId, id);
    if (!c || c.fonteId !== fonte.id) continue;
    const ts = ultimaLeituraCompleta.get(`${chaveFonte}:${c.numero}`) || 0;
    if (agora - ts > REFRESH_COMPLETO_TELA_MS) numeros.push({ numero: String(c.numero), ts });
  }
  numeros.sort((a, b) => a.ts - b.ts);
  const alvo = numeros.slice(0, MAX_DURACOES_SEGUNDO_PLANO).map(n => n.numero);
  if (!alvo.length) return { executado: false, motivo: 'nada_a_renovar' };
  duracoesEmAndamento.add(chaveFonte);
  try {
    await historicalImportService.atualizarChamadosPorIds(empresaId, fonte.id, alvo, {
      deveIgnorar: (numero) => radarService.chamadoOcupadoPorNumero(empresaId, numero),
      numerosCompletos: new Set(alvo),
    });
    for (const n of alvo) ultimaLeituraCompleta.set(`${chaveFonte}:${n}`, Date.now());
    return { executado: true, numeros: alvo };
  } catch (err) {
    console.error('[IA Service] Renovação de durações em segundo plano falhou:', err.message);
    return { executado: false, motivo: err.message };
  } finally {
    duracoesEmAndamento.delete(chaveFonte);
  }
}

function _executar(empresaId, { janelaDias, chamadoIds } = {}) {
  const estado = {
    iniciadoEmMs: Date.now(),
    promise: null,
    extras: new Set(),
    ultimoResultado: estadoPorEmpresa.get(Number(empresaId))?.ultimoResultado || null,
  };

  const promise = (async () => {
    let fontes = [];
    const resultados = [];
    const idsAtualizados = new Set();
    let parcial = false;
    const motivosParcial = [];
    const motivo = (m) => { parcial = true; if (m && !motivosParcial.includes(m)) motivosParcial.push(m); };
    const absorver = (r, etapa) => { if (r?.parcial) { parcial = true; for (const m of r.motivosParcial || []) motivo(`${etapa}: ${m}`); } };
    try {
    fontes = snapshotService.fontesElegiveis(empresaId);
    if (!fontes.length) motivo('sem_fontes_elegiveis'); // nada a sincronizar não é sucesso

    for (const fonte of fontes) {
      const item = { fonteId: fonte.id, ok: true, janela: { ok: true }, porId: null, housekeeping: null };
      // Etapa 1 (prioritária): a TELA do consultor + o que mudou na origem — termina
      // rápido (leitura leve) e já publica o progresso para a tela recarregar.
      try {
        item.porId = await atualizarPorSnapshot(empresaId, fonte, { chamadoIds, prioMax: PRIO_PRIORITARIA_MAX });
        item.porId.chamadoIdsAtualizados.forEach(id => idsAtualizados.add(id));
        absorver(item.porId, 'tela');
      } catch (err) {
        item.ok = false; motivo(`etapa_prioritaria_falhou: ${err.message}`);
        item.porId = { erro: err.message };
        console.error(`[IA Service] Refresh por ID falhou na fonte ${fonte.nome || fonte.id}:`, err.message);
      }
      estado.progresso = {
        etapa: 'tela_atualizada',
        em: Date.now(),
        parcial: true, // ainda faltam janela e conferências: nunca apresentar como concluído
        chamadoIdsAtualizados: [...idsAtualizados],
      };
      // Etapa 2: importação incremental por janela (inalterada) — chamados novos.
      try {
        const importacao = await historicalSyncService.executarIncremental(empresaId, fonte.id, { janelaDias });
        item.janela = { ok: true, importacaoId: importacao?.id || null };
      } catch (err) {
        item.janela = { ok: false, erro: err.message };
        item.ok = false; motivo(`janela_incremental_falhou: ${err.message}`);
        console.error(`[IA Service] Refresh do Radar falhou na janela da fonte ${fonte.nome || fonte.id}:`, err.message);
      }
      // Etapa 3: conferências (novos na base, ausentes do snapshot) + chat dos
      // chamados trazidos pela janela. Usa o snapshot em cache (sem nova consulta).
      try {
        item.housekeeping = await atualizarPorSnapshot(empresaId, fonte, { chamadoIds, prioMin: PRIO_PRIORITARIA_MAX + 1, forcarSnapshot: false });
        item.housekeeping.chamadoIdsAtualizados.forEach(id => idsAtualizados.add(id));
        absorver(item.housekeeping, 'conferencias');
      } catch (err) {
        motivo(`conferencias_falharam: ${err.message}`);
        item.housekeeping = { erro: err.message };
        console.error(`[IA Service] Conferencia pos-janela falhou na fonte ${fonte.nome || fonte.id}:`, err.message);
      }
      resultados.push(item);
    }

    // IDs de tela de outros consultores que chegaram DURANTE esta execução.
    for (let ciclo = 0; ciclo < MAX_CICLOS_EXTRAS && estado.extras.size; ciclo++) {
      const ids = [...estado.extras];
      estado.extras.clear();
      for (const fonte of fontes) {
        try {
          const r = await atualizarPorSnapshot(empresaId, fonte, { chamadoIds: ids });
          r.chamadoIdsAtualizados.forEach(id => idsAtualizados.add(id));
          absorver(r, 'telas_adicionais');
        } catch (err) {
          motivo(`telas_adicionais_falharam: ${err.message}`);
          console.error('[IA Service] Refresh por ID (extras) falhou:', err.message);
        }
      }
    }

    // Depois de concluir (fora da promise): renova durações da tela em segundo plano.
    setImmediate(() => {
      for (const fonte of fontes) {
        renovarDuracoesEmSegundoPlano(empresaId, fonte, chamadoIds).catch(() => {});
      }
    });

    // Semântica explícita para a tela: sucesso SÓ quando nada ficou parcial/falhou.
    // (parcial = alguma etapa falhou, foi limitada ou adiada; falhou = o ciclo
    // inteiro não pôde ser executado.)
    if (parcial) {
      console.warn(`[IA Service] Refresh do Radar PARCIAL (empresa ${empresaId}): ${motivosParcial.join(' | ') || 'motivo nao informado'}`);
    }
    return {
      fontes: resultados,
      sucesso: !parcial,
      parcial,
      motivosParcial,
      falhou: false,
      chamadoIdsAtualizados: [...idsAtualizados],
      concluidoEm: new Date().toISOString(),
    };
    } catch (err) {
      console.error('[IA Service] Refresh do Radar falhou por completo:', err.message);
      return {
        fontes: resultados, sucesso: false, parcial: true, falhou: true, erro: err.message,
        motivosParcial: [`ciclo_falhou: ${err.message}`],
        chamadoIdsAtualizados: [...idsAtualizados],
        concluidoEm: new Date().toISOString(),
      };
    }
  })();

  estado.promise = promise;
  estadoPorEmpresa.set(Number(empresaId), estado);
  const finalizar = (resultado) => {
    const atual = estadoPorEmpresa.get(Number(empresaId));
    if (atual === estado) {
      estadoPorEmpresa.set(Number(empresaId), {
        ...estado, promise: null, finalizadoEmMs: Date.now(),
        ultimoResultado: resultado || estado.ultimoResultado,
      });
    }
  };
  promise.then(finalizar, () => finalizar(null));
  return promise;
}

async function sincronizarAntesDaFila(empresaId, { force = false, aguardarMs = AGUARDAR_PADRAO_MS, janelaDias, chamadoIds = [] } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const chave = Number(empresaId);
  const atual = estadoPorEmpresa.get(chave);
  const agora = Date.now();

  let promise = atual?.promise || null;
  const dentroDoIntervalo = atual?.iniciadoEmMs && (agora - atual.iniciadoEmMs) < INTERVALO_MINIMO_MS;

  if (promise) {
    // Execução em andamento (de outro consultor ou do mesmo): a tela deste
    // consultor entra como extra, para não ficar sem atualização.
    for (const id of chamadoIds) atual.extras.add(id);
  } else if (force || !dentroDoIntervalo) {
    promise = _executar(empresaId, { janelaDias, chamadoIds });
  }

  if (!promise) {
    return {
      status: 'recente',
      iniciadoEm: atual?.iniciadoEmMs ? new Date(atual.iniciadoEmMs).toISOString() : null,
      resultado: atual?.ultimoResultado || null,
    };
  }

  const progressoAtual = () => estadoPorEmpresa.get(chave)?.progresso || null;

  if (!aguardarMs) {
    return { status: 'em_andamento', progresso: progressoAtual() };
  }

  const timeout = new Promise(resolve => setTimeout(() => resolve({ _timeout: true }), aguardarMs));
  const resultado = await Promise.race([promise, timeout]);
  if (resultado?._timeout) return { status: 'em_andamento', progresso: progressoAtual() };
  return { status: 'concluido', resultado };
}

function _resetarParaTeste() {
  estadoPorEmpresa.clear();
  marcasPorFonte.clear();
  ultimaLeituraCompleta.clear();
  duracoesEmAndamento.clear();
  assinaturaAnexosPorFonte.clear();
}

module.exports = {
  sincronizarAntesDaFila,
  atualizarPorSnapshot,
  selecionarCandidatos,
  renovarDuracoesEmSegundoPlano,
  MAX_ATUALIZACOES_POR_CICLO,
  _resetarParaTeste,
};
