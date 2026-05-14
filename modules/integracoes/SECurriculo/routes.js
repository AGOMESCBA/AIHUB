const db       = require('./database');
const service  = require('./service');
const path     = require('path');
const anDb     = require(path.join(__dirname, '..', '..', 'analisador-curriculos', 'database'));
const empDb    = require(path.join(__dirname, '..', '..', 'empresas', 'database'));
const seApiDb  = require(path.join(__dirname, '..', 'SEApiConfigurator', 'database'));
const engine   = require(path.join(__dirname, '..', 'SEApiConfigurator', 'engine'));

function curricuoloParaLog(c) {
  const copia = { ...c };
  if (copia.pdf_base64) {
    const kb = Math.round(Buffer.byteLength(copia.pdf_base64, 'utf8') / 1024);
    copia.pdf_base64 = `[BASE64 OMITIDO — ${kb} KB]`;
  }
  return copia;
}

function memoList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(v => `- ${v}`).join('\n');
  return value || '';
}

function dadosResultadoAnalise(analise, curriculo) {
  const cid = curriculo?.id;
  const resultado = (analise.resultados || []).find(r => String(r.id) === String(cid)) || {};
  const eliminado = (analise.eliminados || []).find(e => String(e.id) === String(cid)) || {};
  const detalhes = resultado.detalhes || {};
  const pontosNegativos = resultado.pontos_negativos || [];

  return {
    ...(curriculo || {}),
    ...resultado,
    resultado_id: `${analise.id}:${cid}`,
    analise_id: analise.id,
    vaga_id: analise.vaga_id ?? null,
    funcao_id: analise.funcao_id ?? null,
    funcao_nome: analise.funcao_nome || null,
    curriculo_id: cid,
    finalista: (analise.finalistas_ids || []).map(Number).includes(Number(cid)),
    peso: resultado.score ?? null,
    pontos_positivos_texto: memoList(resultado.pontos_positivos),
    pontos_a_avaliar: pontosNegativos,
    pontos_a_avaliar_texto: memoList(pontosNegativos),
    motivo_eliminacao: eliminado.motivo || resultado.motivo_eliminacao || null,
    requisitos_obrigatorios: detalhes.requisitos_obrigatorios ?? null,
    requisitos_desejados: detalhes.requisitos_desejados ?? null,
    formacao_score: detalhes.formacao ?? null,
    habilidades_tecnicas: detalhes.habilidades_tecnicas ?? null,
    nivel_experiencia_score: detalhes.nivel_experiencia ?? null,
  };
}

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
  app.get('/api/integracoes/se/config', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.getConfig(_resolverEid(req)));
  });

  app.post('/api/integracoes/se/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { se_url, se_token, campo_empresa_id, campo_empresa_nome, integration_source, se_api_flow_id, se_api_grid_config_id } = req.body;
    const source = integration_source || 'legacy';
    if (source === 'legacy' && (!se_url || !se_token))
      return res.status(400).json({ error: 'se_url e se_token são obrigatórios para integração padrão' });
    if (source === 'flow' && !se_api_flow_id)
      return res.status(400).json({ error: 'Selecione um flow para a integração via SE API Configurador' });
    if (source === 'grid' && !se_api_grid_config_id)
      return res.status(400).json({ error: 'Selecione um Flow para a integração em lote (GRID)' });
    db.saveConfig(eid, {
      se_url:                (se_url   || '').trim(),
      se_token:              (se_token || '').trim(),
      campo_empresa_id:      (campo_empresa_id   || '').trim(),
      campo_empresa_nome:    (campo_empresa_nome || '').trim(),
      integration_source:    source,
      se_api_flow_id:        source === 'flow' ? Number(se_api_flow_id) : null,
      se_api_grid_flow_id:   source === 'grid' ? Number(se_api_grid_config_id) : null,
    });
    res.json({ ok: true });
  });

  // ── Listar flows do SE API Configurador (para seleção na config) ──────────────
  app.get('/api/integracoes/se/flows', requireAuth, requireEmpresa, (req, res) => {
    const eid   = _resolverEid(req);
    const flows = seApiDb.listFlows(eid);
    res.json(flows.map(f => ({
      id:          f.id,
      nome:        f.nome,
      descricao:   f.descricao || '',
      steps_count: seApiDb.listFlowSteps(eid, f.id).length,
    })));
  });


  // ── Steps (se_api_logs) de uma entrada do histórico ───────────────────────────
  app.get('/api/integracoes/se/logs/:seq/steps', requireAuth, requireEmpresa, (req, res) => {
    const eid  = _resolverEid(req);
    const entry = db.getLogBySeq(eid, req.params.seq);
    if (!entry) return res.status(404).json({ error: 'Registro não encontrado' });
    if (!entry.se_api_log_ids || !entry.se_api_log_ids.length)
      return res.json([]);
    const logs = db.getSeApiLogsByIds(eid, entry.se_api_log_ids);
    res.json(logs.filter(l => l.tipo === 'flow_step').sort((a, b) => (a.step_ordem || 0) - (b.step_ordem || 0)));
  });

  // ── Logs ──────────────────────────────────────────────────────────────────────
  app.get('/api/integracoes/se/logs', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { status, curriculo_nome, analise_id, vaga_id, data_inicio, data_fim, page, limit } = req.query;
    res.json(db.listLogs(eid, { status, curriculo_nome, analise_id, vaga_id, data_inicio, data_fim, page, limit }));
  });

  app.post('/api/integracoes/se/resumo-analises', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { analise_ids } = req.body;
    if (!Array.isArray(analise_ids)) return res.status(400).json({ error: 'analise_ids deve ser um array' });
    res.json(db.getResumoAnalises(eid, analise_ids));
  });

  // ── Enviar analisados ao SE ───────────────────────────────────────────────────
  app.post('/api/integracoes/se/enviar', requireAuth, requireEmpresa, async (req, res) => {
    const eid        = _resolverEid(req);
    const { analise_id } = req.body;
    if (!analise_id) return res.status(400).json({ error: 'analise_id é obrigatório' });

    const analise = anDb.getAnalise(eid, analise_id);
    if (!analise) return res.status(404).json({ error: 'Análise não encontrada' });

    const config      = db.getConfig(eid);
    const usandoFlow  = config.integration_source === 'flow' && config.se_api_flow_id;
    const usandoGrid  = config.integration_source === 'grid' && config.se_api_grid_flow_id;

    if (!usandoFlow && !usandoGrid && !config.se_token)
      return res.status(400).json({ error: 'Token SE não configurado. Acesse Configurações › Integrações.' });
    if (usandoFlow) {
      const flow = seApiDb.getFlow(eid, config.se_api_flow_id);
      if (!flow) return res.status(400).json({ error: `Flow ID ${config.se_api_flow_id} não encontrado. Verifique a configuração.` });
    }
    if (usandoGrid) {
      const gridFlow = seApiDb.getFlow(eid, config.se_api_grid_flow_id);
      if (!gridFlow) return res.status(400).json({ error: `Flow GRID ID ${config.se_api_grid_flow_id} não encontrado. Verifique a configuração.` });
    }

    // ── Caminho GRID: executa Flow com todos os aprovados em lote ──────────────
    if (usandoGrid) {
      const vaga = analise.vaga_id ? anDb.getVaga(eid, analise.vaga_id) : null;
      if (!vaga) return res.status(400).json({ error: 'Vaga desta análise não encontrada.' });
      if (!vaga.se_workflow_id) return res.status(400).json({
        error: `A vaga "${vaga.titulo || analise.vaga_id}" ainda não possui WorkflowID do SE. Integre a vaga primeiro.`,
      });

      const idsParaEnviar = (analise.resultados || []).map(r => r.id).filter(Boolean);
      if (!idsParaEnviar.length) return res.status(400).json({ error: 'Esta análise não possui currículos analisados.' });

      const curriculos = anDb.listCurriculos(eid);
      const grid_rows  = idsParaEnviar
        .map(cid => curriculos.find(c => c.id === cid))
        .filter(Boolean)
        .map(c => dadosResultadoAnalise(analise, c));

      registrarLog({ timestamp: new Date().toISOString(), type: 'info',
        message: `[SE Grid Flow] Iniciando — ${grid_rows.length} candidatos / vaga "${vaga.titulo}" / WorkflowID ${vaga.se_workflow_id}` });

      let flowResult;
      try {
        flowResult = await engine.executeFlow(seApiDb, eid, config.se_api_grid_flow_id, {
          workflow_id: vaga.se_workflow_id,
          grid_rows,
        });
      } catch (err) {
        db.saveLog(eid, {
          analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
          curriculo_id: null, curriculo_nome: `(${grid_rows.length} candidatos em lote)`,
          curriculo_email: '', curriculo_telefone: '',
          status: 'erro', erro_mensagem: err.message,
          http_status: null, resposta_api: null, duracao_ms: null, fault_code: null,
          xml_enviado: null, tem_anexo: false, curriculo_json: null,
          integration_source: 'grid', flow_id: config.se_api_grid_flow_id,
          se_api_log_ids: [], data_envio: new Date().toISOString(),
        });
        registrarLog({ timestamp: new Date().toISOString(), type: 'error',
          message: `[SE Grid Flow] ✗ Erro: ${err.message}` });
        return res.status(400).json({ error: err.message });
      }

      // Log por step no seApiDb (igual ao flow de currículos individuais)
      const stepLogIds = [];
      for (const step of flowResult.steps) {
        const sl = seApiDb.saveLog(eid, {
          tipo: 'flow_step', flow_id: flowResult.flow_id, flow_nome: flowResult.flow_nome,
          step_ordem: step.step_ordem, config_id: step.config_id,
          config_nome: step.config_nome || `Config ${step.config_id}`,
          status: step.status, erro: step.erro || null,
          duracao_ms: step.duracao_ms ?? null, xml_enviado: step.xml_enviado || null,
          status_code: step.status_code || null, resposta: step.body || null,
          curriculo_id: null, curriculo_nome: `(${grid_rows.length} candidatos em lote)`,
        });
        stepLogIds.push(sl.id);
      }

      const stepsOk   = flowResult.steps.filter(s => s.status === 'sucesso').length;
      const stepsFail = flowResult.steps.filter(s => s.status !== 'sucesso').length;
      const status    = stepsOk > 0 && stepsFail > 0 ? 'parcial'
                      : stepsOk > 0                  ? 'sucesso'
                      :                                'erro';

      db.saveLog(eid, {
        analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
        curriculo_id: null, curriculo_nome: `(${grid_rows.length} candidatos em lote)`,
        curriculo_email: '', curriculo_telefone: '',
        status,
        erro_mensagem: status !== 'sucesso'
          ? (flowResult.steps.find(s => s.status !== 'sucesso')?.erro || 'Erro em um ou mais steps')
          : null,
        http_status: null, resposta_api: null,
        duracao_ms: flowResult.steps.reduce((s, x) => s + (x.duracao_ms || 0), 0),
        fault_code: null, xml_enviado: null, tem_anexo: false, curriculo_json: null,
        integration_source: 'grid',
        flow_id: flowResult.flow_id, flow_nome: flowResult.flow_nome,
        se_api_log_ids: stepLogIds, data_envio: new Date().toISOString(),
      });

      registrarLog({ timestamp: new Date().toISOString(), type: status === 'erro' ? 'error' : 'info',
        message: `[SE Grid Flow] ${status === 'sucesso' ? '✓' : status === 'parcial' ? '⚠' : '✗'} "${flowResult.flow_nome}" — ${stepsOk}/${flowResult.steps.length} steps ok (${grid_rows.length} candidatos)` });

      return res.json({
        resultados: grid_rows.map(c => ({ id: c.id, nome: c.nome, status })),
        sucesso: status === 'sucesso' ? grid_rows.length : 0,
        parcial: status === 'parcial' ? grid_rows.length : 0,
        erros:   status === 'erro'    ? grid_rows.length : 0,
        ignorados: 0, total: grid_rows.length,
        modo: 'grid', flow_nome: flowResult.flow_nome,
      });
    }

    const idsParaEnviar = (analise.resultados || []).map(r => r.id).filter(Boolean);
    if (!idsParaEnviar.length) return res.status(400).json({ error: 'Esta análise não possui currículos analisados para enviar.' });

    const curriculos  = anDb.listCurriculos(eid);
    const resultados  = [];
    const empresa     = empDb.buscarPorId(eid) || {};
    const empresaNome = empresa.razao_social || req.session.empresa_nome || '';

    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Integração] Iniciando envio de ${idsParaEnviar.length} analisados — ${analise.funcao_nome} [${usandoFlow ? `Flow ${config.se_api_flow_id}` : 'legado'}]` });

    for (const cid of idsParaEnviar) {
      const curriculo = curriculos.find(c => c.id === cid);
      if (curriculo) { curriculo.empresa_id = String(eid); curriculo.empresa_nome = empresaNome; }

      if (!curriculo) {
        db.saveLog(eid, {
          analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
          curriculo_id: cid, curriculo_nome: `(ID ${cid} não encontrado)`,
          curriculo_email: '', curriculo_telefone: '',
          status: 'erro', erro_mensagem: `Currículo ID ${cid} não encontrado na base de dados`,
          http_status: null, resposta_api: null, duracao_ms: null,
          fault_code: null, xml_enviado: null, tem_anexo: false, curriculo_json: null,
          integration_source: config.integration_source,
          data_envio: new Date().toISOString(),
        });
        resultados.push({ id: cid, status: 'erro', mensagem: `ID ${cid} não encontrado` });
        registrarLog({ timestamp: new Date().toISOString(), type: 'error',
          message: `[SE Integração] ✗ ID ${cid}: currículo não encontrado` });
        continue;
      }

      if (db.jaIntegrado(eid, cid, analise_id)) {
        db.saveLog(eid, {
          analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
          curriculo_id: cid, curriculo_nome: curriculo.nome || '—',
          curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
          status: 'ignorado', erro_mensagem: 'Já integrado com sucesso para esta análise',
          http_status: null, resposta_api: null, duracao_ms: null,
          fault_code: null, xml_enviado: null, tem_anexo: !!(curriculo.pdf_base64 && curriculo.pdf_nome),
          curriculo_json: curricuoloParaLog(curriculo),
          integration_source: config.integration_source,
          data_envio: new Date().toISOString(),
        });
        resultados.push({ id: cid, nome: curriculo.nome, status: 'ignorado' });
        continue;
      }

      if (usandoFlow) {
        // ── Caminho flow ──────────────────────────────────────────────────────
        const tem_anexo = !!(curriculo.pdf_base64 && curriculo.pdf_nome);
        let flowResult;
        try {
          const dadosAnalise = dadosResultadoAnalise(analise, curriculo);
          flowResult = await engine.executeFlow(seApiDb, eid, config.se_api_flow_id, {
            ...dadosAnalise,
            id: cid,
            curriculo_id: cid,
            resultado_id: `${analise.id}:${cid}`,
            empresa_id: String(eid),
            empresa_nome: empresaNome,
          });
        } catch (err) {
          db.saveLog(eid, {
            analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
            curriculo_id: cid, curriculo_nome: curriculo.nome || '—',
            curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
            status: 'erro', erro_mensagem: err.message || 'Erro ao executar flow',
            http_status: null, resposta_api: null, duracao_ms: null,
            fault_code: null, xml_enviado: null, tem_anexo,
            curriculo_json: curricuoloParaLog(curriculo),
            integration_source: 'flow',
            flow_id: config.se_api_flow_id, flow_nome: null, se_api_log_ids: [],
            data_envio: new Date().toISOString(),
          });
          resultados.push({ id: cid, nome: curriculo.nome, status: 'erro', mensagem: err.message });
          registrarLog({ timestamp: new Date().toISOString(), type: 'error',
            message: `[SE Integração] ✗ Flow erro ${curriculo.nome || cid}: ${err.message}` });
          continue;
        }

        // Salva um log por step em se_api_logs
        const stepLogIds = [];
        for (const step of flowResult.steps) {
          const stepLog = seApiDb.saveLog(eid, {
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
            curriculo_id: cid,
            curriculo_nome: curriculo.nome || '—',
          });
          stepLogIds.push(stepLog.id);
        }

        const stepsOk   = flowResult.steps.filter(s => s.status === 'sucesso').length;
        const stepsFail = flowResult.steps.filter(s => s.status !== 'sucesso').length;
        const status    = stepsOk > 0 && stepsFail > 0 ? 'parcial'
                        : stepsOk > 0                  ? 'sucesso'
                        :                                'erro';

        db.saveLog(eid, {
          analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
          curriculo_id: cid, curriculo_nome: curriculo.nome || '—',
          curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
          status,
          erro_mensagem: status !== 'sucesso'
            ? (flowResult.steps.find(s => s.status !== 'sucesso')?.erro || 'Erro em um ou mais steps')
            : null,
          http_status: null, resposta_api: null,
          duracao_ms:  flowResult.steps.reduce((s, x) => s + (x.duracao_ms || 0), 0),
          fault_code: null, xml_enviado: null, tem_anexo,
          curriculo_json: curricuoloParaLog(curriculo),
          integration_source: 'flow',
          flow_id:         flowResult.flow_id,
          flow_nome:       flowResult.flow_nome,
          se_api_log_ids:  stepLogIds,
          data_envio: new Date().toISOString(),
        });

        resultados.push({ id: cid, nome: curriculo.nome, status });
        registrarLog({ timestamp: new Date().toISOString(), type: status === 'erro' ? 'error' : 'info',
          message: `[SE Integração] ${status === 'sucesso' ? '✓' : status === 'parcial' ? '⚠' : '✗'} ${curriculo.nome || cid} — Flow "${flowResult.flow_nome}" (${stepsOk}/${flowResult.steps.length} steps ok)` });

      } else {
        // ── Caminho legado ────────────────────────────────────────────────────
        const xml_enviado = service.montarSoapResumido(curriculo, config);
        const tem_anexo   = !!(curriculo.pdf_base64 && curriculo.pdf_nome);

        try {
          const resultado = await service.enviarParaSE(curriculo, config);
          db.saveLog(eid, {
            analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
            curriculo_id: cid, curriculo_nome: curriculo.nome || '—',
            curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
            status: 'sucesso', erro_mensagem: null,
            http_status:   resultado.http_status,
            resposta_api:  resultado.resposta_api,
            duracao_ms:    resultado.duracao_ms,
            fault_code:    null,
            se_status:     resultado.se_status    ?? null,
            se_code:       resultado.se_code      ?? null,
            se_detail:     resultado.se_detail    ?? null,
            se_record_id:  resultado.se_record_id ?? null,
            xml_enviado, tem_anexo,
            curriculo_json: curricuoloParaLog(curriculo),
            integration_source: 'legacy',
            data_envio: new Date().toISOString(),
          });
          resultados.push({ id: cid, nome: curriculo.nome, status: 'sucesso' });
          registrarLog({ timestamp: new Date().toISOString(), type: 'info',
            message: `[SE Integração] ✓ ${curriculo.nome || cid} — SE RecordID: ${resultado.se_record_id || '?'} (${resultado.duracao_ms}ms)` });
        } catch (err) {
          const msg = err.message || 'Erro desconhecido';
          db.saveLog(eid, {
            analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
            curriculo_id: cid, curriculo_nome: curriculo.nome || '—',
            curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
            status: 'erro', erro_mensagem: msg,
            http_status:   err.http_status   ?? null,
            resposta_api:  err.resposta_api  ?? null,
            duracao_ms:    err.duracao_ms    ?? null,
            fault_code:    err.fault_code    ?? null,
            erro_detalhes: err.erro_detalhes ?? null,
            se_status:     err.se_status     ?? null,
            se_code:       err.se_code       ?? null,
            se_detail:     err.se_detail     ?? null,
            se_record_id:  null,
            xml_enviado, tem_anexo,
            curriculo_json: curricuoloParaLog(curriculo),
            integration_source: 'legacy',
            data_envio: new Date().toISOString(),
          });
          resultados.push({ id: cid, nome: curriculo.nome, status: 'erro', mensagem: msg });
          registrarLog({ timestamp: new Date().toISOString(), type: 'error',
            message: `[SE Integração] ✗ ${curriculo.nome || cid}: ${msg}` });
        }
      }
    }

    const sucesso   = resultados.filter(r => r.status === 'sucesso').length;
    const parcial   = resultados.filter(r => r.status === 'parcial').length;
    const erros     = resultados.filter(r => r.status === 'erro').length;
    const ignorados = resultados.filter(r => r.status === 'ignorado').length;
    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Integração] Concluído — ${sucesso} ok, ${parcial} parcial, ${erros} erros, ${ignorados} ignorados` });

    res.json({ resultados, sucesso, parcial, erros, ignorados, total: idsParaEnviar.length });
  });

  // ── Reenviar currículo específico ─────────────────────────────────────────────
  app.post('/api/integracoes/se/reenviar', requireAuth, requireEmpresa, async (req, res) => {
    const eid = _resolverEid(req);
    const { curriculo_id, analise_id } = req.body;
    if (!curriculo_id || !analise_id) return res.status(400).json({ error: 'curriculo_id e analise_id são obrigatórios' });

    const curriculo = anDb.listCurriculos(eid).find(c => c.id === Number(curriculo_id));
    if (!curriculo) return res.status(404).json({ error: 'Currículo não encontrado' });
    const _emp = empDb.buscarPorId(eid) || {};
    curriculo.empresa_id   = String(eid);
    curriculo.empresa_nome = _emp.razao_social || req.session.empresa_nome || '';

    const analise   = anDb.getAnalise(eid, analise_id);
    let   vagaId    = analise?.vaga_id    ?? null;
    let   vagaNome  = analise?.funcao_nome ?? null;
    if (!analise) {
      const logExist = db.listLogs(eid, { analise_id, limit: 1 }).logs[0];
      vagaId   = logExist?.vaga_id  ?? null;
      vagaNome = logExist?.vaga_nome ?? null;
    }

    if (db.jaIntegrado(eid, Number(curriculo_id), analise_id)) {
      return res.status(409).json({ error: 'Este currículo já foi integrado com sucesso nesta análise. Use "Reverter" antes de reenviar.' });
    }

    const config     = db.getConfig(eid);
    const usandoFlow = config.integration_source === 'flow' && config.se_api_flow_id;
    const tem_anexo  = !!(curriculo.pdf_base64 && curriculo.pdf_nome);

    if (usandoFlow) {
      let flowResult;
      try {
        const dadosAnalise = analise ? dadosResultadoAnalise(analise, curriculo) : {};
        flowResult = await engine.executeFlow(seApiDb, eid, config.se_api_flow_id, {
          ...dadosAnalise,
          id: Number(curriculo_id),
          curriculo_id: Number(curriculo_id),
          resultado_id: analise ? `${analise.id}:${curriculo_id}` : null,
          analise_id,
          empresa_id: String(eid),
          empresa_nome: curriculo.empresa_nome,
        });
      } catch (err) {
        db.saveLog(eid, {
          analise_id, vaga_id: vagaId, vaga_nome: vagaNome,
          curriculo_id: curriculo.id, curriculo_nome: curriculo.nome || '—',
          curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
          status: 'erro', erro_mensagem: err.message || 'Erro ao executar flow',
          http_status: null, resposta_api: null, duracao_ms: null,
          fault_code: null, xml_enviado: null, tem_anexo,
          curriculo_json: curricuoloParaLog(curriculo),
          integration_source: 'flow',
          flow_id: config.se_api_flow_id, flow_nome: null, se_api_log_ids: [],
          data_envio: new Date().toISOString(),
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
          resposta: step.body || null, curriculo_id: curriculo.id, curriculo_nome: curriculo.nome || '—',
        });
        stepLogIds.push(sl.id);
      }

      const stepsOk = flowResult.steps.filter(s => s.status === 'sucesso').length;
      const stepsFail = flowResult.steps.filter(s => s.status !== 'sucesso').length;
      const status  = stepsOk > 0 && stepsFail > 0 ? 'parcial' : stepsOk > 0 ? 'sucesso' : 'erro';

      db.saveLog(eid, {
        analise_id, vaga_id: vagaId, vaga_nome: vagaNome,
        curriculo_id: curriculo.id, curriculo_nome: curriculo.nome || '—',
        curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
        status, erro_mensagem: status !== 'sucesso'
          ? (flowResult.steps.find(s => s.status !== 'sucesso')?.erro || 'Erro em step') : null,
        http_status: null, resposta_api: null,
        duracao_ms: flowResult.steps.reduce((s, x) => s + (x.duracao_ms || 0), 0),
        fault_code: null, xml_enviado: null, tem_anexo,
        curriculo_json: curricuoloParaLog(curriculo),
        integration_source: 'flow',
        flow_id: flowResult.flow_id, flow_nome: flowResult.flow_nome, se_api_log_ids: stepLogIds,
        data_envio: new Date().toISOString(),
      });
      registrarLog({ timestamp: new Date().toISOString(), type: status === 'erro' ? 'error' : 'info',
        message: `[SE Integração] Reenvio flow "${flowResult.flow_nome}" — ${curriculo.nome || curriculo_id}: ${status}` });
      return res.json({ ok: true, status });
    }

    // Caminho legado
    if (!config.se_token) return res.status(400).json({ error: 'Token SE não configurado' });
    const xml_enviado = service.montarSoapResumido(curriculo, config);

    try {
      const resultado = await service.enviarParaSE(curriculo, config);
      db.saveLog(eid, {
        analise_id, vaga_id: vagaId, vaga_nome: vagaNome,
        curriculo_id: curriculo.id, curriculo_nome: curriculo.nome || '—',
        curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
        status: 'sucesso', erro_mensagem: null,
        http_status:   resultado.http_status,
        resposta_api:  resultado.resposta_api,
        duracao_ms:    resultado.duracao_ms,
        fault_code:    null,
        se_status:     resultado.se_status    ?? null,
        se_code:       resultado.se_code      ?? null,
        se_detail:     resultado.se_detail    ?? null,
        se_record_id:  resultado.se_record_id ?? null,
        xml_enviado, tem_anexo,
        curriculo_json: curricuoloParaLog(curriculo),
        integration_source: 'legacy',
        data_envio: new Date().toISOString(),
      });
      registrarLog({ timestamp: new Date().toISOString(), type: 'info',
        message: `[SE Integração] ✓ Reenvio: ${curriculo.nome || curriculo_id} — SE RecordID: ${resultado.se_record_id || '?'} (${resultado.duracao_ms}ms)` });
      res.json({ ok: true });
    } catch (err) {
      const msg = err.message || 'Erro desconhecido';
      db.saveLog(eid, {
        analise_id, vaga_id: vagaId, vaga_nome: vagaNome,
        curriculo_id: curriculo.id, curriculo_nome: curriculo.nome || '—',
        curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
        status: 'erro', erro_mensagem: msg,
        http_status:   err.http_status   ?? null,
        resposta_api:  err.resposta_api  ?? null,
        duracao_ms:    err.duracao_ms    ?? null,
        fault_code:    err.fault_code    ?? null,
        erro_detalhes: err.erro_detalhes ?? null,
        se_status:     err.se_status     ?? null,
        se_code:       err.se_code       ?? null,
        se_detail:     err.se_detail     ?? null,
        se_record_id:  null,
        xml_enviado, tem_anexo,
        curriculo_json: curricuoloParaLog(curriculo),
        integration_source: 'legacy',
        data_envio: new Date().toISOString(),
      });
      registrarLog({ timestamp: new Date().toISOString(), type: 'error',
        message: `[SE Integração] ✗ Reenvio ${curriculo.nome || curriculo_id}: ${msg}` });
      res.status(500).json({ error: msg });
    }
  });

  // ── Re-executar um step específico de um flow ──────────────────────────────────
  app.post('/api/integracoes/se/reenviar-step', requireAuth, requireEmpresa, async (req, res) => {
    const eid = _resolverEid(req);
    const { config_id, curriculo_id } = req.body;
    if (!config_id || !curriculo_id) return res.status(400).json({ error: 'config_id e curriculo_id são obrigatórios' });

    const curriculo = anDb.listCurriculos(eid).find(c => c.id === Number(curriculo_id));
    if (!curriculo) return res.status(404).json({ error: 'Currículo não encontrado' });
    const _emp = empDb.buscarPorId(eid) || {};
    curriculo.empresa_id   = String(eid);
    curriculo.empresa_nome = _emp.razao_social || req.session.empresa_nome || '';

    let resultado;
    try {
      resultado = await engine.executeConfig(seApiDb, eid, Number(config_id), {
        id: Number(curriculo_id), empresa_id: String(eid), empresa_nome: curriculo.empresa_nome,
      });
    } catch (err) {
      const logEntry = seApiDb.saveLog(eid, {
        tipo: 'flow_step', config_id: Number(config_id),
        config_nome: seApiDb.getConfig(eid, Number(config_id))?.nome || `Config ${config_id}`,
        status: 'erro', erro: err.message, duracao_ms: err.duracao_ms ?? null,
        xml_enviado: null, status_code: null, resposta: null,
        curriculo_id: Number(curriculo_id), curriculo_nome: curriculo.nome || '—',
      });
      return res.status(400).json({ ok: false, error: err.message, log_id: logEntry.id });
    }

    const logEntry = seApiDb.saveLog(eid, {
      tipo: 'flow_step', config_id: resultado.config_id, config_nome: resultado.config_nome,
      status: resultado.status_code >= 200 && resultado.status_code < 300 ? 'sucesso' : 'erro_http',
      duracao_ms: resultado.duracao_ms, xml_enviado: resultado.xml_enviado,
      status_code: resultado.status_code, resposta: resultado.body,
      curriculo_id: Number(curriculo_id), curriculo_nome: curriculo.nome || '—',
    });

    res.json({
      ok:          resultado.status_code >= 200 && resultado.status_code < 300,
      status_code: resultado.status_code,
      duracao_ms:  resultado.duracao_ms,
      xml_enviado: resultado.xml_enviado,
      resposta:    resultado.body,
      log_id:      logEntry.id,
    });
  });

  // ── Desflagging: reverter sucesso para reintegrar ─────────────────────────────
  app.post('/api/integracoes/se/resetar', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { curriculo_id, analise_id } = req.body;
    if (!curriculo_id || !analise_id) return res.status(400).json({ error: 'curriculo_id e analise_id são obrigatórios' });

    const ok = db.resetarIntegracao(eid, Number(curriculo_id), analise_id);
    if (!ok) return res.status(404).json({ error: 'Nenhum registro sucesso encontrado para este currículo nesta análise' });

    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Integração] ↩ Integração revertida — currículo ID ${curriculo_id} / análise ${analise_id}` });
    res.json({ ok: true });
  });

  // ── Marcar como integrado manualmente (sem enviar ao SE) ──────────────────────
  app.post('/api/integracoes/se/marcar-integrado', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { curriculo_id, analise_id } = req.body;
    if (!curriculo_id || !analise_id) return res.status(400).json({ error: 'curriculo_id e analise_id são obrigatórios' });

    const curriculo = anDb.listCurriculos(eid).find(c => c.id === Number(curriculo_id));
    if (!curriculo) return res.status(404).json({ error: 'Currículo não encontrado' });

    const analise   = anDb.getAnalise(eid, analise_id);
    let   vagaId    = analise?.vaga_id    ?? null;
    let   vagaNome  = analise?.funcao_nome ?? null;
    if (!analise) {
      const logExist = db.listLogs(eid, { analise_id, limit: 1 }).logs[0];
      vagaId   = logExist?.vaga_id  ?? null;
      vagaNome = logExist?.vaga_nome ?? null;
    }

    db.marcarIntegradoManual(eid, {
      analise_id, vaga_id: vagaId, vaga_nome: vagaNome,
      curriculo_id: curriculo.id, curriculo_nome: curriculo.nome || '—',
      curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
      erro_mensagem: null,
      http_status: null, resposta_api: null, duracao_ms: null,
      fault_code: null, xml_enviado: null, tem_anexo: !!(curriculo.pdf_base64 && curriculo.pdf_nome),
      curriculo_json: null,
      data_envio: new Date().toISOString(),
    });

    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Integração] ✓ Marcado manualmente como integrado — ${curriculo.nome || curriculo_id}` });
    res.json({ ok: true });
  });
};
