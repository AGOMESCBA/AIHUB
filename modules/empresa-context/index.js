// Middleware e helpers de contexto de empresa na sessão.
// Phase 3: infraestrutura pronta — aplicação às rotas de dados na Fase 5.

// Rotas que não exigem empresa selecionada
const ROTAS_LIVRES = [
  '/api/login', '/api/logout', '/api/me',
  '/api/empresas', '/api/usuarios', '/api/seguranca',
];

function isRotaLivre(path) {
  return ROTAS_LIVRES.some(r => path === r || path.startsWith(r + '/'));
}

/**
 * Middleware que exige empresa_id na sessão.
 * Retorna 403 com { precisaEmpresa: true } quando não selecionada.
 * Rotas de administração (login, empresas, usuários, segurança) são liberadas.
 */
function requireEmpresa(req, res, next) {
  if (isRotaLivre(req.path)) return next();
  if (req.session?.empresa_id) return next();
  res.status(403).json({ error: 'Nenhuma empresa selecionada', precisaEmpresa: true });
}

module.exports = { requireEmpresa, isRotaLivre };
