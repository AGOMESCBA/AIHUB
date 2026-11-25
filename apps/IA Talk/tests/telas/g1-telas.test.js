'use strict';

// G1 (Antigravity) — testes funcionais em navegador real (Playwright) das 4 telas
// contra o servidor simulado: entrar, usuarios, aplicacoes e configuracoes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 60000, intervaloQrMs: 60000 });
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

test('G1 entrar.html: fluxo por apelido, telefone, código inválido, código 123456 e link inexistente', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    // 1) Link inexistente (404 amigável)
    await page.goto(`${baseUrl}/empresa-inexistente-xyz`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tlk-estado-titulo');
    assert.match(await page.textContent('.tlk-estado-titulo'), /não encontrado/i);

    // 2) Link válido (/app/ia-talk/j2a) + envio de código + validação
    await page.goto(`${baseUrl}/j2a`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#c-telefone');
    assert.equal(await page.textContent('#empresa-nome'), 'J2A Consultoria');

    await page.fill('#c-telefone', '65999990001');
    await page.click('#btn-enviar');
    await page.waitForSelector('#form-codigo:not([hidden])');

    // Mostra apenas destino mascarado (nunca o número completo) e contagem de reenvio
    const destino = await page.textContent('#destino-envio');
    assert.match(destino, /••••/);
    assert.equal(await page.isDisabled('#btn-reenviar'), true);
    assert.match(await page.textContent('#contagem-reenvio'), /\d+\s*s/);

    // Código incorreto aponta erro e tentativas restantes
    for (let i = 0; i < 6; i++) await page.fill(`#cod-${i}`, '9');
    await page.click('#btn-confirmar');
    await page.waitForSelector('#alerta-login:not([hidden])');
    assert.match(await page.textContent('#alerta-login'), /incorreto/i);

    // Código 123456 redireciona para o shell
    const digitos = '123456'.split('');
    for (let i = 0; i < 6; i++) await page.fill(`#cod-${i}`, digitos[i]);
    await Promise.all([
      page.waitForURL(/\/app\/ia-talk\/shell\.html/),
      page.click('#btn-confirmar'),
    ]);

    // 3) Simulação de envio pelo e-mail de reserva
    await page.goto(`${baseUrl}/j2a?simular=email`, { waitUntil: 'networkidle' });
    await page.fill('#c-telefone', '65999990001');
    await page.click('#btn-enviar');
    await page.waitForSelector('#form-codigo:not([hidden])');
    assert.match(await page.textContent('#canal-envio-pill'), /e-mail/i);

    assert.deepEqual(erros.filter((m) => !/404|400/.test(m)), []);
  } finally {
    await ctx.close();
  }
});

test('G1 usuarios.html: lista mascarada, filtro, detalhe com papéis e cadastro', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/usuarios.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tabulator-row');
    const textoTabela = await page.textContent('#tabela');
    assert.match(textoTabela, /Ana Ribeiro/);
    assert.match(textoTabela, /••••/);
    assert.equal(textoTabela.includes('5565999990001'), false, 'número completo nunca pode aparecer');

    // Abre detalhe do primeiro usuário e verifica catálogo de papéis
    await page.click('.tabulator-row');
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    await page.click('#aba-papeis');
    await page.waitForSelector('#painel-papeis:not([hidden])');
    assert.match(await page.textContent('#lista-papeis'), /admin_empresa/);

    // Volta e cadastra novo usuário
    await page.click('#btn-voltar');
    await page.click('#btn-novo');
    await page.fill('#c-nome', 'Teste Novo Usuário');
    await page.fill('#c-telefone', '5565988887777');
    await page.fill('#c-email', 'novo@exemplo.com.br');
    await page.click('#btn-salvar');
    await page.waitForSelector('#vista-lista:not([hidden])');
    assert.match(await page.textContent('#tabela'), /Teste Novo Usuário/);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G1 aplicacoes.html: lista, geração única de token, confirmação inline de revogação e webhook', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/aplicacoes.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tabulator-row');
    assert.match(await page.textContent('#tabela'), /IA Command/);

    // Abre IA Command e testa aba Tokens
    await page.click('.tabulator-row');
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    await page.click('#aba-tokens');
    await page.waitForSelector('#painel-tokens:not([hidden])');

    // Gera novo token e confirma exibição única + ocultação
    await page.click('#btn-gerar-token');
    await page.waitForSelector('#quadro-token-novo:not([hidden])');
    assert.match(await page.textContent('#valor-token-novo'), /^tk_teste_/);
    await page.click('#btn-ocultar-token');
    assert.equal(await page.isHidden('#quadro-token-novo'), true);

    // Revogação com confirmação inline (sem window.confirm)
    const btnRevogar = page.locator('[data-pedir-revogar]').first();
    await btnRevogar.click();
    const btnConfirmar = page.locator('[data-confirmar-revogar]').first();
    await btnConfirmar.waitFor({ state: 'visible' });
    await btnConfirmar.click();
    await page.waitForTimeout(200);

    // Aba Webhook: gera segredo com confirmação inline se já configurado
    await page.click('#aba-webhook');
    await page.waitForSelector('#painel-webhook:not([hidden])');
    await page.click('#btn-pedir-segredo');
    if (await page.isVisible('#confirm-segredo')) {
      await page.click('#btn-confirmar-segredo');
    }
    await page.waitForSelector('#quadro-segredo-novo:not([hidden])');
    assert.match(await page.textContent('#valor-segredo-novo'), /^whsec_teste_/);
    await page.click('#btn-ocultar-segredo');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G1 configuracoes.html: link de entrada, sites autorizados com versão e e-mail com teste em etapas', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/configuracoes.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#cartao-config:not([hidden])');

    // Aba 1: Link de entrada
    const link = await page.inputValue('#c-link-entrada');
    assert.match(link, /\/app\/ia-talk\/j2a$/);

    // Aba 2: Sites autorizados
    await page.click('#aba-sites');
    await page.waitForSelector('#painel-sites:not([hidden])');
    assert.match(await page.textContent('#lista-sites'), /softexpert\.exemplo\.com\.br/);
    await page.fill('#c-novo-site', 'https://intranet.exemplo.com.br');
    await page.click('#btn-add-site');
    await page.click('#btn-salvar-sites');
    await page.waitForFunction(() => document.getElementById('sites-versao-chip')?.textContent?.includes('Versão 4'));

    // Aba 3: E-mail de envio + teste em 4 etapas
    await page.click('#aba-email');
    await page.waitForSelector('#painel-email:not([hidden])');
    await page.click('#btn-testar-email');
    await page.waitForSelector('#lista-etapas-teste .tlk-etapa-item--ok');
    const qtdEtapas = await page.locator('#lista-etapas-teste .tlk-etapa-item--ok').count();
    assert.equal(qtdEtapas, 4);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
