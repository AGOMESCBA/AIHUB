const db     = require('./database');
const engine = require('./engine');

module.exports = function (app, { requireAuth, requireEmpresa, registrarLog }) {

  const log = (msg, type = 'info', eid) =>
    registrarLog({ timestamp: new Date().toISOString(), type, message: `[SE API Config] ${msg}` }, eid);

  // ════════════════════════════════════════════════════════════════════════════
  // TESTE DE CONEXÃO (sem salvar — usa dados do formulário diretamente)
  // ════════════════════════════════════════════════════════════════════════════

  app.post('/api/se-api/test-connection', requireAuth, requireEmpresa, async (req, res) => {
    const eid = req.session.empresa_id;
    const { endpoint, method, headers = [], template_id, mappings = [] } = req.body;

    if (!endpoint) return res.status(400).json({ error: 'endpoint é obrigatório' });

    // Monta objeto de headers
    const headersObj = {};
    for (const h of headers) {
      if (h.key && h.key.trim()) headersObj[h.key.trim()] = h.value || '';
    }

    // Monta XML de teste se houver template selecionado
    let xmlEnviado = '<test/>';
    if (template_id) {
      const template = db.getTemplate(eid, template_id);
      if (template && template.xml_template) {
        const placeholders = engine.extractPlaceholders(template.xml_template);
        const values  = {};
        const rawSet  = new Set();

        for (const ph of placeholders) {
          if (ph === 'form_fields') {
            // Gera bloco de teste com valores fictícios
            const camposSE = mappings.filter(m => m.se_field_id && m.se_field_id.trim());
            const blockTpl = template.block_xml_template;
            const blocos   = camposSE.map(m => {
              const val = m.default_value || `[${m.source_field || m.se_field_id}]`;
              return (blockTpl || '').trim()
                ? blockTpl.trim()
                    .replace(/\{SE_FIELD_ID\}/g,   engine.escapeXml(m.se_field_id.trim()))
                    .replace(/\{SE_FIELD_VALUE\}/g, engine.escapeXml(String(val)))
                : `        <item><fieldID>${engine.escapeXml(m.se_field_id.trim())}</fieldID><fieldValue>${engine.escapeXml(String(val))}</fieldValue></item>`;
            }).join('\n');
            values[ph] = blocos;
            rawSet.add(ph);
            continue;
          }
          const mapping = mappings.find(m => m.placeholder === ph);
          values[ph]    = mapping?.default_value || `[${ph}]`;
        }

        try {
          xmlEnviado = engine.replacePlaceholders(template.xml_template, values, rawSet);
        } catch (e) {
          xmlEnviado = template.xml_template; // envia o template cru se falhar
        }
      }
    }

    const inicio = Date.now();
    try {
      const resultado = await engine.httpRequest(endpoint, method || 'POST', headersObj, xmlEnviado);
      const ok = resultado.status_code >= 200 && resultado.status_code < 300;
      log(`Teste de conexão ${endpoint}: HTTP ${resultado.status_code} (${resultado.duracao_ms}ms)`, ok ? 'info' : 'warn');
      res.json({ ok, ...resultado, xml_enviado: xmlEnviado });
    } catch (err) {
      log(`Teste de conexão ERRO ${endpoint}: ${err.message}`, 'error');
      res.status(200).json({
        ok:         false,
        error:      err.message,
        duracao_ms: err.duracao_ms ?? (Date.now() - inicio),
        xml_enviado: xmlEnviado,
      });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SOURCE TABLES — catálogo das tabelas de origem disponíveis
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/source-tables', requireAuth, (req, res) => {
    res.json(db.listSourceTables());
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEMPLATES (por empresa)
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/templates', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.listTemplates(req.session.empresa_id));
  });

  app.get('/api/se-api/templates/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const t = db.getTemplate(eid, req.params.id);
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });
    res.json(t);
  });

  app.get('/api/se-api/templates/:id/placeholders', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const t = db.getTemplate(eid, req.params.id);
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });
    res.json({ placeholders: engine.extractPlaceholders(t.xml_template || '') });
  });

  app.post('/api/se-api/templates/extract-placeholders', requireAuth, (req, res) => {
    const { xml } = req.body;
    if (!xml) return res.status(400).json({ error: 'xml é obrigatório' });
    res.json({ placeholders: engine.extractPlaceholders(xml) });
  });

  app.post('/api/se-api/templates', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const { nome, tipo, integration_type, xml_template, versao, descricao } = req.body;
    if (!nome || !tipo || !xml_template) {
      return res.status(400).json({ error: 'nome, tipo e xml_template são obrigatórios' });
    }
    const placeholders = engine.extractPlaceholders(xml_template);
    const novo = db.createTemplate(eid, { nome, tipo, integration_type, xml_template, versao: versao || '1.0', descricao, placeholders });
    log(`Template criado: ${novo.nome} (ID ${novo.id})`, 'info', eid);
    res.status(201).json(novo);
  });

  app.put('/api/se-api/templates/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const { nome, tipo, integration_type, xml_template, versao, descricao } = req.body;
    const placeholders = xml_template ? engine.extractPlaceholders(xml_template) : undefined;
    const atualizado = db.updateTemplate(eid, req.params.id, {
      ...(nome           !== undefined && { nome }),
      ...(tipo           !== undefined && { tipo }),
      ...(integration_type !== undefined && { integration_type }),
      ...(xml_template   !== undefined && { xml_template }),
      ...(versao         !== undefined && { versao }),
      ...(descricao      !== undefined && { descricao }),
      ...(placeholders   !== undefined && { placeholders }),
    });
    if (!atualizado) return res.status(404).json({ error: 'Template não encontrado' });
    log(`Template atualizado: ${atualizado.nome} (ID ${atualizado.id})`, 'info', eid);
    res.json(atualizado);
  });

  app.delete('/api/se-api/templates/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const ok = db.deleteTemplate(eid, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Template não encontrado' });
    log(`Template removido ID ${req.params.id}`, 'info', eid);
    res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // CONFIGS (por empresa)
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/configs', requireAuth, requireEmpresa, (req, res) => {
    const eid     = req.session.empresa_id;
    const configs = db.listConfigs(eid);
    const templates = db.listTemplates(eid);
    const enriched = configs.map(c => ({
      ...c,
      template_nome: templates.find(t => t.id === c.template_id)?.nome || '—',
      headers_count:  db.listHeaders(eid, c.id).length,
      mappings_count: db.listMappings(eid, c.id).length,
    }));
    res.json(enriched);
  });

  app.get('/api/se-api/configs/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const c   = db.getConfig(eid, req.params.id);
    if (!c) return res.status(404).json({ error: 'Config não encontrada' });
    res.json({
      ...c,
      headers:  db.listHeaders(eid, c.id),
      mappings: db.listMappings(eid, c.id),
    });
  });

  app.post('/api/se-api/configs', requireAuth, requireEmpresa, (req, res) => {
    const { nome, tipo, template_id, endpoint, method, descricao, source_table, source_id_field } = req.body;
    if (!nome || !template_id || !endpoint) {
      return res.status(400).json({ error: 'nome, template_id e endpoint são obrigatórios' });
    }
    const eid  = req.session.empresa_id;
    if (!db.getTemplate(eid, template_id)) {
      return res.status(400).json({ error: 'Template não encontrado' });
    }
    const novo = db.createConfig(eid, {
      nome, tipo, template_id: Number(template_id), endpoint,
      method: method || 'POST', descricao,
      source_table:    source_table    || null,
      source_id_field: source_id_field || null,
    });
    log(`Config criada: ${novo.nome} (ID ${novo.id})`, 'info', eid);
    res.status(201).json(novo);
  });

  app.put('/api/se-api/configs/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid        = req.session.empresa_id;
    const { nome, tipo, template_id, endpoint, method, descricao, ativo, source_table, source_id_field } = req.body;
    const atualizado = db.updateConfig(eid, req.params.id, {
      ...(nome             !== undefined && { nome }),
      ...(tipo             !== undefined && { tipo }),
      ...(template_id      !== undefined && { template_id: Number(template_id) }),
      ...(endpoint         !== undefined && { endpoint }),
      ...(method           !== undefined && { method }),
      ...(descricao        !== undefined && { descricao }),
      ...(ativo            !== undefined && { ativo }),
      ...(source_table     !== undefined && { source_table:     source_table     || null }),
      ...(source_id_field  !== undefined && { source_id_field:  source_id_field  || null }),
    });
    if (!atualizado) return res.status(404).json({ error: 'Config não encontrada' });
    log(`Config atualizada: ${atualizado.nome} (ID ${atualizado.id})`, 'info', eid);
    res.json(atualizado);
  });

  app.delete('/api/se-api/configs/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const ok  = db.deleteConfig(eid, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Config não encontrada' });
    log(`Config removida ID ${req.params.id}`, 'info', eid);
    res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // HEADERS (por config)
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/configs/:id/headers', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.listHeaders(req.session.empresa_id, req.params.id));
  });

  app.put('/api/se-api/configs/:id/headers', requireAuth, requireEmpresa, (req, res) => {
    const { headers } = req.body;
    if (!Array.isArray(headers)) return res.status(400).json({ error: 'headers deve ser um array' });
    const invalidos = headers.filter(h => !h.key);
    if (invalidos.length) return res.status(400).json({ error: 'Todos os headers devem ter key' });
    db.setHeaders(req.session.empresa_id, req.params.id, headers);
    res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // MAPPINGS (por config)
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/configs/:id/mappings', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.listMappings(req.session.empresa_id, req.params.id));
  });

  app.put('/api/se-api/configs/:id/mappings', requireAuth, requireEmpresa, (req, res) => {
    const { mappings } = req.body;
    if (!Array.isArray(mappings)) return res.status(400).json({ error: 'mappings deve ser um array' });
    const invalidos = mappings.filter(m => !m.source_field || (!m.placeholder && !m.se_field_id));
    if (invalidos.length) return res.status(400).json({ error: 'Todos os mappings devem ter source_field e ao menos placeholder ou Campo SE' });
    db.setMappings(req.session.empresa_id, req.params.id, mappings);
    res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FLOWS (por empresa)
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/flows', requireAuth, requireEmpresa, (req, res) => {
    const eid   = req.session.empresa_id;
    const flows = db.listFlows(eid);
    const enriched = flows.map(f => ({
      ...f,
      steps_count: db.listFlowSteps(eid, f.id).length,
    }));
    res.json(enriched);
  });

  app.get('/api/se-api/flows/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const f   = db.getFlow(eid, req.params.id);
    if (!f) return res.status(404).json({ error: 'Flow não encontrado' });
    const steps    = db.listFlowSteps(eid, f.id);
    const configs  = db.listConfigs(eid);
    const enriched = steps.map(s => ({
      ...s,
      config_nome: configs.find(c => c.id === s.config_id)?.nome || '—',
    }));
    res.json({ ...f, steps: enriched });
  });

  app.post('/api/se-api/flows', requireAuth, requireEmpresa, (req, res) => {
    const { nome, descricao } = req.body;
    if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
    const eid  = req.session.empresa_id;
    const novo = db.createFlow(eid, { nome, descricao });
    log(`Flow criado: ${novo.nome} (ID ${novo.id})`, 'info', eid);
    res.status(201).json(novo);
  });

  app.put('/api/se-api/flows/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid        = req.session.empresa_id;
    const { nome, descricao } = req.body;
    const atualizado = db.updateFlow(eid, req.params.id, {
      ...(nome      !== undefined && { nome }),
      ...(descricao !== undefined && { descricao }),
    });
    if (!atualizado) return res.status(404).json({ error: 'Flow não encontrado' });
    res.json(atualizado);
  });

  app.delete('/api/se-api/flows/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const ok  = db.deleteFlow(eid, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Flow não encontrado' });
    log(`Flow removido ID ${req.params.id}`, 'info', eid);
    res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FLOW STEPS
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/flows/:id/steps', requireAuth, requireEmpresa, (req, res) => {
    const eid   = req.session.empresa_id;
    const steps = db.listFlowSteps(eid, req.params.id);
    const configs = db.listConfigs(eid);
    res.json(steps.map(s => ({
      ...s,
      config_nome: configs.find(c => c.id === s.config_id)?.nome || '—',
    })));
  });

  app.put('/api/se-api/flows/:id/steps', requireAuth, requireEmpresa, (req, res) => {
    const { steps } = req.body;
    if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps deve ser um array' });
    const invalidos = steps.filter(s => !s.config_id);
    if (invalidos.length) return res.status(400).json({ error: 'Todos os steps devem ter config_id' });
    db.setFlowSteps(req.session.empresa_id, req.params.id, steps);
    res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // EXECUÇÃO
  // ════════════════════════════════════════════════════════════════════════════

  app.post('/api/se-api/execute/config/:id', requireAuth, requireEmpresa, async (req, res) => {
    const eid      = req.session.empresa_id;
    const configId = Number(req.params.id);
    const data     = req.body.data || {};

    let resultado;
    try {
      resultado = await engine.executeConfig(db, eid, configId, data);
    } catch (err) {
      const log_entry = db.saveLog(eid, {
        tipo:       'config',
        config_id:  configId,
        config_nome: db.getConfig(eid, configId)?.nome || `ID ${configId}`,
        status:     'erro',
        erro:       err.message,
        duracao_ms: err.duracao_ms ?? null,
        xml_enviado: null,
        status_code: null,
        resposta:   null,
      });
      log(`Execução ERRO config ${configId}: ${err.message}`, 'error', eid);
      return res.status(400).json({ error: err.message, log_id: log_entry.id });
    }

    const log_entry = db.saveLog(eid, {
      tipo:        'config',
      config_id:   resultado.config_id,
      config_nome: resultado.config_nome,
      status:      resultado.status_code >= 200 && resultado.status_code < 300 ? 'sucesso' : 'erro_http',
      duracao_ms:  resultado.duracao_ms,
      xml_enviado: resultado.xml_enviado,
      status_code: resultado.status_code,
      resposta:    resultado.body,
    });

    log(`Execução config ${resultado.config_nome}: HTTP ${resultado.status_code} (${resultado.duracao_ms}ms)`, 'info', eid);
    res.json({ ...resultado, log_id: log_entry.id });
  });

  app.post('/api/se-api/execute/flow/:id', requireAuth, requireEmpresa, async (req, res) => {
    const eid    = req.session.empresa_id;
    const flowId = Number(req.params.id);
    const data   = req.body.data || {};

    let resultado;
    try {
      resultado = await engine.executeFlow(db, eid, flowId, data);
    } catch (err) {
      db.saveLog(eid, {
        tipo:      'flow',
        flow_id:   flowId,
        flow_nome: db.getFlow(eid, flowId)?.nome || `ID ${flowId}`,
        status:    'erro',
        erro:      err.message,
      });
      log(`Execução ERRO flow ${flowId}: ${err.message}`, 'error', eid);
      return res.status(400).json({ error: err.message });
    }

    // Salva log do flow + um log por step
    const flowLog = db.saveLog(eid, {
      tipo:      'flow',
      flow_id:   resultado.flow_id,
      flow_nome: resultado.flow_nome,
      status:    resultado.sucesso ? 'sucesso' : 'erro',
      steps_total:  resultado.steps.length,
      steps_sucesso: resultado.steps.filter(s => s.status === 'sucesso').length,
    });

    for (const step of resultado.steps) {
      db.saveLog(eid, {
        tipo:        'flow_step',
        flow_id:     resultado.flow_id,
        flow_nome:   resultado.flow_nome,
        step_ordem:  step.step_ordem,
        config_id:   step.config_id,
        config_nome: step.config_nome || `Config ${step.config_id}`,
        status:      step.status,
        erro:        step.erro || null,
        duracao_ms:  step.duracao_ms ?? null,
        xml_enviado: step.xml_enviado || null,
        status_code: step.status_code || null,
        resposta:    step.body || null,
      });
    }

    log(`Execução flow ${resultado.flow_nome}: ${resultado.sucesso ? 'sucesso' : 'com erros'}`, resultado.sucesso ? 'info' : 'error', eid);
    res.json({ ...resultado, log_id: flowLog.id });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // LOGS (histórico)
  // ════════════════════════════════════════════════════════════════════════════

  app.get('/api/se-api/logs', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const { status, config_nome, flow_id, tipo, data_inicio, data_fim, page, limit } = req.query;
    res.json(db.listLogs(eid, { status, config_nome, flow_id, tipo, data_inicio, data_fim, page, limit }));
  });

  app.get('/api/se-api/logs/stats', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.getLogStats(req.session.empresa_id));
  });
};
