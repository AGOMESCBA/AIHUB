'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const faturamentoSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec'));
const intentService = require(path.join(ROOT, 'modules/ai/intent-service'));

const systemPrompt = promptBuilder.buildSystemPrompt(faturamentoSpec);

assert(systemPrompt.includes('REGRA FISCAL BRASILEIRA DE CFOP PARA RECEITA'), 'quantidade/valor faturado deve aplicar regra nacional de receita por padrao');
assert(systemPrompt.includes("AND NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%')"), 'faturamento/vendas deve excluir remessas por padrao');
assert(systemPrompt.includes("SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156')"), 'faturamento/vendas deve excluir transferencias por padrao');
assert(systemPrompt.includes("Quantidade carregada: SUM(SD2.D2_QUANT), com JOIN adicional SD2 -> SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S'"), 'quantidade carregada deve usar JOIN SF4/F4_ESTOQUE=S em vez de filtro de CF');
assert(systemPrompt.includes("Entrega futura, venda para entrega futura ou nota mae: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF IN ('5117', '6117')"), 'entrega futura/nota mae deve filtrar CF 5117 e 6117 (estadual e interestadual)');
assert(systemPrompt.includes('SUM(SD2.D2_QUANT) sem filtro em SD2.D2_CF'), 'movimentacao total deve permitir consulta sem filtro fiscal');

const intencoes = [
  { nome: 'faturamento_dinamico', modulo: 'faturamento', acao: 'ai_text_to_sql', descricao: 'Consultas dinamicas de faturamento via IA' },
  { nome: 'compras_dinamico', modulo: 'compras', acao: 'ai_text_to_sql', descricao: 'Consultas dinamicas de compras via IA' },
  { nome: 'financeiro_dinamico', modulo: 'financeiro', acao: 'ai_text_to_sql', descricao: 'Consultas dinamicas do financeiro via IA' },
];

const perguntasFaturamento = [
  'quantidade carregada hoje',
  'volume carregado no dia',
  'quantidade de nota mae hoje',
  'venda para entrega futura no mes',
  'movimentacao total de saida hoje',
  'quantidade total sem filtro fiscal',
  'todas as saidas incluindo remessa e transferencia',
];

for (const pergunta of perguntasFaturamento) {
  const preferencial = intentService._intencaoAiSqlPreferencial(pergunta, intencoes, intentService._SINONIMOS_SISTEMA, []);
  assert.strictEqual(preferencial?.nome, 'faturamento_dinamico', `pergunta deveria preferir faturamento mesmo com IA disponivel: ${pergunta}`);

  const decisao = intentService._deveBypassDinamico(pergunta, intencoes, intentService._SINONIMOS_SISTEMA, [], { temChaveIA: false });
  assert.strictEqual(decisao.usar, true, `pergunta deveria entrar no fluxo dinamico: ${pergunta}`);
  assert.strictEqual(decisao.intencao?.nome, 'faturamento_dinamico', `pergunta deveria rotear para faturamento: ${pergunta}`);
}

const sx2 = { SD2990: 'E', SF2990: 'E' };

const sqlQuantidadeFaturadaSemFiltroCfop = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SF2.F2_EMISSAO = '20260613'
`;
assert.strictEqual(
  runner._test.validarSqlIaOwnerBasico(sqlQuantidadeFaturadaSemFiltroCfop, faturamentoSpec, sx2, 'quantidade faturada no mes').ok,
  false,
  'SQL de quantidade faturada sem exclusao de remessa/transferencia deve ser rejeitado',
);

const sqlQuantidadeFaturada = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SF2.F2_EMISSAO = '20260613'
  AND NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%')
  AND SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156')
`;
assert.strictEqual(
  runner._test.validarSqlIaOwnerBasico(sqlQuantidadeFaturada, faturamentoSpec, sx2, 'quantidade faturada no mes').ok,
  true,
  'SQL de quantidade faturada com exclusao de remessa/transferencia deve ser aceito',
);

const sqlQuantidadeCarregada = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_carregada
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
INNER JOIN SF4990 SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S'
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SF2.F2_EMISSAO = '20260613'
`;
assert.strictEqual(
  runner._test.validarSqlIaOwnerBasico(sqlQuantidadeCarregada, faturamentoSpec, sx2, 'quantidade carregada no mes').ok,
  true,
  'SQL de quantidade carregada com JOIN SF4/F4_ESTOQUE=S deve ser aceito',
);

const sqlQuantidadeCarregadaComFiltroCfAntigo = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_carregada
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SF2.F2_EMISSAO = '20260613'
  AND SD2.D2_CF NOT IN ('5117', '6117')
`;
assert.strictEqual(
  runner._test.validarSqlIaOwnerBasico(sqlQuantidadeCarregadaComFiltroCfAntigo, faturamentoSpec, sx2, 'quantidade carregada no mes').ok,
  false,
  'SQL de quantidade carregada usando o filtro antigo de CF (sem JOIN SF4) deve ser rejeitado',
);

const sqlEntregaFutura = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_entrega_futura
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SF2.F2_EMISSAO = '20260613'
  AND SD2.D2_CF = '5117'
`;
assert.strictEqual(
  runner._test.validarSqlIaOwnerBasico(sqlEntregaFutura, faturamentoSpec, sx2).ok,
  true,
  'SQL de entrega futura/nota mae com 5117 deve ser aceito',
);

const sqlMovimentacaoTotal = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_movimentada_total
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SF2.F2_EMISSAO = '20260613'
`;
assert(!/D2_CF/i.test(sqlMovimentacaoTotal), 'movimentacao total de saida nao deve aplicar filtro em D2_CF');
assert.strictEqual(
  runner._test.validarSqlIaOwnerBasico(sqlMovimentacaoTotal, faturamentoSpec, sx2, 'movimentacao total de saida hoje').ok,
  true,
  'SQL de movimentacao total sem filtro fiscal deve ser aceito',
);

const sqlFaturamentoSemFiltroCfop = sqlQuantidadeFaturadaSemFiltroCfop.replace('quantidade_faturada', 'faturamento').replace('SD2.D2_QUANT', 'SD2.D2_TOTAL');
assert.strictEqual(
  faturamentoSpec._test.validarExclusaoCfopReceita(sqlFaturamentoSemFiltroCfop, 'qual o faturamento do mes?') === null,
  false,
  'validador direto deve rejeitar faturamento sem exclusao de CFOP sem receita',
);
assert.strictEqual(
  faturamentoSpec._test.validarExclusaoCfopReceita(sqlFaturamentoSemFiltroCfop, 'todas as saidas do mes incluindo remessa e transferencia'),
  null,
  'validador direto deve aceitar todas as saidas sem exclusao fiscal',
);
const erroCfopReceita = Object.assign(
  new Error(faturamentoSpec._test.validarExclusaoCfopReceita(sqlFaturamentoSemFiltroCfop, 'qual o faturamento do mes?')),
  { _tipo: 'contrato_ia_owner_invalido' },
);
const retryCfopReceita = runner._test.buildRetryTecnicoIaOwner({ erro: erroCfopReceita });
assert(retryCfopReceita.includes('REGRA FISCAL BRASILEIRA DE CFOP PARA RECEITA'), 'retry deve devolver a regra fiscal brasileira de CFOP para a IA');
assert(retryCfopReceita.includes("SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156')"), 'retry deve orientar exclusao de transferencias');

console.log('faturamento-quantidade-fiscal.test.js: ok');
