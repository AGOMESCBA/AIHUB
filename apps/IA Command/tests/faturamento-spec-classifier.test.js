'use strict';

/**
 * Testes do classificador de fragmentos do faturamento (faturamento-spec-classifier.js).
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { classificarFragmentos } = require(path.join(ROOT, 'modules/erp/totvs_protheus/faturamento/faturamento-spec-classifier'));

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

ok('"faturamento do mes" aciona metrica_valor_total', () => {
  const r = classificarFragmentos('qual o faturamento do mes?');
  assert.ok(contemTodos(r, ['metrica_valor_total']), `obteve: ${JSON.stringify(r)}`);
});

ok('"quantidade faturada" aciona metrica_quantidade_item', () => {
  const r = classificarFragmentos('qual a quantidade faturada em maio?');
  assert.ok(contemTodos(r, ['metrica_quantidade_item']), `obteve: ${JSON.stringify(r)}`);
});

ok('"faturamento considerando devolucoes" aciona devolucoes', () => {
  const r = classificarFragmentos('faturamento considerando devolucoes em junho');
  assert.ok(contemTodos(r, ['devolucoes']), `obteve: ${JSON.stringify(r)}`);
});

ok('"quantidade carregada" aciona cfop_tes_centro_custo', () => {
  const r = classificarFragmentos('quantidade carregada no mes');
  assert.ok(contemTodos(r, ['cfop_tes_centro_custo']), `obteve: ${JSON.stringify(r)}`);
});

ok('"clientes com faturamento todos os meses" aciona frequencia_cliente', () => {
  const r = classificarFragmentos('quais clientes tiveram faturamento em todos os meses?');
  assert.ok(contemTodos(r, ['frequencia_cliente']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[2] Media — granularidade');

ok('"media mensal" aciona media_mensal, nao media_diaria/anual', () => {
  const r = classificarFragmentos('faturamento medio mensal de 2026');
  assert.ok(r.includes('media_mensal'), `obteve: ${JSON.stringify(r)}`);
  assert.ok(!r.includes('media_diaria') && !r.includes('media_anual'), `nao deveria acionar diaria/anual: ${JSON.stringify(r)}`);
});

ok('"media diaria" aciona media_diaria', () => {
  const r = classificarFragmentos('qual a media diaria de faturamento?');
  assert.ok(r.includes('media_diaria'), `obteve: ${JSON.stringify(r)}`);
});

ok('"media anual" aciona media_anual', () => {
  const r = classificarFragmentos('faturamento medio anual dos ultimos 3 anos');
  assert.ok(r.includes('media_anual'), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[3] Crescimento — granularidade');

ok('"crescimento mensal" aciona crescimento_mensal', () => {
  const r = classificarFragmentos('qual o crescimento mensal do faturamento em 2026?');
  assert.ok(r.includes('crescimento_mensal'), `obteve: ${JSON.stringify(r)}`);
});

ok('"crescimento anual" aciona crescimento_anual', () => {
  const r = classificarFragmentos('crescimento anual do faturamento');
  assert.ok(r.includes('crescimento_anual'), `obteve: ${JSON.stringify(r)}`);
});

ok('"variacao dia a dia" aciona crescimento_diario', () => {
  const r = classificarFragmentos('variacao do faturamento dia a dia');
  assert.ok(r.includes('crescimento_diario'), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[4] Comparativo entre periodos');

ok('"comparado com" aciona comparativo_periodos', () => {
  const r = classificarFragmentos('faturamento de junho 2026 comparado com junho 2025');
  assert.ok(contemTodos(r, ['comparativo_periodos']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[5] Fallback — pergunta sem match conhecido');

ok('pergunta vazia retorna null', () => {
  assert.strictEqual(classificarFragmentos(''), null);
});

ok('pergunta sem nenhuma keyword conhecida usa so identidade_vendedor (sempre:true), nao o fallback total', () => {
  const r = classificarFragmentos('isso eh bom ou mau?');
  assert.deepStrictEqual(r, ['identidade_vendedor'], `esperava so identidade_vendedor, obteve: ${JSON.stringify(r)}`);
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`faturamento-spec-classifier.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`faturamento-spec-classifier.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
