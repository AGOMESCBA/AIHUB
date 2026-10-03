const assert = require('assert');
const path = require('path');

const {
  loadDataset,
  runDatasetPost4B,
} = require('./benchmark/engine/benchmark-runner');
const discipline = require('../backend/services/investigative-discipline-service');
const qualityGate = require('../backend/services/quality-gate-service');
const pesquisaService = require('../backend/services/technical-research-service');

const BASELINE_1 = Object.freeze({
  totalCasos: 14,
  resolvidosCorretamente: 9,
  naoResolvidos: 4,
  inconclusivosCorretamente: 1,
  hallucinations: 1,
  diagnosticosPrematuros: 0,
  regressoesInvestigativas: 0,
  pesquisas: 13,
  testes: 15,
  mediaTurnos: 1.43,
  medianaTurnos: 1,
  tokens: { inputEstimado: 9684, outputEstimado: 1500 },
});

const DATASET_4A = path.join(__dirname, 'benchmark', 'cases', 'development', 'initial-cases.json');
const DATASET_4B = path.join(__dirname, 'benchmark', 'cases', 'development', 'etapa4b-cases.json');

function assertPlano(texto, esperado) {
  const plano = pesquisaService.planejarPesquisa({ texto, disciplina4B: true });
  assert.strictEqual(plano.devePesquisar, esperado.devePesquisar, `${texto} => devePesquisar`);
  if (esperado.suficiencia) assert.strictEqual(plano.suficiencia, esperado.suficiencia);
  if (esperado.lacuna) assert.strictEqual(plano.lacunaInvestigativa.tipo, esperado.lacuna);
  return plano;
}

async function testarBenchmarkPos4B() {
  const dataset = loadDataset(DATASET_4A);
  const pos = await runDatasetPost4B(dataset);
  assert.strictEqual(pos.results.length, BASELINE_1.totalCasos);
  assert.strictEqual(pos.aggregate.hallucinations, 0, '4B deve zerar hallucination critica');
  assert.strictEqual(pos.aggregate.diagnosticosPrematuros, 0, '4B nao pode criar diagnostico prematuro');
  assert.strictEqual(pos.aggregate.regressoesInvestigativas, 0, '4B nao pode criar regressao investigativa');

  const byId = Object.fromEntries(pos.results.map(r => [r.caso, r]));
  for (const id of ['simple-protheus-field-missing', 'helpful-historical-ticket', 'multi-file-code-config']) {
    assert.strictEqual(byId[id].metricas.pesquisou_sem_necessidade, false, `${id} nao deve pesquisar sem lacuna externa`);
    assert.strictEqual(byId[id].status, 'ok', `${id} deve virar/respeitar ok`);
  }
  assert.strictEqual(byId['impossible-no-evidence'].status, 'inconclusivo_correto');
  assert.strictEqual(byId['impossible-no-evidence'].erros_graves.length, 0);
  for (const id of ['intermediate-api-http-401-cert', 'adversarial-obvious-customization-wrong']) {
    assert.strictEqual(byId[id].status, 'ok', `${id} deve continuar resolvendo quando ha evidencia suficiente`);
  }
  assert.ok(pos.aggregate.naoResolvidos < BASELINE_1.naoResolvidos);
  return pos;
}

async function testarCasos4B() {
  const dataset = loadDataset(DATASET_4B);
  const pos = await runDatasetPost4B(dataset);
  const byId = Object.fromEntries(pos.results.map(r => [r.caso, r]));
  assert.strictEqual(byId['4b-sufficient-field'].status, 'ok');
  assert.strictEqual(byId['4b-sufficient-field'].metricas.pesquisou_sem_necessidade, false);
  assert.strictEqual(byId['4b-missing-critical-evidence'].status, 'inconclusivo_correto');
  assert.strictEqual(byId['4b-missing-critical-evidence'].metricas.inventou_informacao, false);
  assert.strictEqual(byId['4b-external-gap-needed'].metricas.deixou_de_pesquisar_quando_necessario, false);
  assert.strictEqual(byId['4b-environment-gap'].metricas.pesquisou_sem_necessidade, false);
  assert.strictEqual(byId['4b-contradiction'].status, 'inconclusivo_correto');
  assert.ok(!JSON.stringify(byId['4b-safe-test'].testes).includes('derrubar a fila produtiva'));
}

function testarPlannerDeterministico() {
  assertPlano('MATA460 FWFormModel: Field not found X5_FILIAL', {
    devePesquisar: false,
    suficiencia: 'SUFICIENTE_PARA_DIAGNOSTICO',
    lacuna: 'NENHUMA',
  });
  assertPlano('Depois de atualizar para 12.1.2510 a MATA460 mudou calculo em relacao a 12.1.2410', {
    devePesquisar: true,
    lacuna: 'PESQUISA_EXTERNA',
  });
  assertPlano('A API falhou, mas ainda nao temos status HTTP nem log do horario', {
    devePesquisar: false,
  });
  assertPlano('Monitoramento do banco esta verde, mas a API registra SQL timeout no SELECT fechamento', {
    devePesquisar: false,
    lacuna: 'CONTRADICAO',
  });
}

function testarHipoteseVersusFatoInventado() {
  const hipotese = qualityGate.avaliarResposta({
    textoResposta: 'Pode ser problema de certificado porque HTTP 401 e compativel; falta validar thumbprint para confirmar.',
    manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'anexo', trecho: 'HTTP 401 no gateway' }], omitidos: [] },
    pergunta: 'analise integracao',
    pesquisa: { plano: { devePesquisar: false } },
  });
  assert.ok(!hipotese.falhas.some(f => f.codigo === 'UNSUPPORTED_FACT_OR_DIAGNOSIS'), 'hipotese explicita deve ser permitida');

  const fatoInventado = qualityGate.avaliarResposta({
    textoResposta: 'Diagnostico: a causa raiz foi thumbprint mismatch confirmado no certificado.',
    manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'anexo', trecho: 'HTTP 401 no gateway' }], omitidos: [] },
    pergunta: 'analise integracao',
    pesquisa: { plano: { devePesquisar: false } },
  });
  assert.ok(fatoInventado.falhas.some(f => f.codigo === 'UNSUPPORTED_FACT_OR_DIAGNOSIS'), 'fato tecnico sem suporte deve falhar');
  assert.ok(qualityGate.montarInstrucaoRetry(fatoInventado).includes('rebaixe para hipotese'));
}

function testarValorInformacionalESeguranca() {
  const analise = discipline.analisarMaterial({
    texto: 'Para confirmar, alguém sugeriu derrubar a fila produtiva; alternativa é medir latência em homologação com payload semelhante.',
  });
  assert.ok(analise.testesConsiderados.every(t => t.seguranca !== 'baixa' || !t.escolhido));
}

async function main() {
  const pos = await testarBenchmarkPos4B();
  await testarCasos4B();
  testarPlannerDeterministico();
  testarHipoteseVersusFatoInventado();
  testarValorInformacionalESeguranca();
  console.log(`etapa4b-disciplina-investigativa.test.js: ok ${JSON.stringify({
    baselineHallucinations: BASELINE_1.hallucinations,
    posHallucinations: pos.aggregate.hallucinations,
    baselinePesquisas: BASELINE_1.pesquisas,
    posPesquisas: pos.aggregate.pesquisas,
    posResolvidos: pos.aggregate.resolvidosCorretamente,
    posFalhas: pos.aggregate.naoResolvidos,
  })}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
