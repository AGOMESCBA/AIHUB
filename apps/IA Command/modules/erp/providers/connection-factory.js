const SqlServerProvider  = require('./SqlServerProvider');
const PostgreSqlProvider = require('./PostgreSqlProvider');
const SqliteProvider     = require('./SqliteProvider');
const ApiProxyProvider   = require('./ApiProxyProvider');

const PROVIDERS = {
  sqlserver:  SqlServerProvider,
  mssql:      SqlServerProvider,
  postgresql: PostgreSqlProvider,
  postgres:   PostgreSqlProvider,
  sqlite:     SqliteProvider,
  api_proxy:  ApiProxyProvider,
};

function getProvider(tipo) {
  const p = PROVIDERS[tipo?.toLowerCase()];
  if (!p) throw new Error(`Tipo de conexão não suportado: "${tipo}". Use: sqlserver, postgresql, sqlite, api_proxy`);
  return p;
}

async function testar(conn) {
  return getProvider(conn.tipo).testar(conn);
}

async function executar(conn, query, params) {
  return getProvider(conn.tipo).executar(conn, query, params);
}

async function fechar(conn) {
  return getProvider(conn.tipo).fechar(conn.id);
}

// Load active connection config for a company from SQLite
function carregarConexao(empresaId) {
  const { getDB } = require('../../database');
  const db  = getDB();
  const row = db.prepare(
    "SELECT * FROM connections WHERE empresa_id = ? AND ativo = 1 ORDER BY criado_em DESC LIMIT 1"
  ).get(empresaId);
  if (!row) throw new Error('Nenhuma conexão ativa configurada para esta empresa.');
  return row;
}

module.exports = { getProvider, testar, executar, fechar, carregarConexao };
