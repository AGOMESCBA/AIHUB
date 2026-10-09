// Retry/fallback do ai-provider-client: erro transitorio (ECONNRESET/timeout/429)
// deve ser tentado novamente antes de persistir falha no chat. Erro permanente
// (chave invalida/credito) nao deve ficar martelando o provider.
//
// Estendido 2026-10 (auditoria do fallback multi-provider) com os cenarios:
// primario com sucesso, HTTP 429, timeout, contexto incompativel com o
// modelo, falha de todos os providers, erro global de TLS/certificado,
// resposta rejeitada pelo Quality Gate, e isolamento multiempresa durante
// fallback concorrente.

const assert = require('assert');
const https = require('https');
const { EventEmitter } = require('events');

const aiProviderClient = require('../backend/services/ai-provider-client');
const qualityGateService = require('../backend/services/quality-gate-service');

function instalarMockHttps(respostasPorHost) {
  const original = https.request;
  const chamadas = [];
  // respostasPorHost pode ser um array (fila unica, comportamento antigo) ou
  // um mapa { hostname: [fila de respostas] } para cenarios multi-provider.
  const filaUnica = Array.isArray(respostasPorHost) ? respostasPorHost : null;

  https.request = (options, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.setTimeout = () => {};
    req.destroy = err => req.emit('error', err);
    req.end = () => {
      const fila = filaUnica || respostasPorHost[options.hostname];
      const resposta = fila && fila.shift();
      chamadas.push({ hostname: options.hostname, path: options.path, resposta });
      process.nextTick(() => {
        if (!resposta) {
          req.emit('error', new Error(`Mock sem resposta configurada para ${options.hostname}`));
          return;
        }
        if (resposta.erro) {
          req.emit('error', new Error(resposta.erro));
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

  return {
    chamadas,
    restaurar() {
      https.request = original;
    },
  };
}

async function testarRetryTransitorioAteSucesso() {
  const mock = instalarMockHttps([
    { erro: 'read ECONNRESET' },
    { erro: 'read ECONNRESET' },
    { body: { choices: [{ message: { content: 'ok depois do retry' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } } },
  ]);

  try {
    const r = await aiProviderClient.chamarIA(
      { openai: 'sk-test' },
      { provedorPrimario: 'openai', fallbackOrdem: 'openai', modelos: { openai: 'gpt-4o-mini' } },
      'system',
      'user',
      [],
      { maxProviderRounds: 3, providerRetryDelayMs: 0 }
    );

    assert.strictEqual(r.texto, 'ok depois do retry');
    assert.strictEqual(r.provider, 'openai');
    assert.strictEqual(mock.chamadas.length, 3, 'ECONNRESET deve ter ate 3 tentativas');
    assert.deepStrictEqual(r.tentativas.map(t => t.rodada), [1, 2, 3]);
    assert.strictEqual(r.tentativas[0].transitorio, true);
  } finally {
    mock.restaurar();
  }
}

async function testarErroPermanenteNaoRetenta() {
  const mock = instalarMockHttps([
    { body: { error: { message: 'API key not valid. Please pass a valid API key.' } } },
  ]);

  try {
    await assert.rejects(
      () => aiProviderClient.chamarIA(
        { gemini: 'bad-key' },
        { provedorPrimario: 'gemini', fallbackOrdem: 'gemini', modelos: { gemini: 'gemini-3.5-flash' } },
        'system',
        'user',
        [],
        { maxProviderRounds: 3, providerRetryDelayMs: 0 }
      ),
      err => {
        assert.match(err.message, /API key not valid/);
        assert.strictEqual(mock.chamadas.length, 1, 'chave invalida nao deve ser retentada');
        assert.strictEqual(err._tentativas[0].permanente, true);
        return true;
      }
    );
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Cenario 1: provider primario com sucesso — nenhum fallback deve ser
// acionado (comportamento de caminho feliz, baseline de todos os outros).
// ---------------------------------------------------------------------------
async function testarPrimarioComSucesso() {
  const mock = instalarMockHttps([
    { body: { choices: [{ message: { content: 'resposta do primario' }, finish_reason: 'stop' }], usage: { total_tokens: 20 } } },
  ]);
  try {
    const r = await aiProviderClient.chamarIA(
      { groq: 'g-key', openai: 'o-key' },
      { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
      'system', 'user', [],
      { maxProviderRounds: 3, providerRetryDelayMs: 0 }
    );
    assert.strictEqual(r.provider, 'groq');
    assert.strictEqual(mock.chamadas.length, 1, 'sucesso no primario nao deve acionar fallback');
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Cenario 2: provider primario retorna HTTP 429 (rate limit) — deve cair
// para o proximo provider elegivel na MESMA rodada, nao esperar rodada nova.
// ---------------------------------------------------------------------------
async function testarPrimario429CaiParaProximoProvider() {
  const mock = instalarMockHttps({
    'api.groq.com': [{ body: { error: { message: 'Rate limit reached for model ... 429' } } }],
    'api.openai.com': [{ body: { choices: [{ message: { content: 'resposta do fallback openai' }, finish_reason: 'stop' }], usage: { total_tokens: 15 } } }],
  });
  try {
    const r = await aiProviderClient.chamarIA(
      { groq: 'g-key', openai: 'o-key' },
      { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
      'system', 'user', [],
      { maxProviderRounds: 3, providerRetryDelayMs: 0 }
    );
    assert.strictEqual(r.provider, 'openai', '429 no groq deve cair para openai');
    assert.strictEqual(r.texto, 'resposta do fallback openai');
    assert.strictEqual(mock.chamadas.length, 2, '429 + sucesso no fallback = 2 chamadas na mesma rodada');
    assert.strictEqual(r.tentativas[0].transitorio, true);
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Cenario 3: timeout no primario — mesmo comportamento de transitorio,
// cai para o proximo provider.
// ---------------------------------------------------------------------------
async function testarTimeoutNoPrimarioCaiParaFallback() {
  const mock = instalarMockHttps({
    'api.groq.com': [{ erro: 'Timeout de 45s excedido.' }],
    'api.openai.com': [{ body: { choices: [{ message: { content: 'resposta apos timeout' }, finish_reason: 'stop' }], usage: {} } }],
  });
  try {
    const r = await aiProviderClient.chamarIA(
      { groq: 'g-key', openai: 'o-key' },
      { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
      'system', 'user', [],
      { maxProviderRounds: 3, providerRetryDelayMs: 0 }
    );
    assert.strictEqual(r.provider, 'openai');
    assert.strictEqual(r.tentativas[0].transitorio, true);
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Regressao (achado real na homologacao real do fallback, 2026-10): a
// mensagem REAL de rate limit do GROQ inclui um link de upsell contendo a
// palavra "billing" ("...Upgrade to Dev Tier today at .../settings/billing"),
// e o padrao antigo de erro permanente (/billing/i solto) classificava isso
// como permanente — rate limit (transitorio) nunca pode ser tratado como
// permanente, senao o provider fica banido da rodada por engano.
// ---------------------------------------------------------------------------
async function testarRateLimitComLinkDeBillingNaoEhPermanente() {
  const mensagemRealGroq = 'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01kpbydmcbe23sqtm9aaw861w1` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7985, Requested 3603. Please try again in 26.91s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing';
  const mock = instalarMockHttps({
    'api.groq.com': [{ body: { error: { message: mensagemRealGroq } } }],
    'api.openai.com': [{ body: { choices: [{ message: { content: 'resposta via openai' }, finish_reason: 'stop' }], usage: {} } }],
  });
  try {
    const r = await aiProviderClient.chamarIA(
      { groq: 'g-key', openai: 'o-key' },
      { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
      'system', 'user', [],
      { maxProviderRounds: 3, providerRetryDelayMs: 0 }
    );
    assert.strictEqual(r.provider, 'openai');
    assert.strictEqual(r.tentativas[0].transitorio, true, 'rate limit com link de billing incidental deve ser transitorio');
    assert.strictEqual(r.tentativas[0].permanente, false, 'rate limit NUNCA pode ser classificado como permanente');
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Cenario 4: modelo incompatível com o tamanho do contexto — NAO deve
// retentar o mesmo provider (prompt nao muda de tamanho entre tentativas);
// deve pular direto para o proximo candidato, marcado como erro de contexto,
// nao como transitorio generico.
// ---------------------------------------------------------------------------
async function testarContextoIncompativelPulaProvider() {
  const mock = instalarMockHttps({
    'api.groq.com': [
      { body: { error: { message: "This model's maximum context length is 4096 tokens. However, your messages resulted in 9000 tokens." } } },
    ],
    'api.openai.com': [{ body: { choices: [{ message: { content: 'resposta com modelo de contexto maior' }, finish_reason: 'stop' }], usage: {} } }],
  });
  try {
    const r = await aiProviderClient.chamarIA(
      { groq: 'g-key', openai: 'o-key' },
      { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
      'system', 'user', [],
      { maxProviderRounds: 3, providerRetryDelayMs: 0 }
    );
    assert.strictEqual(r.provider, 'openai');
    // apenas 1 chamada ao groq (nao retentado) + 1 ao openai = 2 no total
    assert.strictEqual(mock.chamadas.filter(c => c.hostname === 'api.groq.com').length, 1, 'contexto excedido NAO deve retentar o mesmo provider');
    assert.strictEqual(r.tentativas[0].contextoExcedido, true);
    assert.strictEqual(r.tentativas[0].permanente, true, 'contexto excedido deve ser tratado como permanente PARA ESTE PROVIDER (pular, nao retentar)');
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Cenario 5: falha de TODOS os providers configurados — erro final deve
// listar cada provider e motivo, sem mascarar qual falhou por que.
// ---------------------------------------------------------------------------
async function testarFalhaDeTodosOsProviders() {
  const mock = instalarMockHttps({
    'api.groq.com': [{ erro: 'read ECONNRESET' }],
    'api.openai.com': [{ body: { error: { message: 'API key not valid.' } } }],
  });
  try {
    await assert.rejects(
      () => aiProviderClient.chamarIA(
        { groq: 'g-key', openai: 'bad-key' },
        { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
        'system', 'user', [],
        { maxProviderRounds: 1, providerRetryDelayMs: 0 }
      ),
      err => {
        assert.match(err.message, /Todos os providers falharam/);
        assert.match(err.message, /groq:/);
        assert.match(err.message, /openai:/);
        assert.strictEqual(err._tentativas.length, 2);
        return true;
      }
    );
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Cenario 6: erro global de certificado/TLS — deve interromper a sequencia
// de fallback INTEIRA (nao gastar uma tentativa por provider sabendo que
// todos vao falhar pelo mesmo motivo de ambiente).
// ---------------------------------------------------------------------------
async function testarErroTlsGlobalInterrompeSequencia() {
  const mock = instalarMockHttps({
    'api.groq.com': [{ erro: 'unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca' }],
    'api.openai.com': [{ body: { choices: [{ message: { content: 'nunca deveria chegar aqui' }, finish_reason: 'stop' }], usage: {} } }],
  });
  try {
    await assert.rejects(
      () => aiProviderClient.chamarIA(
        { groq: 'g-key', openai: 'o-key' },
        { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
        'system', 'user', [],
        { maxProviderRounds: 3, providerRetryDelayMs: 0 }
      ),
      err => {
        assert.strictEqual(mock.chamadas.length, 1, 'erro de TLS global deve interromper a sequencia ANTES de tentar o proximo provider');
        assert.strictEqual(err._tentativas[0].tlsGlobal, true);
        return true;
      }
    );
  } finally {
    mock.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Cenario 7: resposta aceita pelo provider, mas REJEITADA pelo Quality Gate —
// uma resposta rejeitada nao deve ser apresentada como solucao validada
// (checagem de contrato do Quality Gate, nao do ai-provider-client).
// ---------------------------------------------------------------------------
function testarRespostaRejeitadaPeloQualityGateNaoEhValidada() {
  const respostaGenerica = 'Verifique os logs. Envie mais informacoes. Pode ser um problema de configuracao.';
  const manifesto = { selecionados: [{ tipo: 'anexo', status: 'ANALISADA', nome: 'erro.log' }], omitidos: [] };
  const resultado = qualityGateService.avaliarResposta({
    textoResposta: respostaGenerica,
    manifesto,
    pergunta: 'o que esta causando o erro?',
  });
  assert.strictEqual(resultado.aprovado, false, 'resposta generica com evidencia disponivel deve ser rejeitada');
  assert.ok(resultado.falhas.some(f => f.codigo === 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE'));
  // Contrato explicito: o motor NUNCA deve tratar aprovado:false como
  // "resposta final valida" — quem consome avaliarResposta() precisa checar
  // aprovado antes de persistir/exibir como solucao.
  assert.strictEqual(resultado.deveRetry, true, 'resposta rejeitada deve sinalizar necessidade de retry, nao ser aceita direto');
}

// ---------------------------------------------------------------------------
// Cenario 8: isolamento multiempresa durante fallback concorrente — duas
// "empresas" com credenciais DIFERENTES disparando chamarIA ao mesmo tempo
// nunca podem ter suas chaves/providers cruzados entre si.
// ---------------------------------------------------------------------------
async function testarIsolamentoMultiempresaDuranteFallbackConcorrente() {
  const mock = instalarMockHttps({
    'api.groq.com': [
      { erro: 'read ECONNRESET' }, // empresa A: groq falha
      { erro: 'read ECONNRESET' }, // empresa B: groq falha
    ],
    'api.openai.com': [
      { body: { choices: [{ message: { content: 'resposta empresa A via openai' }, finish_reason: 'stop' }], usage: {} } },
    ],
    'api.anthropic.com': [
      { body: { content: [{ text: 'resposta empresa B via claude' }] } },
    ],
  });
  try {
    const [resultadoA, resultadoB] = await Promise.all([
      aiProviderClient.chamarIA(
        { groq: 'chave-empresa-A', openai: 'chave-empresa-A-openai' },
        { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
        'system', 'pergunta da empresa A', [],
        { maxProviderRounds: 1, providerRetryDelayMs: 0 }
      ),
      aiProviderClient.chamarIA(
        { groq: 'chave-empresa-B', claude: 'chave-empresa-B-claude' },
        { provedorPrimario: 'groq', fallbackOrdem: 'groq,claude', modelos: { groq: 'openai/gpt-oss-20b', claude: 'claude-haiku-4-5-20251001' } },
        'system', 'pergunta da empresa B', [],
        { maxProviderRounds: 1, providerRetryDelayMs: 0 }
      ),
    ]);

    assert.strictEqual(resultadoA.provider, 'openai', 'empresa A deve cair para openai (nao tem claude configurado)');
    assert.strictEqual(resultadoA.texto, 'resposta empresa A via openai');
    assert.strictEqual(resultadoB.provider, 'claude', 'empresa B deve cair para claude (nao tem openai configurado)');
    assert.strictEqual(resultadoB.texto, 'resposta empresa B via claude');
  } finally {
    mock.restaurar();
  }
}

async function main() {
  await testarRetryTransitorioAteSucesso();
  await testarErroPermanenteNaoRetenta();
  await testarPrimarioComSucesso();
  await testarPrimario429CaiParaProximoProvider();
  await testarTimeoutNoPrimarioCaiParaFallback();
  await testarRateLimitComLinkDeBillingNaoEhPermanente();
  await testarContextoIncompativelPulaProvider();
  await testarFalhaDeTodosOsProviders();
  await testarErroTlsGlobalInterrompeSequencia();
  testarRespostaRejeitadaPeloQualityGateNaoEhValidada();
  await testarIsolamentoMultiempresaDuranteFallbackConcorrente();
  console.log('ai-provider-retry.test.js: ok (11 cenarios)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
