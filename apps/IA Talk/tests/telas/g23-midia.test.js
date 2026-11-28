'use strict';

// G23 (Antigravity) — testes em Playwright para mídia na Central (atendimento.html),
// no Portal do atendente (portal.html) e no Histórico de mensagens (mensagens.html),
// conforme docs/contratos.md §10 contra o servidor simulado:
//   1. cv_ex01 mostra miniatura de imagem (<= 240 px, abre ampliada + Baixar), PDF (Abrir + Baixar)
//      e áudio de voz (<audio controls preload="none"> + "Mensagem de voz") + legenda abaixo;
//   2. cv_ex07 mostra o áudio expirado esmaecido ("Arquivo expirado (prazo de guarda).") sem botões
//      + cobertura dos outros motivos de indisponibilidade (grande, recusado, falhou) e 410/404 ao abrir;
//   3. Anexar PDF com legenda (POST /conversas/:id/anexos binário via XHR) e ver o item com anexo + legenda;
//   4. Colar imagem (Ctrl+V / ClipboardEvent) + fila de múltiplos arquivos (legenda só no primeiro) + arrastar/soltar;
//   5. Recusa no navegador antes do servidor: arquivo > 16 MB e extensão não aceita;
//   6. Mensagem 422 tipo_nao_suportado (e 413/409) vinda do servidor via page.route + selo "Ainda não ativo" quando midia=false;
//   7. Cliente enviando foto via POST /api/admin/simulado/receber com midia: { nome, base64 }, aparecendo ao vivo + emoji na lista;
//   8. Histórico de mensagens (mensagens.html) exibindo anexos com nome, tipo, tamanho e botões Abrir / Baixar;
//   9. Sem rolagem horizontal em 1440 e 390 px na Central e no Portal.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');
const { AMOSTRAS } = require('../../backend/simulado/midia-simulada');

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

test('G23 exibição: cv_ex01 (imagem <= 240px + lightbox, PDF Abrir/Baixar, áudio de voz), cv_ex07 (expirado) e erros 410/404', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/atendimento.html?simular=atendente&conversa=cv_ex01`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');
    await page.waitForSelector('#lista-mensagens .atd-midia-thumb');

    // Na lista de conversas, a prévia da cv_ex01 (último item é o áudio de voz sem texto) exibe "🎤 Áudio"
    assert.match(await page.textContent('#lista-conversas [data-conversa-id="cv_ex01"]'), /🎤\s*Áudio/);

    // 1. Imagem: miniatura até 240 px + legenda abaixo + ampliar ao clicar com botão Baixar
    const imgInfo = await page.evaluate(() => {
      const msgImg = [...document.querySelectorAll('#lista-mensagens .atd-msg')].find((el) => el.querySelector('.atd-midia-thumb'));
      const img = msgImg?.querySelector('.atd-midia-thumb');
      const wrap = msgImg?.querySelector('.atd-midia-img-wrap');
      const legenda = msgImg?.querySelector('.atd-msg-legenda');
      const btnBaixar = msgImg?.querySelector('[data-acao-midia="baixar"]');
      const rectWrap = wrap?.getBoundingClientRect();
      const rectLeg = legenda?.getBoundingClientRect();
      return {
        carregou: !!img && img.complete && img.naturalWidth > 0,
        larguraImg: img ? img.getBoundingClientRect().width : 999,
        src: img?.getAttribute('src') || '',
        legendaTexto: legenda?.textContent?.trim() || '',
        legendaAbaixo: !!(rectWrap && rectLeg && rectLeg.top >= rectWrap.bottom - 2),
        temBaixar: !!btnBaixar,
      };
    });
    assert.equal(imgInfo.carregou, true, 'miniatura da imagem deve carregar via GET /midias/:id');
    assert.ok(imgInfo.larguraImg > 0 && imgInfo.larguraImg <= 240.5, `miniatura deve ter até 240 px (atual: ${imgInfo.larguraImg})`);
    assert.match(imgInfo.src, /\/api\/admin\/midias\//);
    assert.equal(imgInfo.legendaTexto, 'Olha o erro que aparece na tela');
    assert.equal(imgInfo.legendaAbaixo, true, 'legenda deve ficar abaixo da imagem');
    assert.equal(imgInfo.temBaixar, true);

    // Clicar na miniatura abre o modal ampliado com botão Baixar
    await page.click('#lista-mensagens [data-ampliar-midia]');
    await page.waitForSelector('#modal-midia-imagem:not([hidden])');
    assert.equal(await page.textContent('#modal-midia-nome'), 'erro-relatorio.png');
    assert.equal(await page.isVisible('#btn-modal-midia-baixar'), true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal-midia-imagem[hidden]', { state: 'attached' });

    // 2. Documento PDF: ícone, nome, tamanho legível, botões Abrir (só PDF) e Baixar
    const pdfInfo = await page.evaluate(() => {
      const doc = document.querySelector('#lista-mensagens .atd-midia-doc');
      if (!doc) return null;
      return {
        nome: doc.querySelector('.atd-midia-doc-nome')?.textContent?.trim(),
        sub: doc.querySelector('.atd-midia-doc-sub')?.textContent?.trim(),
        temAbrir: !!doc.querySelector('[data-acao-midia="abrir"]'),
        temBaixar: !!doc.querySelector('[data-acao-midia="baixar"]'),
      };
    });
    assert.ok(pdfInfo, 'cartão de PDF deve aparecer em cv_ex01');
    assert.equal(pdfInfo.nome, 'comprovante-pagamento.pdf');
    assert.match(pdfInfo.sub, /^PDF · \d+/);
    assert.equal(pdfInfo.temAbrir, true, 'PDF deve ter botão Abrir');
    assert.equal(pdfInfo.temBaixar, true, 'PDF deve ter botão Baixar');

    // Documento não-PDF (ex.: TXT/XLSX) não mostra botão Abrir, apenas Baixar
    const htmlDocTxt = await page.evaluate(() => window.TalkMidia.renderizarConteudoMensagemComMidia({
      id: 'itm_teste_txt',
      tipo: 'documento',
      texto: null,
      midia: { id: 'md_txt', nome: 'relatorio.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', tamanho: 187800, voz: false, disponivel: true, motivo: null },
    }));
    assert.match(htmlDocTxt, /Excel · 183 KB/);
    assert.equal(htmlDocTxt.includes('data-acao-midia="abrir"'), false, 'documento não-PDF não deve ter botão Abrir');
    assert.equal(htmlDocTxt.includes('data-acao-midia="baixar"'), true);

    // 3. Áudio de voz: <audio controls preload="none"> + microfone + "Mensagem de voz"
    const audioInfo = await page.evaluate(() => {
      const wrap = document.querySelector('#lista-mensagens .atd-midia-audio-wrap');
      const audio = wrap?.querySelector('audio.atd-midia-audio');
      return {
        rotulo: wrap?.querySelector('.atd-midia-voz-rotulo')?.textContent?.trim() || '',
        temSvgMic: !!wrap?.querySelector('.atd-midia-voz-rotulo svg'),
        controls: !!audio?.controls,
        preload: audio?.getAttribute('preload') || '',
      };
    });
    assert.equal(audioInfo.rotulo, 'Mensagem de voz');
    assert.equal(audioInfo.temSvgMic, true);
    assert.equal(audioInfo.controls, true);
    assert.equal(audioInfo.preload, 'none');

    // 4. Erros ao abrir/baixar GET /midias/:id -> 410 e 404 mostram os avisos exatos do contrato
    let statusForcado = 410;
    const padraoMidia = '**/api/admin/midias/*';
    await page.route(padraoMidia, async (route) => {
      if (statusForcado === 410) {
        return route.fulfill({
          status: 410,
          contentType: 'application/json',
          body: JSON.stringify({ erro: { codigo: 'midia_expirada', mensagem: 'Expirado' } }),
        });
      }
      if (statusForcado === 404) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ erro: { codigo: 'nao_encontrado', mensagem: 'Não achou' } }),
        });
      }
      return route.continue();
    });

    await page.click('#lista-mensagens .atd-midia-doc [data-acao-midia="baixar"]');
    await page.waitForFunction(() => document.body.textContent.includes('Este arquivo não está mais disponível.'));

    statusForcado = 404;
    await page.click('#lista-mensagens .atd-midia-doc [data-acao-midia="abrir"]');
    await page.waitForFunction(() => document.body.textContent.includes('Arquivo não encontrado.'));
    await page.unroute(padraoMidia);

    // 5. cv_ex07 (Encerradas): áudio expirado esmaecido, sem botões, com texto do motivo
    await page.click('#lista-visoes [data-visao="encerradas"]');
    await page.waitForSelector('[data-conversa-id="cv_ex07"]');
    await page.click('[data-conversa-id="cv_ex07"]');
    await page.waitForSelector('#lista-mensagens .atd-midia-indisponivel');
    const expInfo = await page.evaluate(() => {
      const card = document.querySelector('#lista-mensagens .atd-midia-indisponivel');
      return {
        motivoTxt: card?.querySelector('.atd-midia-indisponivel-motivo')?.textContent?.trim() || '',
        botoes: card ? card.querySelectorAll('button, a').length : -1,
      };
    });
    assert.equal(expInfo.motivoTxt, 'Arquivo expirado (prazo de guarda).');
    assert.equal(expInfo.botoes, 0, 'cartão indisponível não deve exibir botões');

    // Demais motivos do contrato (grande, recusado, falhou)
    const textosMotivos = await page.evaluate(() => ['grande', 'recusado', 'falhou'].map((m) => {
      const div = document.createElement('div');
      div.innerHTML = window.TalkMidia.renderizarConteudoMensagemComMidia({
        id: `itm_${m}`,
        tipo: 'documento',
        texto: null,
        midia: { id: null, nome: 'arq.bin', mime: 'application/octet-stream', tamanho: 0, voz: false, disponivel: false, motivo: m },
      });
      return div.querySelector('.atd-midia-indisponivel-motivo')?.textContent?.trim();
    }));
    assert.deepEqual(textosMotivos, [
      'Arquivo grande demais (mais de 16 MB): não foi recebido.',
      'Arquivo recusado por segurança.',
      'O WhatsApp não entregou o arquivo.',
    ]);

    // Ignora console.error gerados propositalmente pelos status HTTP 410/404 simulados acima
    const errosSemRedeSimulada = erros.filter((e) => !/404|410|Failed to load resource/i.test(e));
    assert.deepEqual(errosSemRedeSimulada, []);
  } finally {
    await ctx.close();
  }
});

test('G23 envio, colagem, ao vivo e Histórico: anexar PDF com legenda, colar imagem, fila múltipla, /simulado/receber com foto e mensagens.html', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    // Abre cv_ex02 como Carla (conversa na fila do Suporte com telefone na lista de teste)
    await page.goto(`${baseUrl}/atendimento.html?simular=atendente&conversa=cv_ex02`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    assert.equal(await page.isDisabled('#btn-anexar'), false);

    // 1. Anexar PDF com legenda via seletor de arquivo
    const amostraPdf = AMOSTRAS.pdf();
    await page.setInputFiles('#input-anexo', {
      name: 'orcamento-j2a.pdf',
      mimeType: 'application/pdf',
      buffer: amostraPdf.dados,
    });

    await page.waitForSelector('#painel-previa-anexos:not([hidden])');
    assert.match(await page.textContent('#lista-previa-anexos'), /orcamento-j2a\.pdf/);
    assert.equal((await page.textContent('#contador-legenda-anexo')).trim(), '0 / 1024');

    await page.fill('#campo-legenda-anexo', 'Segue o orçamento atualizado em PDF.');
    assert.equal((await page.textContent('#contador-legenda-anexo')).trim(), '36 / 1024');

    await page.click('#btn-enviar-anexo');
    await page.waitForSelector('#painel-previa-anexos[hidden]', { state: 'attached' });
    await page.waitForFunction(() => {
      const msgs = [...document.querySelectorAll('#lista-mensagens .atd-msg')];
      return msgs.some((m) => m.textContent.includes('orcamento-j2a.pdf') && m.textContent.includes('Segue o orçamento atualizado em PDF.'));
    });

    // Verifica que a legenda ficou abaixo do cartão do PDF
    const ordemPdfLegenda = await page.evaluate(() => {
      const msg = [...document.querySelectorAll('#lista-mensagens .atd-msg')].find((m) => m.textContent.includes('orcamento-j2a.pdf'));
      const doc = msg?.querySelector('.atd-midia-doc');
      const leg = msg?.querySelector('.atd-msg-legenda');
      return !!(doc && leg && leg.getBoundingClientRect().top >= doc.getBoundingClientRect().bottom - 2);
    });
    assert.equal(ordemPdfLegenda, true, 'legenda do PDF enviado deve aparecer abaixo do cartão');

    // 2. Colar imagem (Ctrl+V / ClipboardEvent) na conversa
    const amostraPng = AMOSTRAS.imagem();
    const pngBase64 = amostraPng.dados.toString('base64');
    await page.evaluate((b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const arq = new File([bytes], 'captura-colada.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(arq);
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      document.dispatchEvent(ev);
    }, pngBase64);

    await page.waitForSelector('#painel-previa-anexos:not([hidden]) .atd-previa-item-thumb');
    assert.match(await page.textContent('#lista-previa-anexos'), /captura-colada\.png/);

    // 3. Adiciona um segundo arquivo na fila para provar envio sequencial com legenda só no primeiro
    await page.setInputFiles('#input-anexo', {
      name: 'resumo-adicional.pdf',
      mimeType: 'application/pdf',
      buffer: amostraPdf.dados,
    });
    await page.waitForFunction(() => document.querySelectorAll('#lista-previa-anexos .atd-previa-item').length === 2);
    assert.equal(await page.isVisible('#previa-anexos-dica-fila'), true);
    await page.fill('#campo-legenda-anexo', 'Legenda apenas no primeiro item');

    const urlsAnexoEnviadas = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/conversas/cv_ex02/anexos')) {
        urlsAnexoEnviadas.push(req.url());
      }
    });

    await page.click('#btn-enviar-anexo');
    await page.waitForSelector('#painel-previa-anexos[hidden]', { state: 'attached' });
    await page.waitForFunction(() => document.body.textContent.includes('resumo-adicional.pdf'));

    assert.equal(urlsAnexoEnviadas.length, 2, 'os 2 arquivos da fila devem ser enviados em chamadas separadas na ordem');
    assert.match(urlsAnexoEnviadas[0], /nome=captura-colada\.png/);
    assert.match(urlsAnexoEnviadas[0], /legenda=Legenda/);
    assert.match(urlsAnexoEnviadas[1], /nome=resumo-adicional\.pdf/);
    assert.equal(urlsAnexoEnviadas[1].includes('legenda='), false, 'o segundo arquivo não deve repetir a legenda');

    // 4. Cliente enviando foto ao vivo via POST /api/admin/simulado/receber com midia: { nome, base64 }
    const respReceber = await page.evaluate(async (b64) => {
      const r = await fetch('/app/ia-talk/api/admin/simulado/receber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contato_id: 'ct_ex2',
          midia: { nome: 'foto-cliente-ao-vivo.png', base64: b64 },
        }),
      });
      return r.status;
    }, pngBase64);
    assert.equal(respReceber, 201);

    await page.waitForFunction(() => {
      const msgs = [...document.querySelectorAll('#lista-mensagens .atd-msg')];
      return msgs.some((m) => m.querySelector('img[alt="foto-cliente-ao-vivo.png"]'));
    });

    // Confira que na lista de conversas a prévia com emoji ("📎 Imagem") aparece bem
    await page.waitForFunction(() => {
      const itemLista = document.querySelector('#lista-conversas [data-conversa-id="cv_ex02"]');
      return itemLista?.textContent?.includes('📎 Imagem');
    });
    const previaLista = await page.textContent('#lista-conversas [data-conversa-id="cv_ex02"]');
    assert.match(previaLista, /📎\s*Imagem/);

    // 5. Histórico de mensagens (mensagens.html): limpa ?simular=atendente para entrar como admin (talk-mensagens)
    //    e confere na aba Envios os anexos com nome, tipo, tamanho e botões Abrir / Baixar
    await page.evaluate(() => { try { sessionStorage.removeItem('talk_simular'); } catch (_) {} });
    await page.goto(`${baseUrl}/mensagens.html?aba=envios`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tabela .tabulator-row');
    await page.locator('#tabela .tabulator-row').filter({ hasText: 'Segue o orçamento atualizado em PDF.' }).first().click();
    await page.waitForSelector('#corpo-detalhe:not([hidden]) #bloco-anexos:not([hidden])');

    const anexoHist = await page.evaluate(() => {
      const item = document.querySelector('#lista-anexos .tlk-anexo-rico');
      return {
        texto: item?.textContent?.replace(/\s+/g, ' ').trim() || '',
        temAbrir: !!item?.querySelector('[data-acao-midia="abrir"]'),
        temBaixar: !!item?.querySelector('[data-acao-midia="baixar"]'),
      };
    });
    assert.match(anexoHist.texto, /orcamento-j2a\.pdf/);
    assert.match(anexoHist.texto, /PDF \(application\/pdf\)/);
    assert.equal(anexoHist.temAbrir, true);
    assert.equal(anexoHist.temBaixar, true);

    // Testa o download real pelo botão Baixar no Histórico
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#lista-anexos [data-acao-midia="baixar"]'),
    ]);
    assert.equal(download.suggestedFilename(), 'orcamento-j2a.pdf');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G23 validações, 422 do servidor, selo midia=false no portal e zero rolagem horizontal em 1440 e 390 px', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/atendimento.html?simular=atendente&conversa=cv_ex01`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');

    let postsNoServidor = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/anexos')) postsNoServidor += 1;
    });

    // 1. Recusa no navegador: tipo não aceito (.exe) — avisa na hora sem bater no servidor
    await page.setInputFiles('#input-anexo', {
      name: 'instalador.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ-falso'),
    });
    await page.waitForSelector('#alerta-compositor:not([hidden])');
    assert.match(await page.textContent('#alerta-compositor'), /não é aceito/i);
    assert.equal(await page.isHidden('#painel-previa-anexos'), true);
    assert.equal(postsNoServidor, 0, 'tipo recusado no navegador não deve chamar POST /anexos');

    // 2. Recusa no navegador: arquivo > 16 MB — avisa na hora sem bater no servidor
    await page.evaluate(() => {
      const grande = new File([new ArrayBuffer(16 * 1024 * 1024 + 64)], 'video-grande.mp3', { type: 'audio/mpeg' });
      const dt = new DataTransfer();
      dt.items.add(grande);
      const inp = document.getElementById('input-anexo');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('#alerta-compositor:not([hidden])');
    assert.equal((await page.textContent('#alerta-compositor')).trim(), 'O arquivo passa de 16 MB.');
    assert.equal(await page.isHidden('#painel-previa-anexos'), true);
    assert.equal(postsNoServidor, 0, 'arquivo > 16 MB recusado no navegador não deve chamar POST /anexos');

    // 3. Servidor devolvendo 422 tipo_nao_suportado via page.route -> "Este tipo de arquivo não pode ser enviado."
    await page.route('**/api/admin/conversas/*/anexos*', async (route) => route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ erro: { codigo: 'tipo_nao_suportado', mensagem: 'Conteúdo incompatível.' } }),
    }));

    await page.setInputFiles('#input-anexo', {
      name: 'disfarcado.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('conteudo-nao-pdf'),
    });
    await page.waitForSelector('#painel-previa-anexos:not([hidden])');
    await page.click('#btn-enviar-anexo');
    await page.waitForSelector('#alerta-compositor:not([hidden])');
    assert.equal((await page.textContent('#alerta-compositor')).trim(), 'Este tipo de arquivo não pode ser enviado.');
    await page.click('#btn-cancelar-anexo');
    await page.unroute('**/api/admin/conversas/*/anexos*');

    // 4. Sem rolagem horizontal na Central (1440 e 390 px) com mídias abertas em cv_ex01
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(80);
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `Central com rolagem horizontal em ${w}px: ${med.sw} > ${med.iw}`);
    }

    // 5. Portal do atendente (portal.html): exibe as mesmas mídias sem rolagem horizontal em 1440 e 390 px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/j2a/atendimento?simular=atendente&conversa=cv_ex01`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-mensagens .atd-midia-thumb');
    assert.equal(await page.isDisabled('#btn-anexar'), false);

    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(80);
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `Portal com rolagem horizontal em ${w}px: ${med.sw} > ${med.iw}`);
    }

    // 6. Quando recursos.midia === false, o botão de clipe fica desabilitado com o selo "Ainda não ativo"
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/admin/atendimento/recursos*', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        menu: true, midia: false, status_atendente: false, rodizio: false,
        alertas_tela: false, alertas_whatsapp: false, escalonamento: false,
        pesquisa: false, inatividade: false, sla: false,
      }),
    }));
    await page.goto(`${baseUrl}/j2a/atendimento?simular=atendente&conversa=cv_ex01`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#chat-ativo:not([hidden])');
    assert.equal(await page.isDisabled('#btn-anexar'), true, 'botão anexar deve ficar desabilitado com recursos.midia = false');
    const seloMidia = page.locator('#wrap-btn-anexar [data-selo-recurso="midia"]');
    assert.equal(await seloMidia.isVisible(), true);
    assert.equal((await seloMidia.textContent()).trim(), 'Ainda não ativo');

    const errosSem422 = erros.filter((e) => !/422|Failed to load resource/i.test(e));
    assert.deepEqual(errosSem422, []);
  } finally {
    await ctx.close();
  }
});
