'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { criarApp } = require('../backend/servidor');
const { abrirBanco } = require('../backend/database');

async function subir(app) {
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, fechar: () => new Promise((r) => s.close(r)) };
}

test('servidor real: saúde, telas, componentes compartilhados e erro padrão', async (t) => {
  const db = abrirBanco({ arquivo: ':memory:' });
  const { url, fechar } = await subir(criarApp({ db, log: { error() {} } }));
  t.after(fechar);

  const saude = await fetch(`${url}/app/ia-talk/api/saude`).then(r => r.json());
  assert.equal(saude.servico, 'ia-talk');
  assert.equal(saude.banco, 'ok');

  const raiz = await fetch(`${url}/app/ia-talk/`, { redirect: 'manual' });
  assert.equal(raiz.status, 302);
  assert.equal(raiz.headers.get('location'), '/app/ia-talk/shell.html');

  const shell = await fetch(`${url}/app/ia-talk/shell.html`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('cache-control') || '', /no-cache/);
  const csp = shell.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/unpkg\.com/);

  const css = await fetch(`${url}/app/ia-talk/ui/css/iahub.css`);
  assert.equal(css.status, 200, 'packages/ui servido em /app/ia-talk/ui');

  const naoExiste = await fetch(`${url}/app/ia-talk/api/admin/qualquer`);
  assert.equal(naoExiste.status, 404);
  assert.equal((await naoExiste.json()).erro.codigo, 'nao_encontrado');

  const foraDoPrefixo = await fetch(`${url}/api/login`);
  assert.equal(foraDoPrefixo.status, 404, 'nada fora de /app/ia-talk');

  const prototipo = await fetch(`${url}/app/ia-talk/prototipos/central/`);
  assert.equal(prototipo.status, 404, 'protótipos só no servidor simulado');
});
