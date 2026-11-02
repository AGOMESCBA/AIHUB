// Formulário de Números Autorizados (2026-10-30): tudo o que o acesso ao chat
// precisa, gravado pela rota. Executar:
// node "apps/IA Service/tests/numeros-autorizados-rotas.test.js"
//
// Banco da Platform em memória e repositórios substituídos antes do require:
// nunca toca em data/.

const assert = require('assert');
const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('../../IAHUB/backend/platform-schema');

const mem = new Database(':memory:');
ensurePlatformSchema(mem);

function simular(caminho, exports) {
  const id = require.resolve(caminho);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const USUARIOS = [
  { id: 7, nome: 'Com Acesso', ativo: true, email: 'nao@expor.com' },
  { id: 8, nome: 'Sem Acesso', ativo: true },
  { id: 9, nome: 'Inativo', ativo: false },
];
const consultores = new Map();
const chamadasUpsert = [];
const desvinculados = [];

simular('../../IAHUB/backend/platform-store', { getDB: () => mem });
simular('../../IAHUB/backend/usuarios/database', { listar: () => USUARIOS, buscarPorId: (id) => USUARIOS.find((u) => u.id === id) });
simular('../../IAHUB/backend/sistemas/database', { hasUserSystem: (u) => u === 7 || u === 70 });
simular('../../IAHUB/backend/empresas/database', { buscarPorId: () => ({ nome_fantasia: 'Empresa Teste' }) });
simular('../backend/services/presenca-service', { registrarAuditoria() {} });
simular('../backend/services/rotina-permissao', { requireRotinaSvc: () => (req, res, next) => next() });
simular('../backend/repositories/cliente-repository', {
  listarTecnicos: () => [{ idOrigem: '784', nome: 'Técnico A' }, { idOrigem: '784', nome: 'Repetido' }, { idOrigem: null, nome: 'Sem ID' }],
});
simular('../backend/repositories/consultor-repository', {
  getConsultorPorUsuario: (e, u) => consultores.get(u) || null,
  upsertConsultorPlatform: (e, d) => { chamadasUpsert.push(d); return { id: d.platformIdentityId, usuarioIdIahub: d.usuarioIdIahub || 7 }; },
  desvincularUsuario: (e, id) => desvinculados.push(id),
});

const rotas = require('../backend/routes/numeros-autorizados-routes');
const numeros = require('../../IAHUB/backend/platform-numeros-ia-service');

const EMP = 99401;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.svcEmpresaId = EMP; req.session = { user_id: 1 }; next(); });
rotas.registrar(app);

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://127.0.0.1:${servidor.address().port}/api/ia-service/numeros-autorizados`;
  const pedir = async (sufixo, corpo) => {
    const r = await fetch(base + sufixo, corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : {});
    return { status: r.status, body: await r.json() };
  };
  const item = (id) => numeros.listar(EMP).find((i) => i.id === id);
  const meta = (id) => JSON.parse(mem.prepare('SELECT metadata_json FROM platform_identity_roles WHERE identity_id = ?').get(id).metadata_json);
  const base1 = { nome: 'Fulano', numero: '5565999990001', idSoftexpert: '784' };

  try {
    // Opções: só o necessário, sem repetir técnico e sem usuário fora do sistema.
    const op = await pedir('/opcoes');
    assert.strictEqual(op.status, 200);
    assert.deepStrictEqual(op.body.usuarios, [{ id: 7, nome: 'Com Acesso' }]);
    assert.deepStrictEqual(op.body.tecnicos, [{ idSoftexpert: '784', nome: 'Técnico A' }]);
    assert.strictEqual(op.body.empresa.nome, 'Empresa Teste');
    assert.strictEqual(op.body.linkAcesso, '/iaservice');

    // Usuário sem acesso não entra no vínculo e nada é gravado.
    assert.strictEqual((await pedir('', { ...base1, usuarioIdIahub: 8 })).status, 400);
    assert.strictEqual(numeros.listar(EMP).length, 0);

    // Inclusão completa: vínculo, situação e analista já sincronizado.
    const novo = await pedir('', { ...base1, usuarioIdIahub: 7, liberado: true });
    assert.strictEqual(novo.status, 201);
    const id = novo.body.id;
    assert.strictEqual(item(id).usuarioIdIahub, 7);
    assert.strictEqual(meta(id).usuarioIdIahub, 7, 'login lê também do vínculo');
    assert.strictEqual(chamadasUpsert.at(-1).usuarioIdIahub, 7);
    assert.strictEqual(chamadasUpsert.at(-1).ativo, true);

    // Mesmo usuário em outro número faria o login do segundo falhar.
    const dup = await pedir('', { nome: 'Outro', numero: '5565999990002', idSoftexpert: '1', usuarioIdIahub: 7 });
    assert.strictEqual(dup.status, 409);
    assert.match(dup.body.error, /Fulano/);

    // Editar sem mandar o campo mantém; a edição inativa pelo próprio formulário.
    await pedir('', { id, ...base1, papel: 'gestor' });
    assert.strictEqual(item(id).usuarioIdIahub, 7);
    assert.strictEqual(item(id).papel, 'gestor');
    assert.strictEqual(item(id).liberado, true, 'sem o campo a situação não muda');
    await pedir('', { id, ...base1, liberado: false });
    assert.strictEqual(item(id).situacao, 'inativo');
    assert.strictEqual(chamadasUpsert.at(-1).ativo, false);
    await pedir('', { id, ...base1, liberado: true });
    assert.strictEqual(item(id).situacao, 'ativo');

    // Inativar pelo botão da lista não perde o vínculo.
    numeros.definirLiberado(EMP, id, false);
    assert.strictEqual(item(id).usuarioIdIahub, 7);
    numeros.definirLiberado(EMP, id, true);

    // Tirar o vínculo limpa os dois lugares e também o analista.
    await pedir('', { id, ...base1, usuarioIdIahub: null });
    assert.strictEqual(item(id).usuarioIdIahub, null);
    assert.ok(!meta(id).usuarioIdIahub);
    assert.deepStrictEqual(desvinculados, [id]);

    // Analista antigo do usuário com outro telefone: conflito antes de gravar.
    consultores.set(70, { id: 'antigo', telefone: '5565911112222' });
    assert.strictEqual((await pedir('', { id, ...base1, usuarioIdIahub: 70 })).status, 409);
    assert.strictEqual(item(id).usuarioIdIahub, null);
    // Mesmo telefone é o mesmo analista: permitido.
    consultores.set(70, { id: 'antigo', telefone: '+55 65 99999-0001' });
    assert.strictEqual((await pedir('', { id, ...base1, usuarioIdIahub: 70 })).status, 200);

    // Novo número inativo por escolha nasce sem liberar o login.
    const inat = await pedir('', { nome: 'Depois', numero: '5565999990003', idSoftexpert: '2', liberado: false });
    assert.strictEqual(item(inat.body.id).situacao, 'inativo');

    // Número já existente, inativo no cadastro geral: a tela é avisada.
    mem.prepare(`INSERT INTO platform_whatsapp_identities (id, empresa_id, nome, numero, numero_normalizado, ativo, metadata_json, criado_em, atualizado_em)
      VALUES ('geral', ?, 'Geral', '5565999990004', '5565999990004', 0, '{}', 'x', 'x')`).run(EMP);
    const geral = await pedir('', { nome: 'Geral', numero: '5565999990004', idSoftexpert: '3' });
    assert.strictEqual(geral.body.inativoCadastro, true);
    assert.strictEqual(item('geral').situacao, 'inativo_cadastro');

    console.log('numeros-autorizados-rotas.test.js: OK');
  } finally {
    servidor.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
