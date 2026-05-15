const erpRegistry   = require('../erp/erp-registry');
const factory       = require('../erp/providers/connection-factory');
const { resolverPeriodo } = require('../ai/period-resolver');

async function executar(intent, empresaId) {
  const conn = factory.carregarConexao(empresaId);
  intent.periodo = { ...intent.periodo, ...resolverPeriodo(intent.periodo) };
  const BuilderClass = erpRegistry.getBuilder(conn.erp, 'financeiro');
  const builder = new BuilderClass(conn);
  const { sql, params } = builder.compile(intent);
  const rows = await factory.executar(conn, sql, params);
  return { intencao: intent.intencao, acao: intent.acao, periodo: intent.periodo, rows };
}

module.exports = { executar };
