const assert = require('assert');
const path = require('path');

const {
  BENCHMARK_VERSION,
  loadDataset,
  validateCase,
  runDatasetOffline,
  aggregateResults,
} = require('./benchmark/engine/benchmark-runner');

const DATASET_PATH = path.join(__dirname, 'benchmark', 'cases', 'development', 'initial-cases.json');

async function testarParserGoldenPrivacidade() {
  const dataset = loadDataset(DATASET_PATH);
  assert.strictEqual(dataset.version, 'benchmark-4a-baseline-1');
  assert.ok(dataset.cases.length >= 12);
  assert.ok(dataset.cases.every(c => c.origin === 'synthetic'));

  assert.throws(() => validateCase({
    id: 'invalido',
    title: 'Golden invalido',
    origin: 'synthetic',
    type: ['simples'],
    domains: ['x'],
    context: 'x',
    turns: [{ role: 'user', content: 'x' }],
    golden: { outcome: 'resolved' },
  }), /campo ausente/);

  assert.throws(() => validateCase({
    id: 'sensivel',
    title: 'Privacidade',
    origin: 'synthetic',
    type: ['simples'],
    domains: ['x'],
    context: 'senha=SEGREDO12345',
    turns: [{ role: 'user', content: 'x' }],
    golden: {
      outcome: 'inconclusive',
      causa_real: null,
      evidencias_criticas: [],
      hipoteses_plausiveis: [],
      hipoteses_descartadas: [],
      testes_de_alto_valor: [],
      testes_desnecessarios: [],
      pesquisa_necessaria: false,
      solucao_validada: null,
      informacoes_que_nao_podem_ser_inventadas: [],
    },
  }), /sensivel|anonimizado/);
}

async function testarBaselineOffline() {
  const dataset = loadDataset(DATASET_PATH);
  const baseline = await runDatasetOffline(dataset);
  assert.strictEqual(baseline.benchmarkVersion, BENCHMARK_VERSION);
  assert.strictEqual(baseline.mode, 'offline_deterministico');
  assert.strictEqual(baseline.results.length, dataset.cases.length);
  assert.ok(baseline.results.every(r => r.caso && r.metricas && r.dimensoes && Array.isArray(r.erros_graves)));
  assert.ok(baseline.results.some(r => r.status === 'inconclusivo_correto'));
  assert.ok(baseline.aggregate.totalCasos === dataset.cases.length);
  assert.ok(Object.keys(baseline.aggregate.matrizFalhas).length > 5);
  assert.ok(baseline.aggregate.tokens.inputEstimado > 0);
  assert.ok(baseline.aggregate.latenciaMs.total >= 0);

  const ids = new Set(baseline.results.map(r => r.caso));
  assert.strictEqual(ids.size, baseline.results.length, 'cada caso deve executar isolado e retornar resultado unico');

  const multiEmpresaA = baseline.results.find(r => r.caso === 'misleading-historical-ticket');
  const multiEmpresaB = baseline.results.find(r => r.caso === 'helpful-historical-ticket');
  assert.ok(multiEmpresaA && multiEmpresaB);
  assert.notDeepStrictEqual(multiEmpresaA.pesquisas, multiEmpresaB.pesquisas, 'resultados de casos distintos nao devem compartilhar estado de pesquisa');

  const agg = aggregateResults(baseline.results, { mode: 'offline_deterministico' });
  assert.strictEqual(agg.totalCasos, baseline.aggregate.totalCasos);
  assert.strictEqual(agg.resolvidosCorretamente + agg.naoResolvidos + agg.inconclusivosCorretamente, baseline.results.length);

  return baseline;
}

async function main() {
  await testarParserGoldenPrivacidade();
  const baseline = await testarBaselineOffline();
  console.log(`benchmark-motor-investigacao.test.js: ok ${JSON.stringify({
    total: baseline.aggregate.totalCasos,
    ok: baseline.aggregate.resolvidosCorretamente,
    inconclusivos: baseline.aggregate.inconclusivosCorretamente,
    falhas: baseline.aggregate.naoResolvidos,
    hallucinations: baseline.aggregate.hallucinations,
    diagnosticosPrematuros: baseline.aggregate.diagnosticosPrematuros,
    regressoes: baseline.aggregate.regressoesInvestigativas,
  })}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
