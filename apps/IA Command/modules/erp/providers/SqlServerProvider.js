const sql = require('mssql');

// Pool keyed by connection id
const pools = new Map();

const _NOLOCK_RESERVED = new Set([
  'WHERE', 'ON', 'SET', 'SELECT', 'GROUP', 'ORDER', 'HAVING', 'UNION',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'AND', 'OR',
  'NOT', 'IN', 'IS', 'AS', 'BY', 'NULL', 'BETWEEN', 'LIKE', 'JOIN',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
]);

function _injetarNolock(query) {
  if (!query || !/\b(?:FROM|JOIN)\b/i.test(query)) return query;
  return query.replace(
    /\b(FROM|JOIN)\s+(\w[\w.]*)\s+(?:AS\s+)?(\w+)(?!\s*WITH\s*\()/gi,
    (match, kw, table, alias) => {
      if (_NOLOCK_RESERVED.has(alias.toUpperCase())) {
        return `${kw} ${table} WITH (NOLOCK) ${alias}`;
      }
      return `${kw} ${table} ${alias} WITH (NOLOCK)`;
    }
  );
}

function _buildConfig(conn) {
  return {
    server:   conn.host,
    port:     conn.port ? Number(conn.port) : 1433,
    database: conn.database,
    user:     conn.username,
    password: conn.password,
    options: {
      encrypt:                conn.encrypt === true || conn.encrypt === 1,
      trustServerCertificate: conn.trust_cert !== false && conn.trust_cert !== 0,
      enableArithAbort:       true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout:    30000,
  };
}

async function getPool(conn) {
  if (pools.has(conn.id)) {
    const p = pools.get(conn.id);
    if (p.connected) return p;
    pools.delete(conn.id);
  }

  const pool = await new sql.ConnectionPool(_buildConfig(conn)).connect();
  pools.set(conn.id, pool);
  return pool;
}

async function testar(conn) {
  const pool = await getPool(conn);
  await pool.request().query('SELECT 1 AS ok');
  return true;
}

async function executar(conn, query, params = {}) {
  const pool = await getPool(conn);
  const req  = pool.request();

  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) {
      req.input(k, sql.VarChar, null);
    } else if (typeof v === 'number') {
      req.input(k, sql.Float, v);
    } else {
      req.input(k, sql.VarChar, String(v));
    }
  }

  const result = await req.query(_injetarNolock(query));
  return result.recordset;
}

async function fechar(connId) {
  if (pools.has(connId)) {
    await pools.get(connId).close();
    pools.delete(connId);
  }
}

module.exports = { testar, executar, fechar };
