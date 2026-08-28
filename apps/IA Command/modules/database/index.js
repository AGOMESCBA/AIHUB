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
  _db.pragma('busy_timeout = 5000');

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
    intent_canonico_json: 'TEXT DEFAULT NULL',
    intent_canonico_hash: 'TEXT DEFAULT NULL',
    intent_canonico_estrutural_json: 'TEXT DEFAULT NULL',
    chave_cache: 'TEXT DEFAULT NULL',
    sql_template: 'TEXT DEFAULT NULL',
    sql_template_parametros_json: 'TEXT DEFAULT NULL',
  };

  for (const [coluna, definicao] of Object.entries(interpretationLog)) {
    _adicionarColunaSeFaltar('interpretation_log', coluna, definicao);
  }

  try {
    _adicionarColunaSeFaltar('scheduled_question_jobs', 'sql_fixo', 'TEXT DEFAULT NULL');
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS whatsapp_recipient_groups (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        nome          TEXT NOT NULL,
        descricao     TEXT DEFAULT NULL,
        ativo         INTEGER NOT NULL DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_whatsapp_recipient_groups_nome
        ON whatsapp_recipient_groups (empresa_id, nome);
      CREATE INDEX IF NOT EXISTS idx_iac_whatsapp_recipient_groups_empresa
        ON whatsapp_recipient_groups (empresa_id, ativo);

      CREATE TABLE IF NOT EXISTS whatsapp_recipient_group_members (
        id            TEXT PRIMARY KEY,
        grupo_id      TEXT NOT NULL REFERENCES whatsapp_recipient_groups(id) ON DELETE CASCADE,
        empresa_id    INTEGER NOT NULL,
        numero_id     TEXT NOT NULL REFERENCES whatsapp_allowed_numbers(id) ON DELETE CASCADE,
        ativo         INTEGER NOT NULL DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_whatsapp_recipient_group_members_unique
        ON whatsapp_recipient_group_members (grupo_id, numero_id);
      CREATE INDEX IF NOT EXISTS idx_iac_whatsapp_recipient_group_members_numero
        ON whatsapp_recipient_group_members (empresa_id, numero_id, ativo);

      CREATE TABLE IF NOT EXISTS scheduled_question_job_groups (
        id            TEXT PRIMARY KEY,
        job_id        TEXT NOT NULL REFERENCES scheduled_question_jobs(id) ON DELETE CASCADE,
        empresa_id    INTEGER NOT NULL,
        grupo_id      TEXT NOT NULL REFERENCES whatsapp_recipient_groups(id) ON DELETE CASCADE,
        nome          TEXT NOT NULL,
        ativo         INTEGER NOT NULL DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_question_job_groups_unique
        ON scheduled_question_job_groups (job_id, grupo_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_question_job_groups_empresa
        ON scheduled_question_job_groups (empresa_id, ativo);
    `);
    _adicionarColunaSeFaltar('scheduled_question_recipients', 'origem', "TEXT DEFAULT 'direto'");
    _adicionarColunaSeFaltar('scheduled_question_recipients', 'grupo_id', 'TEXT DEFAULT NULL');
    _db.exec(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_question_recipients_origem
        ON scheduled_question_recipients (job_id, origem, ativo);
    `);
  } catch (_) {}

  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_iac_interpretation_fase_execucao
      ON interpretation_log (empresa_id, fase_execucao, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_interpretation_intent_cache
      ON interpretation_log (empresa_id, chave_cache, criado_em);
  `);

  const executionLog = {
    detalhes_json: 'TEXT DEFAULT NULL',
    texto_original: 'TEXT DEFAULT NULL',
    intent_canonico_json: 'TEXT DEFAULT NULL',
    intent_canonico_hash: 'TEXT DEFAULT NULL',
    chave_cache: 'TEXT DEFAULT NULL',
    sql_final_executado: 'TEXT DEFAULT NULL',
    sql_template: 'TEXT DEFAULT NULL',
    prompt_version: 'TEXT DEFAULT NULL',
    spec_version: 'TEXT DEFAULT NULL',
    schema_version: 'TEXT DEFAULT NULL',
    model: 'TEXT DEFAULT NULL',
    confiavel_cache: 'INTEGER DEFAULT 0',
    confiavel_cache_em: 'TEXT DEFAULT NULL',
    cache_status: "TEXT DEFAULT 'pendente'",
  };

  for (const [coluna, definicao] of Object.entries(executionLog)) {
    _adicionarColunaSeFaltar('execution_log', coluna, definicao);
  }

  try {
    _adicionarColunaSeFaltar('protheus_chat_tokens', 'empresas_permitidas_json', 'TEXT DEFAULT NULL');
  } catch (_) {}
  try {
    _adicionarColunaSeFaltar('protheus_chat_tokens', 'filiais_permitidas_json', 'TEXT DEFAULT NULL');
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS protheus_web_user_permissions (
        id                        TEXT PRIMARY KEY,
        empresa_id                INTEGER NOT NULL,
        usuario_id                TEXT DEFAULT NULL,
        usuario_nome              TEXT DEFAULT NULL,
        celular                   TEXT NOT NULL,
        filial_atual              TEXT DEFAULT NULL,
        empresas_permitidas_json  TEXT DEFAULT NULL,
        filiais_permitidas_json   TEXT DEFAULT NULL,
        origem                    TEXT DEFAULT 'protheus_token',
        ativo                     INTEGER DEFAULT 1,
        observacoes               TEXT DEFAULT NULL,
        ultimo_sync_em            TEXT DEFAULT NULL,
        criado_em                 TEXT NOT NULL,
        atualizado_em             TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_protheus_web_users_empresa_usuario
        ON protheus_web_user_permissions (empresa_id, usuario_id)
        WHERE usuario_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_web_users_celular
        ON protheus_web_user_permissions (celular, ativo);
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_web_users_empresa
        ON protheus_web_user_permissions (empresa_id, ativo, atualizado_em);
    `);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS protheus_web_login_challenges (
        id             TEXT PRIMARY KEY,
        celular        TEXT NOT NULL,
        codigo_hash    TEXT NOT NULL,
        expira_em      TEXT NOT NULL,
        usado_em       TEXT DEFAULT NULL,
        tentativas     INTEGER NOT NULL DEFAULT 0,
        ip             TEXT DEFAULT NULL,
        user_agent     TEXT DEFAULT NULL,
        criado_em      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_web_login_celular
        ON protheus_web_login_challenges (celular, criado_em);
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_web_login_expira
        ON protheus_web_login_challenges (expira_em);
    `);
  } catch (_) {}
  try {
    _adicionarColunaSeFaltar('protheus_chat_messages', 'interpretation_log_id', 'TEXT DEFAULT NULL');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS protheus_chat_favorites (
        id                    TEXT PRIMARY KEY,
        empresa_id            INTEGER NOT NULL,
        celular               TEXT NOT NULL,
        titulo                TEXT NOT NULL,
        pergunta_texto        TEXT NOT NULL,
        resposta_mensagem_id  TEXT DEFAULT NULL,
        interpretation_log_id TEXT DEFAULT NULL,
        modulo                TEXT DEFAULT NULL,
        sql_final_executado   TEXT NOT NULL,
        sql_template          TEXT DEFAULT NULL,
        intent_json           TEXT DEFAULT NULL,
        grid_config_json      TEXT DEFAULT NULL,
        rows_preview_json     TEXT DEFAULT NULL,
        ativo                 INTEGER NOT NULL DEFAULT 1,
        criado_em             TEXT NOT NULL,
        atualizado_em         TEXT NOT NULL,
        ultimo_uso_em         TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_favorites_usuario
        ON protheus_chat_favorites (empresa_id, celular, ativo, atualizado_em);
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_favorites_msg
        ON protheus_chat_favorites (resposta_mensagem_id);
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS protheus_chat_forwardings (
        id                       TEXT PRIMARY KEY,
        empresa_id               INTEGER NOT NULL,
        sessao_id                TEXT DEFAULT NULL,
        mensagem_id              TEXT DEFAULT NULL,
        remetente_celular        TEXT DEFAULT NULL,
        remetente_usuario        TEXT DEFAULT NULL,
        destinatario_numero_id   TEXT DEFAULT NULL,
        destinatario_celular     TEXT DEFAULT NULL,
        destinatario_nome        TEXT DEFAULT NULL,
        formato                  TEXT NOT NULL DEFAULT 'texto',
        status                   TEXT NOT NULL DEFAULT 'pendente',
        pergunta_snapshot        TEXT DEFAULT NULL,
        resumo_snapshot          TEXT DEFAULT NULL,
        rows_count               INTEGER NOT NULL DEFAULT 0,
        arquivo_nome             TEXT DEFAULT NULL,
        arquivo_path             TEXT DEFAULT NULL,
        erro                     TEXT DEFAULT NULL,
        criado_em                TEXT NOT NULL,
        enviado_em               TEXT DEFAULT NULL,
        atualizado_em            TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_forwardings_empresa
        ON protheus_chat_forwardings (empresa_id, criado_em);
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_forwardings_status
        ON protheus_chat_forwardings (empresa_id, status, criado_em);
      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_forwardings_mensagem
        ON protheus_chat_forwardings (mensagem_id);
    `);
  } catch (_) {}

  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_iac_execution_cache_lookup
      ON execution_log (empresa_id, numero_wa, chave_cache, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_execution_cache_status
      ON execution_log (empresa_id, cache_status, criado_em);
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS nlsql_semantic_examples (
      id                              TEXT PRIMARY KEY,
      execution_log_id                TEXT NOT NULL UNIQUE,
      empresa_id                      INTEGER NOT NULL,
      numero_wa                       TEXT DEFAULT NULL,
      module                          TEXT DEFAULT NULL,
      intent                          TEXT DEFAULT NULL,
      metric_json                     TEXT DEFAULT NULL,
      date_basis                      TEXT DEFAULT NULL,
      group_by_json                   TEXT DEFAULT NULL,
      filter_keys_json                TEXT DEFAULT NULL,
      entity_types_json               TEXT DEFAULT NULL,
      security_scope_json             TEXT DEFAULT NULL,
      prompt_version                  TEXT DEFAULT NULL,
      spec_version                    TEXT DEFAULT NULL,
      schema_version                  TEXT DEFAULT NULL,
      model                           TEXT DEFAULT NULL,
      chave_cache                     TEXT DEFAULT NULL,
      intent_canonico_hash            TEXT DEFAULT NULL,
      intent_canonico_json            TEXT NOT NULL,
      intent_canonico_estrutural_json TEXT DEFAULT NULL,
      search_text                     TEXT NOT NULL,
      sql_template                    TEXT NOT NULL,
      sql_final_executado             TEXT DEFAULT NULL,
      embedding_json                  TEXT DEFAULT NULL,
      embedding_provider              TEXT DEFAULT NULL,
      embedding_model                 TEXT DEFAULT NULL,
      embedding_status                TEXT NOT NULL DEFAULT 'pendente',
      criado_em                       TEXT NOT NULL,
      atualizado_em                   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_iac_nlsql_examples_lookup
      ON nlsql_semantic_examples (empresa_id, module, spec_version, prompt_version, schema_version, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_nlsql_examples_cache
      ON nlsql_semantic_examples (empresa_id, chave_cache, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_nlsql_examples_embedding
      ON nlsql_semantic_examples (embedding_status, criado_em);
  `);
  _adicionarColunaSeFaltar('nlsql_semantic_examples', 'embedding_error', 'TEXT DEFAULT NULL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS nlsql_semantic_shadow_log (
      id                         TEXT PRIMARY KEY,
      empresa_id                 INTEGER NOT NULL,
      numero_wa                  TEXT DEFAULT NULL,
      module                     TEXT DEFAULT NULL,
      intent                     TEXT DEFAULT NULL,
      intent_canonico_hash       TEXT DEFAULT NULL,
      chave_cache                TEXT DEFAULT NULL,
      candidate_execution_log_id TEXT DEFAULT NULL,
      candidate_score            REAL DEFAULT NULL,
      candidate_sql_template     TEXT DEFAULT NULL,
      candidate_sql_aplicado     TEXT DEFAULT NULL,
      actual_sql_template        TEXT DEFAULT NULL,
      actual_sql_canonico        TEXT DEFAULT NULL,
      actual_sql_final           TEXT DEFAULT NULL,
      template_valido            INTEGER DEFAULT 0,
      comparacao_resultado       TEXT NOT NULL,
      auto_reuse_limiar          REAL DEFAULT NULL,
      auto_reuse_elegivel        INTEGER DEFAULT 0,
      classificacao_auto         TEXT DEFAULT NULL,
      classificacao_auto_motivo  TEXT DEFAULT NULL,
      classificacao_auto_em      TEXT DEFAULT NULL,
      classificacao_efetiva      TEXT DEFAULT NULL,
      override_classificacao     TEXT DEFAULT NULL,
      override_motivo            TEXT DEFAULT NULL,
      override_usuario           TEXT DEFAULT NULL,
      override_em                TEXT DEFAULT NULL,
      detalhes_json              TEXT DEFAULT NULL,
      servido_em_producao        INTEGER NOT NULL DEFAULT 0,
      criado_em                  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_iac_nlsql_shadow_lookup
      ON nlsql_semantic_shadow_log (empresa_id, module, comparacao_resultado, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_nlsql_shadow_candidate
      ON nlsql_semantic_shadow_log (candidate_execution_log_id, criado_em);
    CREATE INDEX IF NOT EXISTS idx_iac_nlsql_shadow_classificacao
      ON nlsql_semantic_shadow_log (empresa_id, classificacao_efetiva, criado_em);
  `);
  for (const [coluna, definicao] of Object.entries({
    classificacao_auto: 'TEXT DEFAULT NULL',
    classificacao_auto_motivo: 'TEXT DEFAULT NULL',
    classificacao_auto_em: 'TEXT DEFAULT NULL',
    classificacao_efetiva: 'TEXT DEFAULT NULL',
    override_classificacao: 'TEXT DEFAULT NULL',
    override_motivo: 'TEXT DEFAULT NULL',
    override_usuario: 'TEXT DEFAULT NULL',
    override_em: 'TEXT DEFAULT NULL',
  })) {
    _adicionarColunaSeFaltar('nlsql_semantic_shadow_log', coluna, definicao);
  }

  _db.exec(`
    CREATE TABLE IF NOT EXISTS nlsql_semantic_policies (
      id             TEXT PRIMARY KEY,
      empresa_id     INTEGER NOT NULL,
      module         TEXT NOT NULL,
      fonte_ranking  TEXT NOT NULL,
      min_score      REAL DEFAULT NULL,
      min_score_key  TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'observacao',
      status_motivo  TEXT DEFAULT NULL,
      atualizado_por TEXT DEFAULT NULL,
      criado_em      TEXT NOT NULL,
      atualizado_em  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_nlsql_policies_unique
      ON nlsql_semantic_policies (empresa_id, module, fonte_ranking, min_score_key);
    CREATE INDEX IF NOT EXISTS idx_iac_nlsql_policies_status
      ON nlsql_semantic_policies (empresa_id, status, module);
  `);
  _adicionarColunaSeFaltar('nlsql_semantic_policies', 'min_score_key', "TEXT DEFAULT 'sem_score'");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS nlsql_semantic_settings (
      empresa_id             INTEGER PRIMARY KEY,
      shadow_enabled          INTEGER NOT NULL DEFAULT 1,
      auto_reuse_enabled     INTEGER NOT NULL DEFAULT 0,
      auto_policy_enabled    INTEGER NOT NULL DEFAULT 1,
      precision_min          REAL NOT NULL DEFAULT 0.995,
      sample_min             INTEGER NOT NULL DEFAULT 30,
      atualizado_por         TEXT DEFAULT NULL,
      criado_em              TEXT NOT NULL,
      atualizado_em          TEXT NOT NULL
    );
  `);
  _adicionarColunaSeFaltar('nlsql_semantic_settings', 'shadow_enabled', 'INTEGER NOT NULL DEFAULT 1');

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
    connection_key: 'TEXT DEFAULT NULL',
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
    agente_sync_status: 'TEXT DEFAULT NULL',
    agente_sync_em: 'TEXT DEFAULT NULL',
    agente_teste_ok: 'INTEGER DEFAULT NULL',
    agente_ultimo_teste: 'TEXT DEFAULT NULL',
    agente_ultimo_erro: 'TEXT DEFAULT NULL',
    configuracoes: 'TEXT',
  };

  const aiConfig = {
    groq_api_key: 'TEXT',
    gemini_api_key: 'TEXT',
    deepseek_api_key: 'TEXT',
    claude_api_key: 'TEXT',
    openai_api_key: 'TEXT',
    openai_admin_key: 'TEXT DEFAULT NULL',
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
    protheus_web_login_ativo: 'INTEGER DEFAULT 1',
    protheus_web_login_path: "TEXT DEFAULT '/api/ia-command/protheus/web-login'",
    protheus_web_login_access_key: 'TEXT DEFAULT NULL',
    protheus_web_login_otp_ttl_min: 'INTEGER DEFAULT 5',
    protheus_web_login_max_tentativas: 'INTEGER DEFAULT 5',
    protheus_web_login_exigir_https: 'INTEGER DEFAULT 0',
  };

  const datasets = {
    connection_id:    'TEXT DEFAULT NULL',
    sql_base:        'TEXT',
    campo_data:      "TEXT DEFAULT 'data'",
    colunas_metrica: 'TEXT',
    tipo:                    "TEXT DEFAULT 'sql_base'",
    modulo:                  'TEXT DEFAULT NULL',
    spec:                    'TEXT DEFAULT NULL',
    suboperacao:             'TEXT DEFAULT NULL',
    ativo_ia_owner:          'INTEGER DEFAULT 0',
    prioridade:              'INTEGER DEFAULT 0',
    view_nome:               'TEXT DEFAULT NULL',
    view_descricao:          'TEXT DEFAULT NULL',
    view_grao:               'TEXT DEFAULT NULL',
    campos_semanticos_json:  'TEXT DEFAULT NULL',
    regras_semanticas:       'TEXT DEFAULT NULL',
    exemplos_perguntas:      'TEXT DEFAULT NULL',
    limitacoes:              'TEXT DEFAULT NULL',
  };

  const whatsappAllowedNumbers = {
    wa_lid:             'TEXT',
    modulo_financeiro:  'INTEGER DEFAULT 0',
    modulo_compras:     'INTEGER DEFAULT 0',
    modulo_faturamento: 'INTEGER DEFAULT 0',
    modulo_comissao:    'INTEGER DEFAULT 0',
    modulo_estoque:     'INTEGER DEFAULT 0',
    erp_tipo:           'TEXT DEFAULT NULL',
    erp_id:             'TEXT DEFAULT NULL',
    cod_aprov_erp:      'TEXT DEFAULT NULL',
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
      // 'vendedor' (nome legado em usuarios.json) equivale a 'usuario' no modelo atual.
      const erpTipo = String(u.erp_tipo).trim().toLowerCase() === 'vendedor' ? 'usuario' : u.erp_tipo;
      const info = update.run(erpTipo, String(u.erp_id || '').trim().toUpperCase() || null, numero);
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
