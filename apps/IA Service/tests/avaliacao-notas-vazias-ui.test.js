// node --test "apps/IA Service/tests/avaliacao-notas-vazias-ui.test.js"
// Modal "Avaliar Pesquisa da IA": as notas abrem vazias mesmo com sugestao da
// IA, para nao induzir o avaliador, e salvar exige as 5 notas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');

const root = path.resolve(__dirname, '../frontend/j2a');
const CAMPOS = ['compreensaoProblema', 'aproveitamentoEvidencias', 'profundidadeTecnica', 'orientacaoPratica', 'confiabilidadeTecnica'];
const OBSERVACAO_IA = 'Observação gerada pela IA';
const notasSugeridas = Object.fromEntries(CAMPOS.map((c) => [c, 5]));

let browser;
before(async () => { browser = await playwright.chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function abrir({ minhaAvaliacao = null, sugestao = { sucesso: true, sugestao: { notas: notasSugeridas, observacoes: OBSERVACAO_IA } }, atrasoSugestao = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const salvas = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      const ticket = { id: 'ticket1', numero: '123456', titulo: 'Chamado', descricao: 'Descrição', clienteNome: 'Teste' };
      let data = {};
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Consultor' };
      if (url.pathname.endsWith('/fila')) data = { chamados: [ticket] };
      if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: [ticket] };
      if (url.pathname.endsWith('/abrir-atendimento')) data = { atendimentoId: 'a1', chamado: ticket };
      if (url.pathname.endsWith('/atendimentos/a1/mensagens')) {
        data = [{
          id: 'm1', papel: 'assistant', texto: 'Resposta da pesquisa', criadoEm: '2026-10-30T12:00:00Z',
          respostaOperacional: { avaliacaoHumana: { minhaAvaliacaoAtual: minhaAvaliacao, todasAsAvaliacoesAtuais: minhaAvaliacao ? [minhaAvaliacao] : [] } },
        }];
      }
      if (url.pathname.endsWith('/anexos')) data = [];
      if (url.pathname.endsWith('/trilha')) data = { trilha: [] };
      if (url.pathname.endsWith('/avaliacao/sugestao')) {
        if (atrasoSugestao) await atrasoSugestao;
        data = sugestao;
      }
      if (url.pathname.endsWith('/avaliacao') && route.request().method() === 'POST') {
        const corpo = route.request().postDataJSON();
        salvas.push(corpo);
        data = { avaliacaoAtual: { usuarioId: 'u1', notas: corpo.notas, notaTotal: 15 } };
      }
      return route.fulfill({ json: data });
    }
    if (url.pathname.includes('/socket.io/')) return route.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({connected:true,on(){},emit(){},disconnect(){}});' });
    const rel = url.pathname.replace(/^\/iaservice\/(?:j2a\/)?assets\//, 'assets/');
    const filename = path.resolve(root, rel === '/iaservice/j2a/' ? 'index.html' : rel);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(filename) });
  });
  await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'teste'));
  await page.goto('http://avaliacao.test/iaservice/j2a/');
  await page.locator('[data-ticket-id="ticket1"]').first().click();
  await page.locator('[data-avaliacao-abrir]').click();
  await page.locator('#avaliacao-compreensaoProblema').waitFor();
  return { page, context, salvas };
}

const notasNaTela = (page) => Promise.all(CAMPOS.map((c) => page.locator(`#avaliacao-${c}`).inputValue()));
const rotulo = (page) => page.locator('#avaliacao-modal-sugestao-aviso .avaliacao-sugestao-rotulo');
const SALVAR = 'Salvar avaliação';

test('sugestão da IA não preenche as notas, só a observação', async () => {
  const { page, context } = await abrir();
  try {
    await rotulo(page).waitFor();
    assert.deepEqual(await notasNaTela(page), ['', '', '', '', '']);
    assert.equal(await page.locator('#avaliacao-observacoes').inputValue(), OBSERVACAO_IA);
    assert.match(await rotulo(page).textContent(), /Observação sugerida pela IA/);
  } finally { await context.close(); }
});

test('salvar sem todas as notas não grava nada; com as 5 grava os valores escolhidos', async () => {
  const { page, context, salvas } = await abrir();
  try {
    await rotulo(page).waitFor();
    await page.getByRole('button', { name: SALVAR }).click();
    assert.equal(salvas.length, 0);
    for (const c of CAMPOS.slice(0, 4)) await page.locator(`#avaliacao-${c}`).selectOption('3');
    await page.getByRole('button', { name: SALVAR }).click();
    assert.equal(salvas.length, 0, 'uma nota vazia ainda bloqueia');
    await page.locator(`#avaliacao-${CAMPOS[4]}`).selectOption('0');
    await page.getByRole('button', { name: SALVAR }).click();
    await page.locator('#avaliacao-modal-backdrop.ativo').waitFor({ state: 'detached' });
    assert.deepEqual(salvas[0].notas, { compreensaoProblema: 3, aproveitamentoEvidencias: 3, profundidadeTecnica: 3, orientacaoPratica: 3, confiabilidadeTecnica: 0 });
  } finally { await context.close(); }
});

test('sugestão que chega atrasada não apaga notas nem observação já preenchidas', async () => {
  let liberar;
  const atrasoSugestao = new Promise((resolve) => { liberar = resolve; });
  const { page, context } = await abrir({ atrasoSugestao });
  try {
    await page.locator(`#avaliacao-${CAMPOS[0]}`).selectOption('2');
    await page.locator('#avaliacao-observacoes').fill('Minha observação');
    const respondeu = page.waitForResponse((r) => r.url().endsWith('/avaliacao/sugestao'));
    liberar();
    await respondeu;
    await page.locator('#avaliacao-modal-sugestao-aviso .avaliacao-sugestao-status').waitFor({ state: 'detached' });
    assert.equal(await page.locator(`#avaliacao-${CAMPOS[0]}`).inputValue(), '2');
    assert.equal(await page.locator('#avaliacao-observacoes').inputValue(), 'Minha observação');
    assert.equal(await rotulo(page).count(), 0);
  } finally { await context.close(); }
});

test('falha da sugestão abre com notas vazias e sem rótulo', async () => {
  const { page, context } = await abrir({ sugestao: { sucesso: false } });
  try {
    await page.locator('#avaliacao-modal-sugestao-aviso .avaliacao-sugestao-status').waitFor({ state: 'detached' });
    assert.deepEqual(await notasNaTela(page), ['', '', '', '', '']);
    assert.equal(await rotulo(page).count(), 0);
  } finally { await context.close(); }
});

test('editar avaliação já salva mantém as notas gravadas, inclusive 0', async () => {
  const notas = { compreensaoProblema: 0, aproveitamentoEvidencias: 1, profundidadeTecnica: 2, orientacaoPratica: 3, confiabilidadeTecnica: 4 };
  const { page, context } = await abrir({ minhaAvaliacao: { usuarioId: 'u1', notas, notaTotal: 10, observacoes: 'Salva antes' } });
  try {
    assert.deepEqual(await notasNaTela(page), ['0', '1', '2', '3', '4']);
    assert.equal(await page.locator('#avaliacao-observacoes').inputValue(), 'Salva antes');
  } finally { await context.close(); }
});

test('atendimento.html segue a mesma regra do modal do J2A', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../frontend/atendimento.html'), 'utf8');
  assert.match(html, /<select id="avaliacao-\$\{campo\}" required>/);
  assert.match(html, /select\.reportValidity\(\)/);
  assert.doesNotMatch(html, /_renderizarCamposAvaliacao\(resp\.sugestao\)/);
});
