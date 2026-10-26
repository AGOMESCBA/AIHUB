// Regressao 2026-10-26 (producao): dois analistas da mesma empresa com o
// mesmo ID SoftExpert (957) na Platform. O login acha o analista PELO TELEFONE
// e grava nele o ID do cadastro dele; o indice unico (empresa, id_softexpert)
// recusava e o usuario via "Numero nao encontrado". Regra do usuario: ID
// repetido nunca bloqueia o login, e o login de um nunca altera o cadastro do outro.
// Executar: node --test "apps/IA Service/tests/login-softexpert-duplicado.test.js"
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SVC_WHATSAPP_OTP_SECRET = process.env.SVC_WHATSAPP_OTP_SECRET || 'teste-secret';

const dbTmpPath = path.join(os.tmpdir(), `ia-service-softexpert-dup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const crud = require('../../IAHUB/backend/crud');
const consultorRepo = require('../backend/repositories/consultor-repository');
const platformStore = require('../../IAHUB/backend/platform-store');
const loginExternoService = require('../backend/services/login-externo-service');

const EMPRESA = 98702;
const ALESSANDRO = '5565999875116';
const COLEGA = '5565996677865';
const NOVO = '5565988887777';

const originalLista = platformStore.listarIaServicePorTelefone;
const originalBuscar = crud.buscarPorId;
after(() => {
  platformStore.listarIaServicePorTelefone = originalLista;
  crud.buscarPorId = originalBuscar;
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
});

// Platform: os tres telefones apontam para o ID SoftExpert 957.
const platform = {
  [ALESSANDRO]: { platformIdentityId: 'ident-alessandro', usuarioIdIahub: 1 },
  [COLEGA]: { platformIdentityId: 'ident-colega', usuarioIdIahub: null },
  [NOVO]: { platformIdentityId: 'ident-novo', usuarioIdIahub: null },
};
platformStore.listarIaServicePorTelefone = tel => (platform[tel] ? [{
  ...platform[tel], empresaId: EMPRESA, telefone: tel, ativo: true, idSoftexpert: '957',
  preAnaliseAutomatica: true, atualizadoEm: new Date().toISOString(),
}] : []);
crud.buscarPorId = (tabela, id) => (tabela === 'empresas' && Number(id) === EMPRESA ? { id: EMPRESA, razao_social: 'J2A Teste' } : originalBuscar(tabela, id));

const db = database.getDB();
const lerPorTelefone = tel => db.prepare('SELECT * FROM consultores WHERE empresa_id = ? AND telefone = ?').get(EMPRESA, tel);

test('migration v53 troca o índice único de ID SoftExpert por índice comum; telefone segue único', () => {
  const indices = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'consultores'").all();
  assert.ok(!indices.some(i => i.name === 'idx_svc_consultores_softexpert'));
  assert.ok(indices.some(i => i.name === 'idx_svc_consultores_empresa_softexpert' && !/UNIQUE/i.test(i.sql)));
  assert.ok(indices.some(i => i.name === 'idx_svc_consultores_empresa_telefone' && /UNIQUE/i.test(i.sql)));
});

test('cenário de produção: colega já tem 957 e o login do Alessandro (ID antigo 12) entra pelo telefone', () => {
  // Estado real encontrado em produção.
  db.prepare(`INSERT INTO consultores (id, usuario_id_iahub, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`).run('ident-alessandro', 1, EMPRESA, '12', ALESSANDRO, '2026-10-01', '2026-10-01');
  db.prepare(`INSERT INTO consultores (id, usuario_id_iahub, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`).run('ident-colega', null, EMPRESA, '957', COLEGA, '2026-10-26', '2026-10-26');

  const empresas = loginExternoService.listarEmpresasDoTelefone(ALESSANDRO);
  assert.deepEqual(empresas.map(e => [e.id, e.consultorId]), [[EMPRESA, 'ident-alessandro']]);
  assert.equal(lerPorTelefone(ALESSANDRO).id_softexpert, '957', 'usa o ID do cadastro do telefone');
  const colega = lerPorTelefone(COLEGA);
  assert.equal(colega.id, 'ident-colega');
  assert.equal(colega.id_softexpert, '957', 'cadastro do colega intacto');

  const login = loginExternoService.iniciarLogin(ALESSANDRO);
  assert.ok(login.challengeId);
});

test('telefone novo com ID repetido ganha cadastro próprio e não sobrescreve o colega', () => {
  const empresas = loginExternoService.listarEmpresasDoTelefone(NOVO);
  assert.equal(empresas.length, 1);
  const novo = lerPorTelefone(NOVO);
  assert.ok(novo, 'criou registro para o telefone novo');
  assert.equal(novo.id_softexpert, '957');
  assert.equal(lerPorTelefone(COLEGA).telefone, COLEGA);
  assert.equal(lerPorTelefone(ALESSANDRO).telefone, ALESSANDRO);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM consultores WHERE empresa_id = ? AND id_softexpert = ?').get(EMPRESA, '957').n, 3);
});
