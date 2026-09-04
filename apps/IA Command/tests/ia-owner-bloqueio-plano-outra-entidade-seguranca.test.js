'use strict';

/**
 * Caso real reportado: usuario com telefone vinculado ao vendedor 000007 pediu
 * "vendas do ano com vendedor de codigo 000003". O codigo 000003 nao existe no
 * cadastro de vendedores, entao nunca vira entidade resolvida (o bloqueio antecipado
 * baseado em entidadesResolvidas so compara contra cadastros reais) — a IA devolveu
 * precisa_confirmacao perguntando se deveria seguir SEM o filtro de vendedor, sem
 * jamais negar o acesso. planoTentaFiltrarOutraEntidadeSeguranca fecha essa lacuna
 * lendo plano.obj.filtros diretamente, antes de qualquer chamada a IA prosseguir.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const { planoTentaFiltrarOutraEntidadeSeguranca } = runner._test;

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

console.log('\n[1] planoTentaFiltrarOutraEntidadeSeguranca — vendedor');

ok('vendedor 000007 pedindo filtro vendedor=000003 (codigo inexistente no cadastro) e bloqueado', () => {
  const r = planoTentaFiltrarOutraEntidadeSeguranca(
    { filtros: { vendedor: '000003' } },
    { tipo: 'vendedor_fixo_seguranca', codigo: '000007' },
  );
  assert.deepStrictEqual(r, { campo: 'vendedor', valorPedido: '000003' });
});

ok('vendedor pedindo o proprio codigo nao e bloqueado', () => {
  const r = planoTentaFiltrarOutraEntidadeSeguranca(
    { filtros: { vendedor: '000007' } },
    { tipo: 'vendedor_fixo_seguranca', codigo: '000007' },
  );
  assert.strictEqual(r, null);
});

ok('pergunta generica sem filtro de vendedor no plano nao e bloqueada', () => {
  const r = planoTentaFiltrarOutraEntidadeSeguranca(
    { filtros: {} },
    { tipo: 'vendedor_fixo_seguranca', codigo: '000007' },
  );
  assert.strictEqual(r, null);
});

ok('gestor (sem entidadeSeguranca) nunca e bloqueado, mesmo pedindo outro vendedor', () => {
  const r = planoTentaFiltrarOutraEntidadeSeguranca(
    { filtros: { vendedor: '000003' } },
    null,
  );
  assert.strictEqual(r, null);
});

console.log('\n[2] planoTentaFiltrarOutraEntidadeSeguranca — cliente');

ok('cliente restrito pedindo filtro de outro cliente e bloqueado', () => {
  const r = planoTentaFiltrarOutraEntidadeSeguranca(
    { filtros: { cliente: '000099' } },
    { tipo: 'cliente_fixo_seguranca', codigo: '000037' },
  );
  assert.deepStrictEqual(r, { campo: 'cliente', valorPedido: '000099' });
});

ok('cliente restrito pedindo o proprio codigo nao e bloqueado', () => {
  const r = planoTentaFiltrarOutraEntidadeSeguranca(
    { filtros: { cliente: '000037' } },
    { tipo: 'cliente_fixo_seguranca', codigo: '000037' },
  );
  assert.strictEqual(r, null);
});

console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`ia-owner-bloqueio-plano-outra-entidade-seguranca.test.js: ${passou} testes passaram${falhou ? `, ${falhou} falharam` : ''} ${falhou ? '✗' : '✓'}`);
if (falhou) process.exit(1);
