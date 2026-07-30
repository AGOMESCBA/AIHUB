'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const canonicalIntent = require(path.join(ROOT, 'modules/erp/nlsql-cache/canonical-intent'));

let ok = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  [ok] ${nome}`);
  } catch (err) {
    console.error(`  [falha] ${nome}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

const specFaturamento = {
  nome: 'faturamento',
  handlerName: 'faturamento-ia-owner',
  promptVersion: 'prompt-test',
  specVersion: 'spec-test',
};

test('gera Intent Canonico completo e valido para faturamento', () => {
  const res = canonicalIntent.gerarIntentCanonico({
    spec: specFaturamento,
    empresaId: 7,
    mensagem: 'faturamento de novembro por cliente',
    intent: {
      intencao: 'faturamento_dinamico',
      periodo: { tipo: 'mes', dataInicio: '2026-11-01', dataFim: '2026-11-30' },
      filtros: { cliente_id: 123, filial: 'TODAS' },
      agrupar_por: 'cliente',
      _metricasDetectadas: ['faturamento'],
    },
    entidadesResolvidas: [{ tipo: 'cliente', codigo: '123', loja: '01', nome: 'Cliente A' }],
    modelo: 'modelo-test',
  });

  assert.strictEqual(res.canonical.module, 'faturamento');
  assert.strictEqual(res.canonical.period.start, '2026-11-01');
  assert.strictEqual(res.canonical.period.end, '2026-11-30');
  assert.deepStrictEqual(res.canonical.group_by, ['cliente']);
  assert.strictEqual(res.canonical.validation.ok, true);
  assert.match(res.cacheKey, /^[a-f0-9]{64}$/);
  assert.match(res.canonicalHash, /^[a-f0-9]{64}$/);
});

test('chave estrutural ignora valores de periodo e preserva forma da consulta', () => {
  const base = {
    spec: specFaturamento,
    empresaId: 7,
    intent: {
      intencao: 'faturamento_dinamico',
      filtros: { filial: 'TODAS' },
      agrupar_por: 'cliente',
      _metricasDetectadas: ['faturamento'],
    },
    entidadesResolvidas: [{ tipo: 'cliente', codigo: '123', loja: '01' }],
  };
  const novembro = canonicalIntent.gerarIntentCanonico({
    ...base,
    mensagem: 'faturamento de novembro por cliente',
    intent: { ...base.intent, periodo: { tipo: 'mes', dataInicio: '2026-11-01', dataFim: '2026-11-30' } },
  });
  const dezembro = canonicalIntent.gerarIntentCanonico({
    ...base,
    mensagem: 'faturamento de dezembro por cliente',
    intent: { ...base.intent, periodo: { tipo: 'mes', dataInicio: '2026-12-01', dataFim: '2026-12-31' } },
  });

  assert.notStrictEqual(novembro.canonicalHash, dezembro.canonicalHash);
  assert.strictEqual(novembro.cacheKey, dezembro.cacheKey);
});

test('chave estrutural muda quando escopo de empresa muda', () => {
  const intent = {
    intencao: 'financeiro_dinamico',
    periodo: { tipo: 'mes', dataInicio: '2026-11-01', dataFim: '2026-11-30' },
    filtros: { carteira: 'receber' },
  };
  const a = canonicalIntent.gerarIntentCanonico({ spec: { nome: 'financeiro' }, empresaId: 1, mensagem: 'recebido em novembro', intent });
  const b = canonicalIntent.gerarIntentCanonico({ spec: { nome: 'financeiro' }, empresaId: 2, mensagem: 'recebido em novembro', intent });

  assert.notStrictEqual(a.cacheKey, b.cacheKey);
});

test('validacao sinaliza filtro fora do contrato', () => {
  const res = canonicalIntent.gerarIntentCanonico({
    spec: { nome: 'compras' },
    empresaId: 7,
    mensagem: 'compras por fornecedor',
    intent: {
      intencao: 'compras_dinamico',
      periodo: { tipo: 'mes', dataInicio: '2026-11-01', dataFim: '2026-11-30' },
      filtros: { filtro_inventado: 'x' },
      agrupar_por: 'fornecedor',
    },
  });

  assert.strictEqual(res.canonical.validation.ok, false);
  assert(res.canonical.validation.erros.some(e => e.includes('filtro nao catalogado')));
});

test('financeiro aceita filtro vencido no Intent Canonico', () => {
  const res = canonicalIntent.gerarIntentCanonico({
    spec: { nome: 'financeiro' },
    empresaId: 1,
    mensagem: 'clientes com valores vencidos',
    intent: {
      intencao: 'financeiro_dinamico',
      periodo: { tipo: 'mes', dataInicio: '20250601', dataFim: '20250630' },
      filtros: { vencido: true },
      agrupar_por: 'cliente',
    },
  });

  assert.strictEqual(res.canonical.filters.vencido, true);
  assert.strictEqual(res.canonical.validation.ok, true);
});

if (!process.exitCode) {
  console.log(`canonical-intent.test.js: ok (${ok} casos)`);
}
