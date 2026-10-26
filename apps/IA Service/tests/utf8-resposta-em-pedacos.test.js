'use strict';
// Regressao 2026-10-26 (producao): resposta da IA com "restri��ões". A resposta
// HTTP chega em pedacos; `raw += chunk` convertia cada Buffer sozinho e o
// caractere UTF-8 partido no corte virava U+FFFD. Sem rede: https.request e
// simulado entregando o corpo em pedacos de 1 byte (todo acento e partido).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');
const aiProviderClient = require('../backend/services/ai-provider-client');

const TEXTO = 'Revise as restrições, configurações e parâmetros: não há ação ç ã õ é — “ok” 🙂';

function simularHttps(corpoJson) {
  const original = https.request;
  https.request = (_opts, onResponse) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.setTimeout = () => {};
    req.end = () => {
      const res = new PassThrough();
      res.statusCode = 200;
      onResponse(res);
      const bytes = Buffer.from(JSON.stringify(corpoJson), 'utf8');
      for (let i = 0; i < bytes.length; i++) res.write(bytes.subarray(i, i + 1));
      res.end();
    };
    return req;
  };
  return () => { https.request = original; };
}

test('resposta do provider em pedaços de 1 byte mantém acentos e emoji', async () => {
  const restaurar = simularHttps({ choices: [{ message: { content: TEXTO }, finish_reason: 'stop' }], usage: {} });
  try {
    const r = await aiProviderClient.chamarProvedor('openai', 'chave-teste', 'sys', 'user', [], { maxTokens: 50 });
    const texto = r.content ?? r.texto;
    assert.equal(texto, TEXTO);
    assert.ok(!texto.includes('�'), 'sem caractere de substituição');
  } finally { restaurar(); }
});
