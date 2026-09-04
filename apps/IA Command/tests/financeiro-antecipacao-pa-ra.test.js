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

console.log('\n[4] Bug real confirmado em producao: IA confunde E1_NATUREZ/E2_NATUREZ com E1_TIPO/E2_TIPO');

// Caso real reportado: "Contas a receber em aberto do ano" — o guard rejeitou o SQL por
// faltar filtro de E1_TIPO, e na tentativa seguinte a IA usou E1_NATUREZ (natureza
// financeira, campo totalmente diferente) com os mesmos valores 'RA'/'NCC', em vez de
// corrigir para E1_TIPO como o erro pedia.
ok('"Contas a receber em aberto do ano" + E1_NATUREZ NOT IN (\'RA\',\'NCC\') e rejeitado com erro especifico', () => {
  const sql = `SET ROWCOUNT 50000;
SELECT SE1.E1_FILIAL, SE1.E1_PREFIXO, SE1.E1_NUM, SE1.E1_PARCELA, SE1.E1_VENCREA AS vencimento, SE1.E1_SALDO AS saldo_a_receber, SA1.A1_NOME AS cliente
FROM SE1990 SE1
JOIN SA1990 SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA
WHERE SE1.D_E_L_E_T_ = ' ' AND SA1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SE1.E1_VENCREA BETWEEN '20260101' AND '20261231' AND SE1.E1_NATUREZ NOT IN ('RA', 'NCC');`;
  const erros = validar(sql, 'Contas a receber em aberto do ano');
  assert.ok(
    erros.some(e => /E1_NATUREZ/.test(e) && /campo ERRADO/i.test(e)),
    `esperava erro especifico apontando a troca de campo, obteve: ${JSON.stringify(erros)}`,
  );
});

ok('"Contas a pagar em aberto do ano" + E2_NATUREZ NOT IN (\'PA\',\'NDF\') e rejeitado com erro especifico', () => {
  const sql = `SET ROWCOUNT 50000;
SELECT SE2.E2_SALDO AS saldo_a_pagar
FROM SE2990 SE2
WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SE2.E2_NATUREZ NOT IN ('PA', 'NDF');`;
  const erros = validar(sql, 'Contas a pagar em aberto do ano');
  assert.ok(
    erros.some(e => /E2_NATUREZ/.test(e) && /campo ERRADO/i.test(e)),
    `esperava erro especifico apontando a troca de campo, obteve: ${JSON.stringify(erros)}`,
  );
});

ok('SQL correto usando E1_TIPO (nao E1_NATUREZ) nao gera o erro especifico', () => {
  const sql = `SET ROWCOUNT 50000;
SELECT SE1.E1_SALDO AS saldo_a_receber
FROM SE1990 SE1
WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SE1.E1_TIPO NOT IN ('RA', 'NCC');`;
  const erros = validar(sql, 'Contas a receber em aberto do ano');
  assert.ok(!erros.some(e => /campo ERRADO/i.test(e)), `nao deveria disparar o erro de campo trocado: ${JSON.stringify(erros)}`);
});

ok('E1_NATUREZ usado com valor legitimo (nao RA/NCC) nao dispara o erro especifico de troca de campo', () => {
  const sql = `SET ROWCOUNT 50000;
SELECT SE1.E1_SALDO AS saldo_a_receber
FROM SE1990 SE1
WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SE1.E1_TIPO NOT IN ('RA', 'NCC') AND SE1.E1_NATUREZ = 'VEN';`;
  const erros = validar(sql, 'Contas a receber em aberto do ano por natureza vendas');
  assert.ok(!erros.some(e => /campo ERRADO/i.test(e)), `nao deveria disparar (E1_NATUREZ='VEN' e uso legitimo): ${JSON.stringify(erros)}`);
});

if (falhou === 0) {
  console.log(`\n${'─'.repeat(60)}\nfinanceiro-antecipacao-pa-ra.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`\n${'─'.repeat(60)}\nfinanceiro-antecipacao-pa-ra.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
