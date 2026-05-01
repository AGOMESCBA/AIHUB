const bcrypt    = require('bcryptjs');
const authDb    = require('./database');
const tentativas = require('./tentativas');

// ── Middleware de autenticação ────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Não autenticado' });
}

// ── Verificação de credenciais com bcrypt ────────────────────────────────────

async function verificarCredenciais(usuario, senha) {
  const user = authDb.getUsuarioPorLogin(usuario);
  if (!user || !user.ativo) return null;
  const ok = await bcrypt.compare(senha, user.senha_hash);
  return ok ? user : null;
}

module.exports = { requireAuth, verificarCredenciais };
