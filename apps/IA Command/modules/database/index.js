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
  _sincronizarSinonimosDoSistema();

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
    fase_execucao: 'TEXT DEFAULT NULL',
  };

  for (const [coluna, definicao] of Object.entries(interpretationLog)) {
    _adicionarColunaSeFaltar('interpretation_log', coluna, definicao);
  }

  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_iac_interpretation_fase_execucao
      ON interpretation_log (empresa_id, fase_execucao, criado_em);
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS ia_usage_pricing (
      id                  TEXT PRIMARY KEY,
      provider            TEXT NOT NULL,
      model               TEXT NOT NULL,
      moeda               TEXT NOT NULL DEFAULT 'USD',
      preco_input_1m      REAL NOT NULL DEFAULT 0,
      preco_output_1m     REAL NOT NULL DEFAULT 0,
      ativo               INTEGER NOT NULL DEFAULT 1,
      vigente_desde       TEXT NOT NULL,
      criado_em           TEXT NOT NULL,
      atualizado_em       TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_usage_pricing_provider_model
      ON ia_usage_pricing (provider, model, vigente_desde);

    CREATE TABLE IF NOT EXISTS ia_usage_events (
      id                  TEXT PRIMARY KEY,
      empresa_id          INTEGER,
      canal_id            TEXT,
      numero_wa           TEXT,
      provider            TEXT NOT NULL,
      model               TEXT,
      operacao            TEXT,
      origem              TEXT,
      ok                  INTEGER NOT NULL DEFAULT 1,
      error               TEXT,
      input_tokens        INTEGER NOT NULL DEFAULT 0,
      output_tokens       INTEGER NOT NULL DEFAULT 0,
      total_tokens        INTEGER NOT NULL DEFAULT 0,
      preco_input_1m      REAL NOT NULL DEFAULT 0,
      preco_output_1m     REAL NOT NULL DEFAULT 0,
      moeda               TEXT NOT NULL DEFAULT 'USD',
      custo_estimado_usd  REAL NOT NULL DEFAULT 0,
      criado_em           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_iac_usage_events_empresa_data
      ON ia_usage_events (empresa_id, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_usage_events_provider_model
      ON ia_usage_events (provider, model, criado_em);
  `);

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
    agente_local_url: 'TEXT DEFAULT NULL',
    agente_local_token: 'TEXT DEFAULT NULL',
    agente_local_ativo: 'INTEGER DEFAULT 0',
    agente_local_ultimo_teste: 'TEXT DEFAULT NULL',
    agente_local_teste_ok: 'INTEGER DEFAULT NULL',
    agente_local_crypto_key: 'TEXT DEFAULT NULL',
    agente_local_crypto_ativo: 'INTEGER DEFAULT 0',
  };

  const datasets = {
    sql_base:        'TEXT',
    campo_data:      "TEXT DEFAULT 'data'",
    colunas_metrica: 'TEXT',
  };

  const whatsappAllowedNumbers = {
    wa_lid:             'TEXT',
    modulo_financeiro:  'INTEGER DEFAULT 0',
    modulo_compras:     'INTEGER DEFAULT 0',
    modulo_faturamento: 'INTEGER DEFAULT 0',
    modulo_comissao:    'INTEGER DEFAULT 0',
    erp_tipo:           'TEXT DEFAULT NULL',
    erp_id:             'TEXT DEFAULT NULL',
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

  _migrarErpDeUsuariosJson();
}

// Migração única: copia erp_tipo/erp_id de usuarios.json para whatsapp_allowed_numbers
// Roda apenas para registros que ainda não têm erp_tipo preenchido.
function _migrarErpDeUsuariosJson() {
  try {
    const usuariosPath = path.join(__dirname, '..', '..', '..', 'IAHUB', 'data', 'usuarios.json');
    if (!fs.existsSync(usuariosPath)) return;

    const usuarios = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
    const comErp = usuarios.filter(u => u.erp_tipo && u.erp_telefone);
    if (!comErp.length) return;

    const update = _db.prepare(`
      UPDATE whatsapp_allowed_numbers
         SET erp_tipo = ?, erp_id = ?
       WHERE numero = ? AND (erp_tipo IS NULL OR erp_tipo = '')
    `);

    let migrados = 0;
    for (const u of comErp) {
      const numero = String(u.erp_telefone || '').replace(/\D/g, '');
      if (!numero) continue;
      const info = update.run(u.erp_tipo, String(u.erp_id || '').trim().toUpperCase() || null, numero);
      if (info.changes > 0) migrados++;
    }

    if (migrados > 0) {
      console.log(`[IA Command] Migração ERP: ${migrados} número(s) atualizados com perfil de usuarios.json`);
    }
  } catch (e) {
    console.warn('[IA Command] Migração ERP de usuarios.json ignorada:', e.message);
  }
}

function _sincronizarSinonimosDoSistema() {
  // Insere apenas os termos do sistema que estejam faltando em empresas já semeadas.
  // Nunca apaga nem sobrescreve — preserva customizações do usuário.
  try {
    const { _SINONIMOS_SISTEMA } = require('../ai/intent-service');
    if (!Array.isArray(_SINONIMOS_SISTEMA) || !_SINONIMOS_SISTEMA.length) return;

    const agora = new Date().toISOString();
    const empresasComSeed = _db
      .prepare("SELECT DISTINCT empresa_id FROM synonyms WHERE origem = 'sistema'")
      .all()
      .map(r => r.empresa_id);

    const checkExiste = _db.prepare(
      "SELECT id FROM synonyms WHERE empresa_id = ? AND termo = ? AND camada = ?"
    );
    const inserir = _db.prepare(`
      INSERT INTO synonyms (id, empresa_id, termo, camada, equivalencia, contexto, ativo, origem, criado_em, atualizado_em)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, NULL, 1, 'sistema', ?, ?)
    `);

    let totalInseridos = 0;
    for (const empresaId of empresasComSeed) {
      for (const s of _SINONIMOS_SISTEMA) {
        if (!checkExiste.get(empresaId, s.termo, s.camada)) {
          inserir.run(empresaId, s.termo, s.camada, s.equivalencia, agora, agora);
          totalInseridos++;
        }
      }
    }

    if (totalInseridos > 0) {
      console.log(`[IA Command] Sinônimos do sistema sincronizados: ${totalInseridos} termo(s) inserido(s) em ${empresasComSeed.length} empresa(s)`);
    }
  } catch (e) {
    console.warn('[IA Command] Sincronização de sinônimos do sistema ignorada:', e.message);
  }
}

module.exports = { inicializarDB, getDB };
