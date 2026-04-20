const db      = require('./database');
const service = require('./service');
const path    = require('path');
const anDb    = require(path.join(__dirname, '..', '..', 'analisador-curriculos', 'database'));

function curricuoloParaLog(c) {
  const copia = { ...c };
  if (copia.pdf_base64) {
    const kb = Math.round(Buffer.byteLength(copia.pdf_base64, 'utf8') / 1024);
    copia.pdf_base64 = `[BASE64 OMITIDO — ${kb} KB]`;
  }
  return copia;
}

module.exports = function (app, { requireAuth, registrarLog }) {

  // ── Configuração ──────────────────────────────────────────────────────────────
  app.get('/api/integracoes/se/config', requireAuth, (_req, res) => {
    res.json(db.getConfig());
  });

  app.post('/api/integracoes/se/config', requireAuth, (req, res) => {
    const { se_url, se_token } = req.body;
    if (!se_url || !se_token) return res.status(400).json({ error: 'se_url e se_token são obrigatórios' });
    db.saveConfig({ se_url: se_url.trim(), se_token: se_token.trim() });
    res.json({ ok: true });
  });

  // ── Logs ──────────────────────────────────────────────────────────────────────
  app.get('/api/integracoes/se/logs', requireAuth, (req, res) => {
    const { status, curriculo_nome, analise_id, vaga_id, data_inicio, data_fim, page, limit } = req.query;
    res.json(db.listLogs({ status, curriculo_nome, analise_id, vaga_id, data_inicio, data_fim, page, limit }));
  });

  app.post('/api/integracoes/se/resumo-analises', requireAuth, (req, res) => {
    const { analise_ids } = req.body;
    if (!Array.isArray(analise_ids)) return res.status(400).json({ error: 'analise_ids deve ser um array' });
    res.json(db.getResumoAnalises(analise_ids));
  });

  // ── Enviar analisados ao SE ───────────────────────────────────────────────────
  app.post('/api/integracoes/se/enviar', requireAuth, async (req, res) => {
    const { analise_id } = req.body;
    if (!analise_id) return res.status(400).json({ error: 'analise_id é obrigatório' });

    const analise = anDb.getAnalise(analise_id);
    if (!analise) return res.status(404).json({ error: 'Análise não encontrada' });

    const config = db.getConfig();
    if (!config.se_token) return res.status(400).json({ error: 'Token SE não configurado. Acesse Configurações › Integrações.' });

    const idsParaEnviar = (analise.resultados || []).map(r => r.id).filter(Boolean);
    if (!idsParaEnviar.length) return res.status(400).json({ error: 'Esta análise não possui currículos analisados para enviar.' });

    const curriculos = anDb.listCurriculos();
    const resultados = [];

    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Integração] Iniciando envio de ${idsParaEnviar.length} analisados — ${analise.funcao_nome}` });

    for (const cid of idsParaEnviar) {
      const curriculo = curriculos.find(c => c.id === cid);

      if (!curriculo) {
        db.saveLog({
          analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
          curriculo_id: cid, curriculo_nome: `(ID ${cid} não encontrado)`,
          curriculo_email: '', curriculo_telefone: '',
          status: 'erro', erro_mensagem: `Currículo ID ${cid} não encontrado na base de dados`,
          http_status: null, resposta_api: null, duracao_ms: null,
          fault_code: null, xml_enviado: null, tem_anexo: false, curriculo_json: null,
          data_envio: new Date().toISOString(),
        });
        resultados.push({ id: cid, status: 'erro', mensagem: `ID ${cid} não encontrado` });
        registrarLog({ timestamp: new Date().toISOString(), type: 'error',
          message: `[SE Integração] ✗ ID ${cid}: currículo não encontrado` });
        continue;
      }

      if (db.jaIntegrado(cid, analise_id)) {
        db.saveLog({
          analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
          curriculo_id: cid, curriculo_nome: curriculo.nome || '—',
          curriculo_email: curriculo.email || '', curriculo_telefone: curriculo.telefone || '',
          status: 'ignorado', erro_mensagem: 'Já integrado com sucesso para esta análise',
          http_status: null, resposta_api: null, duracao_ms: null,
          fault_code: null, xml_enviado: null, tem_anexo: !!(curriculo.pdf_base64 && curriculo.pdf_nome),
          curriculo_json: curricuoloParaLog(curriculo),
          data_envio: new Date().toISOString(),
        });
        resultados.push({ id: cid, nome: curriculo.nome, status: 'ignorado' });
        continue;
      }

      const xml_enviado = service.montarSoapResumido(curriculo);
      const tem_anexo   = !!(curriculo.pdf_base64 && curriculo.pdf_nome);

      try {
        const resultado = await service.enviarParaSE(curriculo, config);
        db.saveLog({
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
          xml_enviado,
          tem_anexo,
          curriculo_json: curricuoloParaLog(curriculo),
          data_envio: new Date().toISOString(),
        });
        resultados.push({ id: cid, nome: curriculo.nome, status: 'sucesso' });
        registrarLog({ timestamp: new Date().toISOString(), type: 'info',
          message: `[SE Integração] ✓ ${curriculo.nome || cid} — SE RecordID: ${resultado.se_record_id || '?'} (${resultado.duracao_ms}ms)` });
      } catch (err) {
        const msg = err.message || 'Erro desconhecido';
        db.saveLog({
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
          xml_enviado,
          tem_anexo,
          curriculo_json: curricuoloParaLog(curriculo),
          data_envio: new Date().toISOString(),
        });
        resultados.push({ id: cid, nome: curriculo.nome, status: 'erro', mensagem: msg });
        registrarLog({ timestamp: new Date().toISOString(), type: 'error',
          message: `[SE Integração] ✗ ${curriculo.nome || cid}: ${msg}` });
      }
    }

    const sucesso   = resultados.filter(r => r.status === 'sucesso').length;
    const erros     = resultados.filter(r => r.status === 'erro').length;
    const ignorados = resultados.filter(r => r.status === 'ignorado').length;
    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Integração] Concluído — ${sucesso} enviados, ${erros} erros, ${ignorados} já integrados` });

    res.json({ resultados, sucesso, erros, ignorados, total: idsParaEnviar.length });
  });

  // ── Reenviar currículo específico ─────────────────────────────────────────────
  app.post('/api/integracoes/se/reenviar', requireAuth, async (req, res) => {
    const { curriculo_id, analise_id } = req.body;
    if (!curriculo_id || !analise_id) return res.status(400).json({ error: 'curriculo_id e analise_id são obrigatórios' });

    const analise  = anDb.getAnalise(analise_id);
    if (!analise) return res.status(404).json({ error: 'Análise não encontrada' });

    const curriculo = anDb.listCurriculos().find(c => c.id === Number(curriculo_id));
    if (!curriculo) return res.status(404).json({ error: 'Currículo não encontrado' });

    const config = db.getConfig();
    if (!config.se_token) return res.status(400).json({ error: 'Token SE não configurado' });

    const xml_enviado = service.montarSoapResumido(curriculo);
    const tem_anexo   = !!(curriculo.pdf_base64 && curriculo.pdf_nome);

    try {
      const resultado = await service.enviarParaSE(curriculo, config);
      db.saveLog({
        analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
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
        xml_enviado,
        tem_anexo,
        curriculo_json: curricuoloParaLog(curriculo),
        data_envio: new Date().toISOString(),
      });
      registrarLog({ timestamp: new Date().toISOString(), type: 'info',
        message: `[SE Integração] ✓ Reenvio: ${curriculo.nome || curriculo_id} — SE RecordID: ${resultado.se_record_id || '?'} (${resultado.duracao_ms}ms)` });
      res.json({ ok: true });
    } catch (err) {
      const msg = err.message || 'Erro desconhecido';
      db.saveLog({
        analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
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
        xml_enviado,
        tem_anexo,
        curriculo_json: curricuoloParaLog(curriculo),
        data_envio: new Date().toISOString(),
      });
      registrarLog({ timestamp: new Date().toISOString(), type: 'error',
        message: `[SE Integração] ✗ Reenvio ${curriculo.nome || curriculo_id}: ${msg}` });
      res.status(500).json({ error: msg });
    }
  });

  // ── Desflagging: reverter sucesso para reintegrar ─────────────────────────────
  app.post('/api/integracoes/se/resetar', requireAuth, (req, res) => {
    const { curriculo_id, analise_id } = req.body;
    if (!curriculo_id || !analise_id) return res.status(400).json({ error: 'curriculo_id e analise_id são obrigatórios' });

    const ok = db.resetarIntegracao(Number(curriculo_id), analise_id);
    if (!ok) return res.status(404).json({ error: 'Nenhum registro sucesso encontrado para este currículo nesta análise' });

    registrarLog({ timestamp: new Date().toISOString(), type: 'info',
      message: `[SE Integração] ↩ Integração revertida — currículo ID ${curriculo_id} / análise ${analise_id}` });
    res.json({ ok: true });
  });

  // ── Marcar como integrado manualmente (sem enviar ao SE) ──────────────────────
  app.post('/api/integracoes/se/marcar-integrado', requireAuth, (req, res) => {
    const { curriculo_id, analise_id } = req.body;
    if (!curriculo_id || !analise_id) return res.status(400).json({ error: 'curriculo_id e analise_id são obrigatórios' });

    const analise   = anDb.getAnalise(analise_id);
    if (!analise) return res.status(404).json({ error: 'Análise não encontrada' });

    const curriculo = anDb.listCurriculos().find(c => c.id === Number(curriculo_id));
    if (!curriculo) return res.status(404).json({ error: 'Currículo não encontrado' });

    db.marcarIntegradoManual({
      analise_id, vaga_id: analise.vaga_id, vaga_nome: analise.funcao_nome,
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
