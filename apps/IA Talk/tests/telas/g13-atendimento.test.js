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
    await page.waitForSelector('#btn-reabrir:not([hidden])');
    assert.match(await page.textContent('#painel-contato'), /Atendimento concluído no teste G13/);

    await page.click('#btn-reabrir');
    await page.waitForSelector('#btn-encerrar:not([hidden])');

    // Ignora apenas o erro 409 de console intencionalmente simulado no passo 1
    assert.equal(erros.filter((e) => !/409|status of/.test(e)).length, 0, `erros inesperados: ${erros.join('; ')}`);
  } finally {
    await ctx.close();
  }
});
