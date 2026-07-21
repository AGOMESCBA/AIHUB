'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { prepararDadosComTotais } = require(path.join(ROOT, 'modules/erp/core/whatsapp-format-prompt'));

// ── helpers ──────────────────────────────────────────────────────────────────
function row(vencimento, saldo, fornecedor) {
  return { vencimento, saldo_a_pagar: saldo, fornecedor };
}

// ── Cenário 1: datas como Date objects (driver SQL típico do MSSQL) ──────────
// Replica os dados reais de J2A com Date objects
const rowsDateObj = [
  row(new Date('2026-05-08T00:00:00Z'),   193.54,  'EDSON ASSIS'),
  row(new Date('2026-05-21T00:00:00Z'),  4550.37,  'ALMIR WEDER'),
  row(new Date('2026-05-25T00:00:00Z'),     59.90, 'BETH'),
  row(new Date('2026-05-29T00:00:00Z'),  32393.68, 'RECEITA FEDERAL'),
  row(new Date('2026-06-01T00:00:00Z'),    140.00, 'BRASOFTWARE'),
  row(new Date('2026-06-01T00:00:00Z'),   3087.80, 'RECEITA FEDERAL'),
  row(new Date('2026-06-25T00:00:00Z'),    416.60, 'DELL COMPUTADORES'),
  row(new Date('2026-06-25T00:00:00Z'),    405.90, 'ELECTROLUX'),
];

const r1 = prepararDadosComTotais(rowsDateObj);

// 1a. colTemporal deve ser detectado (não null)
assert.ok(r1.dados.length > 0, '1a: dados não vazios com Date objects');

// 1b. Chaves de subtotais devem ser YYYY-MM-DD, não strings de Date
const chavesSubtotais = Object.keys(r1.subtotais || {});
for (const k of chavesSubtotais) {
  assert.match(k, /^\d{4}-\d{2}-\d{2}$/, `1b: chave subtotal em YYYY-MM-DD: "${k}"`);
}

// 1c. Ordenação cronológica: primeiro bloco deve ser 2026-05-08
const primeiroGrupo = r1.dados[0]?.vencimento;
assert.strictEqual(primeiroGrupo, '2026-05-08', `1c: primeiro dia deve ser 2026-05-08, got "${primeiroGrupo}"`);

// 1d. Último bloco deve ser 2026-06-25
const ultimoGrupo = r1.dados[r1.dados.length - 1]?.vencimento;
assert.strictEqual(ultimoGrupo, '2026-06-25', `1d: último dia deve ser 2026-06-25, got "${ultimoGrupo}"`);

// 1e. Datas não devem ter off-by-one (problema de UTC)
assert.ok(chavesSubtotais.includes('2026-06-25'), '1e: 2026-06-25 não deve virar 2026-06-24 (UTC off-by-one)');
assert.ok(!chavesSubtotais.includes('2026-06-24'), '1e: 2026-06-24 não deve aparecer (era bug UTC)');

// 1f. Subtotal do dia 2026-06-25 deve ser DELL + ELECTROLUX = 822.50
const sub0625 = r1.subtotais?.['2026-06-25']?.saldo_a_pagar;
assert.strictEqual(sub0625, 822.50, `1f: subtotal 2026-06-25 deve ser 822.50, got ${sub0625}`);

console.log('✓ Cenário 1 (Date objects): ok');

// ── Cenário 2: datas como strings YYYY-MM-DD (caminho já funcionava) ─────────
const rowsString = [
  row('2026-05-29',  3375.00, 'ALELO'),
  row('2026-05-29',   297.00, 'AMTU'),
  row('2026-05-31',   380.89, 'RECEITA FEDERAL'),
  row('2026-06-01',  3629.27, 'RECEITA FEDERAL'),
  row('2026-10-31',   380.89, 'RECEITA FEDERAL'),
];

const r2 = prepararDadosComTotais(rowsString);

const chaves2 = Object.keys(r2.subtotais || {});
assert.ok(chaves2.includes('2026-05-29'), '2a: 2026-05-29 presente');
assert.ok(chaves2.includes('2026-05-31'), '2a: 2026-05-31 presente');
assert.ok(!chaves2.includes('2026-05-28'), '2b: sem off-by-one em string (não vira 28)');
assert.ok(!chaves2.includes('2026-05-30'), '2b: sem off-by-one em string (não vira 30)');

// Subtotal do dia 2026-05-29 = ALELO + AMTU = 3672.00
const sub0529 = r2.subtotais?.['2026-05-29']?.saldo_a_pagar;
assert.strictEqual(sub0529, 3672.00, `2c: subtotal 2026-05-29 deve ser 3672.00, got ${sub0529}`);

// Ordenação: primeiro deve ser 2026-05-29
const primeiro2 = r2.dados[0]?.vencimento;
assert.strictEqual(primeiro2, '2026-05-29', `2d: primeiro deve ser 2026-05-29, got "${primeiro2}"`);

console.log('✓ Cenário 2 (strings YYYY-MM-DD): ok — sem regressão');

// ── Cenário 3: ISO string (JSON.stringify de Date) ────────────────────────────
const rowsISO = [
  row('2026-06-25T00:00:00.000Z', 416.60, 'DELL COMPUTADORES'),
  row('2026-06-25T00:00:00.000Z', 405.90, 'ELECTROLUX'),
  row('2026-05-08T00:00:00.000Z', 193.54, 'EDSON ASSIS'),
];

const r3 = prepararDadosComTotais(rowsISO);
const chaves3 = Object.keys(r3.subtotais || {});
assert.ok(chaves3.includes('2026-06-25'), '3a: ISO → YYYY-MM-DD correto');
assert.ok(chaves3.includes('2026-05-08'), '3b: ISO → YYYY-MM-DD correto');
assert.strictEqual(r3.dados[0]?.vencimento, '2026-05-08', '3c: ordenação com ISO strings');

console.log('✓ Cenário 3 (ISO strings): ok');

// ── Cenário 4: ordem desordenada no SQL → deve sair ordenada ─────────────────
const rowsDesordenados = [
  row(new Date('2026-07-27T00:00:00Z'),  34.95,  'AMAZON'),
  row(new Date('2026-06-02T00:00:00Z'), 691.20,  'EFATA'),
  row(new Date('2026-05-08T00:00:00Z'), 193.54,  'EDSON ASSIS'),
  row(new Date('2026-06-30T00:00:00Z'), 1800.00, 'ALMIR WEDER'),
];

const r4 = prepararDadosComTotais(rowsDesordenados);
const datas4 = r4.dados.map(d => d.vencimento);
assert.deepStrictEqual(
  datas4,
  ['2026-05-08', '2026-06-02', '2026-06-30', '2026-07-27'],
  `4: ordem cronológica garantida, got ${JSON.stringify(datas4)}`
);

console.log('✓ Cenário 4 (ordenação com rows fora de ordem): ok');

console.log('\nwhatsapp-format-agrupar-dia.test.js: TODOS OS TESTES PASSARAM');
