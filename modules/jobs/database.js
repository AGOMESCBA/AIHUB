// Banco do serviço de jobs (IAHub-Jobs, pedido do usuário, 2026-11-24): agenda,
// concessões e histórico de execução de todos os agendadores. Separado dos
// bancos dos apps: coordenar execuções não depende do schema de nenhum app.
// O site também abre este arquivo (pedidos do "Executar agora" e estado do
// serviço), então as migrações rodam numa transação IMMEDIATE — dois processos
// subindo juntos não aplicam a mesma versão duas vezes.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'apps', 'IAHUB', 'data', 'jobs.db');

const MIGRACOES = [
  {
    version: 1,
    descricao: 'Serviço de jobs: concessões por job/instância (ficha = fencing token), execuções, pedidos de execução imediata e batimento do serviço.',
    sql: `
      CREATE TABLE jobs_concessoes (
        job_id TEXT NOT NULL,
        instancia TEXT NOT NULL,
        ficha INTEGER NOT NULL DEFAULT 0,
        dono TEXT,
        valida_ate TEXT,
        execucao_id INTEGER,
        falhas_seguidas INTEGER NOT NULL DEFAULT 0,
        aguardar_ate TEXT,
        PRIMARY KEY (job_id, instancia)
      );
      CREATE TABLE jobs_execucoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        instancia TEXT NOT NULL,
        ficha INTEGER NOT NULL,
        origem TEXT NOT NULL,
        dono TEXT NOT NULL,
        inicio TEXT NOT NULL,
        fim TEXT,
        duracao_ms INTEGER,
        resultado TEXT,
        erro TEXT,
        resumo TEXT
      );
      CREATE INDEX idx_jobs_execucoes_instancia ON jobs_execucoes (job_id, instancia, id DESC);
      CREATE INDEX idx_jobs_execucoes_abertas ON jobs_execucoes (fim) WHERE fim IS NULL;
      CREATE TABLE jobs_pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        instancia TEXT NOT NULL,
        origem TEXT NOT NULL,
        solicitado_em TEXT NOT NULL,
        atendido_em TEXT,
        execucao_id INTEGER,
        recusa TEXT
      );
      CREATE INDEX idx_jobs_pedidos_abertos ON jobs_pedidos (job_id, instancia) WHERE atendido_em IS NULL;
      CREATE TABLE jobs_servico (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        dono TEXT,
        iniciado_em TEXT,
        batimento_em TEXT,
        parando INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    version: 2,
    descricao: 'Tela Jobs (2026-11-24): configuração geral (limite, alertas), pausa e limite por job/instância, log de cada execução, empresa da execução, eventos do serviço com o usuário que agiu, pedidos de encerrar e controle dos alertas enviados.',
    sql: `
      CREATE TABLE jobs_config (
        chave TEXT PRIMARY KEY,
        valor TEXT,
        atualizado_em TEXT,
        atualizado_por TEXT
      );
      CREATE TABLE jobs_controle (
        job_id TEXT NOT NULL,
        instancia TEXT NOT NULL,
        pausado INTEGER NOT NULL DEFAULT 0,
        limite INTEGER,
        atualizado_em TEXT,
        atualizado_por TEXT,
        PRIMARY KEY (job_id, instancia)
      );
      ALTER TABLE jobs_execucoes ADD COLUMN empresa_id INTEGER;
      ALTER TABLE jobs_execucoes ADD COLUMN log TEXT;
      CREATE INDEX idx_jobs_execucoes_inicio ON jobs_execucoes (inicio DESC);
      ALTER TABLE jobs_pedidos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'executar';
      ALTER TABLE jobs_pedidos ADD COLUMN alvo_execucao_id INTEGER;
      ALTER TABLE jobs_pedidos ADD COLUMN solicitado_por TEXT;
      CREATE TABLE jobs_eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        momento TEXT NOT NULL,
        nivel TEXT NOT NULL,
        tipo TEXT NOT NULL,
        job_id TEXT,
        instancia TEXT,
        empresa_id INTEGER,
        texto TEXT NOT NULL,
        usuario TEXT
      );
      CREATE INDEX idx_jobs_eventos_momento ON jobs_eventos (id DESC);
      CREATE TABLE jobs_alertas (
        chave TEXT PRIMARY KEY,
        aberto_em TEXT NOT NULL,
        texto TEXT
      );
      ALTER TABLE jobs_servico ADD COLUMN parado_em TEXT;
    `,
  },
  {
    version: 3,
    descricao: 'Log do serviço de jobs (aba Serviço da tela Jobs, mesmo modelo do log do WhatsApp): linhas do supervisor, dos processos filhos e das ações da tela, com tipo para a cor.',
    sql: `
      CREATE TABLE jobs_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        momento TEXT NOT NULL,
        tipo TEXT NOT NULL,
        texto TEXT NOT NULL
      );
    `,
  },
];

let _db = null;

function getDB() {
  if (!_db) inicializarDB();
  return _db;
}

// dbPathOverride existe só para os testes isolarem o banco.
function inicializarDB(dbPathOverride) {
  const dbPath = dbPathOverride || DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, descricao TEXT, aplicado_em TEXT NOT NULL)');
  db.transaction(() => {
    const aplicadas = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
    for (const m of MIGRACOES) {
      if (aplicadas.has(m.version)) continue;
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, descricao, aplicado_em) VALUES (?, ?, ?)').run(m.version, m.descricao, new Date().toISOString());
      console.log(`[Jobs] Migração v${m.version} aplicada: ${m.descricao}`);
    }
  }).immediate();
  _db = db;
  return _db;
}

function fecharDB() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { inicializarDB, getDB, fecharDB, DB_PATH };
