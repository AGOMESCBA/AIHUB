'use strict';

// Replay multi-turno do motor de investigação (Fase 1, 2026-11-12).
//
// Executa o processarTurno REAL, turno a turno, num banco temporário. As
// decisões do motor (pesquisar, consultas, seleção, resposta, dossiê) rodam
// de verdade; só os resultados externos são congelados: busca/leitura de
// páginas vêm das fontes do caso, Agente Local/SoftExpert não são chamados.
//
// Nada deste módulo toca o banco real nem a configuração da Platform:
// platform-store é substituído por um stub ANTES de qualquer serviço carregar,
// e a chave do provider vem de quem chama (executar-replay: ambiente ou
// --chave-platform, lida antes deste módulo carregar).

const fs = require('fs');
const path = require('path');
const os = require('os');

const CAMINHO_PLATFORM_STORE = require.resolve('../../../IAHUB/backend/platform-store');
require.cache[CAMINHO_PLATFORM_STORE] = {
  id: CAMINHO_PLATFORM_STORE, filename: CAMINHO_PLATFORM_STORE, loaded: true,
  exports: new Proxy({}, { get: (_alvo, chave) => (chave === '__esModule' ? false : () => null) }),
};

const database = require('../../backend/database');
const atendimentoRepo = require('../../backend/repositories/atendimento-repository');
const anexoRepo = require('../../backend/repositories/anexo-repository');
const chamadoRepo = require('../../backend/repositories/chamado-repository');
const execucaoRepo = require('../../backend/repositories/investigacao-execucao-repository');
const aiProviderClient = require('../../backend/services/ai-provider-client');
const aiConfigService = require('../../backend/services/ai-config-service');
const technicalResearchService = require('../../backend/services/technical-research-service');
const anexosSoftExpertService = require('../../backend/services/anexos-softexpert-service');
const situacaoOrigemService = require('../../backend/services/situacao-origem-service');
const investigacaoDossieService = require('../../backend/services/investigacao-dossie-service');
const dossieAtualizacaoRepo = require('../../backend/repositories/investigacao-dossie-atualizacao-repository');
const investigacaoService = require('../../backend/services/investigacao-service');
const custoIa = require('../../backend/services/custo-ia-service');

const EMPRESA = 1;
const OUTRA_EMPRESA = 2;
const TEXTO_BOTAO = 'Revise todo o historico, anexos e fontes disponiveis e pesquise uma solucao para este chamado.';

// ---------------------------------------------------------------------------
// Instrumentação das chamadas de IA

function finalidadeDaChamada(systemPrompt = '', userPrompt = '', opts = {}) {
  const sp = String(systemPrompt || '');
  if (opts.finalidade) return opts.finalidade;
  if (opts.maxTokens === 30 && opts.json) return 'classificacao_turno';
  if (sp.startsWith('Voce classifica apenas')) return 'interpretacao_semantica';
  if (sp.startsWith('Voce escreve consultas')) return 'consultas_busca';
  if (sp.startsWith('Voce seleciona')) return 'selecao_artigos';
  if (sp.startsWith('Voce atualiza um dossie')) return 'atualizacao_dossie';
  if (sp.startsWith('Voce conduz a investigacao tecnica')) return 'avaliacao_evidencias';
  if (sp.includes('Responda à última mensagem do analista continuando')) return 'resposta_conversa';
  if (String(userPrompt || '').includes('Transcreva o texto visivel')) return 'ocr_print';
  if (opts.maxTokens === 6000) return 'resposta_principal';
  return 'outra';
}

function _textoEnviado(systemPrompt, userPrompt, opts) {
  const conversa = Array.isArray(opts?.conversa) ? opts.conversa.map(m => m.content).join('\n') : '';
  return [systemPrompt, userPrompt, conversa].join('\n');
}

function instalarInstrumentacao({ chamarIABase, registro, modelo }) {
  const original = chamarIABase;
  aiProviderClient.chamarIA = async (keys, cfg, systemPrompt, userPrompt, imagens = [], opts = {}) => {
    const inicio = Date.now();
    const item = {
      finalidade: finalidadeDaChamada(systemPrompt, userPrompt, opts),
      inicioMs: inicio,
      textoEnviado: _textoEnviado(systemPrompt, userPrompt, opts),
    };
    try {
      const r = await original(keys, cfg, systemPrompt, userPrompt, imagens, opts);
      Object.assign(item, {
        ok: true, provider: r.provider, model: r.model, usage: r.usage || null, truncado: !!r.truncado,
        latenciaMs: Date.now() - inicio, textoRecebido: String(r.texto || ''),
      });
      item.custo = custoIa.estimarCusto({ provider: r.provider, model: r.model, usage: r.usage });
      return r;
    } catch (err) {
      Object.assign(item, { ok: false, erro: err.message, latenciaMs: Date.now() - inicio, model: modelo });
      throw err;
    } finally {
      registro.push(item);
    }
  };
}

// Só o provider/modelo do replay, sem fallback: o resultado mede um modelo.
function forcarModelo({ modelo, chave }) {
  const original = aiConfigService.resolverKeysEOrdem;
  aiConfigService.resolverKeysEOrdem = (empresaId) => {
    const { cfg } = original(empresaId);
    return {
      keys: { groq: null, openai: chave, deepseek: null, claude: null, gemini: null },
      cfg: { ...cfg, provedorPrimario: 'openai', fallbackOrdem: '', modelos: { ...cfg.modelos, openai: modelo } },
    };
  };
}

// ---------------------------------------------------------------------------
// Fontes externas congeladas

function _normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function _pontuarFonte(fonte, consulta) {
  const q = _normalizar(consulta);
  return (fonte.palavras || []).filter(p => q.includes(_normalizar(p))).length;
}

function criarBuscaCongelada(caso, registroBusca) {
  const fontes = caso.fontes || [];
  const buscar = (origem, filtro) => async (consultas, limitePorConsulta = 3) => {
    registroBusca.push({ origem, consultas: [...consultas] });
    if (caso.falhaBusca) throw new Error('read ECONNRESET (falha simulada do provedor de busca)');
    const resultados = [];
    for (const consulta of consultas) {
      fontes
        .filter(filtro)
        .map(f => ({ f, score: _pontuarFonte(f, consulta) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limitePorConsulta)
        .forEach(({ f }) => resultados.push({
          titulo: f.titulo, url: f.url, trecho: String(f.conteudo || '').slice(0, 280),
          fonte: origem === 'central' ? 'Central TOTVS' : 'Serper/Google', consulta, oficial: !!f.oficial,
        }));
    }
    return resultados;
  };
  const porUrl = new Map(fontes.map(f => [f.url, f]));
  return {
    buscarSerper: buscar('web', () => true),
    buscarCentralTotvs: async (consulta, limite) => buscar('central', f => /totvs\.com/.test(f.url))([consulta], limite),
    abrirResultados: async (paraAbrir, limite = 2) => {
      const lidas = (paraAbrir || []).slice(0, limite).map(r => {
        const f = porUrl.get(r.url);
        registroBusca.push({ origem: 'leitura', url: r.url });
        return f
          ? { titulo: f.titulo, url: f.url, status: 'lida', trecho: String(f.conteudo || '').slice(0, 2200), consulta: r.consulta, oficial: !!f.oficial, rankingScore: r.rankingScore }
          : { titulo: r.titulo, url: r.url, status: 'erro', erro: 'fonte fora do caso congelado', consulta: r.consulta };
      });
      lidas.urlsReutilizadas = [];
      lidas.trechosOmitidos = [];
      return lidas;
    },
  };
}

function instalarBuscaCongelada(caso, registroBusca) {
  const original = technicalResearchService.pesquisar;
  const congelada = criarBuscaCongelada(caso, registroBusca);
  technicalResearchService.pesquisar = (ctx, opts = {}) => original(ctx, {
    ...opts,
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper', serperApiKey: 'replay-congelado', geminiApiKey: null, openaiApiKey: null },
    buscarSerper: congelada.buscarSerper,
    buscarCentralTotvs: congelada.buscarCentralTotvs,
    abrirResultados: congelada.abrirResultados,
  });
  return () => { technicalResearchService.pesquisar = original; };
}

// Agente Local e SoftExpert nunca são chamados no replay.
function isolarIntegracoes() {
  anexosSoftExpertService.garantirAnexosParaIA = async () => ({ verificado: true, total: 0, copiados: [], faltantes: [] });
  situacaoOrigemService.consultarSituacaoAtual = async () => null;
}

// ---------------------------------------------------------------------------
// Preparação do caso no banco temporário

function _fonteHistorica(empresaId) {
  database.getDB().prepare(`INSERT INTO fontes_historicas
    (id, empresa_id, connection_key, nome, sistema_origem, adapter, criado_em, atualizado_em)
    VALUES (?, ?, 'replay', 'Replay', 'replay', 'replay', '2026-01-01', '2026-01-01')`).run(`fonte-replay-${empresaId}`, empresaId);
}

function _criarChamado(empresaId, dados) {
  const { chamado } = chamadoRepo.upsertChamado(empresaId, {
    fonteId: `fonte-replay-${empresaId}`, oidOrigem: `oid-${dados.numero}`, sistemaOrigem: 'replay',
    produto: dados.produto || 'Protheus', ...dados,
  });
  (dados.posicionamentos || []).forEach((p, i) => chamadoRepo.upsertPosicionamento(empresaId, {
    fonteId: `fonte-replay-${empresaId}`, oidOrigem: `oid-${dados.numero}-p${i + 1}`, chamadoId: chamado.id,
    dataPosicionamento: p.data || `2026-0${Math.min(9, i + 1)}-10T12:00:00.000Z`, ...p,
  }));
  return chamado;
}

// Log grande sem guardar megabytes no JSON do caso: `gerar` repete uma linha
// de ruído e insere as linhas relevantes numa posição fixa (determinístico).
function _conteudoDoAnexo(anexo) {
  if (!anexo.gerar) return String(anexo.conteudo || '');
  const { linhas, ruido, inserirNaLinha, trecho } = anexo.gerar;
  const saida = [];
  for (let i = 1; i <= linhas; i++) {
    if (i === inserirNaLinha) saida.push(...trecho);
    saida.push(ruido.replace('{n}', String(i).padStart(6, '0')));
  }
  return saida.join('\n');
}

function _salvarAnexo(empresaId, atendimentoId, anexo) {
  const conteudo = _conteudoDoAnexo(anexo);
  return anexoRepo.salvarMetadadosAnexo(empresaId, atendimentoId, {
    nomeOriginal: anexo.nome,
    nomeInterno: `replay-${Date.now()}-${anexo.nome}`,
    mimeType: anexo.mime || 'text/plain',
    tamanho: Buffer.byteLength(conteudo),
    // O replay só usa anexos de texto: o conteúdo vai pelo campo extraído e
    // nenhum arquivo é gravado na pasta real de anexos.
    caminhoRelativo: `replay/${anexo.nome}`,
    conteudoExtraido: conteudo,
    linguagemDetectada: anexo.linguagem || null,
    encodingDetectado: 'utf-8',
    eCodigo: !!anexo.eCodigo,
  });
}

function prepararCaso(caso) {
  _fonteHistorica(EMPRESA);
  _fonteHistorica(OUTRA_EMPRESA);
  for (const anterior of caso.chamadosAnteriores || []) _criarChamado(EMPRESA, anterior);
  if (caso.outraEmpresa) {
    for (const c of caso.outraEmpresa.chamados || []) _criarChamado(OUTRA_EMPRESA, c);
    const atOutra = atendimentoRepo.criarAtendimento(OUTRA_EMPRESA, { origem: 'manual', canalEntrada: 'web', conteudoBruto: caso.outraEmpresa.atendimento || caso.outraEmpresa.marcador });
    if (caso.outraEmpresa.anexo) _salvarAnexo(OUTRA_EMPRESA, atOutra.id, caso.outraEmpresa.anexo);
  }
  const chamado = caso.chamado ? _criarChamado(EMPRESA, { ...caso.chamado, descricao: caso.chamado.descricao || caso.abertura }) : null;
  const atendimento = atendimentoRepo.criarAtendimentoComPrimeiraMensagem(EMPRESA, {
    origem: chamado ? 'replay' : 'manual',
    canalEntrada: 'web',
    referenciaExterna: chamado ? chamado.numero : null,
    conteudoBruto: caso.abertura,
  }, { papel: 'user', conteudo: caso.abertura, usuarioId: null });
  for (const anexo of caso.anexosIniciais || []) _salvarAnexo(EMPRESA, atendimento.id, anexo);
  return { atendimento, chamado };
}

// ---------------------------------------------------------------------------
// Execução

function _consultasDoTurno(execucao) {
  return (execucao?.pesquisa?.consultasExecutadas || []).map(q => _normalizar(q).replace(/\s+/g, ' ').trim());
}

async function executarTurno({ caso, turno, indice, atendimento, registroIA, registroBusca }) {
  const inicioIA = registroIA.length;
  const inicioBusca = registroBusca.length;
  const anexoIds = (turno.anexos || []).map(a => _salvarAnexo(EMPRESA, atendimento.id, a).id);
  const inicio = Date.now();
  let mensagem;
  let erro = null;
  try {
    if (turno.tipo === 'pre_analise') {
      mensagem = await investigacaoService.processarPreAnalise(EMPRESA, atendimento.id, { anexoIds });
    } else {
      const botao = turno.tipo === 'botao';
      mensagem = await investigacaoService.processarTurno(EMPRESA, atendimento.id, {
        texto: botao ? TEXTO_BOTAO : turno.texto,
        usuarioId: 1,
        anexoIds,
        forcarPesquisa: botao,
        origemAcao: botao ? 'botao_pesquisar' : 'texto_livre',
        analistaAtualNome: 'Analista Replay',
      });
    }
  } catch (err) {
    erro = err.message;
  }
  const latenciaTurnoMs = Date.now() - inicio;
  // A atualização do dossiê roda em segundo plano: espera para o próximo turno
  // (e a medição) enxergar o estado real.
  const esperaDossie = Date.now();
  await investigacaoService.aguardarDossiePendente(EMPRESA, atendimento.id, 180000);
  const latenciaDossieMs = Date.now() - esperaDossie;

  const execucao = mensagem?.id
    ? execucaoRepo.listarPorAtendimento(EMPRESA, atendimento.id, { limite: 50 }).find(e => e.mensagemId === mensagem.id) || null
    : null;
  const chamadasIA = registroIA.slice(inicioIA);
  const plano = execucao?.pesquisa?.plano || {};
  // O motor grava a falha do provider como mensagem do assistente; para o
  // replay isso não é resposta, é turno inválido.
  const falhaPrincipal = chamadasIA.find(c => c.finalidade === 'resposta_principal' && !c.ok);
  return {
    indice,
    tipo: turno.tipo || 'mensagem',
    texto: turno.texto || null,
    erro: erro || (falhaPrincipal ? `falha do provider na resposta principal: ${falhaPrincipal.erro}` : null),
    falhaProvider: !!falhaPrincipal,
    resposta: mensagem?.conteudo || null,
    respostaCurta: mensagem?.respostaCurta || null,
    statusExecucao: execucao?.status || null,
    pesquisa: {
      devePesquisar: plano.devePesquisar ?? null,
      motivo: plano.motivo || null,
      disciplinaModo4B: plano.disciplinaModo4B ?? null,
      lacuna: plano.lacunaInvestigativa?.tipo || null,
      zona: plano.preAnalise?.zona || null,
      consultas: _consultasDoTurno(execucao),
      paginasLidas: (execucao?.pesquisa?.paginasLidas || []).filter(p => p.status === 'lida' || p.status === 'reutilizada').map(p => p.url),
      buscasCongeladas: registroBusca.slice(inicioBusca),
      // Ciclo investigativo: avaliação das fontes e decisões da IA por rodada.
      ciclo: execucao?.pesquisa?.ciclo || null,
      erroPrincipalIA: execucao?.pesquisa?.plano?.consultasIA?.erroPrincipal || null,
    },
    temposEtapasMs: execucao?.contexto?.temposEtapasMs || null,
    latenciaTurnoMs,
    latenciaDossieMs,
    chamadasIA: chamadasIA.map(c => ({
      finalidade: c.finalidade, ok: c.ok, model: c.model || null, latenciaMs: c.latenciaMs,
      tokensEntrada: c.usage?.prompt_tokens ?? null, tokensSaida: c.usage?.completion_tokens ?? null,
      custo: c.custo?.custo ?? null, motivoSemCusto: c.custo?.motivo || null, truncado: !!c.truncado, erro: c.erro || null,
    })),
    _textosEnviados: chamadasIA.map(c => c.textoEnviado),
  };
}

function verificarVazamento(caso, turnos) {
  const marcadores = [caso.outraEmpresa?.marcador, ...(caso.marcadoresProibidos || [])].filter(Boolean);
  if (!marcadores.length) return null;
  const achados = [];
  turnos.forEach(t => {
    for (const m of marcadores) {
      if (t._textosEnviados.some(txt => txt.includes(m))) achados.push({ turno: t.indice, marcador: m, onde: 'prompt_enviado' });
      if (String(t.resposta || '').includes(m)) achados.push({ turno: t.indice, marcador: m, onde: 'resposta' });
    }
  });
  return { verificado: true, vazou: achados.length > 0, achados };
}

/**
 * Executa um caso uma vez. `chamarIA` é a função real do provider (ou a
 * simulada); `modelo` e `chave` definem o provider único do replay.
 */
async function executarCaso(caso, { modelo, chave, chamarIA, disciplina4B, execucao = 1, diretorioTmp = os.tmpdir() }) {
  const registroIA = [];
  const registroBusca = [];
  const chamarIAOriginal = aiProviderClient.chamarIA;
  const resolverOriginal = aiConfigService.resolverKeysEOrdem;
  const env4BAnterior = process.env.IA_SERVICE_DISCIPLINA_4B;
  const dbPath = path.join(diretorioTmp, `ia-service-replay-${caso.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  database.inicializarDB(dbPath);
  process.env.IA_SERVICE_DISCIPLINA_4B = disciplina4B ? '1' : '0';
  instalarInstrumentacao({ chamarIABase: chamarIA, registro: registroIA, modelo });
  forcarModelo({ modelo, chave });
  const restaurarBusca = instalarBuscaCongelada(caso, registroBusca);
  isolarIntegracoes();
  const inicio = Date.now();
  try {
    const { atendimento } = prepararCaso(caso);
    const turnos = [];
    const consultasAnteriores = new Set();
    for (const [i, turno] of caso.turnos.entries()) {
      const r = await executarTurno({ caso, turno, indice: i + 1, atendimento, registroIA, registroBusca });
      r.pesquisa.consultasRepetidas = r.pesquisa.consultas.filter(q => consultasAnteriores.has(q));
      r.pesquisa.consultas.forEach(q => consultasAnteriores.add(q));
      turnos.push(r);
    }
    const dossie = investigacaoDossieService.obterEstadoCompleto(EMPRESA, atendimento.id);
    const seguranca = verificarVazamento(caso, turnos);
    turnos.forEach(t => { delete t._textosEnviados; });
    return {
      casoId: caso.id, conjunto: caso.conjunto, execucao, modelo, disciplina4B: !!disciplina4B,
      duracaoMs: Date.now() - inicio,
      turnos,
      seguranca,
      dossieFinal: dossie ? {
        hipoteses: (dossie.hipoteses || []).map(h => ({ codigo: h.codigo, status: h.status, titulo: h.titulo })),
        testes: (dossie.testes || []).map(t => ({ codigo: t.codigo, status: t.status, titulo: t.titulo })),
        fatos: (dossie.fatos || []).length,
        fatosDetalhe: (dossie.fatos || []).map(f => ({ codigo: f.codigo, status: f.status, titulo: f.titulo, descricao: String(f.descricao || '').slice(0, 200) })),
        hipotesesDetalhe: (dossie.hipoteses || []).map(h => ({ codigo: h.codigo, status: h.status, descricao: String(h.descricao || '').slice(0, 200) })),
        testesDetalhe: (dossie.testes || []).map(t => ({ codigo: t.codigo, status: t.status, descricao: String(t.descricao || '').slice(0, 200) })),
        resultados: (dossie.resultados || []).map(r => ({ codigo: r.codigo, status: r.status, titulo: r.titulo, descricao: String(r.descricao || '').slice(0, 200) })),
        diagnosticoAtual: dossie.dossie?.diagnosticoAtual || null,
        relacoes: (dossie.relacoes || []).map(r => r.alvoTipo),
      } : null,
      // Auditoria de cada atualização do dossiê: aceitas, rejeitadas e motivo.
      atualizacoesDossie: dossieAtualizacaoRepo.listarPorAtendimento(EMPRESA, atendimento.id, { limite: 50 }).map(a => ({
        status: a.status,
        aceitas: (a.alteracoesAceitas || []).length,
        rejeitadas: (a.alteracoesRejeitadas || []).map(r => r.motivo || null),
        erro: a.erro || null,
      })),
    };
  } finally {
    restaurarBusca();
    aiProviderClient.chamarIA = chamarIAOriginal;
    aiConfigService.resolverKeysEOrdem = resolverOriginal;
    if (env4BAnterior === undefined) delete process.env.IA_SERVICE_DISCIPLINA_4B;
    else process.env.IA_SERVICE_DISCIPLINA_4B = env4BAnterior;
    database.fecharDB();
    for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(dbPath + sufixo, { force: true });
  }
}

module.exports = { executarCaso, finalidadeDaChamada, criarBuscaCongelada, TEXTO_BOTAO, EMPRESA, OUTRA_EMPRESA };
