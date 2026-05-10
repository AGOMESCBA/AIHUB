const db      = require('./database');
const path    = require('path');
const anDb    = require(path.join(__dirname, '..', '..', 'analisador-curriculos', 'database'));
const seApiDb = require(path.join(__dirname, '..', 'SEApiConfigurator', 'database'));
const engine  = require(path.join(__dirname, '..', 'SEApiConfigurator', 'engine'));

module.exports = function (app, { requireAuth, requireEmpresa, registrarLog }) {

  // ── Configuração ──────────────────────────────────────────────────────────────
  app.get('/api/integracoes/se-vaga/config', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.getConfig(req.session.empresa_id));
  });

  app.post('/api/integracoes/se-vaga/config', requireAuth, requireEmpresa, (req, res) => {
    const { se_api_flow_id } = req.body;
    if (!se_api_flow_id)
      return res.status(400).json({ error: 'Selecione um flow para a integração de vagas' });
    db.saveConfig(req.session.empresa_id, {
      integration_source: 'flow',
      se_api_flow_id: Number(se_api_flow_id),
    });
    res.json({ ok: true });
  });

  // ── Flows disponíveis ─────────────────────────────────────────────────────────
  app.get('/api/integracoes/se-vaga/flows', requireAuth, requireEmpresa, (req, res) => {
    const flows = seApiDb.listFlows(req.session.empresa_id);
    res.json(flows.map(f => ({
      id:          f.id,
      nome:        f.nome,
      descricao:   f.descricao || '',
      steps_count: seApiDb.listFlowSteps(req.session.empresa_id, f.id).length,
    })));
  });

  // ── Status mapa (vaga_id -> status) para os badges nos cards ─────────────────
  app.get('/api/integracoes/se-vaga/status-mapa', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.getStatusMapa(req.session.empresa_id));
  });

  // ── Logs ──────────────────────────────────────────────────────────────────────
  app.get('/api/integracoes/se-vaga/logs', requireAuth, requireEmpresa, (req, res) => {
    const { status, vaga_nome, data_inicio, data_fim, page, limit } = req.query;
    res.json(db.listLogs(req.session.empresa_id, { status, vaga_nome, data_inicio, data_fim, page, limit }));
  });

  app.get('/api/integracoes/se-vaga/logs/:seq/steps', requireAuth, requireEmpresa, (req, res) => {
    const eid   = req.session.empresa_id;
    const entry = db.getLogBySeq(eid, req.params.seq);
    if (!entry) return res.status(404).json({ error: 'Registro não encontrado' });
    if (!entry.se_api_log_ids || !entry.se_api_log_ids.length) return res.json([]);
    const logs = db.getSeApiLogsByIds(eid, entry.se_api_log_ids);
    res.json(logs.filter(l => l.tipo === 'flow_step').sort((a, b) => (a.step_ordem || 0) - (b.step_ordem || 0)));
  });

  // ── Enviar vagas ao SE ────────────────────────────────────────────────────────
  app.post('/api/integracoes/se-vaga/enviar', requireAuth, requireEmpresa, async (req, res) => {
    const eid        = req.session.empresa_id;
    const { vaga_ids } = req.body;
    if (!Array.isArray(vaga_ids) || !vaga_ids.length)
      return res.status(400).json({ error: 'vaga_ids deve ser um array não vazio' });

    const config = db.getConfig(eid);
    if (!config.se_api_flow_id)
      return res.status(400).json({ error: 'Flow não configurado. Acesse Integrações › SE Configurações.' });

    const flow = seApiDb.getFlow(eid, config.se_api_flow_id);
    if (!flow)
      return res.status(400).json({ error: `Flow ID ${config.se_api_flow_id} não encontrado. Verifique a configuração.` });

    const todasVagas = anDb.listVagas(eid);
    const resultados = [];

    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Vagas] Iniciando envio de ${vaga_ids.length} vaga(s) — Flow "${flow.nome}"` });

    for (const vid of vaga_ids.map(Number)) {
      const vaga = todasVagas.find(v => v.id === vid);
      if (!vaga) {
        resultados.push({ id: vid, status: 'erro', mensagem: `Vaga ID ${vid} não encontrada` });
        db.saveLog(eid, {
          vaga_id: vid, vaga_funcao_nome: `(ID ${vid} não encontrado)`, vaga_status: '',
          status: 'erro', erro_mensagem: `Vaga ID ${vid} não encontrada na base de dados`,
          flow_id: config.se_api_flow_id, flow_nome: flow.nome, se_api_log_ids: [],
          duracao_ms: null, vaga_json: null,
          integration_source: 'flow', data_envio: new Date().toISOString(),
        });
        continue;
      }

      let flowResult;
      try {
        flowResult = await engine.executeFlow(seApiDb, eid, config.se_api_flow_id, { id: vid });
      } catch (err) {
        db.saveLog(eid, {
          vaga_id: vid, vaga_funcao_nome: vaga.funcao?.nome || '—', vaga_status: vaga.status || '',
          status: 'erro', erro_mensagem: err.message || 'Erro ao executar flow',
          flow_id: config.se_api_flow_id, flow_nome: flow.nome, se_api_log_ids: [],
          duracao_ms: null, vaga_json: vaga,
          integration_source: 'flow', data_envio: new Date().toISOString(),
        });
        resultados.push({ id: vid, nome: vaga.funcao?.nome, status: 'erro', mensagem: err.message });
        registrarLog({ timestamp: new Date().toISOString(), type: 'error',
          message: `[SE Vagas] ✗ Flow erro Vaga #${vid}: ${err.message}` });
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
          vaga_id:     vid,
          vaga_nome:   vaga.funcao?.nome || '—',
        });
        stepLogIds.push(sl.id);
      }

      const stepsOk   = flowResult.steps.filter(s => s.status === 'sucesso').length;
      const stepsFail = flowResult.steps.filter(s => s.status !== 'sucesso').length;
      const status    = stepsOk > 0 && stepsFail > 0 ? 'parcial'
                      : stepsOk > 0                  ? 'sucesso'
                      :                                'erro';

      db.saveLog(eid, {
        vaga_id: vid, vaga_funcao_nome: vaga.funcao?.nome || '—', vaga_status: vaga.status || '',
        status,
        erro_mensagem: status !== 'sucesso'
          ? (flowResult.steps.find(s => s.status !== 'sucesso')?.erro || 'Erro em um ou mais steps')
          : null,
        flow_id:        flowResult.flow_id,
        flow_nome:      flowResult.flow_nome,
        se_api_log_ids: stepLogIds,
        duracao_ms:     flowResult.steps.reduce((s, x) => s + (x.duracao_ms || 0), 0),
        vaga_json:      vaga,
        integration_source: 'flow',
        data_envio: new Date().toISOString(),
      });

      resultados.push({ id: vid, nome: vaga.funcao?.nome, status });
      registrarLog({ timestamp: new Date().toISOString(), type: status === 'erro' ? 'error' : 'info',
        message: `[SE Vagas] ${status === 'sucesso' ? '✓' : status === 'parcial' ? '⚠' : '✗'} Vaga #${vid} (${vaga.funcao?.nome || '—'}) — Flow "${flowResult.flow_nome}" (${stepsOk}/${flowResult.steps.length} steps ok)` });
    }

    const sucesso = resultados.filter(r => r.status === 'sucesso').length;
    const parcial = resultados.filter(r => r.status === 'parcial').length;
    const erros   = resultados.filter(r => r.status === 'erro').length;
    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Vagas] Concluído — ${sucesso} ok, ${parcial} parcial, ${erros} erros` });

    res.json({ resultados, sucesso, parcial, erros, total: vaga_ids.length });
  });

  // ── Reenviar vaga específica ──────────────────────────────────────────────────
  app.post('/api/integracoes/se-vaga/reenviar', requireAuth, requireEmpresa, async (req, res) => {
    const eid      = req.session.empresa_id;
    const { vaga_id } = req.body;
    if (!vaga_id) return res.status(400).json({ error: 'vaga_id é obrigatório' });

    const vaga = anDb.listVagas(eid).find(v => v.id === Number(vaga_id));
    if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada' });

    const config = db.getConfig(eid);
    if (!config.se_api_flow_id)
      return res.status(400).json({ error: 'Flow não configurado' });

    let flowResult;
    try {
      flowResult = await engine.executeFlow(seApiDb, eid, config.se_api_flow_id, { id: Number(vaga_id) });
    } catch (err) {
      db.saveLog(eid, {
        vaga_id: vaga.id, vaga_funcao_nome: vaga.funcao?.nome || '—', vaga_status: vaga.status || '',
        status: 'erro', erro_mensagem: err.message || 'Erro ao executar flow',
        flow_id: config.se_api_flow_id, flow_nome: null, se_api_log_ids: [],
        duracao_ms: null, vaga_json: vaga,
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
        resposta: step.body || null, vaga_id: vaga.id, vaga_nome: vaga.funcao?.nome || '—',
      });
      stepLogIds.push(sl.id);
    }

    const stepsOk   = flowResult.steps.filter(s => s.status === 'sucesso').length;
    const stepsFail = flowResult.steps.filter(s => s.status !== 'sucesso').length;
    const status    = stepsOk > 0 && stepsFail > 0 ? 'parcial' : stepsOk > 0 ? 'sucesso' : 'erro';

    db.saveLog(eid, {
      vaga_id: vaga.id, vaga_funcao_nome: vaga.funcao?.nome || '—', vaga_status: vaga.status || '',
      status,
      erro_mensagem: status !== 'sucesso'
        ? (flowResult.steps.find(s => s.status !== 'sucesso')?.erro || 'Erro em step') : null,
      flow_id: flowResult.flow_id, flow_nome: flowResult.flow_nome, se_api_log_ids: stepLogIds,
      duracao_ms: flowResult.steps.reduce((s, x) => s + (x.duracao_ms || 0), 0),
      vaga_json: vaga, integration_source: 'flow', data_envio: new Date().toISOString(),
    });

    registrarLog({ timestamp: new Date().toISOString(), type: status === 'erro' ? 'error' : 'info',
      message: `[SE Vagas] Reenvio Vaga #${vaga_id}: ${status}` });
    res.json({ ok: true, status });
  });

  // ── Resetar status de sucesso para revertido ──────────────────────────────────
  app.post('/api/integracoes/se-vaga/resetar', requireAuth, requireEmpresa, (req, res) => {
    const { seq } = req.body;
    if (!seq) return res.status(400).json({ error: 'seq é obrigatório' });
    const ok = db.resetarIntegracao(req.session.empresa_id, seq);
    if (!ok) return res.status(404).json({ error: 'Registro de sucesso não encontrado' });
    res.json({ ok: true });
  });
};
