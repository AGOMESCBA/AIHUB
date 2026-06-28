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
  {
    version: 12,
    descricao: 'Adiciona sql_base e campo_data aos datasets — motor de query por template SQL',
    sql: `
      ALTER TABLE datasets ADD COLUMN sql_base   TEXT;
      ALTER TABLE datasets ADD COLUMN campo_data TEXT DEFAULT 'data';
    `,
  },
  {
    version: 13,
    descricao: 'Módulos de intenção — categorias configuráveis por empresa',
    sql: `
      CREATE TABLE IF NOT EXISTS intention_modules (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        nome          TEXT NOT NULL,
        descricao     TEXT,
        cor           TEXT DEFAULT '#7c3aed',
        ativo         INTEGER DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      )
    `,
  },
  {
    version: 14,
    descricao: 'Numeros de WhatsApp autorizados a interagir com o IA Command',
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_allowed_numbers (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        nome          TEXT NOT NULL,
        numero        TEXT NOT NULL,
        observacoes   TEXT,
        ativo         INTEGER DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_whatsapp_allowed_numbers_empresa_numero
        ON whatsapp_allowed_numbers (empresa_id, numero);
    `,
  },
  {
    version: 15,
    descricao: 'Canais WhatsApp compartilhaveis entre empresas do IA Command',
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_channels (
        id                TEXT PRIMARY KEY,
        nome              TEXT NOT NULL,
        numero            TEXT,
        provider          TEXT DEFAULT 'wweb',
        auth_client_id    TEXT NOT NULL UNIQUE,
        ativo             INTEGER DEFAULT 1,
        criado_em         TEXT NOT NULL,
        atualizado_em     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS whatsapp_channel_companies (
        id            TEXT PRIMARY KEY,
        channel_id    TEXT NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
        empresa_id    INTEGER NOT NULL,
        aliases       TEXT,
        padrao        INTEGER DEFAULT 0,
        ativo         INTEGER DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_whatsapp_channel_companies_unique
        ON whatsapp_channel_companies (channel_id, empresa_id);
    `,
  },
  {
    version: 16,
    descricao: 'Templates internos de mensagens WhatsApp por empresa',
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        chave         TEXT NOT NULL,
        titulo        TEXT NOT NULL,
        template      TEXT NOT NULL,
        ativo         INTEGER DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_iac_whatsapp_message_templates_empresa_chave
        ON whatsapp_message_templates (empresa_id, chave);
    `,
  },
  {
    version: 17,
    descricao: 'Identificador WhatsApp LID em numeros autorizados',
    sql: `
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN wa_lid TEXT;

      CREATE INDEX IF NOT EXISTS idx_iac_whatsapp_allowed_numbers_empresa_lid
        ON whatsapp_allowed_numbers (empresa_id, wa_lid);
    `,
  },
  {
    version: 18,
    descricao: 'Fallback configuravel de provedores de IA',
    sql: `
      ALTER TABLE ai_config ADD COLUMN fallback_ordem TEXT DEFAULT 'groq,deepseek,gemini,claude,openai';
    `,
  },
  {
    version: 19,
    descricao: 'Dicionário de sinônimos — equivalências por empresa para o classificador de IA',
    sql: `
      CREATE TABLE IF NOT EXISTS synonyms (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        termo         TEXT NOT NULL,
        camada        TEXT NOT NULL DEFAULT 'intencao',
        equivalencia  TEXT NOT NULL,
        contexto      TEXT,
        ativo         INTEGER DEFAULT 1,
        origem        TEXT DEFAULT 'usuario',
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iac_synonyms_empresa_ativo
        ON synonyms (empresa_id, ativo);
    `,
  },
  {
    version: 20,
    descricao: 'Colunas métricas para GROUP BY dinâmico nos datasets',
    sql: `
      ALTER TABLE datasets ADD COLUMN colunas_metrica TEXT;
    `,
  },
  {
    version: 21,
    descricao: 'Log detalhado de interpretacoes de linguagem natural',
    sql: `
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
        feedback              TEXT,
        feedback_observacao   TEXT,
        criado_em             TEXT NOT NULL,
        atualizado_em         TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_empresa_data
        ON interpretation_log (empresa_id, criado_em);

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_intencao
        ON interpretation_log (empresa_id, intencao, confianca);
    `,
  },
  {
    version: 22,
    descricao: 'Diálogos conversacionais — respostas locais quando a IA externa falha',
    sql: `
      CREATE TABLE IF NOT EXISTS conversational_dialogs (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER,
        tipo          TEXT NOT NULL DEFAULT 'outro',
        titulo        TEXT NOT NULL,
        padroes       TEXT NOT NULL DEFAULT '[]',
        resposta      TEXT NOT NULL,
        prioridade    INTEGER DEFAULT 0,
        protegido     INTEGER DEFAULT 0,
        origem        TEXT DEFAULT 'usuario',
        ativo         INTEGER DEFAULT 1,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iac_conv_dialogs_empresa_ativo
        ON conversational_dialogs (empresa_id, ativo);
    `,
  },
  {
    version: 23,
    descricao: 'Mensagens sem resposta — fila de aprendizado assistido',
    sql: `
      CREATE TABLE IF NOT EXISTS unmatched_messages (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER,
        sender        TEXT,
        mensagem      TEXT NOT NULL,
        promovido     INTEGER DEFAULT 0,
        criado_em     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iac_unmatched_empresa_promovido
        ON unmatched_messages (empresa_id, promovido, criado_em);
    `,
  },
  {
    version: 24,
    descricao: 'Compras Text-to-SQL — campos sql_gerado e duracao_ms na interpretation_log',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN sql_gerado  TEXT    DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN duracao_ms  INTEGER DEFAULT NULL;
    `,
  },
  {
    version: 25,
    descricao: 'erp_config — torna connection_id opcional (config de middleware independe de conexão)',
    sql: `
      CREATE TABLE IF NOT EXISTS erp_config_new (
        id            TEXT PRIMARY KEY,
        connection_id TEXT,
        empresa_id    INTEGER NOT NULL,
        erp           TEXT NOT NULL,
        config        TEXT,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      INSERT INTO erp_config_new SELECT id, connection_id, empresa_id, erp, config, criado_em, atualizado_em FROM erp_config;
      DROP TABLE erp_config;
      ALTER TABLE erp_config_new RENAME TO erp_config;
    `,
  },
  {
    version: 26,
    descricao: 'Dicionário SX2 do Protheus — modos de compartilhamento por conexão',
    sql: `
      CREATE TABLE IF NOT EXISTS protheus_sx2 (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        empresa_id    INTEGER NOT NULL,
        chave         TEXT NOT NULL,
        arquivo       TEXT,
        modo          TEXT NOT NULL DEFAULT 'E',
        descricao     TEXT,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_protheus_sx2_conn_chave
        ON protheus_sx2 (connection_id, chave);
    `,
  },
  {
    version: 27,
    descricao: 'Dicionario SX3 do Protheus - campos por conexao',
    sql: `
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
    `,
  },
  {
    version: 28,
    descricao: 'IA Command - trace detalhado da interpretacao',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN trace_json TEXT DEFAULT NULL;
    `,
  },
  {
    version: 29,
    descricao: 'IA Command - turnos de historico conversacional configuravel',
    sql: `
      ALTER TABLE ai_config ADD COLUMN historico_turnos INTEGER DEFAULT 5;
    `,
  },
  {
    version: 30,
    descricao: 'IA Command - remover "me apresente" dos padroes de dialogo de apresentacao (ambiguo com consultas ERP)',
    sql: `
      UPDATE conversational_dialogs
      SET padroes = REPLACE(padroes, '"me apresente", ', '')
      WHERE tipo = 'apresentacao' AND origem = 'sistema' AND padroes LIKE '%"me apresente"%';
    `,
  },
  {
    version: 31,
    descricao: 'IA Command - coluna modulo canonico na interpretation_log para unificar log de consultas',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN modulo TEXT DEFAULT NULL;

      UPDATE interpretation_log SET modulo =
        CASE
          WHEN intencao LIKE 'compras%'    OR intent_json LIKE '%"_moduloDinamico":"compras"%'    THEN 'compras'
          WHEN intencao LIKE 'faturamento%' OR intent_json LIKE '%"_moduloDinamico":"faturamento"%' THEN 'faturamento'
          WHEN intencao LIKE 'financeiro%' OR intent_json LIKE '%"_moduloDinamico":"financeiro"%'  THEN 'financeiro'
          WHEN intencao LIKE 'comissao%'   OR intent_json LIKE '%"_moduloDinamico":"comissao"%'    THEN 'comissao'
          ELSE NULL
        END
      WHERE modulo IS NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_modulo
        ON interpretation_log (empresa_id, modulo, criado_em);
    `,
  },
  {
    version: 32,
    descricao: 'IA Command - rastreabilidade de SQL canonico multiempresa',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN escopo_execucao TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_origem TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_empresa_origem INTEGER DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_original TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_adaptado TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_sql_canonico
        ON interpretation_log (empresa_id, sql_canonico_origem, criado_em);

      ALTER TABLE execution_log ADD COLUMN detalhes_json TEXT DEFAULT NULL;
    `,
  },
  {
    version: 33,
    descricao: 'IA Command - auditoria detalhada do ciclo de SQL dinamico',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN sql_auditoria_json TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_parametros_json TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_parametrizado INTEGER DEFAULT 0;
      ALTER TABLE interpretation_log ADD COLUMN sql_ia_bruto TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_final_executado TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_reuso_motivo TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_reuso_permitido INTEGER DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_canonico_empresa_atual INTEGER DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_sql_auditoria
        ON interpretation_log (empresa_id, modulo, sql_canonico_origem, criado_em);
    `,
  },
  {
    version: 34,
    descricao: 'IA Command - histórico de chat para Text-to-SQL multi-turn',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id TEXT    NOT NULL,
        sender     TEXT    NOT NULL,
        role       TEXT    NOT NULL,
        content    TEXT    NOT NULL,
        criado_em  TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_iac_chat_history_lookup
        ON chat_history (empresa_id, sender, criado_em);
    `,
  },
  {
    version: 35,
    descricao: 'IA Command - rastreabilidade do pipeline chat-first',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN pipeline_origem TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN chat_turno INTEGER DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_validacao_erro TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_pipeline
        ON interpretation_log (empresa_id, pipeline_origem, criado_em);
    `,
  },
  {
    version: 36,
    descricao: 'IA Command - configuração do Agente Local por empresa',
    sql: `
      ALTER TABLE ai_config ADD COLUMN agente_local_url   TEXT    DEFAULT NULL;
      ALTER TABLE ai_config ADD COLUMN agente_local_token TEXT    DEFAULT NULL;
      ALTER TABLE ai_config ADD COLUMN agente_local_ativo INTEGER DEFAULT 0;
      ALTER TABLE ai_config ADD COLUMN agente_local_ultimo_teste TEXT DEFAULT NULL;
      ALTER TABLE ai_config ADD COLUMN agente_local_teste_ok     INTEGER DEFAULT NULL;
    `,
  },
  {
    version: 37,
    descricao: 'IA Command - ocultar empresa do menu de seleção WhatsApp sem removê-la do canal',
    sql: `
      ALTER TABLE whatsapp_channel_companies ADD COLUMN ocultar_selecao INTEGER DEFAULT 0;
    `,
  },
  {
    version: 38,
    descricao: 'IA Command - classificacao da fase de execucao no log de interpretacoes',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN fase_execucao TEXT DEFAULT NULL;

      UPDATE interpretation_log
         SET fase_execucao =
           CASE
             WHEN sql_final_executado IS NOT NULL OR sql_gerado IS NOT NULL OR resultado_tipo = 'sucesso_ai_sql'
               THEN 'execucao_normal'
             WHEN resultado_tipo = 'erro'
               THEN 'pre_execucao_tecnica'
             ELSE 'sem_execucao'
           END
       WHERE fase_execucao IS NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_fase_execucao
        ON interpretation_log (empresa_id, fase_execucao, criado_em);
    `,
  },
  {
    version: 39,
    descricao: 'Seleção configurável de modelo por provider em ai_config',
    sql: `
      ALTER TABLE ai_config ADD COLUMN groq_modelo     TEXT DEFAULT 'llama-3.3-70b-versatile';
      ALTER TABLE ai_config ADD COLUMN openai_modelo   TEXT DEFAULT 'gpt-4o-mini';
      ALTER TABLE ai_config ADD COLUMN gemini_modelo   TEXT DEFAULT 'gemini-2.0-flash';
      ALTER TABLE ai_config ADD COLUMN deepseek_modelo TEXT DEFAULT 'deepseek-chat';
      ALTER TABLE ai_config ADD COLUMN claude_modelo   TEXT DEFAULT 'claude-haiku-4-5-20251001';
    `,
  },
  {
    version: 40,
    descricao: 'Autorizações por módulo e perfil ERP de vendas em whatsapp_allowed_numbers',
    sql: `
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN modulo_financeiro  INTEGER DEFAULT 0;
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN modulo_compras     INTEGER DEFAULT 0;
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN modulo_faturamento INTEGER DEFAULT 0;
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN modulo_comissao    INTEGER DEFAULT 0;
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN erp_tipo           TEXT    DEFAULT NULL;
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN erp_id             TEXT    DEFAULT NULL;
    `,
  },
  {
    version: 41,
    descricao: 'IA Command - telemetria de performance por etapa do pipeline',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN timing_json       TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN formatacao_caminho TEXT DEFAULT NULL;
    `,
  },
  {
    version: 42,
    descricao: 'IA Command - tempo ponta a ponta: recebido_em, pipeline_ms e entregue_ms',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN recebido_em  TEXT    DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN pipeline_ms  INTEGER DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN entregue_ms  INTEGER DEFAULT NULL;
    `,
  },
  {
    version: 43,
    descricao: 'IA Command - propostas de correcao de spec a partir de feedback do usuario via WhatsApp',
    sql: `
      CREATE TABLE IF NOT EXISTS spec_feedback_propostas (
        id                    TEXT PRIMARY KEY,
        empresa_id            INTEGER NOT NULL,
        numero_wa             TEXT,
        interpretation_log_id TEXT,
        modulo                TEXT,
        fragmento_afetado     TEXT,
        pergunta_original     TEXT,
        sql_gerado            TEXT,
        observacao_usuario    TEXT,
        diagnostico_ia        TEXT,
        texto_atual           TEXT,
        texto_proposto        TEXT,
        historico_dialogo_json TEXT,
        status                TEXT NOT NULL DEFAULT 'pendente',
        revisado_por          TEXT,
        revisado_em           TEXT,
        criado_em             TEXT NOT NULL,
        atualizado_em         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_spec_feedback_empresa_status
        ON spec_feedback_propostas (empresa_id, status, criado_em);
    `,
  },
  {
    version: 44,
    descricao: 'IA Command - aplicacao automatica de propostas de spec no arquivo de fragmentos',
    sql: `
      ALTER TABLE spec_feedback_propostas ADD COLUMN spec_aplicado_em      TEXT DEFAULT NULL;
      ALTER TABLE spec_feedback_propostas ADD COLUMN spec_aplicado_arquivo TEXT DEFAULT NULL;
    `,
  },
];

module.exports = MIGRATIONS;
