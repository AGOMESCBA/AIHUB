'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const semanticExamples = require(path.join(ROOT, 'modules/erp/nlsql-cache/nlsql-semantic-examples'));
const { _test } = semanticExamples;

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

const canonicoBase = {
  module: 'compras',
  intent: 'consulta',
  metric: ['valor_total'],
  date_basis: 'emissao',
  group_by: ['fornecedor'],
  period: { start: '2026-07-01', end: '2026-07-31' },
  filters: { filial: '01', fornecedor: '000123' },
  entities: [{ tipo: 'fornecedor', codigo: '000123', loja: '01', security: false }],
  security_scope: { erp_tipo: 'protheus', erp_id: 10, cod_aprov_erp: null },
  empresa_id: 1,
  prompt_version: 'compras-v1',
  spec_version: 'compras-v1',
  schema_version: 'sx-v1',
  model: 'gpt-test',
};

test('gera exemplo semantico a partir de execution_log confiavel', () => {
  const exemplo = _test.exampleFromExecutionRow({
    correlation_id: '11111111-1111-4111-8111-111111111111',
    empresa_id: 1,
    numero_wa: '5592999999999',
    texto_original: 'compras por fornecedor em julho',
    intent_canonico_json: JSON.stringify(canonicoBase),
    intent_canonico_estrutural_json: JSON.stringify(_test.structuralFromCanonical(canonicoBase)),
    sql_template: "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7 WHERE C7_EMISSAO BETWEEN '{{period.start}}' AND '{{period.end}}'",
    sql_final_executado: "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7010 WHERE C7_EMISSAO BETWEEN '20260701' AND '20260731'",
    chave_cache: 'cache-1',
    intent_canonico_hash: 'hash-1',
  });

  assert.ok(exemplo);
  assert.strictEqual(exemplo.execution_log_id, '11111111-1111-4111-8111-111111111111');
  assert.strictEqual(exemplo.module, 'compras');
  assert.deepStrictEqual(exemplo.filter_keys, ['filial', 'fornecedor']);
  assert.ok(exemplo.search_text.includes('compras'));
});

test('nao gera exemplo quando correlation_id nao e tecnico', () => {
  const exemplo = _test.exampleFromExecutionRow({
    correlation_id: 'Admin',
    empresa_id: 1,
    numero_wa: '5592999999999',
    texto_original: 'compras por fornecedor em julho',
    intent_canonico_json: JSON.stringify(canonicoBase),
    intent_canonico_estrutural_json: JSON.stringify(_test.structuralFromCanonical(canonicoBase)),
    sql_template: "SELECT * FROM SC7 WHERE C7_EMISSAO >= '{{iac:period:start}}'",
  });

  assert.strictEqual(exemplo, null);
  assert.strictEqual(_test.normalizarExecutionLogId('Admin'), null);
});

test('score estrutural privilegia mesma estrutura', () => {
  const atual = _test.structuralFromCanonical(canonicoBase);
  const parecido = _test.structuralFromCanonical({
    ...canonicoBase,
    period: { start: '2026-08-01', end: '2026-08-31' },
    filters: { filial: '01', fornecedor: '000456' },
  });
  const diferente = _test.structuralFromCanonical({
    ...canonicoBase,
    module: 'financeiro',
    intent: 'saldo',
    metric: ['saldo_aberto'],
    group_by: ['cliente'],
    filters: { cliente: '000001' },
  });

  assert.ok(_test.scoreEstrutural(atual, parecido) > 0.9);
  assert.ok(_test.scoreEstrutural(atual, diferente) < 0.6);
});

test('prefiltro semantico bloqueia candidato de outra metrica ou entidade', () => {
  const atual = _test.structuralFromCanonical(canonicoBase);
  const mesmaForma = _test.structuralFromCanonical({
    ...canonicoBase,
    filters: { filial: '01', fornecedor: '000999' },
  });
  const outraMetrica = _test.structuralFromCanonical({
    ...canonicoBase,
    metric: ['quantidade'],
  });
  const outraEntidade = _test.structuralFromCanonical({
    ...canonicoBase,
    filters: { cliente: '000001' },
    entities: [{ tipo: 'cliente', codigo: '000001', loja: '01', security: false }],
  });

  assert.strictEqual(_test.passaPrefiltroSemantico(atual, mesmaForma), true);
  assert.strictEqual(_test.passaPrefiltroSemantico(atual, outraMetrica), false);
  assert.strictEqual(_test.passaPrefiltroSemantico(atual, outraEntidade), false);
});

test('score hibrido combina embedding real com contrato estrutural', () => {
  const score = _test.scoreHibridoEmbedding(0.9, 0.5, 0.75);
  assert.ok(score > 0.79 && score < 0.81);
  assert.strictEqual(_test.scoreHibridoEmbedding(null, 0.6), 0.6);
});

test('prompt recebe somente exemplo consultivo e template parametrizado', () => {
  const payload = semanticExamples.exemplosParaPrompt([{
    score: 0.98765,
    module: 'compras',
    intent: 'consulta',
    metric: ['valor_total'],
    group_by: ['fornecedor'],
    filter_keys: ['filial'],
    date_basis: 'emissao',
    sql_template: "SELECT * FROM SC7 WHERE C7_EMISSAO >= '{{period.start}}'",
    execution_log_id: 'exec-1',
  }]);

  assert.strictEqual(payload.length, 1);
  assert.strictEqual(payload[0].similaridade, 0.988);
  assert.strictEqual(payload[0].sql_template_parametrizado, "SELECT * FROM SC7 WHERE C7_EMISSAO >= '{{period.start}}'");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload[0], 'execution_log_id'), false);
});

test('shadow classifica ausencia de candidato sem risco de auto-reuse', () => {
  const avaliacao = _test.avaliarShadowCandidate({
    candidato: null,
    intentCanonicoInfo: { canonical: canonicoBase },
    actualSqlTemplate: 'SELECT 1',
    actualSqlCanonico: 'SELECT 1',
    actualSqlFinal: 'SELECT 1',
  });

  assert.strictEqual(avaliacao.comparacao_resultado, 'sem_candidato');
  assert.strictEqual(avaliacao.auto_reuse_elegivel, false);
});

test('shadow marca match exato apenas quando template real e candidato coincidem', () => {
  const sql = "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7 WHERE C7_EMISSAO BETWEEN '{{iac:period:start}}' AND '{{iac:period:end}}' GROUP BY A2_NOME";
  const avaliacao = _test.avaliarShadowCandidate({
    candidato: {
      score: 0.991,
      sql_template: sql,
      execution_log_id: 'exec-cache',
    },
    intentCanonicoInfo: { canonical: canonicoBase },
    actualSqlTemplate: " select A2_NOME, sum(C7_TOTAL) from SC7 where C7_EMISSAO between '{{iac:period:start}}' and '{{iac:period:end}}' group by A2_NOME ",
    actualSqlCanonico: "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7 WHERE C7_EMISSAO BETWEEN '20260701' AND '20260731' GROUP BY A2_NOME",
    actualSqlFinal: "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7010 WHERE C7_EMISSAO BETWEEN '20260701' AND '20260731' GROUP BY A2_NOME",
    autoReuseThreshold: 0.98,
  });

  assert.strictEqual(avaliacao.template_valido, true);
  assert.strictEqual(avaliacao.comparacao_resultado, 'match_template_exato');
  assert.strictEqual(avaliacao.auto_reuse_elegivel, true);
});

test('shadow nao promove mismatch ou template incompleto', () => {
  const mismatch = _test.avaliarShadowCandidate({
    candidato: {
      score: 0.999,
      sql_template: "SELECT A2_NOME FROM SC7 WHERE C7_EMISSAO >= '{{iac:period:start}}'",
    },
    intentCanonicoInfo: { canonical: canonicoBase },
    actualSqlTemplate: "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7 WHERE C7_EMISSAO >= '{{iac:period:start}}' GROUP BY A2_NOME",
    actualSqlCanonico: "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7 WHERE C7_EMISSAO >= '20260701' GROUP BY A2_NOME",
    actualSqlFinal: "SELECT A2_NOME, SUM(C7_TOTAL) FROM SC7010 WHERE C7_EMISSAO >= '20260701' GROUP BY A2_NOME",
    autoReuseThreshold: 0.98,
  });

  const invalido = _test.avaliarShadowCandidate({
    candidato: {
      score: 0.999,
      sql_template: "SELECT * FROM SC7 WHERE C7_FORNECE = '{{iac:filter:cliente}}'",
    },
    intentCanonicoInfo: { canonical: canonicoBase },
    actualSqlTemplate: "SELECT * FROM SC7 WHERE C7_FORNECE = '{{iac:filter:fornecedor}}'",
    actualSqlCanonico: "SELECT * FROM SC7 WHERE C7_FORNECE = '000123'",
    actualSqlFinal: "SELECT * FROM SC7010 WHERE C7_FORNECE = '000123'",
    autoReuseThreshold: 0.98,
  });

  assert.strictEqual(mismatch.comparacao_resultado, 'mismatch');
  assert.strictEqual(mismatch.auto_reuse_elegivel, false);
  assert.strictEqual(invalido.comparacao_resultado, 'template_invalido');
  assert.strictEqual(invalido.auto_reuse_elegivel, false);
});

if (process.exitCode) {
  console.error('nlsql-semantic-examples.test.js: falhou');
  process.exit(process.exitCode);
}

console.log(`nlsql-semantic-examples.test.js: ok (${ok} casos)`);
