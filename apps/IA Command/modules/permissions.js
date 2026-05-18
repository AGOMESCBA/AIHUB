const permissoesDb = require('../../../modules/permissoes/database');
const { resolveEmpresaId } = require('./empresa-context');

function requireRotina(rotinaId) {
  return (req, res, next) => {
    const ctx = resolveEmpresaId(req);
    if (!ctx.ok) return res.status(ctx.status || 403).json({ error: ctx.error });

    if (req.session?.role === 'admin') return next();

    const empresaId = Number(ctx.empresaId || 0);
    const userId = Number(req.session?.user_id || 0);
    const rotinas = permissoesDb.getRotinas(userId, empresaId);

    if (Array.isArray(rotinas) && rotinas.includes(rotinaId)) return next();
    return res.status(403).json({ error: 'Usuario sem permissao para esta rotina.' });
  };
}

module.exports = { requireRotina };
