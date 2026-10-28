// Números Autorizados pelo menu do IA Service (2026-10-28) + rotinas por API
// do IA Service + travas de admin nas rotas de cadastro do IAHub.
// Executar: node "apps/IA Service/tests/numeros-autorizados.test.js"
//
// O banco da Platform é um SQLite em memória (o platform-store real é
// substituído antes do require) — nunca toca em data/iahub-platform.db.

const assert = require('assert');
const path = require('path');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('../../IAHUB/backend/platform-schema');

const mem = new Database(':memory:');
ensurePlatformSchema(mem);
require.cache[require.resolve('../../IAHUB/backend/platform-store')] = {
  id: 'platform-store-mock', filename: 'platform-store-mock', loaded: true, exports: { getDB: () => mem },
};
const rotinasPorUsuario = new Map();
require.cache[require.resolve('../../IAHUB/backend/permissoes/database')] = {
  id: 'permissoes-mock', filename: 'permissoes-mock', loaded: true,
  exports: { getRotinas: (u, e) => rotinasPorUsuario.get(`${u}:${e}`) ?? null },
};

const numeros = require('../../IAHUB/backend/platform-numeros-ia-service');
const { aplicarRotinasPorPrefixo } = require('../backend/services/rotina-permissao');

const EMP = 99301;
const OUTRA = 99302;
const agora = new Date().toISOString();

function identidade(id, empresaId, numero, nome) {
  mem.prepare(`INSERT INTO platform_whatsapp_identities (id, empresa_id, nome, numero, numero_normalizado, ativo, metadata_json, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, 1, '{}', ?, ?)`).run(id, empresaId, nome, numero, numero, agora, agora);
}
function role(id, identityId, empresaId, sistema, modulo, extra = {}) {
  mem.prepare(`INSERT INTO platform_identity_roles (id, identity_id, empresa_id, sistema, modulo, papel, codigo_identidade, liberado, metadata_json, origem_sistema, origem_id, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`).run(id, identityId, empresaId, sistema, modulo, extra.papel || 'analista',
    extra.codigo || null, extra.liberado === false ? 0 : 1, extra.origemSistema || null, extra.origemId || null, agora, agora);
}
const rolesDe = (identityId) => mem.prepare('SELECT * FROM platform_identity_roles WHERE identity_id = ? ORDER BY sistema').all(identityId);
// Mesma condição que o login por telefone usa (platform-store.listarIaServicePorTelefone).
const loginEnxerga = (numero, empresaId) => !!mem.prepare(`
  SELECT 1 FROM platform_whatsapp_identities i JOIN platform_identity_roles r ON r.identity_id = i.id AND r.empresa_id = i.empresa_id
   WHERE i.numero_normalizado = ? AND i.empresa_id = ? AND i.ativo = 1 AND r.liberado = 1
     AND lower(r.sistema) = 'ia-service' AND lower(r.modulo) = 'chat-web'`).get(numero, empresaId);
function erroCom(fn, status) {
  try { fn(); } catch (e) { assert.strictEqual(e.status, status, `esperava ${status}, veio ${e.status}: ${e.message}`); return e; }
  assert.fail(`esperava erro ${status}`);
}

// ── Cenário base ──────────────────────────────────────────────────────────────
// Só IA Command (Protheus), sem IA Service:
identidade('id-iac', EMP, '5565911110000', 'SO IA COMMAND');
role('r-iac', 'id-iac', EMP, 'ia-command', 'compras');
// IA Command + vínculo IA Service vindo da importação automática:
identidade('id-auto', EMP, '5565922220000', 'IMPORTADO');
role('r-auto-iac', 'id-auto', EMP, 'ia-command', 'chamados', { codigo: '186' });
role('r-auto-svc', 'id-auto', EMP, 'ia-service', 'chat-web', { codigo: '186', origemSistema: 'ia-command', origemId: 'n1:ia-service-auto' });
// Outra empresa:
identidade('id-outra', OUTRA, '5565933330000', 'OUTRA EMPRESA');
role('r-outra', 'id-outra', OUTRA, 'ia-service', 'chat-web', { codigo: '9' });

// 1. Lista só números com vínculo do IA Service, só da empresa.
let lista = numeros.listar(EMP);
assert.deepStrictEqual(lista.map(i => i.id), ['id-auto'], 'número só do IA Command não aparece');
assert.strictEqual(lista[0].compartilhado, true);
assert.deepStrictEqual(lista[0].outrosSistemas, ['IA Command']);
assert.strictEqual(lista[0].idSoftexpert, '186');
assert.strictEqual(numeros.listar(OUTRA).length, 1);

// 2. Novo número: cria identidade + vínculo liberado, manual, e o login enxerga.
const novo = numeros.salvar(EMP, { nome: 'NOVO ANALISTA', numero: '+55 (65) 94444-0000', idSoftexpert: '784', papel: 'gestor', preAnaliseAutomatica: false, estiloResposta: 'ORIGINAL' });
assert.strictEqual(novo.criado, true);
const rNovo = rolesDe(novo.id);
assert.strictEqual(rNovo.length, 1);
assert.strictEqual(rNovo[0].liberado, 1);
assert.strictEqual(rNovo[0].codigo_identidade, '784');
assert.strictEqual(rNovo[0].origem_id, null);
assert.ok(loginEnxerga('5565944440000', EMP));
const vNovo = numeros.listar(EMP).find(i => i.id === novo.id);
assert.strictEqual(vNovo.papel, 'gestor');
assert.strictEqual(vNovo.preAnaliseAutomatica, false);
assert.strictEqual(vNovo.estiloResposta, 'ORIGINAL');

// 3. Telefone que já existe só no IA Command: ganha o vínculo, o resto não muda.
const vinc = numeros.salvar(EMP, { nome: 'NOME DIFERENTE', numero: '5565911110000', idSoftexpert: '500' });
assert.strictEqual(vinc.id, 'id-iac');
assert.strictEqual(vinc.vinculadoAExistente, true);
assert.strictEqual(mem.prepare('SELECT nome FROM platform_whatsapp_identities WHERE id = ?').get('id-iac').nome, 'SO IA COMMAND');
const rIac = rolesDe('id-iac');
assert.strictEqual(rIac.length, 2);
assert.deepStrictEqual(rIac.find(r => r.sistema === 'ia-command'), mem.prepare("SELECT * FROM platform_identity_roles WHERE id = 'r-iac'").get());
assert.strictEqual(rIac.find(r => r.sistema === 'ia-command').liberado, 1);

// 4. Duplicado e validações.
erroCom(() => numeros.salvar(EMP, { nome: 'X', numero: '5565944440000', idSoftexpert: '1' }), 409);
erroCom(() => numeros.salvar(EMP, { nome: 'X', numero: '5565955550000' }), 400);
erroCom(() => numeros.salvar(EMP, { nome: 'X', numero: '123', idSoftexpert: '1' }), 400);
erroCom(() => numeros.salvar(EMP, { nome: 'X', numero: '5565955550000', idSoftexpert: '1', papel: 'admin' }), 400);
erroCom(() => numeros.salvar(EMP, { nome: 'X', numero: '5565955550000', idSoftexpert: '1', estiloResposta: 'QUALQUER' }), 400);

// 5. Número compartilhado: trocar telefone é bloqueado; nome enviado é ignorado.
erroCom(() => numeros.salvar(EMP, { id: 'id-auto', nome: 'IMPORTADO', numero: '5565900000000', idSoftexpert: '186' }), 409);
numeros.salvar(EMP, { id: 'id-auto', nome: 'TENTOU TROCAR', numero: '5565922220000', idSoftexpert: '187' });
assert.strictEqual(mem.prepare("SELECT nome FROM platform_whatsapp_identities WHERE id = 'id-auto'").get().nome, 'IMPORTADO');
assert.strictEqual(mem.prepare("SELECT codigo_identidade FROM platform_identity_roles WHERE id = 'r-auto-svc'").get().codigo_identidade, '187');
assert.strictEqual(mem.prepare("SELECT codigo_identidade FROM platform_identity_roles WHERE id = 'r-auto-iac'").get().codigo_identidade, '186', 'vínculo do IA Command intocado');

// 6. Número só do IA Service: pode trocar nome/telefone, mas não para um telefone já usado.
numeros.salvar(EMP, { id: novo.id, nome: 'NOVO RENOMEADO', numero: '5565944449999', idSoftexpert: '784' });
assert.strictEqual(mem.prepare('SELECT numero_normalizado FROM platform_whatsapp_identities WHERE id = ?').get(novo.id).numero_normalizado, '5565944449999');
erroCom(() => numeros.salvar(EMP, { id: novo.id, nome: 'N', numero: '5565922220000', idSoftexpert: '784' }), 409);

// 7. Inativar: desliga só o vínculo do IA Service, vira manual (a importação
// não reativa), o login para de enxergar e o IA Command segue liberado.
numeros.definirLiberado(EMP, 'id-auto', false);
const svcAuto = mem.prepare("SELECT * FROM platform_identity_roles WHERE id = 'r-auto-svc'").get();
assert.strictEqual(svcAuto.liberado, 0);
assert.strictEqual(svcAuto.origem_sistema, null);
assert.strictEqual(svcAuto.origem_id, null);
assert.strictEqual(mem.prepare("SELECT liberado FROM platform_identity_roles WHERE id = 'r-auto-iac'").get().liberado, 1);
assert.strictEqual(mem.prepare("SELECT ativo FROM platform_whatsapp_identities WHERE id = 'id-auto'").get().ativo, 1, 'número segue ativo no cadastro geral');
assert.strictEqual(loginEnxerga('5565922220000', EMP), false);
assert.strictEqual(numeros.listar(EMP).find(i => i.id === 'id-auto').situacao, 'inativo');
numeros.salvar(EMP, { id: 'id-auto', numero: '5565922220000', idSoftexpert: '187' });
assert.strictEqual(loginEnxerga('5565922220000', EMP), false, 'editar não reativa sozinho');
numeros.definirLiberado(EMP, 'id-auto', true);
assert.strictEqual(loginEnxerga('5565922220000', EMP), true);

// 8. Número inativo no cadastro geral aparece como tal.
mem.prepare("UPDATE platform_whatsapp_identities SET ativo = 0 WHERE id = 'id-iac'").run();
assert.strictEqual(numeros.listar(EMP).find(i => i.id === 'id-iac').situacao, 'inativo_cadastro');

// 9. Isolamento entre empresas e números sem vínculo do IA Service.
erroCom(() => numeros.salvar(EMP, { id: 'id-outra', numero: '5565933330000', idSoftexpert: '9' }), 404);
erroCom(() => numeros.definirLiberado(EMP, 'id-outra', false), 404);
assert.strictEqual(mem.prepare("SELECT liberado FROM platform_identity_roles WHERE id = 'r-outra'").get().liberado, 1);
identidade('id-so-iac2', EMP, '5565966660000', 'SO IAC 2');
role('r-so-iac2', 'id-so-iac2', EMP, 'ia-command', 'compras');
erroCom(() => numeros.definirLiberado(EMP, 'id-so-iac2', false), 404);
erroCom(() => numeros.salvar(EMP, { id: 'id-so-iac2', numero: '5565966660000', idSoftexpert: '1' }), 404);

// ── Rotinas por API do IA Service ─────────────────────────────────────────────
let guarda;
aplicarRotinasPorPrefixo({ use: (prefixo, fn) => { assert.strictEqual(prefixo, '/api/ia-service'); guarda = fn; } });
function chamar(caminho, session, rotinas) {
  if (rotinas) rotinasPorUsuario.set(`${session.user_id}:${EMP}`, rotinas);
  const r = { passou: false, status: 200 };
  const res = { status(c) { r.status = c; return this; }, json() { return this; } };
  guarda({ baseUrl: '/api/ia-service', path: caminho, session, svcEmpresaId: EMP }, res, () => { r.passou = true; });
  return r;
}
const usuario = { role: 'usuario', user_id: 501 };
const soNumeros = ['svc-numeros-autorizados'];
for (const p of ['/config/ia', '/config/ia/testar', '/base-historica/fontes/1/zerar-base', '/base-historica/agente-local/token',
  '/consultores', '/homologacao/resumo', '/radar/config', '/atendimentos/1/mensagens', '/anexos/1/download']) {
  const r = chamar(p, usuario, soNumeros);
  assert.strictEqual(r.passou, false, `${p} deveria exigir rotina`);
  assert.strictEqual(r.status, 403);
}
assert.strictEqual(chamar('/presenca', usuario, soNumeros).passou, true, 'presença fica liberada');
assert.strictEqual(chamar('/numeros-autorizados', usuario, soNumeros).passou, true, 'guarda própria na rota');
assert.strictEqual(chamar('/config/ia', { role: 'admin' }).passou, true, 'admin passa');
assert.strictEqual(chamar('/base-historica/agente-local/token', usuario, ['svc-config-ia']).passou, true);
assert.strictEqual(chamar('/base-historica/fontes', usuario, ['svc-config-ia']).passou, false, 'agente local não libera a Base Histórica');
assert.strictEqual(chamar('/atendimentos/1', usuario, ['svc-radar']).passou, true);
assert.strictEqual(chamar('/radar/fila', usuario, ['svc-atendimentos']).passou, false);
assert.strictEqual(chamar('/config/ia', { role: 'usuario', user_id: 777 }).passou, false, 'sem permissão configurada = bloqueado');

// ── Travas de admin no IAHub ──────────────────────────────────────────────────
function rotasDe(arquivo) {
  const rotas = {};
  const reg = (m) => (caminho, ...mws) => { rotas[`${m} ${caminho}`] = mws; };
  require(path.join('../../IAHUB/backend', arquivo))({ get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE') }, { requireAuth: (q, s, n) => n() });
  return rotas;
}
function executar(mws, session, params = {}) {
  const r = { status: 200, chegouNoHandler: false };
  const res = { status(c) { r.status = c; return this; }, json() { return this; }, setHeader() {} };
  let i = 0;
  const handler = mws[mws.length - 1];
  const prox = () => {
    const mw = mws[i++];
    if (mw === handler) { r.chegouNoHandler = true; return; }
    mw({ session, params, body: {}, query: {} }, res, prox);
  };
  prox();
  return r;
}
const comum = { authenticated: true, role: 'usuario', user_id: 501 };
const admin = { authenticated: true, role: 'admin', user_id: 1 };
const travadas = {
  'usuarios/routes': ['GET /api/usuarios', 'GET /api/usuarios/:id', 'POST /api/usuarios', 'PUT /api/usuarios/:id', 'PUT /api/usuarios/:id/senha', 'DELETE /api/usuarios/:id'],
  'permissoes/routes': ['PUT /api/permissoes/:usuarioId'],
  'empresas/routes': ['POST /api/empresas', 'PUT /api/empresas/:id', 'DELETE /api/empresas/:id'],
  'seguranca/routes': ['PUT /api/seguranca', 'GET /api/seguranca/auditoria'],
};
for (const [arq, chaves] of Object.entries(travadas)) {
  const rotas = rotasDe(arq);
  for (const k of chaves) {
    assert.ok(rotas[k], `rota ${k} não encontrada`);
    const negado = executar(rotas[k], comum);
    assert.strictEqual(negado.chegouNoHandler, false, `${k} não pode aceitar usuário comum`);
    assert.strictEqual(negado.status, 403);
    assert.strictEqual(executar(rotas[k], admin).chegouNoHandler, true, `${k} deve aceitar admin`);
  }
}
const rotasUsu = rotasDe('usuarios/routes');
assert.strictEqual(executar(rotasUsu['POST /api/usuarios/minha-senha'], comum).chegouNoHandler, true, 'trocar a própria senha continua liberado');
const rotasPerm = rotasDe('permissoes/routes');
assert.strictEqual(executar(rotasPerm['GET /api/minhas-rotinas'], comum).chegouNoHandler, true);

console.log('numeros-autorizados.test.js: OK');
