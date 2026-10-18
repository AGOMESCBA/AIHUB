'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');
let browser, server, base;
before(async () => {
  const app = express(), frontend = path.resolve(__dirname, '../frontend');
  app.use('/iaservice/j2a/assets', express.static(path.join(frontend, 'j2a/assets')));
  app.get('/j2a', (_req, res) => res.sendFile(path.join(frontend, 'j2a/index.html')));
  app.get('/radar-externo', (_req, res) => res.sendFile(path.join(frontend, 'radar.html')));
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); });
const original = '# Análise técnica\n\n**Hipótese:** conferir a entrada.\n\n1. Validar em homologação.\n2. Aguardar retorno.\n\n| Campo | Valor |\n|---|---|\n| rotina | teste |\n\n```js\nconst texto = "<img src=x onerror=alert(1)>";\n```\n\n[Oficial](https://example.test/doc)\n[Inválido](javascript:alert)\n<script>window.invasao=true</script>\nFim integral.';
function mensagem(id, estilo = 'NATURAL', status = 'aplicada') {
  return { id, papel: 'assistant', atendimentoId: 'at-a', criadoEm: '2026-10-18T12:00:00Z', conteudo: `Humanizada ${id}`, respostaCurta: null,
    diagnostico: { humanizacao: { respostaOriginal: original + `\nMensagem ${id}.`, respostaHumanizada: `Humanizada ${id}`, estilo, status, aprovacaoTecnica: { aprovado: true } } },
    respostaOperacional: { avaliavel: false } };
}
for (const tela of ['j2a', 'radar-externo']) for (const width of [1440, 390]) {
  test(`${tela} ${width}px: detalhes corretos, históricos, sem processamento; download independente`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    const requests = [], erros = [];
    page.on('pageerror', e => erros.push(e.message));
    await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'sessao-teste'));
    const mensagens = ['NATURAL', 'DIRETO', 'DESCONTRAIDO', 'ORIGINAL'].map((s, i) => mensagem(`m${i}`, s));
    // Aviso de correção sem arquivo, em mensagem humanizada: vem do servidor e
    // é exibido como texto (HTML embutido não é interpretado).
    const AVISO = 'Foi apresentada uma proposta de correção, mas não foi possível gerar um arquivo corrigido com segurança. O código original permanece intacto.';
    mensagens[0].avisosFonteCorrigido = [AVISO, 'Motivo <b class="injetado">x</b>'];
    mensagens.push(mensagem('fallback', 'NATURAL', 'fallback'));
    const semOriginal = mensagem('sem-original'); delete semOriginal.diagnostico.humanizacao.respostaOriginal; mensagens.push(semOriginal);
    const historica = mensagem('historica'); delete historica.diagnostico.humanizacao.aprovacaoTecnica; mensagens.push(historica);
    await page.route('**/api/ia-service-externo/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      requests.push({ p, method: req.method(), token: req.headers()['x-sessao-externa'] });
      let body = {};
      if (p.endsWith('/whoami')) body = { empresaId: 1, empresaNome: 'Teste', consultorNome: 'Analista', outrasEmpresas: [] };
      else if (p.endsWith('/fila')) body = { chamados: [{ id: 'ch-a', numero: '123', titulo: 'Teste local', statusEncerramento: 'Andamento' }, { id: 'ch-b', numero: '456', titulo: 'Outra conversa', statusEncerramento: 'Andamento' }] };
      else if (p.endsWith('/risco-sla')) body = { chamados: [], consultores: [] };
      else if (p.endsWith('/minhas-preferencias')) body = { consultorEncontrado: true, preAnaliseAutomatica: false, estiloResposta: 'NATURAL' };
      else if (p.endsWith('/config')) body = { autoRefreshSegundos: 0 };
      else if (p.endsWith('/abrir-atendimento') || p.endsWith('/iniciar-analise')) body = { atendimentoId: p.includes('ch-b') ? 'at-b' : 'at-a', preAnaliseDisparada: false };
      else if (p.endsWith('/mensagens')) body = p.includes('at-b') ? [] : mensagens;
      else if (p.endsWith('/anexos')) body = p.includes('at-b') ? [] : [{ id: 'versao', mensagemOrigemId: 'm0', anexoOriginalId: 'original', nomeOriginal: 'teste (corrigido).py' }];
      else if (p.endsWith('/investigacoes')) body = [];
      else if (p.endsWith('/anexos-softexpert')) body = { anexos: [] };
      else if (p.endsWith('/anexos/versao/download')) return route.fulfill({ body: 'print("corrigido")', contentType: 'text/plain' });
      await route.fulfill({ json: body });
    });
    try {
      await page.goto(`${base}/${tela}`);
      await page.waitForFunction(id => !document.getElementById(id).disabled, tela === 'j2a' ? 'response-style-select' : 'estiloRespostaSelect');
      if (tela === 'j2a') await page.locator('#queue-list [data-ticket-id="ch-a"]').click();
      else {
        // O legado mantém suas funções globais; fixtures locais entram pela
        // mesma renderização de mensagens históricas, sem investigar.
        await page.evaluate(ms => {
          atendimentoAtualId = 'at-a'; chamadoSelecionadoId = 'ch-a';
          document.getElementById('chat-body').innerHTML = '';
          for (const m of ms) addBubble({ ...m, direcao: 'in', texto: m.conteudo });
        }, mensagens);
      }
      const botoes = page.locator('[data-detalhes-tecnicos]');
      await botoes.first().waitFor();
      assert.equal(await botoes.count(), 4);
      assert.equal(await page.getByText(AVISO).count(), 1, 'aviso de correção sem arquivo aparece uma vez');
      assert.ok(await page.getByText(AVISO).isVisible());
      assert.equal(await page.locator('.injetado').count(), 0, 'HTML do aviso não é interpretado');
      const painel = page.locator('.technical-details-panel');
      for (const id of ['m0', 'm1', 'm2', 'historica']) {
        const botao = page.locator(`[data-detalhes-tecnicos="${id}"]`);
        await botao.click();
        await painel.waitFor({ state: 'visible' });
        assert.ok((await painel.innerText()).includes(`Mensagem ${id}.`));
        assert.ok((await painel.innerText()).includes('Fim integral.'));
        assert.equal(await painel.locator('table tbody tr').count(), 1);
        assert.equal(await painel.locator('ol li').count(), 2);
        assert.equal(await painel.locator('pre code').textContent(), 'const texto = "<img src=x onerror=alert(1)>";');
        assert.equal(await painel.locator('script,img,a[href^="javascript:"]').count(), 0);
        assert.equal(await page.evaluate(() => window.invasao), undefined);
        const box = await painel.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        if (id === 'm0' && tela === 'j2a') await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/detalhes-tecnicos-j2a-${width}.png`) });
        await painel.getByRole('button', { name: 'Fechar Detalhes Técnicos' }).click();
        assert.equal(await painel.isVisible(), false);
      }
      assert.equal(requests.some(r => /investigar|\/retorno|pesquisar/.test(r.p)), false, 'abrir detalhes não processa nem busca retorno externo');
      if (tela === 'j2a') {
        const download = page.waitForEvent('download');
        await page.locator('.message-attachment[data-download-name]').click();
        assert.equal((await download).suggestedFilename(), 'teste (corrigido).py');
        assert.equal(requests.find(r => r.p.endsWith('/anexos/versao/download')).token, 'sessao-teste');
        await page.locator('[data-detalhes-tecnicos="m0"]').click();
        await page.evaluate(() => document.querySelector('#queue-list [data-ticket-id="ch-b"]').click());
        await painel.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.querySelector('[data-detalhes-tecnicos]'));
      } else {
        await page.locator('[data-detalhes-tecnicos="m0"]').click();
        await page.keyboard.press('Escape');
        assert.equal(await painel.isVisible(), false);
      }
      assert.deepEqual(erros, []);
    } finally { await page.close(); }
  });
}
