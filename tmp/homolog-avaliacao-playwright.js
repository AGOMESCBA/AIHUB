const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'http://127.0.0.1:4987';
const ATENDIMENTO_ID = '9b71a00a-ffb7-4d90-ac8b-24a64815469b'; // AI-000835, empresa 1
const SCREEN_DIR = 'C:/Users/aless/AppData/Local/Temp/claude/c--Apps-iahub/40f02e42-f232-48d2-961f-359f7e031637/scratchpad/homolog-avaliacao';

const resultados = {};
const consoleErrors = [];
const httpErrors = [];

function registrar(nome, ok, detalhe = '') {
  resultados[nome] = { ok, detalhe };
  console.log(`[${ok ? 'OK' : 'FALHA'}] ${nome}${detalhe ? ' - ' + detalhe : ''}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', resp => { if (resp.status() >= 400) httpErrors.push([resp.url(), resp.status()]); });

  // 1) Abrir atendimento
  await page.goto(`${BASE_URL}/app/ia-service/atendimento.html?id=${ATENDIMENTO_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const tituloVisivel = await page.locator('#topbar-codigo').innerText();
  registrar('abrir_atendimento', tituloVisivel.includes('AI-000835'), `topbar=${tituloVisivel}`);
  await page.screenshot({ path: `${SCREEN_DIR}/01-atendimento-aberto.png`, fullPage: true });

  // 2) Localizar o link "Avaliar investigação"
  const linkAvaliar = page.locator('button.avaliacao-link', { hasText: 'Avaliar investigação' }).first();
  const existeLink = await linkAvaliar.count() > 0;
  registrar('botao_avaliar_presente', existeLink);
  if (!existeLink) {
    await page.screenshot({ path: `${SCREEN_DIR}/02-ERRO-sem-botao.png`, fullPage: true });
    await browser.close();
    salvarResultados();
    return;
  }

  await linkAvaliar.click();
  await page.waitForTimeout(300);
  const modalVisivel = await page.locator('#avaliacao-modal-backdrop.ativo').count() > 0;
  registrar('modal_abre', modalVisivel);
  await page.screenshot({ path: `${SCREEN_DIR}/02-modal-aberto.png`, fullPage: true });

  // 3) Preencher as 5 notas, observações e checkbox, salvar
  const campos = [
    'avaliacao-compreensaoProblema',
    'avaliacao-aproveitamentoEvidencias',
    'avaliacao-profundidadeTecnica',
    'avaliacao-orientacaoPratica',
    'avaliacao-confiabilidadeTecnica',
  ];
  const valores1 = [4, 4, 3, 4, 2];
  for (let i = 0; i < campos.length; i++) {
    await page.locator(`#${campos[i]}`).selectOption(String(valores1[i]));
  }
  await page.locator('#avaliacao-observacoes').fill('Homologação funcional automatizada - 1a avaliação.');
  await page.locator('#avaliacao-erro-critico').check();
  await page.locator('button.avaliacao-salvar').click();
  await page.waitForTimeout(600);

  const cardDepoisSalvar = await page.locator('div.ficha-operacional-avaliacao').first().innerText();
  const somaEsperada1 = valores1.reduce((a, b) => a + b, 0);
  const salvouOk = cardDepoisSalvar.includes(String(somaEsperada1));
  registrar('salvar_avaliacao', salvouOk, `card=${JSON.stringify(cardDepoisSalvar)} somaEsperada=${somaEsperada1}`);
  await page.screenshot({ path: `${SCREEN_DIR}/03-apos-salvar.png`, fullPage: true });

  // 4) Reabrir (reload) e confirmar persistencia
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const cardAposReload = await page.locator('div.ficha-operacional-avaliacao').first().innerText();
  const persistiu = cardAposReload.includes(String(somaEsperada1));
  registrar('persistencia_apos_reload', persistiu, `card=${JSON.stringify(cardAposReload)}`);
  await page.screenshot({ path: `${SCREEN_DIR}/04-apos-reload.png`, fullPage: true });

  // 5) Editar avaliação
  const linkEditar = page.locator('button.avaliacao-link', { hasText: 'editar' }).first();
  const temEditar = await linkEditar.count() > 0;
  registrar('botao_editar_presente', temEditar);
  if (temEditar) {
    await linkEditar.click();
    await page.waitForTimeout(300);

    const valorPrePopulado = await page.locator(`#${campos[0]}`).inputValue();
    const prePopuladoOk = valorPrePopulado === String(valores1[0]);
    registrar('pre_populacao_modal_edicao', prePopuladoOk, `valor=${valorPrePopulado}`);

    const valores2 = [5, 5, 5, 5, 5];
    for (let i = 0; i < campos.length; i++) {
      await page.locator(`#${campos[i]}`).selectOption(String(valores2[i]));
    }
    await page.locator('#avaliacao-observacoes').fill('Homologação funcional automatizada - 2a avaliação (editada).');
    await page.locator('#avaliacao-erro-critico').uncheck();
    await page.locator('button.avaliacao-salvar').click();
    await page.waitForTimeout(600);

    const somaEsperada2 = valores2.reduce((a, b) => a + b, 0);
    const cardAposEdicao = await page.locator('div.ficha-operacional-avaliacao').first().innerText();
    const edicaoOk = cardAposEdicao.includes(String(somaEsperada2)) && cardAposEdicao.includes('Excelente');
    registrar('editar_avaliacao', edicaoOk, `card=${JSON.stringify(cardAposEdicao)}`);
    await page.screenshot({ path: `${SCREEN_DIR}/05-apos-editar.png`, fullPage: true });
  }

  // 6) Consultar relatório de homologação
  await page.goto(`${BASE_URL}/app/ia-service/homologacao.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const totalTexto = await page.locator('#resumo-total').innerText();
  const mediaTexto = await page.locator('#resumo-media').innerText();
  const faixasTexto = await page.locator('#resumo-faixas').innerText();
  const relatorioCarregou = totalTexto.trim() !== '' && totalTexto.trim() !== '—' && mediaTexto.trim() !== '' && mediaTexto.trim() !== '—';
  registrar('relatorio_carrega', relatorioCarregou, `total=${totalTexto} media=${mediaTexto} faixas=${JSON.stringify(faixasTexto)}`);
  await page.screenshot({ path: `${SCREEN_DIR}/06-relatorio-homologacao.png`, fullPage: true });

  const listaErroCritico = await page.locator('#lista-erro-critico').innerText();
  registrar(
    'relatorio_reflete_estado_atual_erro_critico',
    listaErroCritico.includes('Nenhum') || !listaErroCritico.includes(ATENDIMENTO_ID),
    `conteudo=${listaErroCritico.slice(0, 200)}`
  );

  await browser.close();

  registrar('console_sem_erros_js', consoleErrors.length === 0, `erros=${JSON.stringify(consoleErrors.slice(0, 5))}`);
  registrar('http_sem_erros_4xx_5xx', httpErrors.length === 0, `erros=${JSON.stringify(httpErrors.slice(0, 10))}`);

  salvarResultados();
}

function salvarResultados() {
  fs.writeFileSync(`${SCREEN_DIR}/resultados.json`, JSON.stringify(resultados, null, 2), 'utf-8');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
