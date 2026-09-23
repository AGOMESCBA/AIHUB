// Teste 19 da Etapa 1: reiniciar a aplicacao (fechar e reabrir a conexao SQLite)
// nao deve perder os dados gravados.
// Executar: node "apps/IA Service/tests/fundacao-persistencia.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-persist-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const EMPRESA = 9201;

function limpar() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

try {
  // ── "Sobe" a aplicacao pela primeira vez, cria um atendimento ─────────────
  const database1 = require('../backend/database');
  database1.inicializarDB(dbTmpPath);
  const atendimentoRepo1 = require('../backend/repositories/atendimento-repository');

  const criado = atendimentoRepo1.criarAtendimento(EMPRESA, {
    origem: 'manual',
    conteudoBruto: 'Atendimento criado antes do restart.',
  });
  assert.ok(criado.id);

  database1.fecharDB();

  // ── Simula reiniciar o processo: limpa cache de módulos e reabre o mesmo arquivo
  delete require.cache[require.resolve('../backend/database')];
  delete require.cache[require.resolve('../backend/repositories/atendimento-repository')];

  const database2 = require('../backend/database');
  database2.inicializarDB(dbTmpPath);
  const atendimentoRepo2 = require('../backend/repositories/atendimento-repository');

  const recuperado = atendimentoRepo2.getAtendimento(EMPRESA, criado.id);
  assert.ok(recuperado, 'atendimento deve continuar existindo apos reabrir o banco');
  assert.strictEqual(recuperado.codigo, criado.codigo, 'codigo deve ser preservado apos restart');
  assert.strictEqual(recuperado.conteudoBruto, criado.conteudoBruto, 'conteudo bruto deve ser preservado apos restart');

  const db = database2.getDB();
  const versoes = db.prepare('SELECT COUNT(*) as total FROM schema_migrations').get();
  assert.strictEqual(versoes.total, 6, 'migrations nao devem ser reaplicadas (schema_migrations continua com 6 linhas — v1 a v6)');

  database2.fecharDB();

  console.log('fundacao-persistencia.test.js: ok (todos os asserts passaram)');
} finally {
  limpar();
}
