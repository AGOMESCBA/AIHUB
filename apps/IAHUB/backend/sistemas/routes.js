const db = require('./database');
const { registrarAuditoria } = require('../auth/database');

function obterIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'desconhecido';
}

module.exports = function registerSistemasRoutes(app, { requireAuth, requireAdmin }) {
  app.get('/api/sistemas/disponiveis', requireAuth, (req, res) => {
    const companyId = Number(req.query.empresa_id || req.session.empresa_id || 0);
    if (!companyId) return res.json([]);
    res.json(db.listarDisponiveis(req.session.user_id, companyId));
  });

  app.post('/api/sistemas/selecionar', requireAuth, (req, res) => {
    const systemCode = String(req.body?.system_code || '').trim();
    const companyId = Number(req.body?.empresa_id || req.session.empresa_id || 0);
    if (!systemCode) return res.status(400).json({ error: 'system_code e obrigatorio' });
    if (!companyId) return res.status(400).json({ error: 'empresa_id e obrigatorio' });

    const system = db.getSystem(systemCode);
    console.log(`[DEBUG] Selecionando sistema: ${systemCode}`, { systemFound: !!system, systemCode: system?.code, systemUrl: system?.url });
    if (!system?.active) return res.status(404).json({ error: 'Sistema nao encontrado ou inativo' });
    if (!db.hasCompanySystem(companyId, systemCode)) return res.status(403).json({ error: 'Empresa sem acesso ao sistema' });
    if (!db.hasUserSystem(req.session.user_id, companyId, systemCode)) return res.status(403).json({ error: 'Usuario sem acesso ao sistema' });

    req.session.system_code = system.code;
    req.session.system_name = system.name;

    registrarAuditoria({
      usuario: req.session.user,
      acao: 'sistema_selecionado',
      ip: obterIp(req),
      empresa_id: companyId,
      detalhes: system.code,
    });

    req.session.save(err => {
      if (err) return res.status(500).json({ error: 'Erro ao salvar sessao' });
      res.json({ ok: true, system, redirectUrl: system.url });
    });
  });

  app.get('/api/session/sistema', requireAuth, (req, res) => {
    res.json({
      system_code: req.session.system_code || null,
      system_name: req.session.system_name || null,
    });
  });

  app.get('/api/sistemas', requireAuth, requireAdmin, (req, res) => {
    res.json(db.listarSystems());
  });

  app.put('/api/sistemas/:code', requireAuth, requireAdmin, (req, res) => {
    const code = String(req.params.code || '').trim();
    const body = req.body || {};
    const patch = {};
    for (const key of ['name', 'description', 'url', 'image_url', 'accent', 'badge']) {
      if (body[key] !== undefined) patch[key] = String(body[key] || '').trim();
    }
    if (body.active !== undefined) patch.active = body.active !== false;
    const system = db.atualizarSystem(code, patch);
    if (!system) return res.status(404).json({ error: 'Sistema nao encontrado.' });
    res.json(system);
  });

  app.get('/api/empresas/:id/sistemas', requireAuth, requireAdmin, (req, res) => {
    const companyId = Number(req.params.id);
    const rows = db.listarCompanySystems().filter(r => Number(r.company_id) === companyId);
    res.json(db.listarSystems().map(system => ({
      ...system,
      company_id: companyId,
      granted: !!rows.find(r => r.system_code === system.code && r.active),
    })));
  });

  app.put('/api/empresas/:id/sistemas', requireAuth, requireAdmin, (req, res) => {
    db.salvarCompanySystems(req.params.id, req.body?.systems || []);
    res.json({ ok: true });
  });

  app.get('/api/usuarios/:id/sistemas', requireAuth, requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    const companyId = Number(req.query.empresa_id || 0);
    if (!companyId) return res.status(400).json({ error: 'empresa_id e obrigatorio' });
    const rows = db.listarUserSystems().filter(r => Number(r.user_id) === userId && Number(r.company_id) === companyId);
    res.json(db.listarSystems().map(system => ({
      ...system,
      user_id: userId,
      company_id: companyId,
      granted: !!rows.find(r => r.system_code === system.code && r.active),
    })));
  });

  app.put('/api/usuarios/:id/sistemas', requireAuth, requireAdmin, (req, res) => {
    const companyId = Number(req.body?.empresa_id || 0);
    if (!companyId) return res.status(400).json({ error: 'empresa_id e obrigatorio' });
    db.salvarUserSystems(req.params.id, companyId, req.body?.systems || []);
    res.json({ ok: true });
  });
};
