'use strict';

/**
 * Testes do guardrail sqlPatternsProibidos que detecta confusao entre SC7.C7_CONAPRO
 * (status de ALCADA/aprovacao) e SC7.C7_APROV (status de ATENDIMENTO/recebimento) —
 * bug real confirmado em producao: pergunta "Meus pedidos de compras aprovados no mes
 * passado" gerou SQL com SC7.C7_APROV = 'L' (campo errado) em vez de
 * SC7.C7_CONAPRO IN ('L','') (campo correto para status de alcada).
 *
 * Causa raiz: o prompt (compras-fragmentos-spec.js) ensinava que C7_CONAPRO usa o valor
 * 'A' para aprovado — esse valor NAO EXISTE no dominio real do campo (confirmado contra
 * documentacao oficial do Protheus: os valores validos sao 'L'/vazio = liberado/aprovado,
 * 'B' = bloqueado, 'R' = rejeitado). Isso, somado a nomenclatura parecida entre C7_APROV
 * e C7_CONAPRO, levou a IA a usar o campo errado com o valor certo ('L').
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const spec = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-ia-owner-spec'));

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

console.log('\n[1] Bug real: pergunta sobre status de alcada usando C7_APROV em vez de C7_CONAPRO');

ok('"Meus pedidos de compras aprovados no mes passado" + C7_APROV = \'L\' e rejeitado', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_APROV = 'L'
  AND (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0
  AND SC7.C7_EMISSAO BETWEEN '20260801' AND '20260831';`;
  const erros = validar(sql, 'Meus pedidos de compras aprovados no mes passado');
  assert.ok(
    erros.some(e => /C7_APROV/.test(e) && /C7_CONAPRO/.test(e)),
    `esperava erro apontando a troca de campo, obteve: ${JSON.stringify(erros)}`,
  );
});

ok('"pedidos liberados na alcada" + C7_APROV = \'L\' tambem e rejeitado', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7 WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_APROV = 'L';`;
  const erros = validar(sql, 'pedidos liberados na alcada este mes');
  assert.ok(erros.some(e => /C7_APROV/.test(e) && /C7_CONAPRO/.test(e)), `obteve: ${JSON.stringify(erros)}`);
});

console.log('\n[2] Valor inexistente C7_CONAPRO = \'A\'');

ok('C7_CONAPRO = \'A\' e rejeitado (valor nao existe no dominio do campo)', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7 WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO = 'A';`;
  const erros = validar(sql, 'pedidos aprovados');
  assert.ok(erros.some(e => /C7_CONAPRO.*'A'/.test(e) && /INEXISTENTE/i.test(e)), `obteve: ${JSON.stringify(erros)}`);
});

console.log('\n[3] SQL correto — nao deve disparar nenhum dos dois guards novos');

ok('C7_CONAPRO IN (\'L\',\'\') para "pedidos aprovados" passa sem erro', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO IN ('L', '')
  AND SC7.C7_EMISSAO BETWEEN '20260801' AND '20260831';`;
  const erros = validar(sql, 'Meus pedidos de compras aprovados no mes passado');
  assert.ok(!erros.some(e => /C7_CONAPRO/.test(e)), `nao deveria disparar guard de CONAPRO: ${JSON.stringify(erros)}`);
});

ok('C7_APROV = \'L\' para pergunta sobre ATENDIMENTO (nao alcada) nao dispara o guard de troca de campo', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_APROV = 'L'
  AND (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0;`;
  const erros = validar(sql, 'pedidos de compra em aberto para receber nota fiscal');
  assert.ok(!erros.some(e => /C7_APROV/.test(e) && /C7_CONAPRO/.test(e)), `nao deveria disparar: ${JSON.stringify(erros)}`);
});

ok('C7_CONAPRO = \'B\' (bloqueado, valor real e correto) nao dispara nenhum guard novo', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7 WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO = 'B';`;
  const erros = validar(sql, 'pedidos bloqueados');
  assert.ok(!erros.some(e => /C7_CONAPRO.*'A'/.test(e) || (/C7_APROV/.test(e) && /C7_CONAPRO/.test(e))), `obteve: ${JSON.stringify(erros)}`);
});

if (falhou === 0) {
  console.log(`\n${'─'.repeat(60)}\ncompras-conapro-vs-aprov.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`\n${'─'.repeat(60)}\ncompras-conapro-vs-aprov.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
