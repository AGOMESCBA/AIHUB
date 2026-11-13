// Executar: node "apps/IA Service/tests/conexao-servidor-ui.test.js"
// APIs simuladas; nenhum acesso a dados reais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const frontend = path.resolve(__dirname, '../frontend');
const root = path.resolve(frontend, '../../..');
const paginas = ['atendimento.html', 'atendimentos.html', 'base-historica.html', 'config-ia.html', 'consultores.html', 'entrar.html', 'historico-acessos.html', 'home.html', 'homologacao.html', 'limpeza-anexos.html', 'numeros-autorizados.html', 'radar.html', 'shell.html', 'j2a/index.html', 'guia/index.html'];
let verificacoes = 0;
function ok(valor, mensagem) { assert.ok(valor, mensagem); verificacoes++; }
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.clock.install();
    let modo = 'ok', posts = 0, gets = 0, versao = 1;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        if (route.request().method() === 'POST') posts++; else gets++;
        if (modo === 'rede') return route.abort('connectionrefused');
        if (modo === 'timeout') return;
        return route.fulfill({ status: modo === 'ok' ? 200 : Number(modo), json: url.pathname === '/api/ia-service/atendimentos' ? [{ id: versao, codigo: '#' + versao, conteudoBruto: 'Atendimento de teste', status: 'Aberto' }] : { valor: 'dados atualizados' } });
      }
      if (url.pathname.startsWith('/iaservice/assets/')) {
        const arquivo = path.join(frontend, 'j2a/assets', path.basename(url.pathname));
        if (fs.existsSync(arquivo)) return route.fulfill({ body: fs.readFileSync(arquivo), contentType: arquivo.endsWith('.css') ? 'text/css' : 'text/javascript' });
      }
      if (url.pathname === '/css/iahub.css') return route.fulfill({ body: fs.readFileSync(path.join(root, 'packages/ui/frontend/css/iahub.css')), contentType: 'text/css' });
      if (url.pathname.startsWith('/tela/') || url.pathname.startsWith('/real/')) {
        const nome = url.pathname.slice(6);
        // Mantém o DOM e CSS reais; isola o componente das regras de negócio.
        const fonte = fs.readFileSync(path.join(frontend, nome), 'utf8');
        const html = url.pathname.startsWith('/real/') ? fonte : fonte.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, tag => tag.includes('conexao-servidor.js') ? tag : '');
        return route.fulfill({ body: html, contentType: 'text/html' });
      }
      return route.fulfill({ body: '', contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    async function iniciar(nome = 'atendimentos.html') {
      modo = 'ok';
      await page.goto('http://iahub.test/tela/' + nome);
      await page.evaluate(() => {
        const input = document.createElement('textarea'); input.id = 'rascunho-teste'; input.value = 'Mensagem ainda em edição'; document.body.append(input);
      });
    }
    async function consulta() {
      await page.evaluate(() => {
        window.resultadoTeste = null;
        fetch('/api/ia-service/teste?empresa_id=1').then(r => r.json()).then(d => window.resultadoTeste = d.valor).catch(e => window.resultadoTeste = e.name);
      });
    }
    async function aviso() { await page.locator('.svc-conn.mostrar:not(.ok)').waitFor(); }
    async function recuperado() { await page.locator('.svc-conn.ok').waitFor(); }
    // Todos os layouts, em desktop e celular, com a mesma faixa e sem overflow.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const nome of paginas.filter(nome => !process.env.SVC_CONEXAO_RAPIDO || nome === 'atendimentos.html')) {
        await iniciar(nome);
        if (nome === 'j2a/index.html') await page.evaluate(() => { document.querySelector('#radar-screen').hidden = false; document.querySelector('#access-screen').hidden = true; });
        await consulta();
        await page.waitForFunction(() => window.resultadoTeste === 'dados atualizados');
        modo = '502';
        await consulta(); await aviso();
        ok((await page.locator('.conn-titulo').innerText()).includes('Sem comunicação com o servidor do IAHub'), nome + ': título correto');
        ok((await page.locator('.conn-tec').innerText()).includes('HTTP 502'), nome + ': detalhe técnico');
        const caixa = await page.locator('.svc-conn').boundingBox();
        ok(caixa && caixa.width > 200 && caixa.x >= 0 && caixa.x + caixa.width <= width + 1, nome + ': faixa visível e cabe na tela ' + width);
        if (nome === 'atendimentos.html' || nome === 'j2a/index.html') {
          fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
          await page.screenshot({ path: path.join(root, 'tmp', `conexao-${nome.includes('j2a') ? 'radar' : 'atendimentos'}-${width}.png`) });
        }
        modo = 'ok';
        await page.locator('.conn-retry').click();
        await page.waitForFunction(() => window.resultadoTeste === 'dados atualizados');
        await recuperado();
        ok(await page.locator('#rascunho-teste').inputValue() === 'Mensagem ainda em edição', nome + ': preserva rascunho');
      }
    }
    await iniciar();
    modo = 'rede'; await consulta(); await aviso();
    modo = 'ok'; await page.clock.fastForward(5000);
    await recuperado(); ok(await page.evaluate(() => window.resultadoTeste) === 'dados atualizados', 'reconexão automática entrega resposta ao chamador original');
    // Uma nova queda volta a exibir o botão após o aviso verde.
    modo = '503'; await consulta(); await aviso();
    ok(await page.locator('.conn-retry').isVisible(), 'botão reaparece em nova queda');
    modo = 'ok'; await page.locator('.conn-retry').click(); await recuperado();
    await page.clock.fastForward(8000);
    ok(!await page.locator('.svc-conn').isVisible(), 'confirmação some após oito segundos');
    // Gravações retornam seu erro e nunca entram em replay automático.
    await iniciar(); modo = '502'; const antes = posts;
    ok(await page.evaluate(async () => (await fetch('/api/ia-service/mensagens', { method: 'POST', body: 'rascunho' })).status) === 502, 'gravação mantém resposta original');
    await aviso(); modo = 'ok'; await page.clock.fastForward(5000); await recuperado();
    ok(posts === antes + 1, 'mensagem não é reenviada');
    for (const status of ['400', '401', '403', '404', '429']) {
      await iniciar(); modo = status;
      const recebido = await page.evaluate(async () => (await fetch('/api/ia-service/teste')).status);
      ok(recebido === Number(status) && !await page.locator('.svc-conn').isVisible(), 'HTTP ' + status + ' segue tratamento da tela');
    }
    await iniciar(); modo = 'timeout'; await consulta();
    await page.clock.fastForward(15000); await aviso();
    ok((await page.locator('.conn-titulo').innerText()).includes('não respondeu a tempo'), 'timeout mostra aviso específico');
    modo = 'ok'; await page.locator('.conn-retry').click(); await recuperado();
    // Cancelamento voluntário não representa queda do servidor.
    await iniciar(); modo = 'timeout';
    await page.evaluate(() => {
      const ctrl = new AbortController();
      fetch('/api/ia-service/cancelar', { signal: ctrl.signal }).catch(() => {}); ctrl.abort();
    });
    ok(!await page.locator('.svc-conn').isVisible(), 'cancelamento não produz falso aviso');
    // Polling simultâneo em falha compartilha a tentativa de recuperação.
    await iniciar(); modo = '502'; await consulta(); await aviso();
    const antesGet = gets;
    await page.evaluate(() => {
      window.resultadosParalelos = [];
      for (let i = 0; i < 3; i++) fetch('/api/ia-service/teste?empresa_id=1').then(r => r.json()).then(d => window.resultadosParalelos.push(d.valor));
    });
    modo = 'ok'; await page.locator('.conn-retry').click(); await recuperado();
    await page.waitForFunction(() => window.resultadosParalelos.length === 3);
    ok(gets === antesGet + 1, 'polling em falha não multiplica requisições');
    // Consulta inicial aguarda a rede; 401 continua disponível para auth.js.
    await iniciar(); modo = '503';
    await page.evaluate(() => { window.inicial = null; fetch('/api/me').then(r => window.inicial = r.status); });
    await aviso(); modo = 'ok'; await page.locator('.conn-retry').click(); await recuperado();
    ok(await page.evaluate(() => window.inicial) === 200, 'consulta inicial aguarda reconexão');
    await iniciar(); modo = '401';
    ok(await page.evaluate(async () => (await fetch('/api/me')).status) === 401, 'sessão inválida segue contrato original');
    // Cancelar uma consulta que já estava em falha não comprova recuperação.
    await iniciar(); modo = '502';
    await page.evaluate(() => { window.ctrlTeste = new AbortController(); fetch('/api/ia-service/cancelar', { signal: window.ctrlTeste.signal }).catch(() => {}); });
    await aviso(); await page.evaluate(() => window.ctrlTeste.abort());
    ok(!await page.locator('.svc-conn.ok').count(), 'cancelamento não anuncia reconexão');
    modo = 'ok'; await page.locator('.conn-retry').click(); await recuperado();
    // Sem consultas da tela, o heartbeat também detecta indisponibilidade.
    await iniciar(); modo = '503'; await page.clock.fastForward(30000); await aviso();
    ok(await page.locator('.svc-conn').isVisible(), 'tela sem polling detecta queda');
    modo = 'ok'; await page.clock.fastForward(5000); await recuperado();
    await iniciar(); await context.setOffline(true); await aviso();
    ok((await page.locator('.conn-titulo').innerText()).includes('sem internet'), 'offline informa causa local');
    await context.setOffline(false); await recuperado();
    // Código real da tela: conserva a lista e o formulário durante a queda e
    // retoma a renderização pela promessa original, sem recarregar a página.
    modo = 'ok';
    await page.addInitScript(() => { window._iahubEmpresa = { id: 1 }; });
    await page.goto('http://iahub.test/real/atendimentos.html');
    await page.waitForFunction(() => document.querySelector('.atendimento-codigo')?.textContent === '#1');
    await page.locator('#conteudo-bruto').fill('Texto de chamado ainda não enviado');
    modo = '502'; await page.evaluate(() => { carregarAtendimentos(); }); await aviso();
    ok(await page.locator('.atendimento-codigo').innerText() === '#1', 'lista real preservada durante a queda');
    versao = 2; modo = 'ok'; await page.locator('.conn-retry').click(); await recuperado();
    await page.waitForFunction(() => document.querySelector('.atendimento-codigo')?.textContent === '#2');
    ok(await page.locator('#conteudo-bruto').inputValue() === 'Texto de chamado ainda não enviado', 'formulário real preservado após atualização');
    modo = '502'; await page.evaluate(() => { carregarAtendimentos(); }); await aviso();
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(root, 'tmp/conexao-atendimentos-real-dark.png') });
    ok((await page.locator('.svc-conn').evaluate(el => getComputedStyle(el).backgroundColor)) !== 'rgb(255, 255, 255)', 'aviso respeita tema escuro');
    modo = 'ok'; await page.locator('.conn-retry').click(); await recuperado();
    // O Monitor usa seu aviso original, sem duplicação.
    ok(fs.readFileSync(path.join(frontend, 'monitor-acessos.html'), 'utf8').includes('data-conexao-nativa'), 'Monitor preserva implementação nativa');
    console.log(`OK: ${verificacoes} verificações; 15 layouts em desktop/celular, rede, gateway, timeout, retry, gravações, cancelamento e polling.`);
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
