'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');
let server, browser, base;
before(async () => {
  const app = express();
  const frontend = path.resolve(__dirname, '../frontend');
  app.use('/iaservice/j2a/assets', express.static(path.join(frontend, 'j2a/assets')));
  app.get('/j2a', (_req, res) => res.sendFile(path.join(frontend, 'j2a/index.html')));
  app.get('/radar-externo', (_req, res) => res.sendFile(path.join(frontend, 'radar.html')));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); });

for (const tela of ['j2a', 'radar-externo']) {
  for (const width of [1440, 390]) {
    test(`${tela} ${width}px: estilo visível com automática desligada, salva e restaura sem investigação`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let estilo = 'NATURAL';
      let falhar = false;
      const escritas = [], erros = [];
      page.on('pageerror', e => erros.push(e.message));
      await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'sessao-teste'));
      await page.route('**/api/ia-service-externo/**', async route => {
        const req = route.request();
        const pathname = new URL(req.url()).pathname;
        let body = {};
        if (pathname.endsWith('/whoami')) body = { empresaId: 1, empresaNome: 'Teste', consultorNome: 'Analista', outrasEmpresas: [] };
        else if (pathname.endsWith('/minhas-preferencias')) {
          if (req.method() === 'PUT') {
            escritas.push(req.postDataJSON());
            if (falhar) return route.fulfill({ status: 500, json: { error: 'Falha simulada' } });
            estilo = req.postDataJSON().estiloResposta;
          }
          body = { consultorEncontrado: true, preAnaliseAutomatica: false, preAnalisePadrao: false, preAnalisePessoal: false, estiloResposta: estilo };
        } else if (pathname.endsWith('/fila') || pathname.endsWith('/risco-sla')) body = { chamados: [], consultores: [] };
        else if (pathname.endsWith('/config')) body = { autoRefreshSegundos: 0 };
        else if (req.method() !== 'GET') escritas.push({ endpoint: pathname });
        await route.fulfill({ json: body });
      });
      try {
        await page.goto(`${base}/${tela}`);
        const seletor = page.locator(tela === 'j2a' ? '#response-style-select' : '#estiloRespostaSelect');
        const toggle = page.locator(tela === 'j2a' ? '#pre-analysis-toggle' : '#preAnaliseAutomaticaToggle');
        await page.waitForFunction(id => !document.getElementById(id).disabled, tela === 'j2a' ? 'response-style-select' : 'estiloRespostaSelect');
        assert.equal(await toggle.isChecked(), false);
        assert.equal(await seletor.isVisible(), true);
        assert.equal(await seletor.inputValue(), 'NATURAL');
        const box = await seletor.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'seletor dentro da tela');
        // Somente dois estilos: Técnica (ORIGINAL) e Objetiva (NATURAL).
        assert.deepEqual(await seletor.locator('option').evaluateAll(os => os.map(o => [o.value, o.textContent.trim()])),
          [['ORIGINAL', 'Técnica'], ['NATURAL', 'Objetiva']]);
        await seletor.selectOption('ORIGINAL');
        await page.waitForFunction(id => !document.getElementById(id).disabled, tela === 'j2a' ? 'response-style-select' : 'estiloRespostaSelect');
        assert.equal(estilo, 'ORIGINAL');
        assert.deepEqual(escritas.filter(x => x.estiloResposta), [{ estiloResposta: 'ORIGINAL' }]);
        assert.equal(await toggle.isChecked(), false);
        await page.reload();
        await page.waitForFunction(id => document.getElementById(id).value === 'ORIGINAL' && !document.getElementById(id).disabled, tela === 'j2a' ? 'response-style-select' : 'estiloRespostaSelect');
        falhar = true;
        await seletor.selectOption('NATURAL');
        await page.waitForFunction(id => document.getElementById(id).value === 'ORIGINAL' && !document.getElementById(id).disabled, tela === 'j2a' ? 'response-style-select' : 'estiloRespostaSelect');
        assert.equal(await toggle.isChecked(), false);
        assert.equal(escritas.some(x => /investigar|pesquis/.test(x.endpoint || '')), false);
        if (tela === 'radar-externo') {
          const html = await page.evaluate(() => renderizarRespostaOperacional(
            { temEstrutura: true, diagnostico: 'Diagnóstico original' }, { humanizacao: { status: 'aplicada' } }, null, 'Resposta humanizada', null));
          assert.ok(html.includes('Resposta humanizada'));
          assert.equal(html.includes('Diagnóstico original'), false, 'não repete ficha original junto da resposta final');
          const fallback = await page.evaluate(() => renderizarRespostaOperacional(
            null, { humanizacao: { status: 'fallback' } }, null, 'Resposta original preservada', null));
          assert.ok(fallback.includes('Resposta original preservada'), 'fallback curto não pode ficar vazio');
        }
        assert.deepEqual(erros, []);
        if (width === 1440) await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/humanizacao-${tela}.png`) });
      } finally { await page.close(); }
    });
  }
}

test('trilha mostra resposta primária e ajustada em sequência, com metadados e texto escapado', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'sessao-teste'));
  const primaria = 'Resposta técnica original: rejeição 1031.';
  const ajustada = 'Resposta ajustada: rejeição 1031. <img src=x onerror=alert(1)>';
  await page.route('**/api/ia-service-externo/**', async route => {
    const p = new URL(route.request().url()).pathname;
    let body = {};
    if (p.endsWith('/whoami')) body = { empresaId: 1, empresaNome: 'Teste', consultorNome: 'Analista', outrasEmpresas: [] };
    else if (p.endsWith('/fila')) body = { chamados: [{ id: 'ch-a', numero: '123', titulo: 'Conversa auditada', statusEncerramento: 'Andamento' }] };
    else if (p.endsWith('/risco-sla')) body = { chamados: [], consultores: [] };
    else if (p.endsWith('/minhas-preferencias')) body = { consultorEncontrado: true, preAnaliseAutomatica: false, estiloResposta: 'NATURAL' };
    else if (p.endsWith('/config')) body = { autoRefreshSegundos: 0 };
    else if (p.endsWith('/abrir-atendimento')) body = { atendimentoId: 'at-a', preAnaliseDisparada: false };
    else if (/\/(mensagens|anexos|investigacoes)$/.test(p)) body = [];
    else if (p.endsWith('/anexos-softexpert')) body = { anexos: [] };
    else if (p.endsWith('/trilha')) body = { trilha: [{ execucaoId: 'exec-1', criadoEm: '2026-10-17T12:00:00Z', status: 'concluido', statusLabel: 'Concluída', eventos: [
      { tipo: 'resposta_tecnica_original', titulo: 'Resposta técnica original', status: 'concluido', resumo: 'Resposta primária', detalhes: { conteudo: primaria } },
      { tipo: 'resposta_ajustada', titulo: 'Resposta ajustada', status: 'concluido', resumo: 'Estilo Natural', detalhes: {
        conteudo: ajustada, estilo: 'NATURAL', statusHumanizacao: 'aplicada', provider: 'mock', model: 'modelo-teste', consumoAdicional: { entrada: 10, saida: 5, total: 15 },
      } },
    ] }] };
    await route.fulfill({ json: body });
  });
  async function abrirTrilha() {
    await page.locator('#queue-list [data-ticket-id]').first().click();
    await page.locator('.more-menu > summary').click();
    await page.locator('.topbar-nav [data-panel-tab="trail"]').click();
    await page.locator('[data-trail-step-toggle]').first().waitFor();
    for (const step of await page.locator('[data-trail-step-toggle]').all()) await step.click();
  }
  try {
    await page.goto(`${base}/j2a`);
    await abrirTrilha();
    const textos = await page.locator('#trail-content .trail-response-text').allTextContents();
    assert.deepEqual(textos, [primaria, ajustada]);
    assert.equal(await page.locator('#trail-content img').count(), 0);
    assert.ok((await page.locator('#trail-content').textContent()).includes('modelo-teste'));
    assert.ok((await page.locator('#trail-content').textContent()).includes('10 / 5 / 15'));
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/humanizacao-trilha-auditoria.png') });
    await page.route(/\/trilha\?/, route => route.fulfill({ json: { trilha: [{ execucaoId: 'exec-rejeitada', status: 'concluido', criadoEm: '2026-10-18T12:00:00Z', eventos: [{
      tipo: 'resposta_ajustada', titulo: 'Resposta ajustada', status: 'alerta', resumo: 'Original aprovado preservado.', detalhes: {
        conteudo: 'Original aprovado preservado.', estilo: 'DIRETO', statusHumanizacao: 'fallback',
        respostaCandidata: '<img src=x onerror="window.executou=1">', validacaoPreservacao: { aprovado: false, falhas: [{
          codigo: 'ESTADO_OU_CERTEZA_ALTERADO', detalhe: 'Pedido virou ação concluída.', informacoes: ['Solicite os dados.', 'Os dados foram enviados.'],
        }] },
      },
    }] }] } }));
    await page.reload();
    await abrirTrilha();
    assert.ok((await page.locator('#trail-content').textContent()).includes('ESTADO_OU_CERTEZA_ALTERADO'));
    await page.getByText('Candidata rejeitada — não entregue ao analista', { exact: true }).click();
    assert.equal(await page.locator('#trail-content img').count(), 0);
    assert.equal(await page.evaluate(() => window.executou), undefined);
  } finally { await page.close(); }
});
