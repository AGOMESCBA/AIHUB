// Teste dos "Ajustes Finais da Etapa 1" — item 4 (checklist), pontos 1-3:
// 1. migrations anteriores continuam registradas
// 2. novas migrations executam uma unica vez
// 3. dados existentes permanecem validos
//
// Simula um banco "legado" contendo APENAS as migrations v1-v4 (o estado do
// IA Service antes desta rodada de ajustes: sem canal_entrada, ainda com o
// UNIQUE de idempotencia), grava um atendimento nesse banco legado, e então
// abre esse MESMO arquivo com o modulo de database ATUAL (v1-v6) — replicando
// exatamente o que aconteceria ao dar upgrade no ia-service.db real.
//
// Executar: node "apps/IA Service/tests/ajustes-migracao-incremental.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-legacy-upgrade-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

// Snapshot das migrations v1-v4 tal como existiam ANTES dos ajustes finais
// (UNIQUE de idempotencia presente, sem coluna canal_entrada). Mantido aqui
// isolado do migrations.js atual de propósito — é o retrato de um estado
// passado do schema, não deve acompanhar futuras mudanças no arquivo real.
const MIGRATIONS_LEGADAS_V1_A_V4 = [
  { version: 1, descricao: 'consultores', sql: `
    CREATE TABLE IF NOT EXISTS consultores (
      id TEXT PRIMARY KEY, usuario_id_iahub INTEGER NOT NULL, empresa_id INTEGER NOT NULL,
      id_softexpert TEXT DEFAULT NULL, ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_consultores_usuario_empresa ON consultores (usuario_id_iahub, empresa_id);
  ` },
  { version: 2, descricao: 'atendimentos', sql: `
    CREATE TABLE IF NOT EXISTS atendimentos (
      id TEXT PRIMARY KEY, codigo TEXT NOT NULL, empresa_id INTEGER NOT NULL,
      origem TEXT NOT NULL DEFAULT 'manual', referencia_externa TEXT DEFAULT NULL,
      conteudo_bruto TEXT NOT NULL, contexto_estruturado_json TEXT DEFAULT NULL,
      contexto_origem TEXT NOT NULL DEFAULT 'ia', precisa_revisao INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'NOVO', criado_por_usuario_id INTEGER DEFAULT NULL,
      criado_por_integracao TEXT DEFAULT NULL,
      consultor_id TEXT DEFAULT NULL REFERENCES consultores(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_atendimentos_codigo ON atendimentos (codigo);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_atendimentos_idempotencia
      ON atendimentos (empresa_id, origem, referencia_externa) WHERE referencia_externa IS NOT NULL;
  ` },
  { version: 3, descricao: 'mensagens', sql: `
    CREATE TABLE IF NOT EXISTS mensagens (
      id TEXT PRIMARY KEY, empresa_id INTEGER NOT NULL,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
      papel TEXT NOT NULL, conteudo TEXT NOT NULL, usuario_id INTEGER DEFAULT NULL, criado_em TEXT NOT NULL
    );
  ` },
  { version: 4, descricao: 'anexos', sql: `
    CREATE TABLE IF NOT EXISTS anexos (
      id TEXT PRIMARY KEY, empresa_id INTEGER NOT NULL,
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
      mensagem_id TEXT DEFAULT NULL, nome_original TEXT NOT NULL, nome_interno TEXT NOT NULL,
      mime_type TEXT NOT NULL, tamanho INTEGER NOT NULL, caminho_relativo TEXT NOT NULL,
      usuario_id INTEGER DEFAULT NULL, criado_em TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_anexos_nome_interno ON anexos (nome_interno);
  ` },
];

function limpar() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

try {
  // ── Passo 1: cria o banco "legado" (so v1-v4) e grava um atendimento real ─
  let dbLegado = new Database(dbTmpPath);
  dbLegado.pragma('journal_mode = WAL');
  dbLegado.pragma('foreign_keys = ON');
  dbLegado.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, descricao TEXT, aplicado_em TEXT NOT NULL)');
  for (const m of MIGRATIONS_LEGADAS_V1_A_V4) {
    dbLegado.exec(m.sql);
    dbLegado.prepare('INSERT INTO schema_migrations (version, descricao, aplicado_em) VALUES (?, ?, ?)')
      .run(m.version, m.descricao, new Date().toISOString());
  }
  const agora = new Date().toISOString();
  dbLegado.prepare(`
    INSERT INTO atendimentos (id, codigo, empresa_id, origem, referencia_externa, conteudo_bruto, contexto_origem, status, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('id-legado-1', 'AI-000001', 9301, 'manual', null, 'Atendimento legado gravado antes dos ajustes finais.', 'nao_processado', 'NOVO', agora, agora);
  dbLegado.close();

  // ── Passo 2: abre o MESMO arquivo com o modulo de database ATUAL (v1-v6) ──
  const database = require('../backend/database');
  database.inicializarDB(dbTmpPath);
  const db = database.getDB();

  // Item 1: migrations anteriores (v1-v4) continuam registradas
  const versoesAplicadas = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version);
  assert.deepStrictEqual(versoesAplicadas, [1, 2, 3, 4, 5, 6], 'todas as versoes de v1 a v6 devem estar registradas apos o upgrade');

  // Item 2: novas migrations (v5, v6) executam uma unica vez — reabrir de novo
  // nao deve duplicar linhas em schema_migrations nem reaplicar SQL.
  database.fecharDB();
  delete require.cache[require.resolve('../backend/database')];
  const databaseReaberto = require('../backend/database');
  databaseReaberto.inicializarDB(dbTmpPath);
  const dbReaberto = databaseReaberto.getDB();
  const totalAposReabrir = dbReaberto.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get().total;
  assert.strictEqual(totalAposReabrir, 6, 'reabrir o banco nao deve reaplicar nem duplicar migrations');

  // Item 3: dados existentes (gravados sob o schema legado v1-v4) permanecem validos
  const legadoPreservado = dbReaberto.prepare('SELECT * FROM atendimentos WHERE id = ?').get('id-legado-1');
  assert.ok(legadoPreservado, 'atendimento legado deve continuar existindo apos o upgrade de schema');
  assert.strictEqual(legadoPreservado.codigo, 'AI-000001');
  assert.strictEqual(legadoPreservado.conteudo_bruto, 'Atendimento legado gravado antes dos ajustes finais.');
  assert.strictEqual(legadoPreservado.canal_entrada, 'web', "registro legado deve ter recebido o default 'web' na coluna nova canal_entrada");

  // Confirma que o UNIQUE de idempotencia (v1-v4) foi de fato removido pela v5
  const indices = dbReaberto.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='atendimentos'`).all().map(i => i.name);
  assert.ok(!indices.includes('idx_svc_atendimentos_idempotencia'), 'indice UNIQUE de idempotencia deve ter sido removido pela migration v5');

  // Confirma que o banco legado, agora com schema v6, aceita um segundo
  // atendimento manual com a MESMA referencia_externa de outro ja existente
  // (prova de que a remocao do UNIQUE realmente resolveu o problema em um
  // banco que antes tinha a restricao antiga).
  const atendimentoRepo = require('../backend/repositories/atendimento-repository');
  atendimentoRepo.criarAtendimento(9301, {
    origem: 'softexpert',
    canalEntrada: 'web',
    conteudoBruto: 'Novo atendimento no banco upgradeado, mesma referencia do legado nao se aplica aqui pois o legado nao tinha referencia — testando com uma nova.',
    referenciaExterna: '009999',
  });
  const segundoComMesmaRefNoLegado = atendimentoRepo.criarAtendimento(9301, {
    origem: 'softexpert',
    canalEntrada: 'web',
    conteudoBruto: 'Segundo atendimento com a mesma referencia externa, no banco que ja foi upgradeado.',
    referenciaExterna: '009999',
  });
  assert.ok(segundoComMesmaRefNoLegado.id, 'banco upgradeado deve aceitar referencia_externa repetida, confirmando que o UNIQUE legado nao se aplica mais');

  databaseReaberto.fecharDB();

  console.log('ajustes-migracao-incremental.test.js: ok (todos os asserts passaram)');
} finally {
  limpar();
}
