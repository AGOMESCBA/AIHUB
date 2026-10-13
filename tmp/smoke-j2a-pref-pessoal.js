const { chromium } = require('playwright');
const TOKEN = process.argv[2];
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('svc_token_externo', t), TOKEN);
    let estado = { pessoal: null, padrao: false };
    const resp = () => ({ consultorEncontrado: true, consultorId: 'c1', preAnaliseAutomatica: estado.pessoal === null ? estado.padrao : estado.pessoal, preAnalisePadrao: estado.padrao, preAnalisePessoal: estado.pessoal });
    const puts = [];
    await page.route('**/radar/minhas-preferencias', async (r) => {
      if (r.request().method() === 'PUT') {
        const b = r.request().postDataJSON(); puts.push(b.preAnaliseAutomatica);
        estado.pessoal = b.preAnaliseAutomatica;
      }
      r.fulfill({ json: resp() });
    });
    await page.goto('http://127.0.0.1:4993/iaservice/j2a', { waitUntil: 'networkidle' });
    await page.waitForSelector('#pre-analysis-toggle');
    const r = [];
    const chk = (n, ok) => { r.push(ok); console.log(`${ok ? 'OK   ' : 'FALHA'} ${n}`); };
    chk('padrao Manual: toggle desligado e sem aviso', !(await page.locator('#pre-analysis-toggle').isChecked()) && await page.locator('#pre-analysis-padrao').isHidden());
    await page.locator('#pre-analysis-toggle').evaluate((el) => el.click());
    await page.waitForTimeout(600);
    chk('liga no chat: grava true, mostra "Sua escolha" e botao', puts[0] === true && await page.locator('#pre-analysis-padrao').isVisible() && (await page.locator('#pre-analysis-padrao-texto').innerText()).includes('Manual'));
    await page.click('#pre-analysis-padrao-btn');
    await page.waitForTimeout(600);
    chk('Voltar ao padrao: envia null, desliga e esconde o aviso', puts[1] === null && !(await page.locator('#pre-analysis-toggle').isChecked()) && await page.locator('#pre-analysis-padrao').isHidden());
    process.exitCode = r.every(Boolean) ? 0 : 1;
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
