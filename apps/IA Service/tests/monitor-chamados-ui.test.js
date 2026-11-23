// Executar: node "apps/IA Service/tests/monitor-chamados-ui.test.js"
// Navegador com APIs simuladas: não acessa nem altera dados reais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const frontend = path.resolve(__dirname, '../frontend');
const agora = new Date().toISOString();
const chamados = Array.from({ length: 120 }, (_, i) => String(36000 + i));
const sessao = {
  id: 'chat:teste', pessoaRef: 'chat:consultor', nome: 'Consultor de teste', telefone: null,
  origem: 'chat', situacao: 'online', inicioEm: agora, ultimoSinalEm: agora,
  segundosAtivos: 60, tela: 'Radar J2A', acao: 'Fila pessoal', eventos: [], chamados,
};
const acesso = {
  id: 'acesso-teste', pessoaRef: sessao.pessoaRef, nome: sessao.nome, origem: 'chat',
  entrouEm: agora, ultimoSinalEm: agora, duracaoSegundos: 120, segundosAtivos: 60,
  telasVisitadas: 1, chamados, situacao: 'em_andamento', situacaoRotulo: 'Em andamento',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [360, 640]]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
      const erros = [];
      let listaLonga = false;
      const conversaPedidos = [];
      page.on('pageerror', (err) => erros.push(err.message));
      await page.addInitScript(() => { window._iahubEmpresa = { id: 1 }; });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const p = url.pathname;
        if (p === '/api/ia-service/monitor-acessos') {
          const sessoes = listaLonga ? Array.from({ length: 25 }, (_, i) => ({ ...sessao, id: `chat:${i}`, pessoaRef: `chat:pessoa-${i}`, nome: `Consultor ${i}` })) : [sessao, { ...sessao, id: 'chat:teste-2', chamados: chamados.slice(100) }];
          return route.fulfill({ json: { geradoEm: agora, resumo: { total: sessoes.length, segundosAtivos: 120 }, sessoes } });
        }
        if (p === '/api/ia-service/monitor-acessos/conversa') {
          conversaPedidos.push(Object.fromEntries(url.searchParams));
          const antes = url.searchParams.get('antes');
          const turno = (n, pergunta) => ({ id: `t${n}`, em: `2026-11-23T1${n}:00:00.000Z`, autor: 'Consultor de teste', pergunta, respostas: [{ id: `r${n}`, em: `2026-11-23T1${n}:01:00.000Z`, conteudo: `**Resposta ${n}**\n- item <script>x</script>` }] });
          return route.fulfill({ json: {
            chamado: { id: 'c1', numero: url.searchParams.get('numero'), titulo: 'Vencimento no sábado', cliente: 'FIERO', modulo: 'Financeiro', status: 'Andamento' },
            turnos: antes ? [turno(1, 'Pergunta antiga')] : [turno(2, 'Pergunta nova')],
            haMais: !antes,
          } });
        }
        if (p === '/api/ia-service/monitor-acessos/historico') return route.fulfill({ json: { acessos: listaLonga ? Array.from({ length: 25 }, (_, i) => ({ ...acesso, id: `acesso-${i}`, nome: `Consultor ${i}` })) : [acesso], falhas: [] } });
        if (p === '/shell-teste') return route.fulfill({ contentType: 'text/html', body: '<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:100dvh;display:flex;flex-direction:column;overflow:hidden"><header style="height:96px;flex:none">Abas do IA Service</header><iframe style="flex:1;min-height:0;width:100%;border:0" src="' + url.searchParams.get('tela') + '"></iframe></body></html>' });
        const arquivos = {
          '/monitor-acessos.html': [path.join(frontend, 'monitor-acessos.html'), 'text/html'],
          '/historico-acessos.html': [path.join(frontend, 'historico-acessos.html'), 'text/html'],
          '/css/iahub.css': [path.join(root, 'packages/ui/frontend/css/iahub.css'), 'text/css'],
          '/app/ia-service/css/iaservice-mobile.css': [path.join(frontend, 'css/iaservice-mobile.css'), 'text/css'],
          '/app/ia-service/js/mobile-viewport.js': [path.join(frontend, 'js/mobile-viewport.js'), 'text/javascript'],
          '/iaservice/assets/detalhes-tecnicos.js': [path.join(frontend, 'j2a/assets/detalhes-tecnicos.js'), 'text/javascript'],
        };
        if (arquivos[p]) return route.fulfill({ body: fs.readFileSync(arquivos[p][0]), contentType: arquivos[p][1] });
        return route.fulfill({ body: '', contentType: p.endsWith('.css') ? 'text/css' : 'text/javascript' });
      });
      await page.goto('http://iahub.test/monitor-acessos.html');
      const resumo = page.locator('[data-rot="Chamados acessados"]');
      await resumo.waitFor();
      assert.match(await resumo.innerText(), /120 chamado/);
      assert.ok((await page.locator('tr[data-id]').boundingBox()).height < (width < 500 ? 400 : 120), 'lista grande não estica a linha');
      await page.locator('#busca').fill('36119');
      assert.equal(await page.locator('tr[data-id]').count(), 1, 'busca acha chamado anterior');
      await page.locator('[data-ver-chamados]').click();
      assert.equal(await page.locator('#gv-chamados .badge').count(), 120, 'sessões são unidas sem duplicatas nem corte');
      assert.ok(await page.locator('#gv-chamados .chamados-acessados').evaluate((el) => el.scrollHeight > el.clientHeight), 'lista tem rolagem própria');
      await page.screenshot({ path: path.join(root, `tmp/monitor-chamados-${width}.png`), fullPage: true });
      // Clique no número abre a conversa com a IA, filtrada na pessoa.
      await page.locator('#gv-chamados [data-conversa="36119"]').click();
      const dialogo = page.locator('#conv-dialog');
      await dialogo.locator('.conv-msg.resposta').first().waitFor();
      assert.equal(conversaPedidos.at(-1).pessoa, 'chat:consultor', 'filtra pela pessoa, não pela sessão');
      assert.equal(conversaPedidos.at(-1).numero, '36119');
      assert.match(await page.locator('#conv-num').innerText(), /#36119 · FIERO/);
      assert.equal(await dialogo.locator('.conv-msg.resposta strong').innerText(), 'Resposta 2', 'resposta formatada como no J2A');
      assert.equal(await dialogo.locator('.conv-msg script').count(), 0, 'HTML da resposta nunca é executado');
      await dialogo.locator('[data-conv-mais]').click();
      await dialogo.locator('.conv-msg.pergunta', { hasText: 'Pergunta antiga' }).waitFor();
      assert.equal(await dialogo.locator('.conv-msg.pergunta').count(), 2, 'anteriores entram antes das atuais');
      assert.ok(conversaPedidos.at(-1).antes, 'pede as anteriores pelo turno mais antigo');
      await dialogo.locator('[data-conv-filtro="todos"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#conv-dialog .conv-msg.pergunta').length === 1);
      assert.equal(conversaPedidos.at(-1).pessoa, undefined, 'todos os analistas: sem filtro de pessoa');
      const cx = await dialogo.boundingBox();
      assert.ok(cx.width <= width && cx.height <= height, 'janela da conversa cabe na tela');
      await page.screenshot({ path: path.join(root, `tmp/monitor-conversa-${width}.png`) });
      await page.keyboard.press('Escape');
      await dialogo.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#gaveta').isVisible(), true, 'Esc fecha só a conversa, o painel continua');
      await page.goto('http://iahub.test/historico-acessos.html');
      await page.locator('[data-acesso-chamados]').click();
      assert.equal(await page.locator('#chamados-lista .badge').count(), 120);
      const caixa = await page.locator('#chamados-dialog').boundingBox();
      assert.ok(caixa.width <= width && caixa.height < 900, 'janela cabe na tela');
      await page.screenshot({ path: path.join(root, `tmp/historico-chamados-${width}.png`), fullPage: true });
      await page.locator('#chamados-busca').fill('36119');
      assert.equal(await page.locator('#chamados-lista .badge').count(), 1);
      await page.locator('#chamados-dialog [aria-label="Fechar"]').click();
      await page.locator('[data-acesso-chamados]').click();
      await page.keyboard.press('Escape');
      await page.locator('#chamados-dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#chamados-dialog').isVisible(), false);
      if (width < 500) {
        listaLonga = true;
        const fonteAbas = fs.readFileSync(path.join(frontend, 'js/tab-manager.js'), 'utf8');
        const cssAbas = fonteAbas.match(/s\.textContent = `([\s\S]*?)`;/)[1];
        const cdp = await page.context().newCDPSession(page);
        async function deslizar(x, y) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let passo = 1; passo <= 8; passo++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - passo * 35 }] });
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        for (const tela of ['monitor-acessos.html', 'historico-acessos.html']) {
          await page.goto(`http://iahub.test/${tela}`);
          await page.locator('#tbody tr').first().waitFor();
          await deslizar(180, height - 60);
          assert.ok(await page.locator('.page-content').evaluate((el) => el.scrollTop > 30), `${tela}: rolagem por toque fora das abas`);
          await page.goto(`http://iahub.test/shell-teste?tela=/${tela}`);
          const frame = page.frames().find((f) => f.parentFrame());
          await frame.locator('#tbody tr').first().waitFor();
          await frame.addStyleTag({ content: cssAbas });
          await frame.evaluate(() => {
            const bar = document.createElement('div'); bar.id = '_mdi-emp-bar'; bar.textContent = 'Empresa de teste';
            document.querySelector('.main').prepend(bar);
          });
          await deslizar(180, height - 60);
          const pos = await frame.evaluate(() => ({ corpo: document.scrollingElement.scrollTop, conteudo: document.querySelector('.page-content').scrollTop }));
          assert.ok(pos.corpo > 30 || pos.conteudo > 30, `${tela}: gesto deve rolar a lista nas abas (${JSON.stringify(pos)})`);
          await frame.locator('#tbody tr').last().scrollIntoViewIfNeeded();
          const ultimo = await frame.locator('#tbody tr').last().boundingBox();
          assert.ok(ultimo.y < height && ultimo.y + ultimo.height > 96, 'último registro alcançável na área visível');
          console.log(`${tela}: rolagem por toque nas abas OK`);
        }
      }
      assert.deepEqual(erros, []);
      await page.close();
      console.log(`monitor-chamados-ui: ${width}px OK (120 chamados, busca, rolagem e diálogo)`);
    }
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
