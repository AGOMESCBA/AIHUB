// Executar: node --test "apps/IAHUB/tests/embed-origins.test.js"
// Bancos SQLite em memória; nenhuma configuração ou serviço de produção é usado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('../backend/platform-schema');
const access = require('../backend/platform-access-routes');
const { criarResolvers } = require('../backend/embed-resolvers');
const links = require('../../IA Administracao/frontend/js/platform-access-links');

const J2A = 'https://j2a.c3isystems.com.br';
const OUTRO = 'https://outro.softexpert.com';

async function servidor(t, app) {
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

// Empresa 1 = J2A (apelido j2a, rota /entrar/j2a-chat); empresa 2 = Caieira
// (apelido caieira, rota /entrar/caieira); empresa 3 sem links.
function montarBancos() {
  const platform = new Database(':memory:');
  ensurePlatformSchema(platform);
  const ins = platform.prepare('INSERT INTO platform_ai_configs (id, empresa_id, login_externo_apelido) VALUES (?, ?, ?)');
  ins.run('a', 1, 'j2a');
  ins.run('b', 2, 'caieira');
  const iac = new Database(':memory:');
  iac.exec(`CREATE TABLE ai_config (empresa_id INTEGER, protheus_web_login_ativo INTEGER, protheus_web_login_path TEXT)`);
  const insI = iac.prepare('INSERT INTO ai_config VALUES (?, ?, ?)');
  insI.run(1, 1, '/entrar/j2a-chat');
  insI.run(2, 1, '/entrar/caieira');
  insI.run(3, 0, '/entrar/inativa');
  return { platform, iac };
}

function montarApp(bancos, { admin = true, sessaoEmpresa = 1 } = {}) {
  access.invalidarCacheOrigens();
  const resolvers = criarResolvers({
    getPlatformDB: () => bancos.platform,
    getIaCommandDB: () => bancos.iac,
    buscarEmpresa: id => ({ 1: { razao_social: 'J2A Consultoria' }, 2: { razao_social: 'Caieira' } }[id] || null),
  });
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(access.middlewareIncorporacaoChat({ getDB: () => bancos.platform, ...resolvers }));
  app.use(express.json());
  const requireAuth = (req, _res, next) => { req.session = { user: 'tester', role: admin ? 'admin' : 'user', empresa_id: sessaoEmpresa }; next(); };
  const requireAdmin = (req, res, next) => (req.session.role === 'admin' ? next() : res.status(403).json({ error: 'admin' }));
  // Mesma regra de empresaId(req) do platform-routes: admin escolhe; usuário fica na própria empresa.
  const empresaIdDaReq = req => {
    const pedida = req.query.empresaId || req.body?.empresaId;
    if (req.session?.role === 'admin' && pedida) return Number(pedida);
    return Number(req.session?.empresa_id || 0);
  };
  access.registrarRotas(app, { requireAuth, requireAdmin, getDB: () => bancos.platform, empresaIdDaReq, contextoEmpresa: resolvers.contextoEmpresa });
  const ok = (_req, res) => res.send('ok');
  for (const p of ['/iaservice', '/iaservice/:a', '/iaservice/:a/:t', '/entrar-servico/:a', '/radar-externo/:a', '/entrar/:s', '/api/ia-command/protheus/chat', '/app/ia-service/shell.html', '/iahub.html']) app.get(p, ok);
  return app;
}

async function salvar(base, empresaId, origens, versao) {
  return fetch(base + '/api/iahub/platform/embed-origins?empresaId=' + empresaId, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origens, versao }),
  });
}

async function cabecalhos(base, p) {
  const r = await fetch(base + p);
  return { xfo: r.headers.get('x-frame-options'), csp: r.headers.get('content-security-policy') };
}

test('normalização: só HTTPS, sem caminho, sem duplicados, vazia permitida (servidor e tela)', () => {
  assert.deepEqual(access.normalizarOrigensIncorporacao([]), []);
  assert.deepEqual(access.normalizarOrigensIncorporacao(null), []);
  assert.deepEqual(access.normalizarOrigensIncorporacao([J2A + '/', J2A, '  ']), [J2A]);
  for (const ruim of [['http://j2a.c3isystems.com.br'], ['https://host/caminho'], ['javascript:alert(1)'], ["https://a.com 'unsafe-inline'"], 'https://a.com']) {
    assert.throws(() => access.normalizarOrigensIncorporacao(ruim), String(ruim));
  }
  assert.equal(links.normalizarOrigem(J2A + '/'), J2A);
  for (const ruim of ['http://j2a.c3isystems.com.br', 'j2a.c3isystems.com.br', J2A + '/softexpert/workspace', '']) {
    assert.throws(() => links.normalizarOrigem(ruim), ruim);
  }
});

test('schema aditivo e idempotente; URL pública global intacta', () => {
  const db = new Database(':memory:');
  try {
    ensurePlatformSchema(db);
    ensurePlatformSchema(db);
    assert.deepEqual(access.lerOrigensEmpresa(db, 1), { empresaId: 1, origens: [], versao: 0, atualizadoEm: null, atualizadoPor: null });
    assert.deepEqual(access.lerConfig(db), { urlPublica: null, versao: 0, atualizadoEm: null });
  } finally { db.close(); }
});

test('sem lista: tudo continua SAMEORIGIN (comportamento original)', async t => {
  const bancos = montarBancos();
  const base = await servidor(t, montarApp(bancos));
  for (const p of ['/iaservice/j2a', '/entrar/j2a-chat', '/api/ia-command/protheus/chat?loginPath=/entrar/j2a-chat']) {
    assert.deepEqual(await cabecalhos(base, p), { xfo: 'SAMEORIGIN', csp: null }, p);
  }
});

test('lista vale SOMENTE para os links da empresa dona; outra empresa segue bloqueada', async t => {
  const bancos = montarBancos();
  const base = await servidor(t, montarApp(bancos));
  const r = await salvar(base, 1, [J2A + '/'], 0);
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo.origens, [J2A]);
  assert.equal(corpo.empresaNome, 'J2A Consultoria');
  assert.deepEqual(corpo.links, { iaService: '/iaservice/j2a', iaCommand: '/entrar/j2a-chat' });

  const liberado = { xfo: null, csp: `frame-ancestors 'self' ${J2A}` };
  for (const p of ['/iaservice/j2a', '/iaservice/J2A/radar', '/iaservice/j2a/acesso', '/entrar-servico/j2a', '/radar-externo/j2a',
    '/entrar/j2a-chat', '/api/ia-command/protheus/chat?usuario=x&loginPath=%2Fentrar%2Fj2a-chat']) {
    assert.deepEqual(await cabecalhos(base, p), liberado, p);
  }
  // Empresa 2 (Caieira) não cadastrou nada: seus links continuam bloqueados.
  for (const p of ['/iaservice/caieira', '/entrar/caieira', '/api/ia-command/protheus/chat?loginPath=/entrar/caieira',
    // sem empresa identificável, apelido inexistente, rota inativa e telas internas
    '/iaservice', '/api/ia-command/protheus/chat', '/iaservice/inexistente', '/entrar/inativa', '/iaservice/guia', '/app/ia-service/shell.html', '/iahub.html']) {
    assert.deepEqual(await cabecalhos(base, p), { xfo: 'SAMEORIGIN', csp: null }, p);
  }

  // Cada empresa com a sua lista, sem se misturar.
  assert.equal((await salvar(base, 2, [OUTRO], 0)).status, 200);
  assert.deepEqual(await cabecalhos(base, '/entrar/caieira'), { xfo: null, csp: `frame-ancestors 'self' ${OUTRO}` });
  assert.deepEqual(await cabecalhos(base, '/iaservice/j2a'), liberado);
  assert.deepEqual(access.lerOrigensEmpresa(bancos.platform, 1).origens, [J2A]);
});

test('rota mascarada duplicada entre empresas é ambígua e não libera', async t => {
  const bancos = montarBancos();
  bancos.iac.prepare('INSERT INTO ai_config VALUES (?, ?, ?)').run(4, 1, '/entrar/j2a-chat');
  const base = await servidor(t, montarApp(bancos));
  assert.equal((await salvar(base, 1, [J2A], 0)).status, 200);
  assert.deepEqual(await cabecalhos(base, '/entrar/j2a-chat'), { xfo: 'SAMEORIGIN', csp: null });
  assert.deepEqual(await cabecalhos(base, '/iaservice/j2a'), { xfo: null, csp: `frame-ancestors 'self' ${J2A}` });
});

test('concorrência, validação, limpeza e permissão', async t => {
  const bancos = montarBancos();
  const base = await servidor(t, montarApp(bancos));
  assert.equal((await salvar(base, 1, [J2A], 0)).status, 200);
  assert.equal((await salvar(base, 1, [], 0)).status, 409);
  assert.equal((await salvar(base, 1, ['http://inseguro.com'], 1)).status, 400);
  assert.equal((await salvar(base, 1, [], 1)).status, 200);
  assert.deepEqual(await cabecalhos(base, '/iaservice/j2a'), { xfo: 'SAMEORIGIN', csp: null });
  assert.equal(access.lerOrigensEmpresa(bancos.platform, 1).atualizadoPor, 'tester');
});

test('usuário não-admin: lê só a própria empresa e não grava', async t => {
  const bancos = montarBancos();
  const base = await servidor(t, montarApp(bancos, { admin: false, sessaoEmpresa: 2 }));
  const lido = await (await fetch(base + '/api/iahub/platform/embed-origins?empresaId=1')).json();
  assert.equal(lido.empresaId, 2);
  assert.equal((await salvar(base, 2, [J2A], 0)).status, 403);
  assert.deepEqual(access.lerOrigensEmpresa(bancos.platform, 2).origens, []);
});

test('falha ao resolver a empresa nunca libera (fail-closed)', async t => {
  access.invalidarCacheOrigens();
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(access.middlewareIncorporacaoChat({
    getDB: () => { throw new Error('banco fora'); },
    empresaPorApelido: () => { throw new Error('banco fora'); },
    empresaPorLoginPath: () => 1,
  }));
  app.get(['/iaservice/:a', '/entrar/:s'], (_req, res) => res.send('ok'));
  const base = await servidor(t, app);
  assert.deepEqual(await cabecalhos(base, '/iaservice/j2a'), { xfo: 'SAMEORIGIN', csp: null });
  assert.deepEqual(await cabecalhos(base, '/entrar/j2a-chat'), { xfo: 'SAMEORIGIN', csp: null });
});
