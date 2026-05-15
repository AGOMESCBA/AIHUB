const { Pool } = require('pg');

const pools = new Map();

function _buildConfig(conn) {
  return {
    host:     conn.host,
    port:     conn.port || 5432,
    database: conn.database,
    user:     conn.username,
    password: conn.password,
    ssl:      conn.ssl ? { rejectUnauthorized: false } : false,
    max:      10,
    idleTimeoutMillis:    30000,
    connectionTimeoutMillis: 15000,
  };
}

function getPool(conn) {
  if (!pools.has(conn.id)) {
    pools.set(conn.id, new Pool(_buildConfig(conn)));
  }
  return pools.get(conn.id);
}

async function testar(conn) {
  const pool   = getPool(conn);
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

async function executar(conn, query, params = {}) {
  const pool = getPool(conn);

  // Convert named params (@param) to positional ($1, $2, ...)
  const values = [];
  let i = 1;
  const pgQuery = query.replace(/@(\w+)/g, (_, name) => {
    values.push(params[name] ?? null);
    return `$${i++}`;
  });

  const result = await pool.query(pgQuery, values);
  return result.rows;
}

async function fechar(connId) {
  if (pools.has(connId)) {
    await pools.get(connId).end();
    pools.delete(connId);
  }
}

module.exports = { testar, executar, fechar };
