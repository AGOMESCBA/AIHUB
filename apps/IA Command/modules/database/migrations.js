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
      CREATE TABLE IF NOT EXISTS erp_config_v25 (
        id            TEXT PRIMARY KEY,
        connection_id TEXT,
        empresa_id    INTEGER NOT NULL,
        erp           TEXT NOT NULL,
        config        TEXT,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      INSERT OR IGNORE INTO erp_config_v25 SELECT id, connection_id, empresa_id, erp, config, criado_em, atualizado_em FROM erp_config;
      ALTER TABLE erp_config RENAME TO erp_config_legacy_v25;
      ALTER TABLE erp_config_v25 RENAME TO erp_config;
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
  {
    version: 45,
    descricao: 'IA Command - consumo de tokens e precificacao por empresa',
    sql: `
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
    `,
  },
  {
    version: 46,
    descricao: 'IA Command - registrar URL do agente local usado em cada interpretacao',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN agente_url TEXT DEFAULT NULL;
    `,
  },
  {
    version: 47,
    descricao: 'IA Command - criptografia ponta a ponta AES-256-GCM para Agente Local',
    sql: `
      ALTER TABLE ai_config ADD COLUMN agente_local_crypto_key   TEXT    DEFAULT NULL;
      ALTER TABLE ai_config ADD COLUMN agente_local_crypto_ativo INTEGER DEFAULT 0;
    `,
  },
  {
    version: 48,
    descricao: 'IA Command - jobs de perguntas agendadas para WhatsApp',
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_question_jobs (
        id                  TEXT PRIMARY KEY,
        empresa_id          INTEGER NOT NULL,
        channel_id          TEXT NOT NULL,
        nome                TEXT NOT NULL,
        pergunta            TEXT NOT NULL,
        modulo              TEXT DEFAULT NULL,
        escopo_empresa      TEXT NOT NULL DEFAULT 'empresa_atual',
        schedule_tipo       TEXT NOT NULL DEFAULT 'manual',
        schedule_json       TEXT NOT NULL DEFAULT '{}',
        timezone            TEXT NOT NULL DEFAULT 'America/Manaus',
        ativo               INTEGER NOT NULL DEFAULT 1,
        status              TEXT NOT NULL DEFAULT 'ativo',
        next_run_at         TEXT DEFAULT NULL,
        last_run_at         TEXT DEFAULT NULL,
        retry_max           INTEGER NOT NULL DEFAULT 2,
        retry_interval_min  INTEGER NOT NULL DEFAULT 5,
        lock_until          TEXT DEFAULT NULL,
        running_token       TEXT DEFAULT NULL,
        criado_por          TEXT DEFAULT NULL,
        atualizado_por      TEXT DEFAULT NULL,
        criado_em           TEXT NOT NULL,
        atualizado_em       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_question_jobs_due
        ON scheduled_question_jobs (ativo, status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_question_jobs_empresa
        ON scheduled_question_jobs (empresa_id, atualizado_em);

      CREATE TABLE IF NOT EXISTS scheduled_question_recipients (
        id             TEXT PRIMARY KEY,
        job_id         TEXT NOT NULL REFERENCES scheduled_question_jobs(id) ON DELETE CASCADE,
        empresa_id     INTEGER NOT NULL,
        numero_id      TEXT NOT NULL,
        nome           TEXT NOT NULL,
        numero         TEXT NOT NULL,
        ativo          INTEGER NOT NULL DEFAULT 1,
        criado_em      TEXT NOT NULL,
        atualizado_em  TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_question_recipients_job_numero
        ON scheduled_question_recipients (job_id, numero_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_question_recipients_empresa
        ON scheduled_question_recipients (empresa_id, ativo);

      CREATE TABLE IF NOT EXISTS scheduled_question_runs (
        id                    TEXT PRIMARY KEY,
        job_id                TEXT NOT NULL REFERENCES scheduled_question_jobs(id) ON DELETE CASCADE,
        empresa_id            INTEGER NOT NULL,
        channel_id            TEXT NOT NULL,
        trigger_tipo          TEXT NOT NULL DEFAULT 'manual',
        status                TEXT NOT NULL DEFAULT 'pendente',
        pergunta              TEXT NOT NULL,
        started_at            TEXT DEFAULT NULL,
        finished_at           TEXT DEFAULT NULL,
        duration_ms           INTEGER DEFAULT NULL,
        attempt               INTEGER NOT NULL DEFAULT 1,
        interpretation_log_id TEXT DEFAULT NULL,
        resposta              TEXT DEFAULT NULL,
        erro                  TEXT DEFAULT NULL,
        criado_em             TEXT NOT NULL,
        atualizado_em         TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_question_runs_job
        ON scheduled_question_runs (job_id, criado_em);
      CREATE INDEX IF NOT EXISTS idx_scheduled_question_runs_empresa
        ON scheduled_question_runs (empresa_id, criado_em);

      CREATE TABLE IF NOT EXISTS scheduled_question_deliveries (
        id             TEXT PRIMARY KEY,
        run_id         TEXT NOT NULL REFERENCES scheduled_question_runs(id) ON DELETE CASCADE,
        job_id         TEXT NOT NULL REFERENCES scheduled_question_jobs(id) ON DELETE CASCADE,
        recipient_id   TEXT NOT NULL REFERENCES scheduled_question_recipients(id) ON DELETE CASCADE,
        numero_id      TEXT NOT NULL,
        nome           TEXT NOT NULL,
        numero         TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pendente',
        sent_at        TEXT DEFAULT NULL,
        erro           TEXT DEFAULT NULL,
        criado_em      TEXT NOT NULL,
        atualizado_em  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_question_deliveries_run
        ON scheduled_question_deliveries (run_id, status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_question_deliveries_job
        ON scheduled_question_deliveries (job_id, criado_em);
    `,
  },
  {
    version: 49,
    descricao: 'IA Command - chave Admin OpenAI opcional para consulta de custo no dashboard',
    sql: `
      ALTER TABLE ai_config ADD COLUMN openai_admin_key TEXT DEFAULT NULL;
    `,
  },
  {
    version: 50,
    descricao: 'Datasets semanticos para views canonicas multi-ERP',
    sql: `
      ALTER TABLE datasets ADD COLUMN tipo TEXT DEFAULT 'sql_base';
      ALTER TABLE datasets ADD COLUMN modulo TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN spec TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN suboperacao TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN ativo_ia_owner INTEGER DEFAULT 0;
      ALTER TABLE datasets ADD COLUMN prioridade INTEGER DEFAULT 0;
      ALTER TABLE datasets ADD COLUMN view_nome TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN view_descricao TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN view_grao TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN campos_semanticos_json TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN regras_semanticas TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN exemplos_perguntas TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN limitacoes TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_datasets_semantic_lookup
        ON datasets (empresa_id, tipo, ativo_ia_owner, modulo, spec, suboperacao, prioridade);
    `,
  },
  {
    version: 51,
    descricao: 'IA Command - autorizacao do modulo dedicado de estoque em whatsapp_allowed_numbers',
    sql: `
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN modulo_estoque INTEGER DEFAULT 0;
    `,
  },
  {
    version: 52,
    descricao: 'IA Command - codigo de aprovador ERP (SCR.CR_APROV/SAK.AK_COD) em whatsapp_allowed_numbers',
    sql: `
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN cod_aprov_erp TEXT DEFAULT NULL;
    `,
  },
  {
    version: 53,
    descricao: 'IA Command - fundacao do Intent Canonico no execution_log',
    sql: `
      ALTER TABLE execution_log ADD COLUMN texto_original TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN intent_canonico_json TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN intent_canonico_hash TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN chave_cache TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN sql_final_executado TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN sql_template TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN prompt_version TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN spec_version TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN schema_version TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN model TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN confiavel_cache INTEGER DEFAULT 0;
      ALTER TABLE execution_log ADD COLUMN confiavel_cache_em TEXT DEFAULT NULL;
      ALTER TABLE execution_log ADD COLUMN cache_status TEXT DEFAULT 'pendente';

      CREATE INDEX IF NOT EXISTS idx_iac_execution_cache_lookup
        ON execution_log (empresa_id, numero_wa, chave_cache, criado_em);
      CREATE INDEX IF NOT EXISTS idx_iac_execution_cache_status
        ON execution_log (empresa_id, cache_status, criado_em);
    `,
  },
  {
    version: 54,
    descricao: 'IA Command - Intent Canonico e template SQL na interpretation_log',
    sql: `
      ALTER TABLE interpretation_log ADD COLUMN intent_canonico_json TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN intent_canonico_hash TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN intent_canonico_estrutural_json TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN chave_cache TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_template TEXT DEFAULT NULL;
      ALTER TABLE interpretation_log ADD COLUMN sql_template_parametros_json TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_interpretation_intent_cache
        ON interpretation_log (empresa_id, chave_cache, criado_em);
    `,
  },
  {
    version: 55,
    descricao: 'IA Command - indices de performance em protheus_sx2, erp_config, intentions e connections',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_protheus_sx2_empresa
        ON protheus_sx2 (empresa_id);

      CREATE INDEX IF NOT EXISTS idx_iac_erp_config_empresa_erp
        ON erp_config (empresa_id, erp, connection_id);

      CREATE INDEX IF NOT EXISTS idx_iac_intentions_empresa_nome
        ON intentions (empresa_id, nome);
      CREATE INDEX IF NOT EXISTS idx_iac_intentions_empresa_ativo
        ON intentions (empresa_id, ativo);

      CREATE INDEX IF NOT EXISTS idx_iac_connections_empresa_ativo
        ON connections (empresa_id, ativo);
    `,
  },
  {
    version: 56,
    descricao: 'IA Command - exemplos semanticos consultivos para cache NL-SQL',
    sql: `
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
    `,
  },
  {
    version: 57,
    descricao: 'IA Command - shadow mode para auto-reuse semantico NL-SQL',
    sql: `
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
        detalhes_json              TEXT DEFAULT NULL,
        servido_em_producao        INTEGER NOT NULL DEFAULT 0,
        criado_em                  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_iac_nlsql_shadow_lookup
        ON nlsql_semantic_shadow_log (empresa_id, module, comparacao_resultado, criado_em);
      CREATE INDEX IF NOT EXISTS idx_iac_nlsql_shadow_candidate
        ON nlsql_semantic_shadow_log (candidate_execution_log_id, criado_em);
    `,
  },
  {
    version: 58,
    descricao: 'IA Command - erro de processamento em embeddings NL-SQL',
    sql: `
      ALTER TABLE nlsql_semantic_examples ADD COLUMN embedding_error TEXT DEFAULT NULL;
    `,
  },
  {
    version: 59,
    descricao: 'IA Command - classificacao automatica e override opcional no shadow NL-SQL',
    sql: `
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN classificacao_auto TEXT DEFAULT NULL;
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN classificacao_auto_motivo TEXT DEFAULT NULL;
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN classificacao_auto_em TEXT DEFAULT NULL;
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN classificacao_efetiva TEXT DEFAULT NULL;
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN override_classificacao TEXT DEFAULT NULL;
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN override_motivo TEXT DEFAULT NULL;
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN override_usuario TEXT DEFAULT NULL;
      ALTER TABLE nlsql_semantic_shadow_log ADD COLUMN override_em TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_iac_nlsql_shadow_classificacao
        ON nlsql_semantic_shadow_log (empresa_id, classificacao_efetiva, criado_em);
    `,
  },
  {
    version: 60,
    descricao: 'IA Command - politicas de promocao NL-SQL',
    sql: `
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
    `,
  },
  {
    version: 61,
    descricao: 'IA Command - configuracao operacional do auto-reuse semantico NL-SQL',
    sql: `
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
    `,
  },
  {
    version: 62,
    descricao: 'IA Command - suporte a canais WhatsApp como Windows Service',
    sql: `
      ALTER TABLE whatsapp_channels ADD COLUMN is_windows_service INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE whatsapp_channels ADD COLUMN worker_port        INTEGER DEFAULT NULL;
      ALTER TABLE whatsapp_channels ADD COLUMN service_slug      TEXT    DEFAULT NULL;
    `,
  },
  {
    version: 63,
    descricao: 'IA Command - SQL fixo opcional nos jobs de perguntas agendadas',
    sql: `
      ALTER TABLE scheduled_question_jobs ADD COLUMN sql_fixo TEXT DEFAULT NULL;
    `,
  },
  {
    version: 64,
    descricao: 'IA Command - Modo de execucao do run (sql_fixo ou pergunta_ia)',
    sql: `
      ALTER TABLE scheduled_question_runs ADD COLUMN execucao_modo TEXT DEFAULT NULL;
    `,
  },
  {
    version: 65,
    descricao: 'IA Command - codigo de cliente ERP (E1_CLIENTE/F2_CLIENTE) em whatsapp_allowed_numbers, independente de erp_tipo, analogo a cod_aprov_erp',
    sql: `
      ALTER TABLE whatsapp_allowed_numbers ADD COLUMN cod_cliente_erp TEXT DEFAULT NULL;
    `,
  },
  {
    version: 66,
    descricao: 'IA Command - renomeia erp_tipo vendedor -> usuario em whatsapp_allowed_numbers (numero "usuario" pode ter codigo de vendedor, cliente e/ou aprovador simultaneamente, cada um em seu proprio campo)',
    sql: `
      UPDATE whatsapp_allowed_numbers SET erp_tipo = 'usuario' WHERE erp_tipo = 'vendedor';
    `,
  },
  {
    version: 67,
    descricao: 'IA Command - canal Protheus WhatsApp (chat embutido no ERP via TWebEngine): tokens de sessao, sessoes de conversa e mensagens',
    sql: `
      CREATE TABLE IF NOT EXISTS protheus_chat_tokens (
        token         TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        celular       TEXT NOT NULL,
        filial        TEXT,
        expira_em     TEXT NOT NULL,
        usado_em      TEXT,
        criado_em     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_tokens_expira
        ON protheus_chat_tokens (expira_em);

      CREATE TABLE IF NOT EXISTS protheus_chat_sessions (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        celular       TEXT NOT NULL,
        titulo        TEXT,
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_sessions_celular
        ON protheus_chat_sessions (empresa_id, celular, atualizado_em);

      CREATE TABLE IF NOT EXISTS protheus_chat_messages (
        id            TEXT PRIMARY KEY,
        sessao_id     TEXT NOT NULL REFERENCES protheus_chat_sessions(id) ON DELETE CASCADE,
        direcao       TEXT NOT NULL,
        texto         TEXT NOT NULL,
        rows_json     TEXT,
        tipo_resultado TEXT,
        intent_json   TEXT,
        criado_em     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_iac_protheus_chat_messages_sessao
        ON protheus_chat_messages (sessao_id, criado_em);
    `,
  },
  {
    version: 68,
    descricao: 'IA Command - datasets com conexao de dados e metadados de sincronizacao com Agente Local',
    sql: `
      ALTER TABLE connections ADD COLUMN connection_key TEXT DEFAULT NULL;
      ALTER TABLE connections ADD COLUMN agente_sync_status TEXT DEFAULT NULL;
      ALTER TABLE connections ADD COLUMN agente_sync_em TEXT DEFAULT NULL;
      ALTER TABLE connections ADD COLUMN agente_teste_ok INTEGER DEFAULT NULL;
      ALTER TABLE connections ADD COLUMN agente_ultimo_teste TEXT DEFAULT NULL;
      ALTER TABLE connections ADD COLUMN agente_ultimo_erro TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN connection_id TEXT DEFAULT NULL;
    `,
  },
  {
    version: 69,
    descricao: 'IA Command - sistema ERP de origem por intencao, para roteamento multi-sistema (Protheus/SoftExpert/etc)',
    sql: `
      ALTER TABLE intentions ADD COLUMN erp TEXT DEFAULT 'protheus';
    `,
  },
  {
    version: 70,
    descricao: 'IA Command - protheus_whatsapp: marca de reset de memoria (esquecer contexto sem apagar historico)',
    sql: `
      ALTER TABLE protheus_chat_sessions ADD COLUMN memoria_resetada_em TEXT DEFAULT NULL;
    `,
  },
  {
    version: 71,
    descricao: 'IA Command - protheus_whatsapp: config de grid (agrupamento/filtros) persistida por mensagem, para a aba Relatorio',
    sql: `
      ALTER TABLE protheus_chat_messages ADD COLUMN grid_config_json TEXT DEFAULT NULL;
    `,
  },
  {
    version: 72,
    descricao: 'IA Command - modulos liberados por numero WhatsApp, dinamico por sistema (erp), com backfill dos 5 modulos Protheus fixos existentes. Colunas modulo_* de whatsapp_allowed_numbers permanecem como estao (nao removidas) para nao quebrar leitores existentes.',
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_numero_modulos (
        id                TEXT PRIMARY KEY,
        numero_id         TEXT NOT NULL,
        empresa_id        INTEGER NOT NULL,
        erp               TEXT NOT NULL,
        modulo            TEXT NOT NULL,
        liberado          INTEGER NOT NULL DEFAULT 1,
        papel             TEXT DEFAULT NULL,
        codigo_identidade TEXT DEFAULT NULL,
        criado_em         TEXT NOT NULL,
        atualizado_em     TEXT NOT NULL,
        UNIQUE(numero_id, erp, modulo)
      );

      CREATE INDEX IF NOT EXISTS idx_iac_whatsapp_numero_modulos_numero
        ON whatsapp_numero_modulos (numero_id);

      CREATE INDEX IF NOT EXISTS idx_iac_whatsapp_numero_modulos_empresa
        ON whatsapp_numero_modulos (empresa_id, erp, modulo);

      INSERT INTO whatsapp_numero_modulos (id, numero_id, empresa_id, erp, modulo, liberado, criado_em, atualizado_em)
      SELECT lower(hex(randomblob(16))), id, empresa_id, 'protheus', 'financeiro', 1, atualizado_em, atualizado_em
        FROM whatsapp_allowed_numbers w WHERE modulo_financeiro = 1
          AND NOT EXISTS (SELECT 1 FROM whatsapp_numero_modulos m WHERE m.numero_id = w.id AND m.erp='protheus' AND m.modulo='financeiro');

      INSERT INTO whatsapp_numero_modulos (id, numero_id, empresa_id, erp, modulo, liberado, criado_em, atualizado_em)
      SELECT lower(hex(randomblob(16))), id, empresa_id, 'protheus', 'compras', 1, atualizado_em, atualizado_em
        FROM whatsapp_allowed_numbers w WHERE modulo_compras = 1
          AND NOT EXISTS (SELECT 1 FROM whatsapp_numero_modulos m WHERE m.numero_id = w.id AND m.erp='protheus' AND m.modulo='compras');

      INSERT INTO whatsapp_numero_modulos (id, numero_id, empresa_id, erp, modulo, liberado, criado_em, atualizado_em)
      SELECT lower(hex(randomblob(16))), id, empresa_id, 'protheus', 'faturamento', 1, atualizado_em, atualizado_em
        FROM whatsapp_allowed_numbers w WHERE modulo_faturamento = 1
          AND NOT EXISTS (SELECT 1 FROM whatsapp_numero_modulos m WHERE m.numero_id = w.id AND m.erp='protheus' AND m.modulo='faturamento');

      INSERT INTO whatsapp_numero_modulos (id, numero_id, empresa_id, erp, modulo, liberado, criado_em, atualizado_em)
      SELECT lower(hex(randomblob(16))), id, empresa_id, 'protheus', 'comissao', 1, atualizado_em, atualizado_em
        FROM whatsapp_allowed_numbers w WHERE modulo_comissao = 1
          AND NOT EXISTS (SELECT 1 FROM whatsapp_numero_modulos m WHERE m.numero_id = w.id AND m.erp='protheus' AND m.modulo='comissao');

      INSERT INTO whatsapp_numero_modulos (id, numero_id, empresa_id, erp, modulo, liberado, criado_em, atualizado_em)
      SELECT lower(hex(randomblob(16))), id, empresa_id, 'protheus', 'estoque', 1, atualizado_em, atualizado_em
        FROM whatsapp_allowed_numbers w WHERE modulo_estoque = 1
          AND NOT EXISTS (SELECT 1 FROM whatsapp_numero_modulos m WHERE m.numero_id = w.id AND m.erp='protheus' AND m.modulo='estoque');
    `,
  },
  {
    version: 73,
    descricao: 'IA Command - mapa papel->coluna de seguranca por dataset (RLS dinamica para sistemas fora do Protheus, ex: SoftExpert). Datasets Protheus ficam com valor NULL, sem efeito — a seguranca deles continua via vendedor/cliente/aprovador-seguranca.js.',
    sql: `
      ALTER TABLE datasets ADD COLUMN seguranca_papeis_json TEXT DEFAULT NULL;
    `,
  },
  {
    version: 74,
    descricao: 'IA Command - grupos internos de destinatarios WhatsApp para agendamentos',
    sql: `
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

      ALTER TABLE scheduled_question_recipients ADD COLUMN origem TEXT DEFAULT 'direto';
      ALTER TABLE scheduled_question_recipients ADD COLUMN grupo_id TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_scheduled_question_recipients_origem
        ON scheduled_question_recipients (job_id, origem, ativo);
    `,
  },
  {
    version: 75,
    descricao: 'IA Command - cache de hierarquia organizacional Protheus (SYS_COMPANY/SYS_COMPANY_CFG) para conexoes com multiplas empresas por grupo. Tabelas novas, aditivas — nao alteram protheus_sx2/sx3 nem o pipeline TRADICIONAL existente.',
    sql: `
      CREATE TABLE IF NOT EXISTS protheus_company_profile (
        id                    TEXT PRIMARY KEY,
        connection_id         TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        empresa_id            INTEGER NOT NULL,
        company_table         TEXT NOT NULL DEFAULT 'SYS_COMPANY',
        company_cfg_table     TEXT NOT NULL DEFAULT 'SYS_COMPANY_CFG',
        field_map_json        TEXT NOT NULL DEFAULT '{}',
        branch_key_strategy   TEXT NOT NULL DEFAULT 'nao_descoberta',
        branch_key_detail_json TEXT DEFAULT NULL,
        validated             INTEGER NOT NULL DEFAULT 0,
        validation_errors_json TEXT DEFAULT NULL,
        criado_em             TEXT NOT NULL,
        atualizado_em         TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_protheus_company_profile_conn
        ON protheus_company_profile (connection_id);

      CREATE INDEX IF NOT EXISTS idx_protheus_company_profile_empresa
        ON protheus_company_profile (empresa_id);

      CREATE TABLE IF NOT EXISTS protheus_company_tree (
        id            TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        empresa_id    INTEGER NOT NULL,
        grupo_codigo  TEXT NOT NULL,
        empresa_codigo TEXT DEFAULT NULL,
        unidade_codigo TEXT DEFAULT NULL,
        filial_codigo TEXT DEFAULT NULL,
        filial_chave  TEXT NOT NULL,
        tipo_no       TEXT NOT NULL,
        nome          TEXT DEFAULT NULL,
        cnpj          TEXT DEFAULT NULL,
        ativo         INTEGER NOT NULL DEFAULT 1,
        origem        TEXT NOT NULL DEFAULT 'import',
        criado_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_protheus_company_tree_conn_chave
        ON protheus_company_tree (connection_id, filial_chave);

      CREATE INDEX IF NOT EXISTS idx_protheus_company_tree_empresa
        ON protheus_company_tree (empresa_id, connection_id, tipo_no);
    `,
  },
  {
    version: 76,
    descricao: 'IA Command - protheus_whatsapp: lista de empresas permitidas no token emitido pelo ADVPL',
    sql: `
      ALTER TABLE protheus_chat_tokens ADD COLUMN empresas_permitidas_json TEXT DEFAULT NULL;
    `,
  },
  {
    version: 77,
    descricao: 'IA Command - favoritos do chat Protheus com SQL auditado',
    sql: `
      ALTER TABLE protheus_chat_messages ADD COLUMN interpretation_log_id TEXT DEFAULT NULL;

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
    `,
  },
  {
    version: 78,
    descricao: 'IA Command - agendamento: retry automatico de envio parcial (retry_count + destinatarios pendentes)',
    sql: `
      ALTER TABLE scheduled_question_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE scheduled_question_jobs ADD COLUMN retry_recipient_ids TEXT DEFAULT NULL;
    `,
  },
];

module.exports = MIGRATIONS;
