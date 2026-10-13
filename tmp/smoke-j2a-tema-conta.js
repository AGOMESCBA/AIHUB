const { chromium } = require('playwright');
const TOKEN = process.argv[2];
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 800 } });
    await page.addInitScript((t) => { if (!sessionStorage.getItem('i')) { localStorage.setItem('svc_token_externo', t); localStorage.removeItem('iaservice_j2a_theme'); sessionStorage.setItem('i', '1'); } }, TOKEN);
    await page.goto('http://127.0.0.1:4993/iaservice/j2a', { waitUntil: 'networkidle' });
    await page.waitForSelector('.account-summary');
    await page.click('.account-summary');
    const opcoes = await page.locator('.account-panel [data-theme-option]').count();
    const visiveis = await page.locator('.account-panel [data-theme-option]:visible').count();
    console.log(`opcoes=${opcoes} visiveis=${visiveis}`);
    await page.screenshot({ path: 'tmp/tema-conta.png', clip: { x: 1100, y: 0, width: 400, height: 380 } });
    await page.click('[data-theme-option="dark"]');
    const dark = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('[data-theme-option="light"]');
    const light = await page.evaluate(() => document.documentElement.dataset.theme);
    const ativo = await page.locator('.account-panel [data-theme-option].active').getAttribute('data-theme-option');
    const ok = visiveis === 3 && dark === 'dark' && light === 'light' && ativo === 'light';
    console.log(ok ? 'OK: 3 opcoes visiveis e aplicam o tema' : `FALHA dark=${dark} light=${light} ativo=${ativo}`);
    process.exitCode = ok ? 0 : 1;
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
