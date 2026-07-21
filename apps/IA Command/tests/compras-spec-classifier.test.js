'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { classificarFragmentos } = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-spec-classifier'));

let passou = 0;
let falhou = 0;

function ok(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passou++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

function contemTodos(arr, esperados) {
  return esperados.every(e => arr && arr.includes(e));
}

console.log('\n[1] Fragmento unico');

ok('"compras do mes" aciona metrica_valor_total', () => {
  const r = classificarFragmentos('qual o total de compras do mes?');
  assert.ok(contemTodos(r, ['metrica_valor_total']), `obteve: ${JSON.stringify(r)}`);
});

ok('"quantidade comprada" aciona metrica_quantidade_item', () => {
  const r = classificarFragmentos('qual a quantidade comprada em maio?');
  assert.ok(contemTodos(r, ['metrica_quantidade_item']), `obteve: ${JSON.stringify(r)}`);
});

ok('"compras liquidas considerando devolucoes" aciona devolucoes', () => {
  const r = classificarFragmentos('compras liquidas considerando devolucoes em junho');
  assert.ok(contemTodos(r, ['devolucoes']), `obteve: ${JSON.stringify(r)}`);
});

ok('"TES" aciona cfop_tes', () => {
  const r = classificarFragmentos('quais notas usaram o TES de estoque?');
  assert.ok(contemTodos(r, ['cfop_tes']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[2] Media — granularidade');

ok('"media mensal" aciona media_mensal, nao diaria/anual', () => {
  const r = classificarFragmentos('compra media mensal de 2026');
  assert.ok(r.includes('media_mensal'), `obteve: ${JSON.stringify(r)}`);
  assert.ok(!r.includes('media_diaria') && !r.includes('media_anual'), `nao deveria acionar diaria/anual: ${JSON.stringify(r)}`);
});

ok('"media anual" aciona media_anual', () => {
  const r = classificarFragmentos('compra media anual dos ultimos 2 anos');
  assert.ok(r.includes('media_anual'), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[3] Crescimento');

ok('"crescimento mensal" aciona crescimento_mensal', () => {
  const r = classificarFragmentos('qual o crescimento mensal das compras em 2026?');
  assert.ok(r.includes('crescimento_mensal'), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[4] Comparativo');

ok('"comparado com" aciona comparativo_periodos', () => {
  const r = classificarFragmentos('compras de junho 2026 comparado com junho 2025');
  assert.ok(contemTodos(r, ['comparativo_periodos']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[5] Fallback');

ok('pergunta vazia retorna null', () => {
  assert.strictEqual(classificarFragmentos(''), null);
});

ok('pergunta sem keyword conhecida retorna null', () => {
  const r = classificarFragmentos('isso eh bom ou mau?');
  assert.strictEqual(r, null, `esperava null, obteve: ${JSON.stringify(r)}`);
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`compras-spec-classifier.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`compras-spec-classifier.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
