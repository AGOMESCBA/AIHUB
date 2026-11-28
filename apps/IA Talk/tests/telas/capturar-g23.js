'use strict';

// G23 (Antigravity) — gera capturas de mídia na Central, no Portal e no Histórico
// em apps/IA Talk/tests/telas/capturas/: 1440 e 390 px, temas claro e escuro.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');
const { AMOSTRAS } = require('../../backend/simulado/midia-simulada');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, {
  url,
  arquivo,
  largura = 1440,
  altura = 900,
  tema = 'light',
  esperar = '#chat-ativo:not([hidden])',
  acao = null,
}) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
      sessionStorage.removeItem('talk_simular');
    } catch (_) {}
  }, tema);

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(esperar);
  await page.waitForTimeout(250);
  if (acao) await acao(page);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: false });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. 1440 claro — Central em cv_ex01 (imagem com legenda abaixo, PDF e áudio de voz)
    await capturar(browser, {
      url: `${base}/atendimento.html?simular=atendente&conversa=cv_ex01`,
      arquivo: 'g23-central-midia-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#lista-mensagens .atd-midia-thumb');
        await page.evaluate(() => {
          const el = document.getElementById('lista-mensagens');
          if (el) el.scrollTop = el.scrollHeight;
        });
      },
    });

    // 2. 1440 escuro — Central em cv_ex01 com prévia de fila de anexos e legenda preenchida
    await capturar(browser, {
      url: `${base}/atendimento.html?simular=atendente&conversa=cv_ex01`,
      arquivo: 'g23-central-midia-1440-escuro.png',
      largura: 1440,
      altura: 900,
      tema: 'dark',
      acao: async (page) => {
        await page.waitForSelector('#lista-mensagens .atd-midia-thumb');
        await page.setInputFiles('#input-anexo', [
          { name: 'print-erro.png', mimeType: 'image/png', buffer: AMOSTRAS.imagem().dados },
          { name: 'comprovante-pix.pdf', mimeType: 'application/pdf', buffer: AMOSTRAS.pdf().dados },
        ]);
        await page.waitForSelector('#painel-previa-anexos:not([hidden])');
        await page.fill('#campo-legenda-anexo', 'Segue a captura e o comprovante em PDF.');
      },
    });

    // 3. 390 px celular claro — Portal do atendente em cv_ex01 mostrando anexos
    await capturar(browser, {
      url: `${base}/j2a/atendimento?simular=atendente&conversa=cv_ex01`,
      arquivo: 'g23-portal-midia-390-claro.png',
      largura: 390,
      altura: 844,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#lista-mensagens .atd-midia-thumb');
        await page.evaluate(() => {
          const el = document.getElementById('lista-mensagens');
          if (el) el.scrollTop = el.scrollHeight;
        });
      },
    });

    // 4. 390 px celular escuro — Central em cv_ex07 mostrando áudio expirado + prévia na conversa
    await capturar(browser, {
      url: `${base}/atendimento.html?conversa=cv_ex07`,
      arquivo: 'g23-central-expirado-390-escuro.png',
      largura: 390,
      altura: 844,
      tema: 'dark',
      acao: async (page) => {
        await page.waitForSelector('#lista-mensagens .atd-midia-indisponivel');
      },
    });

    // 5. 1440 claro — Histórico de mensagens (aba Envios) com anexo enviado aberto no detalhe
    await capturar(browser, {
      url: `${base}/atendimento.html?conversa=cv_ex02`,
      arquivo: 'g23-historico-anexo-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.setInputFiles('#input-anexo', {
          name: 'relatorio-atendimento.pdf',
          mimeType: 'application/pdf',
          buffer: AMOSTRAS.pdf().dados,
        });
        await page.fill('#campo-legenda-anexo', 'Relatório consolidado em PDF.');
        await page.click('#btn-enviar-anexo');
        await page.waitForSelector('#painel-previa-anexos[hidden]', { state: 'attached' });
        await page.goto(`${base}/mensagens.html?aba=envios`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#tabela .tabulator-row');
        await page.locator('#tabela .tabulator-row').filter({ hasText: 'Relatório consolidado em PDF.' }).first().click();
        await page.waitForSelector('#corpo-detalhe:not([hidden]) #bloco-anexos:not([hidden])');
      },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g23-') && f.endsWith('.png')).sort();
    console.log(`Capturas G23 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
