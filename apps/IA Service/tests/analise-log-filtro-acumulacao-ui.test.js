'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { gerarPdf } = require('../backend/services/analise-log-pdf-service');

test('30 erros: acumula quatro diagnósticos, filtra por análise e busca, e preserva ao reanalisar o mesmo arquivo', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const exportacoes = [];
    await page.exposeFunction('exportarPdfTeste', async dados => { exportacoes.push(dados); return (await gerarPdf(dados)).toString('base64'); });
    await page.setContent('<div id="panel-logs"><div class="logs-tela"></div></div>');
    await page.addStyleTag({ path: path.resolve(__dirname, '../frontend/j2a/assets/analise-logs.css') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../frontend/j2a/assets/analise-logs.js') });
    await page.evaluate(() => {
      window.logsTeste = new window.AnaliseLogs({ contexto: () => ({ empresa: 1 }), url: p => p, headers: () => ({}) });
      window.logsTeste.setModo('avulso');
    });
    await page.locator('#logs-arquivo').setInputFiles({ name: 'trinta.log', mimeType: 'text/plain', buffer: Buffer.from('Log sintético') });
    await page.evaluate(() => {
      const ui = window.logsTeste;
      const base = {
        arquivo: { nome: 'trinta.log', tamanho: 100, encoding: 'utf-8' }, origem: { tipo: 'avulso' },
        cobertura: { ocorrencias: 30, linhasLidas: 300 }, familias: [], avisos: [],
        historico: { id: 'hist-30', salvo: true, atualizadoEm: '2026-11-04T12:00:00Z', bytesHistorico: 100 },
        grupos: Array.from({ length: 30 }, (_, i) => ({ id: `erro-${i + 1}`, titulo: `FALHA_${i + 1}`, quantidade: 1, linhas: [i + 1], evidencia: [], contextoAnterior: [] })),
      };
      window.pedidosLogs = [];
      ui.request = async caminho => {
        window.pedidosLogs.push(caminho);
        const resultado = structuredClone(base);
        const id = new URL(caminho, 'http://teste.local').searchParams.get('grupoId');
        if (id) {
          resultado.grupos.find(g => g.id === id).analise = { explicacao: `Diagnóstico ${id}`, causaProvavel: 'A confirmar.', solucoes: `Solução sugerida ${id}`, validacao: 'Validar em homologação.', informacoesFaltantes: 'Contexto funcional.' };
          resultado.ia = { gruposAnalisados: 1 };
        }
        return resultado;
      };
      const body = new FormData(); body.append('arquivo', document.getElementById('logs-arquivo').files[0]);
      ui.fonteAnalise = { caminho: '/radar/logs/avulso', modo: 'avulso', opts: { method: 'POST', body } };
      ui.relatorio = structuredClone(base); ui.renderizar(ui.relatorio);
    });
    await page.locator('#logs-somente-analisados').check();
    assert.equal(await page.locator('[data-log-card]:visible').count(), 0);
    assert.match(await page.locator('#logs-filtro-vazio').textContent(), /Nenhum erro deste relatório possui diagnóstico/);
    await page.locator('#logs-somente-analisados').uncheck();
    for (const id of [1, 30, 8, 16]) {
      await page.locator(`[data-log-card="erro-${id}"] [data-log-grupo]`).click();
      await page.locator(`[data-log-card="erro-${id}"][data-analisado="true"]`).waitFor();
    }
    await page.locator('#logs-somente-analisados').check();
    const esperados = ['erro-1', 'erro-8', 'erro-16', 'erro-30'];
    assert.deepEqual(await page.locator('[data-log-card]:visible').evaluateAll(cards => cards.map(c => c.dataset.logCard)), esperados);
    assert.match(await page.locator('#logs-filtro-status').textContent(), /4 de 30.*4 analisado/);
    await page.evaluate(() => {
      window.fetch = async (_url, opts) => new Response(Uint8Array.from(atob(await window.exportarPdfTeste(JSON.parse(opts.body))), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/pdf' } });
    });
    let download = page.waitForEvent('download');
    await page.locator('#logs-baixar').click(); await download;
    assert.deepEqual(exportacoes.at(-1).erros.map(e => e.id), esperados, 'PDF inclui apenas os quatro erros analisados exibidos');
    await page.locator('#logs-busca').fill('FALHA_30');
    assert.equal(await page.locator('[data-log-card]:visible').count(), 1);
    assert.equal(await page.locator('[data-log-card]:visible').getAttribute('data-log-card'), 'erro-30');
    download = page.waitForEvent('download');
    await page.locator('#logs-baixar').click(); await download;
    assert.deepEqual(exportacoes.at(-1).erros.map(e => e.id), ['erro-30'], 'PDF respeita também a pesquisa por palavra');
    assert.equal(await page.locator('[data-log-card="erro-30"] .logs-diagnostico.solucoes').isVisible(), true, 'soluções continuam no cartão filtrado');
    await page.locator('#logs-busca').fill('FALHA_2');
    assert.equal(await page.locator('[data-log-card]:visible').count(), 0);
    assert.equal(await page.locator('#logs-filtro-vazio').isVisible(), true);
    assert.equal(await page.locator('#logs-baixar').isDisabled(), true);
    await page.locator('#logs-busca').fill('');
    await page.locator('#logs-analisar').click();
    assert.deepEqual(await page.locator('[data-log-card]:visible').evaluateAll(cards => cards.map(c => c.dataset.logCard)), esperados, 'reanálise completa do mesmo arquivo preserva os quatro diagnósticos e o filtro');
    assert.match(await page.evaluate(() => window.pedidosLogs.at(-1)), /historicoId=hist-30/);
    assert.equal(await page.evaluate(() => window.logsTeste.relatorio.ia.gruposAnalisados), 4);
    await page.locator('#logs-somente-analisados').uncheck();
    assert.equal(await page.locator('[data-log-card]:visible').count(), 30);
    await page.locator('#logs-arquivo').setInputFiles({ name: 'outro.log', mimeType: 'text/plain', buffer: Buffer.from('Outro arquivo') });
    await page.locator('#logs-analisar').click();
    assert.doesNotMatch(await page.evaluate(() => window.pedidosLogs.at(-1)), /historicoId=/);
    assert.equal(await page.locator('[data-analisado="true"]').count(), 0, 'não transfere diagnósticos para outro arquivo');
    await page.evaluate(async () => {
      window.fetch = async () => new Response(JSON.stringify({ error: 'Falha de exportação simulada.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      await window.logsTeste.baixar();
    });
    assert.match(await page.locator('#logs-busca-status').textContent(), /Falha de exportação simulada/);
    assert.equal(await page.locator('#logs-baixar').isEnabled(), true, 'permite tentar de novo após falha');
    let downloadsTardios = 0;
    page.on('download', () => { downloadsTardios++; });
    await page.evaluate(() => {
      window.fetch = () => new Promise(resolve => { window.resolverPdf = resolve; });
      window.exportacaoPendente = window.logsTeste.baixar();
    });
    assert.equal(await page.locator('#logs-baixar').isDisabled(), true);
    assert.equal(await page.locator('#logs-baixar').textContent(), 'Gerando PDF…');
    await page.evaluate(async () => {
      window.logsTeste.opcoes.contexto = () => ({ empresa: 2 });
      window.resolverPdf(new Response('%PDF-resultado-antigo', { headers: { 'Content-Type': 'application/pdf' } }));
      await window.exportacaoPendente;
    });
    assert.equal(downloadsTardios, 0, 'não baixa relatório antigo depois da troca de empresa');
  } finally { await browser.close(); }
});
