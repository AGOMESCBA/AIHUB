// Valida badge "Pesquisando…" -> "Concluida" na fila do J2A, com API mockada
// (nenhuma chamada real de IA). Uso: node tmp/smoke-j2a-badge-concluida.js <token>
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:4993';
const TOKEN = process.argv[2];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const inicio = Date.now();
  let lerMensagensA = 0;

  await page.addInitScript((t) => localStorage.setItem('svc_token_externo', t), TOKEN);

  await page.route('**/radar/chamados/*/abrir-atendimento', (route) => {
    const url = route.request().url();
    const idChamado = decodeURIComponent(url.split('/radar/chamados/')[1].split('/')[0]);
    const primeiro = (global.__primeiroChamado = global.__primeiroChamado || idChamado);
    const ehA = idChamado === primeiro;
    route.fulfill({ json: { atendimentoId: ehA ? 'AT-A' : 'AT-B', reaberto: true, preAnaliseDisparada: ehA } });
  });
  await page.route('**/api/ia-service-externo/atendimentos/AT-A/mensagens', (route) => {
    lerMensagensA += 1;
    const chegou = Date.now() - inicio > 9000;
    route.fulfill({ json: chegou ? [{ id: 'm1', papel: 'assistant', conteudo: 'resposta', criadoEm: new Date().toISOString() }] : [] });
  });
  await page.route('**/api/ia-service-externo/atendimentos/AT-B/mensagens', (route) => route.fulfill({ json: [] }));
  for (const sufixo of ['anexos', 'dossie', 'investigacoes**', 'trilha**']) {
    await page.route(`**/atendimentos/AT-*/${sufixo}`, (route) => route.fulfill({ json: sufixo.startsWith('anexos') ? [] : {} }));
  }

  await page.goto(`${BASE_URL}/iaservice/j2a`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ticket');
  const tickets = page.locator('.ticket');
  const total = await tickets.count();
  if (total < 2) throw new Error('fila com menos de 2 chamados');

  const resultados = [];
  const checa = (nome, ok) => { resultados.push({ nome, ok }); console.log(`${ok ? 'OK ' : 'FALHA'} ${nome}`); };

  await tickets.nth(0).click();
  await page.waitForTimeout(1200);
  checa('A pesquisando: badge "Pesquisando…" aparece em A', await tickets.nth(0).locator('.badge', { hasText: 'Pesquisando' }).count() === 1);

  await tickets.nth(1).click();
  await page.waitForTimeout(1200);
  checa('B aberto: B sem badge', await tickets.nth(1).locator('.badge', { hasText: /Pesquisando|Conclu/ }).count() === 0);

  await page.waitForTimeout(11000);
  checa('A terminou fora da tela: badge "Concluída" em A', await tickets.nth(0).locator('.badge', { hasText: 'Concluída' }).count() === 1);
  checa('A nao esta mais "Pesquisando…"', await tickets.nth(0).locator('.badge', { hasText: 'Pesquisando' }).count() === 0);
  checa('B continua sem badge', await tickets.nth(1).locator('.badge', { hasText: /Pesquisando|Conclu/ }).count() === 0);

  await tickets.nth(0).click();
  await page.waitForTimeout(1200);
  checa('abrir A: badge "Concluída" some', await tickets.nth(0).locator('.badge', { hasText: 'Conclu' }).count() === 0);

  await browser.close();
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTODOS OK');
  process.exitCode = falhas.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
