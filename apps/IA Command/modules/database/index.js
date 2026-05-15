const path      = require('path');
const fs        = require('fs');
const Database  = require('better-sqlite3');
const MIGRATIONS = require('./migrations');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'ia-command.db');

let _db = null;

function getDB() {
  if (!_db) throw new Error('[IA Command] Banco não inicializado. Chame inicializarDB() primeiro.');
  return _db;
}

function inicializarDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _criarTabelaMigracoes();
  _executarMigracoes();
  _garantirColunasCompatibilidade();

  console.log('[IA Command] Banco SQLite inicializado:', DB_PATH);
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
      console.log(`[IA Command] Migração v${migration.version} aplicada: ${migration.descricao}`);
    } catch (err) {
      console.error(`[IA Command] Erro na migração v${migration.version}:`, err.message);
      throw err;
    }
  }
}

function _temColuna(tabela, coluna) {
  return _db.prepare(`PRAGMA table_info(${tabela})`).all().some(c => c.name === coluna);
}

function _adicionarColunaSeFaltar(tabela, coluna, definicao) {
  if (_temColuna(tabela, coluna)) return;
  _db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

function _garantirColunasCompatibilidade() {
  const connections = {
    port: 'INTEGER',
    database: 'TEXT',
    username: 'TEXT',
    password: 'TEXT',
    filial: 'TEXT',
    encrypt: 'INTEGER DEFAULT 0',
    trust_cert: 'INTEGER DEFAULT 1',
    ssl: 'INTEGER DEFAULT 0',
    ultimo_teste: 'TEXT',
    teste_ok: 'INTEGER DEFAULT 0',
  };

  const aiConfig = {
    groq_api_key: 'TEXT',
    gemini_api_key: 'TEXT',
    openai_api_key: 'TEXT',
    claude_api_key: 'TEXT',
    provedor_primario: "TEXT DEFAULT 'groq'",
    confianca_minima: 'REAL DEFAULT 0.6',
    whisper_model: "TEXT DEFAULT 'whisper-large-v3'",
    audio_idioma: "TEXT DEFAULT 'pt'",
  };

  for (const [coluna, definicao] of Object.entries(connections)) {
    _adicionarColunaSeFaltar('connections', coluna, definicao);
  }

  for (const [coluna, definicao] of Object.entries(aiConfig)) {
    _adicionarColunaSeFaltar('ai_config', coluna, definicao);
  }
}

module.exports = { inicializarDB, getDB };
