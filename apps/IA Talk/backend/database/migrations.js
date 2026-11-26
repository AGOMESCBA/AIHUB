'use strict';

// Migrações do banco do IA Talk. SÓ o Claude Code cria migrações (uma única
// numeração; ver apps/IA Talk/AGENTS.md). Nunca alterar uma versão já
// publicada: criar a próxima.
//
// C0 cria só o núcleo de identidade e auditoria. Canais, mensagens, eventos e
// aplicações entram nas etapas C1–C4, seguindo docs/contratos.md.

module.exports = [
  {
    versao: 1,
    descricao: 'Núcleo: empresas, usuários, vínculos de usuário com empresa e auditoria',
    sql: `
      CREATE TABLE empresas (
        id              TEXT PRIMARY KEY,
        nome            TEXT NOT NULL,
        documento       TEXT,
        apelido         TEXT COLLATE NOCASE UNIQUE,
        logo_url        TEXT,
        situacao        TEXT NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'inativa')),
        hub_empresa_id  INTEGER UNIQUE,
        criado_em       TEXT NOT NULL,
        atualizado_em   TEXT NOT NULL
      );

      CREATE TABLE usuarios (
        id                        TEXT PRIMARY KEY,
        nome                      TEXT NOT NULL,
        telefone                  TEXT NOT NULL UNIQUE,
        email                     TEXT,
        hub_usuario_id            TEXT UNIQUE,
        administrador_plataforma  INTEGER NOT NULL DEFAULT 0 CHECK (administrador_plataforma IN (0, 1)),
        situacao                  TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'inativo')),
        ultimo_acesso_em          TEXT,
        criado_em                 TEXT NOT NULL,
        atualizado_em             TEXT NOT NULL
      );

      CREATE TABLE membros (
        id             TEXT PRIMARY KEY,
        empresa_id     TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id     TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        papel          TEXT NOT NULL CHECK (papel IN ('admin_empresa', 'supervisor', 'atendente', 'auditor')),
        situacao       TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'inativo')),
        criado_em      TEXT NOT NULL,
        atualizado_em  TEXT NOT NULL,
        UNIQUE (empresa_id, usuario_id)
      );
      CREATE INDEX idx_membros_usuario ON membros (usuario_id);

      -- empresa_id NULL = ação da administração da plataforma.
      CREATE TABLE auditoria (
        id            TEXT PRIMARY KEY,
        empresa_id    TEXT REFERENCES empresas(id) ON DELETE CASCADE,
        em            TEXT NOT NULL,
        usuario_id    TEXT,
        aplicacao_id  TEXT,
        acao          TEXT NOT NULL,
        alvo_tipo     TEXT,
        alvo_id       TEXT,
        resumo        TEXT,
        ip            TEXT
      );
      CREATE INDEX idx_auditoria_empresa_em ON auditoria (empresa_id, em);
    `,
  },
  {
    versao: 2,
    descricao: 'C1 — sessões, login por código, sites autorizados, e-mail de envio, aplicações e tokens',
    sql: `
      -- Sessão: só o hash do token fica no banco (padrão do chat Protheus).
      CREATE TABLE sessoes (
        id             TEXT PRIMARY KEY,
        token_hash     TEXT NOT NULL UNIQUE,
        usuario_id     TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        empresa_id     TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        origem         TEXT NOT NULL CHECK (origem IN ('telefone', 'hub', 'servidor')),
        criada_em      TEXT NOT NULL,
        ultimo_uso_em  TEXT NOT NULL,
        expira_em      TEXT NOT NULL,
        revogada_em    TEXT,
        ip             TEXT
      );
      CREATE INDEX idx_sessoes_usuario ON sessoes (usuario_id);

      -- Código de login: hash do código e do telefone; nunca o valor.
      CREATE TABLE desafios_login (
        id             TEXT PRIMARY KEY,
        empresa_id     TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id     TEXT REFERENCES usuarios(id) ON DELETE CASCADE,
        telefone_hash  TEXT NOT NULL,
        codigo_hash    TEXT,
        enviado_por    TEXT CHECK (enviado_por IN ('whatsapp', 'email', 'nenhum')),
        tentativas     INTEGER NOT NULL DEFAULT 0,
        criado_em      TEXT NOT NULL,
        expira_em      TEXT NOT NULL,
        consumido_em   TEXT,
        ip             TEXT
      );
      CREATE INDEX idx_desafios_telefone ON desafios_login (telefone_hash, criado_em);
      CREATE INDEX idx_desafios_ip ON desafios_login (ip, criado_em);

      CREATE TABLE sites_autorizados (
        empresa_id     TEXT PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
        origens        TEXT NOT NULL DEFAULT '[]',
        versao         INTEGER NOT NULL DEFAULT 0,
        atualizado_em  TEXT,
        atualizado_por TEXT
      );

      CREATE TABLE email_envio (
        empresa_id      TEXT PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
        tipo            TEXT NOT NULL CHECK (tipo IN ('gmail', 'smtp')),
        email           TEXT NOT NULL,
        senha_cifrada   TEXT,
        smtp_host       TEXT,
        smtp_porta      INTEGER,
        smtp_seguro     INTEGER NOT NULL DEFAULT 1 CHECK (smtp_seguro IN (0, 1)),
        remetente_nome  TEXT,
        situacao        TEXT NOT NULL DEFAULT 'nao_testado' CHECK (situacao IN ('nao_testado', 'testado', 'falhou')),
        atualizado_em   TEXT NOT NULL
      );

      CREATE TABLE aplicacoes (
        id                        TEXT PRIMARY KEY,
        empresa_id                TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome                      TEXT NOT NULL,
        descricao                 TEXT,
        situacao                  TEXT NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'inativa')),
        escopos                   TEXT NOT NULL DEFAULT '[]',
        webhook_url               TEXT,
        webhook_ativo             INTEGER NOT NULL DEFAULT 0 CHECK (webhook_ativo IN (0, 1)),
        webhook_segredo_cifrado   TEXT,
        criado_em                 TEXT NOT NULL,
        atualizado_em             TEXT NOT NULL
      );
      CREATE INDEX idx_aplicacoes_empresa ON aplicacoes (empresa_id);

      -- canal_id sem chave estrangeira até a C2 criar a tabela de canais.
      CREATE TABLE aplicacao_canais (
        aplicacao_id  TEXT NOT NULL REFERENCES aplicacoes(id) ON DELETE CASCADE,
        canal_id      TEXT NOT NULL,
        PRIMARY KEY (aplicacao_id, canal_id)
      );

      CREATE TABLE aplicacao_tokens (
        id             TEXT PRIMARY KEY,
        aplicacao_id   TEXT NOT NULL REFERENCES aplicacoes(id) ON DELETE CASCADE,
        empresa_id     TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        prefixo        TEXT NOT NULL,
        token_hash     TEXT NOT NULL UNIQUE,
        criado_em      TEXT NOT NULL,
        ultimo_uso_em  TEXT,
        revogado_em    TEXT
      );
      CREATE INDEX idx_aplicacao_tokens_aplicacao ON aplicacao_tokens (aplicacao_id);
    `,
  },
  {
    versao: 3,
    descricao: 'C1 — entrada pelo IAHub (ticket de uso único) e link de primeiro acesso',
    sql: `
      ALTER TABLE empresas ADD COLUMN hub_empresa_nome TEXT;

      -- Ticket assinado pelo IAHub: cada jti vale uma única vez.
      CREATE TABLE tickets_hub_usados (
        jti       TEXT PRIMARY KEY,
        usado_em  TEXT NOT NULL,
        expira_em TEXT NOT NULL
      );

      -- Link de uso único gerado no servidor (primeiro administrador, suporte).
      CREATE TABLE links_acesso (
        id          TEXT PRIMARY KEY,
        token_hash  TEXT NOT NULL UNIQUE,
        usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        empresa_id  TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        criado_em   TEXT NOT NULL,
        expira_em   TEXT NOT NULL,
        usado_em    TEXT
      );
    `,
  },
  {
    versao: 4,
    descricao: 'C2 — canais de WhatsApp, empresas que usam o número, concessão e log do canal',
    sql: `
      CREATE TABLE canais (
        id                     TEXT PRIMARY KEY,
        empresa_dona_id        TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome                   TEXT NOT NULL,
        numero                 TEXT,
        provedor               TEXT NOT NULL CHECK (provedor IN ('wweb', 'meta')),
        estado                 TEXT NOT NULL DEFAULT 'parado',
        estado_desde           TEXT NOT NULL,
        estado_detalhe         TEXT,
        ligado                 INTEGER NOT NULL DEFAULT 0 CHECK (ligado IN (0, 1)),
        sessao_id              TEXT NOT NULL UNIQUE,
        -- Modo de teste: só grava/aceita mensagens dos números da lista; das demais guarda a contagem.
        modo_teste             INTEGER NOT NULL DEFAULT 1 CHECK (modo_teste IN (0, 1)),
        numeros_teste          TEXT NOT NULL DEFAULT '[]',
        recebidas_descartadas  INTEGER NOT NULL DEFAULT 0,
        ultima_mensagem_em     TEXT,
        criado_em              TEXT NOT NULL,
        atualizado_em          TEXT NOT NULL
      );

      CREATE TABLE canal_empresas (
        canal_id    TEXT NOT NULL REFERENCES canais(id) ON DELETE CASCADE,
        empresa_id  TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        padrao      INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0, 1)),
        PRIMARY KEY (canal_id, empresa_id)
      );
      CREATE INDEX idx_canal_empresas_empresa ON canal_empresas (empresa_id);

      -- Um único processo segura o número (ficha cresce a cada concessão).
      CREATE TABLE canal_concessoes (
        canal_id    TEXT PRIMARY KEY REFERENCES canais(id) ON DELETE CASCADE,
        dono        TEXT,
        ficha       INTEGER NOT NULL DEFAULT 0,
        valida_ate  TEXT
      );

      CREATE TABLE canal_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        canal_id  TEXT NOT NULL REFERENCES canais(id) ON DELETE CASCADE,
        em        TEXT NOT NULL,
        tipo      TEXT NOT NULL,
        mensagem  TEXT NOT NULL
      );
      CREATE INDEX idx_canal_log_canal ON canal_log (canal_id, id);
    `,
  },
  {
    versao: 5,
    descricao: 'Rotinas do IAHub na sessão (permissões por usuário e empresa da IA Gestão)',
    sql: `
      -- JSON com as rotinas talk-* liberadas no IAHub para esta pessoa nesta empresa.
      -- NULL = sessão sem origem no Hub (vale o papel do Talk) ou administrador do Hub.
      ALTER TABLE sessoes ADD COLUMN rotinas_hub TEXT;
    `,
  },
  {
    versao: 6,
    descricao: 'Empresas que a pessoa pode vincular a um canal (regra do IA Command, assinada pelo IAHub)',
    sql: `
      -- JSON [{ id, nome }] com ids de empresa do IAHub: IA Talk liberado e rotina talk-canais
      -- (ou administrador do IAHub). NULL = sessão sem origem no Hub.
      ALTER TABLE sessoes ADD COLUMN empresas_canais_hub TEXT;
    `,
  },
  {
    versao: 7,
    descricao: 'C3 — envio de mensagens: fila (outbox), linha do tempo de estados e idempotência da API v1',
    sql: `
      -- Publicado desligado: só a administração da plataforma liga o envio de cada canal.
      ALTER TABLE canais ADD COLUMN envio_habilitado INTEGER NOT NULL DEFAULT 0 CHECK (envio_habilitado IN (0, 1));

      -- Gravada ANTES de sair (outbox): se o Talk cair, a fila continua de onde parou.
      -- destino fica completo só aqui (para enviar); nas respostas sai sempre mascarado.
      CREATE TABLE mensagens (
        id                    TEXT PRIMARY KEY,
        empresa_id            TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        canal_id              TEXT NOT NULL REFERENCES canais(id) ON DELETE CASCADE,
        aplicacao_id          TEXT REFERENCES aplicacoes(id) ON DELETE SET NULL,
        usuario_id            TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
        origem                TEXT NOT NULL CHECK (origem IN ('api', 'teste_tela')),
        direcao               TEXT NOT NULL DEFAULT 'saida' CHECK (direcao IN ('saida', 'entrada')),
        destino               TEXT NOT NULL,
        tipo                  TEXT NOT NULL,
        conteudo              TEXT,
        previa                TEXT,
        estado                TEXT NOT NULL,
        tentativas            INTEGER NOT NULL DEFAULT 0,
        proxima_tentativa_em  TEXT,
        id_provedor           TEXT,
        correlacao_id         TEXT,
        metadados             TEXT NOT NULL DEFAULT '{}',
        ultimo_erro           TEXT,
        criada_em             TEXT NOT NULL,
        atualizada_em         TEXT NOT NULL
      );
      CREATE INDEX idx_mensagens_fila ON mensagens (canal_id, estado, criada_em);
      CREATE INDEX idx_mensagens_empresa ON mensagens (empresa_id, criada_em DESC, id DESC);
      CREATE UNIQUE INDEX idx_mensagens_provedor ON mensagens (canal_id, id_provedor) WHERE id_provedor IS NOT NULL;

      CREATE TABLE mensagem_estados (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        mensagem_id  TEXT NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
        estado       TEXT NOT NULL,
        em           TEXT NOT NULL,
        detalhe      TEXT
      );
      CREATE INDEX idx_mensagem_estados ON mensagem_estados (mensagem_id, id);

      -- Idempotency-Key da API v1: mesma chave + mesmo corpo = mesma resposta (24 h).
      CREATE TABLE idempotencia (
        aplicacao_id  TEXT NOT NULL REFERENCES aplicacoes(id) ON DELETE CASCADE,
        chave         TEXT NOT NULL,
        impressao     TEXT NOT NULL,
        mensagem_id   TEXT NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
        criado_em     TEXT NOT NULL,
        PRIMARY KEY (aplicacao_id, chave)
      );
    `,
  },
  {
    versao: 8,
    descricao: 'Regras do canal na tela: envio e recebimento separados (antes uma chave só, modo_teste)',
    sql: `
      -- envio_modo: desligado | teste (só a lista) | qualquer. recebimento_modo: teste (só a lista) | todos.
      -- modo_teste e envio_habilitado ficam só por compatibilidade (não são mais lidos).
      ALTER TABLE canais ADD COLUMN envio_modo TEXT NOT NULL DEFAULT 'desligado' CHECK (envio_modo IN ('desligado', 'teste', 'qualquer'));
      ALTER TABLE canais ADD COLUMN recebimento_modo TEXT NOT NULL DEFAULT 'teste' CHECK (recebimento_modo IN ('teste', 'todos'));
      UPDATE canais SET
        envio_modo = CASE WHEN envio_habilitado = 0 THEN 'desligado' WHEN modo_teste = 1 THEN 'teste' ELSE 'qualquer' END,
        recebimento_modo = CASE WHEN modo_teste = 1 THEN 'teste' ELSE 'todos' END;
    `,
  },
];
