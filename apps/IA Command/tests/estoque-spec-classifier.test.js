'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { classificarFragmentos } = require(path.join(ROOT, 'modules/erp/estoque/estoque-spec-classifier'));

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

ok('"saldo em estoque" aciona saldo_posicao', () => {
  const r = classificarFragmentos('qual o saldo em estoque do produto 000001?');
  assert.ok(contemTodos(r, ['saldo_posicao']), `obteve: ${JSON.stringify(r)}`);
});

ok('"quanto foi requisitado" aciona movimentacao_interna', () => {
  const r = classificarFragmentos('quanto foi requisitado do produto 000001 este mes?');
  assert.ok(contemTodos(r, ['movimentacao_interna']), `obteve: ${JSON.stringify(r)}`);
});

ok('"transferencias" aciona movimentacao_interna', () => {
  const r = classificarFragmentos('transferencias de estoque do produto X em junho');
  assert.ok(contemTodos(r, ['movimentacao_interna']), `obteve: ${JSON.stringify(r)}`);
});

ok('"giro de estoque" aciona curva_abc_giro', () => {
  const r = classificarFragmentos('qual o giro de estoque por grupo de produto?');
  assert.ok(contemTodos(r, ['curva_abc_giro']), `obteve: ${JSON.stringify(r)}`);
});

ok('"curva ABC" aciona curva_abc_giro', () => {
  const r = classificarFragmentos('monte a curva ABC dos produtos');
  assert.ok(contemTodos(r, ['curva_abc_giro']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[2] Fallback');

ok('pergunta vazia retorna null', () => {
  assert.strictEqual(classificarFragmentos(''), null);
});

ok('pergunta sem keyword conhecida retorna null', () => {
  const r = classificarFragmentos('isso eh bom ou mau?');
  assert.strictEqual(r, null, `esperava null, obteve: ${JSON.stringify(r)}`);
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`estoque-spec-classifier.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`estoque-spec-classifier.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
