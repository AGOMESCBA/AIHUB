'use strict';

/**
 * Testes de seguranca do modulo faturamento: vendedor so pode ver as proprias
 * vendas (SF2 rateada entre ate 5 vendedores), gestor ve tudo, ambiguidade de
 * nome nao revela dados de terceiros para vendedor restrito.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const entitySqlGuard = require(path.join(ROOT, 'modules/erp/entity-sql-guard'));
const faturamentoSpec = require(path.join(ROOT, 'modules/erp/faturamento/faturamento-ia-owner-spec'));

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
  const r = faturamentoSpec.resolverVendedorFixoPorEmpresa(null, 1);
  assert.strictEqual(r.estado, 'sem_remetente');
});

console.log('\n[2] Camada 2 — guard estrutural (validarExclusividadeVendedorSeguranca) com campos F2_VEND1..5');

const CAMPOS = ['F2_VEND1', 'F2_VEND2', 'F2_VEND3', 'F2_VEND4', 'F2_VEND5'];

ok('SQL com apenas o codigo autorizado em F2_VEND1 passa', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND1 = '000012'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, true, `deveria passar: ${r.erros.join(' | ')}`);
});

ok('SQL com o codigo autorizado rateado em F2_VEND3 (nao F2_VEND1) passa', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND3 = '000012'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, true, `deveria passar (rateio em VEND3): ${r.erros.join(' | ')}`);
});

ok('SQL com codigo de outro vendedor (alem do autorizado) e rejeitado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND1 = '000012' OR SF2.F2_VEND1 = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, false, 'deveria rejeitar');
});

ok('SQL filtrando SOMENTE codigo de outro vendedor (sem o autorizado) e rejeitado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND1 = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, false, 'deveria rejeitar');
});

ok('SQL tentando contornar via F2_VEND2 com codigo de outro vendedor e rejeitado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND1 = '000012' OR SF2.F2_VEND2 = '000099'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, false, 'deveria rejeitar codigo diferente mesmo em VEND2');
});

ok('sem entidadeSeguranca (gestor), guard nao bloqueia nada', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND1 = '000045'";
  const r = entitySqlGuard.validarExclusividadeVendedorSeguranca(sql, null, CAMPOS);
  assert.strictEqual(r.ok, true);
});

console.log('\n[2b] Camada 2c — validarCoberturaCompletaVendedorRateado exige OR em TODAS as 5 posicoes');

ok('SQL filtrando so F2_VEND1 (sem cobrir VEND2..5) e rejeitado por cobertura incompleta', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND1 = '000012'";
  const r = entitySqlGuard.validarCoberturaCompletaVendedorRateado(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, false, 'deveria exigir cobertura das 5 posicoes');
});

ok('SQL com OR cobrindo as 5 posicoes passa na cobertura completa', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE (SF2.F2_VEND1 = '000012' OR SF2.F2_VEND2 = '000012' OR SF2.F2_VEND3 = '000012' OR SF2.F2_VEND4 = '000012' OR SF2.F2_VEND5 = '000012')";
  const r = entitySqlGuard.validarCoberturaCompletaVendedorRateado(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, true, `deveria aceitar cobertura completa: ${r.erros.join(' | ')}`);
});

ok('SQL sem nenhum filtro de vendedor nao dispara o guard de cobertura (outro guard cobre ausencia)', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_TIPO = 'N'";
  const r = entitySqlGuard.validarCoberturaCompletaVendedorRateado(sql, { codigo: '000012' }, CAMPOS);
  assert.strictEqual(r.ok, true, 'guard de cobertura nao deve reclamar de ausencia total, so de cobertura parcial');
});

console.log('\n[3] Camada 2b — validarSqlEntidadesResolvidas exige presenca do filtro (qualquer posicao VEND1..5)');

ok('SQL sem nenhum filtro de vendedor e rejeitado quando entidadeSeguranca esta presente', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_TIPO = 'N'";
  const contexto = { entidades: [{ tipo: 'vendedor_fixo_seguranca', codigo: '000012' }] };
  const r = entitySqlGuard.validarSqlEntidadesResolvidas(sql, contexto, faturamentoSpec.entityCatalog.DEFINICOES);
  assert.strictEqual(r.ok, false, 'deveria rejeitar SQL sem filtro de vendedor');
});

ok('SQL com filtro em F2_VEND5 (ultima posicao) satisfaz a presenca exigida', () => {
  const sql = "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.F2_VEND5 = '000012'";
  const contexto = { entidades: [{ tipo: 'vendedor_fixo_seguranca', codigo: '000012' }] };
  const r = entitySqlGuard.validarSqlEntidadesResolvidas(sql, contexto, faturamentoSpec.entityCatalog.DEFINICOES);
  assert.strictEqual(r.ok, true, `deveria aceitar filtro em VEND5: ${r.erros.join(' | ')}`);
});

console.log('\n[4] Camada 3 — formatarPerguntaAmbiguidade restrita para vendedor');

ok('vendedor restrito (ehVendedorRestrito=true) nao ve lista de candidatos nem "Todos"', () => {
  const candidatos = [
    { nome: 'João Silva', tipo: 'vendedor', codigo: '000045' },
    { nome: 'João Pereira', tipo: 'vendedor', codigo: '000078' },
  ];
  const msg = faturamentoSpec.formatarPerguntaAmbiguidade('João', candidatos, { ehVendedorRestrito: true });
  assert.ok(!msg.includes('000045'), 'nao deve revelar codigo do candidato 1');
  assert.ok(!msg.includes('João Silva'), 'nao deve revelar nome completo do candidato 1');
  assert.ok(!/\btodos\b/i.test(msg), 'nao deve oferecer opcao "Todos"');
});

ok('gestor (ehVendedorRestrito=false/ausente) ve a lista normal com candidatos e "Todos"', () => {
  const candidatos = [{ nome: 'João Silva', tipo: 'vendedor', codigo: '000045' }];
  const msg = faturamentoSpec.formatarPerguntaAmbiguidade('João', candidatos, {});
  assert.ok(msg.includes('João Silva'));
  assert.ok(/\btodos\b/i.test(msg));
});

ok('chamada sem terceiro argumento (compatibilidade retroativa) continua funcionando como gestor', () => {
  const candidatos = [{ nome: 'João Silva', tipo: 'vendedor', codigo: '000045' }];
  const msg = faturamentoSpec.formatarPerguntaAmbiguidade('João', candidatos);
  assert.ok(msg.includes('João Silva'));
});

console.log('\n[5] prepararIntent — estados de identidade');

ok('sem remetente retorna objeto vazio (sem alterar intent)', () => {
  const r = faturamentoSpec.prepararIntent({ intent: {}, empresaId: 1, mensagem: 'faturamento do mes' });
  assert.deepStrictEqual(r, {});
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`faturamento-seguranca-vendedor.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`faturamento-seguranca-vendedor.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
