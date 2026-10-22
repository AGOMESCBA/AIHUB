// Navegador real com API isolada e SQLite em memória, sem bootstrap do IAHub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');
const { ensurePlatformSchema } = require('../backend/platform-schema');
const { registrarRotas } = require('../backend/platform-access-routes');

test('cadastro mantém acesso atual, salva URL pública geral e abre nova interface por empresa', async t => {
  const db = new Database(':memory:');
  ensurePlatformSchema(db);
  const app = express();
  app.use(express.json());
  const pass = (_req, _res, next) => next();
  registrarRotas(app, { getDB: () => db, requireAuth: pass, requireAdmin: pass });
  const empresas = new Map([[1, { loginExternoApelido: 'empresa-a' }], [2, { loginExternoApelido: 'empresa-b' }]]);
  app.get('/api/iahub/platform/ai-config', (req, res) => res.json(empresas.get(Number(req.query.empresaId)) || empresas.get(1)));
  app.post('/api/iahub/platform/ai-config', (req, res) => {
    empresas.set(Number(req.body.empresaId), req.body);
    res.json(req.body);
  });
  let logoUrl;
  app.get('/api/ia-service-publico/empresa-por-apelido/:apelido', (req, res) => res.json({ nome: req.params.apelido === 'empresa-a' ? 'Empresa A' : 'Empresa B', logoUrl }));
  app.get('/uploads/logo.svg', (_req, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>'));
  app.get('/api/iahub/platform/*', (req, res) => res.json(/identities|import/.test(req.path) ? [] : {}));
  app.get('/socket.io/socket.io.js', (_req, res) => res.type('js').send(''));
  require('../../IA Service/backend/routes/frontend-publico-routes')(app, { getConfigPorApelido: slug => slug.startsWith('empresa-') ? { empresaId: 1 } : null });
  app.use('/app/ia-administracao', express.static(path.join(__dirname, '../../IA Administracao/frontend')));
  app.use(express.static(path.join(__dirname, '../../../packages/ui/frontend')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function abrir(empresa) {
    await page.goto(base + '/app/ia-administracao/platform-config.html?embedded=1&empresaId=' + empresa);
    await page.waitForFunction(() => !document.getElementById('access-public-save').disabled);
    await page.evaluate(() => abrirAbaPlatform('aba-link'));
  }
  await abrir(1);
  assert.equal(await page.inputValue('#f-login-link'), base + '/entrar-servico/empresa-a');
  assert.equal(await page.inputValue('#f-service-current-link'), base + '/iaservice/empresa-a');
  assert.equal(await page.inputValue('#f-service-public-link'), '');
  await page.fill('#f-access-public-url', 'https://ia.c3isystems.com.br');
  assert.match(await page.textContent('#access-config-status'), /ainda não salvo/);
  await page.click('#access-public-save');
  await page.waitForFunction(() => document.getElementById('access-config-status').textContent.includes('Endereço público HTTPS'));
  assert.equal(await page.inputValue('#f-service-public-link'), 'https://ia.c3isystems.com.br/iaservice/empresa-a');
  assert.equal(await page.inputValue('#f-login-link'), base + '/entrar-servico/empresa-a');
  assert.equal(await page.getAttribute('#f-service-public-link-open', 'rel'), 'noopener noreferrer');
  await page.screenshot({ path: path.join(__dirname, '../../../tmp/access-links-desktop.png'), fullPage: true });

  // A URL pública é geral; o apelido continua específico de cada empresa.
  await abrir(2);
  assert.equal(await page.inputValue('#f-access-public-url'), 'https://ia.c3isystems.com.br');
  assert.equal(await page.inputValue('#f-service-public-link'), 'https://ia.c3isystems.com.br/iaservice/empresa-b');
  await page.fill('#f-login-apelido', 'empresa-b-editada');
  await page.evaluate(() => salvarAbaAtual());
  assert.equal(empresas.get(2).loginExternoApelido, 'empresa-b-editada');
  assert.equal(empresas.get(1).loginExternoApelido, 'empresa-a');

  // A cópia permanece utilizável em HTTP, onde a Clipboard API pode não existir.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = comando => { window.comandoDeCopia = comando; return true; };
  });
  await page.click('#f-service-public-link-copy');
  assert.equal(await page.evaluate(() => window.comandoDeCopia), 'copy');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(__dirname, '../../../tmp/access-links-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  // Página nova usa nome da empresa do link sem interferir na autenticação.
  await page.goto(base + '/iaservice/empresa-a');
  await page.waitForFunction(() => document.getElementById('access-company-name')?.textContent === 'Empresa A');
  assert.equal(await page.isVisible('#access-screen'), true);

  // Simula a origem HTTPS pública no navegador, mantendo todas as requisições
  // no servidor de teste. Não consulta DNS, certificados ou serviços externos.
  logoUrl = 'http://antigo.invalid:3000/uploads/logo.svg';
  await page.route('https://ia.test/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: base + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.goto('https://ia.test/iaservice/empresa-a');
  await page.waitForFunction(() => document.querySelector('#access-brand-mark img')?.complete);
  assert.equal(await page.getAttribute('#access-brand-mark img', 'src'), 'https://ia.test/uploads/logo.svg');
  assert.equal(await page.isVisible('#access-screen'), true);
  assert.deepEqual(errors, []);
});
