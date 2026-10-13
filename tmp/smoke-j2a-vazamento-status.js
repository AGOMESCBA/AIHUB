// Reproduz exatamente o bug relatado: abrir chamado A (dispara pre-analise
// automatica, "Aguardando pre-analise..." aparece), navegar para chamado B
// (sem pre-analise pendente) ANTES de A terminar, confirmar que B NAO mostra
// o indicador "vazado" de A.
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:4991';
const TOKEN = process.argv[2];
const SCREEN_DIR = 'C:/Users/aless/AppData/Local/Temp/claude/c--Apps-iahub/40f02e42-f232-48d2-961f-359f7e031637/scratchpad/homolog-avaliacao';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.addInitScript((token) => {
    window.localStorage.setItem('svc_token_externo', token);
  }, TOKEN);

  await page.goto(`${BASE_URL}/iaservice/j2a`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const tickets = page.locator('.ticket');
  const total = await tickets.count();
  console.log(`Total de chamados na fila: ${total}`);
  if (total < 2) {
    console.log('FALHA: precisa de pelo menos 2 chamados na fila para este teste.');
    await browser.close();
    return;
  }

  // Abre o 1o chamado (dispara pre-analise automatica, se ainda nao tinha resposta)
  await tickets.nth(0).click();
  await page.waitForTimeout(300); // pequeno delay -- NAO espera o suficiente para a pre-analise terminar (propositalmente)

  // Imediatamente abre o 2o chamado, ainda com a pre-analise do 1o rodando
  await tickets.nth(1).click();
  await page.waitForTimeout(500);

  const statusVisivelNoSegundo = await page.locator('#chat-status-row').count() > 0;
  const textoStatus = statusVisivelNoSegundo ? await page.locator('.chat-status-text').innerText().catch(() => '') : null;

  await page.screenshot({ path: `${SCREEN_DIR}/j2a-vazamento-teste.png`, fullPage: true });

  if (statusVisivelNoSegundo) {
    console.log(`FALHA: indicador "${textoStatus}" apareceu no 2o chamado, que nao deveria estar em processamento.`);
    process.exitCode = 1;
  } else {
    console.log('OK: 2o chamado nao mostra indicador de status vazado do 1o chamado.');
  }

  await browser.close();
}

main().catch(err => { console.error(err); process.exitCode = 1; });
