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
];
