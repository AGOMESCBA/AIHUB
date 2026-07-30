'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const calibracao = require(path.join(ROOT, 'modules/erp/nlsql-cache/nlsql-calibracao'));

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

function row(score, resultado, module = 'financeiro', fonte = 'embedding_hibrido') {
  return {
    module,
    candidate_score: score,
    comparacao_resultado: resultado,
    classificacao_auto: resultado === 'mismatch' ? 'reprovado_automatico' : 'aprovado_automatico',
    classificacao_efetiva: resultado === 'mismatch' ? 'reprovado_automatico' : 'aprovado_automatico',
    detalhes_json: JSON.stringify({ ranking_fonte: fonte }),
  };
}

test('classifica score na faixa correta', () => {
  assert.strictEqual(calibracao._test.scoreBucket(0.996), 0.995);
  assert.strictEqual(calibracao._test.scoreBucket(0.991), 0.99);
  assert.strictEqual(calibracao._test.scoreBucket(0.72), 0.7);
  assert.strictEqual(calibracao._test.scoreBucket(null), null);
});

test('calcula precisao por faixa e por modulo', () => {
  const payload = calibracao.calibrarShadowRows([
    row(0.996, 'match_template_exato'),
    row(0.996, 'match_template_exato'),
    row(0.996, 'mismatch'),
    row(0.91, 'match_sql_aplicado_exato', 'compras', 'estrutural'),
    row(null, 'sem_candidato', 'compras', 'estrutural'),
  ], { minAmostra: 2, precisaoAlvo: 0.66 });

  assert.strictEqual(payload.resumo.total, 5);
  assert.strictEqual(payload.resumo.com_candidato, 4);
  assert.strictEqual(payload.resumo.match_template, 2);
  assert.strictEqual(payload.resumo.mismatch, 1);
  const faixa995 = payload.faixas.find(f => f.min_score === 0.995);
  assert.ok(faixa995);
  assert.strictEqual(faixa995.com_candidato, 3);
  assert.ok(faixa995.precisao_template > 0.66 && faixa995.precisao_template < 0.67);
  assert.strictEqual(payload.modulos.find(m => m.chave === 'financeiro').total, 3);
  assert.strictEqual(payload.fontes.find(f => f.chave === 'embedding_hibrido').total, 3);
  assert.strictEqual(payload.classificacoes.find(c => c.chave === 'reprovado_automatico').total, 1);
});

test('recomenda limiar somente com amostra e precisao alvo', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(row(0.996, 'match_template_exato'));
  rows.push(row(0.991, 'mismatch'));
  const payload = calibracao.calibrarShadowRows(rows);
  assert.strictEqual(payload.recomendacao.status, 'recomendado');
  assert.strictEqual(payload.recomendacao.limiar, 0.995);

  const insuficiente = calibracao.calibrarShadowRows([
    row(0.996, 'match_template_exato'),
    row(0.996, 'match_template_exato'),
  ]);
  assert.strictEqual(insuficiente.recomendacao.status, 'insuficiente');
});

if (process.exitCode) {
  console.error('nlsql-calibracao.test.js: falhou');
  process.exit(process.exitCode);
}

console.log(`nlsql-calibracao.test.js: ok (${ok} casos)`);
