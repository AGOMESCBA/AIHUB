const crud        = require('./database/crud');
const factory     = require('./erp/providers/connection-factory');
const erpRegistry = require('./erp/core/erp-registry');
const { requireRotina, requireAnyRotina } = require('./permissions');
const { getEmpresaId } = require('./empresa-context');

function _invalidarMetaConexao(empresaId) {
  try { require('./erp/ia-owner/runner').invalidarMetaCache(empresaId); } catch (_) {}
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
    res.json(rows.map((r) => ({ id: r.id, nome: r.nome, tipo: r.tipo, erp: r.erp, ativo: r.ativo })));
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
      const row = crud.criar('connections', {
        empresa_id:   eid(req), nome, tipo, erp: erp || 'protheus', host,
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
      const allowed = ['nome', 'tipo', 'erp', 'host', 'port', 'database', 'username', 'password', 'filial', 'encrypt', 'trust_cert', 'ssl', 'ativo', 'configuracoes'];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          const v = req.body[k];
          campos[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
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
  app.post('/api/ia-command/connections/:id/activate', requireAuth, requireIaCommand, canConfigConexoes, (req, res) => {
    const row = crud.buscarPorId('connections', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

    const { getDB } = require('./database');
    const db = getDB();
    // Deactivate all, then activate this one
    db.prepare('UPDATE connections SET ativo = 0 WHERE empresa_id = ?').run(eid(req));
    db.prepare('UPDATE connections SET ativo = 1 WHERE id = ?').run(row.id);
    _invalidarMetaConexao(eid(req));
    res.json({ ok: true });
  });
};
