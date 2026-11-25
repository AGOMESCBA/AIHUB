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
];
