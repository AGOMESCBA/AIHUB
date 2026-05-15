const permissoesDb = require('../../../modules/permissoes/database');

function requireRotina(rotinaId) {
  return (req, res, next) => {
    if (req.session?.role === 'admin') return next();

    const empresaId = Number(req.session?.empresa_id || 0);
    const userId = Number(req.session?.user_id || 0);
    const rotinas = permissoesDb.getRotinas(userId, empresaId);

    if (Array.isArray(rotinas) && rotinas.includes(rotinaId)) return next();
    return res.status(403).json({ error: 'Usuario sem permissao para esta rotina.' });
  };
}

module.exports = { requireRotina };
