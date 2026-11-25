// node --test tests/parametros-empresa.test.js
// Parâmetros por Empresa (IAHub, 2026-11-25): catálogo autoexplicativo,
// validação por tipo, obrigatórios com o canal ligado, segredo cifrado e nunca
// devolvido, histórico com usuário, reserva de alertas (e-mail/Telegram) com
// ordem, regra de quando usar e o Telegram do .env como última reserva.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

// Banco da Platform temporário (o real tem caminho fixo e nunca é tocado aqui).
const dbTmp = new Database(path.join(os.tmpdir(), `iahub-param-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
const caminhoPlatform = require.resolve('../apps/IAHUB/backend/platform-store');
require.cache[caminhoPlatform] = { id: caminhoPlatform, filename: caminhoPlatform, loaded: true, exports: { getDB: () => dbTmp } };

// SMTP simulado.
const emails = [];
let falharEmail = null;
const caminhoMailer = require.resolve('nodemailer');
require.cache[caminhoMailer] = {
  id: caminhoMailer, filename: caminhoMailer, loaded: true,
  exports: { createTransport: (opcoes) => ({ sendMail: async (m) => { if (falharEmail) throw new Error(falharEmail); emails.push({ opcoes, m }); }, close() {} }) },
};
// Telegram simulado.
const telegramas = [];
let falharTelegram = false;
global.fetch = async (url, opts) => {
  if (String(url).includes('api.telegram.org')) {
    if (falharTelegram) return { ok: false, status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) };
    telegramas.push({ url: String(url), corpo: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  throw new Error('rede bloqueada no teste');
};

const store = require('../apps/IAHUB/backend/parametros/store');
const reserva = require('../apps/IAHUB/backend/parametros/alertas-reserva');
const catalogo = require('../apps/IAHUB/backend/parametros/catalogo');

const EMP = 7;
const TOKEN = '123456789:AAHk-exemploDoTokenDoBot_1234567890';
const emailOk = {
  'alertas.email.ativo': true, 'alertas.email.smtp_host': 'smtp.gmail.com', 'alertas.email.smtp_porta': 587,
  'alertas.email.seguranca': 'starttls', 'alertas.email.usuario': 'alertas@empresa.com.br', 'alertas.email.senha': 'senha-de-app',
  'alertas.email.destinatarios': 'ti@empresa.com.br, Plantao@empresa.com.br',
};

beforeEach(() => {
  try { dbTmp.exec('DELETE FROM platform_parametros; DELETE FROM platform_parametros_historico;'); } catch (_) { /* tabelas ainda não criadas */ }
  emails.length = 0;
  telegramas.length = 0;
  falharEmail = null;
  falharTelegram = false;
  delete process.env.IAC_TELEGRAM_BOT_TOKEN;
  delete process.env.IAC_TELEGRAM_ALERT_CHAT_ID;
});

test('catálogo: todo parâmetro se explica (título, descrição, tipo, padrão; opções com significado)', () => {
  const tipos = new Set(['booleano', 'texto', 'numero', 'opcoes', 'segredo', 'emails']);
  const chaves = new Set();
  for (const p of catalogo.PARAMETROS) {
    assert.ok(!chaves.has(p.chave), `chave repetida: ${p.chave}`);
    chaves.add(p.chave);
    assert.ok(tipos.has(p.tipo), `${p.chave}: tipo`);
    assert.ok(p.titulo && p.descricao && p.descricao.length > 30, `${p.chave}: explicação`);
    assert.ok('padrao' in p, `${p.chave}: padrão`);
    assert.ok(catalogo.GRUPOS.some(g => g.id === p.grupo && g.secoes.some(s => s.id === p.secao)), `${p.chave}: grupo/seção`);
    for (const o of p.opcoes || []) assert.ok(o.rotulo && o.significado, `${p.chave}: opção sem significado`);
    if (p.tipo === 'opcoes') assert.ok(p.opcoes.some(o => o.valor === p.padrao), `${p.chave}: padrão fora das opções`);
    if (p.exigeQuando) assert.equal(catalogo.definicao(p.exigeQuando)?.tipo, 'booleano', `${p.chave}: exigeQuando`);
  }
});

test('tela: valores padrão; segredo nunca volta, só "definido"', () => {
  let t = store.paraTela(EMP);
  const senha = t.parametros.find(p => p.chave === 'alertas.email.senha');
  assert.equal(senha.valor, null);
  assert.equal(senha.definido, false);
  assert.equal(t.parametros.find(p => p.chave === 'alertas.reserva.quando').valor, 'falha_whatsapp');
  assert.ok(t.parametros.every(p => typeof p.validar === 'undefined'), 'função de validação não vai para a tela');
  store.salvar(EMP, { alteracoes: emailOk }, { usuario: 'ana' });
  t = store.paraTela(EMP);
  const s2 = t.parametros.find(p => p.chave === 'alertas.email.senha');
  assert.equal(s2.valor, null);
  assert.equal(s2.definido, true);
  assert.ok(!JSON.stringify(t).includes('senha-de-app'));
});

test('segredo gravado cifrado no banco e lido decifrado só por dentro', () => {
  store.salvar(EMP, { alteracoes: emailOk }, { usuario: 'ana' });
  const bruto = dbTmp.prepare("SELECT valor FROM platform_parametros WHERE chave = 'alertas.email.senha'").get().valor;
  assert.match(bruto, /^iahub-aes-gcm:/);
  assert.ok(!bruto.includes('senha-de-app'));
  assert.equal(store.valores(EMP)['alertas.email.senha'], 'senha-de-app');
  // Em branco mantém o atual.
  store.salvar(EMP, { alteracoes: { 'alertas.email.senha': '' } }, { usuario: 'ana' });
  assert.equal(store.valores(EMP)['alertas.email.senha'], 'senha-de-app');
});

test('validação por tipo: com qualquer erro nada é salvo e cada campo diz o problema', () => {
  assert.throws(() => store.salvar(EMP, { alteracoes: {
    'alertas.email.smtp_host': 'http://smtp.gmail.com:587',
    'alertas.email.smtp_porta': 70000,
    'alertas.email.seguranca': 'qualquer',
    'alertas.email.destinatarios': 'ok@a.com, ruim@',
    'alertas.telegram.chat_id': 'abc',
    'alertas.telegram.token': 'curto',
    'nao.existe': 1,
  } }, { usuario: 'ana' }), (e) => {
    assert.equal(e.status, 400);
    for (const c of ['alertas.email.smtp_host', 'alertas.email.smtp_porta', 'alertas.email.seguranca', 'alertas.email.destinatarios', 'alertas.telegram.chat_id', 'alertas.telegram.token', 'nao.existe']) {
      assert.ok(e.erros[c], `sem erro para ${c}`);
    }
    return true;
  });
  assert.equal(dbTmp.prepare('SELECT COUNT(*) AS n FROM platform_parametros').get().n, 0);
});

test('obrigatórios: canal ligado exige o que ele precisa (inclusive a senha)', () => {
  assert.throws(() => store.salvar(EMP, { alteracoes: { 'alertas.email.ativo': true } }), (e) => {
    for (const c of ['alertas.email.smtp_host', 'alertas.email.usuario', 'alertas.email.senha', 'alertas.email.destinatarios']) assert.ok(e.erros[c], c);
    assert.ok(!e.erros['alertas.email.remetente'], 'remetente é opcional');
    return true;
  });
  // Desligado, pode ficar incompleto.
  store.salvar(EMP, { alteracoes: { 'alertas.email.smtp_host': 'smtp.gmail.com' } }, { usuario: 'ana' });
  // Apagar a senha com o e-mail ligado é recusado.
  store.salvar(EMP, { alteracoes: emailOk }, { usuario: 'ana' });
  assert.throws(() => store.salvar(EMP, { restaurar: ['alertas.email.senha'] }), (e) => !!e.erros['alertas.email.senha']);
});

test('e-mails normalizados (minúsculas, sem repetir); restaurar volta ao padrão; histórico com usuário e segredo mascarado', () => {
  store.salvar(EMP, { alteracoes: { ...emailOk, 'alertas.email.destinatarios': ['TI@empresa.com.br', 'ti@empresa.com.br'] } }, { usuario: 'ana' });
  assert.deepEqual(store.valores(EMP)['alertas.email.destinatarios'], ['ti@empresa.com.br']);
  store.salvar(EMP, { alteracoes: { 'alertas.reserva.ordem': 'todos' } }, { usuario: 'beto' });
  store.salvar(EMP, { restaurar: ['alertas.reserva.ordem'] }, { usuario: 'beto' });
  assert.equal(store.valores(EMP)['alertas.reserva.ordem'], 'email_telegram');
  const h = store.historico(EMP);
  assert.ok(h.some(x => x.chave === 'alertas.reserva.ordem' && x.acao === 'restaurado' && x.usuario === 'beto'));
  const s = h.find(x => x.chave === 'alertas.email.senha');
  assert.equal(s.para, '•••• (alterado)');
  assert.equal(s.de, null);
  assert.ok(!JSON.stringify(h).includes('senha-de-app'));
  // Salvar o mesmo valor não gera histórico novo.
  const antes = store.historico(EMP).length;
  store.salvar(EMP, { alteracoes: { 'alertas.email.smtp_porta': 587 } }, { usuario: 'ana' });
  assert.equal(store.historico(EMP).length, antes);
});

// ── Reserva de alertas ───────────────────────────────────────────────────

test('reserva: só quando o WhatsApp falhar (padrão); e-mail primeiro; Telegram se o e-mail falhar', async () => {
  store.salvar(EMP, { alteracoes: { ...emailOk, 'alertas.telegram.ativo': true, 'alertas.telegram.token': TOKEN, 'alertas.telegram.chat_id': '-1001234567890' } }, { usuario: 'ana' });
  const pulado = await reserva.enviar(EMP, 'oi', { whatsappFalhou: false });
  assert.equal(pulado.enviado, false);
  assert.equal(emails.length + telegramas.length, 0);
  const r = await reserva.enviar(EMP, 'serviço caiu');
  assert.deepEqual(r.canais, ['email']);
  assert.equal(emails[0].m.to, 'ti@empresa.com.br, plantao@empresa.com.br');
  assert.equal(emails[0].opcoes.requireTLS, true);
  assert.equal(emails[0].opcoes.auth.pass, 'senha-de-app');
  falharEmail = 'SMTP recusou';
  const r2 = await reserva.enviar(EMP, 'de novo');
  assert.deepEqual(r2.canais, ['telegram']);
  assert.equal(telegramas[0].corpo.chat_id, '-1001234567890');
  assert.match(r2.erros[0], /email: SMTP recusou/);
});

test('reserva: ordem Telegram primeiro, "os dois", "sempre" e "nunca"', async () => {
  store.salvar(EMP, { alteracoes: { ...emailOk, 'alertas.telegram.ativo': true, 'alertas.telegram.token': TOKEN, 'alertas.telegram.chat_id': '123456', 'alertas.reserva.ordem': 'telegram_email' } }, { usuario: 'ana' });
  assert.deepEqual((await reserva.enviar(EMP, 'x')).canais, ['telegram']);
  store.salvar(EMP, { alteracoes: { 'alertas.reserva.ordem': 'todos', 'alertas.reserva.quando': 'sempre' } }, { usuario: 'ana' });
  assert.deepEqual((await reserva.enviar(EMP, 'x', { whatsappFalhou: false })).canais.sort(), ['email', 'telegram']);
  store.salvar(EMP, { alteracoes: { 'alertas.reserva.quando': 'nunca' } }, { usuario: 'ana' });
  const n = await reserva.enviar(EMP, 'x');
  assert.equal(n.enviado, false);
  assert.equal(n.pulado, 'nunca');
});

test('reserva: empresa sem canal usa o Telegram do .env; usarEnv=false não usa; teste usa o que está salvo', async () => {
  const semNada = await reserva.enviar(EMP, 'x');
  assert.equal(semNada.enviado, false);
  assert.match(semNada.erros.join(), /nenhum canal de reserva/);
  process.env.IAC_TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.IAC_TELEGRAM_ALERT_CHAT_ID = '999';
  assert.deepEqual((await reserva.enviar(EMP, 'x')).canais, ['telegram_env']);
  assert.equal((await reserva.enviar(EMP, 'x', { usarEnv: false })).enviado, false);
  // Teste da tela: Telegram recusando vira erro claro, sem o token na mensagem.
  store.salvar(EMP, { alteracoes: { 'alertas.telegram.token': TOKEN, 'alertas.telegram.chat_id': '123456' } }, { usuario: 'ana' });
  falharTelegram = true;
  await assert.rejects(reserva.testar(EMP, 'telegram', 'ana'), (e) => /Unauthorized/.test(e.message) && !e.message.includes(TOKEN));
  falharTelegram = false;
  await reserva.testar(EMP, 'telegram', 'ana');
  assert.match(telegramas.at(-1).corpo.text, /Teste de alerta/);
});

// ── API (só administrador) ───────────────────────────────────────────────

test('API: só administrador; erros por campo; teste e auditoria', async () => {
  const express = require('express');
  const auditoria = [];
  const caminhoAuth = require.resolve('../apps/IAHUB/backend/auth/database');
  const caminhoEmp = require.resolve('../apps/IAHUB/backend/empresas/database');
  const orig = [require.cache[caminhoAuth], require.cache[caminhoEmp]];
  require.cache[caminhoAuth] = { id: caminhoAuth, filename: caminhoAuth, loaded: true, exports: { registrarAuditoria: (r) => auditoria.push(r) } };
  require.cache[caminhoEmp] = { id: caminhoEmp, filename: caminhoEmp, loaded: true, exports: { listar: () => [{ id: EMP, razao_social: 'Empresa Sete' }], buscarPorId: (id) => (Number(id) === EMP ? { id: EMP } : null) } };
  delete require.cache[require.resolve('../apps/IAHUB/backend/parametros/routes')];
  const rotas = require('../apps/IAHUB/backend/parametros/routes');
  [caminhoAuth, caminhoEmp].forEach((c, i) => { if (orig[i]) require.cache[c] = orig[i]; else delete require.cache[c]; });

  const sessao = { authenticated: true, role: 'user', user: 'beto' };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = sessao; next(); });
  rotas.registrar(app, {
    requireAuth: (req, res, next) => (req.session?.authenticated ? next() : res.status(401).json({})),
    requireAdmin: (req, res, next) => (req.session?.role === 'admin' ? next() : res.status(403).json({ error: 'Acesso restrito a administradores' })),
  });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/iahub/parametros`;
  const fetchReal = global.fetch;
  // A API local passa pelo fetch de verdade (só a rede externa fica bloqueada).
  const { request } = require('node:http');
  const chamar = (metodo, caminho, corpo) => new Promise((ok, falha) => {
    const u = new URL(base + caminho);
    const req = request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let txt = '';
      res.on('data', d => { txt += d; });
      res.on('end', () => ok({ status: res.statusCode, corpo: JSON.parse(txt || '{}') }));
    });
    req.on('error', falha);
    if (corpo) req.write(JSON.stringify(corpo));
    req.end();
  });
  try {
    assert.equal((await chamar('GET', `?empresa_id=${EMP}`)).status, 403);
    sessao.role = 'admin';
    assert.equal((await chamar('GET', '?empresa_id=999')).status, 404);
    const tela = await chamar('GET', `?empresa_id=${EMP}`);
    assert.equal(tela.status, 200);
    assert.ok(tela.corpo.grupos.length && tela.corpo.parametros.length);
    const ruim = await chamar('PUT', '', { empresaId: EMP, alteracoes: { 'alertas.email.ativo': true } });
    assert.equal(ruim.status, 400);
    assert.ok(ruim.corpo.erros['alertas.email.smtp_host']);
    const bom = await chamar('PUT', '', { empresaId: EMP, alteracoes: emailOk });
    assert.equal(bom.status, 200);
    assert.ok(bom.corpo.alterados > 0);
    assert.ok(auditoria.some(a => a.acao === 'parametros_empresa_alterados' && a.usuario === 'beto' && a.empresa_id === EMP));
    const hist = await chamar('GET', `/historico?empresa_id=${EMP}`);
    assert.ok(hist.corpo.historico.every(h => h.usuario === 'beto'));
    assert.equal((await chamar('POST', '/testar', { empresaId: EMP, canal: 'email' })).status, 200);
    assert.equal(emails.length, 1);
    falharEmail = 'Autenticação recusada';
    const t2 = await chamar('POST', '/testar', { empresaId: EMP, canal: 'email' });
    assert.equal(t2.status, 400);
    assert.match(t2.corpo.error, /Autenticação recusada/);
    assert.equal((await chamar('POST', '/testar', { empresaId: EMP, canal: 'sms' })).status, 400);
  } finally {
    global.fetch = fetchReal;
    srv.close();
  }
});
