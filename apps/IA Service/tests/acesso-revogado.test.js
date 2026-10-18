// Revogação de acesso (2026-10, revisão de segurança): analista desativado,
// removido ou com o vínculo IA Service revogado na Platform perde a sessão do
// J2A (e do Chat interno) na próxima requisição — antes a sessão seguia viva.
// Executar: node "apps/IA Service/tests/acesso-revogado.test.js"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

delete process.env.SVC_ALLOW_LEGACY_CONSULTORES; // modo de produção: Platform é a fonte
process.env.SVC_DATA_CRYPTO_KEY = process.env.SVC_DATA_CRYPTO_KEY || crypto.randomBytes(32).toString('base64');

// Platform simulada: controla quem está liberado e se ela está instalada.
const platform = { liberados: new Map(), instalada: true };
const platformPath = require.resolve('../../IAHUB/backend/platform-store');
require.cache[platformPath] = {
  id: platformPath, filename: platformPath, loaded: true,
  exports: {
    listarIaServicePorTelefone: (tel) => (platform.liberados.get(tel) || []),
    iaServicePlatformDisponivel: () => platform.instalada,
    getAiConfig: () => null, getSearchConfig: () => null, getAgentConfig: () => null,
    getConfigPorApelido: () => null, obterEstiloResposta: () => null, definirEstiloResposta: () => null,
  },
};

const dbTmpPath = path.join(os.tmpdir(), `ia-service-acesso-revogado-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);
const consultorRepo = require('../backend/repositories/consultor-repository');
const login = require('../backend/services/login-externo-service');

const EMPRESA = 99401;
const TEL = '5565990001111';

function sessao(consultorId) {
  const token = crypto.randomBytes(32).toString('hex');
  const id = crypto.randomUUID();
  database.getDB().prepare('INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, EMPRESA, consultorId, crypto.createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 3600e3).toISOString(), new Date().toISOString(), new Date().toISOString());
  return { token, id };
}
const liberar = (consultor) => platform.liberados.set(TEL, [{ platformIdentityId: consultor.id, empresaId: EMPRESA, telefone: TEL, ativo: true, idSoftexpert: 'T-1', preAnaliseAutomatica: true, atualizadoEm: new Date().toISOString() }]);
// O sincronismo tem throttle de 30s por consultor: cada cenário usa um consultor novo.
let n = 0;
function novoConsultor() {
  n += 1;
  return consultorRepo.criarConsultor(EMPRESA, { telefone: TEL.slice(0, -2) + String(n).padStart(2, '0'), idSoftexpert: `T-${n}` });
}

try {
  // 1. Liberado na Platform: sessão válida.
  let c = novoConsultor();
  platform.liberados.clear();
  platform.liberados.set(c.telefone, [{ platformIdentityId: c.id, empresaId: EMPRESA, telefone: c.telefone, ativo: true, idSoftexpert: c.idSoftexpert, preAnaliseAutomatica: true, atualizadoEm: new Date().toISOString() }]);
  let s = sessao(c.id);
  assert.ok(login.validarSessaoExterna(s.token), 'liberado na Platform deve entrar');

  // 2. Desativado/removido na Platform (some da lista): perde a sessão na hora.
  c = novoConsultor();
  platform.liberados.clear();
  s = sessao(c.id);
  assert.strictEqual(login.validarSessaoExterna(s.token), null, 'removido da Platform não pode seguir logado');
  assert.strictEqual(consultorRepo.getConsultor(EMPRESA, c.id).ativo, false, 'consultor fica inativo');
  const exp = database.getDB().prepare('SELECT expira_em FROM svc_sessoes_externas WHERE id = ?').get(s.id).expira_em;
  assert.ok(new Date(exp).getTime() < Date.now(), 'sessão é expirada (não apagada)');
  assert.strictEqual(login.sessaoExternaAtiva(s.id), false, 'socket do chat também cai');

  // 3. Platform NÃO instalada: nunca desativa em massa.
  c = novoConsultor();
  platform.liberados.clear();
  platform.instalada = false;
  s = sessao(c.id);
  assert.ok(login.validarSessaoExterna(s.token), 'sem Platform instalada, ninguém é derrubado');
  assert.strictEqual(consultorRepo.getConsultor(EMPRESA, c.id).ativo, true);
  platform.instalada = true;

  // 4. Erro ao ler a Platform: falha não pode derrubar ninguém.
  c = novoConsultor();
  const original = require.cache[platformPath].exports.listarIaServicePorTelefone;
  require.cache[platformPath].exports.listarIaServicePorTelefone = () => { throw new Error('banco da Platform travado'); };
  s = sessao(c.id);
  assert.ok(login.validarSessaoExterna(s.token), 'erro de leitura da Platform não desativa');
  require.cache[platformPath].exports.listarIaServicePorTelefone = original;

  // 5. Consultor inativo direto no IA Service: sessão recusada e socket derrubado.
  c = novoConsultor();
  consultorRepo.atualizarConsultor(EMPRESA, c.id, { ativo: false });
  s = sessao(c.id);
  assert.strictEqual(login.validarSessaoExterna(s.token), null);
  assert.strictEqual(login.sessaoExternaAtiva(s.id), false);

  console.log('acesso-revogado.test.js: OK');
} finally {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
}
