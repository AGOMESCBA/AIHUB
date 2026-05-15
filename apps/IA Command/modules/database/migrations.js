// Definição de todas as tabelas do IA Command — executadas em ordem na inicialização

const MIGRATIONS = [
  {
    version: 1,
    descricao: 'Tabela de conexões de banco ERP',
    sql: `
      CREATE TABLE IF NOT EXISTS connections (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        nome          TEXT NOT NULL,
        tipo          TEXT NOT NULL,
        host          TEXT,
        port          INTEGER,
        database      TEXT,
        username      TEXT,
        password      TEXT,
        filial        TEXT,
        encrypt       INTEGER DEFAULT 0,
        trust_cert    INTEGER DEFAULT 1,
        ssl           INTEGER DEFAULT 0,
        ambiente      TEXT DEFAULT 'producao',
        erp           TEXT DEFAULT 'protheus',
        observacoes   TEXT,
        ativo         INTEGER DEFAULT 1,
        padrao        INTEGER DEFAULT 0,
        ultimo_teste  TEXT,
        teste_ok      INTEGER DEFAULT 0,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      )
    `,
  },
  {
    version: 2,
    descricao: 'Configuração específica do Protheus por conexão',
    sql: `
      CREATE TABLE IF NOT EXISTS protheus_config (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
        empresa_cod   TEXT,
        filial_cod    TEXT,
        sufixo        TEXT DEFAULT '',
        criado_em     TEXT,
        atualizado_em TEXT
      )
    `,
  },
  {
    version: 3,
    descricao: 'Configuração de provider de IA por empresa',
    sql: `
      CREATE TABLE IF NOT EXISTS ai_config (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id    INTEGER NOT NULL UNIQUE,
        provider      TEXT DEFAULT 'groq',
        modelo        TEXT DEFAULT 'llama-3.3-70b-versatile',
        temperatura   REAL DEFAULT 0.1,
        max_tokens    INTEGER DEFAULT 500,
        timeout_ms    INTEGER DEFAULT 30000,
        prompt_base   TEXT,
        groq_api_key  TEXT,
        gemini_api_key TEXT,
        openai_api_key TEXT,
        claude_api_key TEXT,
        provedor_primario TEXT DEFAULT 'groq',
        confianca_minima  REAL DEFAULT 0.6,
        whisper_model     TEXT DEFAULT 'whisper-large-v3',
        audio_idioma      TEXT DEFAULT 'pt',
        ativo         INTEGER DEFAULT 1,
        criado_em     TEXT,
        atualizado_em TEXT
      )
    `,
  },
  {
    version: 4,
    descricao: 'Configuração de WhatsApp por empresa',
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_config (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id          INTEGER NOT NULL UNIQUE,
        numero              TEXT,
        provider            TEXT DEFAULT 'wweb',
        meta_token          TEXT,
        meta_phone_id       TEXT,
        meta_webhook_token  TEXT,
        ativo               INTEGER DEFAULT 1,
        status              TEXT DEFAULT 'desconectado',
        criado_em           TEXT,
        atualizado_em       TEXT
      )
    `,
  },
  {
    version: 5,
    descricao: 'Configuração de transcrição de áudio por empresa',
    sql: `
      CREATE TABLE IF NOT EXISTS audio_config (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id       INTEGER NOT NULL UNIQUE,
        provider         TEXT DEFAULT 'groq',
        modelo           TEXT DEFAULT 'whisper-large-v3',
        max_tamanho_mb   INTEGER DEFAULT 10,
        max_duracao_seg  INTEGER DEFAULT 120,
        idiomas_aceitos  TEXT DEFAULT 'pt,en',
        temp_dir         TEXT DEFAULT 'temp',
        exclusao_auto    INTEGER DEFAULT 1,
        ativo            INTEGER DEFAULT 1,
        criado_em        TEXT,
        atualizado_em    TEXT
      )
    `,
  },
  {
    version: 6,
    descricao: 'Intenções de IA cadastradas por empresa',
    sql: `
      CREATE TABLE IF NOT EXISTS intentions (
        id              TEXT PRIMARY KEY,
        empresa_id      INTEGER NOT NULL,
        nome            TEXT NOT NULL,
        descricao       TEXT,
        modulo          TEXT,
        acao            TEXT,
        dataset_id      TEXT,
        frases_exemplo  TEXT,
        ativo           INTEGER DEFAULT 1,
        criado_em       TEXT,
        atualizado_em   TEXT
      )
    `,
  },
  {
    version: 7,
    descricao: 'Datasets — mapa de tabelas e campos permitidos por intenção',
    sql: `
      CREATE TABLE IF NOT EXISTS datasets (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        nome          TEXT NOT NULL,
        erp           TEXT DEFAULT 'protheus',
        tabelas       TEXT,
        joins         TEXT,
        campos        TEXT,
        filtros       TEXT,
        agrupamentos  TEXT,
        ordenacoes    TEXT,
        limite_max    INTEGER DEFAULT 1000,
        criado_em     TEXT,
        atualizado_em TEXT
      )
    `,
  },
  {
    version: 8,
    descricao: 'Log de auditoria de ações administrativas',
    sql: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id          TEXT PRIMARY KEY,
        empresa_id  INTEGER,
        usuario     TEXT,
        acao        TEXT,
        detalhes    TEXT,
        ip          TEXT,
        criado_em   TEXT NOT NULL
      )
    `,
  },
  {
    version: 9,
    descricao: 'Resumo de execuções (detalhe completo em arquivo diário)',
    sql: `
      CREATE TABLE IF NOT EXISTS execution_log (
        correlation_id  TEXT PRIMARY KEY,
        empresa_id      INTEGER,
        usuario         TEXT,
        numero_wa       TEXT,
        intencao        TEXT,
        status          TEXT,
        duracao_ms      INTEGER,
        tipo_mensagem   TEXT DEFAULT 'texto',
        criado_em       TEXT NOT NULL
      )
    `,
  },
  {
    version: 10,
    descricao: 'Estado de sessão do WhatsApp por empresa',
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        empresa_id       INTEGER PRIMARY KEY,
        status           TEXT DEFAULT 'desconectado',
        qr_code          TEXT,
        conectado_em     TEXT,
        desconectado_em  TEXT,
        atualizado_em    TEXT
      )
    `,
  },
  {
    version: 11,
    descricao: 'Configuração genérica por ERP — armazena parâmetros específicos de cada sistema',
    sql: `
      CREATE TABLE IF NOT EXISTS erp_config (
        id            TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        empresa_id    INTEGER NOT NULL,
        erp           TEXT NOT NULL,
        config        TEXT,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      )
    `,
  },
];

module.exports = MIGRATIONS;
