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
  _db.exec(`
    CREATE TABLE IF NOT EXISTS interpretation_log (
      id                    TEXT PRIMARY KEY,
      empresa_id            INTEGER,
      usuario               TEXT,
      numero_wa             TEXT,
      canal_id              TEXT,
      texto_original        TEXT NOT NULL,
      intent_json           TEXT,
      intencao              TEXT,
      periodo_json          TEXT,
      filtros_json          TEXT,
      agrupar_por           TEXT,
      ordenar_por           TEXT,
      limite                INTEGER,
      sinonimos_aplicados   TEXT,
      campos_inferidos_ia   TEXT,
      provedor              TEXT,
      confianca             REAL,
      origem                TEXT,
      cache_hit             INTEGER DEFAULT 0,
      fallback_usado        INTEGER DEFAULT 0,
      precisa_confirmacao   INTEGER DEFAULT 0,
      resultado_tipo        TEXT,
      dataset_id            TEXT,
      dataset_nome          TEXT,
      rows_count            INTEGER,
      resposta_entregue     TEXT,
      trace_json            TEXT,
      feedback              TEXT,
      feedback_observacao   TEXT,
      criado_em             TEXT NOT NULL,
      atualizado_em         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_iac_interpretation_empresa_data
      ON interpretation_log (empresa_id, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_interpretation_intencao
      ON interpretation_log (empresa_id, intencao, confianca);
  `);

  const interpretationLog = {
    sql_gerado: 'TEXT',
    duracao_ms: 'INTEGER',
    trace_json: 'TEXT',
    modulo: 'TEXT',
    escopo_execucao: 'TEXT',
    sql_canonico_origem: 'TEXT',
    sql_canonico_empresa_origem: 'INTEGER',
    sql_canonico_original: 'TEXT',
    sql_canonico_adaptado: 'TEXT',
    sql_auditoria_json: 'TEXT',
    sql_canonico_parametros_json: 'TEXT',
    sql_canonico_parametrizado: 'INTEGER DEFAULT 0',
    sql_ia_bruto: 'TEXT',
    sql_final_executado: 'TEXT',
    sql_canonico_reuso_motivo: 'TEXT',
    sql_canonico_reuso_permitido: 'INTEGER DEFAULT NULL',
    sql_canonico_empresa_atual: 'INTEGER DEFAULT NULL',
  };

  for (const [coluna, definicao] of Object.entries(interpretationLog)) {
    _adicionarColunaSeFaltar('interpretation_log', coluna, definicao);
  }

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
    configuracoes: 'TEXT',
  };

  const aiConfig = {
    groq_api_key: 'TEXT',
    gemini_api_key: 'TEXT',
    deepseek_api_key: 'TEXT',
    claude_api_key: 'TEXT',
    openai_api_key: 'TEXT',
    provedor_primario: "TEXT DEFAULT 'groq'",
    fallback_ordem: "TEXT DEFAULT 'groq,openai,gemini,deepseek,claude'",
    confianca_minima: 'REAL DEFAULT 0.6',
    whisper_model: "TEXT DEFAULT 'whisper-large-v3'",
    audio_idioma: "TEXT DEFAULT 'pt'",
  };

  const datasets = {
    sql_base:        'TEXT',
    campo_data:      "TEXT DEFAULT 'data'",
    colunas_metrica: 'TEXT',
  };

  const whatsappAllowedNumbers = {
    wa_lid: 'TEXT',
  };

  for (const [coluna, definicao] of Object.entries(connections)) {
    _adicionarColunaSeFaltar('connections', coluna, definicao);
  }

  for (const [coluna, definicao] of Object.entries(aiConfig)) {
    _adicionarColunaSeFaltar('ai_config', coluna, definicao);
  }

  for (const [coluna, definicao] of Object.entries(datasets)) {
    _adicionarColunaSeFaltar('datasets', coluna, definicao);
  }

  const protheus_sx2 = {
    arquivo: 'TEXT',
  };

  for (const [coluna, definicao] of Object.entries(protheus_sx2)) {
    _adicionarColunaSeFaltar('protheus_sx2', coluna, definicao);
  }

  _db.exec(`
    CREATE TABLE IF NOT EXISTS protheus_sx3 (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      empresa_id    INTEGER NOT NULL,
      tabela        TEXT NOT NULL,
      campo         TEXT NOT NULL,
      tipo          TEXT,
      tamanho       INTEGER,
      decimal       INTEGER,
      titulo        TEXT,
      descricao     TEXT,
      usado         TEXT,
      ordem         INTEGER,
      criado_em     TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_protheus_sx3_conn_tabela_campo
      ON protheus_sx3 (connection_id, tabela, campo);
  `);

  for (const [coluna, definicao] of Object.entries(whatsappAllowedNumbers)) {
    _adicionarColunaSeFaltar('whatsapp_allowed_numbers', coluna, definicao);
  }
}

module.exports = { inicializarDB, getDB };
