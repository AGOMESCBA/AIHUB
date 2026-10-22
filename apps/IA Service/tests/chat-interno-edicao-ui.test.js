// node --test "apps/IA Service/tests/chat-interno-edicao-ui.test.js"
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const assets = path.join(__dirname, '../frontend/j2a/assets');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });

async function abrir(viewport) {
  const page = await browser.newPage({ viewport });
  await page.setContent('<html lang="pt-BR"><head><title>Chat</title></head><body><header id="anchor"></header></body></html>');
  await page.addStyleTag({ path: path.join(assets, 'radar.css') });
  await page.addStyleTag({ path: path.join(assets, 'chat-interno.css') });
  await page.addScriptTag({ path: path.join(assets, 'chat-interno.js') });
  await page.evaluate(() => {
    window.handlers = {};
    window.calls = [];
    window.socket = { connected: true, on: (name, cb) => { window.handlers[name] = cb; }, emit() {}, disconnect() {} };
    window.io = () => window.socket;
    window.setInterval = (cb) => { window.poll = cb; return 1; };
    const em = '2026-10-21T12:00:00.000Z';
    window.messages = [
      { id: 'minha', sequencia: 1, conversaId: 'conversa', remetenteId: 'eu', minha: true, texto: 'Mensagem original', criadoEm: em, vistoEm: em },
      { id: 'dele', sequencia: 2, conversaId: 'conversa', remetenteId: 'beto', minha: false, texto: 'Resposta do colega', criadoEm: em },
    ];
    window.userHidden = new Set();
    const clone = (obj) => JSON.parse(JSON.stringify(obj));
    window.widget = IaChatInterno.mount({ anchor: document.querySelector('#anchor'), getToken: () => 'teste', ext: (p) => p,
      request: async (url, options = {}) => {
        window.calls.push({ url, method: options.method || 'GET', body: options.body });
        if (url.endsWith('/excluir-mensagens')) {
          if (window.failMutation) throw new Error('Falha de rede simulada');
          const body = JSON.parse(options.body);
          const ids = body.todas ? window.messages.map((m) => m.id) : body.mensagemIds;
          if (body.modo === 'mim') {
            ids.forEach((id) => window.userHidden.add(id));
            const resultado = body.todas ? { conversaId: 'conversa', ateSequencia: Math.max(0, ...window.messages.map((m) => m.sequencia)), total: ids.length }
              : { conversaId: 'conversa', mensagemIds: ids, total: ids.length };
            if (window.delayClear && body.todas) await new Promise((resolve) => { window.releaseClear = resolve; });
            return resultado;
          }
          const mensagens = window.messages.filter((m) => ids.includes(m.id));
          mensagens.forEach((m) => { m.texto = 'Mensagem apagada'; m.apagadoEm = new Date().toISOString(); });
          return { conversaId: 'conversa', mensagens: clone(mensagens) };
        }
        if (['PATCH', 'DELETE'].includes(options.method)) {
          if (window.failMutation) throw new Error('Falha de rede simulada');
          const m = window.messages.find((x) => x.id === decodeURIComponent(url.split('/').pop()));
          if (options.method === 'PATCH') { m.texto = JSON.parse(options.body).texto; m.editadoEm = new Date().toISOString(); }
          else { m.texto = 'Mensagem apagada'; m.apagadoEm = new Date().toISOString(); }
          return clone(m);
        }
        if (url.endsWith('/contatos')) {
          const ultima = window.messages.filter((m) => !window.userHidden.has(m.id)).at(-1);
          const resultado = { contatos: [{ consultorId: 'beto', nome: 'Beto', conversaId: 'conversa', naoLidas: 0, ultimaMensagem: ultima ? { texto: ultima.texto, em, minha: ultima.minha } : null }] };
          if (window.delayContactOnce) {
            window.delayContactOnce = false;
            await new Promise((resolve) => { window.releaseContact = resolve; });
          }
          return resultado;
        }
        if (url.endsWith('/mensagens')) return { mensagens: clone(window.messages.filter((m) => !window.userHidden.has(m.id))), contato: { nome: 'Beto' } };
        return { ok: true };
      },
    });
    window.widget.start();
  });
  await page.getByRole('button', { name: 'Mensagens da equipe' }).click();
  await page.locator('[data-ci-contato="beto"]').click();
  return page;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`editar, cancelar e apagar com confirmação (${viewport.width}px)`, async () => {
    const page = await abrir(viewport);
    try {
      assert.equal(await page.locator('[data-msg="dele"] [data-ci="editar"], [data-msg="dele"] [data-ci="apagar"]').count(), 0);
      await page.locator('#ci-texto').fill('Rascunho preservado');
      await page.locator('[data-msg="minha"] summary').click();
      await page.getByRole('button', { name: 'Editar', exact: true }).click();
      assert.equal(await page.locator('#ci-editar-texto').inputValue(), 'Mensagem original');
      await page.locator('#ci-editar-texto').fill('Descartar edição');
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.equal(await page.locator('#ci-texto').inputValue(), 'Rascunho preservado');
      assert.equal(await page.evaluate(() => window.calls.filter((c) => c.method === 'PATCH').length), 0);
      await page.locator('[data-msg="minha"] summary').click();
      await page.getByRole('button', { name: 'Editar', exact: true }).click();
      await page.locator('#ci-editar-texto').fill('Correção <img src=x onerror=alert(1)>');
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/chat-interno-edicao-${viewport.width}.png`) });
      await page.getByRole('button', { name: 'Salvar alteração' }).click();
      await page.waitForFunction(() => !document.querySelector('#ci-form-editar'));
      assert.match(await page.locator('[data-msg="minha"] .ci-texto').textContent(), /Correção <img/);
      assert.equal(await page.locator('[data-msg="minha"] img').count(), 0);
      assert.match(await page.locator('[data-msg="minha"] .ci-meta').textContent(), /editada/);
      assert.equal(await page.locator('#ci-texto').inputValue(), 'Rascunho preservado');
      await page.locator('[data-msg="minha"] summary').click();
      page.once('dialog', (d) => d.dismiss());
      await page.getByRole('button', { name: 'Apagar para todos' }).click();
      assert.equal(await page.evaluate(() => window.calls.filter((c) => c.method === 'DELETE').length), 0);
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Apagar para todos' }).click();
      await page.waitForFunction(() => document.querySelector('[data-msg="minha"] .ci-texto').textContent === 'Mensagem apagada');
      assert.equal(await page.locator('[data-msg="minha"] [data-ci="editar"], [data-msg="minha"] [data-ci="apagar"]').count(), 0);
      assert.equal(await page.locator('[data-msg="minha"] .ci-tick').count(), 0);
      assert.equal(await page.locator('#ci-texto').inputValue(), 'Rascunho preservado');
      assert.equal(await page.evaluate(() => document.querySelector('.ci-painel').getBoundingClientRect().width <= innerWidth), true);
    } finally { await page.close(); }
  });
}

test('eventos, reconexão e consulta periódica atualizam sem notificar como mensagem nova', async () => {
  const page = await abrir({ width: 1440, height: 900 });
  try {
    await page.locator('#ci-texto').fill('Não perder rascunho');
    await page.evaluate(() => {
      const m = window.messages[1];
      m.texto = 'Resposta corrigida'; m.editadoEm = new Date().toISOString();
      window.handlers['chat:mensagem-alterada']({ ...m });
    });
    assert.equal(await page.locator('[data-msg="dele"] .ci-texto').textContent(), 'Resposta corrigida');
    assert.equal(await page.locator('.ci-toast-msg').count(), 0);
    assert.equal(await page.title(), 'Chat');
    await page.evaluate(() => {
      window.messages[1].texto = 'Mensagem apagada'; window.messages[1].apagadoEm = new Date().toISOString();
      window.socket.connected = false;
      window.poll();
    });
    await page.waitForFunction(() => document.querySelector('[data-msg="dele"] .ci-texto').textContent === 'Mensagem apagada');
    await page.evaluate(() => window.handlers['chat:mensagem-alterada']({ ...window.messages[1], apagadoEm: null, texto: 'Resposta atrasada' }));
    assert.equal(await page.locator('[data-msg="dele"] .ci-texto').textContent(), 'Mensagem apagada');
    await page.evaluate(() => {
      window.messages[0].texto = 'Editada durante desconexão'; window.messages[0].editadoEm = new Date().toISOString();
      window.socket.connected = true;
      window.handlers.connect();
    });
    await page.waitForFunction(() => document.querySelector('[data-msg="minha"] .ci-texto').textContent === 'Editada durante desconexão');
    assert.equal(await page.locator('#ci-texto').inputValue(), 'Não perder rascunho');
  } finally { await page.close(); }
});

test('falha ao salvar conserva edição e rascunho para tentar novamente', async () => {
  const page = await abrir({ width: 390, height: 844 });
  try {
    await page.locator('#ci-texto').fill('Nova mensagem');
    await page.locator('[data-msg="minha"] summary').click();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.locator('#ci-editar-texto').fill('Texto a salvar');
    await page.evaluate(() => { window.failMutation = true; });
    await page.getByRole('button', { name: 'Salvar alteração' }).click();
    await page.waitForFunction(() => document.querySelector('.ci-toast-sistema'));
    assert.equal(await page.locator('#ci-editar-texto').inputValue(), 'Texto a salvar');
    assert.equal(await page.locator('#ci-texto').inputValue(), 'Nova mensagem');
    assert.equal(await page.getByRole('button', { name: 'Salvar alteração' }).isEnabled(), true);
    await page.evaluate(() => { window.failMutation = false; });
    await page.getByRole('button', { name: 'Salvar alteração' }).click();
    await page.waitForFunction(() => !document.querySelector('#ci-form-editar'));
    assert.equal(await page.locator('[data-msg="minha"] .ci-texto').textContent(), 'Texto a salvar');
  } finally { await page.close(); }
});

for (const width of [1440, 390]) {
  test(`apagar recebida para mim, selecionar várias e limpar conversa (${width}px)`, async () => {
    const page = await abrir({ width, height: 900 });
    try {
      await page.locator('#ci-texto').fill('Rascunho da conversa');
      await page.locator('[data-msg="dele"] summary').click();
      page.once('dialog', (d) => d.dismiss());
      await page.locator('[data-msg="dele"] [data-ci="apagar-mim"]').click();
      assert.equal(await page.locator('[data-msg="dele"]').count(), 1);
      page.once('dialog', (d) => d.accept());
      await page.locator('[data-msg="dele"] [data-ci="apagar-mim"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-msg="dele"]'));
      assert.equal(await page.evaluate(() => window.messages[1].texto), 'Resposta do colega', 'conteúdo do outro participante foi preservado');
      assert.equal(await page.locator('#ci-texto').inputValue(), 'Rascunho da conversa');
      await page.locator('[data-msg="minha"] summary').click();
      await page.locator('[data-msg="minha"] [data-ci="selecionar"]').click();
      assert.equal(await page.locator('[data-ci-selecionar="minha"]').isChecked(), true);
      assert.equal(await page.locator('[data-ci="excluir-selecao-todos"]').isEnabled(), true);
      await page.evaluate(() => { window.failMutation = true; });
      page.once('dialog', (d) => d.accept());
      await page.locator('[data-ci="excluir-selecao-mim"]').click();
      await page.waitForFunction(() => document.querySelector('.ci-toast-sistema'));
      assert.equal(await page.locator('[data-ci-selecionar="minha"]').isChecked(), true);
      await page.evaluate(() => { window.failMutation = false; });
      await page.getByRole('button', { name: 'Cancelar seleção' }).click();
      await page.getByRole('button', { name: 'Voltar', exact: true }).click();
      await page.locator('[data-ci-contato="beto"]').click();
      assert.equal(await page.locator('[data-msg="dele"]').count(), 0, 'reabrir não restaura exclusão pessoal');
      await page.evaluate(() => {
        const nova = { ...window.messages[1], id: 'nova', sequencia: 3, texto: 'Nova resposta' };
        window.messages.push(nova);
        window.handlers['chat:mensagem'](nova);
      });
      await page.waitForFunction(() => document.querySelector('[data-msg="nova"]'));
      await page.locator('.ci-menu-conversa summary').click();
      await page.getByRole('button', { name: 'Selecionar mensagens', exact: true }).click();
      await page.getByRole('button', { name: 'Marcar todas exibidas' }).click();
      assert.equal(await page.locator('[data-ci-selecionar]:checked').count(), 2);
      assert.equal(await page.locator('[data-ci="excluir-selecao-todos"]').isDisabled(), true, 'mistura com recebida bloqueia apagar para todos');
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/chat-interno-selecao-${width}.png`) });
      page.once('dialog', (d) => d.accept());
      await page.locator('[data-ci="excluir-selecao-mim"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-msg]').length === 0);
      await page.evaluate(() => {
        // Mensagem antiga fora da tela: limpar deve alcançar o histórico todo.
        window.messages.push({ ...window.messages[1], id: 'antiga-fora-tela', sequencia: 4 });
      });
      await page.locator('.ci-menu-conversa summary').click();
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Limpar conversa (apagar tudo para mim)', exact: true }).click();
      await page.waitForFunction(() => window.userHidden.has('antiga-fora-tela'));
      assert.equal(await page.evaluate(() => window.messages.length), 4, 'limpeza não remove as cópias do colega');
    } finally { await page.close(); }
  });
}

test('selecionar só enviadas permite apagar várias para todos', async () => {
  const page = await abrir({ width: 390, height: 844 });
  try {
    await page.evaluate(() => {
      const nova = { ...window.messages[0], id: 'segunda-minha', sequencia: 3, texto: 'Segunda enviada' };
      window.messages.push(nova); window.handlers['chat:mensagem'](nova);
    });
    await page.locator('.ci-menu-conversa summary').click();
    await page.getByRole('button', { name: 'Selecionar mensagens', exact: true }).click();
    await page.locator('[data-ci-selecionar="minha"]').check();
    await page.locator('[data-ci-selecionar="segunda-minha"]').check();
    assert.equal(await page.locator('[data-ci="excluir-selecao-todos"]').isEnabled(), true);
    page.once('dialog', (d) => d.accept());
    await page.locator('[data-ci="excluir-selecao-todos"]').click();
    await page.waitForFunction(() => document.querySelector('[data-msg="minha"] .ci-texto').textContent === 'Mensagem apagada');
    assert.equal(await page.locator('[data-msg="segunda-minha"] .ci-texto').textContent(), 'Mensagem apagada');
    assert.equal(await page.locator('[data-msg="dele"] .ci-texto').textContent(), 'Resposta do colega');
  } finally { await page.close(); }
});

test('limpeza recebida em outra aba e respostas atrasadas não restauram mensagens; mensagens novas são preservadas', async () => {
  const page = await abrir({ width: 390, height: 844 });
  try {
    await page.locator('#ci-texto').fill('Continuar digitando');
    await page.locator('[data-msg="minha"] summary').click();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.locator('#ci-editar-texto').fill('Edição em andamento');
    await page.evaluate(() => {
      window.userHidden.add('minha');
      window.handlers['chat:mensagens-ocultas']({ conversaId: 'conversa', mensagemIds: ['minha'] });
      window.handlers['chat:mensagem-alterada']({ ...window.messages[0], texto: 'Resposta atrasada' });
      window.handlers['chat:mensagem']({ ...window.messages[0] });
    });
    assert.equal(await page.locator('[data-msg="minha"]').count(), 0);
    assert.equal(await page.locator('#ci-form-editar').count(), 0);
    assert.equal(await page.locator('#ci-texto').inputValue(), 'Continuar digitando');
    await page.evaluate(() => { window.delayClear = true; });
    await page.locator('.ci-menu-conversa summary').click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Limpar conversa (apagar tudo para mim)', exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseClear === 'function');
    await page.evaluate(() => {
      const nova = { ...window.messages[1], id: 'durante-limpeza', sequencia: 3, texto: 'Chegou depois de limpar' };
      window.messages.push(nova); window.handlers['chat:mensagem'](nova);
      window.releaseClear();
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-msg]').length === 1);
    assert.equal(await page.locator('[data-msg="durante-limpeza"] .ci-texto').textContent(), 'Chegou depois de limpar');
    await page.evaluate(() => window.handlers['chat:mensagem']({ ...window.messages[1] }));
    assert.equal(await page.locator('[data-msg="dele"]').count(), 0);
    assert.equal(await page.locator('#ci-texto').inputValue(), 'Continuar digitando');
  } finally { await page.close(); }
});

test('prévia antiga em consulta atrasada não volta após apagar para mim', async () => {
  const page = await abrir({ width: 390, height: 844 });
  try {
    await page.evaluate(() => {
      window.delayContactOnce = true;
      window.handlers['chat:mensagem-alterada']({ ...window.messages[0] });
    });
    await page.waitForFunction(() => typeof window.releaseContact === 'function');
    await page.locator('.ci-menu-conversa summary').click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Limpar conversa (apagar tudo para mim)', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-msg]').length === 0);
    await page.evaluate(() => window.releaseContact());
    await page.evaluate(() => { window.delayContactOnce = true; });
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    assert.equal(await page.locator('.ci-contato-sub').textContent(), 'Sem conversa ainda');
  } finally { await page.close(); }
});
