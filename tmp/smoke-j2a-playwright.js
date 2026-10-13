const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'http://127.0.0.1:4990';
const TOKEN = process.argv[2];
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
  page.on('response', resp => { if (resp.status() >= 400 && !resp.url().includes('/avaliacao/sugestao')) httpErrors.push([resp.url(), resp.status()]); });

  // Injeta o token ANTES de carregar a pagina (localStorage precisa existir no load)
  await page.addInitScript((token) => {
    window.localStorage.setItem('svc_token_externo', token);
  }, TOKEN);

  await page.goto(`${BASE_URL}/iaservice/j2a`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const view = await page.evaluate(() => document.getElementById('app')?.dataset.view);
  registrar('login_automatico_via_token', view === 'radar', `view=${view}`);
  await page.screenshot({ path: `${SCREEN_DIR}/j2a-01-radar-aberto.png`, fullPage: true });

  // Abrir o primeiro chamado da fila
  const primeiroTicket = page.locator('.ticket').first();
  const temTicket = await primeiroTicket.count() > 0;
  registrar('fila_tem_chamados', temTicket);
  if (!temTicket) {
    await browser.close();
    fs.writeFileSync(`${SCREEN_DIR}/j2a-resultados.json`, JSON.stringify(resultados, null, 2));
    return;
  }

  await primeiroTicket.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREEN_DIR}/j2a-02-chamado-aberto.png`, fullPage: true });

  const temMensagemAssistant = await page.locator('.message.assistant').count() > 0;
  registrar('mensagem_assistant_renderizada', temMensagemAssistant);

  if (temMensagemAssistant) {
    const linkAvaliar = page.locator('[data-avaliacao-abrir]').first();
    const temBotaoAvaliar = await linkAvaliar.count() > 0;
    registrar('botao_avaliar_presente', temBotaoAvaliar);

    if (temBotaoAvaliar) {
      await linkAvaliar.click();
      await page.waitForTimeout(500);
      const modalAtivo = await page.locator('#avaliacao-modal-backdrop.ativo').count() > 0;
      registrar('modal_abre', modalAtivo);
      await page.screenshot({ path: `${SCREEN_DIR}/j2a-03-modal-aberto.png`, fullPage: true });

      if (modalAtivo) {
        const campos = ['compreensaoProblema', 'aproveitamentoEvidencias', 'profundidadeTecnica', 'orientacaoPratica', 'confiabilidadeTecnica'];
        for (const campo of campos) {
          await page.locator(`#avaliacao-${campo}`).selectOption('4');
        }
        await page.locator('#avaliacao-observacoes').fill('Smoke test J2A automatizado.');
        await page.locator('#avaliacao-modal-salvar').click();
        await page.waitForTimeout(800);

        const modalFechado = await page.locator('#avaliacao-modal-backdrop.ativo').count() === 0;
        registrar('modal_fecha_apos_salvar', modalFechado);

        const resumoVisivel = await page.locator('.avaliacao-resumo').first().innerText().catch(() => null);
        registrar('resumo_avaliacao_aparece', !!resumoVisivel && resumoVisivel.includes('20/25'), `texto=${resumoVisivel}`);
        await page.screenshot({ path: `${SCREEN_DIR}/j2a-04-apos-salvar.png`, fullPage: true });
      }
    }
  }

  await browser.close();

  registrar('console_sem_erros_js', consoleErrors.length === 0, `erros=${JSON.stringify(consoleErrors.slice(0, 5))}`);
  registrar('http_sem_erros_4xx_5xx', httpErrors.length === 0, `erros=${JSON.stringify(httpErrors.slice(0, 10))}`);

  fs.writeFileSync(`${SCREEN_DIR}/j2a-resultados.json`, JSON.stringify(resultados, null, 2));
}

main().catch(err => { console.error(err); process.exitCode = 1; });
