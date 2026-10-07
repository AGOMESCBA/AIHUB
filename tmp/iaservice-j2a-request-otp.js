const { chromium } = require('playwright');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'http://137.131.212.29:3000/iaservice/j2a';
const phone = '5565999875116';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const network = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/api/') || res.status() >= 400) network.push({ status: res.status(), url: u });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') network.push({ console: msg.text() });
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.fill('#phone-input', phone);
  await page.click('#request-code-btn');
  await page.waitForTimeout(5000);

  const codeVisible = await page.locator('#code-form').evaluate((el) => !el.hidden).catch(() => false);
  const statusText = await page.locator('#access-status').innerText().catch(() => '');
  const destination = await page.locator('#code-destination').innerText().catch(() => '');

  console.log(JSON.stringify({
    url: page.url(),
    codeVisible,
    statusText,
    destination,
    network,
  }, null, 2));
  await browser.close();
})();
