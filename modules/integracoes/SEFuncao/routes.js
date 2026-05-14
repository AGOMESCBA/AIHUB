const db      = require('./database');
const path    = require('path');
const anDb    = require(path.join(__dirname, '..', '..', 'analisador-curriculos', 'database'));
const seApiDb = require(path.join(__dirname, '..', 'SEApiConfigurator', 'database'));
const engine  = require(path.join(__dirname, '..', 'SEApiConfigurator', 'engine'));

function _resolverEid(req) {
  const explicit = Number(req.body?.empresa_id || req.query?.empresa_id || 0);
  if (!explicit) return req.session.empresa_id;
  const { empresas: acesso, role } = req.session;
  const ok = role === 'admin' || acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(explicit));
  return ok ? explicit : req.session.empresa_id;
}

module.exports = function (app, { requireAuth, requireEmpresa, registrarLog }) {

  // ── Configuração ──────────────────────────────────────────────────────────────
  app.get('/api/integracoes/se-funcao/config', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.getConfig(_resolverEid(req)));
  });

  app.post('/api/integracoes/se-funcao/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { se_api_flow_id } = req.body;
    if (!se_api_flow_id)
      return res.status(400).json({ error: 'Selecione um flow para a integração de funções' });
    db.saveConfig(eid, {
      integration_source: 'flow',
      se_api_flow_id: Number(se_api_flow_id),
    });
    res.json({ ok: true });
  });

  // ── Flows disponíveis (para seleção na config) ────────────────────────────────
  app.get('/api/integracoes/se-funcao/flows', requireAuth, requireEmpresa, (req, res) => {
    const eid   = _resolverEid(req);
    const flows = seApiDb.listFlows(eid);
    res.json(flows.map(f => ({
      id:          f.id,
      nome:        f.nome,
      descricao:   f.descricao || '',
      steps_count: seApiDb.listFlowSteps(eid, f.id).length,
    })));
  });

  // ── Status mapa (funcao_id -> status) para os badges na grid ─────────────────
  app.get('/api/integracoes/se-funcao/status-mapa', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.getStatusMapa(_resolverEid(req)));
  });

  // ── Logs ──────────────────────────────────────────────────────────────────────
  app.get('/api/integracoes/se-funcao/logs', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { status, funcao_nome, data_inicio, data_fim, page, limit } = req.query;
    res.json(db.listLogs(eid, { status, funcao_nome, data_inicio, data_fim, page, limit }));
  });

  app.get('/api/integracoes/se-funcao/logs/:seq/steps', requireAuth, requireEmpresa, (req, res) => {
    const eid   = _resolverEid(req);
    const entry = db.getLogBySeq(eid, req.params.seq);
    if (!entry) return res.status(404).json({ error: 'Registro não encontrado' });
    if (!entry.se_api_log_ids || !entry.se_api_log_ids.length) return res.json([]);
    const logs = db.getSeApiLogsByIds(eid, entry.se_api_log_ids);
    res.json(logs.filter(l => l.tipo === 'flow_step').sort((a, b) => (a.step_ordem || 0) - (b.step_ordem || 0)));
  });

  // ── Enviar funções ao SE ──────────────────────────────────────────────────────
  app.post('/api/integracoes/se-funcao/enviar', requireAuth, requireEmpresa, async (req, res) => {
    const eid        = _resolverEid(req);
    const { funcao_ids } = req.body;
    if (!Array.isArray(funcao_ids) || !funcao_ids.length)
      return res.status(400).json({ error: 'funcao_ids deve ser um array não vazio' });

    const config = db.getConfig(eid);
    if (!config.se_api_flow_id)
      return res.status(400).json({ error: 'Flow não configurado. Acesse Integrações › SE Configurações.' });

    const flow = seApiDb.getFlow(eid, config.se_api_flow_id);
    if (!flow)
      return res.status(400).json({ error: `Flow ID ${config.se_api_flow_id} não encontrado. Verifique a configuração.` });

    const todasFuncoes = anDb.listFuncoes(eid);
    const resultados   = [];

    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Funções] Iniciando envio de ${funcao_ids.length} função(ões) — Flow "${flow.nome}"` });

    for (const fid of funcao_ids.map(Number)) {
      const funcao = todasFuncoes.find(f => f.id === fid);
      if (!funcao) {
        resultados.push({ id: fid, status: 'erro', mensagem: `Função ID ${fid} não encontrada` });
        db.saveLog(eid, {
          funcao_id: fid, funcao_nome: `(ID ${fid} não encontrado)`, funcao_area: '',
          status: 'erro', erro_mensagem: `Função ID ${fid} não encontrada na base de dados`,
          flow_id: config.se_api_flow_id, flow_nome: flow.nome, se_api_log_ids: [],
          duracao_ms: null, funcao_json: null,
          integration_source: 'flow', data_envio: new Date().toISOString(),
        });
        continue;
      }

      let flowResult;
      try {
        flowResult = await engine.executeFlow(seApiDb, eid, config.se_api_flow_id, { id: fid });
      } catch (err) {
        db.saveLog(eid, {
          funcao_id: fid, funcao_nome: funcao.nome || '—', funcao_area: funcao.area || '',
          status: 'erro', erro_mensagem: err.message || 'Erro ao executar flow',
          flow_id: config.se_api_flow_id, flow_nome: flow.nome, se_api_log_ids: [],
          duracao_ms: null, funcao_json: funcao,
          integration_source: 'flow', data_envio: new Date().toISOString(),
        });
        resultados.push({ id: fid, nome: funcao.nome, status: 'erro', mensagem: err.message });
        registrarLog({ timestamp: new Date().toISOString(), type: 'error',
          message: `[SE Funções] ✗ Flow erro ${funcao.nome || fid}: ${err.message}` });
        continue;
      }

      const stepLogIds = [];
      for (const step of flowResult.steps) {
        const sl = seApiDb.saveLog(eid, {
          tipo: 'flow_step',
          flow_id:     flowResult.flow_id,
          flow_nome:   flowResult.flow_nome,
          step_ordem:  step.step_ordem,
          config_id:   step.config_id,
          config_nome: step.config_nome || `Config ${step.config_id}`,
          status:      step.status,
          erro:        step.erro        || null,
          duracao_ms:  step.duracao_ms  ?? null,
          xml_enviado: step.xml_enviado || null,
          status_code: step.status_code || null,
          resposta:    step.body        || null,
          funcao_id:   fid,
          funcao_nome: funcao.nome || '—',
        });
        stepLogIds.push(sl.id);
      }

      const stepsOk   = flowResult.steps.filter(s => s.status === 'sucesso').length;
      const stepsFail = flowResult.steps.filter(s => s.status !== 'sucesso').length;
      const status    = stepsOk > 0 && stepsFail > 0 ? 'parcial'
                      : stepsOk > 0                  ? 'sucesso'
                      :                                'erro';

      db.saveLog(eid, {
        funcao_id: fid, funcao_nome: funcao.nome || '—', funcao_area: funcao.area || '',
        status,
        erro_mensagem: status !== 'sucesso'
          ? (flowResult.steps.find(s => s.status !== 'sucesso')?.erro || 'Erro em um ou mais steps')
          : null,
        flow_id:        flowResult.flow_id,
        flow_nome:      flowResult.flow_nome,
        se_api_log_ids: stepLogIds,
        duracao_ms:     flowResult.steps.reduce((s, x) => s + (x.duracao_ms || 0), 0),
        funcao_json:    funcao,
        integration_source: 'flow',
        data_envio: new Date().toISOString(),
      });

      resultados.push({ id: fid, nome: funcao.nome, status });
      registrarLog({ timestamp: new Date().toISOString(), type: status === 'erro' ? 'error' : 'info',
        message: `[SE Funções] ${status === 'sucesso' ? '✓' : status === 'parcial' ? '⚠' : '✗'} ${funcao.nome || fid} — Flow "${flowResult.flow_nome}" (${stepsOk}/${flowResult.steps.length} steps ok)` });
    }

    const sucesso = resultados.filter(r => r.status === 'sucesso').length;
    const parcial = resultados.filter(r => r.status === 'parcial').length;
    const erros   = resultados.filter(r => r.status === 'erro').length;
    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Funções] Concluído — ${sucesso} ok, ${parcial} parcial, ${erros} erros` });

    res.json({ resultados, sucesso, parcial, erros, total: funcao_ids.length });
  });

  // ── Reenviar função específica ────────────────────────────────────────────────
  app.post('/api/integracoes/se-funcao/reenviar', requireAuth, requireEmpresa, async (req, res) => {
    const eid        = _resolverEid(req);
    const { funcao_id } = req.body;
    if (!funcao_id) return res.status(400).json({ error: 'funcao_id é obrigatório' });

    const funcao = anDb.listFuncoes(eid).find(f => f.id === Number(funcao_id));
    if (!funcao) return res.status(404).json({ error: 'Função não encontrada' });

    const config = db.getConfig(eid);
    if (!config.se_api_flow_id)
      return res.status(400).json({ error: 'Flow não configurado' });

    let flowResult;
    try {
      flowResult = await engine.executeFlow(seApiDb, eid, config.se_api_flow_id, { id: Number(funcao_id) });
    } catch (err) {
      db.saveLog(eid, {
        funcao_id: funcao.id, funcao_nome: funcao.nome || '—', funcao_area: funcao.area || '',
        status: 'erro', erro_mensagem: err.message || 'Erro ao executar flow',
        flow_id: config.se_api_flow_id, flow_nome: null, se_api_log_ids: [],
        duracao_ms: null, funcao_json: funcao,
        integration_source: 'flow', data_envio: new Date().toISOString(),
      });
      return res.status(500).json({ error: err.message });
    }

    const stepLogIds = [];
    for (const step of flowResult.steps) {
      const sl = seApiDb.saveLog(eid, {
        tipo: 'flow_step', flow_id: flowResult.flow_id, flow_nome: flowResult.flow_nome,
        step_ordem: step.step_ordem, config_id: step.config_id,
        config_nome: step.config_nome || `Config ${step.config_id}`,
        status: step.status, erro: step.erro || null, duracao_ms: step.duracao_ms ?? null,
        xml_enviado: step.xml_enviado || null, status_code: step.status_code || null,
        resposta: step.body || null, funcao_id: funcao.id, funcao_nome: funcao.nome || '—',
      });
      stepLogIds.push(sl.id);
    }

    const stepsOk   = flowResult.steps.filter(s => s.status === 'sucesso').length;
    const stepsFail = flowResult.steps.filter(s => s.status !== 'sucesso').length;
    const status    = stepsOk > 0 && stepsFail > 0 ? 'parcial' : stepsOk > 0 ? 'sucesso' : 'erro';

    db.saveLog(eid, {
      funcao_id: funcao.id, funcao_nome: funcao.nome || '—', funcao_area: funcao.area || '',
      status,
      erro_mensagem: status !== 'sucesso'
        ? (flowResult.steps.find(s => s.status !== 'sucesso')?.erro || 'Erro em step') : null,
      flow_id: flowResult.flow_id, flow_nome: flowResult.flow_nome, se_api_log_ids: stepLogIds,
      duracao_ms: flowResult.steps.reduce((s, x) => s + (x.duracao_ms || 0), 0),
      funcao_json: funcao, integration_source: 'flow', data_envio: new Date().toISOString(),
    });

    registrarLog({ timestamp: new Date().toISOString(), type: status === 'erro' ? 'error' : 'info',
      message: `[SE Funções] Reenvio "${funcao.nome || funcao_id}": ${status}` });
    res.json({ ok: true, status });
  });

  // ── Resetar status de sucesso para revertido ──────────────────────────────────
  app.post('/api/integracoes/se-funcao/resetar', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { seq } = req.body;
    if (!seq) return res.status(400).json({ error: 'seq é obrigatório' });
    const ok = db.resetarIntegracao(eid, seq);
    if (!ok) return res.status(404).json({ error: 'Registro de sucesso não encontrado' });
    res.json({ ok: true });
  });
};
