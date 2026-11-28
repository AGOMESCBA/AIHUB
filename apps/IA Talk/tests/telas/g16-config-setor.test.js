'use strict';

// G16 (Antigravity) — testes em Playwright para configuração Onda 1 do setor (frontend/setores.html, §9.3–9.7)
// e menu de setores nas regras do canal (frontend/canais.html, §9.3), contra o servidor simulado:
//   - setores.html: salvar cada um dos 5 blocos (enviando só o bloco alterado), "Tempo para aceitar"
//     visível apenas no Rodízio, erro 400 destacando a seção certa (ex.: distribuicao com limite 0) e
//     rolando até ela, conflito 409 de versão sem sobrescrever, modo somente leitura e zero overflow (1440/390);
//   - canais.html: campos menu_*, prévia na ordem certa (ordem + nome), avisos de compartilhado,
//     um setor só e nenhum setor, PUT /canais/:id, erro 400 em campo, somente leitura fora da plataforma
//     e zero overflow (1440/390).

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
});

async function criarAmbiente() {
  const sim = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000, intervaloConversaMs: 0 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  return { sim, baseUrl: `http://127.0.0.1:${addr.port}/app/ia-talk` };
}

async function novaPagina(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  return { ctx, page, erros };
}

test('G16 setores.html: salvar cada bloco isoladamente, Tempo para aceitar só no Rodízio, prévia da pesquisa e zero overflow 1440/390', async () => {
  const { sim, baseUrl } = await criarAmbiente();
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    const payloadsPut = [];
    await page.route('**/api/admin/setores/set_financeiro*', async (route) => {
      if (route.request().method() === 'PUT') {
        payloadsPut.push(route.request().postDataJSON());
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/setores.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-setores .g14-card');

    // Novo setor: pesquisa nasce desligada + prévia padrão
    await page.click('#btn-novo-setor');
    await page.waitForSelector('#vista-setor:not([hidden])');
    assert.equal(await page.isChecked('#s-pesq-ligada'), false, 'Pesquisa deve nascer desligada');
    assert.match(await page.textContent('#previa-pesquisa-whatsapp'), /Como você avalia este atendimento/);
    assert.match(await page.textContent('#secao-alertas'), /0 = não escalona/);
    assert.match(await page.textContent('#secao-alertas'), /supervisão do setor/);
    await page.click('#btn-voltar-setor');

    // 1. Bloco menu: abre Financeiro (fila_livre), confere placeholder do texto da opção e salva só { versao, menu }
    await page.click('[data-editar-setor="set_financeiro"]');
    await page.waitForSelector('#vista-setor:not([hidden])');
    assert.match(await page.getAttribute('#s-menu-texto', 'placeholder'), /Financeiro/);
    assert.equal(await page.isVisible('#campo-dist-tempo'), false, 'Tempo para aceitar fica oculto em Fila livre');

    await page.fill('#s-menu-ordem', '5');
    await page.fill('#s-menu-texto', 'Financeiro e Boletos');
    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#vista-principal:not([hidden])');
    assert.deepEqual(Object.keys(payloadsPut[0]).sort(), ['menu', 'versao']);
    assert.deepEqual(payloadsPut[0].menu, { aparece: true, ordem: 5, texto: 'Financeiro e Boletos' });

    // 2. Bloco distribuicao: "Tempo para aceitar" aparece ao marcar Rodízio e salva só { versao, distribuicao }
    await page.click('[data-editar-setor="set_financeiro"]');
    await page.waitForSelector('#vista-setor:not([hidden])');
    await page.check('#s-dist-rodizio');
    assert.equal(await page.isVisible('#campo-dist-tempo'), true, 'Tempo para aceitar deve aparecer no Rodízio');
    await page.fill('#s-dist-limite', '8');
    await page.fill('#s-dist-tempo', '4');
    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#vista-principal:not([hidden])');
    assert.deepEqual(Object.keys(payloadsPut[1]).sort(), ['distribuicao', 'versao']);
    assert.deepEqual(payloadsPut[1].distribuicao, { modo: 'rodizio', limite_por_atendente: 8, tempo_aceite_min: 4 });

    // 3. Bloco alertas: salva só { versao, alertas }
    await page.click('[data-editar-setor="set_financeiro"]');
    await page.waitForSelector('#vista-setor:not([hidden])');
    await page.check('#s-alr-whatsapp');
    await page.fill('#s-alr-espera', '7');
    await page.fill('#s-alr-escalonar', '20');
    await page.locator('#lista-escalonar-para input[type="checkbox"]').first().check();
    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#vista-principal:not([hidden])');
    assert.deepEqual(Object.keys(payloadsPut[2]).sort(), ['alertas', 'versao']);
    assert.equal(payloadsPut[2].alertas.whatsapp_ligado, true);
    assert.equal(payloadsPut[2].alertas.espera_min, 7);
    assert.equal(payloadsPut[2].alertas.escalonar_min, 20);
    assert.equal(payloadsPut[2].alertas.escalonar_para.length, 1);

    // 4. Bloco sla: salva só { versao, sla }
    await page.click('[data-editar-setor="set_financeiro"]');
    await page.waitForSelector('#vista-setor:not([hidden])');
    await page.fill('#s-sla-prazo', '15');
    await page.fill('#s-sla-atencao', '85');
    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#vista-principal:not([hidden])');
    assert.deepEqual(Object.keys(payloadsPut[3]).sort(), ['sla', 'versao']);
    assert.deepEqual(payloadsPut[3].sla, { primeira_resposta_min: 15, atencao_pct: 85 });

    // 5. Bloco pesquisa: liga, atualiza prévia em tempo real e salva só { versao, pesquisa }
    await page.click('[data-editar-setor="set_financeiro"]');
    await page.waitForSelector('#vista-setor:not([hidden])');
    await page.check('#s-pesq-ligada');
    await page.fill('#s-pesq-pergunta', 'De 1 a 5, como foi o atendimento do Financeiro?');
    assert.equal(await page.textContent('#previa-pesquisa-whatsapp'), 'De 1 a 5, como foi o atendimento do Financeiro?');

    // Zero rolagem horizontal no editor completo em 1440 e 390 px
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal no editor G16 em ${w}px: ${med.sw} > ${med.iw}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#vista-principal:not([hidden])');
    assert.deepEqual(Object.keys(payloadsPut[4]).sort(), ['pesquisa', 'versao']);
    assert.deepEqual(payloadsPut[4].pesquisa, { ligada: true, pergunta: 'De 1 a 5, como foi o atendimento do Financeiro?' });

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
    await sim.fechar();
  }
});

test('G16 setores.html: erro 400 destaca e rola até a seção certa; conflito 409 avisa sem sobrescrever; modo somente leitura', async () => {
  const { sim, baseUrl } = await criarAmbiente();
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/setores.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-setores .g14-card');

    // 1. Erro 400 na seção distribuicao (limite_por_atendente = 0)
    await page.click('[data-editar-setor="set_comercial"]');
    await page.waitForSelector('#vista-setor:not([hidden])');
    await page.fill('#s-dist-limite', '0');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#btn-salvar-setor');

    await page.waitForSelector('#erro-secao-distribuicao:not([hidden])');
    assert.equal(await page.locator('#secao-distribuicao').evaluate((el) => el.classList.contains('g16-secao--erro')), true);
    assert.match(await page.textContent('#erro-secao-distribuicao'), /limite por atendente de 1 a 50/i);

    // Corrige limite para 5 e provoca conflito 409 alterando a versão no servidor em paralelo
    await page.fill('#s-dist-limite', '5');
    await page.fill('#s-sla-prazo', '25');
    const statusParalelo = await page.evaluate(async () => {
      const s = await fetch('/app/ia-talk/api/admin/setores/set_comercial').then((r) => r.json());
      const r = await fetch('/app/ia-talk/api/admin/setores/set_comercial', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versao: s.versao, sla: { primeira_resposta_min: 18, atencao_pct: 80 } }),
      });
      return r.status;
    });
    assert.equal(statusParalelo, 200);

    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#alerta-setor:not([hidden])');
    assert.equal(
      (await page.textContent('#alerta-setor-texto')).trim(),
      'Outra pessoa alterou este setor. Recarregue para ver a versão atual.'
    );
    assert.equal(await page.isVisible('#btn-recarregar-setor'), true);

    // Confirma que NÃO sobrescreveu o 18 salvo pela outra sessão e que Recarregar traz o 18
    await page.click('#btn-recarregar-setor');
    await page.waitForFunction(() => document.getElementById('s-sla-prazo')?.value === '18');
    assert.equal(await page.inputValue('#s-sla-prazo'), '18');

    // 3. Modo somente leitura (?simular=atendente, sem talk-setores)
    await page.goto(`${baseUrl}/setores.html?simular=atendente`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#aviso-somente-leitura:not([hidden])');
    assert.equal(await page.isVisible('#btn-novo-setor'), false);
    assert.equal(await page.locator('[data-pedir-inativar-setor]').count(), 0);

    await page.click('[data-editar-setor="set_suporte"]');
    await page.waitForSelector('#vista-setor:not([hidden])');
    assert.equal(await page.isVisible('#btn-salvar-setor'), false);
    assert.equal(await page.isDisabled('#s-nome'), true);
    assert.equal(await page.isDisabled('#s-menu-ordem'), true);
    assert.equal(await page.isDisabled('#s-dist-limite'), true);
    assert.equal(await page.isDisabled('#s-pesq-ligada'), true);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
    await sim.fechar();
  }
});

test('G16 canais.html: menu de setores, prévia ordenada, avisos (compartilhado, 1 setor, 0 setores), PUT, 400 e zero overflow 1440/390', async () => {
  const { sim, baseUrl } = await criarAmbiente();
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    // Configura ordens e rótulos nos 3 setores para validar ordenação (ordem asc, depois nome pt-BR)
    await page.goto(`${baseUrl}/canais.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const ajustar = async (id, menu) => {
        const s = await fetch(`/app/ia-talk/api/admin/setores/${id}`).then((r) => r.json());
        await fetch(`/app/ia-talk/api/admin/setores/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versao: s.versao, menu }),
        });
      };
      // Comercial e Financeiro empatam em ordem 1 -> Comercial vem antes de Financeiro pelo nome; Suporte ordem 2 com texto customizado
      await ajustar('set_suporte', { aparece: true, ordem: 2, texto: 'Suporte Técnico ERP' });
      await ajustar('set_financeiro', { aparece: true, ordem: 1, texto: null });
      await ajustar('set_comercial', { aparece: true, ordem: 1, texto: null });
    });

    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-menu-canal:not([hidden])');

    // Uso inicial é 'compartilhado': aviso específico visível, 0/1 setor ocultos
    assert.equal(await page.isVisible('#r-menu-aviso-compartilhado'), true);
    assert.equal(
      (await page.textContent('#r-menu-aviso-compartilhado')).trim(),
      "O menu só é enviado depois que a pessoa pedir 'atendente' ao assistente."
    );
    assert.equal(await page.isVisible('#r-menu-aviso-um'), false);
    assert.equal(await page.isVisible('#r-menu-aviso-zero'), false);

    // Prévia exata na ordem certa: Comercial (ordem 1), Financeiro (ordem 1), Suporte Técnico ERP (ordem 2)
    const previaEsperada = [
      'Olá! Para agilizar seu atendimento, escolha o setor:',
      '1 – Comercial',
      '2 – Financeiro',
      '3 – Suporte Técnico ERP',
      'Responda com o número da opção.',
    ].join('\n');
    assert.equal((await page.textContent('#r-menu-previa')).trim(), previaEsperada);

    // Esconde todo o bloco do menu quando uso = 'integracao'
    await page.selectOption('#r-uso', 'integracao');
    assert.equal(await page.isVisible('#bloco-menu-canal'), false);
    await page.selectOption('#r-uso', 'atendimento');
    assert.equal(await page.isVisible('#bloco-menu-canal'), true);
    assert.equal(await page.isVisible('#r-menu-aviso-compartilhado'), false);

    // Erro 400 em campo do menu (menu_tempo_min = 0 -> fora de 1..60)
    await page.check('#r-menu-ligado');
    await page.fill('#r-menu-tempo', '0');
    await page.click('#btn-salvar-regras');
    await page.waitForSelector('#erro-menu_tempo_min');
    assert.match(await page.textContent('#erro-menu_tempo_min'), /1 a 60/i);

    // Salva válido com saudação personalizada, tempo 12 e tentativas 3
    await page.fill('#r-menu-saudacao', 'Bem-vindo à J2A! Escolha uma opção:');
    await page.fill('#r-menu-tempo', '12');
    await page.fill('#r-menu-tentativas', '3');
    await page.selectOption('#r-uso', 'compartilhado');
    await page.click('#btn-salvar-regras');
    await page.waitForFunction(() => document.querySelector('.tlk-toast--ok')?.textContent?.includes('Regras do canal salvas'));

    // Recarrega e confirma valores lidos de canal.atendimento.menu
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-menu-canal:not([hidden])');
    assert.equal(await page.isChecked('#r-menu-ligado'), true);
    assert.equal(await page.inputValue('#r-menu-saudacao'), 'Bem-vindo à J2A! Escolha uma opção:');
    assert.equal(await page.inputValue('#r-menu-tempo'), '12');
    assert.equal(await page.inputValue('#r-menu-tentativas'), '3');

    // Aviso com UM setor só no menu
    await page.evaluate(async () => {
      for (const id of ['set_financeiro', 'set_comercial']) {
        const s = await fetch(`/app/ia-talk/api/admin/setores/${id}`).then((r) => r.json());
        await fetch(`/app/ia-talk/api/admin/setores/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versao: s.versao, menu: { ...s.menu, aparece: false } }),
        });
      }
    });
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#r-menu-aviso-um:not([hidden])');
    assert.equal(
      (await page.textContent('#r-menu-aviso-um')).trim(),
      'Com um setor só, o menu não é enviado: a conversa vai direto para ele.'
    );
    assert.equal(await page.isVisible('#r-menu-aviso-zero'), false);

    // Aviso com NENHUM setor no menu
    await page.evaluate(async () => {
      const s = await fetch('/app/ia-talk/api/admin/setores/set_suporte').then((r) => r.json());
      await fetch('/app/ia-talk/api/admin/setores/set_suporte', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versao: s.versao, menu: { ...s.menu, aparece: false } }),
      });
    });
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#r-menu-aviso-zero:not([hidden])');
    assert.equal(
      (await page.textContent('#r-menu-aviso-zero')).trim(),
      'Nenhum setor aparece no menu. As conversas vão para o setor padrão.'
    );
    assert.equal(await page.isVisible('#r-menu-aviso-um'), false);

    // Zero rolagem horizontal em 1440 e 390 px
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal em canais.html (menu) em ${w}px: ${med.sw} > ${med.iw}`);
    }

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
    await sim.fechar();
  }
});
