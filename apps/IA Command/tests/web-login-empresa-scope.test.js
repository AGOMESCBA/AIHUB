'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Database = require('better-sqlite3');
const scope = require('../modules/protheus_whatsapp/web-login-scope');
const ROOT = path.resolve(__dirname, '..');
const migration = require('../modules/database/migrations').find(item => item.version === 96);
const emp = (empresaId, codigoProtheus) => ({ empresaId, codigoProtheus });
const plain = value => JSON.parse(JSON.stringify(value));

function loadModule(file, db) {
  const module = { exports: {} };
  const localRequire = require('node:module').createRequire(path.join(ROOT, file));
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    module, exports: module.exports, process, console, Buffer,
    require: name => name === '../database' ? { getDB: () => db } : localRequire(name),
  }, { filename: file });
  return module.exports;
}

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE protheus_chat_tokens (
    token TEXT PRIMARY KEY, empresa_id INTEGER, celular TEXT, filial TEXT,
    expira_em TEXT, criado_em TEXT, usado_em TEXT,
    empresas_permitidas_json TEXT, filiais_permitidas_json TEXT);
    CREATE TABLE protheus_web_user_permissions (
    id TEXT PRIMARY KEY, empresa_id INTEGER, celular TEXT, usuario_nome TEXT,
    usuario_id TEXT, filial_atual TEXT, ativo INTEGER, ultimo_sync_em TEXT,
    atualizado_em TEXT, empresas_permitidas_json TEXT, filiais_permitidas_json TEXT);`);
  db.exec(migration.sql);
  migration.run(db);
  return { db, tokens: loadModule('modules/protheus_whatsapp/token-service.js', db) };
}

function loadRoutesFunctions(userPermissionsStore, tokens, filtrar = x => x) {
  const source = fs.readFileSync(path.join(ROOT, 'modules/protheus_whatsapp/routes.js'), 'utf8');
  const extract = (start, end) => source.slice(source.indexOf('function ' + start + '('), source.indexOf('function ' + end + '('));
  const context = vm.createContext({
    userPermissionsStore, tokenService: tokens, webLoginScope: scope,
    filtrarEmpresasSemCodigoQuandoHaArvore: filtrar,
  });
  vm.runInContext(extract('carregarPermissoesWebPorCelular', 'filtrarEmpresasSemCodigoQuandoHaArvore')
    + extract('requireTokenSessao', 'resolverEmpresaSelecionada'), context);
  return context;
}

test('migração preserva tokens existentes e marca origem legada como desconhecida', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE protheus_chat_tokens (token TEXT PRIMARY KEY,empresa_id INTEGER)');
    db.prepare('INSERT INTO protheus_chat_tokens (token,empresa_id) VALUES (?,?)').run('antigo', 5);
    db.exec(migration.sql);
    migration.run(db);
    migration.run(db);
    assert.equal(db.prepare('SELECT empresa_escopo_id FROM protheus_chat_tokens').get().empresa_escopo_id, null);
    assert.equal(db.prepare('SELECT token FROM protheus_chat_tokens').get().token, 'antigo');
  } finally { db.close(); }
});

test('token do link mantém PLANTIVO/EMA no ID 5 e exclui outro cliente', () => {
  const { db, tokens } = fixture();
  try {
    const { token } = tokens.emitir({ empresaId: 5, empresaEscopoId: 5, celular: '5599999999999', empresasPermitidas: [emp(5, '01'), emp(5, '02'), emp(99, '01')] });
    const sessao = tokens.validar(token);
    assert.equal(sessao.empresaEscopoId, 5);
    assert.deepEqual(plain(sessao.empresasPermitidas), [
      { ...emp(5, '01'), nomeProtheus: '' }, { ...emp(5, '02'), nomeProtheus: '' },
    ]);
    assert.equal(tokens.empresaPermitida(sessao, 99), false);
    assert.equal(db.prepare('SELECT empresa_escopo_id FROM protheus_chat_tokens').get().empresa_escopo_id, 5);
  } finally { db.close(); }
});

test('recusa escopo conflitante e lista que só contém outra empresa', () => {
  const { db, tokens } = fixture();
  try {
    assert.throws(() => tokens.emitir({ empresaId: 5, empresaEscopoId: 99, celular: '5599999999999' }), /Escopo/);
    assert.throws(() => tokens.emitir({ empresaId: 5, empresaEscopoId: 5, celular: '5599999999999', empresasPermitidas: [emp(99, '01')] }), /sem empresas/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM protheus_chat_tokens').get().n, 0);
  } finally { db.close(); }
});

test('sessões novas do Protheus preservam suporte a múltiplos clientes explícitos', () => {
  const { db, tokens } = fixture();
  try {
    const { token } = tokens.emitir({ empresaId: 5, celular: '5599999999999', empresasPermitidas: [emp(5, '01'), emp(99, '01')] });
    const sessao = tokens.validar(token);
    assert.equal(sessao.empresaEscopoId, 0);
    assert.equal(sessao.empresasPermitidas.length, 2);
  } finally { db.close(); }
});

test('token anterior à migração exige autenticação nova sem apagar o registro', () => {
  const { db, tokens } = fixture();
  try {
    const { token } = tokens.emitir({ empresaId: 5, empresaEscopoId: 5, celular: '5599999999999' });
    db.exec('UPDATE protheus_chat_tokens SET empresa_escopo_id=NULL');
    assert.equal(tokens.validar(token), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM protheus_chat_tokens').get().n, 1);
  } finally { db.close(); }
});

test('login usa o mesmo registro mais recente exibido no cadastro, sem somar duplicatas', () => {
  const { db, tokens } = fixture();
  try {
    const ins = db.prepare('INSERT INTO protheus_web_user_permissions (id,empresa_id,celular,ativo,ultimo_sync_em,atualizado_em,empresas_permitidas_json,filiais_permitidas_json) VALUES (?,?,?,1,?,?,?,?)');
    ins.run('atual', 5, '5599999999999', '2026-10-23', '2026-10-23', JSON.stringify([emp(5, '01'), emp(5, '02'), emp(99, '01')]), '[]');
    ins.run('antigo', 5, '5599999999999', '2026-10-01', '2026-10-01', JSON.stringify([emp(5, '03'), emp(99, '02')]), '[]');
    ins.run('outro-cliente', 99, '5599999999999', '2026-10-24', '2026-10-24', JSON.stringify([emp(99, '01')]), '[]');
    const store = loadModule('modules/protheus_whatsapp/user-permissions-store.js', db);
    const funcs = loadRoutesFunctions(store, tokens);
    const permissoes = funcs.carregarPermissoesWebPorCelular('5599999999999', 5);
    assert.equal(permissoes.empresaId, 5);
    assert.deepEqual(plain(permissoes.empresasPermitidas), [emp(5, '01'), emp(5, '02')]);
    db.prepare("UPDATE protheus_web_user_permissions SET empresas_permitidas_json='[]' WHERE id='atual'").run();
    assert.equal(funcs.carregarPermissoesWebPorCelular('5599999999999', 5), null);
  } finally { db.close(); }
});

const sessao = {
  empresaId: 5, empresaEscopoId: 5,
  empresasPermitidas: [emp(5, '01'), emp(5, '02')],
  filiaisPermitidas: [{ codigoProtheus: '01', filiais: ['010101', '010102'] }],
};

test('revogação é aplicada à sessão, sem ampliar acesso após nova liberação', () => {
  const atual = { empresaId: 5, empresasPermitidas: [emp(5, '01'), emp(5, '03'), emp(99, '01')], filiaisPermitidas: [{ codigoProtheus: '01', filiais: ['010102', '010103'] }] };
  const resultado = scope.revalidar(sessao, atual);
  assert.deepEqual(resultado.empresasPermitidas, [emp(5, '01')]);
  assert.deepEqual(resultado.filiaisPermitidas, [{ codigoProtheus: '01', filiais: ['010102'] }]);
  assert.equal(scope.revalidar(sessao, null), null);
  assert.equal(scope.revalidar(sessao, { ...atual, empresasPermitidas: [] }), null);
});

test('interseção vazia de filiais continua bloqueada e não vira acesso irrestrito', () => {
  const atual = { empresaId: 5, empresasPermitidas: [emp(5, '01')], filiaisPermitidas: [{ codigoProtheus: '01', filiais: ['010199'] }] };
  assert.deepEqual(scope.revalidar(sessao, atual).filiaisPermitidas, [{ codigoProtheus: '01', filiais: [] }]);
});

test('middleware recusa empresa revogada antes de executar qualquer endpoint', () => {
  let nextCalls = 0;
  const funcs = loadRoutesFunctions({ listarAtivosPorCelular: () => [] }, { validar: () => ({ ...sessao, celular: '5599999999999' }) });
  let status;
  const res = { status: code => { status = code; return res; }, json: () => {} };
  funcs.requireTokenSessao({ headers: { authorization: 'Bearer teste' } }, res, () => nextCalls++);
  assert.equal(status, 401);
  assert.equal(nextCalls, 0);
});

test('fluxo real /entrar/plantivo → token → bootstrap bloqueia seleção forçada de outro cliente', async () => {
  const { db, tokens } = fixture();
  try {
    const store = { listarAtivosPorCelular: (_celular, empresaId) => {
      assert.equal(empresaId, 5);
      return [{ empresa_id: 5, celular: '5599999999999', empresasPermitidas: [emp(5, '01'), emp(5, '02'), emp(99, '01')], filiaisPermitidas: [] }];
    } };
    let issuedToken;
    const mocks = {
      './token-service': tokens, './user-permissions-store': store,
      './web-login-scope': scope, '../database': { getDB: () => db },
      './session-store': { listarSessoes: () => [] },
      '../whatsapp/channel-store': {}, '../whatsapp/whatsapp-response-config': {},
    };
    const file = path.join(ROOT, 'modules/protheus_whatsapp/routes.js');
    const localRequire = require('node:module').createRequire(file);
    const context = vm.createContext({ module: { exports: {} }, process, Buffer, console,
      require: name => mocks[name] || localRequire(name) });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    Object.assign(context, {
      carregarWebLoginConfigs: () => [{ empresaId: 5, path: '/entrar/plantivo', ativo: true }],
      carregarWebLoginConfigEmpresa: () => ({ empresaId: 5, path: '/entrar/plantivo', ativo: true }),
      webLoginAccessAutorizado: () => true, webLoginHttpsAutorizado: () => true,
      publicRateLimit: () => true, validarLoginChallenge: () => ({ ok: true }),
      salvarLaunchTicket: (_ticket, token) => { issuedToken = token; }, perfLog: () => {},
      filtrarEmpresasSemCodigoQuandoHaArvore: items => items,
      getEmpresasIahubDb: () => ({ listar: () => [{ id: 5, nome: 'PLANTIVO' }, { id: 99, nome: 'CRYPTO RADAR' }] }),
    });
    const routes = new Map();
    const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (paths, ...handlers) => {
      for (const route of Array.isArray(paths) ? paths : [paths]) routes.set(`${method} ${route}`, handlers);
    }]));
    context.module.exports(app);
    const invoke = async (key, req) => {
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      for (const handler of routes.get(key)) {
        let next = false;
        await handler(req, res, () => { next = true; });
        if (!next) break;
      }
      return res;
    };
    const login = await invoke('post /entrar/:slug/verify', {
      path: '/entrar/plantivo/verify', headers: {}, query: {},
      body: { celular: '5599999999999', challengeId: 'simulado', codigo: '123456' },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.body.ok, true);
    assert.equal(tokens.validar(issuedToken).empresaEscopoId, 5);
    const req = query => ({ headers: { authorization: `Bearer ${issuedToken}` }, query, body: {} });
    const bootstrap = await invoke('get /api/ia-command/protheus/bootstrap', req({}));
    assert.equal(bootstrap.statusCode, 200);
    assert.deepEqual(plain(bootstrap.body.empresas).map(item => item.empresaId), [5, 5]);
    assert.equal(bootstrap.body.loginPath, '/entrar/plantivo');
    const forced = await invoke('get /api/ia-command/protheus/bootstrap', req({ empresaId: 99 }));
    assert.equal(forced.statusCode, 403);
    assert.equal(forced.body.error, 'Empresa nao permitida para esta sessao.');
  } finally { db.close(); }
});
