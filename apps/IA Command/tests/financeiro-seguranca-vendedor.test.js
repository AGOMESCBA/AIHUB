'use strict';

/**
 * Testes de seguranca do modulo financeiro: vendedor so pode ver as proprias
 * contas a receber (SE1 rateada entre ate 5 vendedores); contas a pagar (SE2)
 * fica bloqueado integralmente para vendedor (sem campo de vendedor na tabela);
 * gestor ve tudo.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const entitySqlGuard = require(path.join(ROOT, 'modules/erp/entity-sql-guard'));
const financeiroSpec = require(path.join(ROOT, 'modules/erp/financeiro/financeiro-ia-owner-spec'));

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

console.log('\n[1] resolverVendedorFixoPorEmpresa — estados de identidade');

ok('sem remetente retorna sem_remetente', () => {
  const r = financeiroSpec.resolverVendedorFixoPorEmpresa(null, 1);
  assert.strictEqual(r.estado, 'sem_remetente');
});

console.log('\n[2] Camada 2 — guard estrutural (validarExclusividadeVendedorSeguranca) com campos E1_VEND1..5');

const CAMPOS = ['E1_VEND1', 'E1_VEND2', 'E1_VEND3', 'E1_VEND4', 'E1_VEND5'];

ok('SQL com apenas o codigo autorizado em E1_VEND1 passa', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE1.E1_SALDO) FROM SE1990 SE1 WHERE SE1.E1_VEND1 = '000012'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, true, `deveria passar: ${r.erros.join(' | ')}`);
});

ok('SQL com o codigo autorizado rateado em E1_VEND4 passa', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE1.E1_SALDO) FROM SE1990 SE1 WHERE SE1.E1_VEND4 = '000012'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, true, `deveria passar (rateio em VEND4): ${r.erros.join(' | ')}`);
});

ok('SQL com codigo de outro vendedor e rejeitado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE1.E1_SALDO) FROM SE1990 SE1 WHERE SE1.E1_VEND1 = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, false, 'deveria rejeitar');
});

ok('sem entidadeSeguranca (gestor), guard nao bloqueia nada', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE1.E1_SALDO) FROM SE1990 SE1 WHERE SE1.E1_VEND1 = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, null, CAMPOS);
  assert.strictEqual(r.ok, true);
});

console.log('\n[3] Camada 2b — bloqueio total de SE2 (contas a pagar) para vendedor');

ok('SQL que usa SE2 e rejeitado quando ha entidadeSeguranca ativa', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE2.E2_SALDO) FROM SE2990 SE2 WHERE SE2.E2_FORNECE = '000010'";
  const r = entitySqlGuard.validarTabelasBloqueadasParaVendedor(sql, { codigo: '000012' }, financeiroSpec.tabelasBloqueadasParaVendedor);
  assert.strictEqual(r.ok, false, 'deveria rejeitar SQL usando SE2 para vendedor');
});

ok('SQL que usa SE1 (nao SE2) passa no guard de tabelas bloqueadas', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE1.E1_SALDO) FROM SE1990 SE1 WHERE SE1.E1_VEND1 = '000012'";
  const r = entitySqlGuard.validarTabelasBloqueadasParaVendedor(sql, { codigo: '000012' }, financeiroSpec.tabelasBloqueadasParaVendedor);
  assert.strictEqual(r.ok, true, `nao deveria bloquear SE1: ${r.erros.join(' | ')}`);
});

ok('sem entidadeSeguranca (gestor), SE2 nao e bloqueado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE2.E2_SALDO) FROM SE2990 SE2";
  const r = entitySqlGuard.validarTabelasBloqueadasParaVendedor(sql, null, financeiroSpec.tabelasBloqueadasParaVendedor);
  assert.strictEqual(r.ok, true);
});

console.log('\n[4] Camada 2c — validarSqlEntidadesResolvidas exige presenca do filtro em SE1');

ok('SQL sem nenhum filtro de vendedor em SE1 e rejeitado quando entidadeSeguranca esta presente', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE1.E1_SALDO) FROM SE1990 SE1 WHERE SE1.E1_SITUACAO = ' '";
  const contexto = { entidades: [{ tipo: 'vendedor_fixo_seguranca', codigo: '000012' }] };
  const r = entitySqlGuard.validarSqlEntidadesResolvidas(sql, contexto, financeiroSpec.entityCatalog.DEFINICOES);
  assert.strictEqual(r.ok, false, 'deveria rejeitar SQL sem filtro de vendedor');
});

console.log('\n[5] Camada 3 — formatarPerguntaAmbiguidade restrita para vendedor');

ok('vendedor restrito nao ve lista de candidatos nem "Todos"', () => {
  const candidatos = [{ nome: 'Maria Souza', tipo: 'cliente', codigo: '000045' }];
  const msg = financeiroSpec.formatarPerguntaAmbiguidade('Maria', candidatos, { ehVendedorRestrito: true });
  assert.ok(!msg.includes('000045'));
  assert.ok(!/\btodos\b/i.test(msg));
});

ok('gestor ve a lista normal com candidatos e "Todos"', () => {
  const candidatos = [{ nome: 'Maria Souza', tipo: 'cliente', codigo: '000045' }];
  const msg = financeiroSpec.formatarPerguntaAmbiguidade('Maria', candidatos, {});
  assert.ok(msg.includes('Maria Souza'));
  assert.ok(/\btodos\b/i.test(msg));
});

console.log('\n[6] prepararIntent — estados de identidade');

ok('sem remetente retorna objeto vazio (sem alterar intent)', () => {
  const r = financeiroSpec.prepararIntent({ intent: {}, empresaId: 1, mensagem: 'saldo a receber' });
  assert.deepStrictEqual(r, {});
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`financeiro-seguranca-vendedor.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`financeiro-seguranca-vendedor.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
