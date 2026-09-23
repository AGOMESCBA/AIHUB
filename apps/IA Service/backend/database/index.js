const path      = require('path');
const fs        = require('fs');
const Database  = require('better-sqlite3');
const MIGRATIONS = require('./migrations');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'ia-service.db');

let _db = null;

function getDB() {
  if (!_db) throw new Error('[IA Service] Banco não inicializado. Chame inicializarDB() primeiro.');
  return _db;
}

// dbPathOverride existe apenas para os testes automatizados isolarem o banco
// (cada teste usa um arquivo temporário próprio, nunca o ia-service.db real).
// Em produção, index.js chama inicializarDB() sem argumento.
function inicializarDB(dbPathOverride) {
  const dbPath = dbPathOverride || DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  _criarTabelaMigracoes();
  _executarMigracoes();

  console.log('[IA Service] Banco SQLite inicializado:', dbPath);
  return _db;
}

function _criarTabelaMigracoes() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      descricao   TEXT,
      aplicado_em TEXT NOT NULL
    )
  `);
}

function _executarMigracoes() {
  const aplicadas = new Set(
    _db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  const inserir = _db.prepare(
    'INSERT INTO schema_migrations (version, descricao, aplicado_em) VALUES (?, ?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (aplicadas.has(migration.version)) continue;

    try {
      _db.exec(migration.sql);
      inserir.run(migration.version, migration.descricao, new Date().toISOString());
      console.log(`[IA Service] Migração v${migration.version} aplicada: ${migration.descricao}`);
    } catch (err) {
      console.error(`[IA Service] Erro na migração v${migration.version}:`, err.message);
      throw err;
    }
  }
}

function fecharDB() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { inicializarDB, getDB, fecharDB };
