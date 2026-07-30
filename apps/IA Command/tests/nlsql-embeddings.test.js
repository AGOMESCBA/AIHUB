'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const embeddings = require(path.join(ROOT, 'modules/erp/nlsql-cache/nlsql-embeddings'));

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

test('monta texto de embedding a partir do intent estrutural', () => {
  const texto = embeddings.textoEmbeddingFromExample({
    module: 'compras',
    intent: 'consulta',
    intent_canonico_estrutural_json: JSON.stringify({
      module: 'compras',
      intent: 'consulta',
      metric: ['valor_total'],
      group_by: ['fornecedor'],
      filter_keys: ['filial'],
    }),
  });
  const obj = JSON.parse(texto);
  assert.strictEqual(obj.tipo, 'iac-nlsql-intent-estrutural');
  assert.strictEqual(obj.estrutural.module, 'compras');
  assert.deepStrictEqual(obj.estrutural.metric, ['valor_total']);
});

test('monta texto de embedding a partir do intent canonico atual', () => {
  const texto = embeddings._test.textoEmbeddingFromCanonical({
    canonical: {
      module: 'financeiro',
      intent: 'consulta',
      metric: ['saldo_aberto'],
      filters: { cliente: '000001', filial: '01' },
      group_by: ['cliente'],
    },
  });
  const obj = JSON.parse(texto);
  assert.strictEqual(obj.tipo, 'iac-nlsql-intent-estrutural');
  assert.strictEqual(obj.estrutural.module, 'financeiro');
  assert.deepStrictEqual(obj.canonico_minimo.filter_keys, ['cliente', 'filial']);
});

test('similaridade coseno retorna 1 para vetores iguais', () => {
  assert.strictEqual(embeddings.cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test('similaridade coseno rejeita vetores invalidos', () => {
  assert.strictEqual(embeddings.cosineSimilarity([1, 2], [1]), null);
  assert.strictEqual(embeddings.cosineSimilarity([], []), null);
});

if (process.exitCode) {
  console.error('nlsql-embeddings.test.js: falhou');
  process.exit(process.exitCode);
}

console.log(`nlsql-embeddings.test.js: ok (${ok} casos)`);
