'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../frontend/j2a');

test('abre candidato por mouse e teclado e retorna ao chamado original', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const atual = { id: 'c1', numero: '037000', titulo: 'Chamado atual', descricao: 'Falha técnica' };
  const anterior = { id: 'c2', numero: '036000', titulo: 'Histórico anterior', descricao: 'Falha semelhante', statusEncerramento: 'Encerrado' };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      let data = {};
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Consultor' };
      if (url.pathname.endsWith('/fila')) data = { chamados: [atual] };
      if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: [atual] };
      if (url.pathname.endsWith('/abrir-atendimento')) { const c = url.pathname.includes('/c2/') ? anterior : atual; data = { atendimentoId: `at-${c.id}`, chamado: c, somenteLeitura: c.id === 'c2' }; }
      if (url.pathname.endsWith('/mensagens')) data = url.pathname.includes('/at-c2/')
        ? [{ id: 'p1', papel: 'user', conteudo: 'Posicionamento: solução aplicada; resultado registrado para conferência.', criadoEm: '2026-01-01' }]
        : [{ id: 'm1', papel: 'assistant', conteudo: 'Análise registrada', criadoEm: '2026-01-01', diagnostico: { baseConhecimento: { incluidosNoContexto: [{ numero: '036000' }], omitidosNoContexto: [] } } }];
      if (url.pathname.endsWith('/anexos')) data = [];
      if (url.pathname.endsWith('/anexos-softexpert')) data = { anexos: [] };
      if (url.pathname.endsWith('/pesquisa-tecnica')) data = { pesquisa: { resultados: [] }, relacionados: [{ chamado: anterior, motivos: ['Termo em comum'], registrosResultado: [] }] };
      if (url.pathname.endsWith('/trilha')) data = { trilha: [] };
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
    await page.locator('[data-ticket-id="c1"]').first().click();
    await page.getByRole('button', { name: 'Ver candidatos da busca atual' }).click();
    const card = page.locator('[data-related-id="c2"]');
    await card.click();
    await page.waitForFunction(() => document.querySelector('#case-number').textContent.includes('036000'));
    await page.getByText('Posicionamento: solução aplicada; resultado registrado para conferência.').waitFor();
    await page.locator('#voltar-chamado-base').click();
    await page.waitForFunction(() => document.querySelector('#case-number').textContent.includes('037000'));
    await page.getByRole('button', { name: 'Ver candidatos da busca atual' }).click();
    await card.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#case-number').textContent.includes('036000'));
    await page.locator('#voltar-chamado-base').click();
    await page.waitForFunction(() => document.querySelector('#case-number').textContent.includes('037000'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
