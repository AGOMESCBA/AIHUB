const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const database = require('../backend/database');
const db = database.inicializarDB(':memory:');
const fontes = require('../backend/repositories/agente-local-repository');
const consultores = require('../backend/repositories/consultor-repository');
const clientes = require('../backend/repositories/cliente-repository');
const chamados = require('../backend/repositories/chamado-repository');
const platform = require('../../IAHUB/backend/platform-store');
const originalListar = platform.listarIaServicePorTelefone;
let ativo = true;
platform.listarIaServicePorTelefone = () => ativo ? [{ empresaId: 99101, idSoftexpert: 'ana-1', ativo: true }] : [];
const service = require('../backend/services/retorno-softexpert-service');
const registrarRotas = require('../backend/routes/retorno-softexpert-routes');
const soap = require('../backend/services/softexpert-soap-client');

const fonte = fontes.criarFonte(99101, { connectionKey: 'teste', nome: 'Teste isolado', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
const tecnico = clientes.upsertTecnico(99101, { sistemaOrigem: 'softexpert', idOrigem: 'ana-1', nome: 'Analista' }).tecnico;
const consultor = consultores.upsertConsultorPlatform(99101, { platformIdentityId: 'teste-ana', telefone: '5565999999999', idSoftexpert: 'ana-1', ativo: true });
const chamado = chamados.upsertChamado(99101, { fonteId: fonte.id, oidOrigem: 'oid-teste', numero: '00012345', sistemaOrigem: 'softexpert', tecnicoResponsavelId: tecnico.id }).chamado;
const context = { empresaId: 99101, consultorId: consultor.id, chamadoId: chamado.id };
const entrada = () => ({ confirmado: true, idempotencyKey: crypto.randomUUID(), campos: { DESCRICAO: 'Descrição aprovada <teste> & dados.' } });
const response = (fields) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:w="urn:workflow"><s:Body><w:newChildEntityRecordResponse>${fields}</w:newChildEntityRecordResponse></s:Body></s:Envelope>`;
after(() => { platform.listarIaServicePorTelefone = originalListar; database.fecharDB(); });

test('formulário autorizado informa bloqueio e não expõe configuração sensível', () => {
  const result = service.obterFormulario(context);
  assert.equal(result.numero, '00012345');
  assert.equal(result.disponivel, false);
  assert.equal(JSON.stringify(result).includes('token'), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM retornos_softexpert').get().n, 0);
});
test('isolamento e autorização atual são exigidos para preparar retorno', () => {
  assert.throws(() => service.obterFormulario({ ...context, empresaId: 99102 }), { status: 404 });
  assert.throws(() => service.obterFormulario({ ...context, consultorId: null }), { status: 401 });
  ativo = false;
  try { assert.throws(() => service.obterFormulario(context), { status: 403 }); } finally { ativo = true; }
  db.prepare('UPDATE chamados SET tecnico_responsavel_id = NULL WHERE id = ?').run(chamado.id);
  try { assert.throws(() => service.obterFormulario(context), { status: 403 }); } finally { db.prepare('UPDATE chamados SET tecnico_responsavel_id = ? WHERE id = ?').run(tecnico.id, chamado.id); }
  db.prepare('UPDATE chamados SET status_encerramento = ? WHERE id = ?').run('Encerrado', chamado.id);
  try { assert.throws(() => service.obterFormulario(context), { status: 409 }); } finally { db.prepare('UPDATE chamados SET status_encerramento = NULL WHERE id = ?').run(chamado.id); }
});
test('confirmação, descrição e campos permitidos são obrigatórios', () => {
  assert.throws(() => service.registrar(context, { ...entrada(), confirmado: false }), { status: 400 });
  assert.throws(() => service.registrar(context, { ...entrada(), campos: { DESCRICAO: ' ' } }), { status: 400 });
  assert.throws(() => service.registrar(context, { ...entrada(), campos: { DESCRICAO: 'x', UserID: 'outro' } }), { status: 400 });
  assert.throws(() => service.registrar(context, entrada(), [{ originalname: 'arquivo.exe', mimetype: 'application/octet-stream', size: 1, buffer: Buffer.from('x') }]), { status: 400 });
});
test('tentativa bloqueada é idempotente, auditada sem Memo e sem sucesso fictício', () => {
  const dados = entrada();
  const first = service.registrar(context, dados);
  const again = service.registrar(context, dados);
  assert.equal(first.tentativaId, again.tentativaId);
  assert.equal(first.status, 'bloqueado_configuracao');
  assert.equal(first.posicionamento, 'nao_enviado');
  assert.equal(db.prepare('SELECT count(*) AS n FROM retornos_softexpert').get().n, 1);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM retornos_softexpert').get()).includes(dados.campos.DESCRICAO), false);
  assert.throws(() => service.registrar(context, { ...dados, campos: { DESCRICAO: 'outro' } }), { status: 409 });
});
test('SOAP escapa o Memo e exige identificadores explícitos', () => {
  const xml = soap.montarInclusaoGrid({ workflowId: '0001', mainEntityId: 'principal', childRelationshipId: 'filho', campos: { descricao: '<texto> & "teste"' } });
  assert.ok(xml.includes('&lt;texto&gt; &amp; &quot;teste&quot;'));
  assert.throws(() => soap.montarInclusaoGrid({ workflowId: '1', campos: {} }));
  assert.throws(() => soap.escaparXml('\u0000'));
});
test('SOAP aceita namespaces e rejeita DTD, respostas falsas e campos duplicados', () => {
  const fields = '<w:Status>SUCCESS</w:Status><w:Code>1</w:Code><w:RecordKey>oid-1</w:RecordKey>';
  assert.equal(soap.interpretarResposta(response(fields)).RecordKey, 'oid-1');
  assert.throws(() => soap.interpretarResposta('<!DOCTYPE x>' + response(fields)));
  assert.throws(() => soap.interpretarResposta(response(fields + '<w:Status>SUCCESS</w:Status>')));
  assert.throws(() => soap.interpretarResposta('<x><Status>SUCCESS</Status><Code>1</Code></x>'));
  assert.throws(() => soap.interpretarResposta(response('<w:Status>SUCCESS</w:Status>')));
  assert.throws(() => soap.interpretarResposta(response('').replace('</s:Body>', '<bad:newChildEntityRecordResponse xmlns:bad="urn:outro"><w:Status>SUCCESS</w:Status><w:Code>1</w:Code></bad:newChildEntityRecordResponse></s:Body>')));
});
test('transporte bloqueia HTTP, origem com caminho e autenticação não validada antes da rede', async () => {
  await assert.rejects(soap.enviarInclusaoGrid({ origem: 'http://localhost', apiKey: 'fake', authorizationMode: 'jwt', encoding: 'utf8', xml: 'x' }));
  await assert.rejects(soap.enviarInclusaoGrid({ origem: 'https://localhost/externo', apiKey: 'fake', authorizationMode: 'jwt', encoding: 'utf8', xml: 'x' }));
  await assert.rejects(soap.enviarInclusaoGrid({ origem: 'https://localhost', apiKey: 'fake', encoding: 'utf8', xml: 'x' }));
  await assert.rejects(soap.enviarInclusaoGrid({ origem: 'https://localhost', apiKey: 'fake', authorizationMode: 'jwt', encoding: 'latin1', xml: '😀' }));
});
test('rotas HTTP exigem sessão e preservam bloqueio no POST confirmado', async () => {
  const app = express();
  app.use((req, res, next) => {
    if (req.headers.authorization !== 'teste-local') return res.sendStatus(401);
    req.svcEmpresaId = context.empresaId;
    req.svcConsultorExterno = context.consultorId;
    next();
  });
  registrarRotas(app, '/api/ia-service-externo');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/ia-service-externo/radar/chamados/${chamado.id}/retorno`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const headers = { Authorization: 'teste-local' };
    assert.equal((await (await fetch(url, { headers })).json()).disponivel, false);
    const body = new FormData();
    body.append('dados', JSON.stringify(entrada()));
    const result = await fetch(url, { method: 'POST', headers, body });
    assert.equal(result.status, 409);
    assert.equal((await result.json()).anexos, 'nao_enviados');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('configuração validada conecta o serviço real somente após prova de OTP', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retorno-config-'));
  const file = path.join(dir, 'config.json');
  const previousConfig = process.env.SVC_SOFTEXPERT_RETORNO_CONFIG;
  const previousKey = process.env.RETORNO_TEST_KEY;
  const originalSoap = soap.enviarOperacao;
  const importService = require('../backend/services/import/historical-import-service');
  const originalImport = importService.atualizarChamadosPorIds;
  let calls = 0;
  const contrato = {
    empresaId: context.empresaId, fonteId: fonte.id, contratoValidado: true, envioHabilitado: true,
    evidenciaContrato: 'fixture automatizada', origem: 'https://invalid.example', authorizationMode: 'jwt', encoding: 'utf8',
    mainEntityId: 'principal-fixture', childRelationshipId: 'rel-fixture', campos: { DESCRICAO: { id: 'memo-fixture', tipo: 'texto', obrigatorio: true } },
    autoria: { validada: true, modo: 'credencial_analista', analistas: { 'ana-1': { apiKeyEnv: 'RETORNO_TEST_KEY', userId: 'ana-fixture' } } },
    historico: { modo: 'desabilitado' },
  };
  fs.writeFileSync(file, JSON.stringify({ versao: 1, empresas: [contrato] }));
  process.env.SVC_SOFTEXPERT_RETORNO_CONFIG = file;
  process.env.RETORNO_TEST_KEY = 'credencial-falsa-sem-rede';
  soap.enviarOperacao = async () => { calls++; return { Status: 'SUCCESS', Code: '1', RecordKey: 'chave-fixture' }; };
  importService.atualizarChamadosPorIds = async () => ({ erros: [], naoEncontrados: [] });
  try {
    assert.equal(service.obterFormulario(context).disponivel, false);
    const strong = { ...context, otpVerificadoEm: new Date().toISOString() };
    const metadata = service.obterFormulario(strong);
    assert.equal(metadata.disponivel, true);
    assert.equal(JSON.stringify(metadata).includes('credencial-falsa'), false);
    assert.throws(() => service.registrar(context, entrada()), { status: 401 });
    const dados = entrada();
    const result = await service.registrar(strong, dados);
    assert.equal(result.status, 'registrado');
    assert.equal(calls, 1);
    await service.registrar(strong, dados);
    assert.equal(calls, 1);
    assert.equal(service.consultarPorChave(strong, dados.idempotencyKey).tentativaId, result.tentativaId);
    assert.throws(() => service.consultarPorChave({ ...strong, empresaId: 99102 }, dados.idempotencyKey), { status: 404 });
    contrato.envioHabilitado = false;
    fs.writeFileSync(file, JSON.stringify({ versao: 1, empresas: [contrato] }));
    assert.equal(service.obterFormulario(strong).disponivel, false);
  } finally {
    soap.enviarOperacao = originalSoap;
    importService.atualizarChamadosPorIds = originalImport;
    if (previousConfig === undefined) delete process.env.SVC_SOFTEXPERT_RETORNO_CONFIG; else process.env.SVC_SOFTEXPERT_RETORNO_CONFIG = previousConfig;
    if (previousKey === undefined) delete process.env.RETORNO_TEST_KEY; else process.env.RETORNO_TEST_KEY = previousKey;
    fs.unlinkSync(file); fs.rmdirSync(dir);
  }
});
