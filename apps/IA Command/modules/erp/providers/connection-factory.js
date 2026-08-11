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
  if (!p) throw new Error(`Tipo de conexao nao suportado: "${tipo}". Use: sqlserver, postgresql, sqlite, api_proxy`);
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

function _normalizarAgenteUrl(url) {
  let baseUrl = String(url || '').trim();
  try {
    const u = new URL(baseUrl);
    baseUrl = `${u.protocol}//${u.host}`;
  } catch (_) { /* mantem como esta */ }
  return baseUrl;
}

function _carregarConnectionRow(db, empresaId, opts = {}) {
  if (opts.connectionId) {
    return db.prepare("SELECT * FROM connections WHERE id = ? AND empresa_id = ?")
      .get(opts.connectionId, empresaId);
  }
  if (opts.connectionKey) {
    return db.prepare("SELECT * FROM connections WHERE empresa_id = ? AND connection_key = ?")
      .get(empresaId, opts.connectionKey);
  }
  if (opts.sistemaOrigem) {
    let row = db.prepare(
      "SELECT * FROM connections WHERE empresa_id = ? AND ativo = 1 AND LOWER(erp) = LOWER(?) ORDER BY padrao DESC, criado_em DESC LIMIT 1"
    ).get(empresaId, opts.sistemaOrigem);
    if (row) return row;
    return null;
  }
  // Sem sistema informado: mantém o comportamento legado (pré-multi-sistema), restrito a Protheus,
  // que é o único ERP que já operava sem exigir opts explícito.
  let row = db.prepare(
    "SELECT * FROM connections WHERE empresa_id = ? AND ativo = 1 AND erp = 'protheus' ORDER BY padrao DESC, criado_em DESC LIMIT 1"
  ).get(empresaId);
  if (!row) {
    const sx2Row = db.prepare("SELECT connection_id FROM protheus_sx2 WHERE empresa_id = ? LIMIT 1").get(empresaId);
    if (sx2Row?.connection_id) {
      row = db.prepare("SELECT * FROM connections WHERE id = ? AND ativo = 1 AND erp = 'protheus'").get(sx2Row.connection_id);
    }
  }
  return row || null;
}

function _montarApiProxy(aiCfg, connectionRow = null) {
  const baseUrl = _normalizarAgenteUrl(aiCfg.agente_local_url);
  return {
    tipo:       'api_proxy',
    host:       baseUrl,
    database:   '/',
    password:   aiCfg.agente_local_token,
    crypto_key: aiCfg.agente_local_crypto_key || '',
    crypto_ativo: aiCfg.agente_local_crypto_ativo ? 1 : 0,
    _agente_url: baseUrl,
    _connection_id: connectionRow?.id || '',
    _connection_key: connectionRow?.connection_key || '',
    _connection_nome: connectionRow?.nome || '',
    _connection_erp: connectionRow?.erp || '',
  };
}

// Load active connection config for a company from SQLite.
function carregarConexao(empresaId, opts = {}) {
  const { getDB } = require('../../database');
  const db = getDB();
  const connectionRow = (opts.connectionId || opts.connectionKey || opts.sistemaOrigem)
    ? _carregarConnectionRow(db, empresaId, opts)
    : null;

  if ((opts.connectionId || opts.connectionKey) && !connectionRow) {
    throw new Error('Conexao de dados nao encontrada para esta empresa.');
  }
  if (opts.sistemaOrigem && !connectionRow) {
    throw new Error(`Nenhuma conexao ativa cadastrada para o sistema "${opts.sistemaOrigem}" nesta empresa.`);
  }

  const aiCfg = db.prepare(
    `SELECT agente_local_ativo, agente_local_url, agente_local_token,
            agente_local_crypto_key, agente_local_crypto_ativo
       FROM ai_config WHERE empresa_id = ? LIMIT 1`
  ).get(empresaId);

  if (aiCfg?.agente_local_ativo && aiCfg?.agente_local_url && aiCfg?.agente_local_token) {
    return _montarApiProxy(aiCfg, connectionRow);
  }

  const row = connectionRow || _carregarConnectionRow(db, empresaId, opts);
  if (!row) throw new Error('Nenhuma conexao ativa configurada para esta empresa.');
  return row;
}

module.exports = { getProvider, testar, executar, fechar, carregarConexao };
