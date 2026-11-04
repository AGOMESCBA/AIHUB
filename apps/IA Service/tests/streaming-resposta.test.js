'use strict';
// Resposta em streaming (2026-11-04, #036914: ~18 s de tela parada com
// gpt-5.4). O texto chega em pedaços (SSE da OpenAI) e vai para o rascunho do
// progresso do turno; o chat mostra enquanto a IA escreve. Sem callback, nada
// muda. Stream cortado nunca vira resposta "completa": é retentado.
// Sem rede: https.request simulado. Dados sintéticos.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const aiProviderClient = require('../backend/services/ai-provider-client');
const progressoTurno = require('../backend/services/progresso-turno-service');
const investigacao = require('../backend/services/investigacao-service');

const original = https.request;
afterEach(() => { https.request = original; });

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content) => sse({ choices: [{ index: 0, delta: { content } }] });
const fim = (finish = 'stop') => sse({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }) + sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + 'data: [DONE]\n\n';

// Cada resposta: { sse: [pedaços], cortar?: true } ou { json: corpo }.
function mock(respostas) {
  const chamadas = [];
  https.request = (options, cb) => {
    const req = new EventEmitter();
    let body = '';
    req.write = (c) => { body += String(c); };
    req.end = () => {
      const r = respostas.shift();
      chamadas.push({ hostname: options.hostname, body: JSON.parse(body) });
      process.nextTick(() => {
        const res = new EventEmitter();
        res.setEncoding = () => {};
        res.complete = false;
        res.headers = { 'content-type': r.json ? 'application/json' : 'text/event-stream; charset=utf-8' };
        cb(res);
        for (const p of r.sse || [JSON.stringify(r.json)]) res.emit('data', p);
        if (r.cortar) { res.emit('close'); return; }
        res.complete = true;
        res.emit('end');
        res.emit('close');
      });
    };
    return req;
  };
  return chamadas;
}

const KEYS = { openai: 'k' };
const CFG = { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: 'gpt-5.4-2026-03-05' } };

test('texto chega em pedaços no callback e o resultado final é o mesmo', async () => {
  // Linha SSE partida entre dois pedaços da rede, com acento.
  const tudo = delta('Verifique o parâmetro ') + delta('MV_ESTNEG.') + fim();
  const chamadas = mock([{ sse: [tudo.slice(0, 37), tudo.slice(37)] }]);
  const vistos = [];
  const r = await aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'pergunta', [], { aoReceberTexto: (t) => vistos.push(t) });
  assert.equal(r.texto, 'Verifique o parâmetro MV_ESTNEG.');
  assert.equal(r.truncado, false);
  assert.deepEqual(r.usage, { prompt_tokens: 10, completion_tokens: 5 });
  assert.deepEqual(vistos, ['', 'Verifique o parâmetro ', 'Verifique o parâmetro MV_ESTNEG.']);
  assert.equal(chamadas[0].body.stream, true);
  assert.deepEqual(chamadas[0].body.stream_options, { include_usage: true });
});

test('finish_reason=length continua marcando resposta truncada', async () => {
  mock([{ sse: [delta('Parte'), fim('length')] }]);
  const r = await aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'p', [], { aoReceberTexto: () => {} });
  assert.equal(r.truncado, true);
});

test('sem callback: chamada normal, sem streaming (demais usos não mudam)', async () => {
  const chamadas = mock([{ json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} } }]);
  const r = await aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'p', []);
  assert.equal(r.texto, 'ok');
  assert.equal(chamadas[0].body.stream, undefined);
});

test('conexão cortada no meio: não entrega texto parcial, tenta de novo e zera o rascunho', async () => {
  mock([{ sse: [delta('Texto que vai ')], cortar: true }, { sse: [delta('Resposta inteira.'), fim()] }]);
  const vistos = [];
  const r = await aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'p', [], { aoReceberTexto: (t) => vistos.push(t), providerRetryDelayMs: 1 });
  assert.equal(r.texto, 'Resposta inteira.');
  assert.deepEqual(vistos, ['', 'Texto que vai ', '', 'Resposta inteira.']);
  assert.equal(r.tentativas[0].status, 'erro');
  assert.match(r.tentativas[0].erro, /ECONNRESET/);
});

test('stream que termina sem finish_reason é falha transitória (retentada)', async () => {
  mock([{ sse: [delta('meio')] }, { sse: [delta('ok'), fim()] }]);
  const r = await aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'p', [], { aoReceberTexto: () => {}, providerRetryDelayMs: 1 });
  assert.equal(r.texto, 'ok');
  assert.equal(r.tentativas.length, 2);
});

test('erro da API em JSON (não SSE) mantém a mensagem e a classificação de antes', async () => {
  mock([{ json: { error: { message: 'Incorrect API key provided' } } }]);
  await assert.rejects(
    aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'p', [], { aoReceberTexto: () => {} }),
    (e) => /Incorrect API key/.test(e.message) && e._tentativas.length === 1,
  );
});

test('resposta inteira em JSON mesmo pedindo streaming (proxy/API) vale como antes', async () => {
  mock([{ json: { choices: [{ message: { content: 'Resposta completa' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } } }]);
  const r = await aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'p', [], { aoReceberTexto: () => {} });
  assert.equal(r.texto, 'Resposta completa');
  assert.deepEqual(r.usage, { total_tokens: 3 });
});

test('falha de quem mostra o rascunho nunca derruba a chamada à IA', async () => {
  mock([{ sse: [delta('ok'), fim()] }]);
  const r = await aiProviderClient.chamarIA(KEYS, CFG, 'sys', 'p', [], { aoReceberTexto: () => { throw new Error('tela'); } });
  assert.equal(r.texto, 'ok');
});

// ── Claude (Anthropic), reserva do gpt-5.4: mesmo rascunho, formato próprio ──
const ev = (obj) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
const claudeInicio = ev({ type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 1 } } }) + ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + ev({ type: 'ping' });
const claudeTexto = (text) => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
const claudeFim = (stop = 'end_turn') => ev({ type: 'content_block_stop', index: 0 }) + ev({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 9 } }) + ev({ type: 'message_stop' });
const CFG_RESERVA = { provedorPrimario: 'openai', fallbackOrdem: 'claude', modelos: { openai: 'gpt-5.4-2026-03-05', claude: 'claude-sonnet-4-6' } };

test('Claude: texto em pedaços, uso de tokens e fim como na resposta sem streaming', async () => {
  const tudo = claudeInicio + claudeTexto('Confira o ') + claudeTexto('parâmetro MV_ESTNEG.') + claudeFim();
  const chamadas = mock([{ sse: [tudo.slice(0, 250), tudo.slice(250)] }]);
  const vistos = [];
  const r = await aiProviderClient.chamarIA({ claude: 'k' }, { provedorPrimario: 'claude', fallbackOrdem: '', modelos: { claude: 'claude-sonnet-4-6' } }, 'sys', 'p', [], { aoReceberTexto: (t) => vistos.push(t) });
  assert.equal(r.texto, 'Confira o parâmetro MV_ESTNEG.');
  assert.equal(r.provider, 'claude');
  assert.equal(r.truncado, false);
  assert.deepEqual(r.usage, { input_tokens: 50, output_tokens: 9 });
  assert.deepEqual(vistos, ['', 'Confira o ', 'Confira o parâmetro MV_ESTNEG.']);
  assert.equal(chamadas[0].hostname, 'api.anthropic.com');
  assert.equal(chamadas[0].body.stream, true);
});

test('Claude: max_tokens marca truncada; dois blocos de texto juntam com quebra de linha', async () => {
  const segundo = ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }) + ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'B' } });
  mock([{ sse: [claudeInicio + claudeTexto('A') + segundo + claudeFim('max_tokens')] }]);
  const r = await aiProviderClient.chamarIA({ claude: 'k' }, { provedorPrimario: 'claude', fallbackOrdem: '', modelos: { claude: 'm' } }, 'sys', 'p', [], { aoReceberTexto: () => {} });
  assert.equal(r.texto, 'A\nB');
  assert.equal(r.truncado, true);
});

test('Claude: erro no meio do stream (overloaded) é transitório e retentado', async () => {
  mock([
    { sse: [claudeInicio + claudeTexto('meio') + ev({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })] },
    { sse: [claudeInicio + claudeTexto('ok') + claudeFim()] },
  ]);
  const r = await aiProviderClient.chamarIA({ claude: 'k' }, { provedorPrimario: 'claude', fallbackOrdem: '', modelos: { claude: 'm' } }, 'sys', 'p', [], { aoReceberTexto: () => {}, providerRetryDelayMs: 1 });
  assert.equal(r.texto, 'ok');
  assert.match(r.tentativas[0].erro, /Overloaded/);
});

test('OpenAI cai no meio → Claude assume na mesma rodada, com o rascunho recomeçando', async () => {
  const chamadas = mock([
    { sse: [delta('Começo da OpenAI')], cortar: true },
    { sse: [claudeInicio + claudeTexto('Resposta do Claude.') + claudeFim()] },
  ]);
  const vistos = [];
  const r = await aiProviderClient.chamarIA({ openai: 'k', claude: 'k' }, CFG_RESERVA, 'sys', 'p', [], { aoReceberTexto: (t) => vistos.push(t) });
  assert.equal(r.texto, 'Resposta do Claude.');
  assert.equal(r.provider, 'claude');
  assert.equal(r.model, 'claude-sonnet-4-6');
  assert.deepEqual(chamadas.map(c => c.hostname), ['api.openai.com', 'api.anthropic.com']);
  assert.deepEqual(vistos, ['', 'Começo da OpenAI', '', 'Resposta do Claude.']);
});

test('Claude sem callback: chamada normal sem streaming; JSON inteiro também vale com callback', async () => {
  const json = { content: [{ type: 'text', text: 'Inteira' }], stop_reason: 'end_turn', usage: { input_tokens: 1 } };
  const chamadas = mock([{ json }, { json }]);
  const cfg = { provedorPrimario: 'claude', fallbackOrdem: '', modelos: { claude: 'm' } };
  assert.equal((await aiProviderClient.chamarIA({ claude: 'k' }, cfg, 'sys', 'p', [])).texto, 'Inteira');
  assert.equal(chamadas[0].body.stream, undefined);
  assert.equal((await aiProviderClient.chamarIA({ claude: 'k' }, cfg, 'sys', 'p', [], { aoReceberTexto: () => {} })).texto, 'Inteira');
});

test('rascunho do chat nunca mostra o bloco interno de observações visuais', () => {
  const r = investigacao._textoRascunhoParaChat;
  assert.equal(r('<<<OBSERVACOES_VISUAIS_AUDITORIA>>>\n{"observacoesVisuais":[{"anexoId":"a","textos'), '');
  assert.equal(r('<<<OBSERV'), '');
  assert.equal(r('{"observ'), '');
  assert.equal(r('```json\n{"observacoesVisuais":[]'), '');
  assert.equal(r('<<<OBSERVACOES_VISUAIS_AUDITORIA>>>\n{"observacoesVisuais":[]}\n<<<FIM_OBSERVACOES_VISUAIS_AUDITORIA>>>\n\nVerifique a rotina MATA410.'), 'Verifique a rotina MATA410.');
  assert.equal(r('{"observacoesVisuais":[{"nome":"x"}]}\n\nResposta ao analista.'), 'Resposta ao analista.');
  assert.equal(r('## Diagnóstico\nO erro vem do parâmetro <<<FIM'), 'Diagnóstico\nO erro vem do parâmetro');
});

test('progresso do turno guarda o rascunho só durante o turno e por empresa', () => {
  progressoTurno.registrarRascunho(1, 'sem-turno', 'x');
  assert.equal(progressoTurno.obter(1, 'sem-turno').rascunho, undefined, 'sem turno iniciado nada é guardado');
  progressoTurno.iniciar(1, 'at');
  progressoTurno.registrarRascunho(1, 'at', 'Texto parcial');
  assert.equal(progressoTurno.obter(1, 'at').rascunho, 'Texto parcial');
  assert.equal(progressoTurno.obter(2, 'at').rascunho, undefined, 'outra empresa não vê');
  progressoTurno.registrarRascunho(1, 'at', '');
  assert.equal(progressoTurno.obter(1, 'at').rascunho, undefined);
  progressoTurno.registrarRascunho(1, 'at', 'de novo');
  progressoTurno.finalizar(1, 'at');
  assert.deepEqual(progressoTurno.obter(1, 'at'), { etapas: [] });
});
