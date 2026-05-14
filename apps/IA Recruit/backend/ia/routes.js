const usageDb = require('./usage-db');
const configDb = require('../configuracoes/database');

function _resolverEid(req) {
  const explicit = Number(req.body?.empresa_id || req.query?.empresa_id || 0);
  if (!explicit) return req.session.empresa_id;
  const { empresas: acesso, role } = req.session;
  const ok = role === 'admin' || acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(explicit));
  return ok ? explicit : req.session.empresa_id;
}

module.exports = function registerIaRoutes(app, { requireAuth, requireEmpresa }) {
  app.get('/api/ia/dashboard', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = _resolverEid(req);
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
    const empresaId = _resolverEid(req);
    res.json(usageDb.setSettings(empresaId, {
      limits: req.body?.limits,
      auto_refresh_min: req.body?.auto_refresh_min,
    }));
  });
};
