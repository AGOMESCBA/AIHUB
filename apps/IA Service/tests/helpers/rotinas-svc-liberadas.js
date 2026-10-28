// Testes de rota HTTP do IA Service simulam um usuário comum ({ user_id })
// sem permissões cadastradas. Desde 2026-10-28 cada grupo de API exige a
// rotina da tela (services/rotina-permissao.js), então esses testes liberam
// todas as rotinas svc-* para o usuário simulado — o assunto deles é a regra
// de negócio, não a permissão (coberta em numeros-autorizados.test.js).
// Precisa ser o PRIMEIRO require do teste (antes de qualquer rota/serviço).

const ROTINAS_SVC = ['svc-radar', 'svc-atendimentos', 'svc-homologacao', 'svc-monitor-acessos',
  'svc-numeros-autorizados', 'svc-base-historica', 'svc-config-ia', 'svc-consultores'];

require.cache[require.resolve('../../../IAHUB/backend/permissoes/database')] = {
  id: 'permissoes-mock', filename: 'permissoes-mock', loaded: true,
  exports: { getRotinas: () => ROTINAS_SVC.slice() },
};

module.exports = { ROTINAS_SVC };
