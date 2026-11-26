'use strict';

// G2 (Antigravity) — testes funcionais em Playwright para frontend/canais.html
// (contra o servidor simulado) + regressão do contador de tokens em aplicacoes.html.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 350, intervaloQrMs: 15000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await sim?.fechar();
});

async function novaPagina() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  return { ctx, page, erros };
}

test('G2 canais.html: lista mascarada, Meta indisponível no cadastro, QR + contagem, limpar sessão inline e 4 abas', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/canais.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tabulator-row');
    const txtLista = await page.textContent('#tabela');
    assert.match(txtLista, /Suporte J2A/);
    assert.match(txtLista, /Teste homologação/);
    assert.match(txtLista, /••••/);
    assert.equal(txtLista.includes('5565999900001'), false, 'número completo nunca pode aparecer');

    // Novo canal: Meta aparece como opção indisponível e não permite selecionar
    await page.click('#btn-novo');
    await page.waitForSelector('#vista-novo:not([hidden])');
    assert.equal(await page.isDisabled('input[name="provedor_opcao"][value="meta"]'), true);
    await page.fill('#n-nome', 'Comercial Sul');
    // Número do WhatsApp obrigatório (como no IA Command); a recusa sem número fica no teste do backend.
    assert.equal(await page.getAttribute('#n-numero', 'required'), '');
    await page.fill('#n-numero', '5565988887777');
    await page.click('#btn-criar-canal');
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    assert.equal(await page.textContent('#titulo-detalhe'), 'Comercial Sul');
    assert.match(await page.textContent('#detalhe-pill-estado'), /Parado/);
    assert.match(await page.textContent('#meta-canal'), /\+55 65 9••••-7777/);
    assert.equal((await page.content()).includes('5565988887777'), false, 'número completo nunca na tela depois de salvo');
    // Trocar o número pela aba Conexão
    await page.click('#meta-canal [data-acao="alterar-numero"]');
    await page.fill('#c-numero', '5565988886666');
    await page.click('#btn-salvar-numero');
    await page.waitForFunction(() => document.getElementById('meta-canal')?.textContent?.includes('-6666'));
    assert.equal(await page.isHidden('#form-numero'), true);

    // Conectar gera QR com contagem até expira_em
    await page.click('#btn-conectar');
    await page.waitForSelector('#box-qr:not([hidden])');
    const srcQr = await page.getAttribute('#qr-img', 'src');
    assert.match(srcQr || '', /^data:image\/png;base64,/);
    assert.match(await page.textContent('#qr-contagem'), /Expira em \d+ s/);

    // Limpar sessão exige confirmação inline explicando que o celular lerá novo QR
    await page.click('#btn-pedir-limpar');
    await page.waitForSelector('#confirm-limpar:not([hidden])');
    assert.match(await page.textContent('#confirm-limpar'), /novo QR Code/i);
    await page.click('#btn-confirmar-limpar');
    await page.waitForFunction(() => document.getElementById('detalhe-pill-estado')?.textContent?.includes('Parado'));

    // Volta à lista e abre o canal Suporte J2A (conectado, com log ao vivo e empresas)
    await page.click('#btn-voltar');
    await page.waitForSelector('#vista-lista:not([hidden])');
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    // Aba Terminal ao vivo: recebe novas linhas via Socket.IO e pausa ao subir rolagem
    await page.click('#aba-terminal');
    await page.waitForSelector('#painel-terminal:not([hidden])');
    const linhasAntes = await page.locator('#terminal .tlk-log-linha').count();
    await page.waitForFunction((antes) => document.querySelectorAll('#terminal .tlk-log-linha').length > antes, linhasAntes);

    // Simula subir a rolagem (quando há overflow) ou pausa manual pelo botão
    await page.click('#btn-autoscroll');
    await page.waitForSelector('#aviso-pausa:not([hidden])');
    await page.click('#btn-retomar-rolagem');
    assert.equal(await page.isHidden('#aviso-pausa'), true);

    // Layout 3 colunas no Terminal: lista esquerda, log no centro e painel de estado/ações à direita
    assert.ok(await page.locator('#term-lista-canais .tlk-term-card').count() >= 3);
    assert.match(await page.textContent('#term-status-box'), /Conectado/);
    assert.match(await page.textContent('#term-ctrl-num'), /••••/);
    assert.match(await page.textContent('#term-info-empresas'), /3 \(/);
    assert.match(await page.textContent('#term-info-processo'), /WhatsApp Web/);
    assert.notEqual((await page.textContent('#term-info-uptime')).trim(), '—');

    // Copiar e Limpar do log no painel direito
    await page.click('#btn-copiar-term');
    await page.click('#btn-limpar-term');
    assert.match(await page.textContent('#term-contagem'), /^0 linha/);
    await page.click('#btn-recarregar-log');
    await page.waitForFunction(() => document.querySelectorAll('#terminal .tlk-log-linha').length >= 1);

    // Troca de canal pela lista esquerda mantendo na aba Terminal (ex.: cn_teste com QR no painel direito)
    await page.click('button[data-term-canal="cn_teste"]');
    await page.waitForFunction(() => document.getElementById('term-ctrl-nome')?.textContent === 'Teste homologação');
    assert.equal(await page.isVisible('#painel-terminal'), true);
    await page.waitForSelector('#term-qr-mini:not([hidden])');

    // Verifica ausência de rolagem horizontal em 1440, 1024 e 390 px na aba Terminal
    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal no Terminal em ${w}px: ${med.sw} > ${med.iw}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('button[data-term-canal="cn_suporte"]');
    await page.waitForFunction(() => document.getElementById('term-ctrl-nome')?.textContent === 'Suporte J2A');

    // Aba Empresas que usam o número: mostra marca "Canal padrão" e salva alterações
    await page.click('#aba-empresas');
    await page.waitForSelector('#painel-empresas:not([hidden])');
    assert.match(await page.textContent('#lista-vinculos'), /Canal padrão/);
    await page.fill('#e-nome', 'Suporte J2A Principal');
    await page.click('#btn-salvar-empresas');
    await page.waitForFunction(() => document.getElementById('titulo-detalhe')?.textContent === 'Suporte J2A Principal');

    // Aba Capacidades (somente leitura)
    await page.click('#aba-capacidades');
    await page.waitForSelector('#painel-capacidades:not([hidden])');
    const txtCap = await page.textContent('#painel-capacidades');
    assert.match(txtCap, /Vídeo/);
    assert.match(txtCap, /Não suportado/);
    assert.match(txtCap, /16 MB/);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G1 regressão aplicacoes.html: cabeçalho atualiza contagem de tokens ativos ao gerar e revogar', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/aplicacoes.html?id=app_jobs`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    assert.match(await page.textContent('#sub-detalhe'), /0 token\(s\) ativo\(s\)/);

    await page.click('#aba-tokens');
    await page.click('#btn-gerar-token');
    await page.waitForSelector('#quadro-token-novo:not([hidden])');
    assert.match(await page.textContent('#sub-detalhe'), /1 token\(s\) ativo\(s\)/);

    await page.locator('[data-pedir-revogar]').first().click();
    await page.locator('[data-confirmar-revogar]').first().click();
    await page.waitForFunction(() => document.getElementById('sub-detalhe')?.textContent?.includes('0 token(s) ativo(s)'));

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
