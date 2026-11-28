'use strict';

// G13 (Antigravity) — testes em Playwright para frontend/atendimento.html (Central real, §8)
// contra o servidor simulado (backend/simulado/atendimento.js):
//   - Visões Minhas, Fila, Abertas e Encerradas + contadores por setor;
//   - ?simular=atendente mostra a visão da Carla Souza (somente setor Suporte);
//   - envio.pode_responder e envio.motivo desabilitam o campo e explicam o motivo;
//   - Assumir (incl. tratamento de 409 mostrando quem já assumiu), devolver, transferir, encerrar e reabrir;
//   - Notas internas, etiquetas e respostas rápidas com "/" trocando {nome_contato} e {nome_atendente};
//   - Socket.IO (atendimento:assinar, conversa:assinar, conversa:*) + POST /api/admin/simulado/receber;
//   - Layout híbrido sem rolagem horizontal em 1440, 1280, 1024, 390 e 360 px;
//   - Menu talk-sidebar.js com talk-atendimento (etapa: null, liberado com a C9 real em 27/11).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
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

test('G13 talk-sidebar.js: talk-atendimento cadastrado liberado no menu (etapa null, C9 real)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/js/talk-sidebar.js'), 'utf8');
  assert.match(src, /id:\s*'talk-atendimento'[^\n]*atendimento\.html[^\n]*etapa:\s*null/);
});

test('G13 atendimento.html: visões, contadores por setor, ?simular=atendente (Carla), envio.motivo e layout híbrido', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    // 1. Visão padrão (admin Ana Ribeiro): vê os 3 setores e todas as visões
    await page.goto(`${baseUrl}/atendimento.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-conversas .atd-conv-item');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    const txtSetores = await page.textContent('#lista-setores');
    assert.match(txtSetores, /Suporte/);
    assert.match(txtSetores, /Financeiro/);
    assert.match(txtSetores, /Comercial/);
    assert.equal((await page.textContent('#cnt-abertas')).trim(), '6');
    assert.equal((await page.textContent('#cnt-fila')).trim(), '3');
    assert.equal((await page.textContent('#cnt-minhas')).trim(), '1');

    // Nunca expõe telefone completo
    const html = await page.content();
    assert.equal(html.includes('5565999990010'), false);
    assert.equal(html.includes('5565999990011'), false);

    // Visão Fila: mostra 3 conversas; abre Fernanda (cv_ex03, fora da lista de teste) -> envio bloqueado com motivo
    await page.click('#lista-visoes [data-visao="fila"]');
    await page.waitForFunction(() => document.querySelectorAll('#lista-conversas .atd-conv-item').length === 3);
    await page.click('[data-conversa-id="cv_ex03"]');
    await page.waitForSelector('#banner-envio:not([hidden])');
    assert.match(await page.textContent('#banner-envio'), /números de teste/i);
    assert.equal(await page.isDisabled('#campo-msg'), true);
    assert.equal(await page.isDisabled('#btn-enviar'), true);

    // Visão Encerradas: mostra 3 conversas encerradas e motivo de bloqueio + botão Reabrir
    await page.click('#lista-visoes [data-visao="encerradas"]');
    await page.waitForFunction(() => document.querySelectorAll('#lista-conversas .atd-conv-item').length === 3);
    await page.click('[data-conversa-id="cv_ex07"]');
    await page.waitForSelector('#btn-reabrir:not([hidden])');
    assert.match(await page.textContent('#banner-envio'), /encerrada/i);
    assert.equal(await page.isDisabled('#campo-msg'), true);

    // Layout híbrido: 1440, 1280, 1024 (gaveta abre/fecha), 390 e 360 px sem rolagem horizontal
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.click('#btn-gaveta');
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('gaveta-aberta')), true);
    await page.click('#btn-fechar-lateral');
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('gaveta-aberta')), false);

    for (const w of [1440, 1280, 1024, 390, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal em ${w}px: ${med.sw} > ${med.iw}`);
    }

    // 2. ?simular=atendente -> visão da Carla Souza (somente setor Suporte)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/atendimento.html?simular=atendente`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-conversas .atd-conv-item');
    assert.match(await page.textContent('#usuario-ativo'), /Carla Souza/);
    const setoresCarla = await page.textContent('#lista-setores');
    assert.match(setoresCarla, /Suporte/);
    assert.equal(setoresCarla.includes('Financeiro'), false, 'Carla (Suporte) não deve ver setor Financeiro');
    assert.equal(setoresCarla.includes('Comercial'), false, 'Carla (Suporte) não deve ver setor Comercial');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G13 atendimento.html: assumir (+ 409 conflito), "/" com variáveis, nota, etiquetas, devolver, transferir, encerrar, reabrir e /simulado/receber ao vivo', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    // Entra como Carla (?simular=atendente) na conversa cv_ex02 (João Pereira, na fila do Suporte, número na lista de teste)
    await page.goto(`${baseUrl}/atendimento.html?simular=atendente&conversa=cv_ex02`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));
    assert.match(await page.textContent('#chat-nome'), /João Pereira/);

    // 1. Testa tratamento de 409 no Assumir (intercepta uma vez simulando Bruno Lima assumindo antes)
    let simulou409 = false;
    await page.route('**/api/admin/conversas/cv_ex02/assumir*', async (route) => {
      if (!simulou409) {
        simulou409 = true;
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ erro: { codigo: 'conflito', mensagem: 'Bruno Lima já assumiu esta conversa.' } }),
        });
      }
      return route.continue();
    });

    await page.click('#btn-assumir');
    await page.waitForSelector('#alerta-conversa:not([hidden])');
    assert.match(await page.textContent('#alerta-conversa-texto'), /Bruno Lima já assumiu esta conversa/);

    // 2. Agora assume de verdade
    await page.click('#btn-assumir');
    await page.waitForFunction(() => document.getElementById('chat-sub')?.textContent?.includes('Com Carla Souza'));
    assert.equal(await page.isHidden('#btn-assumir'), true);
    assert.equal(await page.isVisible('#btn-devolver'), true);

    // 3. Resposta rápida com "/" trocando {nome_contato} e {nome_atendente} antes de enviar
    await page.fill('#campo-msg', '/saud');
    await page.waitForSelector('#slash-menu:not([hidden])');
    await page.locator('#slash-menu [data-slash-idx]').first().click();
    const textoExpandido = await page.inputValue('#campo-msg');
    assert.match(textoExpandido, /João Pereira/);
    assert.match(textoExpandido, /Carla Souza/);
    assert.equal(textoExpandido.includes('{nome_contato}'), false);
    assert.equal(textoExpandido.includes('{nome_atendente}'), false);

    // Envia a resposta e confirma progressão ao vivo até Lida via socket conversa:item_estado
    await page.click('#btn-enviar');
    await page.waitForFunction(() => document.getElementById('lista-mensagens')?.textContent?.includes('Aqui é Carla Souza'));
    await page.waitForFunction(() => {
      const badges = [...document.querySelectorAll('#lista-mensagens [data-item-estado]')];
      return badges.some((b) => b.textContent.trim() === 'Lida');
    }, { timeout: 10000 });

    // 4. Nota interna (visual diferente .atd-msg--nota)
    await page.click('#btn-modo-nota');
    await page.fill('#campo-msg', 'Nota interna G13: validado acesso do cliente.');
    await page.click('#btn-enviar');
    await page.waitForFunction(() => document.querySelector('#lista-mensagens .atd-msg--nota')?.textContent?.includes('Nota interna G13'));

    // 5. Etiquetas (adicionar e remover)
    await page.fill('#inp-etiqueta', 'Urgente');
    await page.click('#btn-add-etiqueta');
    await page.waitForFunction(() => document.getElementById('lista-etiquetas')?.textContent?.includes('Urgente'));
    await page.locator('#lista-etiquetas .atd-etiqueta-rm').first().click();
    await page.waitForFunction(() => !document.getElementById('lista-etiquetas')?.textContent?.includes('Urgente'));

    // 6. POST /api/admin/simulado/receber faz nova mensagem do João chegar ao vivo via Socket.IO
    const rRec = await page.evaluate(async () => {
      const r = await fetch('/app/ia-talk/api/admin/simulado/receber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contato_id: 'ct_ex2', texto: 'Chegou ao vivo pelo simulado G13!' }),
      });
      return r.status;
    });
    assert.equal(rRec, 201);
    await page.waitForFunction(() => document.getElementById('lista-mensagens')?.textContent?.includes('Chegou ao vivo pelo simulado G13!'));

    // 7. Devolver à fila -> reassumir -> transferir -> encerrar -> reabrir
    await page.click('#btn-devolver');
    await page.waitForFunction(() => document.getElementById('chat-sub')?.textContent?.includes('Na fila'));

    await page.click('#btn-assumir');
    await page.waitForFunction(() => document.getElementById('chat-sub')?.textContent?.includes('Com Carla Souza'));

    // Transferir para o setor Suporte / Bruno Lima com nota
    await page.click('#btn-transferir');
    await page.waitForSelector('#popover-transferir:not([hidden])');
    await page.selectOption('#tr-setor', 'set_suporte');
    await page.selectOption('#tr-responsavel', 'usr_bruno');
    await page.fill('#tr-nota', 'Encaminhando ao Bruno para validar servidor.');
    await page.click('#btn-confirmar-transferir');
    await page.waitForFunction(() => document.getElementById('chat-sub')?.textContent?.includes('Com Bruno Lima'));

    // Como admin (sem ?simular=atendente), encerra e reabre cv_ex02
    await page.goto(`${baseUrl}/atendimento.html?conversa=cv_ex02`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#btn-encerrar:not([hidden])');
    await page.click('#btn-encerrar');
    await page.waitForSelector('#popover-encerrar:not([hidden])');
    await page.fill('#enc-motivo', 'Atendimento concluído no teste G13');
    await page.click('#btn-confirmar-encerrar');
    await page.waitForSelector('#estado-chat-vazio:not([hidden])');
    assert.match(await page.textContent('#estado-chat-vazio'), /Conversa encerrada/);
    assert.equal(await page.isVisible('#chat-ativo'), false);
    await page.getByRole('button', { name: 'Ver encerradas' }).click();
    await page.waitForSelector('[data-conversa-id="cv_ex02"]');
    await page.click('[data-conversa-id="cv_ex02"]');
    await page.waitForSelector('#btn-reabrir:not([hidden])');
    // O painel do contato é preenchido depois do cabeçalho (histórico e respostas rápidas em paralelo).
    await page.waitForFunction(() => document.getElementById('painel-contato')?.textContent?.includes('Atendimento concluído no teste G13'));

    await page.click('#btn-reabrir');
    await page.waitForSelector('#btn-encerrar:not([hidden])');

    // Ignora apenas o erro 409 de console intencionalmente simulado no passo 1
    assert.equal(erros.filter((e) => !/409|status of/.test(e)).length, 0, `erros inesperados: ${erros.join('; ')}`);
  } finally {
    await ctx.close();
  }
});

test('G13 atendimento.html: encerrar com pesquisa de satisfação ligada não reabre o chat por aviso atrasado', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/atendimento.html?conversa=cv_ex02`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#btn-encerrar:not([hidden])');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    // Liga a pesquisa de satisfação no setor Suporte (envia item extra ao encerrar)
    const statusPesq = await page.evaluate(async () => {
      const s = await fetch('/app/ia-talk/api/admin/setores/set_suporte').then((r) => r.json());
      const r = await fetch('/app/ia-talk/api/admin/setores/set_suporte', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versao: s.versao, pesquisa: { ligada: true } }),
      });
      return r.status;
    });
    assert.equal(statusPesq, 200);

    await page.click('#btn-encerrar');
    await page.waitForSelector('#popover-encerrar:not([hidden])');
    await page.fill('#enc-motivo', 'Encerrada com pesquisa ligada');
    await page.click('#btn-confirmar-encerrar');

    await page.waitForSelector('#estado-chat-vazio:not([hidden])');
    assert.match(await page.textContent('#estado-chat-vazio'), /Conversa encerrada/);
    assert.equal(await page.isVisible('#chat-ativo'), false);

    // Aguarda eventual aviso atrasado de socket (conversa:atualizada / conversa:item) e garante que o chat não volta
    await page.waitForTimeout(500);
    assert.match(await page.textContent('#estado-chat-vazio'), /Conversa encerrada/);
    assert.equal(await page.isVisible('#chat-ativo'), false);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});


test('G13: rascunhos isolados, envio único e ação atrasada', async () => {
  const localSim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
  const endereco = await localSim.iniciar(0, '127.0.0.1');
  const baseLocal = 'http://127.0.0.1:' + endereco.port + '/app/ia-talk';
  const { ctx, page } = await novaPagina();
  try {
    await page.goto(baseLocal + '/atendimento.html?conversa=cv_ex02', { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');
    await page.fill('#campo-msg', 'Mensagem para João');
    await page.click('[data-conversa-id="cv_ex01"]');
    await page.waitForFunction(() => document.querySelector('#chat-nome').textContent.includes('Mariana'));
    assert.equal(await page.inputValue('#campo-msg'), '');
    await page.click('[data-conversa-id="cv_ex02"]');
    await page.waitForFunction(() => document.querySelector('#chat-nome').textContent.includes('João'));
    assert.equal(await page.inputValue('#campo-msg'), 'Mensagem para João');
    await page.click('#btn-modo-nota');
    assert.equal(await page.inputValue('#campo-msg'), '');
    await page.fill('#campo-msg', 'Nota privada');
    await page.click('#btn-modo-cliente');
    assert.equal(await page.inputValue('#campo-msg'), 'Mensagem para João');
    let envios = 0;
    await page.route('**/api/admin/conversas/cv_ex02/responder*', async route => {
      envios++; await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.press('#campo-msg', 'Enter');
    await page.press('#campo-msg', 'Enter');
    await page.waitForTimeout(150);
    assert.equal(envios, 1);
    await page.waitForSelector('#alerta-compositor:not([hidden])');
    let liberar; const pausa = new Promise(resolve => { liberar = resolve; });
    let iniciada; const inicio = new Promise(resolve => { iniciada = resolve; });
    await page.route('**/api/admin/conversas/cv_ex02/assumir*', async route => {
      const response = await route.fetch(); iniciada(); await pausa; await route.fulfill({ response });
    });
    await page.click('#btn-assumir');
    await inicio;
    await page.click('[data-conversa-id="cv_ex01"]');
    await page.waitForFunction(() => document.querySelector('#chat-nome').textContent.includes('Mariana'));
    liberar();
    await page.waitForTimeout(500);
    assert.match(await page.textContent('#chat-nome'), /Mariana/);
  } finally { await ctx.close(); await localSim.fechar(); }
});


test('G13: resposta antiga da lista não substitui o filtro atual', async () => {
  const localSim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
  const endereco = await localSim.iniciar(0, '127.0.0.1');
  const baseLocal = 'http://127.0.0.1:' + endereco.port + '/app/ia-talk';
  const { ctx, page } = await novaPagina();
  try {
    await page.goto(baseLocal + '/atendimento.html', { waitUntil: 'networkidle' });
    let liberar, iniciada;
    const pausa = new Promise(resolve => { liberar = resolve; });
    const inicio = new Promise(resolve => { iniciada = resolve; });
    await page.route('**/api/admin/conversas?*', async route => {
      if (new URL(route.request().url()).searchParams.get('visao') === 'fila') {
        const response = await route.fetch(); iniciada(); await pausa; await route.fulfill({ response });
      } else await route.continue();
    });
    await page.click('[data-visao="fila"]'); await inicio;
    await page.click('[data-visao="abertas"]');
    await page.waitForFunction(() => document.querySelectorAll('#lista-conversas .atd-conv-item').length === 6);
    liberar(); await page.waitForTimeout(300);
    assert.equal(await page.locator('#lista-conversas .atd-conv-item').count(), 6);
  } finally { await ctx.close(); await localSim.fechar(); }
});

test('G13: cartões numéricos retráteis no topo, setinha mágica do contato e lista compacta com persistência', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/atendimento.html?conversa=cv_ex04`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');

    // Estado inicial: cartões visíveis, resumo inline oculto, contato expandido e lista completa
    assert.equal(await page.isVisible('#atd-cards-corpo'), true);
    assert.equal(await page.isHidden('#btn-resumo-inline'), true);
    const dimInicial = await page.evaluate(() => {
      const chat = document.querySelector('.atd-col--chat').getBoundingClientRect();
      return { w: chat.width, h: chat.height };
    });

    // 1. Recolher cartões numéricos do topo -> ganha altura e mostra resumo inline clicável
    const qtdAbertas = (await page.textContent('#cnt-abertas')).trim();
    await page.click('#btn-toggle-resumo');
    await page.waitForSelector('#btn-resumo-inline:not([hidden])');
    assert.equal(await page.isHidden('#atd-cards-corpo'), true);
    assert.match(await page.textContent('#btn-resumo-inline'), new RegExp(`Abertas ${qtdAbertas} · Fila \\d+ · Minhas \\d+`));
    const hAposTopo = await page.evaluate(() => document.querySelector('.atd-col--chat').getBoundingClientRect().height);
    assert.ok(hAposTopo > dimInicial.h + 25, `esperava ganhar altura ao recolher cartões: ${hAposTopo} <= ${dimInicial.h}`);

    // 2. Recolher painel do contato pela setinha mágica -> ganha largura para o chat
    await page.click('#btn-seta-lateral');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('lateral-recolhida')), true);
    const wAposLateral = await page.evaluate(() => document.querySelector('.atd-col--chat').getBoundingClientRect().width);
    assert.ok(wAposLateral > dimInicial.w + 250, `esperava ganhar largura ao recolher contato: ${wAposLateral} <= ${dimInicial.w}`);

    // 3. Compactar lista de conversas para trilho de avatares -> ganha mais largura ainda
    await page.click('#btn-seta-lista');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('lista-compacta')), true);
    const wAposLista = await page.evaluate(() => document.querySelector('.atd-col--chat').getBoundingClientRect().width);
    assert.ok(wAposLista > wAposLateral + 180, `esperava ganhar largura ao compactar lista: ${wAposLista} <= ${wAposLateral}`);

    // 4. Recarregar preserva todas as escolhas via localStorage
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');
    assert.equal(await page.isHidden('#atd-cards-corpo'), true);
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('lateral-recolhida')), true);
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('lista-compacta')), true);

    // 5. Sem rolagem horizontal em nenhuma largura com os painéis recolhidos
    for (const w of [1440, 1280, 1024, 390, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal (recolhido) em ${w}px: ${med.sw} > ${med.iw}`);
    }

    // 6. Expandir de volta: clicar resumo inline, setinha mágica e lista
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('#btn-resumo-inline');
    assert.equal(await page.isVisible('#atd-cards-corpo'), true);
    await page.click('#btn-seta-lateral');
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('lateral-recolhida')), false);
    await page.click('#btn-seta-lista');
    assert.equal(await page.locator('#workspace').evaluate((el) => el.classList.contains('lista-compacta')), false);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});


test('G13: reconexão atualiza lista, contadores e conversa aberta', async () => {
  const localSim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
  const endereco = await localSim.iniciar(0, '127.0.0.1');
  const baseLocal = 'http://127.0.0.1:' + endereco.port + '/app/ia-talk';
  const { ctx, page } = await novaPagina();
  try {
    await page.goto(baseLocal + '/atendimento.html?conversa=cv_ex02', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#rt-texto').textContent.includes('Tempo real ativo'));
    await ctx.setOffline(true);
    await page.waitForFunction(() => document.querySelector('#rt-texto').textContent.includes('Sem socket'));
    const chamadas = [];
    page.on('request', req => { if (req.url().includes('/api/admin/conversas')) chamadas.push(new URL(req.url()).pathname); });
    await ctx.setOffline(false);
    await page.waitForFunction(() => document.querySelector('#rt-texto').textContent.includes('Tempo real ativo'), null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('#chat-ativo') && !document.querySelector('#chat-ativo').hidden);
    await page.waitForTimeout(500);
    assert.ok(chamadas.some(x => x.endsWith('/conversas')));
    assert.ok(chamadas.some(x => x.endsWith('/conversas/contadores')));
    assert.ok(chamadas.some(x => x.endsWith('/conversas/cv_ex02')));
  } finally { await ctx.setOffline(false); await ctx.close(); await localSim.fechar(); }
});


test('G13: respostas rápidas atrasadas não trocam o setor atual', async () => {
  const localSim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
  const endereco = await localSim.iniciar(0, '127.0.0.1');
  const baseLocal = 'http://127.0.0.1:' + endereco.port + '/app/ia-talk';
  const { ctx, page } = await novaPagina();
  try {
    await page.goto(baseLocal + '/atendimento.html', { waitUntil: 'networkidle' });
    let liberar, iniciada;
    const pausa = new Promise(resolve => { liberar = resolve; });
    const inicio = new Promise(resolve => { iniciada = resolve; });
    await page.route('**/api/admin/respostas-rapidas?*', async route => {
      if (new URL(route.request().url()).searchParams.get('setor_id') === 'set_suporte') {
        const response = await route.fetch(); iniciada(); await pausa; await route.fulfill({ response });
      } else await route.continue();
    });
    await page.click('[data-conversa-id="cv_ex02"]'); await inicio;
    await page.click('[data-conversa-id="cv_ex03"]');
    await page.waitForFunction(() => document.querySelector('#chat-nome').textContent.includes('Fernanda'));
    await page.waitForTimeout(300); liberar(); await page.waitForTimeout(300);
    await page.evaluate(() => { const el = document.querySelector('#campo-msg'); el.value = '/'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.match(await page.textContent('#slash-menu'), /boleto/i);
    assert.doesNotMatch(await page.textContent('#slash-menu'), /acesso/i);
  } finally { await ctx.close(); await localSim.fechar(); }
});
