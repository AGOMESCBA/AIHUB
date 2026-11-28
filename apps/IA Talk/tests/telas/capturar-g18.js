'use strict';

// G18 (Antigravity) — gera as capturas em apps/IA Talk/tests/telas/capturas/:
//   - Canais › aba Conexão › Regras do canal com "Uso do número", setor padrão e aviso
//     do modo Compartilhado em 1440 e 390 px, claro e escuro (4 imagens)
//   - Estados adicionais em 1440 claro: "Só integração" (setor escondido), erro 400 no
//     campo setor_padrao_id e somente leitura (fora da administração da plataforma).
// Nenhum número completo, token ou segredo aparece nas capturas.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura = 1440, altura = 900, tema = 'light', antes = null, acao = null }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
      sessionStorage.removeItem('talk_simular');
    } catch (_) {}
  }, tema);

  if (antes) await antes(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  if (acao) await acao(page);
  // Volta ao topo antes de fullPage para que .editor-bar (position: sticky) fique no cabeçalho sem sobrepor o formulário.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Matriz obrigatória 1440 e 390 px, claro e escuro (cn_suporte: Compartilhado + Suporte + aviso)
    const matriz = [
      { arquivo: 'g18-canais-uso-1440-claro.png',  largura: 1440, altura: 900, tema: 'light' },
      { arquivo: 'g18-canais-uso-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' },
      { arquivo: 'g18-canais-uso-390-claro.png',   largura: 390,  altura: 844, tema: 'light' },
      { arquivo: 'g18-canais-uso-390-escuro.png',  largura: 390,  altura: 844, tema: 'dark' },
    ];
    for (const c of matriz) {
      await capturar(browser, {
        url: `${base}/canais.html?id=cn_suporte`,
        arquivo: c.arquivo,
        largura: c.largura,
        altura: c.altura,
        tema: c.tema,
        acao: async (page) => {
          await page.waitForSelector('#bloco-regras:not([hidden])');
          await page.waitForSelector('#r-uso-aviso-compartilhado:not([hidden])');
        },
      });
    }

    // 2. Estado "Só integração" (cn_financeiro): setor e aviso escondidos
    await capturar(browser, {
      url: `${base}/canais.html?id=cn_financeiro`,
      arquivo: 'g18-canais-uso-integracao-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#bloco-regras:not([hidden])');
      },
    });

    // 3. Estado erro 400 no campo setor_padrao_id (Atendimento sem escolher setor)
    await capturar(browser, {
      url: `${base}/canais.html?id=cn_financeiro`,
      arquivo: 'g18-canais-uso-erro-400-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#bloco-regras:not([hidden])');
        await page.selectOption('#r-uso', 'atendimento');
        await page.click('#btn-salvar-regras');
        await page.waitForSelector('#erro-setor_padrao_id');
      },
    });

    // 4. Estado somente leitura (fora da administração da plataforma)
    await capturar(browser, {
      url: `${base}/canais.html?id=cn_suporte`,
      arquivo: 'g18-canais-uso-somente-leitura-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      antes: async (page) => {
        await page.route('**/api/admin/sessao', async (route) => {
          const resp = await route.fetch();
          const dados = await resp.json();
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...dados,
              usuario: { ...dados.usuario, administrador_plataforma: false },
            }),
          });
        });
      },
      acao: async (page) => {
        await page.waitForSelector('#regras-somente-leitura:not([hidden])');
      },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g18-') && f.endsWith('.png')).sort();
    console.log(`Capturas G18 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
