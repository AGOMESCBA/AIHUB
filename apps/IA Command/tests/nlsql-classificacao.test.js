'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const classificacao = require(path.join(ROOT, 'modules/erp/nlsql-cache/nlsql-classificacao'));

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

function base(resultado, score = 0.99) {
  return {
    comparacao_resultado: resultado,
    candidate_score: score,
    template_valido: 1,
    candidate_execution_log_id: '11111111-1111-4111-8111-111111111111',
    candidate_sql_template: 'SELECT 1',
  };
}

test('aprova automaticamente match template com score alto', () => {
  const c = classificacao.classificarShadowRow(base('match_template_exato', 0.981));
  assert.strictEqual(c.classificacao, 'aprovado_automatico');
});

test('mantem inconclusivo match template com score baixo', () => {
  const c = classificacao.classificarShadowRow(base('match_template_exato', 0.9));
  assert.strictEqual(c.classificacao, 'inconclusivo');
});

test('reprova mismatch e bloqueia template invalido', () => {
  assert.strictEqual(classificacao.classificarShadowRow(base('mismatch', 0.999)).classificacao, 'reprovado_automatico');
  assert.strictEqual(classificacao.classificarShadowRow({ ...base('template_invalido', 0.999), template_valido: 0 }).classificacao, 'bloqueado_por_risco');
});

test('sem candidato fica inconclusivo', () => {
  const c = classificacao.classificarShadowRow({
    comparacao_resultado: 'sem_candidato',
    candidate_score: null,
    template_valido: 0,
    candidate_execution_log_id: null,
  });
  assert.strictEqual(c.classificacao, 'inconclusivo');
});

test('override valido altera classificacao efetiva sem apagar automatica', () => {
  const c = classificacao.aplicarClassificacaoRow({
    ...base('mismatch', 0.999),
    override_classificacao: 'aprovado_usuario',
  }, { agora: '2026-01-01T00:00:00.000Z' });
  assert.strictEqual(c.classificacao_auto, 'reprovado_automatico');
  assert.strictEqual(c.classificacao_efetiva, 'aprovado_usuario');
});

if (process.exitCode) {
  console.error('nlsql-classificacao.test.js: falhou');
  process.exit(process.exitCode);
}

console.log(`nlsql-classificacao.test.js: ok (${ok} casos)`);
