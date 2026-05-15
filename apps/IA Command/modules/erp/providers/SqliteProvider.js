// SQLite provider — used for local testing/demo without a real ERP connection

const Database = require('better-sqlite3');
const dbs = new Map();

function getDb(conn) {
  if (!dbs.has(conn.id)) {
    dbs.set(conn.id, new Database(conn.host)); // host = file path for SQLite
  }
  return dbs.get(conn.id);
}

async function testar(conn) {
  getDb(conn).prepare('SELECT 1').get();
  return true;
}

async function executar(conn, query, params = {}) {
  const db      = getDb(conn);
  // Convert named @params to ?-positional for better-sqlite3
  const keys    = [];
  const sqlSafe = query.replace(/@(\w+)/g, (_, name) => { keys.push(name); return '?'; });
  const values  = keys.map((k) => params[k] ?? null);
  return db.prepare(sqlSafe).all(...values);
}

async function fechar(connId) {
  if (dbs.has(connId)) {
    dbs.get(connId).close();
    dbs.delete(connId);
  }
}

module.exports = { testar, executar, fechar };
