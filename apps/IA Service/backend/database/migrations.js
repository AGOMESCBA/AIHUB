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
];

module.exports = MIGRATIONS;
