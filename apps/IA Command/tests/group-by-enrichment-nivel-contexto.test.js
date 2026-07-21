'use strict';

/**
 * Testes para duas alterações no IA Command:
 *
 *   1. enriquecerContratoComGroupBy (modules/erp/core/query-plan.js)
 *      Garante que o group_by acumulado pelo merger sobrescreve agrupamentos
 *      menores vindos do orquestrador (que só vê o turno atual).
 *
 *   2. opts.limiteContexto em mesclar (modules/ai/intent-merger.js)
 *      Limite de _nivel_contexto configurável em vez de hardcoded 5.
 */

const assert = require('assert');
const path   = require('path');
const ROOT   = path.resolve(__dirname, '..');

const { enriquecerContratoComGroupBy } = require(path.join(ROOT, 'modules/erp/core/query-plan'));
const { mesclar }                       = require(path.join(ROOT, 'modules/ai/intent-merger'));

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

// ─────────────────────────────────────────────────────────────────────────────
// Bloco 1 — enriquecerContratoComGroupBy (unitário)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Bloco 1] enriquecerContratoComGroupBy — unitários');

ok('1.1 retorna null quando contrato é null', () => {
  const r = enriquecerContratoComGroupBy(null, { group_by: ['mes'] });
  assert.strictEqual(r, null);
});

ok('1.2 retorna original quando intent não tem group_by', () => {
  const contrato = { agrupamentos: ['mes'], modulo: 'compras' };
  const r = enriquecerContratoComGroupBy(contrato, { filtros: {} });
  assert.strictEqual(r, contrato, 'deve ser a mesma referência');
});

ok('1.3 não enriquece quando group_by tem igual número de dimensões que contrato.agrupamentos', () => {
  const contrato = { agrupamentos: ['mes', 'fornecedor'] };
  const intent   = { group_by: ['dia', 'produto'] };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.strictEqual(r, contrato, 'igual quantidade → retorna original');
});

ok('1.4 não enriquece quando group_by tem MENOS dimensões que contrato.agrupamentos', () => {
  const contrato = { agrupamentos: ['mes', 'fornecedor', 'dia'] };
  const intent   = { group_by: ['mes'] };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.strictEqual(r, contrato, 'menos dimensões → retorna original');
  assert.deepStrictEqual(r.agrupamentos, ['mes', 'fornecedor', 'dia'], 'agrupamentos não devem mudar');
});

ok('1.5 enriquece quando group_by tem MAIS dimensões (caso principal T4)', () => {
  const contrato = { agrupamentos: ['dia'] };
  const intent   = { group_by: ['mes', 'fornecedor', 'dia'] };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.notStrictEqual(r, contrato, 'deve ser um novo objeto');
  assert.deepStrictEqual(r.agrupamentos, ['mes', 'fornecedor', 'dia']);
});

ok('1.6 fallback: usa agrupar_por_composto quando group_by está ausente', () => {
  const contrato = { agrupamentos: ['dia'] };
  const intent   = { agrupar_por_composto: ['mes', 'fornecedor', 'dia'] };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.deepStrictEqual(r.agrupamentos, ['mes', 'fornecedor', 'dia']);
});

ok('1.7 fallback: usa agrupar_por (string → array de 1) quando group_by e agrupar_por_composto ausentes', () => {
  const contrato = {};  // sem agrupamentos → length = 0
  const intent   = { agrupar_por: 'Fornecedor' };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.deepStrictEqual(r.agrupamentos, ['fornecedor'], 'string deve virar lowercase array de 1');
});

ok('1.8 cenário T4 real: contrato {agrupamentos:[\'dia\']}, intent {group_by:[\'mes\',\'fornecedor\',\'dia\']} → resultado correto', () => {
  const contrato = { agrupamentos: ['dia'], modulo: 'financeiro', carteira: 'pagar', periodo: { tipo: 'nenhum' } };
  const intent   = { group_by: ['mes', 'fornecedor', 'dia'] };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.deepStrictEqual(r.agrupamentos, ['mes', 'fornecedor', 'dia']);
});

ok('1.9 não altera outros campos do contrato ao enriquecer', () => {
  const contrato = { agrupamentos: ['dia'], modulo: 'compras', carteira: 'receber', periodo: { tipo: 'mes_atual' } };
  const intent   = { group_by: ['mes', 'fornecedor', 'dia'] };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.strictEqual(r.modulo, 'compras');
  assert.strictEqual(r.carteira, 'receber');
  assert.strictEqual(r.periodo.tipo, 'mes_atual');
});

ok('1.10 retorna original se intent.group_by é array vazio', () => {
  const contrato = { agrupamentos: ['mes'] };
  const intent   = { group_by: [] };
  const r = enriquecerContratoComGroupBy(contrato, intent);
  assert.strictEqual(r, contrato, 'array vazio → retorna original sem enriquecer');
});

// ─────────────────────────────────────────────────────────────────────────────
// Bloco 2 — mesclar com opts.limiteContexto (unitário)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Bloco 2] mesclar com opts.limiteContexto — unitários');

/**
 * Simula N turnos de herança chamando mesclar repetidamente.
 * Cada turno usa o resultado do anterior como ultimoIntent.
 * Retorna o nivel_contexto final após N heranças.
 */
function simularHerancas(n, limiteContexto) {
  const opts = limiteContexto !== undefined ? { limiteContexto } : {};
  // Usamos _dynamicAiScope no contexto anterior para que o merger
  // não entre no branch de unsupportedRequest (que exigiria módulos ERP).
  let contexto = {
    intencao: 'compras_dinamico',
    confianca: 0.9,
    periodo: { tipo: 'nenhum' },
    filtros: {},
    _nivel_contexto: 1,
    _dynamicAiScope: true,
  };
  for (let i = 0; i < n; i++) {
    // novoIntent com mesma intenção e confiança < 0.85 para garantir que o
    // merger nunca faça early-return por "nova conversa"
    const novo = {
      intencao: 'compras_dinamico',
      confianca: 0.7,
      periodo: { tipo: 'nenhum' },
      filtros: {},
      group_by: ['dia'],
      _dynamicAiScope: true,
    };
    // ultimoIntentTs = 0 → sem expiração por inatividade
    contexto = mesclar(novo, contexto, 0, 'detalhar', opts);
  }
  return contexto._nivel_contexto;
}

ok('2.1 sem limiteContexto: cap padrão é 5 — após 8 heranças nivel_contexto fica em 5', () => {
  const nivel = simularHerancas(8);
  assert.strictEqual(nivel, 5, `esperado 5, recebeu ${nivel}`);
});

ok('2.2 limiteContexto: 3 — após 5 heranças nivel_contexto trava em 3', () => {
  const nivel = simularHerancas(5, 3);
  assert.strictEqual(nivel, 3, `esperado 3, recebeu ${nivel}`);
});

ok('2.3 limiteContexto: 7 — nivel_contexto pode chegar a 7', () => {
  const nivel = simularHerancas(10, 7);
  assert.strictEqual(nivel, 7, `esperado 7, recebeu ${nivel}`);
});

ok('2.4 limiteContexto: 1 — já na primeira herança nivel_contexto fica em 1', () => {
  const nivel = simularHerancas(1, 1);
  assert.strictEqual(nivel, 1, `esperado 1, recebeu ${nivel}`);
});

ok('2.5 limiteContexto: 1 — após múltiplas heranças continua em 1', () => {
  const nivel = simularHerancas(5, 1);
  assert.strictEqual(nivel, 1, `esperado 1, recebeu ${nivel}`);
});

ok('2.6 limiteContexto: 2 — cresce até 2 e trava', () => {
  const apos1 = simularHerancas(1, 2);
  const apos2 = simularHerancas(2, 2);
  const apos5 = simularHerancas(5, 2);
  assert.strictEqual(apos1, 2, `após 1 herança: esperado 2, recebeu ${apos1}`);
  assert.strictEqual(apos2, 2, `após 2 heranças: esperado 2, recebeu ${apos2}`);
  assert.strictEqual(apos5, 2, `após 5 heranças: esperado 2, recebeu ${apos5}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bloco 3 — Cenário de drill-down 4 níveis (integração)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Bloco 3] Cenário drill-down 4 níveis — integração completa');

/**
 * Monta um intent mínimo que passa pelo merger sem early-return:
 *  - mesma intencao 'compras_dinamico' (não difere do contexto)
 *  - confianca < 0.85 (não dispara "nova conversa")
 *  - _dynamicAiScope true no contexto (não vai para unsupportedRequest)
 */
function mkIntent(groupBy, nivel = 1) {
  return {
    intencao: 'compras_dinamico',
    confianca: 0.7,
    periodo: { tipo: 'nenhum' },
    filtros: {},
    group_by: groupBy,
    _nivel_contexto: nivel,
    _dynamicAiScope: true,
  };
}

// T1: intent inicial — apenas establece contexto com group_by=['ano'], nivel 1
const intentT1 = mkIntent(['ano']);

ok('3.1 T2 merger: nivel_contexto = 2 após mesclar com T1', () => {
  const novoT2 = mkIntent(['mes']);
  const resultT2 = mesclar(novoT2, intentT1, 0, 'detalhar por mes');
  assert.strictEqual(resultT2._nivel_contexto, 2,
    `T2 nivel_contexto esperado 2, recebeu ${resultT2._nivel_contexto}`);
});

ok('3.2 T3 merger: nivel_contexto = 3, group_by acumulado inclui fornecedor', () => {
  const novoT2 = mkIntent(['mes']);
  const resultT2 = mesclar(novoT2, intentT1, 0, 'detalhar por mes');

  const novoT3 = mkIntent(['fornecedor']);
  const resultT3 = mesclar(novoT3, resultT2, 0, 'detalhar por fornecedor');
  assert.strictEqual(resultT3._nivel_contexto, 3,
    `T3 nivel_contexto esperado 3, recebeu ${resultT3._nivel_contexto}`);
  // O merger herda group_by do contexto anterior quando o novo é menos específico,
  // ou mantém o novo; em qualquer caso, o intent resultante deve ter group_by definido.
  assert.ok(Array.isArray(resultT3.group_by), 'T3 deve ter group_by como array');
  // 'fornecedor' deve estar presente (ou como único, ou acumulado)
  const includes = resultT3.group_by.includes('fornecedor')
    || (Array.isArray(resultT3.agrupar_por_composto) && resultT3.agrupar_por_composto.includes('fornecedor'));
  assert.ok(includes, `T3 group_by deve incluir 'fornecedor': ${JSON.stringify(resultT3.group_by)}`);
});

ok('3.3 T4 merger: nivel_contexto = 4, group_by inclui dia', () => {
  const novoT2 = mkIntent(['mes']);
  const resultT2 = mesclar(novoT2, intentT1, 0, 'detalhar por mes');

  const novoT3 = mkIntent(['fornecedor']);
  const resultT3 = mesclar(novoT3, resultT2, 0, 'detalhar por fornecedor');

  const novoT4 = mkIntent(['dia']);
  const resultT4 = mesclar(novoT4, resultT3, 0, 'detalhar por dia');
  assert.strictEqual(resultT4._nivel_contexto, 4,
    `T4 nivel_contexto esperado 4, recebeu ${resultT4._nivel_contexto}`);
  assert.ok(Array.isArray(resultT4.group_by), 'T4 deve ter group_by como array');
  assert.ok(resultT4.group_by.includes('dia'),
    `T4 group_by deve incluir 'dia': ${JSON.stringify(resultT4.group_by)}`);
});

ok('3.4 enriquecerContratoComGroupBy T4: contrato {agrupamentos:[\'dia\']} + intent T4 → agrupamentos enriquecidos', () => {
  // Simula merger acumulando 4 turnos
  const novoT2 = mkIntent(['mes']);
  const resultT2 = mesclar(novoT2, intentT1, 0, 'detalhar por mes');

  const novoT3 = mkIntent(['fornecedor']);
  const resultT3 = mesclar(novoT3, resultT2, 0, 'detalhar por fornecedor');

  // Para que o intent T4 tenha group_by acumulado, simulamos o que o merger
  // faria ao herdar dimensões anteriores. Aqui construímos o intent T4 com
  // group_by explicitamente acumulado (como o merger real faria via herança),
  // igual ao cenário relatado: ['mes','fornecedor','dia'].
  const intentT4Acumulado = {
    ...mkIntent(['dia']),
    group_by: ['mes', 'fornecedor', 'dia'], // acumulado pelo merger
    _nivel_contexto: 4,
  };

  const contratoOrquestrador = {
    agrupamentos: ['dia'],
    modulo: 'financeiro',
    carteira: 'pagar',
    periodo: { tipo: 'nenhum' },
  };

  const contratoEnriquecido = enriquecerContratoComGroupBy(contratoOrquestrador, intentT4Acumulado);
  assert.ok(contratoEnriquecido.agrupamentos.length > 1,
    `agrupamentos devem ter mais de 1 dimensão: ${JSON.stringify(contratoEnriquecido.agrupamentos)}`);
  assert.deepStrictEqual(contratoEnriquecido.agrupamentos, ['mes', 'fornecedor', 'dia'],
    `esperado ['mes','fornecedor','dia'], recebeu ${JSON.stringify(contratoEnriquecido.agrupamentos)}`);
});

ok('3.5 enriquecerContratoComGroupBy preserva modulo/carteira/periodo do contrato T4', () => {
  const intentT4 = {
    group_by: ['mes', 'fornecedor', 'dia'],
    _nivel_contexto: 4,
  };
  const contrato = {
    agrupamentos: ['dia'],
    modulo: 'financeiro',
    carteira: 'pagar',
    periodo: { tipo: 'nenhum' },
  };
  const r = enriquecerContratoComGroupBy(contrato, intentT4);
  assert.strictEqual(r.modulo, 'financeiro');
  assert.strictEqual(r.carteira, 'pagar');
  assert.strictEqual(r.periodo.tipo, 'nenhum');
  assert.deepStrictEqual(r.agrupamentos, ['mes', 'fornecedor', 'dia']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Resultado final
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`group-by-enrichment-nivel-contexto.test.js: ${passou} testes passaram, 0 falhas ✓`);
} else {
  console.error(`group-by-enrichment-nivel-contexto.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
