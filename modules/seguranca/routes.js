const db = require('./database');

module.exports = function registerRoutes(app, { requireAuth }) {

  // ── Ler configurações ──────────────────────────────────────────────────────
  app.get('/api/seguranca', requireAuth, (req, res) => {
    res.json(db.getConfig());
  });

  // ── Salvar configurações ───────────────────────────────────────────────────
  app.put('/api/seguranca', requireAuth, (req, res) => {
    try {
      const config = db.salvarConfig(req.body || {});
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Log de auditoria ───────────────────────────────────────────────────────
  app.get('/api/seguranca/auditoria', requireAuth, (req, res) => {
    const { limite, usuario, acao, data_ini, data_fim } = req.query;
    res.json(db.getAuditoria({
      limite:   Number(limite) || 200,
      usuario:  usuario  || '',
      acao:     acao     || '',
      data_ini: data_ini || '',
      data_fim: data_fim || '',
    }));
  });

};
