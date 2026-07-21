'use strict';

/**
 * Testes de seguranca do modulo comissao: vendedor so pode ver a propria
 * comissao, gestor ve tudo, ambiguidade de nome nao revela dados de terceiros
 * para vendedor restrito.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const entitySqlGuard = require(path.join(ROOT, 'modules/erp/totvs_protheus/guards/entity-sql-guard'));
const comissaoSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/comissao/comissao-ia-owner-spec'));

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
  const r = comissaoSpec.resolverVendedorFixoPorEmpresa(null, 1);
  assert.strictEqual(r.estado, 'sem_remetente');
});

console.log('\n[2] Camada 2 — guard estrutural (validarExclusividadeVendedorSeguranca)');

ok('SQL com apenas o codigo autorizado passa', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.E3_VEND = '000012'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' });
  assert.strictEqual(r.ok, true, `deveria passar: ${r.erros.join(' | ')}`);
});

ok('SQL com codigo de outro vendedor (alem do autorizado) e rejeitado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.E3_VEND = '000012' OR SE3.E3_VEND = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' });
  assert.strictEqual(r.ok, false, 'deveria rejeitar');
  assert.ok(r.erros.length > 0);
});

ok('SQL filtrando SOMENTE codigo de outro vendedor (sem o autorizado) e rejeitado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.E3_VEND = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' });
  assert.strictEqual(r.ok, false, 'deveria rejeitar');
});

ok('SQL sem nenhum filtro de E3_VEND nao dispara este guard (outro guard cobre ausencia de filtro)', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' });
  assert.strictEqual(r.ok, true, 'guard de exclusividade nao deve reclamar de ausencia, so de codigo errado');
});

ok('sem entidadeSeguranca (gestor), guard nao bloqueia nada', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.E3_VEND = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, null);
  assert.strictEqual(r.ok, true);
});

console.log('\n[3] Camada 3 — formatarPerguntaAmbiguidade restrita para vendedor');

ok('vendedor restrito (ehVendedorRestrito=true) nao ve lista de candidatos nem "Todos"', () => {
  const candidatos = [
    { nome: 'João Silva', tipo: 'vendedor', codigo: '000045' },
    { nome: 'João Pereira', tipo: 'vendedor', codigo: '000078' },
  ];
  const msg = comissaoSpec.formatarPerguntaAmbiguidade('João', candidatos, { ehVendedorRestrito: true });
  assert.ok(!msg.includes('000045'), 'nao deve revelar codigo do candidato 1');
  assert.ok(!msg.includes('000078'), 'nao deve revelar codigo do candidato 2');
  assert.ok(!msg.includes('João Silva'), 'nao deve revelar nome completo do candidato 1');
  assert.ok(!msg.includes('João Pereira'), 'nao deve revelar nome completo do candidato 2');
  assert.ok(!/\btodos\b/i.test(msg), 'nao deve oferecer opcao "Todos"');
  assert.ok(/nome\s+(e|completo)/i.test(msg) || /sobrenome/i.test(msg), 'deve pedir nome e sobrenome / nome completo');
});

ok('gestor (ehVendedorRestrito=false/ausente) ve a lista normal com candidatos e "Todos"', () => {
  const candidatos = [
    { nome: 'João Silva', tipo: 'vendedor', codigo: '000045' },
    { nome: 'João Pereira', tipo: 'vendedor', codigo: '000078' },
  ];
  const msg = comissaoSpec.formatarPerguntaAmbiguidade('João', candidatos, {});
  assert.ok(msg.includes('João Silva'), 'gestor deve ver nome do candidato 1');
  assert.ok(msg.includes('000045'), 'gestor deve ver codigo do candidato 1');
  assert.ok(/\btodos\b/i.test(msg), 'gestor deve ver opcao "Todos"');
});

ok('chamada sem terceiro argumento (compatibilidade retroativa) continua funcionando como gestor', () => {
  const candidatos = [{ nome: 'João Silva', tipo: 'vendedor', codigo: '000045' }];
  const msg = comissaoSpec.formatarPerguntaAmbiguidade('João', candidatos);
  assert.ok(msg.includes('João Silva'));
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`comissao-seguranca-vendedor.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`comissao-seguranca-vendedor.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
