// Retry/fallback do ai-provider-client: erro transitorio (ECONNRESET/timeout/429)
// deve ser tentado novamente antes de persistir falha no chat. Erro permanente
// (chave invalida/credito) nao deve ficar martelando o provider.

const assert = require('assert');
const https = require('https');
const { EventEmitter } = require('events');

const aiProviderClient = require('../backend/services/ai-provider-client');

function instalarMockHttps(respostas) {
  const original = https.request;
  const chamadas = [];

  https.request = (options, cb) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.setTimeout = () => {};
    req.destroy = err => req.emit('error', err);
    req.end = () => {
      const resposta = respostas.shift();
      chamadas.push({ hostname: options.hostname, path: options.path, resposta });
      process.nextTick(() => {
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

async function main() {
  await testarRetryTransitorioAteSucesso();
  await testarErroPermanenteNaoRetenta();
  console.log('ai-provider-retry.test.js: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
