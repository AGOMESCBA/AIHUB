// Reproduz: re-login na MESMA aba deixa a conversa antiga visivel mesmo com a
// mensagem ja apagada no servidor. Uso: node tmp/smoke-j2a-relogin-dom.js <token>
const { chromium } = require('playwright');
const BASE_URL = 'http://127.0.0.1:4993';
const TOKEN = process.argv[2];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript((t) => { if (!localStorage.getItem('svc_token_externo')) localStorage.setItem('svc_token_externo', t); }, TOKEN);

  let mensagensAtivas = true;
  let filaExpirada = false;
  await page.route('**/radar/chamados/*/abrir-atendimento', (r) => r.fulfill({ json: { atendimentoId: 'AT-A', reaberto: true, preAnaliseDisparada: false } }));
  await page.route('**/atendimentos/AT-A/mensagens', (r) => r.fulfill({
    json: mensagensAtivas ? [{ id: 'm1', papel: 'assistant', conteudo: 'RESPOSTA ANTIGA DA IA', criadoEm: new Date().toISOString() }] : [],
  }));
  for (const s of ['anexos', 'dossie', 'investigacoes**', 'trilha**']) {
    await page.route(`**/atendimentos/AT-A/${s}`, (r) => r.fulfill({ json: s === 'anexos' ? [] : {} }));
  }
  await page.route('**/radar/fila**', (r) => (filaExpirada ? r.fulfill({ status: 401, json: { error: 'expirada' } }) : r.continue()));
  await page.route('**/api/ia-service-publico/login/iniciar', (r) => r.fulfill({ json: { challengeId: 'c1', destino: '+55 (65) 9****-0000' } }));
  await page.route('**/api/ia-service-publico/login/verificar', (r) => r.fulfill({ json: { token: TOKEN } }));

  await page.goto(`${BASE_URL}/iaservice/j2a`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ticket');
  await page.locator('.ticket').first().click();
  await page.waitForSelector('text=RESPOSTA ANTIGA DA IA');
  console.log('1) conversa aberta com a resposta antiga: ok');

  // mensagens apagadas no servidor + sessao expira (401 em chamada seguinte)
  mensagensAtivas = false;
  filaExpirada = true;
  await page.click('.account-summary'); await page.click('#logout-btn');
  await page.waitForSelector('#access-screen:not([hidden])');
  console.log('2) sessao expirada -> tela de login: ok');

  filaExpirada = false;
  await page.fill('#phone-input', '65999990000');
  await page.click('#request-code-btn');
  await page.waitForSelector('#code-form:not([hidden])');
  const inputs = page.locator('#code-row input');
  for (let i = 0; i < 6; i += 1) await inputs.nth(i).fill(String(i + 1));
  await page.click('#verify-code-btn');
  await page.waitForSelector('#radar-screen:not([hidden])');
  await page.waitForTimeout(1500);

  const textoMensagens = await page.locator('#messages').innerText();
  const caseVisivel = await page.locator('#case-view').isVisible();
  const stale = textoMensagens.includes('RESPOSTA ANTIGA DA IA');
  console.log(`3) apos re-login: case-view visivel=${caseVisivel}, resposta antiga ainda na tela=${stale}`);
  console.log(stale || caseVisivel ? 'RESULTADO: BUG PRESENTE (tela antiga sobrevive ao login)' : 'RESULTADO: OK (tela limpa apos login)');
  await browser.close();
  process.exitCode = stale || caseVisivel ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
