const fs = require('node:fs');
const p = 'apps/IA Service/tests/conexao-servidor-ui.test.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace("let modo = 'ok', posts = 0, gets = 0;", "let modo = 'ok', posts = 0, gets = 0, versao = 1;");
s = s.replace("json: { valor: 'dados atualizados' }", "json: url.pathname === '/api/ia-service/atendimentos' ? [{ id: versao, codigo: '#' + versao, conteudoBruto: 'Atendimento de teste', status: 'Aberto' }] : { valor: 'dados atualizados' }");
s = s.replace("if (url.pathname.startsWith('/tela/')) {", "if (url.pathname.startsWith('/tela/') || url.pathname.startsWith('/real/')) {");
s = s.replace("const html = fs.readFileSync(path.join(frontend, nome), 'utf8').replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, tag => tag.includes('conexao-servidor.js') ? tag : '');", "const fonte = fs.readFileSync(path.join(frontend, nome), 'utf8');\n        const html = url.pathname.startsWith('/real/') ? fonte : fonte.replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, tag => tag.includes('conexao-servidor.js') ? tag : '');");
const inserir = `    // Consulta inicial aguarda a rede; 401 continua disponível para auth.js.
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
`;
s = s.replace('    // O Monitor usa seu aviso original, sem duplicação.', inserir + '    // O Monitor usa seu aviso original, sem duplicação.');
fs.writeFileSync(p, s);
