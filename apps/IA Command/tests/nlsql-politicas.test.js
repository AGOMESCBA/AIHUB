'use strict';

const assert = require('assert');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const politicas = require(path.join(ROOT, 'modules/erp/nlsql-cache/nlsql-politicas'));

let ok = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  [ok] ${nome}`);
  } catch (err) {
    console.error(`  [falha] ${nome}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

function row(score, resultado = 'match_template_exato', module = 'financeiro') {
  return {
    module,
    candidate_score: score,
    comparacao_resultado: resultado,
    classificacao_auto: resultado === 'mismatch' ? 'reprovado_automatico' : 'aprovado_automatico',
    classificacao_efetiva: resultado === 'mismatch' ? 'reprovado_automatico' : 'aprovado_automatico',
    detalhes_json: JSON.stringify({ ranking_fonte: 'embedding_hibrido' }),
  };
}

function criarDbTeste() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nlsql_semantic_shadow_log (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL,
      module TEXT,
      candidate_score REAL,
      comparacao_resultado TEXT NOT NULL,
      classificacao_auto TEXT,
      classificacao_efetiva TEXT,
      detalhes_json TEXT,
      criado_em TEXT NOT NULL
    );
    CREATE TABLE nlsql_semantic_policies (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL,
      module TEXT NOT NULL,
      fonte_ranking TEXT NOT NULL,
      min_score REAL DEFAULT NULL,
      min_score_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'observacao',
      status_motivo TEXT DEFAULT NULL,
      atualizado_por TEXT DEFAULT NULL,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_iac_nlsql_policies_unique
      ON nlsql_semantic_policies (empresa_id, module, fonte_ranking, min_score_key);
    CREATE TABLE nlsql_semantic_settings (
      empresa_id INTEGER PRIMARY KEY,
      shadow_enabled INTEGER NOT NULL DEFAULT 1,
      auto_reuse_enabled INTEGER NOT NULL DEFAULT 0,
      auto_policy_enabled INTEGER NOT NULL DEFAULT 1,
      precision_min REAL NOT NULL DEFAULT 0.995,
      sample_min INTEGER NOT NULL DEFAULT 30,
      atualizado_por TEXT DEFAULT NULL,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
  `);
  return db;
}

function inserirShadowBom(db, empresaId = 1, total = 30) {
  const stmt = db.prepare(`
    INSERT INTO nlsql_semantic_shadow_log (
      id, empresa_id, module, candidate_score, comparacao_resultado,
      classificacao_auto, classificacao_efetiva, detalhes_json, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < total; i++) {
    const r = row(0.996);
    stmt.run(
      `sh-${i}`,
      empresaId,
      r.module,
      r.candidate_score,
      r.comparacao_resultado,
      r.classificacao_auto,
      r.classificacao_efetiva,
      r.detalhes_json,
      new Date().toISOString(),
    );
  }
}

test('libera automaticamente quando ha precisao e amostra suficiente', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(row(0.996));
  const sugestoes = politicas.gerarSugestoes(rows);
  assert.strictEqual(sugestoes.length, 1);
  assert.strictEqual(sugestoes[0].status_sugerido, 'liberado');
});

test('sugere bloqueado quando existe mismatch', () => {
  const sugestoes = politicas.gerarSugestoes([
    row(0.996),
    row(0.996, 'mismatch'),
  ]);
  assert.strictEqual(sugestoes[0].status_sugerido, 'bloqueado');
});

test('sugere observacao quando amostra e pequena', () => {
  const sugestoes = politicas.gerarSugestoes([
    row(0.996),
    row(0.996),
  ]);
  assert.strictEqual(sugestoes[0].status_sugerido, 'observacao');
});

test('normaliza chave de politica por faixa de score', () => {
  assert.strictEqual(politicas._test.minScoreKey(null), 'sem_score');
  assert.strictEqual(politicas._test.minScoreKey(0.9951), '0.995');
});

test('nao libera auto-reuse com decisao apenas sugerida', () => {
  const db = criarDbTeste();
  inserirShadowBom(db);
  politicas.salvarSettings({
    empresaId: 1,
    autoReuseEnabled: 0,
    autoPolicyEnabled: 0,
    db,
  });
  const decisao = politicas.politicaLiberadaParaCandidato({
    empresaId: 1,
    module: 'financeiro',
    fonteRanking: 'embedding_hibrido',
    score: 0.996,
    db,
  });
  assert.strictEqual(decisao.liberado, false);
  assert.strictEqual(decisao.motivo, 'politica_apenas_sugerida_liberado');
});

test('promove automaticamente quando auto-politica esta ativa', () => {
  const db = criarDbTeste();
  inserirShadowBom(db);
  const decisao = politicas.politicaLiberadaParaCandidato({
    empresaId: 1,
    module: 'financeiro',
    fonteRanking: 'embedding_hibrido',
    score: 0.996,
    db,
  });
  assert.strictEqual(decisao.liberado, true);
  assert.strictEqual(decisao.motivo, 'politica_liberada');
});

test('configAutoReuseAtivo respeita chave operacional por empresa', () => {
  const db = criarDbTeste();
  assert.strictEqual(politicas.configAutoReuseAtivo({ empresaId: 1, db }), false);
  politicas.salvarSettings({ empresaId: 1, autoReuseEnabled: 1, db });
  assert.strictEqual(politicas.configAutoReuseAtivo({ empresaId: 1, db }), true);
  politicas.salvarSettings({ empresaId: 1, autoReuseEnabled: 0, db });
  assert.strictEqual(politicas.configAutoReuseAtivo({ empresaId: 1, db }), false);
});

test('configShadowAtivo e independente do auto-reuse', () => {
  const db = criarDbTeste();
  politicas.salvarSettings({ empresaId: 1, shadowEnabled: 1, autoReuseEnabled: 0, db });
  assert.strictEqual(politicas.configShadowAtivo({ empresaId: 1, db }), true);
  assert.strictEqual(politicas.configAutoReuseAtivo({ empresaId: 1, db }), false);
});

if (process.exitCode) {
  console.error('nlsql-politicas.test.js: falhou');
  process.exit(process.exitCode);
}

console.log(`nlsql-politicas.test.js: ok (${ok} casos)`);
