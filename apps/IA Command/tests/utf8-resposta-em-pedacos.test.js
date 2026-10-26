'use strict';
// Regressao 2026-10-26: acento partido entre pedacos da resposta HTTP virava
// "��" (visto no IA Service: "restri��ões"; mesmo padrao `raw += chunk` no IA
// Command). Sem rede: https.request simulado entregando 1 byte por pedaco.
// Executar: node --test "apps/IA Command/tests/utf8-resposta-em-pedacos.test.js"
const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');

const TEXTO = 'Títulos da filial São José: não há restrições; ação pendente — “ok” 🙂';

function simularHttps(corpoJson) {
  const original = https.request;
  https.request = (_opts, onResponse) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.setTimeout = () => req;
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

test('cliente de IA do ERP (chat Protheus) mantém acentos com resposta em pedaços de 1 byte', async () => {
  const { _httpPost } = require('../modules/erp/core/ai-provider-client');
  const restaurar = simularHttps({ choices: [{ message: { content: TEXTO } }] });
  try {
    const r = await _httpPost('api.openai.com', '/v1/chat/completions', {}, { x: 1 });
    const texto = r.choices[0].message.content;
    assert.equal(texto, TEXTO);
    assert.ok(!texto.includes('�'));
  } finally { restaurar(); }
});

test('classificador de intenção (OpenAI) mantém acentos com resposta em pedaços de 1 byte', async () => {
  const { classificarIntencao } = require('../modules/ai/providers/openai');
  const restaurar = simularHttps({ choices: [{ message: { content: JSON.stringify({ intencao: 'financeiro', resumo: TEXTO }) } }] });
  try {
    const r = await classificarIntencao('quais títulos?', 'chave-teste', [{ codigo: 'financeiro', descricao: 'Financeiro' }]);
    assert.equal(r.resumo, TEXTO);
  } finally { restaurar(); }
});
