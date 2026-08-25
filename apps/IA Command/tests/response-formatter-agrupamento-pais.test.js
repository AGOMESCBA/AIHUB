'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const formatter = require(path.join(ROOT, 'modules/erp/core/response-formatter'));

const resposta = formatter.formatarAiSqlLocal([
  { ano_mes: 202601, cliente: 'Cliente A', valor_total: 100 },
  { ano_mes: 202601, cliente: 'Cliente B', valor_total: 200 },
  { ano_mes: 202602, cliente: 'Cliente A', valor_total: 300 },
  { ano_mes: 202602, cliente: 'Cliente B', valor_total: 400 },
], {
  agrupar_por_composto: ['mes', 'cliente'],
});

assert(
  /\*Jan\/2026\*\n[\s\S]+Cliente B[\s\S]+Subtotal[\s\S]+\n\n.*\*Fev\/2026\*/.test(resposta),
  'agrupamentos pais devem ter uma linha em branco entre blocos',
);

const textoAnexoA = [
  '*Contas a Pagar por Mês e Fornecedor*',
  '',
  '1. Janeiro 2026: R$ -2.191,80',
  '1. MURILLO HENRIQUE TEIXEIRA DE CARVALHO SILVA PJ: R$ -2.191,80',
  '2. Fevereiro 2026: R$ -157.496,93',
  '1. ALESSANDRO GOMES: R$ -153.601,46',
  '2. ALMIR WEDER: R$ -203.895,47',
  '3. Março 2026: R$ -2.000,00',
  '1. LUCINIR TEREZINHA ZEFIRO CORREIA: R$ -2.000,00',
].join('\n');

const normalizado = formatter.normalizarAgrupamentosPais(textoAnexoA);
assert(
  /CARVALHO SILVA PJ: R\$ -2\.191,80\n\n2\. Fevereiro 2026/.test(normalizado),
  'deve inserir linha em branco antes do proximo mes pai',
);
assert(
  /ALMIR WEDER: R\$ -203\.895,47\n\n3\. Março 2026/.test(normalizado),
  'deve repetir o padrao entre todos os meses pais',
);

const listaSimplesMeses = [
  '1. Janeiro 2026: R$ 1,00',
  '2. Fevereiro 2026: R$ 2,00',
  '3. Março 2026: R$ 3,00',
].join('\n');
assert.strictEqual(
  formatter.normalizarAgrupamentosPais(listaSimplesMeses),
  listaSimplesMeses,
  'lista simples por mes nao deve ganhar linhas extras',
);

const apresentacaoValorQuantidade = formatter.montarApresentacaoResposta(
  'Detalhamento por cliente, nota fiscal e produto',
  {
    tipo: 'sucesso_ai_sql',
    rows: [
      { cliente: 'Cliente A', nota_fiscal: '0001', produto: 'Produto 1', valor_total: 1000, quantidade_faturada: 10 },
      { cliente: 'Cliente B', nota_fiscal: '0002', produto: 'Produto 2', valor_total: 2500, quantidade_faturada: 20 },
    ],
  },
  {
    _mensagemOriginal: 'Total faturado no dia por cliente, nota fiscal e produto trazendo valor e quantidade',
    _metricasDetectadas: ['quantidade_faturada'],
    ordenar_por: 'quantidade_faturada:desc',
  },
  { sugerirComparacao: false },
);

assert(apresentacaoValorQuantidade.resumo.includes('valor: R$'), `resumo deve manter valor_total: ${apresentacaoValorQuantidade.resumo}`);
assert(apresentacaoValorQuantidade.resumo.includes('quantidade:'), `resumo deve manter quantidade: ${apresentacaoValorQuantidade.resumo}`);
assert.strictEqual(apresentacaoValorQuantidade.indicadores[0].label, 'valor', 'card principal deve priorizar valor antes de quantidade');
assert.strictEqual(apresentacaoValorQuantidade.indicadores[1].label, 'quantidade', 'segundo card deve mostrar quantidade');

console.log('response-formatter-agrupamento-pais.test.js: ok');
