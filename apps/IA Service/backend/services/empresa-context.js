// Resolucao e validacao de empresa corrente para o IA Service.
// Mesmo padrao usado em apps/IA Command/modules/empresa-context.js: aceita
// empresa_id explicito (modo MDI) mas so o aceita se a sessao autenticada
// realmente tiver acesso aquela empresa E ela tiver o sistema 'ia-service'
// habilitado. Nunca confia em empresa_id vindo do corpo/query sem essa dupla
// validacao contra o mecanismo de permissoes ja existente do IA HUB.

const sistemasDb = require('../../../../modules/sistemas/database');

const SYSTEM_CODE = 'ia-service';

function _explicitEmpresaId(req) {
  return Number(req.body?.empresa_id || req.query?.empresa_id || 0);
}

function _sessionEmpresaId(req) {
  return Number(req.session?.empresa_id || 0);
}

function _sessionTemEmpresa(req, empresaId) {
  const { empresas: acesso, role } = req.session || {};
  return role === 'admin' ||
    acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(Number(empresaId)));
}

function resolveEmpresaId(req) {
  if (req.svcEmpresaId) return { ok: true, empresaId: req.svcEmpresaId };

  const explicit = _explicitEmpresaId(req);
  const empresaId = explicit || _sessionEmpresaId(req);
  if (!empresaId) return { ok: false, status: 400, error: 'empresa_id é obrigatório.' };

  if (explicit && !_sessionTemEmpresa(req, explicit)) {
    return { ok: false, status: 403, error: 'Acesso negado a esta empresa.' };
  }

  if (!sistemasDb.hasCompanySystem(empresaId, SYSTEM_CODE)) {
    return { ok: false, status: 403, error: 'Empresa sem acesso ao IA Service.' };
  }

  if (!sistemasDb.hasUserSystem(req.session?.user_id, empresaId, SYSTEM_CODE)) {
    return { ok: false, status: 403, error: 'Usuário sem acesso ao IA Service nesta empresa.' };
  }

  req.svcEmpresaId = Number(empresaId);
  return { ok: true, empresaId: req.svcEmpresaId };
}

function getEmpresaId(req) {
  return resolveEmpresaId(req).empresaId || null;
}

function requireEmpresaContext(req, res, next) {
  const ctx = resolveEmpresaId(req);
  if (!ctx.ok) return res.status(ctx.status || 403).json({ error: ctx.error });
  next();
}

module.exports = { getEmpresaId, requireEmpresaContext, resolveEmpresaId, SYSTEM_CODE };
