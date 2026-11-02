// node --test "apps/IA Service/tests/anexos-chat-ui.test.js"
// Clipes do chat J2A: anexos da abertura no cabecalho e anexos do SoftExpert
// em cada mensagem, no formato do WhatsApp (miniatura, cartao e tela cheia).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');

const root = path.resolve(__dirname, '../frontend/j2a');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
const SOFT = [
  { oid: 'oid-abertura', nome: 'print-compras.png', tamanho: 2048, origem: 'chamado', referenciaOid: 'ref-chamado' },
  { oid: 'oid-repetido', nome: 'print-compras.png', tamanho: 2048, origem: 'posicionamento', referenciaOid: 'ref-pos2' },
  { oid: 'oid-pos1', nome: 'log-edson.txt', tamanho: 100, origem: 'posicionamento', referenciaOid: 'ref-pos1', referenciaAutor: 'Edson Assis' },
  { oid: 'oid-pos1b', nome: 'config.xlsx', tamanho: 300, origem: 'posicionamento', referenciaOid: 'ref-pos1' },
];
const MENSAGENS = [
  { id: 'm-abertura', papel: 'user', conteudo: 'Abertura', criadoEm: '2026-10-30T10:00:00Z', origemReferencia: 'chamado:c1', origemReferenciaOid: 'ref-chamado' },
  { id: 'm-pos1', papel: 'user', conteudo: 'Posicionamento de Edson', criadoEm: '2026-10-30T11:00:00Z', origemReferencia: 'posicionamento:p1', origemReferenciaOid: 'ref-pos1' },
  { id: 'm-sem', papel: 'user', conteudo: 'Sem anexo', criadoEm: '2026-10-30T12:00:00Z', origemReferencia: 'posicionamento:p3', origemReferenciaOid: 'ref-outro' },
  { id: 'm-chat', papel: 'user', conteudo: 'Enviado pelo chat', criadoEm: '2026-10-30T13:00:00Z' },
];
const LOCAIS = [
  { id: 'l-chat', nome: 'enviado-chat.pdf', tamanho: 50, mensagemId: 'm-chat' },
  { id: 'l-copia', nome: 'print-compras.png', tamanho: 2048, origemOid: 'oid-abertura', origemReferenciaOid: 'ref-chamado' },
];

let browser;
before(async () => { browser = await playwright.chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function abrir({ soft = SOFT, locais = LOCAIS, falhaSoft = false, falhaArquivo = false, falhaMensagens = 0, atrasoSoft = null, atrasoArquivo = null, viewport = { width: 1440, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      const ticket = { id: 'c1', numero: '036912', titulo: 'Ajuste de layout', descricao: 'Descrição', clienteNome: 'Teste' };
      if (/\/anexos\/[^/]+\/download$/.test(url.pathname)) {
        if (falhaArquivo) return route.fulfill({ status: 502, json: { error: 'Falha no arquivo' } });
        return route.fulfill(url.pathname.includes('l-copia') ? { contentType: 'image/png', body: PNG } : { contentType: 'application/pdf', body: 'pdf' });
      }
      if (/\/anexos-softexpert\/[^/]+$/.test(url.pathname)) {
        if (atrasoArquivo) await atrasoArquivo;
        if (falhaArquivo) return route.fulfill({ status: 502, json: { error: 'Falha no arquivo' } });
        return route.fulfill(/oid-(abertura|repetido|grande)$/.test(url.pathname)
          ? { contentType: 'image/png', body: PNG }
          : { contentType: 'application/octet-stream', body: 'conteudo-soft' });
      }
      if (url.pathname.endsWith('/anexos-softexpert')) {
        if (atrasoSoft) await atrasoSoft;
        if (falhaSoft) return route.fulfill({ status: 502, json: { error: 'Agente Local offline' } });
        return route.fulfill({ json: { anexos: soft } });
      }
      let data = {};
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Consultor' };
      if (url.pathname.endsWith('/fila')) data = { chamados: [ticket] };
      if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: [ticket] };
      if (url.pathname.endsWith('/abrir-atendimento')) data = { atendimentoId: 'a1', chamado: ticket };
      if (url.pathname.endsWith('/atendimentos/a1/mensagens')) {
        if (falhaMensagens > 0) { falhaMensagens -= 1; return route.fulfill({ status: 500, json: { error: 'Servidor indisponível' } }); }
        data = MENSAGENS;
      }
      if (url.pathname.endsWith('/atendimentos/a1/anexos')) data = locais;
      if (url.pathname.endsWith('/trilha')) data = { trilha: [] };
      return route.fulfill({ json: data });
    }
    if (url.pathname.includes('/socket.io/')) return route.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({connected:true,on(){},emit(){},disconnect(){}});' });
    const rel = url.pathname.replace(/^\/iaservice\/(?:j2a\/)?assets\//, 'assets/');
    const filename = path.resolve(root, rel === '/iaservice/j2a/' ? 'index.html' : rel);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(filename) });
  });
  await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'teste'));
  await page.goto('http://anexos.test/iaservice/j2a/');
  await page.locator('[data-ticket-id="c1"]').first().click();
  return { page, context, errors, requests };
}

const botao = (page) => page.locator('#anexos-chamado-btn');
const cartao = (page, texto) => page.locator('.message-card', { hasText: texto });

test('cabeçalho lista os anexos em seções, sem repetir arquivos', async () => {
  const { page, context, errors } = await abrir();
  try {
    await page.waitForFunction(() => document.querySelector('#anexos-chamado-btn').textContent.includes('abertura 1'));
    assert.match(await botao(page).textContent(), /Anexos abertura 1 · outros 3/);
    await botao(page).click();
    assert.deepEqual(await page.locator('#anexos-modal-corpo .anexos-secao-titulo').allTextContents(), ['Abertura do chamado', 'Posicionamentos', 'Arquivos do atendimento']);
    assert.equal(await page.locator('#anexos-modal-corpo .wa-midia').count(), 1);
    await page.waitForFunction(() => document.querySelector('#anexos-modal-corpo .wa-midia img')?.naturalWidth > 0);
    assert.deepEqual(await page.locator('#anexos-modal-corpo .wa-doc-nome').allTextContents(), ['log-edson.txt', 'config.xlsx', 'enviado-chat.pdf']);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#anexos-modal-backdrop.ativo').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('mensagem mostra imagem e documento dentro do balão, e o documento baixa', async () => {
  const { page, context, requests } = await abrir();
  try {
    await cartao(page, 'Abertura').locator('.wa-midia img[src^="blob:"]').waitFor();
    const pos = cartao(page, 'Posicionamento de Edson');
    assert.deepEqual(await pos.locator('.wa-doc-nome').allTextContents(), ['log-edson.txt', 'config.xlsx']);
    assert.match(await pos.locator('.wa-doc-detalhe').first().textContent(), /^TXT · 100 B/);
    assert.equal(await cartao(page, 'Sem anexo').locator('.wa-anexos').count(), 0);
    assert.equal(await cartao(page, 'Enviado pelo chat').locator('.wa-doc').count(), 1);
    assert.equal(requests.filter((r) => r.endsWith('/oid-pos1')).length, 0, 'documento só baixa no clique');
    const [download] = await Promise.all([page.waitForEvent('download'), pos.locator('.wa-doc').first().click()]);
    assert.equal(download.suggestedFilename(), 'log-edson.txt');
    assert.equal(fs.readFileSync(await download.path(), 'utf8'), 'conteudo-soft');
  } finally { await context.close(); }
});

test('imagem abre em tela cheia, baixa e fecha com Esc, sem buscar de novo', async () => {
  const { page, context, requests } = await abrir();
  try {
    const midia = cartao(page, 'Abertura').locator('.wa-midia');
    await midia.locator('img[src^="blob:"]').waitFor();
    await midia.click();
    await page.locator('#anexo-visualizador.ativo #anexo-visualizador-img[src^="blob:"]').waitFor();
    assert.equal(await page.locator('#anexo-visualizador-nome').textContent(), 'print-compras.png');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#anexo-visualizador-baixar').click()]);
    assert.equal(download.suggestedFilename(), 'print-compras.png');
    assert.equal(requests.filter((r) => r.endsWith('/l-copia/download')).length, 1);
    assert.equal(requests.filter((r) => r.endsWith('/oid-abertura')).length, 0, 'cópia do servidor não passa pelo agente');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#anexo-visualizador.ativo').count(), 0);
  } finally { await context.close(); }
});

test('imagem grande não baixa sozinha e abre no clique', async () => {
  const grande = [{ oid: 'oid-grande', nome: 'grande.jpg', tamanho: 8 * 1024 * 1024, origem: 'chamado', referenciaOid: 'ref-chamado' }];
  const { page, context, requests } = await abrir({ soft: grande, locais: [] });
  try {
    const midia = cartao(page, 'Abertura').locator('.wa-midia');
    await midia.waitFor();
    assert.match(await midia.textContent(), /grande\.jpg · 8 MB · clique para ver/);
    assert.equal(requests.filter((r) => r.endsWith('/oid-grande')).length, 0);
    await midia.click();
    await page.locator('#anexo-visualizador-img[src^="blob:"]').waitFor();
    assert.equal(requests.filter((r) => r.endsWith('/oid-grande')).length, 1);
  } finally { await context.close(); }
});

test('miniatura que falha não é buscada de novo ao atualizar a conversa, só no clique', async () => {
  const { page, context, requests } = await abrir({ soft: [SOFT[0]], falhaArquivo: true });
  try {
    await page.waitForFunction(() => {
      const img = document.querySelector('.wa-midia img');
      return img && !img.hasAttribute('src') && !img.hasAttribute('data-miniatura');
    });
    const contar = () => requests.filter((r) => r.endsWith('/l-copia/download')).length;
    assert.equal(contar(), 1);
    await botao(page).click();
    await page.keyboard.press('Escape');
    await page.locator('#anexos-modal-corpo .wa-midia').waitFor({ state: 'hidden' });
    assert.equal(contar(), 1, 'reabrir a lista não busca de novo');
    assert.match(await cartao(page, 'Abertura').locator('.wa-midia').textContent(), /print-compras\.png/);
    await cartao(page, 'Abertura').locator('.wa-midia').click();
    await page.waitForFunction(() => !document.querySelector('#anexo-visualizador').classList.contains('ativo'));
    assert.equal(contar(), 2, 'o clique tenta de novo');
  } finally { await context.close(); }
});

test('anexo de grade do posicionamento aparece na mensagem', async () => {
  const soft = [{ oid: 'oid-grade', nome: 'grade.pdf', tamanho: 10, origem: 'posicionamento_anexo', referenciaOid: 'ref-pos1' }];
  const { page, context } = await abrir({ soft });
  try {
    await cartao(page, 'Posicionamento de Edson').locator('.wa-doc-nome').waitFor();
    assert.equal(await cartao(page, 'Posicionamento de Edson').locator('.wa-doc-nome').textContent(), 'grade.pdf');
  } finally { await context.close(); }
});

test('lista que chega depois da conversa coloca os anexos na mensagem', async () => {
  let liberar;
  const atrasoSoft = new Promise((resolve) => { liberar = resolve; });
  const { page, context } = await abrir({ atrasoSoft });
  try {
    await cartao(page, 'Posicionamento de Edson').waitFor();
    assert.equal(await botao(page).isDisabled(), true);
    assert.equal(await cartao(page, 'Posicionamento de Edson').locator('.wa-doc').count(), 0);
    liberar();
    await cartao(page, 'Posicionamento de Edson').locator('.wa-doc').first().waitFor();
    assert.equal(await botao(page).isDisabled(), false);
  } finally { await context.close(); }
});

test('falha do SoftExpert avisa e mantém os arquivos do atendimento', async () => {
  const { page, context } = await abrir({ falhaSoft: true });
  try {
    await page.waitForFunction(() => document.querySelector('#anexos-chamado-btn').textContent.includes('indisponíveis'));
    await botao(page).click();
    assert.match(await page.locator('#anexos-modal-corpo .anexos-aviso').textContent(), /Agente Local offline/);
    assert.equal(await page.locator('#anexos-modal-corpo .wa-doc-nome').first().textContent(), 'enviado-chat.pdf');
    await page.keyboard.press('Escape');
    assert.match(await page.locator('#anexos-aviso-ia').textContent(), /Não foi possível verificar os anexos/);
    await cartao(page, 'Abertura').locator('.wa-midia img[src^="blob:"]').waitFor();
  } finally { await context.close(); }
});

test('imagem sem cópia no servidor não passa pelo agente ao abrir, só no clique', async () => {
  const soft = [{ oid: 'oid-repetido', nome: 'tela.png', tamanho: 2048, origem: 'chamado', referenciaOid: 'ref-chamado' }];
  const { page, context, requests } = await abrir({ soft, locais: [] });
  try {
    const midia = cartao(page, 'Abertura').locator('.wa-midia');
    await midia.waitFor();
    assert.match(await midia.textContent(), /clique para ver/);
    assert.equal(requests.filter((r) => r.endsWith('/oid-repetido')).length, 0);
    await midia.click();
    await page.locator('#anexo-visualizador-img[src^="blob:"]').waitFor();
    assert.equal(requests.filter((r) => r.endsWith('/oid-repetido')).length, 1);
  } finally { await context.close(); }
});

test('anexo guardado só no SoftExpert aparece, não é clicável e gera aviso', async () => {
  const soft = [{ oid: 'wf-1', nome: 'Doc1.pdf', tamanho: 383761, origem: 'workflow', conteudoAcessivel: false, referenciaOid: 'ref-chamado' }];
  const { page, context, requests } = await abrir({ soft, locais: [] });
  try {
    const off = cartao(page, 'Abertura').locator('.wa-doc-off');
    await off.waitFor();
    assert.match(await off.textContent(), /Guardado só no SoftExpert/);
    await off.click();
    assert.equal(requests.filter((r) => r.endsWith('/wf-1')).length, 0);
    assert.match(await page.locator('#anexos-aviso-ia').textContent(), /A IA não está recebendo 1 anexo: Doc1\.pdf \(guardado só no SoftExpert\)/);
    assert.match(await botao(page).textContent(), /Anexos abertura 1/);
  } finally { await context.close(); }
});

test('cada anexo fica só na sua mensagem; sem mensagem correspondente, na abertura', async () => {
  const soft = [
    { oid: 'o-abertura', nome: 'abertura.txt', tamanho: 1, origem: 'workflow', referenciaOid: 'ref-chamado' },
    { oid: 'o-pos', nome: 'do-edson.txt', tamanho: 1, origem: 'workflow', referenciaOid: 'ref-pos1' },
    { oid: 'o-orfao', nome: 'sem-mensagem.txt', tamanho: 1, origem: 'workflow', referenciaOid: 'ref-inexistente' },
    { oid: 'o-sem-ref', nome: 'sem-referencia.txt', tamanho: 1, origem: 'anexo', referenciaOid: null },
  ];
  const locais = [
    { id: 'l-copia', nome: 'copia.txt', tamanho: 1, origemOid: 'o-x', origemReferenciaOid: 'ref-pos1', mensagemId: 'm-chat' },
    { id: 'l-orfa', nome: 'copia-orfa.txt', tamanho: 1, origemOid: 'o-y', origemReferenciaOid: null },
    { id: 'l-chat', nome: 'enviado-chat.pdf', tamanho: 50, mensagemId: 'm-chat' },
  ];
  const { page, context } = await abrir({ soft, locais });
  try {
    const nomes = (texto) => cartao(page, texto).locator('.wa-doc-nome').allTextContents();
    await cartao(page, 'Abertura').locator('.wa-doc-nome', { hasText: 'abertura.txt' }).waitFor();
    assert.deepEqual((await nomes('Abertura')).sort(), ['abertura.txt', 'copia-orfa.txt', 'sem-mensagem.txt', 'sem-referencia.txt']);
    assert.deepEqual((await nomes('Posicionamento de Edson')).sort(), ['copia.txt', 'do-edson.txt']);
    assert.deepEqual(await nomes('Sem anexo'), []);
    assert.deepEqual(await nomes('Enviado pelo chat'), ['enviado-chat.pdf']);
  } finally { await context.close(); }
});

test('duas imagens com cópia na mesma mensagem mostram as duas miniaturas', async () => {
  const locais = [
    { id: 'l-copia', nome: 'a.png', tamanho: 2048, origemOid: 'o1', origemReferenciaOid: 'ref-chamado' },
    { id: 'l-copia2', nome: 'b.png', tamanho: 2048, origemOid: 'o2', origemReferenciaOid: 'ref-chamado' },
  ];
  const { page, context } = await abrir({ soft: [], locais });
  try {
    await page.waitForFunction(() => document.querySelectorAll('.wa-midia img[src^="blob:"]').length === 2);
  } finally { await context.close(); }
});

test('arquivos diferentes com o mesmo nome aparecem os dois', async () => {
  const soft = [
    { oid: 'o1', nome: 'image.txt', tamanho: 100, origem: 'workflow', referenciaOid: 'ref-pos1' },
    { oid: 'o2', nome: 'image.txt', tamanho: 200, origem: 'workflow', referenciaOid: 'ref-pos1' },
    { oid: 'o3', nome: 'image.txt', tamanho: 200, origem: 'posicionamento', referenciaOid: 'ref-pos1' },
  ];
  const { page, context } = await abrir({ soft, locais: [] });
  try {
    await cartao(page, 'Posicionamento de Edson').locator('.wa-doc').first().waitFor();
    assert.equal(await cartao(page, 'Posicionamento de Edson').locator('.wa-doc').count(), 2);
  } finally { await context.close(); }
});

test('sem pendências o aviso da IA não aparece', async () => {
  const { page, context } = await abrir({ soft: [SOFT[0]], locais: [LOCAIS[1]] });
  try {
    await page.waitForFunction(() => document.querySelector('#anexos-chamado-btn').textContent.includes('abertura 1'));
    assert.equal(await page.locator('#anexos-aviso-ia').isVisible(), false);
  } finally { await context.close(); }
});

test('lista travada não segura os painéis do chamado', async () => {
  let liberar;
  const atrasoSoft = new Promise((resolve) => { liberar = resolve; });
  const { page, context } = await abrir({ atrasoSoft });
  try {
    await cartao(page, 'Posicionamento de Edson').waitFor();
    await page.waitForFunction(() => document.querySelector('#evidence-content').textContent.includes('Anexos do atendimento'));
    assert.equal(await botao(page).isDisabled(), true);
    liberar();
  } finally { await context.close(); }
});

test('download mostra indicador e ignora novos cliques até terminar', async () => {
  let liberar;
  const atrasoArquivo = new Promise((resolve) => { liberar = resolve; });
  const { page, context, requests } = await abrir({ atrasoArquivo });
  try {
    const doc = cartao(page, 'Posicionamento de Edson').locator('.wa-doc').first();
    await doc.waitFor();
    await doc.click();
    await page.waitForFunction(() => document.body.textContent.includes('Baixando...'));
    await doc.click();
    const [download] = await Promise.all([page.waitForEvent('download'), Promise.resolve().then(liberar)]);
    assert.equal(download.suggestedFilename(), 'log-edson.txt');
    assert.equal(requests.filter((r) => r.endsWith('/oid-pos1')).length, 1);
    await page.waitForFunction(() => !document.body.textContent.includes('Baixando...'));
  } finally { await context.close(); }
});

test('falha ao carregar a conversa oferece tentar de novo', async () => {
  const { page, context } = await abrir({ falhaMensagens: 1 });
  try {
    const tentar = page.locator('[data-tentar-abrir]');
    await tentar.waitFor();
    assert.match(await page.locator('#messages').textContent(), /Servidor indisponível/);
    await tentar.click();
    await cartao(page, 'Posicionamento de Edson').waitFor();
  } finally { await context.close(); }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`anexos e visualizador cabem na tela (${viewport.width}px)`, async () => {
    const { page, context, errors } = await abrir({ viewport });
    try {
      const midia = cartao(page, 'Abertura').locator('.wa-midia');
      await midia.locator('img[src^="blob:"]').waitFor();
      await cartao(page, 'Posicionamento de Edson').scrollIntoViewIfNeeded();
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/anexos-chat-${viewport.width}.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const doc = await cartao(page, 'Posicionamento de Edson').locator('.wa-doc').first().boundingBox();
      assert.ok(doc.height >= 44 && doc.x + doc.width <= viewport.width);
      await midia.click();
      await page.locator('#anexo-visualizador-img[src^="blob:"]').waitFor();
      const fechar = await page.locator('#anexo-visualizador-fechar').boundingBox();
      assert.ok(fechar.x + fechar.width <= viewport.width && fechar.height >= 44);
      await page.keyboard.press('Escape');
      await botao(page).click();
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/anexos-modal-${viewport.width}.png`) });
      const modal = await page.locator('.anexos-modal').boundingBox();
      assert.ok(modal.x >= 0 && modal.x + modal.width <= viewport.width);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
