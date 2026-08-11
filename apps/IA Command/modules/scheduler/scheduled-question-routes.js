const crud = require('../database/crud');
const { requireRotina } = require('../permissions');
const { getEmpresaId } = require('../empresa-context');
const channels = require('../whatsapp/channel-store');
const store = require('./scheduled-question-store');
const runner = require('./scheduled-question-runner');
const executor = require('./scheduled-question-executor');

// Módulos Protheus com autorização granular por número (whatsapp_allowed_numbers) e com
// handler dedicado (SQL_HANDLERS em scheduled-question-runner.js). SQL fixo em módulos fora
// desta lista (ex: SoftExpert) roda pelo caminho genérico (_executarSqlFixoGenerico), que usa
// a conexão do próprio sistema em vez de handler especializado, sem autorização por número.
const MODULOS_SQL_FIXO = new Set(['compras', 'financeiro', 'faturamento', 'comissao']);
const COLUNA_MODULO = {
  compras: 'modulo_compras',
  financeiro: 'modulo_financeiro',
  faturamento: 'modulo_faturamento',
  comissao: 'modulo_comissao',
};

function usuario(req) {
  return req.session?.username || req.session?.user || 'sistema';
}

function audit(req, acao, detalhes) {
  try {
    crud.criar('audit_log', {
      empresa_id: getEmpresaId(req),
      usuario: usuario(req),
      acao,
      detalhes: typeof detalhes === 'object' ? JSON.stringify(detalhes) : String(detalhes),
      ip: req.ip || req.socket?.remoteAddress || '',
    });
  } catch (_) {}
}

// Módulo do agendamento agora é qualquer módulo com intenção ai_text_to_sql ativa cadastrada
// para a empresa (Protheus ou não) — mesmo catálogo dinâmico usado no roteamento de sistema
// (system-router.js), evitando lista fixa por sistema que precisaria crescer a cada dataset novo.
function modulosDisponiveis(empresaId) {
  const intencoes = crud.listar('intentions', { empresa_id: empresaId, ativo: 1 });
  const modulos = new Set();
  for (const i of intencoes) {
    if (String(i.acao || '').toLowerCase() !== 'ai_text_to_sql') continue;
    if (i.modulo) modulos.add(String(i.modulo).trim().toLowerCase());
  }
  return modulos;
}

// Mesma fonte de modulosDisponiveis(), mas preservando o sistema (erp) de cada modulo, para o
// formulario de agendamento agrupar "Sistema" -> "Modulo" em cascata.
function modulosComErp(empresaId) {
  const intencoes = crud.listar('intentions', { empresa_id: empresaId, ativo: 1 });
  const porModulo = new Map();
  for (const i of intencoes) {
    if (String(i.acao || '').toLowerCase() !== 'ai_text_to_sql') continue;
    if (!i.modulo) continue;
    const modulo = String(i.modulo).trim().toLowerCase();
    const erp = String(i.erp || 'protheus').trim().toLowerCase() || 'protheus';
    if (!porModulo.has(modulo)) porModulo.set(modulo, erp);
  }
  return [...porModulo.entries()].map(([modulo, erp]) => ({ modulo, erp }));
}

function normalizarModulo(valor, empresaId) {
  const modulo = String(valor || '').trim().toLowerCase();
  if (!modulo) return null;
  return modulosDisponiveis(empresaId).has(modulo) ? modulo : null;
}

function validarIsoOuNull(valor, campo) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor);
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) {
    const err = new Error(`${campo} deve ser uma data/hora valida em ISO.`);
    err.statusCode = 400;
    throw err;
  }
  return texto;
}

function validarPayload(req, { parcial = false } = {}) {
  const body = req.body || {};
  const out = { ...body };

  if (!parcial || body.nome !== undefined) {
    out.nome = String(body.nome || '').trim();
    if (!out.nome) throw Object.assign(new Error('Campo obrigatorio: nome.'), { statusCode: 400 });
  }

  if (!parcial || body.pergunta !== undefined) {
    out.pergunta = String(body.pergunta || '').trim();
    if (!out.pergunta) throw Object.assign(new Error('Campo obrigatorio: pergunta.'), { statusCode: 400 });
  }

  if (!parcial || body.channel_id !== undefined) {
    out.channel_id = String(body.channel_id || '').trim();
    if (!out.channel_id) throw Object.assign(new Error('Campo obrigatorio: channel_id.'), { statusCode: 400 });
  }

  const empresaIdPayload = getEmpresaId(req);
  out.modulo = body.modulo === undefined ? undefined : normalizarModulo(body.modulo, empresaIdPayload);
  if (body.modulo && !out.modulo) {
    throw Object.assign(new Error('Modulo invalido. Cadastre uma intencao ai_text_to_sql com esse modulo antes de usa-lo no agendamento.'), { statusCode: 400 });
  }
  if (!parcial || body.sql_fixo !== undefined) {
    out.sql_fixo = String(body.sql_fixo || '').trim() || null;
  }
  if (out.sql_fixo && !out.modulo && !parcial) {
    throw Object.assign(new Error('Informe o modulo esperado para usar SQL fixo.'), { statusCode: 400 });
  }

  if (!parcial || body.schedule_tipo !== undefined || body.schedule?.tipo !== undefined) {
    out.schedule_tipo = String(body.schedule_tipo || body.schedule?.tipo || 'manual').trim().toLowerCase();
    if (!['manual', 'once', 'daily', 'weekly', 'monthly'].includes(out.schedule_tipo)) {
      throw Object.assign(new Error('Tipo de agenda invalido.'), { statusCode: 400 });
    }
  }
  if (!parcial || body.schedule_json !== undefined || body.schedule !== undefined) {
    out.schedule_json = body.schedule_json || body.schedule || {};
  }
  if (!parcial || body.next_run_at !== undefined) {
    out.next_run_at = validarIsoOuNull(body.next_run_at, 'next_run_at');
  }
  out.ativo = body.ativo !== undefined ? !!body.ativo : undefined;
  if (!parcial || body.status !== undefined || body.ativo !== undefined) {
    out.status = body.status || (out.ativo === false ? 'pausado' : 'ativo');
  }

  return out;
}

function validarCanalEmpresa(empresaId, channelId) {
  const channel = channels.buscarCanalDaEmpresa(channelId, empresaId);
  if (!channel) throw Object.assign(new Error('Canal WhatsApp nao encontrado para esta empresa.'), { statusCode: 400 });
  return channel;
}

function validarDestinatarios(empresaId, destinatarioIds, modulo = null) {
  const ids = [...new Set((destinatarioIds || [])
    .map(item => typeof item === 'object' && item ? (item.id || item.numero_id) : item)
    .map(String)
    .filter(Boolean))];
  if (!ids.length) throw Object.assign(new Error('Informe ao menos um destinatario autorizado.'), { statusCode: 400 });

  const rows = store.buscarNumerosAutorizadosPorIds(empresaId, ids);
  if (rows.length !== ids.length) {
    throw Object.assign(new Error('Um ou mais destinatarios nao pertencem aos numeros autorizados desta empresa.'), { statusCode: 400 });
  }

  // Autorização granular por número (whatsapp_allowed_numbers.modulo_*) só existe para os
  // módulos Protheus legados. Módulos de outros sistemas (ex: chamados/SoftExpert) não têm
  // essa coluna — qualquer destinatário autorizado da empresa pode recebê-los.
  if (modulo && MODULOS_SQL_FIXO.has(modulo)) {
    const autorizadosComModulo = store.listarNumerosAutorizados(empresaId)
      .filter(row => ids.includes(String(row.id)))
      .filter(row => Number(row[COLUNA_MODULO[modulo]] || 0) === 1);
    if (autorizadosComModulo.length !== ids.length) {
      throw Object.assign(new Error(`Um ou mais destinatarios nao possuem permissao para o modulo ${modulo}.`), { statusCode: 400 });
    }
  }

  return rows;
}

function handleRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Erro inesperado.' });
    }
  };
}

module.exports = function registrarRotasAgendamento(app, { requireAuth, requireIaCommand }) {
  const canAgendamento = requireRotina('iac-admin-agendamento');

  app.get('/api/ia-command/admin/agendamento/jobs', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    res.json(store.listarJobs(getEmpresaId(req)));
  }));

  app.get('/api/ia-command/admin/agendamento/jobs/:id', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const job = store.buscarJob(getEmpresaId(req), req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nao encontrado.' });
    res.json(job);
  }));

  app.get('/api/ia-command/admin/agendamento/modulos-disponiveis', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const empresaId = getEmpresaId(req);
    const modulos = modulosComErp(empresaId).sort((a, b) => a.modulo.localeCompare(b.modulo));
    res.json(modulos.map((m) => ({ modulo: m.modulo, erp: m.erp, sql_fixo: MODULOS_SQL_FIXO.has(m.modulo) })));
  }));

  app.post('/api/ia-command/admin/agendamento/jobs', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const empresaId = getEmpresaId(req);
    const payload = validarPayload(req);
    validarCanalEmpresa(empresaId, payload.channel_id);
    const destinatarios = validarDestinatarios(empresaId, req.body?.destinatarios || req.body?.destinatario_ids, payload.modulo);
    const row = store.criarJob(empresaId, payload, destinatarios, usuario(req));
    audit(req, 'criar_job_agendamento', { id: row.id, nome: row.nome, destinatarios: destinatarios.length });
    res.status(201).json(row);
  }));

  app.put('/api/ia-command/admin/agendamento/jobs/:id', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const empresaId = getEmpresaId(req);
    const existing = store.buscarJob(empresaId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Job nao encontrado.' });
    const payload = validarPayload(req, { parcial: true });
    validarCanalEmpresa(empresaId, payload.channel_id || existing.channel_id);
    const modulo = payload.modulo === undefined ? existing.modulo : payload.modulo;
    const sqlFixo = payload.sql_fixo === undefined ? existing.sql_fixo : payload.sql_fixo;
    if (sqlFixo && !modulo) {
      throw Object.assign(new Error('Informe o modulo esperado para usar SQL fixo.'), { statusCode: 400 });
    }
    const destinatarios = (req.body?.destinatarios || req.body?.destinatario_ids)
      ? validarDestinatarios(empresaId, req.body.destinatarios || req.body.destinatario_ids, modulo)
      : undefined;
    const row = store.atualizarJob(empresaId, req.params.id, payload, destinatarios, usuario(req));
    audit(req, 'editar_job_agendamento', { id: req.params.id, campos: Object.keys(req.body || {}) });
    res.json(row);
  }));

  app.post('/api/ia-command/admin/agendamento/jobs/:id/status', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const empresaId = getEmpresaId(req);
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['ativo', 'pausado'].includes(status)) {
      return res.status(400).json({ error: 'Status invalido. Use ativo ou pausado.' });
    }
    const row = store.alterarStatus(empresaId, req.params.id, { ativo: status === 'ativo', status }, usuario(req));
    if (!row) return res.status(404).json({ error: 'Job nao encontrado.' });
    audit(req, 'status_job_agendamento', { id: req.params.id, status });
    res.json(row);
  }));

  app.post('/api/ia-command/admin/agendamento/jobs/:id/run-now', requireAuth, requireIaCommand, canAgendamento, handleRoute(async (req, res) => {
    const empresaId = getEmpresaId(req);
    const job = store.buscarJob(empresaId, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nao encontrado.' });
    validarCanalEmpresa(empresaId, job.channel_id);
    const run = await runner.executarJob(empresaId, job, { trigger_tipo: 'manual', usuario: usuario(req) });
    audit(req, 'executar_job_agendamento_agora', { id: req.params.id, run_id: run?.id, status: run?.status });
    res.json(run);
  }));

  app.get('/api/ia-command/admin/agendamento/executor/status', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    res.json(executor.status());
  }));

  app.post('/api/ia-command/admin/agendamento/executor/start', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const status = executor.start();
    audit(req, 'iniciar_executor_agendamento', status);
    res.json(status);
  }));

  app.post('/api/ia-command/admin/agendamento/executor/stop', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const status = executor.stop();
    audit(req, 'parar_executor_agendamento', status);
    res.json(status);
  }));

  app.post('/api/ia-command/admin/agendamento/executor/tick', requireAuth, requireIaCommand, canAgendamento, handleRoute(async (req, res) => {
    const result = await executor.tick();
    audit(req, 'executar_tick_agendamento', result);
    res.json({ ...executor.status(), tick: result });
  }));

  app.delete('/api/ia-command/admin/agendamento/jobs/:id', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const result = store.excluirJob(getEmpresaId(req), req.params.id, usuario(req));
    if (!result) return res.status(404).json({ error: 'Job nao encontrado.' });
    audit(req, 'excluir_job_agendamento', { id: req.params.id, historico_removido: result.historico_removido || 0 });
    res.json(result);
  }));

  app.get('/api/ia-command/admin/agendamento/jobs/:id/runs', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const empresaId = getEmpresaId(req);
    const job = store.buscarJob(empresaId, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nao encontrado.' });
    res.json(store.listarRuns(empresaId, req.params.id, req.query.limit));
  }));

  app.get('/api/ia-command/admin/agendamento/runs', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const empresaId = getEmpresaId(req);
    if (req.query.job_id) {
      const job = store.buscarJob(empresaId, req.query.job_id);
      if (!job) return res.status(404).json({ error: 'Job nao encontrado.' });
    }
    res.json(store.listarRunsGerais(empresaId, {
      jobId: req.query.job_id || null,
      limit: req.query.limit,
    }));
  }));

  app.post('/api/ia-command/admin/agendamento/runs/excluir-selecionados', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um ID para excluir.' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Maximo de 200 registros por operacao.' });
    }
    const removidos = store.excluirRunsPorIds(getEmpresaId(req), ids);
    audit(req, 'excluir_execucoes_agendamento_selecionadas', { ids, removidos });
    res.json({ ok: true, removidos });
  }));

  app.post('/api/ia-command/admin/agendamento/runs/limpar', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    const empresaId = getEmpresaId(req);
    const modo = String(req.body?.modo || 'periodo').trim().toLowerCase();
    const dataInicio = String(req.body?.data_inicio || '').trim();
    const dataFim = String(req.body?.data_fim || '').trim();
    const jobId = String(req.body?.job_id || '').trim() || null;

    if (jobId && !store.buscarJob(empresaId, jobId)) {
      return res.status(404).json({ error: 'Job nao encontrado.' });
    }
    const jobAntes = jobId ? store.buscarJob(empresaId, jobId) : null;

    let inicio = null;
    let fim = null;
    if (modo !== 'total') {
      if (!dataInicio || !dataFim) {
        return res.status(400).json({ error: 'Informe data inicial e data final.' });
      }
      if (dataInicio > dataFim) {
        return res.status(400).json({ error: 'Data inicial nao pode ser maior que a data final.' });
      }
      inicio = `${dataInicio}T00:00:00.000`;
      fim = `${dataFim}T23:59:59.999`;
    }

    const removidos = store.limparRuns(empresaId, { inicio, fim, jobId });
    const jobDepois = jobId ? store.buscarJob(empresaId, jobId) : null;
    if (jobAntes && !jobDepois) {
      throw Object.assign(new Error('Protecao acionada: a limpeza do historico nao pode remover o cadastro do job.'), { statusCode: 500 });
    }
    audit(req, 'limpar_execucoes_agendamento', {
      modo,
      data_inicio: dataInicio || null,
      data_fim: dataFim || null,
      job_id: jobId,
      removidos,
    });
    res.json({ ok: true, removidos, job_preservado: jobId ? !!jobDepois : null });
  }));

  app.get('/api/ia-command/admin/agendamento/runs/:id/deliveries', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    res.json(store.listarEntregas(getEmpresaId(req), req.params.id));
  }));

  app.get('/api/ia-command/admin/agendamento/canais', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    res.json(channels.listarPorEmpresa(getEmpresaId(req)));
  }));

  app.get('/api/ia-command/admin/agendamento/destinatarios', requireAuth, requireIaCommand, canAgendamento, handleRoute((req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    // Filtro por autorização de módulo só existe para os 4 módulos Protheus (whatsapp_allowed_numbers
    // não tem coluna de autorização por módulo de outros sistemas); para os demais, lista todos.
    const moduloBruto = String(req.query.modulo || '').trim().toLowerCase();
    const modulo = MODULOS_SQL_FIXO.has(moduloBruto) ? moduloBruto : null;
    let rows = store.listarNumerosAutorizados(getEmpresaId(req));
    if (modulo) rows = rows.filter(row => Number(row[COLUNA_MODULO[modulo]] || 0) === 1);
    res.json(rows);
  }));
};
