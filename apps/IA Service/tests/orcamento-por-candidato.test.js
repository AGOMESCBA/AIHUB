// Orcamento de contexto POR CANDIDATO (opcao B, 2026-10): o prompt e dimensionado
// pelo modelo elegivel de cada tentativa, respeitando a ordem cadastrada
// (primario + fallback), sem promover nem pular providers por preferencia.
// Nao chama IA real (https.request mockado).
// Executar: node "apps/IA Service/tests/orcamento-por-candidato.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-orcamento-candidato-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const contextEngine = require('../backend/services/context-engine');
const aiProviderClient = require('../backend/services/ai-provider-client');
const investigacaoService = require('../backend/services/investigacao-service');
const promptBuilder = require('../backend/services/prompt-builder');

const EMPRESA_A = 9701;
const EMPRESA_B = 9702;
const MODELOS = { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini', deepseek: 'deepseek-chat', claude: 'claude-haiku-4-5-20251001', gemini: 'gemini-3.5-flash' };

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function instalarMockHttps(respostasPorHost) {
  const original = https.request;
  const chamadas = [];
  https.request = (options, cb) => {
    const req = new EventEmitter();
    let bodyStr = '';
    req.write = chunk => { bodyStr += String(chunk || ''); };
    req.setTimeout = () => {};
    req.destroy = err => req.emit('error', err);
    req.end = () => {
      const fila = respostasPorHost[options.hostname];
      const resposta = fila && fila.shift();
      chamadas.push({ hostname: options.hostname, body: bodyStr });
      process.nextTick(() => {
        if (!resposta) {
          req.emit('error', new Error(`Mock sem resposta configurada para ${options.hostname}`));
          return;
        }
        const res = new EventEmitter();
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify(resposta.body)));
        res.emit('end');
      });
    };
    return req;
  };
  return { chamadas, restaurar() { https.request = original; } };
}

const OK = texto => ({ body: { choices: [{ message: { content: texto }, finish_reason: 'stop' }], usage: { total_tokens: 10 } } });
const CHAVE_INVALIDA = { body: { error: { message: 'Invalid API Key' } } };

function tamanhoPrompt(chamada) {
  const body = JSON.parse(chamada.body);
  return JSON.stringify(body.messages || body).length;
}

function criarCenario(empresaId, { comImagem = false } = {}) {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: 'Chamado Protheus com erro XPTO-900 na apuracao de PIS COFINS.',
  });
  for (let i = 0; i < 14; i++) {
    mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
      papel: i % 2 ? 'assistant' : 'user',
      conteudo: `Mensagem ${i} sobre XPTO-900 e apuracao PIS COFINS: ${'detalhe tecnico relevante '.repeat(40)}`,
    });
  }
  const anexos = [];
  for (let i = 0; i < 10; i++) {
    const conteudo = `Documento ${i} XPTO-900 apuracao PIS COFINS registro C197 E115 M220. ${`trecho normativo ${i} `.repeat(500)}`;
    const a = anexoRepo.salvarMetadadosAnexo(empresaId, atendimento.id, {
      nomeOriginal: `doc-${i}.txt`,
      nomeInterno: `doc-${i}-${Math.random().toString(36).slice(2)}`,
      mimeType: 'text/plain',
      tamanho: Buffer.byteLength(conteudo),
      caminhoRelativo: `${empresaId}/${atendimento.id}/doc-${i}.txt`,
    });
    anexoRepo.atualizarExtracao(empresaId, a.id, { conteudoExtraido: conteudo, linguagemDetectada: null, encodingDetectado: 'utf-8', eCodigo: false });
    anexos.push(a);
  }
  let imagem = null;
  if (comImagem) {
    imagem = anexoRepo.salvarMetadadosAnexo(empresaId, atendimento.id, {
      nomeOriginal: 'print.png',
      nomeInterno: 'print.png',
      mimeType: 'image/png',
      tamanho: 8,
      caminhoRelativo: `${empresaId}/${atendimento.id}/print.png`,
    });
  }
  const historico = mensagemRepo.listarMensagens(empresaId, atendimento.id, { limite: 100 });
  const params = (cfg, keys) => ({
    atendimento,
    mensagens: historico,
    mensagemAtual: 'Analise o erro XPTO-900 na apuracao de PIS COFINS e os registros C197 E115 M220 dos documentos.',
    anexosDoTurno: [],
    anexosComoContexto: false,
    pesquisaTecnicaTexto: '',
    pesquisa: null,
    relacionados: [],
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg,
    keys,
  });
  return { atendimento, anexos, imagem, params };
}

const incluidosAnexos = ctx => (ctx.manifesto.selecionados || []).filter(s => s.tipo === 'anexo').length;

// 1. Elegibilidade e ordem cadastrada (empresas diferentes, ordens personalizadas,
//    sem credencial, imagem).
function testarElegibilidadeEOrdem() {
  const todas = { groq: 'k', openai: 'k', deepseek: 'k', claude: 'k', gemini: 'k' };

  // Cadastro do print: primario DeepSeek + fallback personalizado.
  const cfgA = { provedorPrimario: 'deepseek', fallbackOrdem: 'openai, claude, deepseek, groq, gemini', modelos: MODELOS };
  assert.deepStrictEqual(aiProviderClient.candidatosElegiveis(todas, cfgA), ['deepseek', 'openai', 'claude', 'groq', 'gemini']);
  assert.strictEqual(aiProviderClient.primeiroCandidatoElegivel(todas, cfgA).provider, 'deepseek');
  assert.strictEqual(aiProviderClient.primeiroCandidatoElegivel(todas, cfgA).model, 'deepseek-chat');
  // Com imagem: DeepSeek nao tem visao, o primeiro da ORDEM cadastrada com visao e OpenAI.
  assert.strictEqual(aiProviderClient.primeiroCandidatoElegivel(todas, cfgA, { exigeImagem: true }).provider, 'openai');

  // Outra empresa, outra ordem: nada vaza entre configuracoes.
  const cfgB = { provedorPrimario: 'claude', fallbackOrdem: 'gemini,groq', modelos: MODELOS };
  assert.strictEqual(aiProviderClient.primeiroCandidatoElegivel(todas, cfgB).provider, 'claude');
  assert.strictEqual(aiProviderClient.primeiroCandidatoElegivel(todas, cfgA).provider, 'deepseek');

  // Primario sem credencial: o proximo da ordem cadastrada assume (sem promover ninguem).
  const semDeepseek = { ...todas, deepseek: null };
  assert.deepStrictEqual(aiProviderClient.candidatosElegiveis(semDeepseek, cfgA).slice(0, 2), ['openai', 'claude']);

  // So providers sem visao + imagem: sem candidato (o erro explicito vem do chamarIA).
  assert.strictEqual(aiProviderClient.primeiroCandidatoElegivel({ groq: 'k', deepseek: 'k' }, cfgA, { exigeImagem: true }), null);
  assert.strictEqual(aiProviderClient.primeiroCandidatoElegivel({}, cfgA), null);
}

// 2. O orcamento acompanha o modelo da tentativa: janelas diferentes -> contexto diferente.
function testarOrcamentoMudaComOModelo() {
  const c = criarCenario(EMPRESA_A);
  const cfg = { provedorPrimario: 'groq', fallbackOrdem: 'openai', modelos: MODELOS };
  const keys = { groq: 'k', openai: 'k' };
  const pequeno = contextEngine.montarContextoInvestigacao({ ...c.params(cfg, keys), candidatoOrcamento: { provider: 'groq', model: MODELOS.groq } });
  const grande = contextEngine.montarContextoInvestigacao({ ...c.params(cfg, keys), candidatoOrcamento: { provider: 'openai', model: MODELOS.openai } });

  assert.strictEqual(pequeno.manifesto.orcamento.modelo, MODELOS.groq);
  assert.strictEqual(pequeno.manifesto.orcamento.origemReferencia, 'candidato_da_tentativa');
  assert.strictEqual(grande.manifesto.orcamento.modelo, MODELOS.openai);
  assert.ok(grande.manifesto.orcamento.entradaDisponivel > pequeno.manifesto.orcamento.entradaDisponivel);
  assert.ok(incluidosAnexos(grande) > incluidosAnexos(pequeno), `anexos: grande=${incluidosAnexos(grande)} pequeno=${incluidosAnexos(pequeno)}`);
  assert.ok(grande.userPrompt.length > pequeno.userPrompt.length);
  // Sem candidatoOrcamento nem keys: comportamento anterior (provedorPrimario).
  const legado = contextEngine.montarContextoInvestigacao({ ...c.params(cfg, null) });
  assert.strictEqual(legado.manifesto.orcamento.modelo, MODELOS.groq);
  assert.strictEqual(legado.manifesto.orcamento.origemReferencia, 'provedor_primario_configurado');
}

// 3. Fallback apos falha real: janela MAIOR -> prompt reconstruido e aproveitado.
async function testarFallbackParaJanelaMaior() {
  const c = criarCenario(EMPRESA_A);
  const cfg = { provedorPrimario: 'groq', fallbackOrdem: 'openai', modelos: MODELOS };
  const keys = { groq: 'g', openai: 'o' };
  const base = contextEngine.montarContextoInvestigacao({ ...c.params(cfg, keys), candidatoOrcamento: { provider: 'groq', model: MODELOS.groq } });
  const preparador = investigacaoService._criarPreparadorPorCandidato({
    contexto: base,
    userPromptAtual: base.userPrompt,
    imagensAtuais: [],
    candidatoAtual: { provider: 'groq', model: MODELOS.groq },
    paramsContexto: c.params(cfg, keys),
    decorar: (ctx, prompt) => prompt,
  });
  const mock = instalarMockHttps({ 'api.groq.com': [CHAVE_INVALIDA], 'api.openai.com': [OK('resposta openai')] });
  try {
    const r = await aiProviderClient.chamarIA(keys, cfg, promptBuilder.SYSTEM_PROMPT, base.userPrompt, [], {
      maxProviderRounds: 1,
      providerRetryDelayMs: 0,
      prepararParaCandidato: preparador.preparar,
    });
    assert.strictEqual(r.provider, 'openai');
    assert.deepStrictEqual(mock.chamadas.map(x => x.hostname), ['api.groq.com', 'api.openai.com']);
    assert.ok(tamanhoPrompt(mock.chamadas[1]) > tamanhoPrompt(mock.chamadas[0]), 'prompt do fallback com janela maior deve ser reconstruido e maior');

    const [tGroq, tOpenai] = r.tentativas;
    assert.strictEqual(tGroq.preparo.reconstruido, false);
    assert.strictEqual(tGroq.preparo.orcamento.modelo, MODELOS.groq);
    assert.strictEqual(tOpenai.preparo.reconstruido, true);
    assert.strictEqual(tOpenai.preparo.orcamento.modelo, MODELOS.openai);
    assert.ok(tOpenai.preparo.orcamento.entradaDisponivel > tGroq.preparo.orcamento.entradaDisponivel);
    assert.ok(tOpenai.preparo.evidenciasIncluidas.length > tGroq.preparo.evidenciasIncluidas.length);
    assert.ok(Array.isArray(tOpenai.preparo.evidenciasOmitidas));
    assert.ok(!r.tentativas.some(t => t.status === 'ignorado_janela'));

    const usado = preparador.usadoPor(r);
    assert.strictEqual(usado.contexto.manifesto.orcamento.modelo, MODELOS.openai, 'manifesto persistido deve ser o da tentativa vencedora');
  } finally {
    mock.restaurar();
  }
}

// 4. Fallback apos falha real: janela MENOR -> prompt reduzido de forma controlada
//    (nao reenvia o prompt grande, nao pula o provider).
async function testarFallbackParaJanelaMenor() {
  const c = criarCenario(EMPRESA_A);
  const cfg = { provedorPrimario: 'openai', fallbackOrdem: 'groq', modelos: MODELOS };
  const keys = { groq: 'g', openai: 'o' };
  const base = contextEngine.montarContextoInvestigacao({ ...c.params(cfg, keys), candidatoOrcamento: { provider: 'openai', model: MODELOS.openai } });
  const preparador = investigacaoService._criarPreparadorPorCandidato({
    contexto: base,
    userPromptAtual: base.userPrompt,
    imagensAtuais: [],
    candidatoAtual: { provider: 'openai', model: MODELOS.openai },
    paramsContexto: c.params(cfg, keys),
    decorar: (ctx, prompt) => prompt,
  });
  const mock = instalarMockHttps({ 'api.openai.com': [CHAVE_INVALIDA], 'api.groq.com': [OK('resposta groq')] });
  try {
    const r = await aiProviderClient.chamarIA(keys, cfg, promptBuilder.SYSTEM_PROMPT, base.userPrompt, [], {
      maxProviderRounds: 1,
      providerRetryDelayMs: 0,
      prepararParaCandidato: preparador.preparar,
    });
    assert.strictEqual(r.provider, 'groq', 'provider cadastrado em fallback deve ser tentado, nao pulado');
    assert.ok(tamanhoPrompt(mock.chamadas[1]) < tamanhoPrompt(mock.chamadas[0]), 'prompt para janela menor deve ser reduzido');
    const tGroq = r.tentativas.find(t => t.provider === 'groq');
    assert.strictEqual(tGroq.preparo.reconstruido, true);
    assert.strictEqual(tGroq.preparo.orcamento.modelo, MODELOS.groq);
    assert.ok(tGroq.preparo.evidenciasOmitidas.length > 0, 'evidencias que ficaram de fora devem ser registradas');
    assert.ok(!r.tentativas.some(t => t.status === 'ignorado_janela'));
  } finally {
    mock.restaurar();
  }
}

// 5. Imagem efetivamente enviada: provider sem visao nao e tentado; segue a ordem cadastrada.
async function testarImagemSegueOrdemCadastrada() {
  const c = criarCenario(EMPRESA_B, { comImagem: true });
  const cfg = { provedorPrimario: 'deepseek', fallbackOrdem: 'openai,claude,groq,gemini', modelos: MODELOS };
  const keys = { deepseek: 'd', openai: 'o', claude: 'c', groq: 'g', gemini: 'm' };
  const candidatoVisao = aiProviderClient.primeiroCandidatoElegivel(keys, cfg, { exigeImagem: true });
  assert.strictEqual(candidatoVisao.provider, 'openai');
  const base = contextEngine.montarContextoInvestigacao({ ...c.params(cfg, keys), candidatoOrcamento: candidatoVisao, permitirImagens: true });
  assert.ok(base.imagensSelecionadas.length >= 0);
  const imagens = [{ mimeType: 'image/png', base64: 'AAAA', origem: 'imagem', anexoId: c.imagem.id }];
  const preparador = investigacaoService._criarPreparadorPorCandidato({
    contexto: base,
    userPromptAtual: base.userPrompt,
    imagensAtuais: imagens,
    candidatoAtual: candidatoVisao,
    paramsContexto: c.params(cfg, keys),
    decorar: (ctx, prompt) => prompt,
  });
  const mock = instalarMockHttps({ 'api.openai.com': [CHAVE_INVALIDA], 'api.anthropic.com': [{ body: { content: [{ type: 'text', text: 'resposta claude' }], stop_reason: 'end_turn', usage: {} } }] });
  try {
    const r = await aiProviderClient.chamarIA(keys, cfg, promptBuilder.SYSTEM_PROMPT, base.userPrompt, imagens, {
      maxProviderRounds: 1,
      providerRetryDelayMs: 0,
      prepararParaCandidato: preparador.preparar,
    });
    const hosts = mock.chamadas.map(x => x.hostname);
    assert.ok(!hosts.includes('api.deepseek.com') && !hosts.includes('api.groq.com'), 'providers sem visao nao devem receber a imagem');
    assert.deepStrictEqual(hosts, ['api.openai.com', 'api.anthropic.com'], 'ordem cadastrada entre os providers com visao');
    assert.strictEqual(r.provider, 'claude');
    assert.strictEqual(r.tentativas.find(t => t.provider === 'claude').preparo.imagensEnviadas >= 0, true);
  } finally {
    mock.restaurar();
  }
}

// 6. Sem credencial no primario: nenhuma requisicao a ele; erro explicito sem providers.
async function testarSemCredenciais() {
  const cfg = { provedorPrimario: 'groq', fallbackOrdem: 'openai', modelos: MODELOS };
  const mock = instalarMockHttps({ 'api.openai.com': [OK('so openai')] });
  try {
    const r = await aiProviderClient.chamarIA({ openai: 'o' }, cfg, 'system', 'user', [], { maxProviderRounds: 1 });
    assert.strictEqual(r.provider, 'openai');
    assert.deepStrictEqual(mock.chamadas.map(x => x.hostname), ['api.openai.com']);
  } finally {
    mock.restaurar();
  }
  await assert.rejects(
    () => aiProviderClient.chamarIA({}, cfg, 'system', 'user', [], { maxProviderRounds: 1 }),
    err => err._semChave === true
  );
}

// 7. Guarda de janela residual (sem callback): barra so o que comprovadamente nao cabe.
async function testarGuardaDeJanelaResidual() {
  const cfg = { provedorPrimario: 'groq', fallbackOrdem: 'openai', modelos: MODELOS };
  const gigante = 'x '.repeat(70000); // ~70k tokens estimados: nao cabe no Groq (12k), cabe no OpenAI (128k)
  const mock = instalarMockHttps({ 'api.openai.com': [OK('ok')] });
  try {
    const r = await aiProviderClient.chamarIA({ groq: 'g', openai: 'o' }, cfg, 'system', gigante, [], { maxProviderRounds: 1 });
    assert.strictEqual(r.provider, 'openai');
    assert.deepStrictEqual(mock.chamadas.map(x => x.hostname), ['api.openai.com']);
    assert.ok(r.tentativas.some(t => t.provider === 'groq' && t.status === 'ignorado_janela'));
  } finally {
    mock.restaurar();
  }
  // Prompt normal: Groq e tentado normalmente (a guarda nao interfere em fluxo comum).
  const mock2 = instalarMockHttps({ 'api.groq.com': [OK('groq ok')] });
  try {
    const r = await aiProviderClient.chamarIA({ groq: 'g', openai: 'o' }, cfg, 'system', 'prompt curto', [], { maxProviderRounds: 1 });
    assert.strictEqual(r.provider, 'groq');
  } finally {
    mock2.restaurar();
  }
}

async function main() {
  try {
    testarElegibilidadeEOrdem();
    testarOrcamentoMudaComOModelo();
    await testarFallbackParaJanelaMaior();
    await testarFallbackParaJanelaMenor();
    await testarImagemSegueOrdemCadastrada();
    await testarSemCredenciais();
    await testarGuardaDeJanelaResidual();
    console.log('orcamento-por-candidato.test.js: ok (7 grupos de cenarios)');
  } finally {
    limparEDesligar();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
