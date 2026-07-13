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

  // Se agente local estiver ativo, roteia para ele em vez da conexão ERP direta
  const aiCfg = db.prepare(
    `SELECT agente_local_ativo, agente_local_url, agente_local_token,
            agente_local_crypto_key, agente_local_crypto_ativo
       FROM ai_config WHERE empresa_id = ? LIMIT 1`
  ).get(empresaId);
  if (aiCfg?.agente_local_ativo && aiCfg?.agente_local_url && aiCfg?.agente_local_token) {
    // Normaliza: usa só scheme://host:port, ignora qualquer path que o usuário tenha digitado
    let baseUrl = aiCfg.agente_local_url.trim();
    try {
      const u = new URL(baseUrl);
      baseUrl = `${u.protocol}//${u.host}`;
    } catch (_) { /* mantém como está */ }
    return {
      tipo:       'api_proxy',
      host:       baseUrl,
      database:   '/',
      password:   aiCfg.agente_local_token,
      crypto_key: aiCfg.agente_local_crypto_key || '',
      crypto_ativo: aiCfg.agente_local_crypto_ativo ? 1 : 0,
      _agente_url: baseUrl,
    };
  }

  let row = db.prepare(
    "SELECT * FROM connections WHERE empresa_id = ? AND ativo = 1 ORDER BY criado_em DESC LIMIT 1"
  ).get(empresaId);
  if (!row) {
    const sx2Row = db.prepare("SELECT connection_id FROM protheus_sx2 WHERE empresa_id = ? LIMIT 1").get(empresaId);
    if (sx2Row?.connection_id) {
      row = db.prepare("SELECT * FROM connections WHERE id = ? AND ativo = 1").get(sx2Row.connection_id);
    }
  }
  if (!row) throw new Error('Nenhuma conexão ativa configurada para esta empresa.');
  return row;
}

module.exports = { getProvider, testar, executar, fechar, carregarConexao };
