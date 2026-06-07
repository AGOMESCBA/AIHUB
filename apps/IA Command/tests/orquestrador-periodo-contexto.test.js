'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const orchestrator = require(path.join(ROOT, 'modules/ai/orchestrator-service'));

const normalizado = orchestrator.normalizarContrato({
  modulo: 'faturamento',
  periodo: { tipo: 'mes', dataInicio: '2023-05-01', dataFim: '2023-05-31' },
  filtros: {},
  agrupamentos: ['cliente'],
  herdou_contexto: true,
  contexto_usado: {
    modulo: 'faturamento',
    periodo: { tipo: 'ano', dataInicio: '2026-01-01', dataFim: '2026-12-31' },
  },
  confianca: 1,
  precisa_confirmacao: false,
  justificativa: 'Detalhar maio por cliente.',
}, {
  mensagem: 'Detalhe o mes de maio por cliente',
  intencoes: [{ nome: 'faturamento_dinamico', modulo: 'faturamento', acao: 'ai_text_to_sql' }],
});

assert.strictEqual(normalizado.ok, true, 'contrato deve normalizar');
assert.strictEqual(normalizado.contrato.periodo.dataInicio, '20260501', 'maio sem ano deve herdar ano do contexto');
assert.strictEqual(normalizado.contrato.periodo.dataFim, '20260531', 'fim de maio deve herdar ano do contexto');
assert.deepStrictEqual(normalizado.contrato.agrupamentos, ['cliente'], 'agrupamento por cliente deve permanecer decisao da IA');

const anoAtual = orchestrator.normalizarContrato({
  modulo: 'faturamento',
  periodo: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
  filtros: {},
  agrupamentos: null,
  herdou_contexto: false,
  contexto_usado: null,
  confianca: 1,
  precisa_confirmacao: false,
  justificativa: 'Faturamento do ano.',
}, {
  mensagem: 'Faturamento do ano',
  hoje: new Date('2026-05-24T12:00:00'),
  intencoes: [{ nome: 'faturamento_dinamico', modulo: 'faturamento', acao: 'ai_text_to_sql' }],
});

assert.strictEqual(anoAtual.ok, true, 'contrato de ano deve normalizar');
assert.strictEqual(anoAtual.contrato.periodo.dataInicio, '20260101', 'ano sem ano explicito deve ser ano atual');
assert.strictEqual(anoAtual.contrato.periodo.dataFim, '20261231', 'fim do ano sem ano explicito deve ser ano atual');
assert(!/2023/.test(anoAtual.contrato.justificativa), 'justificativa nao deve preservar ano contraditorio da IA');

const mesAtual = orchestrator.normalizarContrato({
  modulo: 'faturamento',
  periodo: { tipo: 'mes', dataInicio: '20230101', dataFim: '20230131' },
  filtros: {},
  agrupamentos: null,
  herdou_contexto: false,
  contexto_usado: null,
  confianca: 1,
  precisa_confirmacao: false,
  justificativa: 'Faturamento do mes.',
}, {
  mensagem: 'Faturamento do mes',
  hoje: new Date('2026-05-24T12:00:00'),
  intencoes: [{ nome: 'faturamento_dinamico', modulo: 'faturamento', acao: 'ai_text_to_sql' }],
});

assert.strictEqual(mesAtual.ok, true, 'contrato de mes deve normalizar');
assert.strictEqual(mesAtual.contrato.periodo.dataInicio, '20260501', 'mes sem mes/ano explicito deve ser mes atual');
assert.strictEqual(mesAtual.contrato.periodo.dataFim, '20260531', 'fim do mes sem mes/ano explicito deve ser mes atual');

const maioDesteAno = orchestrator.normalizarContrato({
  modulo: 'faturamento',
  periodo: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
  filtros: {},
  agrupamentos: null,
  herdou_contexto: false,
  contexto_usado: null,
  confianca: 1,
  precisa_confirmacao: false,
  justificativa: 'Faturamento somente de maio deste ano.',
}, {
  mensagem: 'Faturamento somente de maio deste ano',
  hoje: new Date('2026-05-24T12:00:00'),
  intencoes: [{ nome: 'faturamento_dinamico', modulo: 'faturamento', acao: 'ai_text_to_sql' }],
});

assert.strictEqual(maioDesteAno.ok, true, 'contrato de maio deste ano deve normalizar');
assert.strictEqual(maioDesteAno.contrato.periodo.dataInicio, '20260501', 'maio deste ano deve ser maio do ano atual');
assert.strictEqual(maioDesteAno.contrato.periodo.dataFim, '20260531', 'fim de maio deste ano deve usar ano atual');

for (const modulo of ['compras', 'comissao']) {
  const atual = orchestrator.normalizarContrato({
    modulo,
    periodo: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
    filtros: {},
    agrupamentos: null,
    herdou_contexto: false,
    contexto_usado: null,
    confianca: 1,
    precisa_confirmacao: false,
    justificativa: `${modulo} do ano.`,
  }, {
    mensagem: `${modulo} do ano`,
    hoje: new Date('2026-05-24T12:00:00'),
    intencoes: [{ nome: `${modulo}_dinamico`, modulo, acao: 'ai_text_to_sql' }],
  });

  assert.strictEqual(atual.ok, true, `${modulo} deve normalizar`);
  assert.strictEqual(atual.contrato.periodo.dataInicio, '20260101', `${modulo}: ano sem ano explicito deve ser ano atual`);
  assert.strictEqual(atual.contrato.periodo.dataFim, '20261231', `${modulo}: fim do ano sem ano explicito deve ser ano atual`);
  assert(!/2023/.test(atual.contrato.justificativa), `${modulo}: justificativa nao deve preservar ano contraditorio da IA`);
}

const comprasSoftexpert = orchestrator.normalizarContrato({
  modulo: 'compras',
  periodo: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
  filtros: {},
  agrupamentos: null,
  herdou_contexto: false,
  contexto_usado: null,
  confianca: 1,
  precisa_confirmacao: false,
  justificativa: 'A pergunta solicita compras do ano da Softexpert, com periodo definido como o ano de 2023.',
}, {
  mensagem: 'Compras do ano da Softexpert',
  hoje: new Date('2026-05-24T12:00:00'),
  intencoes: [{ nome: 'compras_dinamico', modulo: 'compras', acao: 'ai_text_to_sql' }],
});

assert.strictEqual(comprasSoftexpert.ok, true, 'compras da Softexpert deve normalizar');
assert.strictEqual(comprasSoftexpert.contrato.periodo.dataInicio, '20260101', 'Compras do ano da Softexpert deve usar ano atual');
assert.strictEqual(comprasSoftexpert.contrato.periodo.dataFim, '20261231', 'Compras do ano da Softexpert deve fechar no ano atual');
assert(!/2023/.test(comprasSoftexpert.contrato.justificativa), 'Compras do ano da Softexpert nao pode carregar 2023 na justificativa');

const refinamentoFornecedorFinanceiro = orchestrator.normalizarContrato({
  modulo: 'compras',
  periodo: { tipo: 'nenhum' },
  filtros: { fornecedor: 'SOFTEXPERT' },
  agrupamentos: null,
  herdou_contexto: false,
  contexto_usado: null,
  confianca: 1,
  precisa_confirmacao: false,
  justificativa: 'Fornecedor indica compras.',
}, {
  mensagem: 'Detalhe o fornecedor SOFTEXPERT',
  intencoes: [
    { nome: 'compras_dinamico', modulo: 'compras', acao: 'ai_text_to_sql' },
    { nome: 'financeiro_dinamico', modulo: 'financeiro', acao: 'ai_text_to_sql' },
  ],
  historicoResumido: [{
    contrato_orquestrador: {
      modulo: 'financeiro',
      periodo: { tipo: 'ano', dataInicio: '20260101', dataFim: '20261231' },
      carteira: 'pagar',
      operacao: 'posicao',
      estado: 'em_aberto',
      agrupamentos: ['mes'],
    },
  }],
});

assert.strictEqual(refinamentoFornecedorFinanceiro.ok, true, 'refinamento fornecedor deve normalizar');
assert.strictEqual(refinamentoFornecedorFinanceiro.contrato.modulo, 'financeiro', 'refinamento de fornecedor deve preservar financeiro quando contexto e contas a pagar');
assert.strictEqual(refinamentoFornecedorFinanceiro.contrato.carteira, 'pagar', 'deve preservar carteira pagar');
assert.deepStrictEqual(refinamentoFornecedorFinanceiro.contrato.agrupamentos, ['mes', 'fornecedor'], 'deve acumular agrupamentos hierárquicos: mes do contexto + fornecedor do refinamento');

console.log('orquestrador-periodo-contexto.test.js: ok');
