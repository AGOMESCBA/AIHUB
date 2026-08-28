const path = require('path');
const { chromium } = require('playwright');

const root = process.cwd();
const outDir = path.join(root, 'tmp');

async function screenshotFile(page, relativeHtml, outputName) {
  const filePath = path.join(root, relativeHtml);
  await page.goto('file:///' + filePath.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, outputName), fullPage: true });
}

async function screenshotChatMock(page) {
  await page.addInitScript(() => {
    const json = (body) => Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    window.fetch = async (url) => {
      const alvo = String(url || '');
      if (alvo.includes('/api/ia-command/protheus/bootstrap')) {
        return json({
          empresaId: 5,
          empresas: [{ empresaId: 5, nome: '01 - Id 5 - PLANTIVO', codigoProtheus: '01' }],
          sessoes: [],
        });
      }
      if (alvo.includes('/api/ia-command/protheus/favoritos')) return json({ favoritos: [] });
      if (alvo.includes('/api/ia-command/protheus/filial-tree')) {
        return json({
          disponivel: true,
          empresas: [{
            empresaIahubId: 5,
            empresaProtheusCodigo: '01',
            nome: 'PLANTIVO',
            filiais: [
              { filialChave: '010101', nome: 'PLANTIVO CAMPO VERDE' },
              { filialChave: '010102', nome: 'Bahia' },
              { filialChave: '010103', nome: 'PLANTIVO CUIABA' },
            ],
          }],
          empresasSemConfiguracao: [],
        });
      }
      return json({});
    };
  });
  const filePath = path.join(root, 'apps/IA Command/modules/protheus_whatsapp/public/protheus-chat.html');
  await page.goto('file:///' + filePath.replace(/\\/g, '/') + '?token=mock-token&usuario=Alessandro', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, 'protheus-chat.png'), fullPage: true });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  await screenshotFile(page, 'apps/IA Command/modules/protheus_whatsapp/public/protheus-web-login.html', 'protheus-web-login.png');
  await screenshotChatMock(page);

  await browser.close();
  console.log('tmp/protheus-web-login.png');
  console.log('tmp/protheus-chat.png');
})();
