'use strict';

/**
 * Testes para carteira='ambas' no módulo financeiro.
 *
 * Cobre dois bugs corrigidos:
 *   1. query_plan_texto deve orientar valor_recebido + valor_pago
 *      quando carteira='ambas' e estado=recebido/pago, sem impor uma única forma SQL.
 *   2. _extrairLabelIntencao deve retornar label correto para "contas recebidas e pagas",
 *      "contas recebidas" e "contas pagas" isoladas — evita que o formatter invente título.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const queryPlan = require(path.join(ROOT, 'modules/erp/core/query-plan'));
const runner    = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const financeiroSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec'));

const { _extrairLabelIntencao, _buildContextoConsulta, _buildContextoFormatacao, construirQueryPlanTecnico } = runner._test;

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

// ─── 1. query_plan_texto — carteira='ambas', estado realizado ─────────────────

console.log('\n[1] query_plan_texto: carteira=ambas + estado recebido/pago');

const periodoJun = { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' };

const planoAmbas = construirQueryPlanTecnico({
  spec: financeiroSpec,
  mensagem: 'contas recebidas e pagas no mês',
  periodo: periodoJun,
  filtros: {},
  entidades: [],
});

ok('plano detecta carteira=ambas', () => {
  assert.strictEqual(planoAmbas.carteira, 'ambas', `carteira deve ser ambas, obteve: ${planoAmbas.carteira}`);
});

ok('plano detecta estado recebido/realizado', () => {
  assert.ok(
    ['recebido', 'pago', 'realizado'].includes(planoAmbas.estado),
    `estado deve ser recebido/pago/realizado, obteve: ${planoAmbas.estado}`,
  );
});

const textoPlanoAmbas = queryPlan.formatQueryPlanForPrompt(planoAmbas);

ok('query_plan orienta realizadas de ambas as carteiras', () => {
  assert.ok(
    textoPlanoAmbas.includes('financeiro_ambas_realizado'),
    'deve conter instrucao financeiro_ambas_realizado',
  );
});

ok('query_plan nao impoe forma unica para ambas realizado', () => {
  assert.ok(
    !textoPlanoAmbas.includes('PROIBIDO gerar dois SELECTs separados'),
    'nao deve proibir dois SELECTs separados por preferencia de formato',
  );
});

ok('query_plan nao proibe UNION ALL por si so para ambas realizado', () => {
  assert.ok(
    textoPlanoAmbas.includes('UNION ALL') && !/PROIBIDO[^\n]*UNION ALL/i.test(textoPlanoAmbas),
    'UNION ALL pode ser citado como alternativa valida, nao como proibicao',
  );
});

ok('query_plan aceita subqueries escalares como alternativa', () => {
  assert.ok(
    textoPlanoAmbas.includes('Subqueries escalares'),
    'deve citar subqueries escalares como alternativa valida',
  );
});

ok('query_plan menciona valor_recebido e valor_pago como colunas', () => {
  assert.ok(
    textoPlanoAmbas.includes('valor_recebido') && textoPlanoAmbas.includes('valor_pago'),
    'deve mencionar as duas colunas de saida',
  );
});

// ─── 2. query_plan_texto — carteira='ambas', estado em_aberto (posição) ───────

console.log('\n[2] query_plan_texto: carteira=ambas + estado em_aberto (nao afetado)');

const planoAmbasAberto = construirQueryPlanTecnico({
  spec: financeiroSpec,
  mensagem: 'contas a pagar e a receber em aberto',
  periodo: { tipo: 'nenhum' },
  filtros: {},
  entidades: [],
});

const textoPlanoAberto = queryPlan.formatQueryPlanForPrompt(planoAmbasAberto);

ok('em_aberto nao usa financeiro_ambas_realizado', () => {
  assert.ok(
    !textoPlanoAberto.includes('financeiro_ambas_realizado'),
    'plano em_aberto nao deve conter instrucao de realizado',
  );
});

ok('em_aberto usa instrucao generica financeiro_ambas', () => {
  assert.ok(
    textoPlanoAberto.includes('financeiro_ambas'),
    'plano em_aberto deve ter instrucao financeiro_ambas generica',
  );
});

// ─── 3. _extrairLabelIntencao — labels de financeiro ─────────────────────────

console.log('\n[3] _extrairLabelIntencao: labels de carteira financeiro');

const casos = [
  // Ambas as carteiras
  { msg: 'contas recebidas e pagas no mês',          esperado: 'Contas recebidas e pagas' },
  { msg: 'contas pagas e recebidas em junho',        esperado: 'Contas recebidas e pagas' },
  { msg: 'recebido e pago no periodo',               esperado: 'Contas recebidas e pagas' },
  { msg: 'pago e recebido em junho de 2026',         esperado: 'Contas recebidas e pagas' },
  { msg: 'quanto recebemos e pagamos no mês',        esperado: 'Contas recebidas e pagas' },
  // Apenas receber
  { msg: 'contas recebidas no mês',                  esperado: 'Contas recebidas' },
  { msg: 'contas a receber recebidas em junho',      esperado: 'Contas recebidas' },
  { msg: 'valor recebido no periodo',                esperado: 'Contas recebidas' },
  // Apenas pagar
  { msg: 'contas pagas no mês',                      esperado: 'Contas pagas' },
  { msg: 'contas a pagar pagas em junho',            esperado: 'Contas pagas' },
  { msg: 'valor pago no periodo',                    esperado: 'Contas pagas' },
  // Não deve afetar outros labels
  { msg: 'faturamento médio mensal de 2026',         esperado: 'Média' },
  { msg: 'top 5 clientes',                           esperado: 'Top 5' },
  { msg: 'saldo bancário atual',                     esperado: null },
];

for (const { msg, esperado } of casos) {
  ok(`"${msg}" → "${esperado}"`, () => {
    const label = _extrairLabelIntencao(msg);
    assert.strictEqual(label, esperado, `obteve: "${label}"`);
  });
}

// ─── 4. _buildContextoConsulta — inclui label no contexto ────────────────────

console.log('\n[4] _buildContextoConsulta: label aparece no contextoConsulta');

const intentAmbas = {
  _entidadesResolvidas: [],
  filtros: {},
  periodo: periodoJun,
};

ok('contextoConsulta inclui label "Contas recebidas e pagas"', () => {
  const ctx = _buildContextoConsulta(intentAmbas, periodoJun, 'contas recebidas e pagas no mês');
  assert.ok(ctx && ctx.includes('Contas recebidas e pagas'), `contextoConsulta deve incluir label, obteve: "${ctx}"`);
});

ok('contextoConsulta inclui periodo Jun/2026', () => {
  const ctx = _buildContextoConsulta(intentAmbas, periodoJun, 'contas recebidas e pagas no mês');
  assert.ok(ctx && ctx.includes('Jun'), `contextoConsulta deve incluir mes, obteve: "${ctx}"`);
});

ok('contextoConsulta para receber isolado inclui "Contas recebidas"', () => {
  const ctx = _buildContextoConsulta(intentAmbas, periodoJun, 'contas recebidas no mês');
  assert.ok(ctx && ctx.includes('Contas recebidas'), `obteve: "${ctx}"`);
});

ok('contextoConsulta para pagar isolado inclui "Contas pagas"', () => {
  const ctx = _buildContextoConsulta(intentAmbas, periodoJun, 'contas pagas no mês');
  assert.ok(ctx && ctx.includes('Contas pagas'), `obteve: "${ctx}"`);
});

// ─── Resultado ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
ok('contextoFormatacao usa sempre a pergunta original quando informada', () => {
  const pergunta = 'Contas a pagar dos proximos 10 dias';
  const ctx = _buildContextoFormatacao(pergunta, 'Jun a Jun/2026');
  assert.strictEqual(ctx, pergunta);
});

ok('contextoFormatacao preserva fallback quando pergunta nao existe', () => {
  const ctx = _buildContextoFormatacao('', 'Jun a Jun/2026');
  assert.strictEqual(ctx, 'Jun a Jun/2026');
});

if (falhou === 0) {
  console.log(`financeiro-ambas-carteiras.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`financeiro-ambas-carteiras.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
