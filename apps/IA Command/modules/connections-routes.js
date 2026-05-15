const crud        = require('./database/crud');
const factory     = require('./erp/providers/connection-factory');
const erpRegistry = require('./erp/erp-registry');

module.exports = function registrarRotasConexoes(app, { requireAuth, requireIaCommand }) {

  function eid(req) { return req.session.empresa_id; }

  // ── LIST SUPPORTED ERPS ──────────────────────────────────────────────────────
  app.get('/api/ia-command/erps', requireAuth, requireIaCommand, (_req, res) => {
    res.json(erpRegistry.listarErps());
  });

  // ── LIST ─────────────────────────────────────────────────────────────────────
  app.get('/api/ia-command/connections', requireAuth, requireIaCommand, (req, res) => {
    const rows = crud.listar('connections', { empresa_id: eid(req) });
    // Never expose password in list
    res.json(rows.map((r) => ({ ...r, password: undefined })));
  });

  // ── GET ONE ──────────────────────────────────────────────────────────────────
  app.get('/api/ia-command/connections/:id', requireAuth, requireIaCommand, (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ...row, password: undefined });
  });

  // ── CREATE ───────────────────────────────────────────────────────────────────
  app.post('/api/ia-command/connections', requireAuth, requireIaCommand, (req, res) => {
    const { nome, tipo, erp, host, port, database, username, password, filial, encrypt, trust_cert, ssl } = req.body;
    if (!nome || !tipo || !host || !database) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome, tipo, host, database.' });
    }
    const row = crud.criar('connections', {
      empresa_id: eid(req), nome, tipo, erp: erp || 'protheus', host,
      port: port || null, database, username: username || null,
      password: password || null, filial: filial || null,
      encrypt: encrypt ? 1 : 0, trust_cert: trust_cert ? 1 : 0, ssl: ssl ? 1 : 0,
      ativo: 0,
    });
    res.status(201).json({ ...row, password: undefined });
  });

  // ── UPDATE ───────────────────────────────────────────────────────────────────
  app.put('/api/ia-command/connections/:id', requireAuth, requireIaCommand, (req, res) => {
    const existing = crud.buscarPorId('connections', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    const campos = {};
    const allowed = ['nome', 'tipo', 'erp', 'host', 'port', 'database', 'username', 'password', 'filial', 'encrypt', 'trust_cert', 'ssl', 'ativo'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) campos[k] = req.body[k];
    }

    const row = crud.atualizar('connections', req.params.id, campos);
    res.json({ ...row, password: undefined });
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────
  app.delete('/api/ia-command/connections/:id', requireAuth, requireIaCommand, (req, res) => {
    const existing = crud.buscarPorId('connections', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    crud.excluir('connections', req.params.id);
    res.json({ ok: true });
  });

  // ── TEST CONNECTION ───────────────────────────────────────────────────────────
  app.post('/api/ia-command/connections/:id/test', requireAuth, requireIaCommand, async (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    try {
      await factory.testar(row);
      // Mark as tested
      crud.atualizar('connections', row.id, { ultimo_teste: new Date().toISOString(), teste_ok: 1 });
      res.json({ ok: true, mensagem: 'Conexão testada com sucesso!' });
    } catch (err) {
      crud.atualizar('connections', row.id, { ultimo_teste: new Date().toISOString(), teste_ok: 0 });
      res.status(400).json({ ok: false, mensagem: err.message });
    }
  });

  // ── ACTIVATE (set as default for company) ────────────────────────────────────
  app.post('/api/ia-command/connections/:id/activate', requireAuth, requireIaCommand, (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    const { getDB } = require('./database');
    const db = getDB();
    // Deactivate all, then activate this one
    db.prepare('UPDATE connections SET ativo = 0 WHERE empresa_id = ?').run(eid(req));
    db.prepare('UPDATE connections SET ativo = 1 WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });
};
