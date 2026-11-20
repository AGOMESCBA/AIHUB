// Fase 1 (2026-11-12): a auditoria grava as contagens de uso do provider
// (prompt_tokens, completion_tokens, total_tokens) e calcula custo pela tabela
// de preços. Prova também que credenciais com "token" no nome continuam
// mascaradas (autorização do usuário: liberação só por lista explícita).
const assert = require('assert');
const os = require('os');
const path = require('path');

const database = require('../backend/database');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const { redigirTexto, redigirValor } = require('../backend/services/redaction-service');
const custoIa = require('../backend/services/custo-ia-service');

const SEGREDO = 'sk-segredo-NAO-PODE-VAZAR-123456';

function testarContagensLiberadas() {
  const usage = { prompt_tokens: 6351, completion_tokens: 812, total_tokens: 7163 };
  assert.deepStrictEqual(redigirValor(usage), usage);
  assert.deepStrictEqual(redigirValor({ uso: { usage } }), { uso: { usage } });
  // Cache de prompt (2026-11-19): o detalhe é percorrido e só a contagem
  // numérica liberada passa; o restante dentro dele segue a regra geral.
  const comCache = { prompt_tokens: 9000, prompt_tokens_details: { cached_tokens: 7680, audio_tokens: SEGREDO } };
  assert.deepStrictEqual(redigirValor(comCache), { prompt_tokens: 9000, prompt_tokens_details: { cached_tokens: 7680, audio_tokens: '[REDACTED]' } });
  const claude = { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 };
  assert.deepStrictEqual(redigirValor(claude), claude);
}

function testarSegredosContinuamMascarados() {
  const entrada = {
    token: SEGREDO,
    access_token: SEGREDO,
    refresh_token: SEGREDO,
    session_token: SEGREDO,
    accessToken: SEGREDO,
    api_key: SEGREDO,
    apiKey: SEGREDO,
    openaiApiKey: SEGREDO,
    'x-api-key': SEGREDO,
    authorization: `Bearer ${SEGREDO}`,
    Authorization: `Bearer ${SEGREDO}`,
    password: SEGREDO,
    senha: SEGREDO,
    secret: SEGREDO,
    client_secret: SEGREDO,
    cookie: SEGREDO,
    // Nome liberado, mas valor que não é número: continua mascarado.
    prompt_tokens: SEGREDO,
    total_tokens: { valor: SEGREDO },
    completion_tokens: '812',
    // Fora da lista: variação de caixa e outros campos de uso.
    Prompt_Tokens: 10,
    // Detalhe do usage só é percorrido quando é objeto; em texto, mascarado.
    prompt_tokens_details: SEGREDO,
    completion_tokens_details: { cached_tokens: '5', refresh_token: SEGREDO },
    tokensEstimadosPrompt: 100,
    aninhado: [{ headers: { Authorization: `Bearer ${SEGREDO}`, 'x-api-key': SEGREDO } }],
    texto: `Authorization: Bearer ${SEGREDO} token=${SEGREDO} api_key=${SEGREDO}`,
    url: `https://api.exemplo.com/v1?token=${SEGREDO}&api_key=${SEGREDO}`,
  };
  const saida = redigirValor(entrada);
  const json = JSON.stringify(saida);
  assert.ok(!json.includes(SEGREDO), `segredo vazou: ${json}`);
  assert.ok(!json.includes('"812"'), 'contagem em texto não é liberada');
  for (const chave of ['Prompt_Tokens', 'prompt_tokens_details', 'tokensEstimadosPrompt']) {
    assert.strictEqual(saida[chave], '[REDACTED]', `${chave} deve continuar mascarado`);
  }
  // Em texto livre, "token=" continua mascarado (inclusive dentro de outro nome).
  assert.ok(!redigirTexto(`session_token=${SEGREDO} access_token=${SEGREDO}`).includes(SEGREDO));
}

function testarPersistenciaNaAuditoria() {
  database.inicializarDB(path.join(os.tmpdir(), `ia-service-uso-tokens-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  try {
    const atendimento = atendimentoRepo.criarAtendimento(9901, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'uso de tokens' });
    execucaoRepo.salvarExecucao(9901, {
      atendimentoId: atendimento.id,
      provider: 'openai',
      model: 'gpt-5.4',
      usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500, prompt_tokens_details: { cached_tokens: 1024 } },
      pesquisa: { erro: `falhou com token=${SEGREDO}`, headers: { authorization: `Bearer ${SEGREDO}` } },
      tentativas: [{ erro: `api_key=${SEGREDO}` }],
    });
    const [exec] = execucaoRepo.listarPorAtendimento(9901, atendimento.id);
    assert.strictEqual(exec.usage.prompt_tokens, 1200);
    assert.strictEqual(exec.usage.completion_tokens, 300);
    assert.strictEqual(exec.usage.total_tokens, 1500);
    assert.strictEqual(exec.usage.prompt_tokens_details.cached_tokens, 1024);
    assert.ok(!JSON.stringify(exec).includes(SEGREDO));
  } finally {
    database.fecharDB();
  }
}

function testarCusto() {
  const tabela = { moeda: 'USD', modelos: { openai: { 'gpt-5.4': { entrada: 2, saida: 10 }, 'gpt-4o': { entrada: null, saida: null } } } };
  const usage = { prompt_tokens: 1000000, completion_tokens: 100000 };

  const exato = custoIa.estimarCusto({ provider: 'openai', model: 'gpt-5.4', usage }, tabela);
  assert.strictEqual(exato.custo, 3);
  assert.strictEqual(exato.motivo, null);

  const datado = custoIa.estimarCusto({ provider: 'openai', model: 'gpt-5.4-2026-03-05', usage }, tabela);
  assert.strictEqual(datado.custo, 3, 'versão datada usa o preço do modelo base');

  assert.strictEqual(custoIa.estimarCusto({ provider: 'openai', model: 'gpt-4o', usage }, tabela).motivo, 'sem_preco');
  assert.strictEqual(custoIa.estimarCusto({ provider: 'openai', model: 'gpt-4o-mini', usage }, tabela).motivo, 'modelo_sem_preco');
  assert.strictEqual(custoIa.estimarCusto({ provider: 'claude', model: 'gpt-5.4', usage }, tabela).motivo, 'modelo_sem_preco');
  // Cache de prompt (2026-11-19): a parte cacheada sai do preço cheio e entra
  // pelo preço entradaCache; sem esse preço, custo null em vez de valor errado.
  const tabelaCache = { moeda: 'USD', modelos: { openai: { 'gpt-5.4': { entrada: 2, entradaCache: 0.2, saida: 10 } } } };
  const usageCache = { prompt_tokens: 1000000, completion_tokens: 100000, prompt_tokens_details: { cached_tokens: 600000 } };
  const comCache = custoIa.estimarCusto({ provider: 'openai', model: 'gpt-5.4', usage: usageCache }, tabelaCache);
  assert.strictEqual(Number(comCache.custo.toFixed(6)), 1.92, '400k cheio (0,8) + 600k cache (0,12) + saída (1)');
  assert.strictEqual(comCache.tokensEntradaCache, 600000);
  const semPrecoCache = custoIa.estimarCusto({ provider: 'openai', model: 'gpt-5.4', usage: usageCache }, tabela);
  assert.strictEqual(semPrecoCache.custo, null);
  assert.strictEqual(semPrecoCache.motivo, 'sem_preco_cache');
  assert.strictEqual(custoIa.estimarCusto({ provider: 'openai', model: 'gpt-5.4', usage: { ...usage, prompt_tokens_details: { cached_tokens: 0 } } }, tabela).custo, 3, 'cache zerado: preço cheio');
  const semUso = custoIa.estimarCusto({ provider: 'openai', model: 'gpt-5.4', usage: { prompt_tokens: '[REDACTED]' } }, tabela);
  assert.strictEqual(semUso.custo, null);
  assert.strictEqual(semUso.motivo, 'sem_contagem_de_tokens');

  // A tabela real em configuração precisa carregar e ter o formato esperado.
  const real = custoIa.carregarTabela();
  assert.ok(real.modelos && typeof real.modelos === 'object');
}

testarContagensLiberadas();
testarSegredosContinuamMascarados();
testarPersistenciaNaAuditoria();
testarCusto();
console.log('auditoria-uso-tokens.test.js: ok');
