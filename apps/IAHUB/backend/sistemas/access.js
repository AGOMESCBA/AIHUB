const sistemasDb = require('./database');
const usuariosDb = require('../usuarios/database');
const empresasDb = require('../empresas/database');

function clearInvalidSession(req) {
  if (!req.session) return;
  req.session.system_code = null;
  req.session.system_name = null;
}

function wantsHtml(req) {
  return String(req.headers.accept || '').includes('text/html');
}

function deny(req, res, status, payload) {
  clearInvalidSession(req);
  if (wantsHtml(req)) {
    const shellUrl = process.env.IA_HUB_SHELL_URL || '';
    const target = status === 401
      ? `${shellUrl}/login.html?next=${encodeURIComponent(req.originalUrl || '/')}`
      : `${shellUrl}/iahub.html`;
    return res.redirect(target);
  }
  return res.status(status).json(payload);
}

function requireSystemAccess(systemCode) {
  return (req, res, next) => {
    if (process.env.ALLOW_STANDALONE_ACCESS === 'true') return next();

    if (process.env.IA_HUB_AUTH_REQUIRED === 'false') return next();

    if (!req.session?.authenticated) {
      return deny(req, res, 401, { error: 'Nao autenticado', loginUrl: process.env.IA_HUB_SHELL_URL || '/' });
    }

    const user = usuariosDb.buscarPorId(req.session.user_id);
    if (!user?.ativo) {
      return deny(req, res, 401, { error: 'Usuario inativo' });
    }

    const companyId = Number(req.session.empresa_id || req.query?.empresa_id || req.body?.empresa_id || 0);
    if (!companyId) {
      return deny(req, res, 403, { error: 'Nenhuma empresa selecionada', precisaEmpresa: true });
    }

    const empresa = empresasDb.buscarPorId(companyId);
    if (!empresa) {
      return deny(req, res, 403, { error: 'Empresa invalida' });
    }

    const system = sistemasDb.getSystem(systemCode);
    if (!system?.active) {
      return deny(req, res, 403, { error: 'Sistema inativo' });
    }

    if (req.session.system_code !== systemCode) {
      return deny(req, res, 403, { error: 'Sistema nao selecionado', precisaSistema: true });
    }

    if (!sistemasDb.hasCompanySystem(companyId, systemCode)) {
      return deny(req, res, 403, { error: 'Empresa sem acesso ao sistema' });
    }

    if (!sistemasDb.hasUserSystem(req.session.user_id, companyId, systemCode)) {
      return deny(req, res, 403, { error: 'Usuario sem acesso ao sistema' });
    }

    req.system = { code: system.code, name: system.name, company_id: companyId };
    next();
  };
}

module.exports = { requireSystemAccess };
