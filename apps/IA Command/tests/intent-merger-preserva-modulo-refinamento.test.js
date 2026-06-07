'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const intentMerger = require(path.join(ROOT, 'modules/ai/intent-merger'));

const anteriorCompras = {
  intencao: 'compras_dinamico',
  acao: 'ai_text_to_sql',
  _dynamicAiScope: true,
  _moduloDinamico: 'compras',
  _mensagemOriginal: 'Compras do ano por mes',
  periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
  filtros: {},
  group_by: ['mes'],
  agrupar_por: 'mes',
  confianca: 0.95,
  _nivel_contexto: 1,
};

const novoClassificadoErrado = {
  intencao: 'faturamento_dinamico',
  acao: 'ai_text_to_sql',
  _dynamicAiScope: true,
  _moduloDinamico: 'faturamento',
  _mensagemOriginal: 'Detalhes SOFTEXPERT',
  periodo: { tipo: 'ano_atual' },
  filtros: { cliente: 'SOFTEXPERT' },
  group_by: ['mes'],
  agrupar_por: 'mes',
  confianca: 0.96,
};

const merged = intentMerger.mesclar(
  novoClassificadoErrado,
  anteriorCompras,
  Date.now(),
  'Detalhes SOFTEXPERT',
);

assert.strictEqual(merged.intencao, 'compras_dinamico', 'refinamento curto deve preservar intencao de compras');
assert.strictEqual(merged._moduloDinamico, 'compras', 'refinamento curto deve preservar modulo de compras');
assert.strictEqual(merged._dominioPreservadoPorRefinamento, true, 'deve marcar dominio preservado por refinamento');
assert.deepStrictEqual(merged.periodo, anteriorCompras.periodo, 'periodo anterior deve ser preservado');
assert.deepStrictEqual(merged.group_by, ['mes'], 'agrupamento por mes deve ser preservado');

const trocaExplicita = intentMerger.mesclar(
  {
    ...novoClassificadoErrado,
    _mensagemOriginal: 'Faturamento da SOFTEXPERT',
  },
  anteriorCompras,
  Date.now(),
  'Faturamento da SOFTEXPERT',
);

assert.strictEqual(trocaExplicita.intencao, 'faturamento_dinamico', 'dominio explicito deve permitir troca para faturamento');

console.log('intent-merger-preserva-modulo-refinamento.test.js: ok');
