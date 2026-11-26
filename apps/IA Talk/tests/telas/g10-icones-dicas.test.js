'use strict';

// G10 (Antigravity) — testes em Playwright para:
//   1. Ícones SVG inline (talk-icones.js, 16 px, viewBox 24, stroke currentColor)
//      em todos os botões de ação das 9 telas do IA Talk, sem caracteres soltos.
//   2. Dicas (title + aria-label) em todos os botões de ação e preservação de .tlk-ico-giro.
//   3. Lista de canais recolhível (~56 px com bolinhas e dicas) no Terminal ao vivo:
//      começa recolhida com 1 canal, alterna pelo botão "Canais", salva em localStorage
//      (com try/catch), libera largura para o log e mantém zero rolagem horizontal em 1440/1024/390.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const CARACTERES_SOLTOS = /[↻▶■☰↓←⬇↺📤👁↗→⏸]|^\s*[+−]\s/;

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 400, intervaloQrMs: 20000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await sim?.fechar();
});

async function novaPagina(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  return { ctx, page, erros };
}

async function auditarBotoesVisiveis(page, contexto) {
  const relatorio = await page.evaluate(() => {
    const botoes = [...document.querySelectorAll('button.btn, a.btn, button.tlk-pass-btn')]
      .filter((el) => {
        if (el.closest('[hidden]')) return false;
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
      });
    return botoes.map((el) => {
      const svg = el.querySelector('svg.tlk-ico');
      return {
        id: el.id || '',
        texto: (el.textContent || '').trim(),
        title: (el.getAttribute('title') || '').trim(),
        ariaLabel: (el.getAttribute('aria-label') || '').trim(),
        temSvg: !!svg,
        viewBox: svg?.getAttribute('viewBox') || '',
        stroke: svg?.getAttribute('stroke') || '',
        w: svg?.getAttribute('width') || '',
        h: svg?.getAttribute('height') || '',
      };
    });
  });

  assert.ok(relatorio.length > 0, `${contexto}: deveria haver botões de ação visíveis`);
  for (const b of relatorio) {
    assert.equal(b.temSvg, true, `${contexto}: botão "${b.id || b.texto}" sem ícone SVG .tlk-ico`);
    assert.equal(b.viewBox, '0 0 24 24', `${contexto}: ícone do botão "${b.id || b.texto}" fora do padrão viewBox 24`);
    assert.equal(b.stroke, 'currentColor', `${contexto}: ícone do botão "${b.id || b.texto}" sem stroke="currentColor"`);
    assert.equal(b.w, '16', `${contexto}: ícone do botão "${b.id || b.texto}" fora de 16 px`);
    assert.equal(b.h, '16', `${contexto}: ícone do botão "${b.id || b.texto}" fora de 16 px`);
    assert.ok(b.title.length >= 10, `${contexto}: botão "${b.id || b.texto}" sem title explicativo ("${b.title}")`);
    assert.ok(b.ariaLabel.length >= 10, `${contexto}: botão "${b.id || b.texto}" sem aria-label explicativo ("${b.ariaLabel}")`);
    assert.equal(CARACTERES_SOLTOS.test(b.texto), false, `${contexto}: botão "${b.id || b.texto}" ainda contém caractere solto ("${b.texto}")`);
  }
}

test('G10 todas as 9 telas: ícones SVG padrão 16 px, dicas (title + aria-label), sem caracteres soltos e tlk-ico-giro', async () => {
  const telas = [
    { arquivo: 'canais.html', espera: '.tabulator-row' },
    { arquivo: 'usuarios.html', espera: '.tabulator-row' },
    { arquivo: 'aplicacoes.html', espera: '.tabulator-row' },
    { arquivo: 'empresas.html', espera: '.tabulator-row' },
    { arquivo: 'configuracoes.html', espera: '#cartao-config:not([hidden])' },
    { arquivo: 'auditoria.html', espera: '.tabulator-row' },
    { arquivo: 'painel.html', espera: '#conteudo-painel:not([hidden])' },
    { arquivo: 'mensagens.html', espera: '.tabulator-row' },
    { arquivo: 'eventos.html', espera: '.tabulator-row' },
  ];

  const { ctx, page, erros } = await novaPagina();
  try {
    for (const t of telas) {
      await page.goto(`${baseUrl}/${t.arquivo}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(t.espera);
      await auditarBotoesVisiveis(page, t.arquivo);

      // Todos os botões #btn-atualizar devem preservar .tlk-ico-giro no ícone SVG
      const temGiro = await page.locator('#btn-atualizar svg.tlk-ico.tlk-ico-giro').count();
      assert.equal(temGiro, 1, `${t.arquivo}: #btn-atualizar perdeu a classe tlk-ico-giro`);
    }

    // Também verifica vistas internas de configuracoes.html (abas Sites e E-mail) e aplicacoes.html (Tokens/Webhook)
    await page.goto(`${baseUrl}/configuracoes.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#cartao-config:not([hidden])');
    await page.click('#aba-sites');
    await auditarBotoesVisiveis(page, 'configuracoes.html#sites');
    await page.click('#aba-email');
    await auditarBotoesVisiveis(page, 'configuracoes.html#email');

    await page.goto(`${baseUrl}/aplicacoes.html?id=app_jobs`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    await auditarBotoesVisiveis(page, 'aplicacoes.html#dados');
    await page.click('#aba-tokens');
    await auditarBotoesVisiveis(page, 'aplicacoes.html#tokens');
    await page.click('#aba-webhook');
    await auditarBotoesVisiveis(page, 'aplicacoes.html#webhook');

    // Verifica canais.html detalhe (Conexão + Terminal + Empresas) e animação comGiro
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte&aba=terminal`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#painel-terminal:not([hidden])');
    await auditarBotoesVisiveis(page, 'canais.html#terminal');
    assert.equal(await page.locator('#btn-term-atualizar-lista svg.tlk-ico.tlk-ico-giro').count(), 1);
    assert.equal(await page.locator('#btn-recarregar-log svg.tlk-ico.tlk-ico-giro').count(), 1);

    // Dispara comGiro no #btn-recarregar-log e confirma classe tlk-btn-girando ativa
    await page.click('#btn-recarregar-log');
    const girou = await page.locator('#btn-recarregar-log').evaluate((el) => el.classList.contains('tlk-btn-girando'));
    assert.equal(girou, true, 'comGiro deveria adicionar tlk-btn-girando em #btn-recarregar-log');

    // Ações perigosas têm dica explicando o efeito e confirmação inline
    const dicaRemover = await page.getAttribute('#btn-term-limpar-sessao', 'title');
    assert.match(dicaRemover || '', /novo QR Code/i);
    const dicaParar = await page.getAttribute('#btn-term-parar', 'title');
    assert.match(dicaParar || '', /mantendo a sessão salva/i);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G10 Terminal ao vivo: com 1 canal começa recolhida (~56 px com bolinha e dica), alterna com persistência em localStorage e sem rolagem horizontal', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    // Intercepta GET /api/admin/canais para devolver apenas 1 canal (cn_suporte)
    await page.route('**/api/admin/canais?*', async (route) => {
      const resp = await route.fetch();
      const dados = await resp.json();
      const unico = Array.isArray(dados.itens) ? dados.itens.filter((c) => c.id === 'cn_suporte') : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...dados, itens: unico, total: unico.length, proximo_cursor: null }),
      });
    });

    await page.goto(`${baseUrl}/canais.html?id=cn_suporte&aba=terminal`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#painel-terminal:not([hidden])');
    await page.waitForSelector('#term-lista-canais .tlk-term-card');

    // Com 1 canal e sem escolha prévia, deve iniciar recolhida (~56 px)
    const estadoInicial = await page.evaluate(() => {
      const layout = document.getElementById('term-layout');
      const sidebar = document.querySelector('.tlk-term-sidebar');
      const terminal = document.getElementById('terminal');
      const card = document.querySelector('#term-lista-canais .tlk-term-card');
      const dot = card?.querySelector('.tlk-term-dot');
      return {
        recolhida: layout.classList.contains('sidebar-recolhida'),
        ariaExpanded: document.getElementById('btn-term-toggle-canais').getAttribute('aria-expanded'),
        larguraSidebar: Math.round(sidebar.getBoundingClientRect().width),
        larguraTerminal: Math.round(terminal.getBoundingClientRect().width),
        dotVisivel: dot ? getComputedStyle(dot).display !== 'none' : false,
        titleCard: card?.getAttribute('title') || '',
        ariaCard: card?.getAttribute('aria-label') || '',
      };
    });

    assert.equal(estadoInicial.recolhida, true, 'Com 1 canal, a lista deve começar recolhida');
    assert.equal(estadoInicial.ariaExpanded, 'false');
    assert.ok(estadoInicial.larguraSidebar >= 48 && estadoInicial.larguraSidebar <= 64, `Faixa recolhida deveria ter ~56 px (teve ${estadoInicial.larguraSidebar} px)`);
    assert.equal(estadoInicial.dotVisivel, true, 'Bolinha de estado deve estar visível na faixa recolhida');
    assert.match(estadoInicial.titleCard, /Suporte J2A.*Conectado/i);
    assert.match(estadoInicial.ariaCard, /Suporte J2A.*Conectado/i);

    // Clicar em "Canais" abre a lista, reduz a largura do log e salva '0' em localStorage
    await page.click('#btn-term-toggle-canais');
    await page.waitForTimeout(240);
    const estadoAberto = await page.evaluate(() => ({
      recolhida: document.getElementById('term-layout').classList.contains('sidebar-recolhida'),
      ariaExpanded: document.getElementById('btn-term-toggle-canais').getAttribute('aria-expanded'),
      larguraSidebar: Math.round(document.querySelector('.tlk-term-sidebar').getBoundingClientRect().width),
      larguraTerminal: Math.round(document.getElementById('terminal').getBoundingClientRect().width),
      salvo: localStorage.getItem('talk_term_canais_recolhida'),
    }));

    assert.equal(estadoAberto.recolhida, false);
    assert.equal(estadoAberto.ariaExpanded, 'true');
    assert.ok(estadoAberto.larguraSidebar >= 180, `Lista aberta deveria expandir (teve ${estadoAberto.larguraSidebar} px)`);
    assert.ok(estadoInicial.larguraTerminal > estadoAberto.larguraTerminal + 100, 'O log deve ocupar o espaço liberado quando recolhida');
    assert.equal(estadoAberto.salvo, '0');

    // Recarregar mantém a escolha salva ('0' = aberta)
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#painel-terminal:not([hidden])');
    assert.equal(await page.evaluate(() => document.getElementById('term-layout').classList.contains('sidebar-recolhida')), false);

    // Recolher novamente salva '1' e permanece recolhida em 1440, 1024 e 390 px sem rolagem horizontal
    await page.click('#btn-term-toggle-canais');
    await page.waitForTimeout(240);
    assert.equal(await page.evaluate(() => localStorage.getItem('talk_term_canais_recolhida')), '1');

    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `Rolagem horizontal com sidebar recolhida em ${w} px: ${med.sw} > ${med.iw}`);
    }

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
