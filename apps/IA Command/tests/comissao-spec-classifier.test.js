'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { classificarFragmentos } = require(path.join(ROOT, 'modules/erp/comissao/comissao-spec-classifier'));

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

console.log('\n[1] identidade_vendedor sempre presente');

ok('pergunta qualquer sempre inclui identidade_vendedor', () => {
  const r1 = classificarFragmentos('qual minha comissao do mes?');
  const r2 = classificarFragmentos('');
  const r3 = classificarFragmentos('isso eh bom ou mau?');
  // null = fallback total (que inclui identidade_vendedor via ORDEM_FALLBACK);
  // array = deve conter identidade_vendedor explicitamente.
  if (Array.isArray(r1)) assert.ok(r1.includes('identidade_vendedor'), `r1 deve conter identidade_vendedor: ${JSON.stringify(r1)}`);
  assert.strictEqual(r2, null, 'pergunta vazia deve cair no fallback (null)');
  assert.strictEqual(r3, null, 'pergunta sem keyword deve cair no fallback (null)');
});

console.log('\n[2] Fragmento unico');

ok('"em aberto" aciona carteira_status', () => {
  const r = classificarFragmentos('comissao em aberto deste mes?');
  assert.ok(contemTodos(r, ['carteira_status', 'identidade_vendedor']), `obteve: ${JSON.stringify(r)}`);
});

ok('"data de pagamento" aciona pagamento_real', () => {
  const r = classificarFragmentos('quando foi a data de pagamento da minha comissao?');
  assert.ok(contemTodos(r, ['pagamento_real']), `obteve: ${JSON.stringify(r)}`);
});

console.log('\n[3] Media — granularidade');

ok('"media mensal" aciona media_mensal', () => {
  const r = classificarFragmentos('comissao media mensal de 2026');
  assert.ok(r.includes('media_mensal'), `obteve: ${JSON.stringify(r)}`);
  assert.ok(!r.includes('media_diaria') && !r.includes('media_anual'), `nao deveria acionar diaria/anual: ${JSON.stringify(r)}`);
});

console.log('\n[4] Crescimento e comparativo');

ok('"crescimento mensal" aciona crescimento_mensal', () => {
  const r = classificarFragmentos('qual o crescimento mensal da minha comissao em 2026?');
  assert.ok(r.includes('crescimento_mensal'), `obteve: ${JSON.stringify(r)}`);
});

ok('"comparado com" aciona comparativo_periodos', () => {
  const r = classificarFragmentos('comissao de junho 2026 comparado com junho 2025');
  assert.ok(contemTodos(r, ['comparativo_periodos']), `obteve: ${JSON.stringify(r)}`);
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`comissao-spec-classifier.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`comissao-spec-classifier.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
