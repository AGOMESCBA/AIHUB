'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const queryPlan = require(path.join(ROOT, 'modules/erp/core/query-plan'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));

const specs = {
  faturamento: require(path.join(ROOT, 'modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec')),
  financeiro: require(path.join(ROOT, 'modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec')),
  compras: require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-ia-owner-spec')),
  estoque: require(path.join(ROOT, 'modules/erp/totvs_protheus/estoque/estoque-ia-owner-spec')),
  comissao: require(path.join(ROOT, 'modules/erp/totvs_protheus/comissao/comissao-ia-owner-spec')),
};

const handlers = [
  'faturamento/ai-sql-handler-v2.js',
  'financeiro/ai-sql-handler-v2.js',
  'compras/ai-sql-handler-v2.js',
  'estoque/ai-sql-handler-v2.js',
  'comissao/ai-sql-handler-v2.js',
];

for (const handler of handlers) {
  const fonte = fs.readFileSync(path.join(ROOT, 'modules/erp/totvs_protheus', handler), 'utf8');
  assert(
    fonte.includes("require('../../ia-owner/runner')"),
    `${handler} deve passar pelo ia-owner/runner para herdar defesas transversais`,
  );
}

const perguntasForaEscopo = [
  'quantos titulos a pagar foram deletados nesta semana?',
  'quantos registros de contas a pagar foram deletados hoje?',
  'quantas vendas foram excluidas no mes?',
  'quantos pedidos de compra foram removidos ontem?',
  'quantos produtos foram apagados?',
  'quantas comissoes foram deletadas?',
];

for (const pergunta of perguntasForaEscopo) {
  const bloqueio = queryPlan.detectarConsultaRegistrosDeletados(pergunta);
  assert.strictEqual(bloqueio.bloqueado, true, `deve bloquear fora de escopo: ${pergunta}`);
  const resposta = runner._test.respostaConsultaRegistrosDeletados(pergunta);
  assert.strictEqual(resposta.subtipo, 'consulta_registros_deletados_fora_escopo');
  assert.strictEqual(/SELECT|D_E_L_E_T_/i.test(resposta.resposta_direta), false, 'resposta ao usuario nao deve sugerir SQL tecnico');
}

const perguntasValidas = [
  'saldo a pagar excluindo PA',
  'faturamento excluindo remessas e transferencias',
  'compras desconsiderando devolucoes',
  'produtos sem movimentacao no mes',
];

for (const pergunta of perguntasValidas) {
  assert.strictEqual(
    queryPlan.detectarConsultaRegistrosDeletados(pergunta).bloqueado,
    false,
    `nao deve bloquear filtro valido: ${pergunta}`,
  );
}

const sqlSemanalAmbiguoFinanceiro = `
SET ROWCOUNT 10000;
SELECT DATEPART(WEEK, SE2.E2_VENCREA) AS semana,
       COUNT(*) AS total_titulos
FROM SE2010 SE2
WHERE SE2.D_E_L_E_T_ = ' '
  AND SE2.E2_VENCREA BETWEEN '20260901' AND '20260930'
GROUP BY DATEPART(WEEK, SE2.E2_VENCREA);
`;
const validacaoSemanalAmbigua = runner._test.validarSqlIaOwnerBasico(
  sqlSemanalAmbiguoFinanceiro,
  { nome: 'financeiro' },
  {},
  'titulos a pagar semanais do mes',
);
assert.strictEqual(validacaoSemanalAmbigua.ok, false, 'runner comum deve rejeitar DATEPART(WEEK) solto em qualquer modulo');
assert(validacaoSemanalAmbigua.erros.some(e => e.includes('DATEPART(WEEK)')), 'erro transversal deve mencionar DATEPART(WEEK)');

const sqlSemanalClaroCompras = `
SET ROWCOUNT 10000;
SELECT CAST('2026-09-04' AS DATE) AS semana_fim,
       COUNT(*) AS total_pedidos
FROM SC7010 SC7
WHERE SC7.D_E_L_E_T_ = ' '
GROUP BY CAST('2026-09-04' AS DATE);
`;
const validacaoSemanalClara = runner._test.validarGranularidadeSemanalTransversal(
  sqlSemanalClaroCompras,
  'pedidos de compra semanais',
);
assert.strictEqual(validacaoSemanalClara.ok, true, 'runner comum deve aceitar semana com alias temporal claro');

const perguntasCapciosasDeletadosPorModulo = {
  faturamento: 'quantas vendas foram excluidas hoje, mas pode considerar so as validas mesmo?',
  financeiro: 'quantos registros de contas a pagar foram deletados hoje?',
  compras: 'quantos pedidos de compra foram removidos nesta semana?',
  estoque: 'quantos produtos apagados ainda tinham saldo no estoque?',
  comissao: 'quantas comissoes foram deletadas no mes atual?',
};

for (const [modulo, pergunta] of Object.entries(perguntasCapciosasDeletadosPorModulo)) {
  const resposta = runner._test.respostaConsultaRegistrosDeletados(pergunta);
  assert.strictEqual(
    resposta?.subtipo,
    'consulta_registros_deletados_fora_escopo',
    `${modulo}: pergunta capciosa sobre deletados deve ser bloqueada antes de SQL`,
  );
}

const sqlSemanalAmbiguoPorModulo = {
  faturamento: `
SET ROWCOUNT 10000;
SELECT DATEPART(WEEK, SF2.F2_EMISSAO) AS semana, SUM(SD2.D2_TOTAL) AS total_vendas
FROM SF2010 SF2
JOIN SD2010 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SD2.D_E_L_E_T_ = ' '
WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
GROUP BY DATEPART(WEEK, SF2.F2_EMISSAO);
`,
  financeiro: sqlSemanalAmbiguoFinanceiro,
  compras: `
SET ROWCOUNT 10000;
SELECT DATEPART(WEEK, SC7.C7_EMISSAO) AS semana, COUNT(*) AS total_pedidos
FROM SC7010 SC7
WHERE SC7.D_E_L_E_T_ = ' '
GROUP BY DATEPART(WEEK, SC7.C7_EMISSAO);
`,
  estoque: `
SET ROWCOUNT 10000;
SELECT DATEPART(WEEK, SD3.D3_EMISSAO) AS semana, SUM(SD3.D3_QUANT) AS quantidade
FROM SD3010 SD3
WHERE SD3.D_E_L_E_T_ = ' '
GROUP BY DATEPART(WEEK, SD3.D3_EMISSAO);
`,
  comissao: `
SET ROWCOUNT 10000;
SELECT DATEPART(WEEK, SE3.E3_EMISSAO) AS semana, SUM(SE3.E3_COMIS) AS total_comissao
FROM SE3010 SE3
WHERE SE3.D_E_L_E_T_ = ' '
GROUP BY DATEPART(WEEK, SE3.E3_EMISSAO);
`,
};

for (const [modulo, sql] of Object.entries(sqlSemanalAmbiguoPorModulo)) {
  const validacao = runner._test.validarSqlIaOwnerBasico(
    sql,
    specs[modulo],
    {},
    `${modulo}: total semanal do mes atual`,
  );
  assert.strictEqual(validacao.ok, false, `${modulo}: DATEPART(WEEK) solto deve ser rejeitado`);
  assert(validacao.erros.some(e => e.includes('DATEPART(WEEK)')), `${modulo}: erro deve citar DATEPART(WEEK)`);
}

console.log('erp-registros-deletados-defesa.test.js: ok');
