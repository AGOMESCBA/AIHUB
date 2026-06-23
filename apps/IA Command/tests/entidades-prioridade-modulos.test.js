'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const faturamento = require(path.join(ROOT, 'modules/erp/faturamento/faturamento-ia-owner-spec'));
const comissao = require(path.join(ROOT, 'modules/erp/comissao/comissao-ia-owner-spec'));
const compras = require(path.join(ROOT, 'modules/erp/compras/compras-ia-owner-spec'));
const financeiro = require(path.join(ROOT, 'modules/erp/financeiro/financeiro-ia-owner-spec'));

function resolverRegrasTecnicas(spec) {
  return typeof spec.regrasTecnicas === 'function' ? spec.regrasTecnicas() : (spec.regrasTecnicas || '');
}

assert.strictEqual(typeof faturamento.resolverEntidades, 'function', 'faturamento IA-OWNER deve resolver entidades por spec tecnica');
assert.strictEqual(faturamento.resolverEntidadesAntesDaIa, true, 'faturamento deve resolver entidades antes da IA-OWNER');
assert(resolverRegrasTecnicas(faturamento).includes('Quando precisar filtrar cliente, vendedor, produto, grupo_produto, centro_custo ou TES'), 'faturamento IA-OWNER deve pedir entidades cadastrais explicitamente');

assert.strictEqual(typeof comissao.resolverEntidades, 'function', 'comissao IA-OWNER deve resolver entidades por spec tecnica');
assert.strictEqual(comissao.resolverEntidadesAntesDaIa, true, 'comissao deve resolver entidades antes da IA-OWNER');
assert.deepStrictEqual(comissao.entityCatalog.TIPOS_POR_CONTEXTO, ['vendedor', 'cliente'], 'comissao deve priorizar vendedor antes de cliente');
assert(resolverRegrasTecnicas(comissao).includes('SA3.A3_NOME AS vendedor') && resolverRegrasTecnicas(comissao).includes('SA1.A1_NOME AS cliente'), 'comissao IA-OWNER deve expor descricoes de vendedor/cliente');

assert.strictEqual(typeof compras.resolverEntidades, 'function', 'compras IA-OWNER deve resolver entidades por spec tecnica');
assert.strictEqual(compras.resolverEntidadesAntesDaIa, true, 'compras deve resolver entidades antes da IA-OWNER');
assert.deepStrictEqual(
  compras.entityCatalog.TIPOS_POR_CONTEXTO,
  ['fornecedor', 'produto', 'grupo_produto', 'centro_custo', 'natureza', 'tes'],
  'compras deve priorizar fornecedor antes das demais entidades',
);
assert(resolverRegrasTecnicas(compras).includes('Quando precisar filtrar fornecedor, produto, grupo_produto, centro_custo, natureza ou TES'), 'compras IA-OWNER deve pedir entidades cadastrais explicitamente');

assert.strictEqual(financeiro.resolverEntidadesAntesDaIa, true, 'financeiro deve resolver entidades antes da IA-OWNER');
assert.deepStrictEqual(
  financeiro._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'desconhecido', origem: 'ia' }, { carteira: 'receber' }),
  [['cliente'], ['vendedor', 'natureza']],
  'financeiro receber deve priorizar cliente',
);

assert.deepStrictEqual(
  financeiro._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'desconhecido', origem: 'ia' }, { carteira: 'pagar' }),
  [['fornecedor'], ['natureza']],
  'financeiro pagar deve priorizar fornecedor',
);

console.log('entidades-prioridade-modulos.test.js: ok');
