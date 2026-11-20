// Jade no Primeiro Atendimento: configuração por fonte e registro de cada
// chamado tratado. O registro é a garantia de "uma ação por chamado" — nunca
// é apagado por limpezas do chat nem pela exclusão da fonte.
const crypto = require('crypto');
const { getDB } = require('../database');

const PADRAO = { ativo: false, modo: 'simulacao', devolucaoAtiva: false, intervaloMinutos: 5, limiteDiario: 30, processamentosSimultaneos: 3, usuarioSoftexpert: null, somenteChamados: [] };

function _listaChamados(valor) {
  const lista = (Array.isArray(valor) ? valor : String(valor ?? '').split(/[\s,;]+/)).map(v => String(v).trim()).filter(Boolean);
  return [...new Set(lista)];
}
const MODOS = ['simulacao', 'publicar'];

function _config(row, empresaId, fonteId) {
  if (!row) return { empresaId: Number(empresaId), fonteId, ...PADRAO, ultimoCicloEm: null, ultimoCicloResumo: null, atualizadoEm: null };
  let resumo = null;
  try { resumo = row.ultimo_ciclo_resumo ? JSON.parse(row.ultimo_ciclo_resumo) : null; } catch (_) { resumo = null; }
  return {
    empresaId: row.empresa_id, fonteId: row.fonte_id, ativo: row.ativo === 1, modo: row.modo,
    devolucaoAtiva: row.devolucao_ativa === 1, intervaloMinutos: row.intervalo_minutos, limiteDiario: row.limite_diario,
    processamentosSimultaneos: row.processamentos_simultaneos ?? PADRAO.processamentosSimultaneos,
    usuarioSoftexpert: row.usuario_softexpert ?? null, somenteChamados: _listaChamados(row.somente_chamados), cicloTravaAte: row.ciclo_trava_ate, ultimoCicloEm: row.ultimo_ciclo_em, ultimoCicloResumo: resumo, atualizadoEm: row.atualizado_em,
    proximoCicloEm: row.proximo_ciclo_em ?? null,
  };
}

function getConfig(empresaId, fonteId) {
  const row = getDB().prepare('SELECT * FROM jade_pa_config WHERE empresa_id = ? AND fonte_id = ?').get(Number(empresaId), fonteId);
  return _config(row, empresaId, fonteId);
}

function _inteiro(valor, min, max, nome) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw Object.assign(new Error(`${nome} deve ser um número inteiro entre ${min} e ${max}.`), { status: 400 });
  return n;
}

function salvarConfig(empresaId, fonteId, dados) {
  const atual = getConfig(empresaId, fonteId);
  const novo = {
    ativo: dados.ativo === undefined ? atual.ativo : dados.ativo === true,
    modo: dados.modo === undefined ? atual.modo : dados.modo,
    devolucaoAtiva: dados.devolucaoAtiva === undefined ? atual.devolucaoAtiva : dados.devolucaoAtiva === true,
    intervaloMinutos: dados.intervaloMinutos === undefined ? atual.intervaloMinutos : _inteiro(dados.intervaloMinutos, 1, 60, 'Intervalo de leitura'),
    limiteDiario: dados.limiteDiario === undefined ? atual.limiteDiario : _inteiro(dados.limiteDiario, 0, 1000000, 'Limite diário'),
    processamentosSimultaneos: dados.processamentosSimultaneos === undefined ? atual.processamentosSimultaneos : _inteiro(dados.processamentosSimultaneos, 1, 10, 'Processamentos simultâneos'),
    usuarioSoftexpert: dados.usuarioSoftexpert === undefined ? atual.usuarioSoftexpert : (String(dados.usuarioSoftexpert ?? '').trim() || null),
    somenteChamados: dados.somenteChamados === undefined ? atual.somenteChamados : _listaChamados(dados.somenteChamados),
  };
  if (!MODOS.includes(novo.modo)) throw Object.assign(new Error('Modo inválido.'), { status: 400 });
  if (novo.usuarioSoftexpert && !/^\d{1,10}$/.test(novo.usuarioSoftexpert)) throw Object.assign(new Error('Código do usuário da Jade inválido (use o CDUSER numérico).'), { status: 400 });
  if (novo.somenteChamados.length > 20 || novo.somenteChamados.some(n => !/^\d{1,10}$/.test(n))) {
    throw Object.assign(new Error('Chamados permitidos: informe até 20 números, separados por vírgula.'), { status: 400 });
  }
  getDB().prepare(`INSERT INTO jade_pa_config (empresa_id, fonte_id, ativo, modo, devolucao_ativa, intervalo_minutos, limite_diario, processamentos_simultaneos, usuario_softexpert, somente_chamados, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (empresa_id, fonte_id) DO UPDATE SET ativo = excluded.ativo, modo = excluded.modo, devolucao_ativa = excluded.devolucao_ativa,
      intervalo_minutos = excluded.intervalo_minutos, limite_diario = excluded.limite_diario,
      processamentos_simultaneos = excluded.processamentos_simultaneos, usuario_softexpert = excluded.usuario_softexpert,
      somente_chamados = excluded.somente_chamados, atualizado_em = excluded.atualizado_em`)
    .run(Number(empresaId), fonteId, novo.ativo ? 1 : 0, novo.modo, novo.devolucaoAtiva ? 1 : 0, novo.intervaloMinutos, novo.limiteDiario, novo.processamentosSimultaneos,
      novo.usuarioSoftexpert, novo.somenteChamados.length ? novo.somenteChamados.join(',') : null, new Date().toISOString());
  // Contador da tela: ligar agenda a leitura para já; mudar o intervalo recomeça a contagem.
  const agora = Date.now();
  const proximo = novo.ativo && !atual.ativo ? agora
    : novo.intervaloMinutos !== atual.intervaloMinutos ? agora + novo.intervaloMinutos * 60000 : null;
  if (proximo !== null) {
    getDB().prepare('UPDATE jade_pa_config SET proximo_ciclo_em = ? WHERE empresa_id = ? AND fonte_id = ?')
      .run(new Date(proximo).toISOString(), Number(empresaId), fonteId);
  }
  return getConfig(empresaId, fonteId);
}

function listarConfigsAtivas() {
  return getDB().prepare('SELECT * FROM jade_pa_config WHERE ativo = 1').all().map(r => _config(r));
}

/**
 * Trava o ciclo da fonte no BANCO (vale entre processos): só um processo
 * roda o ciclo, e só quando chegou a hora agendada (proximo_ciclo_em; sem
 * agenda, o intervalo desde o último). `forcar` ignora a agenda — botão
 * "Executar agora". Trava vencida (processo caiu no meio) é retomada.
 */
function tentarTravarCiclo(empresaId, fonteId, { travaMs, forcar = false, agora = new Date() }) {
  const cfg = getConfig(empresaId, fonteId);
  const agoraIso = agora.toISOString();
  const limiteIntervalo = forcar ? agoraIso : new Date(agora.getTime() - cfg.intervaloMinutos * 60000).toISOString();
  const r = getDB().prepare(`UPDATE jade_pa_config SET ciclo_trava_ate = ?
    WHERE empresa_id = ? AND fonte_id = ? AND ativo = 1
      AND (ciclo_trava_ate IS NULL OR ciclo_trava_ate < ?)
      AND (? = 1 OR proximo_ciclo_em <= ?
        OR (proximo_ciclo_em IS NULL AND (ultimo_ciclo_em IS NULL OR ultimo_ciclo_em <= ?)))`)
    .run(new Date(agora.getTime() + travaMs).toISOString(), Number(empresaId), fonteId, agoraIso, forcar ? 1 : 0, agoraIso, limiteIntervalo);
  return r.changes === 1;
}

/** Estende a trava do ciclo em andamento (chamada a cada chamado tratado). */
function renovarTrava(empresaId, fonteId, travaMs) {
  getDB().prepare('UPDATE jade_pa_config SET ciclo_trava_ate = ? WHERE empresa_id = ? AND fonte_id = ? AND ciclo_trava_ate IS NOT NULL')
    .run(new Date(Date.now() + travaMs).toISOString(), Number(empresaId), fonteId);
}

function liberarCiclo(empresaId, fonteId, resumo) {
  const agora = Date.now();
  const proximo = new Date(agora + getConfig(empresaId, fonteId).intervaloMinutos * 60000).toISOString();
  getDB().prepare('UPDATE jade_pa_config SET ciclo_trava_ate = NULL, ultimo_ciclo_em = ?, ultimo_ciclo_resumo = ?, proximo_ciclo_em = ? WHERE empresa_id = ? AND fonte_id = ?')
    .run(new Date(agora).toISOString(), JSON.stringify(resumo || {}), proximo, Number(empresaId), fonteId);
}

// ── Lotes: cada leitura que tratou chamado ou teve erro ────────────────────
function criarLote(empresaId, fonteId, origem) {
  return Number(getDB().prepare('INSERT INTO jade_pa_lotes (empresa_id, fonte_id, origem, inicio) VALUES (?, ?, ?, ?)')
    .run(Number(empresaId), fonteId, origem, new Date().toISOString()).lastInsertRowid);
}

/** Fecha o lote; leitura sem registro e sem erro não fica gravada (evita centenas de lotes vazios por dia). */
function finalizarLote(loteId, resumo) {
  const temRegistro = getDB().prepare('SELECT 1 FROM jade_pa_eventos WHERE lote_id = ? LIMIT 1').get(loteId);
  if (!temRegistro && !(resumo?.erros || []).length) {
    getDB().prepare('DELETE FROM jade_pa_lotes WHERE id = ?').run(loteId);
    return false;
  }
  getDB().prepare('UPDATE jade_pa_lotes SET fim = ?, duracao_ms = ?, resumo = ? WHERE id = ?')
    .run(resumo.fim, resumo.duracaoMs ?? null, JSON.stringify(resumo), loteId);
  return true;
}

const _PESO = { erro: 3, aviso: 2, ok: 1, info: 0 };

/** Lotes mais recentes da fonte, cada um com os chamados que tocou e o pior resultado neles. */
function listarLotes(empresaId, fonteId, { limite = 30 } = {}) {
  const lotes = getDB().prepare('SELECT * FROM jade_pa_lotes WHERE empresa_id = ? AND fonte_id = ? ORDER BY id DESC LIMIT ?')
    .all(Number(empresaId), fonteId, limite);
  if (!lotes.length) return [];
  const ids = lotes.map(l => l.id);
  const eventos = getDB().prepare(`SELECT lote_id, execucao_id, situacao, resumo, momento FROM jade_pa_eventos
    WHERE lote_id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`).all(...ids);
  const porLote = new Map(ids.map(id => [id, new Map()]));
  for (const e of eventos) {
    const chamados = porLote.get(e.lote_id);
    const atual = chamados.get(e.execucao_id) || { execucaoId: e.execucao_id, situacao: 'info', registros: 0 };
    if (_PESO[e.situacao] > _PESO[atual.situacao]) atual.situacao = e.situacao;
    atual.registros++;
    atual.ultimoRegistro = e.resumo;
    atual.ultimoEm = e.momento;
    chamados.set(e.execucao_id, atual);
  }
  return lotes.map((l) => {
    let resumo = null;
    try { resumo = l.resumo ? JSON.parse(l.resumo) : null; } catch (_) { resumo = null; }
    const chamados = [...porLote.get(l.id).values()].map(c => ({ ...c, execucao: getExecucao(c.execucaoId) })).filter(c => c.execucao);
    return { id: l.id, origem: l.origem, inicio: l.inicio, fim: l.fim, duracaoMs: l.duracao_ms, resumo, chamados };
  });
}

/** Lote em andamento (trava do ciclo ainda válida), para o contador da tela. */
function loteEmAndamento(empresaId, fonteId) {
  const cfg = getConfig(empresaId, fonteId);
  if (!cfg.cicloTravaAte || cfg.cicloTravaAte < new Date().toISOString()) return null;
  const l = getDB().prepare('SELECT id, inicio, origem FROM jade_pa_lotes WHERE empresa_id = ? AND fonte_id = ? AND fim IS NULL ORDER BY id DESC LIMIT 1')
    .get(Number(empresaId), fonteId);
  return l ? { id: l.id, inicio: l.inicio, origem: l.origem } : { id: null, inicio: null, origem: null };
}

/** Chamados tratados antes dos lotes existirem (nenhum registro com lote). */
function listarExecucoesSemLote(empresaId, fonteId, { limite = 100 } = {}) {
  return getDB().prepare(`SELECT x.* FROM jade_pa_execucoes x WHERE x.empresa_id = ? AND x.fonte_id = ?
      AND NOT EXISTS (SELECT 1 FROM jade_pa_eventos e WHERE e.execucao_id = x.id AND e.lote_id IS NOT NULL)
    ORDER BY x.detectado_em DESC LIMIT ?`).all(Number(empresaId), fonteId, limite).map(_execucao);
}

function _execucao(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, fonteId: row.fonte_id, numeroChamado: row.numero_chamado, chamadoId: row.chamado_id,
    atendimentoId: row.atendimento_id, mensagemAnaliseId: row.mensagem_analise_id, estado: row.estado, decisao: row.decisao,
    motivo: row.motivo, textoCliente: row.texto_cliente, tentativasGeracao: row.tentativas_geracao,
    tentativasPublicacao: row.tentativas_publicacao, tentativasDevolucao: row.tentativas_devolucao, ultimoErro: row.ultimo_erro,
    alerta: row.alerta === 1, detectadoEm: row.detectado_em, geradoEm: row.gerado_em, publicadoEm: row.publicado_em,
    devolvidoEm: row.devolvido_em, atualizadoEm: row.atualizado_em,
  };
}

/** Registra o chamado detectado. Devolve false se a Jade já o registrou antes (qualquer estado). */
/** Registra o chamado na fila; devolve o id novo, ou null se ele já existia. */
function registrarDetectado(empresaId, fonteId, numeroChamado) {
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();
  const r = getDB().prepare(`INSERT OR IGNORE INTO jade_pa_execucoes (id, empresa_id, fonte_id, numero_chamado, estado, detectado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 'detectado', ?, ?)`).run(id, Number(empresaId), fonteId, String(numeroChamado), agora, agora);
  return r.changes === 1 ? id : null;
}

/** Trilha de auditoria: uma linha por etapa/tentativa, na ordem em que aconteceu. */
function registrarEvento(execucaoId, empresaId, { etapa, situacao, resumo, detalhes = null, loteId = null }) {
  getDB().prepare(`INSERT INTO jade_pa_eventos (execucao_id, empresa_id, etapa, situacao, resumo, detalhes, momento, lote_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(execucaoId, Number(empresaId), etapa, situacao, String(resumo),
    detalhes ? JSON.stringify(detalhes) : null, new Date().toISOString(), loteId);
}

function listarEventos(empresaId, execucaoId) {
  return getDB().prepare('SELECT * FROM jade_pa_eventos WHERE empresa_id = ? AND execucao_id = ? ORDER BY id').all(Number(empresaId), execucaoId)
    .map((r) => {
      let detalhes = null;
      try { detalhes = r.detalhes ? JSON.parse(r.detalhes) : null; } catch (_) { detalhes = null; }
      return { id: r.id, etapa: r.etapa, situacao: r.situacao, resumo: r.resumo, detalhes, momento: r.momento, loteId: r.lote_id ?? null };
    });
}

function contarDetectadosDesde(empresaId, desdeIso) {
  return getDB().prepare('SELECT COUNT(*) AS n FROM jade_pa_execucoes WHERE empresa_id = ? AND detectado_em >= ?').get(Number(empresaId), desdeIso).n;
}

/** Pendentes de geração, mais antigos primeiro; "gerando" parado há mais de `gerandoParadoMs` volta à fila. */
function listarParaGerar(empresaId, fonteId, { limite = -1, gerandoParadoMs }) {
  const parado = new Date(Date.now() - gerandoParadoMs).toISOString();
  return getDB().prepare(`SELECT * FROM jade_pa_execucoes WHERE empresa_id = ? AND fonte_id = ?
      AND (estado = 'detectado' OR (estado = 'gerando' AND atualizado_em < ?))
    ORDER BY detectado_em LIMIT ?`).all(Number(empresaId), fonteId, parado, limite).map(_execucao);
}

/** Marca "gerando" e conta a tentativa; false se outro processo já pegou. */
function marcarGerando(id, estadoAnterior, atualizadoAnterior) {
  const r = getDB().prepare(`UPDATE jade_pa_execucoes SET estado = 'gerando', tentativas_geracao = tentativas_geracao + 1, atualizado_em = ?
    WHERE id = ? AND estado = ? AND atualizado_em = ?`).run(new Date().toISOString(), id, estadoAnterior, atualizadoAnterior);
  return r.changes === 1;
}

/** Prontos para enviar e envios/devoluções ainda não confirmados, mais antigos primeiro. */
function listarParaEnviar(empresaId, fonteId, { limite = -1 } = {}) {
  return getDB().prepare(`SELECT * FROM jade_pa_execucoes WHERE empresa_id = ? AND fonte_id = ?
      AND estado IN ('pronto', 'publicando', 'devolvendo')
    ORDER BY detectado_em LIMIT ?`).all(Number(empresaId), fonteId, limite).map(_execucao);
}

/**
 * Reserva uma tentativa de envio (publicacao | devolucao) antes de falar com o
 * SoftExpert. Só reserva se estado e contador ainda são os que foram lidos:
 * cada reserva soma 1 ao contador, então a mesma leitura nunca reserva duas
 * vezes (ex.: dois processos com a trava de ciclo vencida) — devolve null.
 */
function contarTentativa(id, tipo, novoEstado, { estadoAnterior, tentativasAnteriores }) {
  const coluna = tipo === 'devolucao' ? 'tentativas_devolucao' : 'tentativas_publicacao';
  const r = getDB().prepare(`UPDATE jade_pa_execucoes SET estado = ?, ${coluna} = ${coluna} + 1, atualizado_em = ?
    WHERE id = ? AND estado = ? AND ${coluna} = ?`)
    .run(novoEstado, new Date().toISOString(), id, estadoAnterior, tentativasAnteriores);
  return r.changes === 1 ? getExecucao(id) : null;
}

/** Adiamento que não é falha (ex.: chat em uso): a tentativa de geração não conta. */
function devolverTentativaGeracao(id) {
  getDB().prepare('UPDATE jade_pa_execucoes SET tentativas_geracao = MAX(tentativas_geracao - 1, 0) WHERE id = ?').run(id);
}

const CAMPOS = {
  estado: 'estado', chamadoId: 'chamado_id', atendimentoId: 'atendimento_id', mensagemAnaliseId: 'mensagem_analise_id',
  decisao: 'decisao', motivo: 'motivo', textoCliente: 'texto_cliente', ultimoErro: 'ultimo_erro', geradoEm: 'gerado_em',
  publicadoEm: 'publicado_em', devolvidoEm: 'devolvido_em',
};

function atualizar(id, dados) {
  const sets = [];
  const valores = [];
  for (const [chave, coluna] of Object.entries(CAMPOS)) {
    if (dados[chave] === undefined) continue;
    sets.push(`${coluna} = ?`);
    valores.push(dados[chave]);
  }
  if (dados.alerta !== undefined) { sets.push('alerta = ?'); valores.push(dados.alerta ? 1 : 0); }
  sets.push('atualizado_em = ?');
  valores.push(new Date().toISOString(), id);
  getDB().prepare(`UPDATE jade_pa_execucoes SET ${sets.join(', ')} WHERE id = ?`).run(...valores);
  return getExecucao(id);
}

function getExecucao(id) {
  return _execucao(getDB().prepare('SELECT * FROM jade_pa_execucoes WHERE id = ?').get(id));
}

function listarExecucoes(empresaId, { limite = 100 } = {}) {
  return getDB().prepare('SELECT * FROM jade_pa_execucoes WHERE empresa_id = ? ORDER BY detectado_em DESC LIMIT ?')
    .all(Number(empresaId), Math.min(Number(limite) || 100, 500)).map(_execucao);
}

module.exports = {
  PADRAO, getConfig, salvarConfig, listarConfigsAtivas, tentarTravarCiclo, renovarTrava, liberarCiclo, criarLote, finalizarLote, listarLotes, loteEmAndamento, listarExecucoesSemLote,
  registrarDetectado, registrarEvento, listarEventos, contarDetectadosDesde, listarParaGerar, marcarGerando, listarParaEnviar, contarTentativa, devolverTentativaGeracao,
  atualizar, getExecucao, listarExecucoes,
};
