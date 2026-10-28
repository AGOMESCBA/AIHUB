// Checagem de rotina no SERVIDOR para o IA Service — mesma regra de
// apps/IA Command/modules/permissions.js (admin passa; demais usuários
// precisam da rotina liberada para a empresa da requisição). Até o Monitor
// de Acessos (2026-10) o IA Service só filtrava rotinas no menu; uma rota
// administrativa não pode depender só do menu escondido.
//
// Usar SEMPRE depois de requireEmpresaContext (precisa de req.svcEmpresaId
// já validado contra o acesso do usuário à empresa).

const permissoesDb = require('../../../IAHUB/backend/permissoes/database');

// Aceita uma rotina ou uma lista (basta ter uma delas).
function requireRotinaSvc(rotinaIds) {
  const exigidas = Array.isArray(rotinaIds) ? rotinaIds : [rotinaIds];
  return (req, res, next) => {
    if (req.session?.role === 'admin') return next();
    const empresaId = Number(req.svcEmpresaId || 0);
    const userId = Number(req.session?.user_id || 0);
    if (!userId) return res.status(401).json({ error: 'Usuário não identificado.' });
    if (!empresaId) return res.status(403).json({ error: 'Usuário sem permissão para esta rotina.' });
    const rotinas = permissoesDb.getRotinas(userId, empresaId);
    if (Array.isArray(rotinas) && exigidas.some(r => rotinas.includes(r))) return next();
    return res.status(403).json({ error: 'Usuário sem permissão para esta rotina.' });
  };
}

// Rotinas exigidas por grupo de API interna (/api/ia-service/*), 2026-10-28.
// Antes só o menu escondia as telas: qualquer usuário com o IA Service na
// empresa chamava direto Configuração de IA, zerar Base Histórica, token do
// agente local etc. Cada grupo exige a rotina da(s) tela(s) que o usa(m) —
// conferido nos fetch de frontend/*.html. Fora desta lista de propósito:
// presenca (sinal de qualquer tela), monitor-acessos e numeros-autorizados
// (guarda própria nas rotas). O acesso externo (/api/ia-service-externo, login
// por telefone do J2A) não passa por aqui.
const ROTINAS_POR_PREFIXO = Object.freeze([
  ['/api/ia-service/config/ia', ['svc-config-ia']],
  ['/api/ia-service/base-historica/agente-local', ['svc-config-ia', 'svc-base-historica']],
  ['/api/ia-service/base-historica', ['svc-base-historica']],
  ['/api/ia-service/consultores', ['svc-consultores']],
  ['/api/ia-service/homologacao', ['svc-homologacao']],
  ['/api/ia-service/radar', ['svc-radar']],
  ['/api/ia-service/atendimentos', ['svc-radar', 'svc-atendimentos', 'svc-homologacao']],
  ['/api/ia-service/anexos', ['svc-radar', 'svc-atendimentos', 'svc-homologacao']],
]);

// Registrar DEPOIS de requireEmpresaContext. Usa só o primeiro prefixo que
// casar (a lista vai do mais específico ao mais genérico).
function aplicarRotinasPorPrefixo(app) {
  const guardas = ROTINAS_POR_PREFIXO.map(([prefixo, rotinas]) => [prefixo, requireRotinaSvc(rotinas)]);
  app.use('/api/ia-service', (req, res, next) => {
    const caminho = req.baseUrl + req.path;
    const achado = guardas.find(([prefixo]) => caminho === prefixo || caminho.startsWith(prefixo + '/'));
    return achado ? achado[1](req, res, next) : next();
  });
}

module.exports = { requireRotinaSvc, aplicarRotinasPorPrefixo, ROTINAS_POR_PREFIXO };
