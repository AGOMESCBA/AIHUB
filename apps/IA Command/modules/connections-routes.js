const crud        = require('./database/crud');
const factory     = require('./erp/providers/connection-factory');
const erpRegistry = require('./erp/core/erp-registry');
const { requireRotina, requireAnyRotina } = require('./permissions');
const { getEmpresaId } = require('./empresa-context');
const http        = require('http');
const https       = require('https');

function _invalidarMetaConexao(empresaId) {
  try { require('./erp/ia-owner/runner').invalidarMetaCache(empresaId); } catch (_) {}
}

function _connectionKey(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'default';
}

function _baseAgente(url) {
  const u = new URL(String(url || '').trim());
  return `${u.protocol}//${u.host}`;
}

function _requestAgente(baseUrl, path, body, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token || ''}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      rejectUnauthorized: false,
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(data?.detail || data?.error || `Agente retornou HTTP ${res.statusCode}`));
        }
        resolve(data);
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('Timeout ao chamar o agente.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function _agentConfig(db, empresaId) {
  const row = db.prepare(
    `SELECT agente_local_url, agente_local_token
       FROM ai_config WHERE empresa_id = ? LIMIT 1`
  ).get(empresaId);
  if (!row?.agente_local_url || !row?.agente_local_token) {
    throw new Error('Agente Local nao configurado para esta empresa.');
  }
  return { url: _baseAgente(row.agente_local_url), token: row.agente_local_token };
}

function _payloadConexao(row, empresaId) {
  return {
    empresa_id: String(empresaId || row.empresa_id || ''),
    connection_key: row.connection_key || _connectionKey(`${row.erp || 'dados'}_${row.nome || row.id}`),
    nome: row.nome || '',
    sistema_origem: row.erp || '',
    db_host: row.host || '',
    db_port: row.port || '1433',
    db_name: row.database || '',
    db_user: row.username || '',
    db_pass: row.password || '',
    db_driver: 'ODBC Driver 17 for SQL Server',
    filial: row.filial || '01',
  };
}

module.exports = function registrarRotasConexoes(app, { requireAuth, requireIaCommand }) {

  function eid(req) { return getEmpresaId(req); }
  const canConfigConexoes = requireRotina('iac-config-conexoes');
  const canLerConexoes = requireAnyRotina([
    'iac-config-conexoes',
    'iac-admin-datasets',
    'iac-admin-intencoes',
    'iac-config-middleware',
    'iac-admin-protheus-sx2',
    'iac-admin-protheus-sx3',
  ]);

  // ── LIST SUPPORTED ERPS ──────────────────────────────────────────────────────
  app.get('/api/ia-command/erps', requireAuth, requireIaCommand, canConfigConexoes, (_req, res) => {
    res.json(erpRegistry.listarErps());
  });

  // ── LIST (acesso completo — requer rotina de config) ─────────────────────────
  app.get('/api/ia-command/connections', requireAuth, requireIaCommand, canConfigConexoes, (req, res) => {
    const rows = crud.listar('connections', { empresa_id: eid(req) });
    res.json(rows.map((r) => ({ ...r, password: undefined })));
  });

  // ── LIST DISPONIVEIS (dropdown em outros modulos) ────────────────────────────
  app.get('/api/ia-command/connections/available', requireAuth, requireIaCommand, canLerConexoes, (req, res) => {
    const rows = crud.listar('connections', { empresa_id: eid(req) });
    res.json(rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      tipo: r.tipo,
      erp: r.erp,
      ativo: r.ativo,
      connection_key: r.connection_key || null,
    })));
  });

  // ── GET ONE ──────────────────────────────────────────────────────────────────
  app.get('/api/ia-command/connections/:id', requireAuth, requireIaCommand, canConfigConexoes, (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ...row, password: undefined });
  });

  // ── CREATE ───────────────────────────────────────────────────────────────────
  app.post('/api/ia-command/connections', requireAuth, requireIaCommand, canConfigConexoes, (req, res) => {
    try {
      const { nome, tipo, erp, host, port, database, username, password, encrypt, trust_cert, ssl } = req.body;
      const isProxy = tipo === 'api_proxy';
      if (!nome || !tipo || !host) {
        return res.status(400).json({ error: 'Campos obrigatórios: nome, tipo, host.' });
      }
      if (!isProxy && !database) {
        return res.status(400).json({ error: 'Campo obrigatório: database.' });
      }
      const { filial, configuracoes } = req.body;
      const connectionKey = _connectionKey(req.body.connection_key || `${erp || 'dados'}_${nome}`);
      const duplicada = crud.listar('connections', { empresa_id: eid(req), connection_key: connectionKey })[0];
      if (duplicada) {
        return res.status(400).json({ error: `Já existe uma conexão ("${duplicada.nome}") usando a chave de rota "${connectionKey}" nesta empresa.` });
      }
      const row = crud.criar('connections', {
        empresa_id:   eid(req), nome, tipo, erp: erp || 'protheus', host,
        connection_key: connectionKey,
        port:         isProxy ? null : (port || null),
        database:     database || null,
        username:     isProxy ? null : (username || null),
        password:     password || null,
        encrypt:      isProxy ? 0 : (encrypt ? 1 : 0),
        trust_cert:   isProxy ? 0 : (trust_cert ? 1 : 0),
        ssl:          ssl ? 1 : 0,
        filial:       filial || null,
        configuracoes: configuracoes || null,
        ativo:        0,
      });
      res.status(201).json({ ...row, password: undefined });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erro interno ao criar.' });
    }
  });

  // ── UPDATE ───────────────────────────────────────────────────────────────────
  app.put('/api/ia-command/connections/:id', requireAuth, requireIaCommand, canConfigConexoes, (req, res) => {
    try {
      const existing = crud.buscarPorId('connections', req.params.id);
      if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

      const campos = {};
      const allowed = ['nome', 'tipo', 'erp', 'connection_key', 'host', 'port', 'database', 'username', 'password', 'filial', 'encrypt', 'trust_cert', 'ssl', 'ativo', 'configuracoes'];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          const v = req.body[k];
          campos[k] = k === 'connection_key' ? _connectionKey(v) : (typeof v === 'boolean' ? (v ? 1 : 0) : v);
        }
      }

      if (campos.connection_key) {
        const duplicada = crud.listar('connections', { empresa_id: eid(req), connection_key: campos.connection_key })
          .find(c => c.id !== req.params.id);
        if (duplicada) {
          return res.status(400).json({ error: `Já existe uma conexão ("${duplicada.nome}") usando a chave de rota "${campos.connection_key}" nesta empresa.` });
        }
      }

      const row = crud.atualizar('connections', req.params.id, campos);
      _invalidarMetaConexao(eid(req));
      res.json({ ...row, password: undefined });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erro interno ao salvar.' });
    }
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────
  app.delete('/api/ia-command/connections/:id', requireAuth, requireIaCommand, canConfigConexoes, (req, res) => {
    const existing = crud.buscarPorId('connections', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    crud.excluir('connections', req.params.id);
    res.json({ ok: true });
  });

  // ── TEST CONNECTION ───────────────────────────────────────────────────────────
  app.post('/api/ia-command/connections/:id/test', requireAuth, requireIaCommand, canConfigConexoes, async (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    // Conexão "Agente Local" não guarda host/token próprios (sentinel row.host='agente-local') —
    // a URL/token reais vêm da config única do Agente Local (ai_config). Resolve via factory
    // em vez de testar o row cru, senão a URL sentinel quebra com "Invalid URL".
    const ehAgenteLocal = row.tipo === 'api_proxy' && row.host === 'agente-local';
    try {
      const conn = ehAgenteLocal ? factory.carregarConexao(eid(req), { connectionId: row.id }) : row;
      await factory.testar(conn);
      // Mark as tested
      crud.atualizar('connections', row.id, { ultimo_teste: new Date().toISOString(), teste_ok: 1 });
      res.json({ ok: true, mensagem: 'Conexão testada com sucesso!' });
    } catch (err) {
      crud.atualizar('connections', row.id, { ultimo_teste: new Date().toISOString(), teste_ok: 0 });
      res.status(400).json({ ok: false, mensagem: err.message });
    }
  });

  app.post('/api/ia-command/connections/:id/agente-sync', requireAuth, requireIaCommand, canConfigConexoes, async (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    const { getDB } = require('./database');
    const db = getDB();
    const agora = new Date().toISOString();
    try {
      if (!row.connection_key) {
        row.connection_key = _connectionKey(`${row.erp || 'dados'}_${row.nome || row.id}`);
        crud.atualizar('connections', row.id, { connection_key: row.connection_key });
      }
      const agente = _agentConfig(db, eid(req));
      const data = await _requestAgente(agente.url, '/api/conexoes/sync', _payloadConexao(row, eid(req)), agente.token);
      crud.atualizar('connections', row.id, {
        agente_sync_status: 'ok',
        agente_sync_em: agora,
        agente_ultimo_erro: null,
      });
      res.json({ ok: true, mensagem: 'Conexao sincronizada com o Agente Local.', data });
    } catch (err) {
      crud.atualizar('connections', row.id, {
        agente_sync_status: 'erro',
        agente_sync_em: agora,
        agente_ultimo_erro: err.message,
      });
      res.status(400).json({ ok: false, mensagem: err.message });
    }
  });

  app.post('/api/ia-command/connections/:id/agente-test', requireAuth, requireIaCommand, canConfigConexoes, async (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    const { getDB } = require('./database');
    const db = getDB();
    const agora = new Date().toISOString();
    try {
      const agente = _agentConfig(db, eid(req));
      const data = await _requestAgente(agente.url, '/api/conexoes/testar', {
        empresa_id: String(eid(req)),
        connection_key: row.connection_key || _connectionKey(`${row.erp || 'dados'}_${row.nome || row.id}`),
      }, agente.token);
      const ok = data?.ok !== false;
      crud.atualizar('connections', row.id, {
        agente_teste_ok: ok ? 1 : 0,
        agente_ultimo_teste: agora,
        agente_ultimo_erro: ok ? null : (data?.erro || data?.mensagem || 'Falha ao testar.'),
      });
      res.status(ok ? 200 : 400).json({ ok, mensagem: data?.mensagem || data?.erro || 'Teste concluido.', data });
    } catch (err) {
      crud.atualizar('connections', row.id, {
        agente_teste_ok: 0,
        agente_ultimo_teste: agora,
        agente_ultimo_erro: err.message,
      });
      res.status(400).json({ ok: false, mensagem: err.message });
    }
  });

  // ── ACTIVATE (set as default for the connection's own system/erp) ────────────
  app.post('/api/ia-command/connections/:id/activate', requireAuth, requireIaCommand, canConfigConexoes, (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    const { getDB } = require('./database');
    const db = getDB();
    // Marca como padrão apenas dentro do mesmo sistema (erp) — conexões de outros
    // sistemas (ex: Protheus e SoftExpert na mesma empresa) permanecem intactas.
    db.prepare('UPDATE connections SET padrao = 0 WHERE empresa_id = ? AND erp = ?').run(eid(req), row.erp);
    db.prepare('UPDATE connections SET padrao = 1, ativo = 1 WHERE id = ?').run(row.id);
    _invalidarMetaConexao(eid(req));
    res.json({ ok: true });
  });
};
