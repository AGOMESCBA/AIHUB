'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const compras = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-ia-owner-spec'));
const comissao = require(path.join(ROOT, 'modules/erp/totvs_protheus/comissao/comissao-ia-owner-spec'));
const financeiro = require(path.join(ROOT, 'modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));

function helpersComResposta({ tabelaEsperada, entidade }) {
  const sqls = [];
  return {
    sqls,
    helpers: {
      tabelaFisicaSX2: (_sx2, base) => `${base}990`,
      escapeSqlLiteral: valor => String(valor || '').replace(/'/g, "''"),
      connectionFactory: {
        carregarConexao: () => ({}),
        executar: async (_conn, sql) => {
          sqls.push(sql);
          return sql.includes(tabelaEsperada)
            ? [{ codigo: entidade.codigo, loja: entidade.loja || null, nome: entidade.nome }]
            : [];
        },
      },
    },
  };
}

async function main() {
  assert.deepStrictEqual(
    runner._test.normalizarFiltroEmpresaComoEntidade(compras, { filtros: { empresa: 'ACME' } }, 'Compras da ACME').filtros,
    { fornecedor: 'ACME' },
    'compras deve reclassificar nome nao qualificado como fornecedor',
  );
  assert.deepStrictEqual(
    runner._test.normalizarFiltroEmpresaComoEntidade(comissao, { filtros: { empresa: 'JEAN' } }, 'Comissao do Jean').filtros,
    { vendedor: 'JEAN' },
    'comissao deve reclassificar nome nao qualificado como vendedor',
  );
  assert.deepStrictEqual(
    runner._test.normalizarFiltroEmpresaComoEntidade(
      financeiro,
      { filtros: { empresa: 'ACME' }, _orquestradorContrato: { carteira: 'pagar', filtros: { empresa: 'ACME' } } },
      'Contas a pagar da ACME',
    ).filtros,
    { fornecedor: 'ACME' },
    'financeiro pagar deve reclassificar nome nao qualificado como fornecedor',
  );
  assert.deepStrictEqual(
    runner._test.normalizarFiltroEmpresaComoEntidade(
      financeiro,
      { filtros: { empresa: 'ACME' }, _orquestradorContrato: { carteira: 'receber', filtros: { empresa: 'ACME' } } },
      'Contas a receber da ACME',
    ).filtros,
    { cliente: 'ACME' },
    'financeiro receber deve reclassificar nome nao qualificado como cliente',
  );

  const comprasMock = helpersComResposta({
    tabelaEsperada: 'SA2990 SA2',
    entidade: { codigo: 'F001', loja: '01', nome: 'FORNECEDOR ACME' },
  });
  const comprasResolvidas = await compras._test.resolverEntidades({
    pedidos: [{ texto: 'ACME', tipo: 'desconhecido', tipo_sugerido: 'desconhecido', origem: 'ia' }],
    empresaId: 1,
    sx2: {},
    periodo: { dataInicio: '20260101', dataFim: '20261231' },
    filial: 'TODAS',
    helpers: comprasMock.helpers,
  });
  assert.strictEqual(comprasResolvidas.entidades[0].tipo, 'fornecedor', 'compras deve encontrar fornecedor primeiro');
  assert.strictEqual(comprasResolvidas.entidades[0].termoBusca, 'ACME', 'compras deve preservar o termo para resolver novamente em outro tenant');
  assert.strictEqual(comprasMock.sqls.length, 1, 'compras deve parar ao encontrar fornecedor');

  const comissaoMock = helpersComResposta({
    tabelaEsperada: 'SA3990 SA3',
    entidade: { codigo: 'V001', nome: 'VENDEDOR ACME' },
  });
  const comissaoResolvidas = await comissao._test.resolverEntidades({
    pedidos: [{ texto: 'ACME', tipo: 'desconhecido', tipo_sugerido: 'desconhecido', origem: 'ia' }],
    empresaId: 1,
    sx2: {},
    helpers: comissaoMock.helpers,
  });
  assert.strictEqual(comissaoResolvidas.entidades[0].tipo, 'vendedor', 'comissao deve encontrar vendedor primeiro');
  assert.strictEqual(comissaoResolvidas.entidades[0].termoBusca, 'ACME', 'comissao deve preservar o termo para resolver novamente em outro tenant');
  assert.strictEqual(comissaoMock.sqls.length, 1, 'comissao deve parar ao encontrar vendedor');

  const financeiroReceberMock = helpersComResposta({
    tabelaEsperada: 'SA1990 SA1',
    entidade: { codigo: 'C001', loja: '01', nome: 'CLIENTE ACME' },
  });
  const financeiroReceber = await financeiro._test.resolverEntidades({
    pedidos: [{ texto: 'ACME', tipo: 'desconhecido', tipo_sugerido: 'desconhecido', origem: 'ia' }],
    empresaId: 1,
    sx2: {},
    estadoAnterior: { contrato_orquestrador: { carteira: 'receber' }, filtros: {} },
    helpers: financeiroReceberMock.helpers,
  });
  assert.strictEqual(financeiroReceber.entidades[0].tipo, 'cliente', 'financeiro receber deve encontrar cliente primeiro');
  assert.strictEqual(financeiroReceber.entidades[0].termoBusca, 'ACME', 'financeiro deve preservar o termo para resolver novamente em outro tenant');

  const financeiroPagarMock = helpersComResposta({
    tabelaEsperada: 'SA2990 SA2',
    entidade: { codigo: 'F001', loja: '01', nome: 'FORNECEDOR ACME' },
  });
  const financeiroPagar = await financeiro._test.resolverEntidades({
    pedidos: [{ texto: 'ACME', tipo: 'desconhecido', tipo_sugerido: 'desconhecido', origem: 'ia' }],
    empresaId: 1,
    sx2: {},
    estadoAnterior: { contrato_orquestrador: { carteira: 'pagar' }, filtros: {} },
    helpers: financeiroPagarMock.helpers,
  });
  assert.strictEqual(financeiroPagar.entidades[0].tipo, 'fornecedor', 'financeiro pagar deve encontrar fornecedor primeiro');

  console.log('entidades-pre-resolucao-transversal.test.js: ok');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
