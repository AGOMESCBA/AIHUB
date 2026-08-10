'use strict';

/**
 * Testes do guardrail sqlPatternsProibidos que detecta inversao do filtro PA/RA
 * (financeiro-ia-owner-spec.js) — bug real confirmado em producao em 2026-08-09:
 * pergunta "Total de pagamentos antecipados com saldo" gerou SQL com
 * E2_TIPO <> 'PA' (exclui antecipados) quando deveria gerar E2_TIPO = 'PA'
 * (isola antecipados), respondendo o oposto exato do pedido.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const spec = require(path.join(ROOT, 'modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec'));

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

function validar(sql, mensagem) {
  const erros = [];
  for (const regra of spec.sqlPatternsProibidos || []) {
    if (typeof regra.validar === 'function') {
      const msg = regra.validar(sql, mensagem);
      if (msg) erros.push(msg);
    }
  }
  return erros;
}

console.log('\n[1] Pergunta pede PA explicitamente, SQL exclui PA (bug real de producao)');

ok('"Total de pagamentos antecipados com saldo" + E2_TIPO <> \'PA\' e rejeitado', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SUM(SE2.E2_SALDO) AS total_pagamentos_antecipados
FROM SE2010 SE2
WHERE SE2.E2_TIPO <> 'PA' AND SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SE2.E2_VENCREA BETWEEN '20260301' AND '20260831';`;
  const erros = validar(sql, 'Total de pagamentos antecipados com saldo');
  assert.ok(erros.some(e => /E2_TIPO\s*<>\s*'PA'/.test(e) || /pagamentos antecipados/i.test(e)), `esperava erro, obteve: ${JSON.stringify(erros)}`);
});

ok('"recebimentos antecipados de clientes" + E1_TIPO <> \'RA\' e rejeitado', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SUM(SE1.E1_SALDO) AS total_recebimentos_antecipados
FROM SE1010 SE1
WHERE SE1.E1_TIPO <> 'RA' AND SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0;`;
  const erros = validar(sql, 'Total de recebimentos antecipados de clientes');
  assert.ok(erros.some(e => /E1_TIPO\s*<>\s*'RA'/.test(e) || /recebimentos antecipados/i.test(e)), `esperava erro, obteve: ${JSON.stringify(erros)}`);
});

console.log('\n[2] Pergunta pede PA explicitamente, SQL isola PA corretamente (deve passar)');

ok('"Total de pagamentos antecipados com saldo" + E2_TIPO = \'PA\' nao gera erro', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SUM(SE2.E2_SALDO) AS total_pagamentos_antecipados
FROM SE2010 SE2
WHERE SE2.E2_TIPO = 'PA' AND SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SE2.E2_VENCREA BETWEEN '20260301' AND '20260831';`;
  const erros = validar(sql, 'Total de pagamentos antecipados com saldo');
  assert.deepStrictEqual(erros, []);
});

console.log('\n[3] Pergunta NAO pede antecipacao — comportamento padrao de exclusao deve passar');

ok('"Contas a pagar da semana que vem" + E2_TIPO <> \'PA\' nao gera erro (padrao correto)', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SE2.E2_FORNECE, SE2.E2_SALDO
FROM SE2010 SE2
WHERE SE2.E2_SALDO > 0 AND SE2.E2_VENCREA BETWEEN '20260803' AND '20260807' AND SE2.D_E_L_E_T_ = ' ' AND SE2.E2_TIPO <> 'PA';`;
  const erros = validar(sql, 'Contas a pagar da semana que vem');
  assert.deepStrictEqual(erros, []);
});

if (falhou === 0) {
  console.log(`\n${'─'.repeat(60)}\nfinanceiro-antecipacao-pa-ra.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`\n${'─'.repeat(60)}\nfinanceiro-antecipacao-pa-ra.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
