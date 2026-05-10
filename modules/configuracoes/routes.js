const db = require('./database');

module.exports = function registerRoutes(app, { requireAuth, requireAdmin, requireEmpresa }) {

  app.get('/api/config/apikeys', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = req.session.empresa_id;
    const cfg = db.getConfig(empresaId);
    res.json({
      groq_api_key:       cfg.groq_api_key   ? db.maskKey(cfg.groq_api_key)   : '',
      gemini_api_key:     cfg.gemini_api_key ? db.maskKey(cfg.gemini_api_key) : '',
      gemini_model:       cfg.gemini_model || 'gemini-1.5-flash',
      groq_configurada:   !!cfg.groq_api_key,
      gemini_configurada: !!cfg.gemini_api_key,
    });
  });

  app.get('/api/config/apikeys/reveal', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = req.session.empresa_id;
    const cfg = db.getConfig(empresaId);
    res.json({
      groq_api_key:   cfg.groq_api_key   || '',
      gemini_api_key: cfg.gemini_api_key || '',
    });
  });

  app.put('/api/config/apikeys', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = req.session.empresa_id;
    const { groq_api_key, gemini_api_key, gemini_model } = req.body || {};
    const patch = {};

    // Empty fields mean "keep current key". Only non-empty, non-masked values overwrite.
    if (groq_api_key !== undefined) {
      const val = String(groq_api_key).trim();
      if (val && !val.includes('•')) patch.groq_api_key = val;
    }
    if (gemini_api_key !== undefined) {
      const val = String(gemini_api_key).trim();
      if (val && !val.includes('•')) patch.gemini_api_key = val;
    }
    if (gemini_model !== undefined)
      patch.gemini_model = (gemini_model || 'gemini-1.5-flash').trim();

    const cfg = db.salvarConfig(patch, empresaId);
    res.json({
      ok: true,
      groq_configurada:   !!cfg.groq_api_key,
      gemini_configurada: !!cfg.gemini_api_key,
    });
  });

};
