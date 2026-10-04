function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function addColumnIfMissing(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensurePlatformSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_ai_configs (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL UNIQUE,
      provider TEXT,
      modelo TEXT,
      provedor_primario TEXT,
      fallback_ordem TEXT,
      confianca_minima REAL,
      whisper_model TEXT,
      historico_turnos INTEGER,
      groq_api_key_enc TEXT,
      openai_api_key_enc TEXT,
      gemini_api_key_enc TEXT,
      deepseek_api_key_enc TEXT,
      claude_api_key_enc TEXT,
      groq_modelo TEXT,
      openai_modelo TEXT,
      gemini_modelo TEXT,
      deepseek_modelo TEXT,
      claude_modelo TEXT,
      login_externo_apelido TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em TEXT,
      atualizado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS platform_agent_configs (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL UNIQUE,
      agente_local_url TEXT,
      agente_local_token_enc TEXT,
      agente_local_ativo INTEGER DEFAULT 1,
      agente_local_crypto_ativo INTEGER DEFAULT 0,
      agente_local_crypto_key_enc TEXT,
      criado_em TEXT,
      atualizado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS platform_search_configs (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL UNIQUE,
      provedor_primario TEXT,
      fallback_ordem TEXT,
      serper_api_key_enc TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em TEXT,
      atualizado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS platform_whatsapp_identities (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      numero TEXT NOT NULL,
      numero_normalizado TEXT NOT NULL,
      wa_lid TEXT,
      observacoes TEXT,
      ativo INTEGER DEFAULT 1,
      origem_sistema TEXT,
      origem_id TEXT,
      metadata_json TEXT,
      importado_em TEXT,
      criado_em TEXT,
      atualizado_em TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_whatsapp_empresa_numero
      ON platform_whatsapp_identities (empresa_id, numero_normalizado);

    CREATE TABLE IF NOT EXISTS platform_identity_roles (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      empresa_id INTEGER NOT NULL,
      sistema TEXT NOT NULL,
      modulo TEXT NOT NULL,
      papel TEXT,
      codigo_identidade TEXT,
      liberado INTEGER DEFAULT 1,
      metadata_json TEXT,
      origem_sistema TEXT,
      origem_id TEXT,
      importado_em TEXT,
      criado_em TEXT,
      atualizado_em TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_platform_identity_roles_identity
      ON platform_identity_roles (empresa_id, identity_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_identity_roles_origem
      ON platform_identity_roles (empresa_id, origem_sistema, origem_id)
      WHERE origem_sistema IS NOT NULL AND origem_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS platform_import_runs (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER,
      tipo TEXT,
      status TEXT,
      resumo_json TEXT,
      erro TEXT,
      iniciado_em TEXT,
      finalizado_em TEXT
    );
  `);

  [
    ['platform_whatsapp_identities', 'wa_lid', 'TEXT'],
    ['platform_whatsapp_identities', 'origem_sistema', 'TEXT'],
    ['platform_whatsapp_identities', 'origem_id', 'TEXT'],
    ['platform_whatsapp_identities', 'metadata_json', 'TEXT'],
    ['platform_whatsapp_identities', 'importado_em', 'TEXT'],
    ['platform_identity_roles', 'metadata_json', 'TEXT'],
    ['platform_identity_roles', 'origem_sistema', 'TEXT'],
    ['platform_identity_roles', 'origem_id', 'TEXT'],
    ['platform_identity_roles', 'importado_em', 'TEXT'],
    ['platform_import_runs', 'origem_sistema', 'TEXT'],
    ['platform_import_runs', 'tipo', 'TEXT'],
    ['platform_import_runs', 'resumo_json', 'TEXT'],
    ['platform_import_runs', 'erro', 'TEXT'],
    ['platform_import_runs', 'finalizado_em', 'TEXT'],
    ['platform_ai_configs', 'login_externo_apelido', 'TEXT'],
  ].forEach(([table, column, definition]) => addColumnIfMissing(db, table, column, definition));

  // Índice único parcial — criado à parte do CREATE TABLE porque bancos já
  // existentes só ganham a coluna via addColumnIfMissing acima, então o
  // índice precisa ser garantido aqui também (idempotente, mesma regra do
  // CREATE TABLE IF NOT EXISTS).
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_ai_configs_apelido
      ON platform_ai_configs (login_externo_apelido)
      WHERE login_externo_apelido IS NOT NULL;
  `);
}

module.exports = { ensurePlatformSchema };
