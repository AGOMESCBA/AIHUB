'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const sx2Normalizer = require(path.join(ROOT, 'modules/erp/sx2-sql-normalizer'));
const entitySqlGuard = require(path.join(ROOT, 'modules/erp/entity-sql-guard'));
const financeiroCatalog = require(path.join(ROOT, 'modules/erp/financeiro/entity-catalog'));
const financeiroSpec = require(path.join(ROOT, 'modules/erp/financeiro/financeiro-ia-owner-spec'));

const handlerFonte = fs.readFileSync(path.join(ROOT, 'modules/erp/financeiro/ai-sql-handler-v2.js'), 'utf8');
assert(handlerFonte.includes('../ia-owner/runner'), 'handler financeiro deve usar ia-owner/runner');
assert(handlerFonte.includes('./financeiro-ia-owner-spec'), 'handler financeiro deve usar financeiro-ia-owner-spec');
assert(!handlerFonte.includes(['financeiro', 'contract'].join('-')), 'handler financeiro nao deve usar contrato legado');

const systemPrompt = promptBuilder.buildSystemPrompt(financeiroSpec);
assert(systemPrompt.includes('Voce e o IA-OWNER do modulo financeiro'), 'prompt deve declarar IA-OWNER financeiro');
assert(systemPrompt.includes('Saldo a pagar/em aberto: SE2.E2_SALDO'), 'prompt deve orientar saldo a pagar');
assert(systemPrompt.includes('Saldo a receber/em aberto: SE1.E1_SALDO'), 'prompt deve orientar saldo a receber');
assert(systemPrompt.includes('## Antecipacoes PA/RA'), 'prompt deve conter regra de PA/RA');
assert(systemPrompt.includes('So considere/apresente PA ou RA quando o usuario pedir explicitamente'), 'PA/RA devem ser opt-in');
assert(systemPrompt.includes('somente quando a pergunta estiver por fornecedor ou por cliente'), 'PA/RA devem exigir entidade');
assert(systemPrompt.includes('Saldo bancario puro usa SOMENTE SE8 e SA6'), 'saldo bancario deve ficar separado');
assert(systemPrompt.includes('Fluxo de caixa projetado'), 'prompt deve preservar fluxo projetado');

assert.deepStrictEqual(
  financeiroSpec._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'desconhecido' }, { carteira: 'receber' }),
  [['cliente'], ['vendedor', 'natureza']],
  'receber deve priorizar cliente',
);
assert.deepStrictEqual(
  financeiroSpec._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'desconhecido' }, { carteira: 'pagar' }),
  [['fornecedor'], ['natureza']],
  'pagar deve priorizar fornecedor',
);
assert.deepStrictEqual(
  financeiroSpec._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'cliente' }, { carteira: 'pagar' }),
  [['cliente']],
  'tipo explicitamente informado deve ser respeitado',
);

const sx2 = { SE1990: 'E', SE2990: 'E', SA1990: 'C', SA2990: 'C', SE8990: 'E', SA6990: 'E', SED990: 'E' };
const sqlSaldoPagar = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE2.E2_SALDO),0) AS saldo_a_pagar
FROM SE2990 SE2
WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SE2.E2_TIPO <> 'PA'
`;
const validacaoSaldo = runner._test.validarSqlIaOwnerBasico(sqlSaldoPagar, financeiroSpec, sx2);
assert.strictEqual(validacaoSaldo.ok, true, `saldo a pagar nao deveria ser rejeitado: ${validacaoSaldo.erros.join(' | ')}`);

const sqlFornecedorJ2A = "SET ROWCOUNT 50000; SELECT SUM(SE2.E2_SALDO) FROM SE2990 SE2 JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SA2.A2_COD = '000123' AND SA2.A2_LOJA = '01'";
const canonicoParam = entitySqlGuard.parametrizarSqlEntidadesResolvidas(
  sqlFornecedorJ2A,
  [{ tipo: 'fornecedor', codigo: '000123', loja: '01' }],
  financeiroCatalog.DEFINICOES,
);
assert(canonicoParam.alterou, 'sql canonico com entidade deve parametrizar codigo/loja');
assert(canonicoParam.sql.includes("SA2.A2_COD = '{{iac:fornecedor:codigo}}'"), 'deve criar placeholder de codigo');

const sqlCanonicoJ2A = "SET ROWCOUNT 50000; SELECT SUM(SE2.E2_SALDO) AS saldo_a_pagar FROM SE2990 SE2 INNER JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SA2.D_E_L_E_T_ = ' '";
const sqlAdaptadoC3I = sx2Normalizer.adaptarSqlCanonicoPorSX2(sqlCanonicoJ2A, { SE2020: 'E', SA2020: 'C' });
assert(sqlAdaptadoC3I.includes('FROM SE2020 SE2'), 'sql canonico deve adaptar SE2 para empresa alvo');
assert(sqlAdaptadoC3I.includes('JOIN SA2020 SA2'), 'sql canonico deve adaptar SA2 para empresa alvo');

const sqlEmpresaComoFornecedorOuFilialFinanceiro = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE2.E2_SALDO), 0) AS saldo
FROM SE2990 SE2
INNER JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '
WHERE SE2.D_E_L_E_T_ = ' '
  AND SE2.E2_VENCTO BETWEEN '20260101' AND '20261231'
  AND SE2.E2_FILIAL = '01'
  AND SA2.A2_CGC IN ('C3I', 'J2A')
GROUP BY SA2.A2_CGC;
`;
const sqlFinanceiroSemEmpresaComoFiltro = financeiroSpec._test.removerFiltrosEmpresaComoEntidade(sqlEmpresaComoFornecedorOuFilialFinanceiro, {
  empresaMencionadaTexto: 'C3I | J2A',
  empresasMencionadasTextos: ['C3I', 'J2A'],
}, {
  campos: ['SE2.E2_FILIAL', 'SA2.A2_CGC'],
});
assert(!/E2_FILIAL\s*=\s*'01'/i.test(sqlFinanceiroSemEmpresaComoFiltro), 'financeiro nao deve manter filial padrao quando pedido foi empresa');
assert(!/A2_CGC\s+IN\s*\(/i.test(sqlFinanceiroSemEmpresaComoFiltro), 'financeiro nao deve filtrar empresa por CGC de fornecedor');
assert(/E2_VENCTO BETWEEN '20260101' AND '20261231'/i.test(sqlFinanceiroSemEmpresaComoFiltro), 'financeiro deve preservar periodo');

console.log('financeiro-sql-contrato.test.js: ok (ia-owner)');
