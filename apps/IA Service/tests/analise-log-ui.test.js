'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { localizarErros } = require('../backend/services/analise-log-service');

test('aba real J2A: avulso sem chamado, seleção automática, troca de chamado e telas móveis', { timeout: 90000 }, async () => {
  const root = path.resolve(__dirname, '../frontend/j2a');
  const tickets = ['A', 'B'].map(id => ({ id, numero: id === 'A' ? '123' : '456', titulo: `Chamado ${id}`, clienteNome: 'Teste', descricao: 'Descrição de teste' }));
  let resolverAnalise;
  let modoLista = 'normal';
  let resolverLista;
  let historicoSalvo = null;
  let falhaIA = false;
  const postsChat = [];
  const requestsLogs = [];
  const exclusoes = [];
  const relatorio = localizarErros(Buffer.from('THREAD ERROR\nVariable does not exist CTEST on U_TESTE(TESTE.PRW) line 42\n'), 'error.log');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/radar-externo') {
      res.setHeader('Content-Type', 'text/html');
      res.end(fs.readFileSync(path.resolve(root, '../radar.html'))); return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname.includes('/radar/logs')) requestsLogs.push(url.pathname + url.search);
      else if (req.method === 'POST' && /\/(?:abrir-atendimento|iniciar-analise|mensagens|investigar)$/.test(url.pathname)) postsChat.push(url.pathname);
      if (url.pathname.endsWith('/radar/logs/analisar')) {
        res.setHeader('Content-Type', 'application/x-ndjson');
        for (const etapa of ['arquivo', 'varredura', 'ia']) res.write(JSON.stringify({ tipo: 'progresso', etapa }) + '\n');
        resolverAnalise = () => { if (!res.destroyed && !res.writableEnded) res.end(JSON.stringify({ tipo: 'resultado', resultado: { ...relatorio, origem: { tipo: 'chat', numero: '123', chamadoId: 'A' } } }) + '\n'); };
        return;
      }
      let data = {};
      if (url.pathname.endsWith('/radar/logs/historico') && req.method === 'DELETE') {
        let body = ''; req.on('data', c => { body += c; });
        req.on('end', () => { exclusoes.push(JSON.parse(body).ids); historicoSalvo = null; res.end(JSON.stringify({ excluidas: exclusoes.at(-1).length })); });
        return;
      }
      if (url.pathname.endsWith('/radar/logs/historico')) data = { analises: historicoSalvo && !url.searchParams.has('chamadoId') ? [{ id: 'hist-1', nome: historicoSalvo.arquivo.nome, tipo: 'avulso', atualizadoEm: '2026-11-04T12:00:00Z', ocorrencias: 1, bytesHistorico: 900 }] : [] };
      if (url.pathname.endsWith('/radar/logs/historico/hist-1')) data = historicoSalvo;
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Analista' };
      if (url.pathname.endsWith('/fila')) data = { chamados: tickets };
      if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: tickets };
      if (url.pathname.endsWith('/abrir-atendimento')) data = { atendimentoId: url.pathname.includes('/A/') ? 'at-A' : 'at-B' };
      if (url.pathname.endsWith('/mensagens') || url.pathname.endsWith('/anexos')) data = [];
      if (url.pathname.endsWith('/radar/logs')) {
        const id = url.searchParams.get('chamadoId');
        data = { chamadoId: id, numero: id === 'A' ? '123' : '456', arquivos: [{ id: `anexo-${id}`, nome: `error-${id}.log`, tipo: 'chat', origem: 'Chat IA Service', disponivel: true }], avisos: [] };
        if (modoLista === 'vazio') data.arquivos = [];
        if (modoLista === 'erro') { res.statusCode = 503; data = { error: 'Falha de consulta simulada.' }; }
        if (modoLista === 'lento') { resolverLista = () => { if (!res.destroyed) res.end(JSON.stringify(data)); }; return; }
      }
      if (url.pathname.endsWith('/radar/logs/avulso')) {
        data = structuredClone({ ...relatorio, origem: { tipo: 'avulso' } });
        data.visaoGeral = { observado: 'Foi localizada uma referência a variável não existente.', atencao: 'Confirmar o contexto da rotina antes de alterar o código.', proximosPassos: 'Analista: encaminhar as evidências ao desenvolvedor.\nEquipe técnica: revisar a variável e validar em homologação.' };
        if (url.searchParams.get('grupoId')) {
          data.grupos[0].analise = { explicacao: 'Falha de variável.', causaProvavel: 'Verificar o fonte.', solucoes: 'Encaminhar ao desenvolvedor.', validacao: 'Repetir em homologação.', informacoesFaltantes: 'Fonte da rotina.' };
          data.ia = { gruposAnalisados: 1 };
        }
        if (falhaIA) { delete data.visaoGeral; data.ia = { gruposAnalisados: 0, indisponivel: true, falha: { codigo: 'TEMPO_ESGOTADO', mensagem: 'O provedor de IA não respondeu no tempo disponível. Tente analisar um erro individualmente.' } }; }
        if (url.searchParams.has('busca')) data = { termo: url.searchParams.get('busca'), total: 1, limite: 50, resultados: [{ linha: 301, evidencia: [{ linha: 301, texto: 'CTEST encontrado fora do trecho inicial' }] }] };
        else {
          data.historico = { id: 'hist-1', salvo: true, atualizadoEm: '2026-11-04T12:00:00Z', bytesHistorico: 900 };
          historicoSalvo = structuredClone(data);
        }
      }
      res.end(JSON.stringify(data)); return;
    }
    const relative = url.pathname.replace(/^\/iaservice\/(?:j2a\/)?assets\//, 'assets/').replace(/^\/iaservice\/j2a\/?/, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const abrirLogs = async () => {
      if (!await page.locator('[data-panel-tab="logs"]').isVisible()) await page.locator('.more-menu > summary').click();
      await page.locator('[data-panel-tab="logs"]').click();
    };
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'token-teste'));
    await page.goto(`http://127.0.0.1:${server.address().port}/iaservice/j2a/`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-ticket-id="A"]').first().waitFor();
    await abrirLogs();
    assert.equal(await page.locator('.topbar-actions > [data-panel-tab="logs"]:first-child + .ci-botao').count(), 1, 'análise aparece primeiro, seguida de Mensagens');
    assert.equal(await page.locator('.logs-shortcut-text').textContent(), 'Analise de Error.log');
    assert.equal(await page.locator('#panel-logs').isVisible(), true);
    assert.match(await page.locator('#logs-contexto').textContent(), /Nenhum chamado/);
    const cabecalho = await page.locator('.logs-hero').boundingBox();
    const entrada = await page.locator('.logs-source').boundingBox();
    assert.ok(Math.abs(cabecalho.width - entrada.width) < 1, 'entrada ocupa a largura do cabeçalho, conforme referência');
    assert.equal(await page.locator('.logs-guide').count(), 0, 'sem painel lateral de orientações');
    const abas = await page.locator('.logs-source-tabs').boundingBox();
    const analisar = await page.locator('#logs-analisar').boundingBox();
    assert.ok(Math.abs(abas.y + abas.height / 2 - analisar.y - analisar.height / 2) < 1, 'origens e análise na mesma linha');
    assert.ok(analisar.x > abas.x + abas.width + 10, 'ação Analisar log separada das origens');
    assert.ok(cabecalho.height < 150, 'cabeçalho compacto');
    assert.equal(await page.locator('.logs-source').evaluate(el => el.open), true, 'seleção do arquivo começa aberta');
    await page.locator('.logs-section-head').click();
    assert.equal(await page.locator('#logs-analisar').isVisible(), false, 'permite recolher a seleção do arquivo');
    await page.locator('.logs-section-head').click();
    assert.equal(await page.locator('#logs-analisar').isVisible(), true);
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-entrada-referencia.png'), animations: 'disabled' });
    await page.locator('#logs-modo-avulso').click();
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-novo-claro.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    const fundoDrop = await page.locator('#logs-drop').evaluate(el => ({ fundo: getComputedStyle(el).backgroundColor, soft: getComputedStyle(el).getPropertyValue('--logs-soft'), panel2: getComputedStyle(el).getPropertyValue('--panel-2') }));
    assert.equal(fundoDrop.soft.trim(), '#0c1c26', JSON.stringify(fundoDrop));
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-novo-inicio.png'), animations: 'disabled' });
    await page.locator('#logs-arquivo').setInputFiles({ name: 'avulso.log.txt', mimeType: 'text/plain', buffer: Buffer.from('THREAD ERROR\nFalha de teste') });
    await page.locator('#logs-analisar').click();
    await page.locator('#logs-resultado h3').first().waitFor();
    assert.equal(await page.locator('.logs-file-summary').evaluate(el => el.open), false, 'indicadores começam recolhidos');
    assert.equal(await page.locator('.logs-metrics').isVisible(), false);
    await page.locator('.logs-file-summary > summary').click();
    assert.equal(await page.locator('.logs-metrics').isVisible(), true, 'permite consultar os indicadores');
    await page.locator('.logs-file-summary > summary').click();
    assert.equal(await page.locator('.logs-overview').count(), 0, 'plano de investigação removido mesmo quando existe no histórico');
    await page.getByRole('heading', { name: 'As possíveis soluções ainda não foram geradas', exact: true }).waitFor();
    assert.match(await page.locator('#logs-resultado').textContent(), /Análise avulsa/);
    await page.locator('#logs-busca').fill('texto inexistente');
    assert.equal(await page.locator('[data-log-card]:visible').count(), 0);
    await page.locator('#logs-busca').fill('CTEST');
    assert.equal(await page.locator('[data-log-card]:visible').count(), 1);
    await page.locator('#logs-buscar-arquivo').click();
    await page.locator('#logs-busca-arquivo mark').waitFor();
    assert.match(await page.locator('#logs-busca-status').textContent(), /1 linha/);
    await page.locator('#logs-busca').fill('');
    await page.getByRole('button', { name: 'Analisar este erro', exact: true }).click();
    await page.getByText('Falha de variável.', { exact: true }).waitFor();
    assert.equal(await page.locator('.logs-informacoes-analise').evaluate(el => el.open), true, 'informações da análise abertas por padrão');
    await page.locator('.logs-informacoes-analise > summary').click();
    assert.equal(await page.locator('.logs-diagnostico-grid').isVisible(), false, 'permite recolher explicação, causa e soluções');
    await page.locator('.logs-informacoes-analise > summary').click();
    assert.equal(await page.locator('.logs-diagnostico-grid').isVisible(), true, 'permite expandir novamente');
    await page.locator('.logs-informacoes-analise > summary').click();
    await page.getByRole('button', { name: 'Ver possíveis soluções', exact: true }).click();
    assert.equal(await page.locator('.logs-informacoes-analise').evaluate(el => el.open), true, 'atalho reabre o diagnóstico recolhido');
    assert.equal(await page.locator('.logs-diagnostico.solucoes h4').textContent(), 'Possíveis soluções');
    assert.match(await page.locator('.logs-diagnostico.solucoes').textContent(), /Encaminhar ao desenvolvedor/);
    assert.ok(requestsLogs.some(p => /avulso\?grupoId=erro-1/.test(p)));
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-novo-resultado.png'), animations: 'disabled' });
    assert.equal(postsChat.length, 0, 'avulso não inicia chamado nem envia mensagem');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#logs-baixar').click();
    const download = await downloadPromise;
    assert.match(fs.readFileSync(await download.path(), 'utf8'), /Evidência.*trecho limitado/);
    assert.doesNotMatch(fs.readFileSync(await download.path(), 'utf8'), /O que foi observado|Onde começar|Próximos passos/);
    const chamadasAntesHistorico = requestsLogs.filter(p => p.includes('/avulso')).length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-ticket-id="A"]').first().waitFor(); await abrirLogs();
    await page.locator('#logs-historico').click();
    await page.locator('.logs-history-item').first().click();
    await page.getByText('Análise recuperada do histórico. Nenhuma nova chamada à IA foi feita.', { exact: true }).waitFor();
    assert.equal(requestsLogs.filter(p => p.includes('/avulso')).length, chamadasAntesHistorico);
    assert.match(await page.locator('#logs-resultado').textContent(), /Salvo no histórico/);
    assert.equal(await page.locator('#logs-analisar').isDisabled(), true, 'histórico avulso sem original não habilita nova análise');
    assert.doesNotMatch(await page.locator('#logs-ajuda').textContent(), /Arquivo pronto/);
    await page.locator('#logs-modo-avulso').click();
    const envioAntes = await page.locator('#logs-drop').boundingBox();
    await page.locator('#logs-historico').click();
    await page.locator('.logs-history-item').first().waitFor();
    assert.equal(await page.locator('#logs-historico-fechar').count(), 0, 'não há botão Fechar separado');
    assert.equal(await page.locator('#logs-historico').getAttribute('aria-expanded'), 'true');
    await page.locator('#logs-historico').click();
    assert.equal(await page.locator('#logs-historico-area').isVisible(), false);
    assert.equal(await page.locator('#logs-historico').getAttribute('aria-expanded'), 'false');
    const envioDepois = await page.locator('#logs-drop').boundingBox();
    assert.ok(Math.abs(envioAntes.height - envioDepois.height) < 1, 'abrir e fechar histórico preserva o formato do envio');
    await page.locator('#logs-historico').click();
    await page.locator('.logs-history-item').first().waitFor();
    await page.locator('#logs-historico-todas').check();
    assert.equal(await page.locator('[data-log-historico-id]:checked').count(), 1);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#logs-historico-excluir').click();
    assert.equal(exclusoes.length, 0, 'cancelar a confirmação preserva o histórico');
    page.once('dialog', async dialog => { assert.match(dialog.message(), /toda a equipe/); await dialog.accept(); });
    await page.locator('#logs-historico-excluir').click();
    await page.getByText('1 análise(s) excluída(s). Os arquivos originais foram preservados.', { exact: true }).waitFor();
    assert.deepEqual(exclusoes, [['hist-1']]);
    assert.equal(await page.locator('.logs-history-item').count(), 0);
    await page.locator('#logs-historico').click();

    await page.locator('[data-ticket-id="A"]').first().click();
    await abrirLogs();
    await page.locator('#logs-modo-chamado').click();
    await page.locator('.logs-item').filter({ hasText: 'error-A.log' }).waitFor();
    assert.ok(requestsLogs.some(p => /chamadoId=A/.test(p)));
    await page.locator('input[name="logs-selecao"]').check();
    await page.locator('#logs-analisar').click();
    await page.waitForFunction(() => document.querySelector('#logs-analisar').disabled);
    const inicioEspera = Date.now();
    while (!resolverAnalise) {
      if (Date.now() - inicioEspera > 3000) throw new Error('Requisição simulada de análise não iniciou.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await page.waitForFunction(() => document.querySelector('[data-log-step="ia"]').dataset.estado === 'ativo');
    assert.equal(await page.locator('#logs-splash').isVisible(), false, 'inicia com acompanhamento compacto');
    assert.equal(await page.locator('#logs-monitor').isVisible(), true);
    await page.locator('#logs-monitor-detalhes').click();
    assert.equal(await page.locator('#logs-splash').isVisible(), true);
    assert.equal(await page.locator('dialog:modal').count(), 0, 'detalhes não bloqueiam a página');
    await page.locator('#logs-analisar').evaluate(b => { b.click(); b.click(); });
    assert.equal(requestsLogs.filter(p => p.includes('/radar/logs/analisar')).length, 1, 'cliques repetidos não reenviam análise');
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-novo-splash.png'), animations: 'disabled' });
    await page.locator('[data-ticket-id="B"]').first().click();
    assert.equal(await page.locator('#logs-splash').isVisible(), true, 'troca de chamado funciona mesmo com detalhes abertos');
    await page.locator('#logs-continuar').click();
    assert.equal(await page.locator('#logs-analisar').isDisabled(), true);
    await page.locator('#message-input').fill('Continuo atendendo enquanto o log é analisado.');
    assert.equal(await page.locator('#logs-monitor').isVisible(), true, 'acompanhamento permanece no chat de outro chamado');
    assert.match(await page.locator('#logs-monitor-arquivo').textContent(), /error-A.log/);
    const monitorBox = await page.locator('#logs-monitor').boundingBox();
    const composerBox = await page.locator('#composer').boundingBox();
    assert.ok(monitorBox.y + monitorBox.height < composerBox.y, 'cartão não encobre a área de escrever/enviar mensagens');
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-monitor-chat.png'), animations: 'disabled' });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator('#message-input').click();
      const card = await page.locator('#logs-monitor').boundingBox();
      const campo = await page.locator('#message-input').boundingBox();
      assert.ok(card.x >= 0 && card.x + card.width <= width + 1, `acompanhamento cabe em ${width}px`);
      assert.ok(card.y + card.height < campo.y, `acompanhamento não encobre a mensagem em ${width}px`);
      await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/analise-logs-monitor-${width}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#logs-monitor-recolher').click();
    assert.ok((await page.locator('#logs-monitor').boundingBox()).height < 80, 'permite recolher o acompanhamento sem interromper a análise');
    await page.locator('#logs-monitor-recolher').click();
    await page.locator('#message-input').focus();
    if (resolverAnalise) resolverAnalise();
    await page.getByText('Análise concluída', { exact: true }).waitFor();
    assert.equal(await page.locator('#message-input').evaluate(el => document.activeElement === el), true, 'conclusão não tira o foco do atendimento');
    await page.locator('#logs-monitor-resultado').click();
    await page.locator('#logs-resultado h3').first().waitFor();
    assert.match(await page.locator('#logs-resultado').textContent(), /Chamado #123/, 'resultado mantém a origem A após atender B');
    await abrirLogs();
    await page.locator('.logs-item').filter({ hasText: 'error-B.log' }).waitFor();
    assert.equal(await page.locator('#logs-resultado').textContent(), '', 'resultado do chamado anterior não aparece no novo chamado');
    assert.match(await page.locator('#logs-contexto').textContent(), /#456/);
    modoLista = 'vazio'; await page.locator('#logs-atualizar').click();
    await page.getByRole('heading', { name: 'Nenhum log neste atendimento' }).waitFor();
    assert.equal(await page.locator('#logs-analisar').isDisabled(), true);
    modoLista = 'erro'; await page.locator('#logs-atualizar').click();
    await page.getByRole('heading', { name: 'Não conseguimos buscar os logs' }).waitFor();
    modoLista = 'lento'; await page.locator('#logs-atualizar').click();
    await page.getByRole('heading', { name: 'Buscando os logs do atendimento' }).waitFor();
    assert.equal(await page.locator('#logs-atualizar').isDisabled(), true);
    await page.locator('#logs-modo-avulso').click(); resolverLista?.(); modoLista = 'normal';

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await abrirLogs();
      assert.equal(await page.locator('#panel-logs').isVisible(), true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `sem rolagem horizontal em ${width}px`);
      await page.locator('#logs-modo-avulso').click();
      await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/analise-logs-${width}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/radar-externo`, { waitUntil: 'domcontentloaded' });
    await page.locator('#tab-logs').click();
    assert.equal(await page.locator('#painel-logs').isVisible(), true);
    await page.locator('#logs-modo-avulso').click();
    await page.locator('#logs-arquivo').setInputFiles({ name: 'avulso.log', mimeType: 'text/plain', buffer: Buffer.from('THREAD ERROR\nFalha de teste') });
    await page.locator('#logs-analisar').click();
    await page.locator('#logs-resultado h3').first().waitFor();
    assert.match(await page.locator('#logs-resultado').textContent(), /Análise avulsa/);
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-radar-desktop.png') });
    await page.locator('#logs-monitor-fechar').click();
    falhaIA = true;
    await page.locator('#logs-analisar').click();
    await page.getByText('Leitura concluída com aviso', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'As possíveis soluções ainda não foram geradas', exact: true }).waitFor();
    assert.match(await page.locator('.logs-solutions-summary').textContent(), /não respondeu no tempo disponível/);
    assert.equal(await page.getByRole('button', { name: 'Ver possíveis soluções', exact: true }).count(), 0, 'falha não é apresentada como diagnóstico concluído');
    assert.deepEqual(errors, []);
  } finally {
    resolverLista?.();
    resolverAnalise?.();
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
