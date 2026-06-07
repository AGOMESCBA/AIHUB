const crud    = require('../modules/database/crud');
const { requireRotina }      = require('../modules/permissions');
const { getEmpresaId }       = require('../modules/empresa-context');
const { URL }  = require('url');
const http     = require('http');
const https    = require('https');
const crypto   = require('crypto');

// ── Requisição HTTP para o agente local ──────────────────────────────────────
function _requestAgente(baseUrl, path, method, body, token, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(path, baseUrl); }
    catch (e) { return reject(new Error('URL do agente inválida.')); }

    const payload = body ? JSON.stringify(body) : null;
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      rejectUnauthorized: false,
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        if (res.statusCode >= 400) {
          const err = new Error(data?.detail || `Agente retornou HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        resolve(data);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout ao chamar o agente.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function _healthCheck(endpointUrl, token, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL('/apicommand', endpointUrl); }
    catch (e) { return reject(new Error('URL inválida. Use o formato http://ip:8765')); }

    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname:          parsed.hostname,
      port:              parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:              parsed.pathname,
      method:            'GET',
      headers:           { Authorization: `Bearer ${token}` },
      rejectUnauthorized: false,
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch (_) { body = raw; }
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout de ${timeoutMs / 1000}s ao conectar ao agente.`)));
    req.on('error', reject);
    req.end();
  });
}

module.exports = function registrarRotasAgenteLocal(app, { requireAuth, requireIaCommand }) {
  function eid(req) { return getEmpresaId(req); }
  const canConfig = requireRotina('iac-config-ia');

  // ── GET config (token mascarado) ─────────────────────────────────────────────
  app.get('/api/ia-command/agente-local/config', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    if (!row) return res.json({
      agente_local_url:          null,
      agente_local_ativo:        0,
      agente_local_ultimo_teste: null,
      agente_local_teste_ok:     null,
      token_configurado:         false,
    });
    res.json({
      agente_local_url:          row.agente_local_url          || null,
      agente_local_ativo:        row.agente_local_ativo        ?? 0,
      agente_local_ultimo_teste: row.agente_local_ultimo_teste || null,
      agente_local_teste_ok:     row.agente_local_teste_ok     ?? null,
      token_configurado:         !!row.agente_local_token,
    });
  });

  // ── POST salvar config ────────────────────────────────────────────────────────
  app.post('/api/ia-command/agente-local/config', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const { url, token, ativo } = req.body;
    const existing = crud.buscarPor('ai_config', 'empresa_id', eid(req));

    const dados = {};
    if (url   !== undefined) dados.agente_local_url   = url   || null;
    if (ativo !== undefined) dados.agente_local_ativo = ativo ? 1 : 0;
    if (token && token !== '***') dados.agente_local_token = token;

    let row;
    if (existing) {
      row = crud.atualizar('ai_config', existing.id, dados);
    } else {
      row = crud.criar('ai_config', { empresa_id: eid(req), ...dados });
    }

    res.json({
      agente_local_url:   row.agente_local_url   || null,
      agente_local_ativo: row.agente_local_ativo  ?? 0,
      token_configurado:  !!row.agente_local_token,
    });
  });

  // ── POST testar conexão (/health do agente) ───────────────────────────────────
  app.post('/api/ia-command/agente-local/testar', requireAuth, requireIaCommand, canConfig, async (req, res) => {
    const row   = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    const url   = req.body.url   || row?.agente_local_url;
    const token = (req.body.token && req.body.token !== '***')
      ? req.body.token
      : row?.agente_local_token;

    if (!url)   return res.status(400).json({ ok: false, erro: 'URL do agente não configurada.' });
    if (!token) return res.status(400).json({ ok: false, erro: 'Token do agente não configurado.' });

    const t0 = Date.now();
    try {
      const { statusCode, body } = await _healthCheck(url, token);
      const ok        = statusCode >= 200 && statusCode < 300;
      const latencia  = Date.now() - t0;
      const agora     = new Date().toISOString();

      if (row) crud.atualizar('ai_config', row.id, {
        agente_local_ultimo_teste: agora,
        agente_local_teste_ok:    ok ? 1 : 0,
      });

      if (ok) return res.json({ ok: true, latencia_ms: latencia, versao: body?.versao || null, status: body?.status || 'ok', ultimo_teste: agora });
      return res.json({ ok: false, erro: `Agente respondeu HTTP ${statusCode}`, latencia_ms: latencia, ultimo_teste: agora });

    } catch (err) {
      const agora = new Date().toISOString();
      if (row) crud.atualizar('ai_config', row.id, { agente_local_ultimo_teste: agora, agente_local_teste_ok: 0 });
      res.json({ ok: false, erro: err.message || 'Erro de conexão com o agente.', ultimo_teste: agora });
    }
  });

  // ── POST regerar token ────────────────────────────────────────────────────────
  app.post('/api/ia-command/agente-local/regerar-token', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const novoToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const existing  = crud.buscarPor('ai_config', 'empresa_id', eid(req));

    if (existing) {
      crud.atualizar('ai_config', existing.id, { agente_local_token: novoToken });
    } else {
      crud.criar('ai_config', { empresa_id: eid(req), agente_local_token: novoToken });
    }

    res.json({ token: novoToken });
  });

  // ── GET reveal token (autenticado — retorna em claro para a empresa da sessão) ─
  app.get('/api/ia-command/agente-local/reveal-token', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    res.json({ token: row?.agente_local_token || null });
  });

  // ── GET cargas/empresas — lista empresas do usuário + status de sync no agente ──
  app.get('/api/ia-command/agente-local/cargas/empresas', requireAuth, requireIaCommand, canConfig, async (req, res) => {
    const row   = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    const url   = row?.agente_local_url;
    const token = row?.agente_local_token;

    let sincronizadas = [];
    if (url && token) {
      try {
        const data = await _requestAgente(url, '/api/empresas/list', 'GET', null, token, 6000);
        if (Array.isArray(data)) sincronizadas = data;
      } catch (_) {}
    }

    const syncMap = new Map(sincronizadas.map(e => [String(e.empresa_id), e]));
    res.json({ syncMap: Object.fromEntries(syncMap), agenteOk: !!(url && token) });
  });

  // ── POST cargas/sincronizar — envia empresas selecionadas ao agente-local ─────
  app.post('/api/ia-command/agente-local/cargas/sincronizar', requireAuth, requireIaCommand, canConfig, async (req, res) => {
    const row   = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    const url   = row?.agente_local_url;
    const token = row?.agente_local_token;

    if (!url)   return res.status(400).json({ ok: false, erro: 'URL do agente não configurada.' });
    if (!token) return res.status(400).json({ ok: false, erro: 'Token do agente não configurado.' });

    const { empresas } = req.body;
    if (!Array.isArray(empresas) || empresas.length === 0) {
      return res.status(400).json({ ok: false, erro: 'Selecione ao menos uma empresa.' });
    }

    // Valida que o usuário tem acesso a todas as empresas enviadas
    const { empresas: acesso, role } = req.session;
    const permitidasSet = role === 'admin' || acesso === 'all'
      ? null
      : new Set(Array.isArray(acesso) ? acesso.map(Number) : []);

    const lista = empresas.filter(e => !permitidasSet || permitidasSet.has(Number(e.id)));
    if (lista.length === 0) {
      return res.status(403).json({ ok: false, erro: 'Nenhuma das empresas selecionadas está acessível.' });
    }

    const payload = lista.map(e => ({
      empresa_id: e.id,
      nome:       e.nome   || `Empresa #${e.id}`,
      cnpj:       e.cnpj   || null,
      slogan:     e.slogan || null,
      logo_data:  e.logo_data || null,
      logo_mime:  e.logo_mime || null,
      bg_data:    e.bg_data   || null,
      bg_mime:    e.bg_mime   || null,
    }));

    try {
      const resultado = await _requestAgente(url, '/api/empresas/sync', 'POST', { empresas: payload }, token, 60000);
      res.json({ ok: true, sincronizadas: lista.length, resultado });
    } catch (err) {
      res.json({ ok: false, erro: err.message || 'Erro ao comunicar com o agente.' });
    }
  });
};
