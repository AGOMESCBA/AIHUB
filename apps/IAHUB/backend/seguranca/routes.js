const db = require('./database');
const { requireAdmin } = require('../auth');

// 2026-10-28: gravação e leitura de cadastro só para admin. Antes bastava
// estar logado — um usuário comum conseguia, chamando a API direto, criar um
// admin, se promover ou dar rotinas a si mesmo (achado na auditoria de
// segurança do IA Service). As telas que usam estas rotas já são de admin.

module.exports = function registerRoutes(app, { requireAuth }) {

  // ── Ler configurações ──────────────────────────────────────────────────────
  app.get('/api/seguranca', requireAuth, (req, res) => {
    res.json(db.getConfig());
  });

  // ── Salvar configurações ───────────────────────────────────────────────────
  app.put('/api/seguranca', requireAuth, requireAdmin, (req, res) => {
    try {
      const config = db.salvarConfig(req.body || {});
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Log de auditoria ───────────────────────────────────────────────────────
  app.get('/api/seguranca/auditoria', requireAuth, requireAdmin, (req, res) => {
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
