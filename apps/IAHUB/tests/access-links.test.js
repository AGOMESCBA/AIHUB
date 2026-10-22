// Executar: node --test "apps/IAHUB/tests/access-links.test.js"
// Banco SQLite em memória; nenhuma configuração ou serviço de produção é usado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('../backend/platform-schema');
const access = require('../backend/platform-access-routes');
const links = require('../../IA Administracao/frontend/js/platform-access-links');
const frontend = require('../../IA Service/backend/routes/frontend-publico-routes');

async function servidor(t, app) {
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

test('normalização aceita HTTP e HTTPS com porta e rejeita URLs inseguras ou incompletas', () => {
  for (const normalizar of [access.normalizarUrlPublica, links.normalizarBase]) {
    assert.equal(normalizar(' http://137.131.212.29:3000/ '), 'http://137.131.212.29:3000');
    assert.equal(normalizar('https://ia.c3isystems.com.br/'), 'https://ia.c3isystems.com.br');
    assert.equal(normalizar('https://ia.c3isystems.com.br:8443'), 'https://ia.c3isystems.com.br:8443');
    for (const value of ['javascript:alert(1)', 'ftp://host', '//host', 'https:host', 'host', 'https://user:senha@host', 'https://host/iaservice', 'https://host/?x=1', 'https://host/#hash']) {
      assert.throws(() => normalizar(value), value);
    }
  }
  assert.equal(access.normalizarUrlPublica(''), null);
});

test('links HTTP atuais e HTTPS público coexistem; o apelido nunca define uma origem externa', () => {
  const result = links.montarLinks('http://137.131.212.29:3000', 'https://ia.c3isystems.com.br', 'empresa-a');
  assert.equal(result.legado, 'http://137.131.212.29:3000/entrar-servico/empresa-a');
  assert.equal(result.atual, 'http://137.131.212.29:3000/iaservice/empresa-a');
  assert.equal(result.publico, 'https://ia.c3isystems.com.br/iaservice/empresa-a');
  assert.equal(links.montarLinks('https://host', '', '').atual, 'https://host/iaservice');
  assert.equal(links.montarLinks('http://host:3000', '', 'j2a').publico, '');
  assert.equal(new URL(links.montarLinks('https://host', '', '//outro-host').atual).origin, 'https://host');
});

test('schema aditivo e idempotente preserva configurações existentes e mantém URL pública desativada', () => {
  const db = new Database(':memory:');
  try {
    // Simula banco anterior, sem a nova tabela.
    db.exec('CREATE TABLE platform_ai_configs (id TEXT PRIMARY KEY, empresa_id INTEGER UNIQUE, login_externo_apelido TEXT, provider TEXT, groq_api_key_enc TEXT)');
    db.prepare('INSERT INTO platform_ai_configs VALUES (?, ?, ?, ?, ?)').run('original', 1, 'empresa-a', 'deepseek', 'segredo-preservado');
    const antes = db.prepare('SELECT * FROM platform_ai_configs').all();
    ensurePlatformSchema(db);
    ensurePlatformSchema(db);
    assert.deepEqual(db.prepare('SELECT * FROM platform_ai_configs').all(), antes);
    assert.deepEqual(access.lerConfig(db), { urlPublica: null, versao: 0, atualizadoEm: null });
  } finally { db.close(); }
});

test('API exige autenticação/admin e permite configurar, limpar e detectar edição concorrente sem tocar nas empresas', async t => {
  const db = new Database(':memory:');
  ensurePlatformSchema(db);
  db.prepare('INSERT INTO platform_ai_configs (id, empresa_id, login_externo_apelido, provider) VALUES (?, ?, ?, ?)').run('a', 1, 'empresa-a', 'deepseek');
  const antes = db.prepare('SELECT * FROM platform_ai_configs').all();
  const app = express();
  app.use(express.json());
  access.registrarRotas(app, {
    getDB: () => db,
    requireAuth: (req, res, next) => req.headers['x-role'] ? next() : res.sendStatus(401),
    requireAdmin: (req, res, next) => req.headers['x-role'] === 'admin' ? next() : res.sendStatus(403),
  });
  const base = await servidor(t, app);
  t.after(() => db.close());
  const post = (body, role = 'admin') => fetch(base + '/api/iahub/platform/access-config', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-role': role }, body: JSON.stringify(body),
  });
  assert.equal((await fetch(base + '/api/iahub/platform/access-config')).status, 401);
  assert.equal((await post({ urlPublica: 'https://host', versao: 0 }, 'user')).status, 403);
  assert.equal((await post({ urlPublica: 'https://host/iaservice', versao: 0 })).status, 400);
  assert.equal((await post({ versao: 0 })).status, 400);
  const salvo = await post({ urlPublica: 'https://ia.c3isystems.com.br/', versao: 0 });
  assert.equal(salvo.status, 200);
  const cfg = await salvo.json();
  assert.equal(cfg.urlPublica, 'https://ia.c3isystems.com.br');
  const lido = await fetch(base + '/api/iahub/platform/access-config', { headers: { 'x-role': 'admin' } });
  assert.deepEqual(await lido.json(), cfg);
  assert.equal((await post({ urlPublica: 'http://outro-host', versao: 0 })).status, 409);
  // Duas sessões com a mesma versão: só uma pode gravar.
  const concorrentes = await Promise.all([
    post({ urlPublica: 'http://host-a:3000', versao: 1 }),
    post({ urlPublica: 'https://host-b', versao: 1 }),
  ]);
  assert.deepEqual(concorrentes.map(r => r.status).sort(), [200, 409]);
  assert.equal((await post({ urlPublica: '', versao: 2 })).status, 200);
  assert.equal(access.lerConfig(db).urlPublica, null);
  assert.deepEqual(db.prepare('SELECT * FROM platform_ai_configs').all(), antes);
});

test('nova interface atende empresas por HTTP e proxy HTTPS e mantém os links/assets J2A', async t => {
  const app = express();
  frontend(app, { getConfigPorApelido: slug => ['empresa-a', 'empresa-b'].includes(slug) ? { empresaId: slug === 'empresa-a' ? 1 : 2 } : null });
  const base = await servidor(t, app);
  for (const pathname of ['/iaservice', '/iaservice/', '/iaservice/j2a', '/iaservice/j2a/acesso', '/iaservice/j2a/radar', '/iaservice/empresa-a', '/iaservice/empresa-b', '/iaservice/empresa-a/acesso', '/iaservice/empresa-b/radar']) {
    for (const proto of ['http', 'https']) {
      const response = await fetch(base + pathname, { redirect: 'manual', headers: { 'X-Forwarded-Proto': proto } });
      assert.equal(response.status, 200, pathname + ' ' + proto);
      assert.equal(response.headers.get('location'), null);
      const html = await response.text();
      assert.match(html, /id="access-screen"/);
      assert.match(html, /\/iaservice\/assets\/radar.js/);
    }
  }
  const antigo = await fetch(base + '/iaservice/j2a/assets/radar.js');
  const novo = await fetch(base + '/iaservice/assets/radar.js');
  assert.equal(antigo.status, 200);
  assert.equal(novo.status, 200);
  assert.equal(await antigo.text(), await novo.text());
  assert.equal((await fetch(base + '/iaservice/desconhecida')).status, 404);
  assert.equal((await fetch(base + '/iaservice/empresa-a/qualquer-coisa')).status, 404);
});

test('registro completo preserva links legados, guia e identidade sem acessar o banco real', async t => {
  const filename = path.join(__dirname, '../../IA Service/backend/routes/login-externo-routes.js');
  const realRequire = require('node:module').createRequire(filename);
  const modulo = { exports: {} };
  // Isola somente as dependências de dados; executa o registro real das rotas.
  const store = { getConfigPorApelido: slug => slug === 'empresa-a' ? { empresaId: 1 } : null };
  const stubRequire = id => {
    if (id === '../../../IAHUB/backend/platform-store') return store;
    if (id === '../../../IAHUB/backend/crud') return { buscarPorId: () => ({ nome: 'Empresa A' }) };
    if (id === '../services/login-externo-service') return {};
    return realRequire(id);
  };
  new Function('require', 'module', '__dirname', fs.readFileSync(filename, 'utf8'))(stubRequire, modulo, path.dirname(filename));
  const app = express();
  modulo.exports(app);
  const base = await servidor(t, app);
  for (const pathname of ['/entrar-servico', '/entrar-servico/empresa-a', '/radar-externo', '/radar-externo/empresa-a', '/iaservice/guia', '/iaservice/empresa-a']) {
    const response = await fetch(base + pathname, { redirect: 'manual' });
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get('location'), null);
  }
  assert.equal((await fetch(base + '/entrar-servico/desconhecida')).status, 404);
  const identidade = await fetch(base + '/api/ia-service-publico/empresa-por-apelido/empresa-a');
  assert.equal((await identidade.json()).nome, 'Empresa A');
});
