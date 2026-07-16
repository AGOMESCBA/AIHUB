'use strict';

/**
 * Testes do classificador de fragmentos do financeiro (financeiro-spec-classifier.js).
 *
 * Cobre:
 *   1. Perguntas que identificam um unico fragmento.
 *   2. Combinacoes (ex: "a pagar e a receber" deve acionar ambos os lados +
 *      a regra estrutural anti-JOIN).
 *   3. requerJunto (fluxo projetado/realizado dependem de outros fragmentos).
 *   4. excluiSe (saldo bancario nao deve acionar quando a pergunta menciona "projetado").
 *   5. Fallback: pergunta vazia retorna null; pergunta sem match de assunto usa so identidade_vendedor (sempre:true).
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { classificarFragmentos } = require(path.join(ROOT, 'modules/erp/financeiro/financeiro-spec-classifier'));

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

ok('"saldo bancario atual" aciona saldo_bancario', () => {
  const r = classificarFragmentos('qual o saldo bancario atual?');
  assert.ok(contemTodos(r, ['saldo_bancario']), `obteve: ${JSON.stringify(r)}`);
});

ok('"contas a pagar do mes" aciona pagar_posicao', () => {
  const r = classificarFragmentos('quanto tenho a pagar no mes?');
  assert.ok(contemTodos(r, ['pagar_posicao']), `obteve: ${JSON.stringify(r)}`);
});

ok('"contas a receber em aberto" aciona receber_posicao', () => {
  const r = classificarFragmentos('contas a receber em aberto');
  assert.ok(contemTodos(r, ['receber_posicao']), `obteve: ${JSON.stringify(r)}`);
});

ok('"quanto recebi este mes" aciona receber_realizado', () => {
  const r = classificarFragmentos('quanto recebi este mes?');
  assert.ok(contemTodos(r, ['receber_realizado']), `obteve: ${JSON.stringify(r)}`);
});

ok('"quanto paguei este mes" aciona pagar_realizado', () => {
  const r = classificarFragmentos('quanto paguei este mes?');
  assert.ok(contemTodos(r, ['pagar_realizado']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[2] Combinacoes pagar x receber');

ok('"a pagar e a receber" aciona ambos + comparacao', () => {
  const r = classificarFragmentos('quanto tenho a pagar e a receber?');
  assert.ok(
    contemTodos(r, ['pagar_posicao', 'receber_posicao', 'comparacao_pagar_x_receber']),
    `obteve: ${JSON.stringify(r)}`,
  );
});

ok('"o que paguei e recebi no mes" aciona comparacao', () => {
  const r = classificarFragmentos('o que eu paguei e recebi no mes?');
  assert.ok(contemTodos(r, ['comparacao_pagar_x_receber']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[3] requerJunto — fluxo de caixa depende de outros fragmentos');

ok('"fluxo de caixa projetado" traz saldo_bancario + receber_posicao + pagar_posicao', () => {
  const r = classificarFragmentos('qual o fluxo de caixa projetado para os proximos 30 dias?');
  assert.ok(
    contemTodos(r, ['fluxo_caixa_projetado', 'saldo_bancario', 'receber_posicao', 'pagar_posicao']),
    `obteve: ${JSON.stringify(r)}`,
  );
});

ok('"fluxo de caixa realizado" traz saldo_bancario + receber_realizado + pagar_realizado', () => {
  const r = classificarFragmentos('fluxo de caixa realizado do mes passado');
  assert.ok(
    contemTodos(r, ['fluxo_caixa_realizado', 'saldo_bancario', 'receber_realizado', 'pagar_realizado']),
    `obteve: ${JSON.stringify(r)}`,
  );
});

console.log('\n[4] excluiSe — saldo bancario nao deve disparar quando a pergunta e sobre fluxo projetado');

ok('"saldo bancario projetado" NAO aciona saldo_bancario isolado (vai para fluxo_caixa_projetado)', () => {
  const r = classificarFragmentos('qual o saldo bancario projetado para o fim do mes?');
  assert.ok(r.includes('fluxo_caixa_projetado'), `deveria acionar fluxo_caixa_projetado, obteve: ${JSON.stringify(r)}`);
});

console.log('\n[5] PA/RA e NDF/NCC');

ok('"pagamento antecipado" aciona antecipacoes_pa_ra', () => {
  const r = classificarFragmentos('quanto temos de pagamento antecipado para o fornecedor X?');
  assert.ok(contemTodos(r, ['antecipacoes_pa_ra']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[6] Fallback — pergunta sem match conhecido');

ok('pergunta vazia retorna null', () => {
  assert.strictEqual(classificarFragmentos(''), null);
});

ok('pergunta sem nenhuma keyword conhecida usa so identidade_vendedor (sempre:true), nao o fallback total', () => {
  const r = classificarFragmentos('isso eh bom ou mau?');
  assert.deepStrictEqual(r, ['identidade_vendedor'], `esperava so identidade_vendedor, obteve: ${JSON.stringify(r)}`);
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`financeiro-spec-classifier.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`financeiro-spec-classifier.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
