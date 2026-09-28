// Registry de adapters de importação histórica — resolve o nome gravado em
// `fontes_historicas.adapter` (coluna já existia, migration v11, mas até
// agora sem uso funcional: o orquestrador tinha o SoftExpertSqlServerAdapter
// fixo via require no topo) para o módulo correspondente, em runtime.
//
// Cada novo sistema de chamados (Protheus, ServiceNow, Jira...) vira só um
// novo arquivo adapter + uma entrada aqui — historical-import-service.js não
// precisa mudar.
//
// IMPORTANTE: usar require() puro (sem cache manual próprio) — os testes
// (base-historica-import.test.js) mockam o adapter sobrescrevendo
// require.cache[adapterPath] no caminho físico real do módulo. Um cache
// próprio aqui interceptaria essa substituição e quebraria o mock.

const REGISTRO = {
  SoftExpertSqlServerAdapter: '../softexpert-sqlserver-adapter',
};

const METODOS_OBRIGATORIOS = ['listarChamadosPeriodo', 'listarPosicionamentosDoChamado'];

function resolverAdapter(nomeAdapter) {
  const caminho = REGISTRO[nomeAdapter];
  if (!caminho) {
    throw new Error(`Adapter não registrado: ${nomeAdapter}. Adapters disponíveis: ${Object.keys(REGISTRO).join(', ')}`);
  }

  // eslint-disable-next-line global-require -- resolução dinâmica por design (registry)
  const adapter = require(caminho);

  for (const metodo of METODOS_OBRIGATORIOS) {
    if (typeof adapter[metodo] !== 'function') {
      throw new Error(`Adapter "${nomeAdapter}" não implementa o método obrigatório "${metodo}".`);
    }
  }

  return adapter;
}

module.exports = { resolverAdapter, REGISTRO };
