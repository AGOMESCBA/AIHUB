// Definição de todas as tabelas do IA Service — executadas em ordem na inicialização.
// Banco proprio e exclusivo do IA Service (ia-service.db). Nunca referenciar
// tabelas do IA Command (ia-command.db) — bancos fisicamente separados.

const MIGRATIONS = [
  {
    version: 1,
    descricao: 'Tabela de consultores/tecnicos do IA Service (perfil complementar ao usuario IA HUB)',
    sql: `
      CREATE TABLE IF NOT EXISTS consultores (
        id                 TEXT PRIMARY KEY,
        usuario_id_iahub   INTEGER NOT NULL,
        empresa_id         INTEGER NOT NULL,
        id_softexpert      TEXT DEFAULT NULL,
        ativo              INTEGER NOT NULL DEFAULT 1,
        criado_em          TEXT NOT NULL,
        atualizado_em      TEXT NOT NULL
      );

      -- Um usuario IA HUB tem no maximo um perfil de consultor POR empresa (decisao
      -- documentada em IA_SERVICE_ETAPA1_IMPLEMENTACAO.md: usuario_id_iahub sozinho
      -- nao e' unico porque um mesmo usuario pode atender mais de uma empresa cliente,
      -- e id_softexpert e' especifico da instancia SoftExpert de cada empresa).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_consultores_usuario_empresa
        ON consultores (usuario_id_iahub, empresa_id);

      CREATE INDEX IF NOT EXISTS idx_svc_consultores_empresa_ativo
        ON consultores (empresa_id, ativo);

      -- id_softexpert so precisa ser unico dentro da mesma empresa (instancias
      -- SoftExpert diferentes por empresa podem reutilizar numeracao de tecnico).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_consultores_softexpert
        ON consultores (empresa_id, id_softexpert)
        WHERE id_softexpert IS NOT NULL;
    `,
  },
  {
    version: 2,
    descricao: 'Tabela de atendimentos (entidade central do IA Service)',
    sql: `
      CREATE TABLE IF NOT EXISTS atendimentos (
        id                     TEXT PRIMARY KEY,
        codigo                 TEXT NOT NULL,
        empresa_id             INTEGER NOT NULL,
        origem                 TEXT NOT NULL DEFAULT 'manual',
        referencia_externa     TEXT DEFAULT NULL,
        conteudo_bruto         TEXT NOT NULL,
        contexto_estruturado_json TEXT DEFAULT NULL,
        contexto_origem        TEXT NOT NULL DEFAULT 'ia',
        precisa_revisao        INTEGER NOT NULL DEFAULT 0,
        status                 TEXT NOT NULL DEFAULT 'NOVO',
        criado_por_usuario_id  INTEGER DEFAULT NULL,
        criado_por_integracao  TEXT DEFAULT NULL,
        consultor_id           TEXT DEFAULT NULL REFERENCES consultores(id) ON DELETE SET NULL,
        criado_em              TEXT NOT NULL,
        atualizado_em          TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_atendimentos_codigo
        ON atendimentos (codigo);

      CREATE INDEX IF NOT EXISTS idx_svc_atendimentos_empresa
        ON atendimentos (empresa_id, criado_em);

      CREATE INDEX IF NOT EXISTS idx_svc_atendimentos_empresa_status
        ON atendimentos (empresa_id, status);

      -- Idempotencia futura de integracoes: (empresa_id, origem, referencia_externa) deve
      -- ser unico quando referencia_externa nao for nula, pois empresas diferentes podem
      -- reutilizar o mesmo numero de chamado em seus sistemas de origem. NAO aplicar essa
      -- restricao a origem='manual' (referencia_externa normalmente nula ali).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_atendimentos_idempotencia
        ON atendimentos (empresa_id, origem, referencia_externa)
        WHERE referencia_externa IS NOT NULL;
    `,
  },
  {
    version: 3,
    descricao: 'Tabela de mensagens vinculadas ao atendimento',
    sql: `
      CREATE TABLE IF NOT EXISTS mensagens (
        id             TEXT PRIMARY KEY,
        empresa_id     INTEGER NOT NULL,
        atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
        papel          TEXT NOT NULL,
        conteudo       TEXT NOT NULL,
        usuario_id     INTEGER DEFAULT NULL,
        criado_em      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_svc_mensagens_atendimento
        ON mensagens (empresa_id, atendimento_id, criado_em);
    `,
  },
  {
    version: 4,
    descricao: 'Tabela de metadados de anexos (binario fica fora do SQLite)',
    sql: `
      CREATE TABLE IF NOT EXISTS anexos (
        id               TEXT PRIMARY KEY,
        empresa_id       INTEGER NOT NULL,
        atendimento_id   TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
        mensagem_id      TEXT DEFAULT NULL REFERENCES mensagens(id) ON DELETE SET NULL,
        nome_original    TEXT NOT NULL,
        nome_interno     TEXT NOT NULL,
        mime_type        TEXT NOT NULL,
        tamanho          INTEGER NOT NULL,
        caminho_relativo TEXT NOT NULL,
        usuario_id       INTEGER DEFAULT NULL,
        criado_em        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_svc_anexos_atendimento
        ON anexos (empresa_id, atendimento_id, criado_em);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_anexos_nome_interno
        ON anexos (nome_interno);
    `,
  },
  {
    version: 5,
    descricao: 'Remove UNIQUE de idempotencia (empresa_id, origem, referencia_externa) — entrada manual pode gerar mais de um atendimento para a mesma referencia externa; idempotencia definitiva fica para a integracao (nivel de evento externo + source instance)',
    sql: `
      DROP INDEX IF EXISTS idx_svc_atendimentos_idempotencia;

      -- Mantem busca eficiente por referencia externa (sem exigir unicidade) —
      -- necessaria tanto para o analista pesquisar quanto para a futura
      -- integracao consultar atendimentos ja existentes daquela referencia.
      CREATE INDEX IF NOT EXISTS idx_svc_atendimentos_referencia_externa
        ON atendimentos (empresa_id, origem, referencia_externa)
        WHERE referencia_externa IS NOT NULL;
    `,
  },
  {
    version: 6,
    descricao: 'Adiciona canal_entrada (separado de origem): origem = fonte de negocio do atendimento (manual/softexpert/outro); canal_entrada = meio tecnico pelo qual o dado chegou (web/api/importacao). Registros existentes recebem canal_entrada=web (unico canal em uso ate esta migration).',
    sql: `
      ALTER TABLE atendimentos ADD COLUMN canal_entrada TEXT NOT NULL DEFAULT 'web';

      CREATE INDEX IF NOT EXISTS idx_svc_atendimentos_canal_entrada
        ON atendimentos (empresa_id, canal_entrada);
    `,
  },
  {
    version: 7,
    descricao: 'ai_config: chaves de provider de IA por empresa, proprio do IA Service (nao compartilha com ai_config do IA Command)',
    sql: `
      CREATE TABLE IF NOT EXISTS ai_config (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id         INTEGER NOT NULL UNIQUE,
        provedor_primario  TEXT NOT NULL DEFAULT 'groq',
        fallback_ordem     TEXT NOT NULL DEFAULT 'groq,openai,claude,gemini',
        groq_api_key       TEXT DEFAULT NULL,
        openai_api_key     TEXT DEFAULT NULL,
        claude_api_key     TEXT DEFAULT NULL,
        gemini_api_key     TEXT DEFAULT NULL,
        criado_em          TEXT NOT NULL,
        atualizado_em      TEXT NOT NULL
      );
    `,
  },
  {
    version: 8,
    descricao: 'Diagnostico estruturado nas mensagens (diagnostico/causa/evidencias/correcao/validacao/nivel_confianca) e vinculo de anexos que fundamentaram a analise',
    sql: `
      ALTER TABLE mensagens ADD COLUMN diagnostico_json TEXT DEFAULT NULL;
      ALTER TABLE mensagens ADD COLUMN nivel_confianca TEXT DEFAULT NULL;
      ALTER TABLE mensagens ADD COLUMN provider TEXT DEFAULT NULL;
      ALTER TABLE mensagens ADD COLUMN model TEXT DEFAULT NULL;
    `,
  },
  {
    version: 9,
    descricao: 'Extracao de conteudo dos anexos (texto extraido, linguagem detectada, encoding) e versionamento de fonte corrigido',
    sql: `
      ALTER TABLE anexos ADD COLUMN conteudo_extraido TEXT DEFAULT NULL;
      ALTER TABLE anexos ADD COLUMN linguagem_detectada TEXT DEFAULT NULL;
      ALTER TABLE anexos ADD COLUMN encoding_detectado TEXT DEFAULT NULL;
      ALTER TABLE anexos ADD COLUMN e_codigo INTEGER NOT NULL DEFAULT 0;

      -- Versionamento: original (anexo enviado pelo usuario, nunca sobrescrito) ->
      -- corrigido (novo artefato gerado pela IA). anexo_original_id sempre aponta
      -- para um anexo com e_codigo=1; cada correcao gera uma NOVA linha em anexos
      -- (nunca sobrescreve), entao o historico de versoes e' a lista ordenada por
      -- criado_em de todos os anexos com o mesmo anexo_original_id.
      ALTER TABLE anexos ADD COLUMN anexo_original_id TEXT DEFAULT NULL REFERENCES anexos(id) ON DELETE SET NULL;
      ALTER TABLE anexos ADD COLUMN mensagem_origem_id TEXT DEFAULT NULL REFERENCES mensagens(id) ON DELETE SET NULL;
      ALTER TABLE anexos ADD COLUMN explicacao_alteracao TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_svc_anexos_versao_original
        ON anexos (anexo_original_id, criado_em);
    `,
  },
  {
    version: 10,
    descricao: 'Configuracao do Agente Local proprio do IA Service (URL/token/chave de criptografia) para acesso a fontes historicas via SQL SELECT-only. Nao le a config do agente do IA Command — mesmo servidor fisico do cliente, config logicamente separada (Etapa 0/1: bancos desacoplados).',
    sql: `
      CREATE TABLE IF NOT EXISTS agente_local_config (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id         INTEGER NOT NULL UNIQUE,
        url                TEXT DEFAULT NULL,
        token_enc          TEXT DEFAULT NULL,
        crypto_key_enc     TEXT DEFAULT NULL,
        crypto_ativo       INTEGER NOT NULL DEFAULT 0,
        ultimo_teste_em    TEXT DEFAULT NULL,
        ultimo_teste_ok    INTEGER DEFAULT NULL,
        criado_em          TEXT NOT NULL,
        atualizado_em      TEXT NOT NULL
      );
    `,
  },
  {
    version: 11,
    descricao: 'Fontes historicas configuradas (conexoes de dados externas, ex. SQL Server SoftExpert) — uma empresa pode ter mais de uma fonte no futuro (ProtheusAdapter, ServiceNowAdapter etc), por isso tabela propria em vez de campo unico em agente_local_config.',
    sql: `
      CREATE TABLE IF NOT EXISTS fontes_historicas (
        id                 TEXT PRIMARY KEY,
        empresa_id         INTEGER NOT NULL,
        connection_key     TEXT NOT NULL,
        nome               TEXT NOT NULL,
        sistema_origem     TEXT NOT NULL,
        adapter            TEXT NOT NULL,
        db_host            TEXT DEFAULT NULL,
        db_port            TEXT DEFAULT NULL,
        db_name            TEXT DEFAULT NULL,
        db_user            TEXT DEFAULT NULL,
        db_pass_enc        TEXT DEFAULT NULL,
        db_driver          TEXT DEFAULT NULL,
        ativo              INTEGER NOT NULL DEFAULT 1,
        sincronizada_agente_em TEXT DEFAULT NULL,
        criado_em          TEXT NOT NULL,
        atualizado_em      TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_fontes_historicas_empresa_key
        ON fontes_historicas (empresa_id, connection_key);
    `,
  },
  {
    version: 12,
    descricao: 'Controle de importacoes historicas (full/incremental) — progresso, checkpoint para retomada, contadores.',
    sql: `
      CREATE TABLE IF NOT EXISTS importacoes (
        id                     TEXT PRIMARY KEY,
        empresa_id             INTEGER NOT NULL,
        fonte_id               TEXT NOT NULL REFERENCES fontes_historicas(id) ON DELETE CASCADE,
        tipo                   TEXT NOT NULL DEFAULT 'full',
        status                 TEXT NOT NULL DEFAULT 'pendente',
        periodo_inicio         TEXT DEFAULT NULL,
        periodo_fim            TEXT DEFAULT NULL,
        checkpoint_json        TEXT DEFAULT NULL,
        registros_lidos        INTEGER NOT NULL DEFAULT 0,
        registros_inseridos    INTEGER NOT NULL DEFAULT 0,
        registros_atualizados  INTEGER NOT NULL DEFAULT 0,
        registros_ignorados    INTEGER NOT NULL DEFAULT 0,
        registros_erro         INTEGER NOT NULL DEFAULT 0,
        posicionamentos_lidos  INTEGER NOT NULL DEFAULT 0,
        posicionamentos_inseridos INTEGER NOT NULL DEFAULT 0,
        posicionamentos_atualizados INTEGER NOT NULL DEFAULT 0,
        mensagem_erro          TEXT DEFAULT NULL,
        inicio_em              TEXT DEFAULT NULL,
        termino_em             TEXT DEFAULT NULL,
        criado_em              TEXT NOT NULL,
        atualizado_em          TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_svc_importacoes_empresa
        ON importacoes (empresa_id, criado_em);

      CREATE INDEX IF NOT EXISTS idx_svc_importacoes_fonte_status
        ON importacoes (fonte_id, status);
    `,
  },
  {
    version: 13,
    descricao: 'RAW da importacao: preserva o registro COMPLETO recebido da origem (SQL Server), antes de qualquer normalizacao/selecao de campos. Nunca descartado.',
    sql: `
      CREATE TABLE IF NOT EXISTS raw_import (
        id                 TEXT PRIMARY KEY,
        empresa_id         INTEGER NOT NULL,
        fonte_id           TEXT NOT NULL REFERENCES fontes_historicas(id) ON DELETE CASCADE,
        sistema_origem     TEXT NOT NULL,
        tabela_origem      TEXT NOT NULL,
        oid_origem         TEXT NOT NULL,
        dados_json         TEXT NOT NULL,
        hash_conteudo      TEXT NOT NULL,
        importacao_id      TEXT DEFAULT NULL REFERENCES importacoes(id) ON DELETE SET NULL,
        importado_em       TEXT NOT NULL
      );

      -- Idempotencia do RAW: mesmo registro de origem (empresa+fonte+tabela+oid)
      -- nunca duplica — reimportar so grava se o hash mudou (ver services).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_raw_import_origem
        ON raw_import (empresa_id, fonte_id, tabela_origem, oid_origem);

      CREATE INDEX IF NOT EXISTS idx_svc_raw_import_hash
        ON raw_import (empresa_id, tabela_origem, hash_conteudo);
    `,
  },
  {
    version: 14,
    descricao: 'Clientes, usuarios de clientes e tecnicos — entidades normalizadas da base historica. CNPJ normalizado (so digitos) e UNIQUE por empresa (tenant do IA Service), nao globalmente — dois tenants diferentes nunca compartilham o mesmo registro de cliente mesmo com CNPJ identico.',
    sql: `
      CREATE TABLE IF NOT EXISTS clientes (
        id                 TEXT PRIMARY KEY,
        empresa_id         INTEGER NOT NULL,
        cnpj               TEXT NOT NULL,
        nome               TEXT DEFAULT NULL,
        nome_fantasia      TEXT DEFAULT NULL,
        ativo              INTEGER NOT NULL DEFAULT 1,
        criado_em          TEXT NOT NULL,
        atualizado_em      TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_clientes_empresa_cnpj
        ON clientes (empresa_id, cnpj);

      CREATE TABLE IF NOT EXISTS usuarios_cliente (
        id                 TEXT PRIMARY KEY,
        empresa_id         INTEGER NOT NULL,
        cliente_id         TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        sistema_origem     TEXT NOT NULL,
        id_origem          TEXT DEFAULT NULL,
        identificador      TEXT DEFAULT NULL,
        nome               TEXT DEFAULT NULL,
        email              TEXT DEFAULT NULL,
        telefone           TEXT DEFAULT NULL,
        ativo              INTEGER NOT NULL DEFAULT 1,
        criado_em          TEXT NOT NULL,
        atualizado_em      TEXT NOT NULL
      );

      -- Chave natural do usuario de cliente: (empresa, sistema_origem, id_origem) —
      -- evita colisao entre usuarios de clientes diferentes ou origens diferentes
      -- que reutilizem numeracao interna (CDUSER do SoftExpert nao e globalmente unico).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_usuarios_cliente_origem
        ON usuarios_cliente (empresa_id, sistema_origem, id_origem)
        WHERE id_origem IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_svc_usuarios_cliente_cliente
        ON usuarios_cliente (cliente_id);

      CREATE TABLE IF NOT EXISTS tecnicos (
        id                 TEXT PRIMARY KEY,
        empresa_id         INTEGER NOT NULL,
        sistema_origem     TEXT NOT NULL,
        id_origem          TEXT NOT NULL,
        nome               TEXT DEFAULT NULL,
        email              TEXT DEFAULT NULL,
        ativo              INTEGER NOT NULL DEFAULT 1,
        criado_em          TEXT NOT NULL,
        atualizado_em      TEXT NOT NULL
      );

      -- Tecnico e identificado por (empresa, sistema_origem, id_origem) — CDUSERANA
      -- do SoftExpert, escopado por empresa/origem para evitar colisao entre fontes.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_tecnicos_origem
        ON tecnicos (empresa_id, sistema_origem, id_origem);
    `,
  },
  {
    version: 15,
    descricao: 'Chamados e posicionamentos — entidades centrais da base historica, normalizadas a partir do RAW (DYNITSM/DYNITSMGRIDREGISTR). Responsavel ATUAL do chamado (tecnico_responsavel_id) e tecnico que fez um posicionamento especifico (posicionamentos.tecnico_id) sao conceitos distintos e nunca fundidos.',
    sql: `
      CREATE TABLE IF NOT EXISTS chamados (
        id                     TEXT PRIMARY KEY,
        empresa_id             INTEGER NOT NULL,
        fonte_id               TEXT NOT NULL REFERENCES fontes_historicas(id) ON DELETE CASCADE,
        sistema_origem         TEXT NOT NULL,
        oid_origem             TEXT NOT NULL,
        numero                 TEXT NOT NULL,
        cliente_id             TEXT DEFAULT NULL REFERENCES clientes(id) ON DELETE SET NULL,
        solicitante_id         TEXT DEFAULT NULL REFERENCES usuarios_cliente(id) ON DELETE SET NULL,
        tecnico_responsavel_id TEXT DEFAULT NULL REFERENCES tecnicos(id) ON DELETE SET NULL,
        data_abertura          TEXT DEFAULT NULL,

        produto                TEXT DEFAULT NULL,
        familia                TEXT DEFAULT NULL,
        modulo                 TEXT DEFAULT NULL,
        servico                TEXT DEFAULT NULL,
        tipo_chamado           TEXT DEFAULT NULL,
        tipo_chamado_se        TEXT DEFAULT NULL,
        tipo_chamado_final     TEXT DEFAULT NULL,
        natureza               TEXT DEFAULT NULL,
        nivel                  TEXT DEFAULT NULL,

        titulo                 TEXT DEFAULT NULL,
        assunto                TEXT DEFAULT NULL,
        breve_descricao        TEXT DEFAULT NULL,
        descricao              TEXT DEFAULT NULL,
        informacoes_adicionais TEXT DEFAULT NULL,
        observacoes            TEXT DEFAULT NULL,

        sla                    TEXT DEFAULT NULL,
        sla_horas              REAL DEFAULT NULL,
        sla_status             TEXT DEFAULT NULL,
        sla_status_final       TEXT DEFAULT NULL,
        sla_inicial            TEXT DEFAULT NULL,
        sla_anterior           TEXT DEFAULT NULL,

        solucao_aplicada       TEXT DEFAULT NULL,
        avaliacao              TEXT DEFAULT NULL,
        total_horas            REAL DEFAULT NULL,

        chamado_referencia     TEXT DEFAULT NULL,

        hash_conteudo          TEXT DEFAULT NULL,
        precisa_indexacao      INTEGER NOT NULL DEFAULT 1,
        indexado_em            TEXT DEFAULT NULL,

        atualizado_origem_em   TEXT DEFAULT NULL,
        criado_em              TEXT NOT NULL,
        atualizado_em          TEXT NOT NULL
      );

      -- Idempotencia do chamado: (empresa, fonte, oid_origem) — OID e o identificador
      -- tecnico estavel da origem (nunca IDPROCESS sozinho, que e so o numero funcional).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_chamados_origem
        ON chamados (empresa_id, fonte_id, oid_origem);

      CREATE INDEX IF NOT EXISTS idx_svc_chamados_numero
        ON chamados (empresa_id, numero);

      CREATE INDEX IF NOT EXISTS idx_svc_chamados_cliente
        ON chamados (cliente_id, data_abertura);

      CREATE INDEX IF NOT EXISTS idx_svc_chamados_classificacao
        ON chamados (empresa_id, produto, familia, modulo);

      CREATE INDEX IF NOT EXISTS idx_svc_chamados_precisa_indexacao
        ON chamados (empresa_id, precisa_indexacao);

      CREATE INDEX IF NOT EXISTS idx_svc_chamados_data_abertura
        ON chamados (empresa_id, data_abertura);

      CREATE TABLE IF NOT EXISTS posicionamentos (
        id                     TEXT PRIMARY KEY,
        empresa_id             INTEGER NOT NULL,
        fonte_id               TEXT NOT NULL REFERENCES fontes_historicas(id) ON DELETE CASCADE,
        oid_origem             TEXT NOT NULL,
        chamado_id             TEXT NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
        data_posicionamento    TEXT DEFAULT NULL,

        tecnico_id             TEXT DEFAULT NULL REFERENCES tecnicos(id) ON DELETE SET NULL,
        tecnico_nome_origem    TEXT DEFAULT NULL,
        usuario_cliente_id     TEXT DEFAULT NULL REFERENCES usuarios_cliente(id) ON DELETE SET NULL,

        situacao               TEXT DEFAULT NULL,
        tipo                   TEXT DEFAULT NULL,
        motivo                 TEXT DEFAULT NULL,

        assunto                TEXT DEFAULT NULL,
        descricao              TEXT DEFAULT NULL,
        resultado              TEXT DEFAULT NULL,

        hora_inicio            TEXT DEFAULT NULL,
        hora_fim               TEXT DEFAULT NULL,
        hora_intervalo         TEXT DEFAULT NULL,
        total_horas            REAL DEFAULT NULL,

        aguardando_retorno     INTEGER DEFAULT NULL,

        oid_arquivo1           TEXT DEFAULT NULL,
        oid_arquivo2           TEXT DEFAULT NULL,

        hash_conteudo          TEXT DEFAULT NULL,

        criado_em              TEXT NOT NULL,
        atualizado_em          TEXT NOT NULL
      );

      -- Idempotencia do posicionamento: (empresa, fonte, oid_origem) — OID de
      -- DYNITSMGRIDREGISTR e estavel e unico por origem.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_posicionamentos_origem
        ON posicionamentos (empresa_id, fonte_id, oid_origem);

      CREATE INDEX IF NOT EXISTS idx_svc_posicionamentos_chamado
        ON posicionamentos (chamado_id, data_posicionamento);

      CREATE INDEX IF NOT EXISTS idx_svc_posicionamentos_tecnico
        ON posicionamentos (tecnico_id, data_posicionamento);
    `,
  },
  {
    version: 16,
    descricao: 'Inconsistencias de importacao (dados suspeitos identificados sem alterar o RAW original) — ex. CNPJ invalido/ausente, chamado sem solicitante, posicionamento sem tecnico.',
    sql: `
      CREATE TABLE IF NOT EXISTS importacao_inconsistencias (
        id                 TEXT PRIMARY KEY,
        empresa_id         INTEGER NOT NULL,
        importacao_id      TEXT NOT NULL REFERENCES importacoes(id) ON DELETE CASCADE,
        tipo_entidade      TEXT NOT NULL,
        oid_origem         TEXT DEFAULT NULL,
        tipo_inconsistencia TEXT NOT NULL,
        detalhe            TEXT DEFAULT NULL,
        criado_em          TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_svc_importacao_inconsistencias_importacao
        ON importacao_inconsistencias (importacao_id, tipo_inconsistencia);
    `,
  },
  {
    version: 17,
    descricao: 'Telefone em consultores — dado de identificacao cruzada (ex.: futuro canal WhatsApp), NAO mecanismo de login. Login continua exclusivamente via IA HUB (window._iahubUser), conforme decisao ja registrada em consultor-service.js.',
    sql: `
      ALTER TABLE consultores ADD COLUMN telefone TEXT DEFAULT NULL;
    `,
  },
  {
    version: 18,
    descricao: 'Status de encerramento do chamado (Pendente/Andamento/Encerrado) — calculado na origem via JOIN com WFPROCESS (formula e tabela fornecidas pelo usuario, validadas contra dados reais em 2026-09). Usado pela fila do radar para excluir chamados ja encerrados.',
    sql: `
      ALTER TABLE chamados ADD COLUMN status_encerramento TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_svc_chamados_status_encerramento
        ON chamados (empresa_id, status_encerramento);
    `,
  },
  {
    version: 19,
    descricao: 'SLA_PRAZO do chamado (Em dia/Proxima do vencimento/Em atraso) — calculo DINAMICO via WFPROCESS (formula fornecida pelo usuario, validada contra dados reais em 2026-09). Distinto de sla_status_final (que e o desfecho historico de como o chamado foi encerrado, nao seu prazo atual). Usado pela fila do radar para filtrar em_atraso/em_dia/todos.',
    sql: `
      ALTER TABLE chamados ADD COLUMN sla_prazo TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_svc_chamados_sla_prazo
        ON chamados (empresa_id, sla_prazo);
    `,
  },
  {
    version: 20,
    descricao: 'Preferencias da tela Radar de Chamados por empresa (ex.: intervalo de auto-refresh) — antes so em localStorage do navegador (por dispositivo), agora compartilhado entre qualquer analista que abrir a tela.',
    sql: `
      CREATE TABLE IF NOT EXISTS radar_config (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id                INTEGER NOT NULL UNIQUE,
        auto_refresh_segundos     INTEGER NOT NULL DEFAULT 60,
        criado_em                 TEXT NOT NULL,
        atualizado_em             TEXT NOT NULL
      );
    `,
  },
  {
    version: 21,
    descricao: 'Login externo por telefone/WhatsApp (canal alternativo ao login do IA HUB) — challenge de OTP e sessao externa, mesmo padrao de protheus_web_login_challenges/protheus_chat_tokens do IA Command (codigo/token nunca em texto plano, so hash). O envio do codigo reaproveita o WhatsApp ja configurado no IA Command via rota server-to-server protegida por segredo compartilhado (env var, sem tabela nova em nenhum dos dois sistemas).',
    sql: `
      CREATE TABLE IF NOT EXISTS svc_login_challenges (
        id            TEXT PRIMARY KEY,
        empresa_id    INTEGER NOT NULL,
        telefone      TEXT NOT NULL,
        codigo_hash   TEXT NOT NULL,
        tentativas    INTEGER NOT NULL DEFAULT 0,
        expira_em     TEXT NOT NULL,
        usado_em      TEXT DEFAULT NULL,
        ip            TEXT DEFAULT NULL,
        user_agent    TEXT DEFAULT NULL,
        criado_em     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_svc_login_challenges_telefone
        ON svc_login_challenges (empresa_id, telefone, expira_em);

      CREATE TABLE IF NOT EXISTS svc_sessoes_externas (
        id                TEXT PRIMARY KEY,
        empresa_id        INTEGER NOT NULL,
        consultor_id      TEXT NOT NULL REFERENCES consultores(id) ON DELETE CASCADE,
        token_hash        TEXT NOT NULL UNIQUE,
        expira_em         TEXT NOT NULL,
        criado_em         TEXT NOT NULL,
        ultimo_acesso_em  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_svc_sessoes_externas_expira
        ON svc_sessoes_externas (expira_em);
    `,
  },
  {
    version: 22,
    descricao: 'Preserva o texto categorico real de AGUARDANRETORNO (DYNITSMGRIDREGISTR) em posicionamentos.situacao_retorno — o campo aguardando_retorno (booleano, so distingue ATENDENTE de "nao ATENDENTE") colapsava valores distintos como RETORNO - CLIENTE em false, perdendo a informacao de quem exatamente o chamado esta aguardando (pedido do usuario, 2026-09: exibir isso no cabecalho do chat).',
    sql: `
      ALTER TABLE posicionamentos ADD COLUMN situacao_retorno TEXT DEFAULT NULL;
    `,
  },
  {
    version: 23,
    descricao: 'Preferencia por consultor: pre-analise automatica da IA ao abrir um chamado no Radar (pedido do usuario, 2026-09) — ate aqui a pre-analise so disparava no momento da IMPORTACAO (primeiro posicionamento com aguardando_retorno=true). Agora cada consultor escolhe se, ao SELECIONAR um chamado ainda sem atendimento, a IA ja analisa sozinha ou so responde quando ele perguntar. Default 1 (automatica) preserva o comportamento que ja existia para quem nao mexer na config.',
    sql: `
      ALTER TABLE consultores ADD COLUMN pre_analise_automatica INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 24,
    descricao: 'Login externo por TELEFONE puro (pedido do usuario, 2026-09): remove a exigencia de escolher a empresa antes de digitar o telefone (URL /entrar-servico/:empresaSlug) — mesmo telefone pode ter consultor cadastrado em mais de uma empresa (ex. J2A e C3I), e o sistema passa a descobrir isso sozinho e permitir trocar de empresa dentro do chat ja logado, igual ja funciona no IA Command (resolverEmpresaDoCanal). svc_login_challenges recriada com empresa_id NULLABLE (challenge agora e por telefone, a empresa so e definida na escolha apos verificar o codigo) — seguro derrubar a tabela antiga: guarda so codigos de OTP com TTL de minutos, nenhum challenge sobrevive a um deploy.',
    sql: `
      DROP TABLE IF EXISTS svc_login_challenges;

      CREATE TABLE svc_login_challenges (
        id            TEXT PRIMARY KEY,
        telefone      TEXT NOT NULL,
        codigo_hash   TEXT NOT NULL,
        tentativas    INTEGER NOT NULL DEFAULT 0,
        expira_em     TEXT NOT NULL,
        usado_em      TEXT DEFAULT NULL,
        ip            TEXT DEFAULT NULL,
        user_agent    TEXT DEFAULT NULL,
        criado_em     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_svc_login_challenges_telefone
        ON svc_login_challenges (telefone, expira_em);
    `,
  },
  {
    version: 25,
    descricao: 'usuario_id_iahub em consultores deixa de ser obrigatorio (pedido explicito do usuario, 2026-09, reverte a decisao documentada na migration v17): o unico caminho de acesso ao Radar hoje e por telefone (login externo, resolve tudo via consultores.id/telefone, nunca usuario_id_iahub) — a intencao e cadastrar consultores como "analista com telefone", sem precisar criar/vincular um usuario de login do IA HUB para cada um. usuario_id_iahub continua existindo (usuarios ja vinculados nao perdem o vinculo) mas vira opcional — SQLite nao suporta ALTER COLUMN DROP NOT NULL, entao recria a tabela preservando id (nunca muda, FKs de atendimentos/svc_sessoes_externas continuam integras) e todos os dados existentes.',
    sql: `
      CREATE TABLE consultores_novo (
        id                       TEXT PRIMARY KEY,
        usuario_id_iahub         INTEGER DEFAULT NULL,
        empresa_id               INTEGER NOT NULL,
        id_softexpert            TEXT DEFAULT NULL,
        telefone                 TEXT DEFAULT NULL,
        ativo                    INTEGER NOT NULL DEFAULT 1,
        pre_analise_automatica   INTEGER NOT NULL DEFAULT 1,
        criado_em                TEXT NOT NULL,
        atualizado_em            TEXT NOT NULL
      );

      INSERT INTO consultores_novo (id, usuario_id_iahub, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, criado_em, atualizado_em)
        SELECT id, usuario_id_iahub, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, criado_em, atualizado_em FROM consultores;

      DROP TABLE consultores;
      ALTER TABLE consultores_novo RENAME TO consultores;

      -- Antes era UNIQUE(usuario_id_iahub, empresa_id) — com o campo agora
      -- opcional, um indice unico normal trataria multiplos NULL como
      -- nao-colidentes (comportamento correto: N consultores sem usuario
      -- vinculado na mesma empresa devem poder coexistir), mas o filtro
      -- WHERE explicito deixa essa intencao inequivoca e evita qualquer
      -- ambiguidade de comportamento entre versoes do SQLite.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_consultores_usuario_empresa
        ON consultores (usuario_id_iahub, empresa_id)
        WHERE usuario_id_iahub IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_svc_consultores_empresa_ativo
        ON consultores (empresa_id, ativo);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_consultores_softexpert
        ON consultores (empresa_id, id_softexpert)
        WHERE id_softexpert IS NOT NULL;
    `,
  },
  {
    version: 26,
    descricao: 'Apelido de URL configuravel por empresa para o login externo (/entrar-servico/:apelido) — pedido explicito do usuario, 2026-09, mesmo padrao ja usado no IA Command (protheus_web_login_path em ai_config, configurado na propria tela de Configuracao de IA). O login continua funcionando SEM apelido (so por telefone, /entrar-servico) — o apelido e so um atalho de conveniencia/identidade visual por empresa (ex. /entrar-servico/j2a), nunca restringe nem substitui a resolucao por telefone que ja existe (um consultor multiempresa continua podendo trocar de empresa dentro do chat independente de qual apelido usou para entrar).',
    sql: `
      ALTER TABLE ai_config ADD COLUMN login_externo_apelido TEXT DEFAULT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_ai_config_login_externo_apelido
        ON ai_config (login_externo_apelido)
        WHERE login_externo_apelido IS NOT NULL;
    `,
  },
  {
    version: 27,
    descricao: 'Modelo especifico por provedor de IA (pedido do usuario, 2026-09, mesmo padrao do IA Command) — defaults iguais aos ja hardcoded em ai-provider-client.js/PROVIDER_CONFIGS, entao quem nunca mexer no campo continua com o comportamento identico ao de hoje. IMPORTANTE: diferente do IA Command (onde o campo e salvo mas 3 dos 5 provedores nunca sao de fato aplicados nas chamadas de producao, falha real encontrada em intent-service.js), aqui os 4 provedores respeitam o modelo escolhido — ver ai-config-service.resolverKeysEOrdem e ai-provider-client.chamarIA.',
    sql: `
      ALTER TABLE ai_config ADD COLUMN groq_modelo TEXT DEFAULT 'openai/gpt-oss-20b';
      ALTER TABLE ai_config ADD COLUMN openai_modelo TEXT DEFAULT 'gpt-4o-mini';
      ALTER TABLE ai_config ADD COLUMN claude_modelo TEXT DEFAULT 'claude-haiku-4-5-20251001';
      ALTER TABLE ai_config ADD COLUMN gemini_modelo TEXT DEFAULT 'gemini-3.5-flash';
    `,
  },
  {
    version: 28,
    descricao: 'Metadados de origem nas mensagens do Radar para reconstruir o historico importado do SoftExpert como conversa WhatsApp (abertura + um posicionamento por mensagem), sem apagar mensagens manuais do analista nem respostas da IA.',
    sql: `
      ALTER TABLE mensagens ADD COLUMN origem_sistema TEXT DEFAULT NULL;
      ALTER TABLE mensagens ADD COLUMN origem_referencia TEXT DEFAULT NULL;
      ALTER TABLE mensagens ADD COLUMN origem_data TEXT DEFAULT NULL;
      ALTER TABLE mensagens ADD COLUMN origem_autor TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_svc_mensagens_origem
        ON mensagens (empresa_id, atendimento_id, origem_sistema, origem_referencia);
    `,
  },
];

module.exports = MIGRATIONS;
