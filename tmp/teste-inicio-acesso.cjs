const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [app, rotina, esperado, proibido] of [
      ['IA Command', 'iac-dashboard', 'Visão geral', 'WhatsApp Services'],
      ['IA Service', 'svc-atendimentos', 'Atendimentos', 'Radar de Chamados'],
    ]) {
      const page = await browser.newPage();
      await page.route('http://inicio.test/**', route => route.fulfill({ contentType: 'text/html', body: '<nav id="sidebar"><div class="sidebar-nav"></div></nav><main id="mdi-empty"></main>' }));
      await page.goto('http://inicio.test/');
      await page.evaluate(id => {
        window._iahubRotinas = [id];
        window._iahubUser = { role: 'user' };
        window._iahubRotinasReady = Promise.resolve([id]);
      }, rotina);
      await page.addScriptTag({ path: path.join(process.cwd(), 'apps', app, 'frontend/js/sidebar.js') });
      await page.addScriptTag({ path: path.join(process.cwd(), 'packages/ui/frontend/js/inicio-sistemas.js') });
      await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
      await page.waitForSelector('.inicio-card');
      const result = await page.evaluate(() => ({
        menu: [...document.querySelectorAll('.sidebar-nav a.nav-item')].map(a => a.querySelector('.nav-label').textContent.trim()),
        cards: [...document.querySelectorAll('.inicio-card strong')].map(a => a.textContent.trim()),
      }));
      if (JSON.stringify(result.menu) !== JSON.stringify(result.cards) || !result.cards.includes(esperado) || result.cards.includes(proibido)) throw new Error(`${app}: ${JSON.stringify(result)}`);
      await page.evaluate(() => {
        document.addEventListener('click', event => {
          const link = event.target.closest('#sidebar a.nav-item');
          if (link) { event.preventDefault(); window._clicado = link.getAttribute('href'); }
        });
      });
      await page.locator('.inicio-card').first().click();
      const destino = await page.evaluate(() => window._clicado);
      if (!destino) throw new Error(`${app}: card não acionou o menu`);
      console.log(`${app}: acesso ${rotina}; menu e card: ${result.cards.join(', ')}; destino: ${destino}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
