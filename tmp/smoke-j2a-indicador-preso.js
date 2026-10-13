// Reproduz: abrir o chamado #035988 (que JA TEM resposta da IA persistida
// no banco), confirmar se preAnaliseDisparada=false (nao deveria disparar
// polling) e se, ainda assim, o indicador aparece e fica preso.
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:4992';
const TOKEN = process.argv[2];
const SCREEN_DIR = 'C:/Users/aless/AppData/Local/Temp/claude/c--Apps-iahub/40f02e42-f232-48d2-961f-359f7e031637/scratchpad/homolog-avaliacao';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const respostasAbrirAtendimento = [];
  page.on('response', async (resp) => {
    if (resp.url().includes('/abrir-atendimento')) {
      try {
        const body = await resp.json();
        respostasAbrirAtendimento.push({ url: resp.url(), body });
      } catch (_) {}
    }
  });

  await page.addInitScript((token) => {
    window.localStorage.setItem('svc_token_externo', token);
  }, TOKEN);

  await page.goto(`${BASE_URL}/iaservice/j2a`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Procura o item da fila com #035988 (ja tem resposta persistida)
  const ticket = page.locator('.ticket', { hasText: '#035988' }).first();
  const existe = await ticket.count() > 0;
  console.log(`Chamado #035988 encontrado na fila: ${existe}`);
  if (!existe) {
    console.log('FALHA: nao achou o chamado #035988 na fila deste ambiente de teste.');
    await browser.close();
    return;
  }

  await ticket.click();
  await page.waitForTimeout(2000);

  console.log('Respostas de abrir-atendimento capturadas:', JSON.stringify(respostasAbrirAtendimento, null, 2));

  const temMensagemAssistant = await page.locator('.message.assistant').count() > 0;
  console.log(`Mensagem assistant ja visivel: ${temMensagemAssistant}`);

  const statusVisivel = await page.locator('#chat-status-row').count() > 0;
  const textoStatus = statusVisivel ? await page.locator('.chat-status-text').innerText().catch(() => '') : null;
  console.log(`Indicador de status visivel: ${statusVisivel} (texto: ${textoStatus})`);

  await page.screenshot({ path: `${SCREEN_DIR}/j2a-indicador-preso-teste.png`, fullPage: true });

  await browser.close();
}

main().catch(err => { console.error(err); process.exitCode = 1; });
