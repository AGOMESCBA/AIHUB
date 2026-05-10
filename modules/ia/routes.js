const usageDb = require('./usage-db');
const configDb = require('../configuracoes/database');

module.exports = function registerIaRoutes(app, { requireAuth, requireEmpresa }) {
  app.get('/api/ia/dashboard', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = req.session.empresa_id;
    const cfg = configDb.getConfig(empresaId);
    res.json({
      ...usageDb.getDashboard(empresaId),
      configured: {
        groq: !!cfg.groq_api_key,
        gemini: !!cfg.gemini_api_key,
      },
    });
  });

  app.put('/api/ia/dashboard/settings', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = req.session.empresa_id;
    res.json(usageDb.setSettings(empresaId, {
      limits: req.body?.limits,
      auto_refresh_min: req.body?.auto_refresh_min,
    }));
  });
};
