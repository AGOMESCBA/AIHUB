// Middleware que valida o token de sessão externa (login por telefone/
// WhatsApp, ver login-externo-service.js) e popula req.svcEmpresaId +
// req.svcConsultorExterno — usado só pelas rotas dedicadas em
// routes/externo-routes.js (namespace /api/ia-service-externo/*), que NÃO
// passam por requireAuth/requireIaService/requireEmpresaContext (essas
// exigem sessão de cookie do IA HUB, que uma sessão externa não tem).

const loginExternoService = require('./login-externo-service');

function requireSessaoExterna(req, res, next) {
  const token = req.headers['x-sessao-externa'];
  if (!token) return res.status(401).json({ error: 'Sessão externa ausente.' });

  const sessao = loginExternoService.validarSessaoExterna(String(token));
  if (!sessao) return res.status(401).json({ error: 'Sessão externa inválida ou expirada.' });

  req.svcEmpresaId = sessao.empresaId;
  req.svcConsultorExterno = sessao.consultorId;
  next();
}

module.exports = { requireSessaoExterna };
