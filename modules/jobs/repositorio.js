// Acesso ao banco do serviço de jobs. Toda função recebe `agora` (Date) para os
// testes controlarem o relógio.
//
// Concessão (lease): só quem a tem roda o job/instância. Vale por um prazo
// curto e o supervisor a renova enquanto o processo filho vive; se o
// supervisor cai, ela vence sozinha e outro assume. A ficha (fencing token)
// cresce a cada concessão: renovar ou devolver com ficha antiga não tem efeito,
// então um supervisor "zumbi" não sobrescreve o trabalho de quem assumiu.
const { getDB } = require('./database');

const _iso = (d) => d.toISOString();
const TODAS = '*';
const MAX_LOG = 200 * 1024;

function _json(texto, padrao = null) {
  try { return texto ? JSON.parse(texto) : padrao; } catch (_) { return padrao; }
}

// ── Concessões ──────────────────────────────────────────────────────────────

/** Concessão do job/instância, ou null se outro a tem (ou se está esperando a retentativa). */
function tomarConcessao(jobId, instancia, dono, { duracaoMs, agora = new Date(), ignorarEspera = false }) {
  const db = getDB();
  return db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO jobs_concessoes (job_id, instancia) VALUES (?, ?)').run(jobId, instancia);
    const r = db.prepare(`UPDATE jobs_concessoes SET ficha = ficha + 1, dono = @dono, valida_ate = @ate, execucao_id = NULL
      WHERE job_id = @job AND instancia = @inst
        AND (valida_ate IS NULL OR valida_ate < @agora)
        AND (@ignorar = 1 OR aguardar_ate IS NULL OR aguardar_ate <= @agora)`)
      .run({ dono, ate: _iso(new Date(agora.getTime() + duracaoMs)), job: jobId, inst: instancia, agora: _iso(agora), ignorar: ignorarEspera ? 1 : 0 });
    if (r.changes !== 1) return null;
    return db.prepare('SELECT ficha FROM jobs_concessoes WHERE job_id = ? AND instancia = ?').get(jobId, instancia).ficha;
  }).immediate();
}

/** Estende a concessão. false = a ficha não é mais a vigente (outro assumiu). */
function renovarConcessao(jobId, instancia, ficha, { duracaoMs, agora = new Date() }) {
  return getDB().prepare('UPDATE jobs_concessoes SET valida_ate = ? WHERE job_id = ? AND instancia = ? AND ficha = ? AND valida_ate IS NOT NULL')
    .run(_iso(new Date(agora.getTime() + duracaoMs)), jobId, instancia, ficha).changes === 1;
}

/**
 * Libera a concessão ao fim da execução. Falha soma em falhas_seguidas e marca
 * a espera da próxima tentativa (`esperaMs`); sucesso zera as duas.
 */
function devolverConcessao(jobId, instancia, ficha, { falhou, esperaMs = 0, agora = new Date() }) {
  return getDB().prepare(`UPDATE jobs_concessoes SET valida_ate = NULL, dono = NULL,
      falhas_seguidas = CASE WHEN @falhou = 1 THEN falhas_seguidas + 1 ELSE 0 END,
      aguardar_ate = CASE WHEN @falhou = 1 THEN @aguardar ELSE NULL END
    WHERE job_id = @job AND instancia = @inst AND ficha = @ficha`)
    .run({ falhou: falhou ? 1 : 0, aguardar: _iso(new Date(agora.getTime() + esperaMs)), job: jobId, inst: instancia, ficha }).changes === 1;
}

function falhasSeguidas(jobId, instancia) {
  return getDB().prepare('SELECT falhas_seguidas FROM jobs_concessoes WHERE job_id = ? AND instancia = ?').get(jobId, instancia)?.falhas_seguidas ?? 0;
}

/** Tela: situação de todas as concessões (falhas seguidas, espera da retentativa). */
function listarConcessoes() {
  return getDB().prepare('SELECT job_id AS jobId, instancia, dono, valida_ate AS validaAte, execucao_id AS execucaoId, falhas_seguidas AS falhasSeguidas, aguardar_ate AS aguardarAte FROM jobs_concessoes').all();
}

// ── Execuções ───────────────────────────────────────────────────────────────

function abrirExecucao({ jobId, instancia, ficha, origem, dono, empresaId = null, agora = new Date() }) {
  const db = getDB();
  const id = Number(db.prepare('INSERT INTO jobs_execucoes (job_id, instancia, ficha, origem, dono, empresa_id, inicio) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(jobId, instancia, ficha, origem, dono, empresaId, _iso(agora)).lastInsertRowid);
  db.prepare('UPDATE jobs_concessoes SET execucao_id = ? WHERE job_id = ? AND instancia = ? AND ficha = ?').run(id, jobId, instancia, ficha);
  return id;
}

function _cortarLog(log) {
  if (log == null) return null;
  const s = String(log);
  return s.length > MAX_LOG ? `[… início cortado …]\n${s.slice(-MAX_LOG)}` : s;
}

/** Log parcial da execução em andamento (a tela acompanha ao vivo). */
function salvarLogExecucao(id, log) {
  getDB().prepare('UPDATE jobs_execucoes SET log = ? WHERE id = ? AND fim IS NULL').run(_cortarLog(log), id);
}

function fecharExecucao(id, { resultado, erro = null, resumo = null, log, agora = new Date() }) {
  const db = getDB();
  const ex = db.prepare('SELECT inicio FROM jobs_execucoes WHERE id = ? AND fim IS NULL').get(id);
  if (!ex) return false;
  db.prepare('UPDATE jobs_execucoes SET fim = ?, duracao_ms = ?, resultado = ?, erro = ?, resumo = ?, log = COALESCE(?, log) WHERE id = ?')
    .run(_iso(agora), agora.getTime() - Date.parse(ex.inicio), resultado, erro ? String(erro).slice(0, 4000) : null,
      resumo == null ? null : JSON.stringify(resumo).slice(0, 20000), log === undefined ? null : _cortarLog(log), id);
  return true;
}

/**
 * Execuções sem fim cuja concessão venceu ou passou para outra ficha: o
 * processo que as rodava morreu (serviço derrubado, máquina reiniciada).
 * `excluirIds`: as que este supervisor ainda acompanha.
 */
function listarExecucoesOrfas({ agora = new Date(), excluirIds = [] } = {}) {
  return getDB().prepare(`SELECT e.id, e.job_id AS jobId, e.instancia, e.ficha, e.origem, e.empresa_id AS empresaId FROM jobs_execucoes e
      LEFT JOIN jobs_concessoes c ON c.job_id = e.job_id AND c.instancia = e.instancia
    WHERE e.fim IS NULL
      AND e.id NOT IN (SELECT value FROM json_each(?))
      AND (c.ficha IS NULL OR c.ficha <> e.ficha OR c.valida_ate IS NULL OR c.valida_ate < ?)`)
    .all(JSON.stringify(excluirIds), _iso(agora));
}

function _execucao(r, { comLog = false } = {}) {
  if (!r) return null;
  return {
    id: r.id, jobId: r.job_id, instancia: r.instancia, empresaId: r.empresa_id ?? null, origem: r.origem, dono: r.dono,
    inicio: r.inicio, fim: r.fim, duracaoMs: r.duracao_ms, resultado: r.resultado, erro: r.erro, resumo: _json(r.resumo),
    ...(comLog ? { log: r.log ?? '' } : {}),
  };
}

function ultimaExecucao(jobId, instancia) {
  return _execucao(getDB().prepare('SELECT * FROM jobs_execucoes WHERE job_id = ? AND instancia = ? ORDER BY id DESC LIMIT 1').get(jobId, instancia));
}

/** Última que terminou (a tela mostra a anterior enquanto uma nova roda). */
function ultimaExecucaoConcluida(jobId, instancia) {
  return _execucao(getDB().prepare('SELECT * FROM jobs_execucoes WHERE job_id = ? AND instancia = ? AND fim IS NOT NULL ORDER BY id DESC LIMIT 1').get(jobId, instancia));
}

function getExecucao(id) {
  return _execucao(getDB().prepare('SELECT * FROM jobs_execucoes WHERE id = ?').get(Number(id)), { comLog: true });
}

function listarExecucoesAbertas() {
  return getDB().prepare('SELECT * FROM jobs_execucoes WHERE fim IS NULL ORDER BY id').all().map(r => _execucao(r));
}

/** Histórico da tela, mais novo primeiro; paginação por `antesId`. 'falha' junta erro/timeout/interrompido. */
function listarExecucoes({ jobIds = null, jobId = null, instancia = null, empresaId = null, resultado = null, de = null, ate = null, antesId = null, limite = 100 } = {}) {
  const cond = [];
  const p = {};
  if (jobIds) { cond.push('job_id IN (SELECT value FROM json_each(@jobIds))'); p.jobIds = JSON.stringify(jobIds); }
  if (jobId) { cond.push('job_id = @jobId'); p.jobId = jobId; }
  if (instancia) { cond.push('instancia = @instancia'); p.instancia = instancia; }
  if (empresaId) { cond.push('empresa_id = @empresaId'); p.empresaId = Number(empresaId); }
  if (resultado === 'falha') cond.push("resultado IN ('erro', 'timeout', 'interrompido')");
  else if (resultado === 'andamento') cond.push('fim IS NULL');
  else if (resultado) { cond.push('resultado = @resultado'); p.resultado = resultado; }
  if (de) { cond.push('inicio >= @de'); p.de = de; }
  if (ate) { cond.push('inicio <= @ate'); p.ate = ate; }
  if (antesId) { cond.push('id < @antesId'); p.antesId = Number(antesId); }
  p.limite = Math.min(Math.max(Number(limite) || 100, 1), 500);
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return getDB().prepare(`SELECT * FROM jobs_execucoes ${where} ORDER BY id DESC LIMIT @limite`).all(p).map(r => _execucao(r));
}

/** Contagens desde `desde` (ISO): total e falhas, por job. */
function resumoExecucoes(desde) {
  return getDB().prepare(`SELECT job_id AS jobId, COUNT(*) AS total,
      SUM(CASE WHEN resultado IN ('erro', 'timeout', 'interrompido') THEN 1 ELSE 0 END) AS falhas
    FROM jobs_execucoes WHERE inicio >= ? GROUP BY job_id`).all(desde);
}

/**
 * Retenção: execuções com mais de `dias` saem; das vazias ficam só as últimas
 * `vaziasPorInstancia` (a vazia não diz nada além de "rodou"). Eventos: 90 dias.
 */
function podarHistorico({ agora = new Date(), dias = 30, vaziasPorInstancia = 50, diasEventos = 90 } = {}) {
  const db = getDB();
  const limite = _iso(new Date(agora.getTime() - dias * 86400000));
  const antigas = db.prepare('DELETE FROM jobs_execucoes WHERE fim IS NOT NULL AND inicio < ?').run(limite).changes;
  const vazias = db.prepare(`DELETE FROM jobs_execucoes WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id, instancia ORDER BY id DESC) AS n
        FROM jobs_execucoes WHERE resultado = 'vazio') WHERE n > ?)`).run(vaziasPorInstancia).changes;
  const pedidos = db.prepare('DELETE FROM jobs_pedidos WHERE atendido_em IS NOT NULL AND solicitado_em < ?').run(limite).changes;
  const eventos = db.prepare('DELETE FROM jobs_eventos WHERE momento < ?').run(_iso(new Date(agora.getTime() - diasEventos * 86400000))).changes;
  return { antigas, vazias, pedidos, eventos };
}

// ── Pedidos da tela (executar agora / encerrar) ─────────────────────────────

/**
 * Um pedido aberto por job/instância/tipo (encerrar: por execução): pedir de
 * novo devolve o mesmo.
 */
function criarPedido(jobId, instancia, { origem = 'manual', tipo = 'executar', alvoExecucaoId = null, solicitadoPor = null, agora = new Date() } = {}) {
  const db = getDB();
  return db.transaction(() => {
    const aberto = db.prepare(`SELECT id FROM jobs_pedidos WHERE job_id = ? AND instancia = ? AND tipo = ? AND atendido_em IS NULL
      AND (alvo_execucao_id IS ? OR alvo_execucao_id = ?)`).get(jobId, instancia, tipo, alvoExecucaoId, alvoExecucaoId);
    if (aberto) return aberto.id;
    return Number(db.prepare('INSERT INTO jobs_pedidos (job_id, instancia, origem, tipo, alvo_execucao_id, solicitado_por, solicitado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, instancia, origem, tipo, alvoExecucaoId, solicitadoPor, _iso(agora)).lastInsertRowid);
  }).immediate();
}

/** Pedido de execução aberto (o de encerrar não conta). */
function pedidoAberto(jobId, instancia) {
  const r = getDB().prepare("SELECT id, solicitado_em FROM jobs_pedidos WHERE job_id = ? AND instancia = ? AND tipo = 'executar' AND atendido_em IS NULL").get(jobId, instancia);
  return r ? { id: r.id, solicitadoEm: r.solicitado_em } : null;
}

function listarPedidosAbertos() {
  return getDB().prepare(`SELECT id, job_id AS jobId, instancia, origem, tipo, alvo_execucao_id AS alvoExecucaoId,
      solicitado_por AS solicitadoPor, solicitado_em AS solicitadoEm
    FROM jobs_pedidos WHERE atendido_em IS NULL ORDER BY id`).all();
}

function atenderPedido(id, { execucaoId = null, recusa = null, agora = new Date() } = {}) {
  return getDB().prepare('UPDATE jobs_pedidos SET atendido_em = ?, execucao_id = ?, recusa = ? WHERE id = ? AND atendido_em IS NULL')
    .run(_iso(agora), execucaoId, recusa, id).changes === 1;
}

// ── Configuração geral e controle por job/instância ─────────────────────────

// modo: onde os jobs rodam ('site' até alguém escolher o serviço na tela).
// alertaSemSinalMin também é o tempo para o site reassumir os jobs.
// Alertas em dois tipos, cada um com seus grupos (como Sem PA/Com PA da Jaade):
// falha = job com falhas seguidas e a volta ao normal; servico = sem sinal e a volta.
const CONFIG_PADRAO = { modo: 'site', maxSimultaneos: 20, alertaEmpresaId: null, alertaGruposFalha: [], alertaGruposServico: [], alertaFalhas: 3, alertaSemSinalMin: 5 };
const CHAVES_CONFIG = {
  modo: 'modo', maxSimultaneos: 'max_simultaneos', alertaEmpresaId: 'alerta_empresa_id',
  alertaGruposFalha: 'alerta_grupos_falha', alertaGruposServico: 'alerta_grupos_servico',
  alertaFalhas: 'alerta_falhas', alertaSemSinalMin: 'alerta_sem_sinal_min',
};

function getConfigJobs() {
  const linhas = getDB().prepare('SELECT chave, valor, atualizado_em, atualizado_por FROM jobs_config').all();
  const mapa = new Map(linhas.map(l => [l.chave, l]));
  const cfg = { ...CONFIG_PADRAO, alertaGruposFalha: [], alertaGruposServico: [] };
  for (const [campo, chave] of Object.entries(CHAVES_CONFIG)) {
    const l = mapa.get(chave);
    if (l && l.valor != null) cfg[campo] = _json(l.valor, cfg[campo]);
  }
  const ultima = linhas.sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))[0];
  cfg.atualizadoEm = ultima?.atualizado_em ?? null;
  cfg.atualizadoPor = ultima?.atualizado_por ?? null;
  return cfg;
}

/** Grava só os campos informados (validados por quem chama). */
function salvarConfigJobs(parcial, { usuario = null, agora = new Date() } = {}) {
  const db = getDB();
  const st = db.prepare(`INSERT INTO jobs_config (chave, valor, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?)
    ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`);
  db.transaction(() => {
    for (const [campo, chave] of Object.entries(CHAVES_CONFIG)) {
      if (parcial[campo] !== undefined) st.run(chave, JSON.stringify(parcial[campo]), _iso(agora), usuario);
    }
  })();
  return getConfigJobs();
}

function listarControles() {
  return getDB().prepare('SELECT job_id AS jobId, instancia, pausado, limite, atualizado_em AS atualizadoEm, atualizado_por AS atualizadoPor FROM jobs_controle').all()
    .map(c => ({ ...c, pausado: c.pausado === 1 }));
}

/** instancia '*' = o job inteiro (é onde fica o limite por job). */
function salvarControle(jobId, instancia, { pausado, limite }, { usuario = null, agora = new Date() } = {}) {
  const db = getDB();
  db.prepare(`INSERT INTO jobs_controle (job_id, instancia, pausado, limite, atualizado_em, atualizado_por) VALUES (@job, @inst, COALESCE(@pausado, 0), @limite, @agora, @usuario)
    ON CONFLICT (job_id, instancia) DO UPDATE SET
      pausado = COALESCE(@pausado, pausado),
      limite = CASE WHEN @mudaLimite = 1 THEN @limite ELSE limite END,
      atualizado_em = @agora, atualizado_por = @usuario`)
    .run({ job: jobId, inst: instancia, pausado: pausado === undefined ? null : (pausado ? 1 : 0), limite: limite ?? null, mudaLimite: limite === undefined ? 0 : 1, agora: _iso(agora), usuario });
}

/** Pausado pelo job inteiro ou pela instância. */
function pausa(jobId, instancia) {
  const r = getDB().prepare(`SELECT instancia, atualizado_por AS por, atualizado_em AS em FROM jobs_controle
    WHERE job_id = ? AND instancia IN (?, ?) AND pausado = 1 ORDER BY instancia = ? DESC LIMIT 1`).get(jobId, TODAS, instancia, TODAS);
  return r ? { doJob: r.instancia === TODAS, por: r.por, em: r.em } : null;
}

// ── Eventos (o que o serviço e as pessoas fizeram) ──────────────────────────

function registrarEvento({ nivel = 'info', tipo, jobId = null, instancia = null, empresaId = null, texto, usuario = null, agora = new Date() }) {
  getDB().prepare('INSERT INTO jobs_eventos (momento, nivel, tipo, job_id, instancia, empresa_id, texto, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(_iso(agora), nivel, tipo, jobId, instancia, empresaId, String(texto).slice(0, 4000), usuario);
}

function listarEventos({ jobIds = null, jobId = null, nivel = null, empresaId = null, de = null, ate = null, antesId = null, limite = 200 } = {}) {
  const cond = [];
  const p = {};
  // Eventos do serviço (sem job) aparecem em qualquer filtro de sistema.
  if (jobIds) { cond.push('(job_id IS NULL OR job_id IN (SELECT value FROM json_each(@jobIds)))'); p.jobIds = JSON.stringify(jobIds); }
  if (jobId) { cond.push('job_id = @jobId'); p.jobId = jobId; }
  if (nivel === 'problema') cond.push("nivel IN ('aviso', 'erro')");
  else if (nivel) { cond.push('nivel = @nivel'); p.nivel = nivel; }
  if (empresaId) { cond.push('empresa_id = @empresaId'); p.empresaId = Number(empresaId); }
  if (de) { cond.push('momento >= @de'); p.de = de; }
  if (ate) { cond.push('momento <= @ate'); p.ate = ate; }
  if (antesId) { cond.push('id < @antesId'); p.antesId = Number(antesId); }
  p.limite = Math.min(Math.max(Number(limite) || 200, 1), 500);
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return getDB().prepare(`SELECT id, momento, nivel, tipo, job_id AS jobId, instancia, empresa_id AS empresaId, texto, usuario
    FROM jobs_eventos ${where} ORDER BY id DESC LIMIT @limite`).all(p);
}

// ── Alertas (um por situação até ela normalizar) ────────────────────────────

/** true = abriu agora (quem abriu envia o alerta); false = já estava aberto. */
function abrirAlerta(chave, texto, { agora = new Date() } = {}) {
  return getDB().prepare('INSERT OR IGNORE INTO jobs_alertas (chave, aberto_em, texto) VALUES (?, ?, ?)').run(chave, _iso(agora), texto).changes === 1;
}

/** true = estava aberto (quem fechou avisa que normalizou). */
function fecharAlerta(chave) {
  return getDB().prepare('DELETE FROM jobs_alertas WHERE chave = ?').run(chave).changes === 1;
}

function listarAlertasAbertos() {
  return getDB().prepare('SELECT chave, aberto_em AS abertoEm, texto FROM jobs_alertas ORDER BY aberto_em').all();
}

// ── Batimento do serviço ────────────────────────────────────────────────────

function registrarBatimento(dono, { agora = new Date(), iniciando = false, parando = false } = {}) {
  getDB().prepare(`INSERT INTO jobs_servico (id, dono, iniciado_em, batimento_em, parando) VALUES (1, @dono, @agora, @agora, @parando)
    ON CONFLICT (id) DO UPDATE SET dono = @dono, batimento_em = @agora, parando = @parando,
      iniciado_em = CASE WHEN @iniciando = 1 OR iniciado_em IS NULL THEN @agora ELSE iniciado_em END`)
    .run({ dono, agora: _iso(agora), parando: parando ? 1 : 0, iniciando: iniciando ? 1 : 0 });
}

/** Encerramento limpo: o batimento some na hora, a tela não espera vencer. */
function registrarParada(dono, { agora = new Date() } = {}) {
  getDB().prepare('UPDATE jobs_servico SET batimento_em = NULL, parando = 0, parado_em = ? WHERE id = 1 AND dono = ?').run(_iso(agora), dono);
}

/** `ativo` = batimento mais novo que `toleranciaMs`. */
function estadoServico({ agora = new Date(), toleranciaMs = 30000 } = {}) {
  const r = getDB().prepare('SELECT dono, iniciado_em, batimento_em, parando, parado_em FROM jobs_servico WHERE id = 1').get();
  const batimento = r?.batimento_em ? Date.parse(r.batimento_em) : null;
  return {
    ativo: batimento != null && agora.getTime() - batimento <= toleranciaMs && r.parando !== 1,
    parando: r?.parando === 1,
    dono: r?.dono ?? null,
    iniciadoEm: r?.iniciado_em ?? null,
    batimentoEm: r?.batimento_em ?? null,
    paradoEm: r?.parado_em ?? null,
  };
}

module.exports = {
  TODAS,
  tomarConcessao, renovarConcessao, devolverConcessao, falhasSeguidas, listarConcessoes,
  abrirExecucao, salvarLogExecucao, fecharExecucao, listarExecucoesOrfas, ultimaExecucao, ultimaExecucaoConcluida, getExecucao, listarExecucoesAbertas,
  listarExecucoes, resumoExecucoes, podarHistorico,
  criarPedido, pedidoAberto, listarPedidosAbertos, atenderPedido,
  getConfigJobs, salvarConfigJobs, listarControles, salvarControle, pausa,
  registrarEvento, listarEventos,
  abrirAlerta, fecharAlerta, listarAlertasAbertos,
  registrarBatimento, registrarParada, estadoServico,
};
