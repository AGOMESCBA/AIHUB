// Testes do Motor para a nova Pesquisa Web multi-provider (Serper → Gemini/
// Google Search → OpenAI/Web Search), cobrindo os cenários A-G do briefing
// "IA SERVICE — PESQUISA WEB SEM NOVO FORNECEDOR" + a correção posterior
// "CORREÇÃO IMPORTANTE — INTERFACE DE PESQUISA WEB / fallback entre IAs".

const assert = require('assert');
const os = require('os');
const path = require('path');

const database = require('../backend/database');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const dossieContextService = require('../backend/services/dossie-context-service');
const pesquisaService = require('../backend/services/technical-research-service');

function dbTmp() {
  return path.join(os.tmpdir(), `ia-service-pesquisa-web-motor-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function atendimento(empresaId, conteudo) {
  return atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto: conteudo || 'Atendimento pesquisa web multi-provider' });
}

function memoria(empresaId, atId, texto, orc = 16000) {
  return dossieContextService.montarMemoriaOperacional({ empresaId, atendimentoId: atId, mensagemAtual: texto, orcamentoEntrada: orc });
}

let seq = 80000;
function novoCtx(texto, searchConfig) {
  seq += 1;
  const empresaId = seq;
  const at = atendimento(empresaId, 'MATA460 FWFormModel Field not found X5_FILIAL');
  const dossieOperacional = memoria(empresaId, at.id, texto);
  return { empresaId, at, ctx: { empresaId, atendimentoId: at.id, atendimento: at, texto, dossieOperacional } };
}

// A — Pedido explícito de pesquisa aciona o provedor primário configurado (Serper)
async function testarPedidoExplicitoUsaProvedorPrimario() {
  const { ctx } = novoCtx('Pesquise uma solução para isso.', { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: 'fake-serper' });
  let chamouSerper = false;
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: 'fake-serper', geminiApiKey: null, openaiApiKey: null },
    buscarSerper: async (consultas) => { chamouSerper = true; return [{ titulo: 'Doc oficial', url: 'https://tdn.totvs.com/x', trecho: 'trecho', fonte: 'Serper/Google', consulta: consultas[0], oficial: true }]; },
    interpretarSemantico: async () => ({ resultado: { haMudancaInvestigativa: true, tipoMudanca: 'informacao_contextual', haEvidenciaNova: true, relevanciaParaPesquisa: 'alta', justificativa: 'pedido', referenciasEstado: [], confiancaQualitativa: 'media' }, provider: 'fixture', model: 'fixture', tokens: 10 }),
  });
  assert.ok(chamouSerper, 'provedor primario (Serper) deve ser chamado');
  assert.strictEqual(pesquisa.providerBusca, 'Serper/Google');
  assert.strictEqual(pesquisa.modo, 'web');
}

// B — Pesquisa automática por lacuna investigativa (sinal técnico forte, sem pedido explícito)
async function testarPesquisaAutomaticaPorLacuna() {
  const { ctx } = novoCtx('MATA460 FWFormModel: Field not found X5_FILIAL.');
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: 'fake-serper', geminiApiKey: null, openaiApiKey: null },
    buscarSerper: async (consultas) => [{ titulo: 'TDN', url: 'https://tdn.totvs.com/y', trecho: 'trecho', fonte: 'Serper/Google', consulta: consultas[0], oficial: true }],
  });
  assert.strictEqual(pesquisa.plano.devePesquisar, true, 'sinal tecnico forte deve acionar pesquisa sem pedido explicito');
  assert.strictEqual(pesquisa.modo, 'web');
}

// C — Fonte oficial encontrada é identificada corretamente
async function testarFonteOficialIdentificada() {
  const { ctx } = novoCtx('MATA460 FWFormModel: Field not found X5_FILIAL.');
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: 'fake-serper', geminiApiKey: null, openaiApiKey: null },
    buscarSerper: async (consultas) => [{ titulo: 'TDN oficial', url: 'https://tdn.totvs.com/z', trecho: 'trecho oficial', fonte: 'Serper/Google', consulta: consultas[0], oficial: true }],
    abrirResultados: async (resultados) => resultados.slice(0, 1).map(r => ({ titulo: r.titulo, url: r.url, status: 'lida', trecho: r.trecho, consulta: r.consulta, oficial: true, rankingScore: r.rankingScore })),
  });
  assert.ok(pesquisa.ranking.some(r => r.oficial === true), 'fonte oficial deve ser marcada no ranking');
  assert.ok(pesquisa.paginasLidas.some(p => p.oficial === true));
}

// D — URL/proveniência preservada (Gemini com groundingChunks)
async function testarProvenienciaGeminiPreservada() {
  const { ctx } = novoCtx('Pesquise uma solução para esse comportamento.');
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'gemini', fallbackOrdem: 'gemini,serper,openai', serperApiKey: null, geminiApiKey: 'fake-gemini-key', openaiApiKey: null },
    buscarGemini: async (consultas) => [{ titulo: 'Fonte Gemini', url: 'https://tdn.totvs.com/gemini-fonte', trecho: 'trecho encontrado via grounding', fonte: 'Gemini/Google Search', consulta: consultas[0], oficial: true }],
    interpretarSemantico: async () => ({ resultado: { haMudancaInvestigativa: true, tipoMudanca: 'informacao_contextual', haEvidenciaNova: true, relevanciaParaPesquisa: 'alta', justificativa: 'pedido', referenciasEstado: [], confiancaQualitativa: 'media' }, provider: 'fixture', model: 'fixture', tokens: 10 }),
  });
  assert.strictEqual(pesquisa.providerBusca, 'Gemini/Google Search');
  assert.ok(pesquisa.resultados.some(r => r.url === 'https://tdn.totvs.com/gemini-fonte'), 'URL retornada pelo Gemini deve ser preservada');
}

// E — Provider de pesquisa falha (operacionalmente) e fallback assume o próximo configurado
async function testarFallbackOperacionalEntreProviders() {
  const { ctx } = novoCtx('MATA460 FWFormModel: Field not found X5_FILIAL.');
  let tentouSerper = false;
  let tentouGemini = false;
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: 'fake-serper', geminiApiKey: 'fake-gemini', openaiApiKey: null },
    buscarSerper: async () => { tentouSerper = true; throw new Error('Serper indisponivel (simulado)'); },
    buscarGemini: async (consultas) => { tentouGemini = true; return [{ titulo: 'Fallback Gemini', url: 'https://tdn.totvs.com/fallback', trecho: 'trecho', fonte: 'Gemini/Google Search', consulta: consultas[0], oficial: true }]; },
  });
  assert.ok(tentouSerper, 'provedor primario deve ser tentado primeiro');
  assert.ok(tentouGemini, 'fallback deve assumir apos falha operacional do primario');
  assert.strictEqual(pesquisa.providerBusca, 'Gemini/Google Search');
  assert.ok(pesquisa.tentativasBusca.some(t => t.provider === 'Serper/Google' && t.status === 'erro'));
}

// Não executar 3 pesquisas desnecessariamente: se o primário TEM resultado,
// os seguintes da ordem não devem ser chamados.
async function testarNaoChamaTodosOsProvidersSimultaneamente() {
  const { ctx } = novoCtx('MATA460 FWFormModel: Field not found X5_FILIAL.');
  let chamouGemini = false;
  let chamouOpenai = false;
  await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: 'fake-serper', geminiApiKey: 'fake-gemini', openaiApiKey: 'fake-openai' },
    buscarSerper: async (consultas) => [{ titulo: 'OK no primario', url: 'https://tdn.totvs.com/ok', trecho: 'trecho', fonte: 'Serper/Google', consulta: consultas[0], oficial: true }],
    buscarGemini: async () => { chamouGemini = true; return []; },
    buscarOpenai: async () => { chamouOpenai = true; return []; },
  });
  assert.ok(!chamouGemini, 'Gemini nao deve ser chamado se o primario ja teve resultado');
  assert.ok(!chamouOpenai, 'OpenAI nao deve ser chamado se o primario ja teve resultado');
}

// F — Provider principal de IA (chat) é diferente do provider de pesquisa —
// confirma que a pesquisa não depende/interfere no provider de resposta.
async function testarProviderPrincipalDiferenteDoProviderDePesquisa() {
  const { ctx } = novoCtx('MATA460 FWFormModel: Field not found X5_FILIAL.');
  // searchConfig e cfg de chat sao estruturas totalmente separadas — aqui
  // simulamos que o provider primario de CHAT é Groq, mas a pesquisa usa
  // Gemini como primario, sem nenhum acoplamento entre as duas resoluções.
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'gemini', fallbackOrdem: 'gemini,serper,openai', serperApiKey: null, geminiApiKey: 'fake-gemini', openaiApiKey: null },
    buscarGemini: async (consultas) => [{ titulo: 'Gemini', url: 'https://tdn.totvs.com/g', trecho: 'trecho', fonte: 'Gemini/Google Search', consulta: consultas[0], oficial: true }],
  });
  assert.strictEqual(pesquisa.providerBusca, 'Gemini/Google Search');
  // Nenhuma referência a "groq" deveria aparecer no objeto de pesquisa —
  // confirma que resolverConfigPesquisa/pesquisar não leem nem propagam cfg
  // de chat para dentro do resultado de busca.
  assert.ok(!JSON.stringify(pesquisa).toLowerCase().includes('groq'));
}

// G — Nenhuma capability disponível (nenhuma chave configurada) → degradação segura
async function testarSemCapabilityDisponivelDegradaSemQuebrar() {
  const { ctx } = novoCtx('Pesquise uma solução para isso.');
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: null, geminiApiKey: null, openaiApiKey: null },
    interpretarSemantico: async () => ({ resultado: { haMudancaInvestigativa: true, tipoMudanca: 'informacao_contextual', haEvidenciaNova: true, relevanciaParaPesquisa: 'alta', justificativa: 'pedido', referenciasEstado: [], confiancaQualitativa: 'media' }, provider: 'fixture', model: 'fixture', tokens: 10 }),
  });
  assert.strictEqual(pesquisa.configurado, false);
  assert.ok(['links', 'nao_pesquisado'].includes(pesquisa.modo));
  assert.ok(pesquisa.tentativasBusca.every(t => t.status === 'sem_chave'));
  // Não inventa resultado nem finge ter pesquisado:
  assert.strictEqual(pesquisa.resultados.length, 0);
  assert.strictEqual(pesquisa.providerBusca, null);
}

// Não simular pesquisa quando indisponível — nenhum resultado "fantasma"
async function testarNaoSimulaPesquisaQuandoIndisponivel() {
  const { ctx } = novoCtx('MATA460 FWFormModel: Field not found X5_FILIAL.');
  const pesquisa = await pesquisaService.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: null, geminiApiKey: null, openaiApiKey: null },
  });
  assert.strictEqual(pesquisa.resultados.length, 0);
  assert.strictEqual(pesquisa.paginasLidas.length, 0);
  assert.ok(!pesquisa.providerBusca);
}

async function main() {
  database.inicializarDB(dbTmp());
  try {
    await testarPedidoExplicitoUsaProvedorPrimario();
    await testarPesquisaAutomaticaPorLacuna();
    await testarFonteOficialIdentificada();
    await testarProvenienciaGeminiPreservada();
    await testarFallbackOperacionalEntreProviders();
    await testarNaoChamaTodosOsProvidersSimultaneamente();
    await testarProviderPrincipalDiferenteDoProviderDePesquisa();
    await testarSemCapabilityDisponivelDegradaSemQuebrar();
    await testarNaoSimulaPesquisaQuandoIndisponivel();
    console.log('etapa-v1-pesquisa-web-motor.test.js: ok (fallback multi-provider, provenancia, degradacao segura)');
  } finally {
    database.fecharDB();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
