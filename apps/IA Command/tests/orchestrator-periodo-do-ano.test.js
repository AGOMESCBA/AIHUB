'use strict';

/**
 * Bug real confirmado em producao (08/09/2026, empresa CAIEIRA): "Analise horizontal das
 * vendas do ano por mes" (e variantes com "do ano"/"por mes") retornava faturamento sem
 * indice-base nem crescimento % — o periodo era zerado para {tipo:'nenhum'} antes de chegar
 * ao gerador de SQL, mesmo a pergunta ja indicando claramente o periodo ("do ano").
 * Causa raiz, em orchestrator-service.js:
 *   1. _temDataExplicita nao reconhecia "do ano"/"deste ano"/"no ano" como referencia
 *      temporal explicita, entao _corrigirPeriodoAgrupamento zerava o periodo sempre que a
 *      frase tinha "por mes"/"por ano" sem essas palavras.
 *   2. _normalizarPeriodo assumia data sempre em YYYYMMDD/YYYY-MM-DD; quando a IA respondia
 *      em formato brasileiro (DD/MM/YYYY), a limpeza ingenua de separadores invertia dia e
 *      ano (ex: "01/01/2026" virava "01012026" em vez de "20260101").
 * Este teste fixa os dois comportamentos para nao regredir.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const orchestrator = require(path.join(ROOT, 'modules/ai/orchestrator-service'));
const { _temDataExplicita, _corrigirPeriodoAgrupamento, _normalizarPeriodo, _normalizarDataPeriodo } = orchestrator._test;

function ok(nome, fn) {
  try {
    fn();
    console.log(`  [OK] ${nome}`);
  } catch (e) {
    console.error(`  [FALHOU] ${nome}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('\n[1] _temDataExplicita reconhece "do ano" como referencia temporal explicita');

ok('"do ano" e reconhecido', () => {
  assert.strictEqual(_temDataExplicita('Analise horizontal das vendas do ano'), true);
});

ok('"do ano por mes" e reconhecido', () => {
  assert.strictEqual(_temDataExplicita('Faturamento do ano por mes'), true);
});

ok('"deste ano" e reconhecido', () => {
  assert.strictEqual(_temDataExplicita('Vendas deste ano por mes'), true);
});

ok('"no ano" e reconhecido', () => {
  assert.strictEqual(_temDataExplicita('Compras no ano por mes'), true);
});

ok('"por mes" sozinho (sem ano) continua NAO reconhecido — comportamento original preservado', () => {
  assert.strictEqual(_temDataExplicita('Faturamento por mes'), false);
});

ok('ano numerico continua reconhecido (regressao)', () => {
  assert.strictEqual(_temDataExplicita('Vendas de 2025'), true);
});

ok('mes por extenso continua reconhecido (regressao)', () => {
  assert.strictEqual(_temDataExplicita('Vendas de janeiro'), true);
});

console.log('\n[2] _corrigirPeriodoAgrupamento nao zera periodo quando ha "do ano"');

ok('"do ano por mes": periodo preservado, agrupamento "mes" adicionado', () => {
  const periodoIA = { tipo: 'ano', dataInicio: '20260101', dataFim: '20261231' };
  const r = _corrigirPeriodoAgrupamento({ periodo: periodoIA, agrupamentos: [], mensagem: 'Analise horizontal das vendas do ano por mes' });
  assert.strictEqual(r.periodo.tipo, 'ano');
  assert.strictEqual(r.periodo.dataInicio, '20260101');
  assert.strictEqual(r.periodo.dataFim, '20261231');
  assert.ok(r.agrupamentos.includes('mes'), `esperava 'mes' em agrupamentos, obteve: ${JSON.stringify(r.agrupamentos)}`);
});

ok('"por mes" sozinho (sem ancora de data): continua zerando periodo — comportamento original preservado', () => {
  const r = _corrigirPeriodoAgrupamento({ periodo: { tipo: 'mes' }, agrupamentos: [], mensagem: 'Faturamento por mes' });
  assert.strictEqual(r.periodo.tipo, 'nenhum');
  assert.ok(r.agrupamentos.includes('mes'));
});

console.log('\n[3] _normalizarDataPeriodo corrige formato brasileiro DD/MM/YYYY');

ok('DD/MM/YYYY convertido corretamente (dia != mes, para nao mascarar troca)', () => {
  assert.strictEqual(_normalizarDataPeriodo('09/01/2026'), '20260109');
});

ok('data de fim de ano DD/MM/YYYY', () => {
  assert.strictEqual(_normalizarDataPeriodo('31/12/2026'), '20261231');
});

ok('DD-MM-YYYY (hifen) tambem convertido', () => {
  assert.strictEqual(_normalizarDataPeriodo('05-03-2026'), '20260305');
});

ok('formato ja YYYY-MM-DD preservado (regressao)', () => {
  assert.strictEqual(_normalizarDataPeriodo('2026-01-09'), '20260109');
});

ok('formato ja YYYYMMDD preservado (regressao)', () => {
  assert.strictEqual(_normalizarDataPeriodo('20260109'), '20260109');
});

console.log('\n[4] _normalizarPeriodo (integracao dos dois pontos acima)');

ok('periodo com datas em formato BR normalizado corretamente, sem inverter dia/ano', () => {
  const r = _normalizarPeriodo({ tipo: 'ano', dataInicio: '01/01/2026', dataFim: '31/12/2026' });
  assert.strictEqual(r.dataInicio, '20260101');
  assert.strictEqual(r.dataFim, '20261231');
});

console.log('orchestrator-periodo-do-ano.test.js: ok');
