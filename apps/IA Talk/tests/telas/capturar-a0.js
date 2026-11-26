'use strict';

// A0 (Antigravity) — gera as capturas do protótipo da Central de Atendimento
// em apps/IA Talk/tests/telas/capturas/:
//   - Comparação (index.html): 1440 claro/escuro e 390 claro
//   - Alternativa A (4 áreas): 1440 claro/escuro, 1024 claro, 390 claro/escuro, 360 claro,
//     fluxo mobile (setores + folha deslizante IA), IA + menu "/", e estados
//     (desconectado, vazio, carregando, sem_permissao)
//   - Alternativa B (3 áreas + gaveta): 1440 claro (fechada e com gaveta IA), 1440 escuro,
//     1024 claro, 390 claro/escuro e 360 claro.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura, altura, tema = 'light', fullPage = false, acao = null }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
    } catch (_) {}
  }, tema);

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  if (acao) {
    await acao(page);
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk/prototipos/central`;
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Página de comparação
    await capturar(browser, { url: `${base}/index.html`, arquivo: 'a0-comparacao-1440-claro.png', largura: 1440, altura: 900, tema: 'light', fullPage: true });
    await capturar(browser, { url: `${base}/index.html`, arquivo: 'a0-comparacao-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark', fullPage: true });
    await capturar(browser, { url: `${base}/index.html`, arquivo: 'a0-comparacao-390-claro.png', largura: 390, altura: 844, tema: 'light', fullPage: true });

    // 2. Alternativa A — quatro áreas
    await capturar(browser, { url: `${base}/alternativa-a.html`, arquivo: 'a0-alt-a-1440-claro.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-a.html`, arquivo: 'a0-alt-a-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' });
    await capturar(browser, { url: `${base}/alternativa-a.html`, arquivo: 'a0-alt-a-1024-claro.png', largura: 1024, altura: 768, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-a.html?passo=lista`, arquivo: 'a0-alt-a-390-claro.png', largura: 390, altura: 844, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-a.html?passo=chat`, arquivo: 'a0-alt-a-390-escuro.png', largura: 390, altura: 844, tema: 'dark' });
    await capturar(browser, { url: `${base}/alternativa-a.html?passo=chat`, arquivo: 'a0-alt-a-360-claro.png', largura: 360, altura: 800, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-a.html?passo=setores`, arquivo: 'a0-alt-a-390-setores.png', largura: 390, altura: 844, tema: 'light' });
    await capturar(browser, {
      url: `${base}/alternativa-a.html?passo=chat&sheet=1&aba=ia`,
      arquivo: 'a0-alt-a-390-sheet-ia.png',
      largura: 390,
      altura: 844,
      tema: 'light',
      acao: async (page) => { await page.click('#btn-ia-sugestao'); },
    });

    // Alternativa A: IA sem cobrir conversa + respostas rápidas com /
    await capturar(browser, {
      url: `${base}/alternativa-a.html?aba=ia`,
      arquivo: 'a0-alt-a-ia-slash-1440.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.click('#btn-ia-sugestao');
        await page.fill('#campo-msg', '/');
        await page.waitForSelector('#slash-menu:not([hidden])');
      },
    });

    // Estados obrigatórios (desconectado, vazio, carregando, sem permissão)
    await capturar(browser, { url: `${base}/alternativa-a.html?cenario=desconectado`, arquivo: 'a0-alt-a-desconectado.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-a.html?cenario=vazio`, arquivo: 'a0-alt-a-vazio.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-a.html?cenario=carregando`, arquivo: 'a0-alt-a-carregando.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-a.html?cenario=sem_permissao`, arquivo: 'a0-alt-a-sem-permissao.png', largura: 1440, altura: 900, tema: 'light' });

    // 3. Alternativa B — três áreas + gaveta
    await capturar(browser, { url: `${base}/alternativa-b.html`, arquivo: 'a0-alt-b-1440-claro.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, {
      url: `${base}/alternativa-b.html?gaveta=1&aba=ia`,
      arquivo: 'a0-alt-b-1440-gaveta-ia-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => { await page.click('#btn-ia-resumo'); },
    });
    await capturar(browser, { url: `${base}/alternativa-b.html?gaveta=1`, arquivo: 'a0-alt-b-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' });
    await capturar(browser, { url: `${base}/alternativa-b.html`, arquivo: 'a0-alt-b-1024-claro.png', largura: 1024, altura: 768, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-b.html?passo=chat`, arquivo: 'a0-alt-b-390-claro.png', largura: 390, altura: 844, tema: 'light' });
    await capturar(browser, { url: `${base}/alternativa-b.html?passo=lista`, arquivo: 'a0-alt-b-390-escuro.png', largura: 390, altura: 844, tema: 'dark' });
    await capturar(browser, { url: `${base}/alternativa-b.html?passo=chat`, arquivo: 'a0-alt-b-360-claro.png', largura: 360, altura: 800, tema: 'light' });

    // 4. Layout Híbrido (Escolhido): 1440, 1280, 1024 (fechada + gaveta aberta), 390 e 360 px, claro e escuro
    await capturar(browser, { url: `${base}/hibrido.html`, arquivo: 'a0-hibrido-1440-claro.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url: `${base}/hibrido.html`, arquivo: 'a0-hibrido-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' });
    await capturar(browser, { url: `${base}/hibrido.html`, arquivo: 'a0-hibrido-1280-claro.png', largura: 1280, altura: 800, tema: 'light' });
    await capturar(browser, { url: `${base}/hibrido.html`, arquivo: 'a0-hibrido-1280-escuro.png', largura: 1280, altura: 800, tema: 'dark' });
    await capturar(browser, { url: `${base}/hibrido.html`, arquivo: 'a0-hibrido-1024-claro.png', largura: 1024, altura: 768, tema: 'light' });
    await capturar(browser, { url: `${base}/hibrido.html`, arquivo: 'a0-hibrido-1024-escuro.png', largura: 1024, altura: 768, tema: 'dark' });
    await capturar(browser, { url: `${base}/hibrido.html?gaveta=1&aba=ia`, arquivo: 'a0-hibrido-1024-gaveta-claro.png', largura: 1024, altura: 768, tema: 'light', acao: async (p) => { await p.click('#btn-ia-resumo'); } });
    await capturar(browser, { url: `${base}/hibrido.html?passo=chat`, arquivo: 'a0-hibrido-390-claro.png', largura: 390, altura: 844, tema: 'light' });
    await capturar(browser, { url: `${base}/hibrido.html?passo=chat`, arquivo: 'a0-hibrido-390-escuro.png', largura: 390, altura: 844, tema: 'dark' });
    await capturar(browser, { url: `${base}/hibrido.html?passo=chat`, arquivo: 'a0-hibrido-360-claro.png', largura: 360, altura: 800, tema: 'light' });
    await capturar(browser, { url: `${base}/hibrido.html?passo=chat`, arquivo: 'a0-hibrido-360-escuro.png', largura: 360, altura: 800, tema: 'dark' });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('a0-') && f.endsWith('.png')).sort();
    console.log(`Capturas A0 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
