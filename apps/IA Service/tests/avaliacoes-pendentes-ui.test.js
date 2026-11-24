'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../frontend/j2a');

test('convite leva à fila, permite avaliar e recuperar resultados não testados', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const item = { chamadoId: 'c1', numero: '037000', titulo: 'Atual', mensagemId: 'm1', resposta: 'Análise', candidato: { id: 'c2', numero: '036000', titulo: 'Anterior' } };
  let avaliada = false, payload;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      let data = {};
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Consultor' };
      else if (url.pathname.endsWith('/fila')) data = { chamados: [] };
      else if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: [] };
      else if (url.pathname.endsWith('/avaliacoes-pendentes/convite')) data = { mostrar: true, total: 1 };
      else if (url.pathname.endsWith('/avaliacoes-pendentes') && route.request().method() === 'POST') { payload = route.request().postDataJSON(); avaliada = true; data = { id: 'avaliacao' }; }
      else if (url.pathname.endsWith('/avaliacoes-pendentes')) data = { pendencias: avaliada ? [] : [item], paraAtualizar: avaliada ? [{ ...item, avaliacao: { mesmoProblema: 'sim', utilidade: 'talvez', resultado: 'nao_testada' } }] : [] };
      return route.fulfill({ json: data });
    }
    if (url.pathname.includes('/socket.io/')) return route.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({connected:true,on(){},emit(){},disconnect(){}});' });
    const rel = url.pathname.replace(/^\/iaservice\/(?:j2a\/)?assets\//, 'assets/');
    const file = path.resolve(root, rel === '/iaservice/j2a/' ? 'index.html' : rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
  });
  try {
    await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'teste'));
    await page.goto('http://teste.local/iaservice/j2a/');
    await page.getByRole('button', { name: 'Avaliar agora' }).click();
    await page.locator('#pending-problema').selectOption('sim');
    await page.locator('#pending-utilidade').selectOption('talvez');
    await page.locator('#pending-resultado').selectOption('nao_testada');
    await page.getByRole('button', { name: 'Salvar avaliação' }).click();
    await page.getByText('Resultados ainda não confirmados').waitFor();
    assert.equal(payload.candidatoId, 'c2');
    assert.equal(payload.resultado, 'nao_testada');
    await page.locator('[data-update-pending="0"]').click();
    assert.equal(await page.locator('#pending-problema').inputValue(), 'sim');
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
});
