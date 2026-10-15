// Checagem de rotina no SERVIDOR para o IA Service — mesma regra de
// apps/IA Command/modules/permissions.js (admin passa; demais usuários
// precisam da rotina liberada para a empresa da requisição). Até o Monitor
// de Acessos (2026-10) o IA Service só filtrava rotinas no menu; uma rota
// administrativa não pode depender só do menu escondido.
//
// Usar SEMPRE depois de requireEmpresaContext (precisa de req.svcEmpresaId
// já validado contra o acesso do usuário à empresa).

const permissoesDb = require('../../../IAHUB/backend/permissoes/database');

function requireRotinaSvc(rotinaId) {
  return (req, res, next) => {
    if (req.session?.role === 'admin') return next();
    const empresaId = Number(req.svcEmpresaId || 0);
    const userId = Number(req.session?.user_id || 0);
    if (!empresaId || !userId) return res.status(403).json({ error: 'Usuário sem permissão para esta rotina.' });
    const rotinas = permissoesDb.getRotinas(userId, empresaId);
    if (Array.isArray(rotinas) && rotinas.includes(rotinaId)) return next();
    return res.status(403).json({ error: 'Usuário sem permissão para esta rotina.' });
  };
}

module.exports = { requireRotinaSvc };
