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
        parserVersao: 2,
        arquivo: { nome: 'trinta.log', tamanho: 100, encoding: 'utf-8' }, origem: { tipo: 'avulso' },
        cobertura: { ocorrencias: 30, linhasLidas: 300 }, familias: [], avisos: [],
        historico: { id: 'hist-30', salvo: true, atualizadoEm: '2026-11-04T12:00:00Z', bytesHistorico: 100 },
        grupos: Array.from({ length: 30 }, (_, i) => ({ id: `erro-${i + 1}`, assinatura: `assinatura-${i + 1}`, titulo: `FALHA_${i + 1}`, quantidade: 1, linhas: [i + 1], evidencia: [], contextoAnterior: [] })),
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
    assert.equal(await page.locator('[data-log-card]:not([hidden])').count(), 0);
    assert.match(await page.locator('#logs-filtro-vazio').textContent(), /Nenhum erro deste relatório possui diagnóstico/);
    await page.locator('#logs-somente-analisados').uncheck();
    for (const id of [1, 30, 8, 16]) {
      await page.locator(`[data-log-indice="erro-${id}"]`).click();
      await page.locator(`[data-log-card="erro-${id}"] [data-log-grupo]`).click();
      await page.locator(`[data-log-card="erro-${id}"][data-analisado="true"]`).waitFor();
      assert.equal(await page.locator(`[data-log-card="erro-${id}"] .logs-diagnostico.solucoes`).isVisible(), true, 'após analisar, o grupo continua aberto');
    }
    await page.locator('#logs-somente-analisados').check();
    const esperados = ['erro-1', 'erro-8', 'erro-16', 'erro-30'];
    assert.deepEqual(await page.locator('[data-log-card]:not([hidden])').evaluateAll(cards => cards.map(c => c.dataset.logCard)), esperados);
    assert.match(await page.locator('#logs-filtro-status').textContent(), /4 de 30.*4 analisado/);
    await page.evaluate(() => {
      window.fetch = async (_url, opts) => new Response(Uint8Array.from(atob(await window.exportarPdfTeste(JSON.parse(opts.body))), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/pdf' } });
    });
    let download = page.waitForEvent('download');
    await page.locator('#logs-baixar').click(); await download;
    assert.deepEqual(exportacoes.at(-1).erros.map(e => e.id), esperados, 'PDF inclui apenas os quatro erros analisados exibidos');
    await page.locator('#logs-busca').fill('FALHA_30');
    assert.equal(await page.locator('[data-log-card]:not([hidden])').count(), 1);
    assert.equal(await page.locator('[data-log-card]:not([hidden])').getAttribute('data-log-card'), 'erro-30');
    download = page.waitForEvent('download');
    await page.locator('#logs-baixar').click(); await download;
    assert.deepEqual(exportacoes.at(-1).erros.map(e => e.id), ['erro-30'], 'PDF respeita também a pesquisa por palavra');
    assert.equal(await page.locator('[data-log-card="erro-30"] .logs-diagnostico.solucoes').isVisible(), true, 'soluções continuam no cartão filtrado');
    await page.locator('#logs-busca').fill('FALHA_2');
    assert.equal(await page.locator('[data-log-card]:not([hidden])').count(), 0);
    assert.equal(await page.locator('#logs-filtro-vazio').isVisible(), true);
    assert.equal(await page.locator('#logs-baixar').isDisabled(), true);
    await page.locator('#logs-busca').fill('');
    await page.locator('#logs-analisar').click();
    assert.deepEqual(await page.locator('[data-log-card]:not([hidden])').evaluateAll(cards => cards.map(c => c.dataset.logCard)), esperados, 'reanálise completa do mesmo arquivo preserva os quatro diagnósticos e o filtro');
    assert.match(await page.evaluate(() => window.pedidosLogs.at(-1)), /historicoId=hist-30/);
    assert.equal(await page.evaluate(() => window.logsTeste.relatorio.ia.gruposAnalisados), 4);
    await page.locator('#logs-somente-analisados').uncheck();
    assert.equal(await page.locator('[data-log-card]:not([hidden])').count(), 30);
    const ordemVisivel = () => page.locator('[data-log-card]:not([hidden])').evaluateAll(cards => cards.map(c => c.dataset.logCard));
    assert.deepEqual((await ordemVisivel()).slice(0, 5), [...esperados, 'erro-2'], 'mais relevantes: analisados primeiro, depois ordem no arquivo');
    await page.evaluate(async () => {
      window.fetchOriginal = window.fetch;
      window.fetch = async (_url, opts) => { window.pdfPedido = JSON.parse(opts.body); return new Response('%PDF-ordem', { headers: { 'Content-Type': 'application/pdf' } }); };
      await window.logsTeste.baixar();
      window.fetch = window.fetchOriginal;
    });
    assert.deepEqual(await page.evaluate(() => window.pdfPedido.erros.slice(0, 4).map(e => e.id)), esperados, 'PDF segue a ordem exibida');
    await page.locator('#logs-ordem').selectOption('arquivo');
    assert.deepEqual((await ordemVisivel()).slice(0, 3), ['erro-1', 'erro-2', 'erro-3'], 'ordem no arquivo disponível');
    assert.equal(await page.locator('[data-log-card="erro-8"] .logs-informacoes-analise').evaluate(el => el.open), true, 'reordenar não recria nem fecha os cartões');
    await page.locator('#logs-ordem').selectOption('relevancia');
    await page.evaluate(() => {
      const c = id => document.querySelector(`[data-log-card="${id}"]`);
      Object.assign(c('erro-2').dataset, { gravidade: '2', encerramento: 'true', quantidade: '9' });
      Object.assign(c('erro-3').dataset, { gravidade: '2' });
      Object.assign(c('erro-4').dataset, { gravidade: '3', encerramento: 'true' });
      window.logsTeste.ordenar();
    });
    const relevantes = await ordemVisivel();
    assert.deepEqual(relevantes.slice(4, 6), ['erro-4', 'erro-3'], 'fatal no topo, mesmo sendo encerramento; depois gravidade');
    assert.equal(relevantes.at(-1), 'erro-2', 'encerramento do servidor vai para o fim, mesmo frequente');
    await page.evaluate(() => window.logsTeste.renderizar(window.logsTeste.relatorio));

    // Área larga: índice à esquerda e só o grupo selecionado à direita.
    assert.equal(await page.locator('#logs-indice').isVisible(), true, 'dois painéis em área larga');
    assert.equal(await page.locator('[data-log-card]:visible').count(), 1);
    await page.locator('[data-log-indice="erro-5"]').click();
    assert.equal(await page.locator('[data-log-card="erro-5"]').isVisible(), true);
    assert.equal(await page.locator('[data-log-indice="erro-5"]').getAttribute('aria-current'), 'true');
    assert.equal(await page.locator('[data-log-card]:not([hidden])').count(), 30, 'seleção não altera o filtro nem o PDF');
    await page.locator('#logs-busca').fill('FALHA_30');
    assert.equal(await page.locator('[data-log-card="erro-30"]').isVisible(), true, 'grupo filtrado fora: abre o primeiro exibido');
    assert.deepEqual(await page.locator('[data-log-indice]:visible').evaluateAll(b => b.map(i => i.dataset.logIndice)), ['erro-30'], 'índice segue o filtro');
    await page.locator('#logs-busca').fill('');
    // Área estreita: lista compacta, um grupo aberto por vez.
    await page.setViewportSize({ width: 900, height: 900 });
    assert.equal(await page.locator('#logs-indice').isVisible(), false);
    assert.equal(await page.locator('[data-log-card]:visible').count(), 30);
    assert.equal(await page.locator('.logs-cartao-corpo:visible').count(), 1);
    await page.locator('[data-log-card="erro-8"] .logs-cartao-topo').click();
    assert.equal(await page.locator('[data-log-card="erro-8"] .logs-cartao-corpo').isVisible(), true);
    assert.equal(await page.locator('.logs-cartao-corpo:visible').count(), 1, 'abrir um grupo fecha o anterior');
    assert.equal(await page.locator('[data-log-card="erro-8"] .logs-cartao-topo').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-log-card="erro-8"] .logs-cartao-topo').click();
    assert.equal(await page.locator('.logs-cartao-corpo:visible').count(), 0, 'permite recolher o grupo aberto');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-log-card]:visible').first().waitFor();
    assert.equal(await page.locator('[data-log-card]:visible').count(), 1, 'ao voltar para área larga, um grupo é exibido');
    await page.evaluate(() => { window.legadoPreservado = window.logsTeste.relatorio; window.logsTeste.relatorio.parserVersao = 1; });
    await page.locator('#logs-analisar').click();
    assert.doesNotMatch(await page.evaluate(() => window.pedidosLogs.at(-1)), /historicoId=/, 'reanalisar legado pelo botão principal cria resultado separado');
    assert.equal(await page.evaluate(() => window.legadoPreservado.grupos.filter(g => g.analise).length), 4, 'mantém o relatório legado intacto');
    await page.locator('#logs-arquivo').setInputFiles({ name: 'outro.log', mimeType: 'text/plain', buffer: Buffer.from('Outro arquivo') });
    await page.locator('#logs-analisar').click();
    assert.doesNotMatch(await page.evaluate(() => window.pedidosLogs.at(-1)), /historicoId=/);
    assert.equal(await page.locator('[data-analisado="true"]').count(), 0, 'não transfere diagnósticos para outro arquivo');
    await page.evaluate(() => {
      window.logsTeste.relatorio.cobertura.ocorrenciasNaoRetidas = 7;
      window.logsTeste.avisarCobertura(window.logsTeste.relatorio);
    });
    assert.match(await page.locator('#logs-status').textContent(), /7 ocorrência.*não detalhada.*100 grupos/);
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
