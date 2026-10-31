'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');

function preparar() {
  const rotas = new Map(), chamadas = [];
  const auth = () => {}, admin = () => {};
  const db = { pragma() {}, prepare(sql) {
    assert.match(sql, /^SELECT \* FROM platform_ai_configs WHERE empresa_id = \?$/);
    return { get(empresa) { assert.equal(empresa, 1); return { openai_modelo: 'gpt-4o', openai_api_key_enc: 'fixture-salva' }; } };
  } };
  const filename = path.resolve(__dirname, '../../IAHUB/backend/platform-routes.js');
  const m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = m.require.bind(m);
  m.require = id => {
    if (id === 'better-sqlite3') return function () { return db; };
    if (id === './platform-schema') return { ensurePlatformSchema() {} };
    if (id === './platform-import-ia-command') return {};
    if (id === './platform-access-routes') return { registrarRotas() {} };
    if (id === '../../IA Service/backend/services/ai-provider-client') return {
      PROVIDER_CONFIGS: { openai: { model: 'gpt-4o-mini' } },
      chamarProvedor: async (...args) => { chamadas.push(args); },
    };
    return realRequire(id);
  };
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  const app = Object.fromEntries(['get', 'post', 'put', 'delete', 'patch'].map(method => [method, (url, ...handlers) => rotas.set(`${method} ${url}`, handlers)]));
  m.exports(app, { requireAuth: auth, requireAdmin: admin });
  const handlers = rotas.get('post /api/iahub/platform/ai-config/test');
  assert.equal(handlers[0], auth); assert.equal(handlers[1], admin);
  async function chamar(body) {
    const res = { codigo: 200, status(c) { this.codigo = c; return this; }, json(d) { this.body = d; return this; } };
    await handlers.at(-1)({ body, params: {}, query: {}, session: { empresa_id: 1 } }, res);
    return res;
  }
  return { chamar, chamadas };
}

test('teste usa o modelo selecionado antes de salvar, mantendo chave da empresa e sem escrever no banco', async () => {
  const { chamar, chamadas } = preparar();
  const res = await chamar({ provedor: 'openai', modelo: 'gpt-5.4', api_key: '' });
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.body, { ok: true, modelo: 'gpt-5.4' });
  assert.equal(chamadas[0][1], 'fixture-salva');
  assert.equal(chamadas[0][5].model, 'gpt-5.4');
});

test('cliente antigo sem modelo continua testando o modelo salvo', async () => {
  const { chamar, chamadas } = preparar();
  const res = await chamar({ provedor: 'openai', api_key: 'fixture-digitada' });
  assert.equal(res.body.modelo, 'gpt-4o');
  assert.equal(chamadas[0][1], 'fixture-digitada');
});

test('modelo inválido não provoca chamada ao provedor', async () => {
  const { chamar, chamadas } = preparar();
  for (const modelo of [{ nome: 'gpt-5.4' }, 'a'.repeat(151)]) {
    assert.equal((await chamar({ provedor: 'openai', modelo })).codigo, 400);
  }
  assert.equal(chamadas.length, 0);
});

test('botão envia modelo selecionado e mostra o modelo realmente testado', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../IA Administracao/frontend/platform-config.html'), 'utf8');
  const funcao = html.split('\n').find(l => l.startsWith('async function testarProvedor('));
  const elementos = { 'model-openai': { value: 'gpt-5.4' }, 'key-openai': { value: '' }, 'test-openai': { style: {} } };
  let enviado;
  const ctx = vm.createContext({ document: { getElementById: id => elementos[id] }, empresaIdBody: () => ({ empresaId: 1 }),
    api: async (url, opts) => { assert.equal(url, '/api/iahub/platform/ai-config/test'); enviado = JSON.parse(opts.body); return { ok: true, modelo: 'gpt-5.4' }; } });
  vm.runInContext(funcao, ctx);
  await ctx.testarProvedor('openai');
  assert.equal(enviado.modelo, 'gpt-5.4');
  assert.match(elementos['test-openai'].textContent, /modelo gpt-5\.4/);
  assert.match(html, /GPT-5\.4 — Recomendado para IA Service/);
  assert.doesNotMatch(html, /gpt-4o-mini - Recomendado/);
});
