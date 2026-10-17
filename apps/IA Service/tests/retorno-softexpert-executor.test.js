const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const dbModule = require('../backend/database');
const db = dbModule.inicializarDB(':memory:');
const repo = require('../backend/repositories/retorno-softexpert-repository');
const soapReal = require('../backend/services/softexpert-soap-client');
const { criarExecutor } = require('../backend/services/retorno-softexpert-executor');
const configService = require('../backend/services/retorno-softexpert-config');
after(() => dbModule.fecharDB());

function fixture({ files = 0, historico = { modo: 'desabilitado' }, responder, resolveOid = async () => 'oid-confirmado', resolveOwner = async () => ({ codigo: 'analista-fixture', nome: 'Analista responsável' }), sync = async () => {} } = {}) {
  const chamado = { id: crypto.randomUUID(), empresaId: 99001, fonteId: 'fonte-fixture', numero: '00012345', oidOrigem: 'oid-pai' };
  const consultor = { id: 'consultor-fixture', idSoftexpert: 'analista-fixture' };
  const config = { contratoHash: 'hash-fixture', userId: 'matricula-fixture', transporte: { origem: 'https://invalid.example', apiKey: 'mock-only', encoding: 'utf8', authorizationMode: 'jwt' }, contrato: {
    mainEntityId: 'entidade-fixture', childRelationshipId: 'rel-fixture', campos: { DESCRICAO: { id: 'memo-fixture', tipo: 'texto', obrigatorio: true } },
    automaticos: [{ id: 'analista-fixture', origem: 'analista_softexpert' }],
    anexos: { habilitado: true, tableId: 'anexos-fixture', relacionamentoId: 'rel-anexo-fixture', campoArquivoId: 'arquivo-fixture' }, historico,
  } };
  const calls = [];
  const soap = { ...soapReal, async enviarOperacao(request) {
    calls.push(request);
    if (responder) return responder(request, calls);
    return { Status: 'SUCCESS', Code: '1', RecordKey: 'chave-criada', RecordID: `anexo-${calls.length}` };
  } };
  const tentativaId = repo.registrarTentativa({ empresaId: chamado.empresaId, chamadoId: chamado.id, consultorId: consultor.id, origemIdentidade: 'consultor_externo', usuarioId: consultor.id, chave: crypto.randomUUID(), hash: 'payload-fixture', quantidadeAnexos: files });
  const args = { tentativaId, config, chamado, consultor, campos: { DESCRICAO: 'Retorno aprovado' }, arquivos: Array.from({ length: files }, (_, i) => ({ originalname: `arquivo-${i}.txt`, mimetype: 'text/plain', buffer: Buffer.from(`conteudo-${i}`), size: 10 })) };
  const executor = criarExecutor({ repo, soap, resolverResponsavel: resolveOwner, resolverOid: resolveOid, sincronizar: sync });
  return { args, calls, run: () => executor.executar(args) };
}

test('posicionamento sem anexos: autoria mapeada e comentário desabilitado', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 'registrado');
  assert.equal(result.historico, 'desabilitado');
  assert.deepEqual(f.calls.map((c) => c.operacao), ['newChildEntityRecord']);
  assert.ok(f.calls[0].xml.includes('<urn:EntityAttributeValue>analista-fixture</urn:EntityAttributeValue>'));
  await f.run();
  assert.equal(f.calls.length, 1, 'reenvio não recria posicionamento');
});

test('dono técnico vem da origem e prevalece sobre conta da API e valores fixos do contrato', async () => {
  const f = fixture({ resolveOwner: async () => ({ codigo: '124', nome: 'Edson Assis' }) });
  f.args.config.userId = 'se';
  f.args.consultor.idSoftexpert = '124';
  f.args.config.contrato.automaticos = [{ id: 'ANALISTAJ2A', origem: 'valor_fixo', valor: 'se Config' }, { id: 'CDUSERANA', origem: 'valor_fixo', valor: '35' }];
  await f.run();
  assert.ok(f.calls[0].xml.includes('<urn:EntityAttributeID>analistaj2a</urn:EntityAttributeID><urn:EntityAttributeValue>Edson Assis</urn:EntityAttributeValue>'));
  assert.ok(f.calls[0].xml.includes('<urn:EntityAttributeID>cduserana</urn:EntityAttributeID><urn:EntityAttributeValue>124</urn:EntityAttributeValue>'));
  assert.equal(f.calls[0].xml.includes('se Config'), false);
  assert.equal(f.calls[0].xml.includes('<urn:EntityAttributeID>CDUSERANA</urn:EntityAttributeID>'), false);
});

test('responsável ausente impede envio e libera a tentativa sem usar a conta da API como fallback', async () => {
  const f = fixture({ resolveOwner: async () => null });
  await assert.rejects(f.run(), { status: 409 });
  assert.equal(f.calls.length, 0);
  assert.equal(repo.obter(f.args.tentativaId).em_processamento, 0);
});

test('marca de origem texto4 é fixa na grid ITSM e não cria novo posicionamento na retomada', async () => {
  const f = fixture();
  f.args.config.contrato.mainEntityId = 'itsm';
  f.args.config.contrato.childRelationshipId = 'relagridregistr';
  f.args.config.contrato.automaticos = [{ id: 'TEXTO4', origem: 'valor_fixo', valor: 'Outra origem' }];
  await f.run();
  assert.match(f.calls[0].xml, /<urn:EntityAttributeID>texto4<\/urn:EntityAttributeID><urn:EntityAttributeValue>IA SERVICE<\/urn:EntityAttributeValue>/);
  assert.equal(f.calls[0].xml.includes('Outra origem'), false);
  await f.run();
  assert.equal(f.calls.length, 1);
});

test('anexo único usa arquivo2 no mesmo posicionamento e sucesso da edição não exige nova chave', async () => {
  const f = fixture({ files: 1, responder: req => ({ Status: 'SUCCESS', Code: '1', ...(req.operacao === 'newChildEntityRecord' ? { RecordKey: 'pos' } : {}) }) });
  f.args.config.contrato.anexos = { habilitado: true, destino: 'campo_grid', campoArquivoId: 'arquivo2', transporte: 'base64_inline' };
  assert.equal((await f.run()).status, 'registrado');
  assert.deepEqual(f.calls.map(c => c.operacao), ['newChildEntityRecord', 'editChildEntityRecord']);
  assert.match(f.calls[1].xml, /<urn:ChildRecordOID>oid-confirmado<\/urn:ChildRecordOID>/);
  assert.match(f.calls[1].xml, /<urn:EntityAttributeID>arquivo2<\/urn:EntityAttributeID>/);
  assert.match(f.calls[1].xml, /<urn:FileContent>Y29udGV1ZG8tMA==<\/urn:FileContent>/);
  assert.equal(f.calls[1].xml.includes('newTableRecord'), false);
  await f.run();
  assert.equal(f.calls.length, 2);
});

test('anexo único falho é retomado sem recriar posicionamento; mais de um arquivo é rejeitado', async () => {
  let falhar = true;
  const f = fixture({ files: 1, responder: req => req.operacao === 'editChildEntityRecord' && falhar ? { Status: 'FAILURE', Code: '-1' } : { Status: 'SUCCESS', Code: '1', RecordKey: 'pos' } });
  f.args.config.contrato.anexos = { habilitado: true, destino: 'campo_grid', campoArquivoId: 'arquivo2', transporte: 'base64_inline' };
  assert.equal((await f.run()).status, 'parcial');
  falhar = false;
  assert.equal((await f.run()).status, 'registrado');
  assert.deepEqual(f.calls.map(c => c.operacao), ['newChildEntityRecord', 'editChildEntityRecord', 'editChildEntityRecord']);
  const outro = fixture({ files: 2 });
  outro.args.config.contrato.anexos = f.args.config.contrato.anexos;
  await assert.rejects(outro.run(), { status: 400 });
  assert.equal(outro.calls.length, 0);
});

test('transferência na origem bloqueia escrita por antigo responsável ainda presente no cache local', async () => {
  const f = fixture({ resolveOwner: async () => ({ codigo: 'outro-responsavel', nome: 'Outro analista' }) });
  await assert.rejects(f.run(), { status: 403 });
  assert.equal(f.calls.length, 0);
});

test('retomada de anexo não resolve outro dono nem reescreve o posicionamento confirmado', async () => {
  let resolveCount = 0;
  let falhar = true;
  const f = fixture({ files: 1, resolveOwner: async () => { resolveCount++; return { codigo: '124', nome: 'Edson Assis' }; }, responder: (request) => {
    if (request.operacao === 'newTableRecord' && falhar) return { Status: 'FAILURE', Code: '-1' };
    return { Status: 'SUCCESS', Code: '1', RecordKey: 'pos', RecordID: 'anexo' };
  } });
  f.args.consultor.idSoftexpert = '124';
  assert.equal((await f.run()).status, 'parcial');
  falhar = false;
  assert.equal((await f.run()).status, 'registrado');
  assert.equal(resolveCount, 1);
  assert.equal(f.calls.filter((c) => c.operacao === 'newChildEntityRecord').length, 1);
});

test('arquivos vinculados somente ao OID confirmado do posicionamento', async () => {
  const f = fixture({ files: 2 });
  const result = await f.run();
  assert.equal(result.status, 'registrado');
  assert.deepEqual(f.calls.map((c) => c.operacao), ['newChildEntityRecord', 'newTableRecord', 'newTableRecord']);
  assert.ok(f.calls[1].xml.includes('<urn:RelatedRelationshipValue>oid-confirmado</urn:RelatedRelationshipValue>'));
  assert.equal(repo.obter(f.args.tentativaId).anexos.length, 2);
});

test('upload CID vincula a referência SOAP à parte MIME com os bytes originais', async () => {
  const f = fixture({ files: 1 });
  f.args.config.contrato.anexos.transporte = 'cid_multipart';
  assert.equal((await f.run()).status, 'registrado');
  const upload = f.calls[1];
  const anexo = upload.anexosSoap[0];
  assert.ok(upload.xml.includes(`<urn:FileContent>cid:${anexo.contentId}</urn:FileContent>`));
  const { body, contentType } = soapReal.montarCorpoRequisicao(upload.xml, 'utf8', upload.anexosSoap);
  assert.match(contentType, /^multipart\/related; type="text\/xml"/);
  assert.ok(body.includes(Buffer.from(`Content-ID: <${anexo.contentId}>\r\n\r\n`)));
  assert.ok(body.includes(anexo.conteudo));
  const boundary = /boundary="([^"]+)"/.exec(contentType)[1];
  assert.ok(body.toString().endsWith(`\r\n--${boundary}--\r\n`));
  assert.throws(() => soapReal.montarCorpoRequisicao(upload.xml, 'utf8', [{ contentId: 'x\r\nHeader: injetado', conteudo: Buffer.from('x') }]));
  assert.throws(() => soapReal.montarCorpoRequisicao(upload.xml, 'utf8', [{ contentId: 'outra-referencia', conteudo: Buffer.from('x') }]));
});

test('falha parcial de anexo: retoma somente o arquivo falho', async () => {
  let fail = true;
  const f = fixture({ files: 2, responder: (request) => {
    if (request.operacao === 'newTableRecord' && request.xml.includes('arquivo-1.txt') && fail) return { Status: 'FAILURE', Code: '-1' };
    return { Status: 'SUCCESS', Code: '1', RecordKey: 'chave', RecordID: 'anexo' };
  } });
  assert.equal((await f.run()).status, 'parcial');
  fail = false;
  assert.equal((await f.run()).status, 'registrado');
  assert.equal(f.calls.filter((c) => c.operacao === 'newChildEntityRecord').length, 1);
  assert.equal(f.calls.filter((c) => c.operacao === 'newTableRecord' && c.xml.includes('arquivo-0.txt')).length, 1);
  assert.equal(f.calls.length, 4);
});

test('timeout após criação: resultado indeterminado e nenhuma recriação', async () => {
  const f = fixture({ responder: () => { throw new Error('timeout após envio'); } });
  assert.equal((await f.run()).status, 'indeterminado');
  assert.equal((await f.run()).status, 'indeterminado');
  assert.equal(f.calls.length, 1);
  assert.throws(() => repo.registrarTentativa({ empresaId: f.args.chamado.empresaId, chamadoId: f.args.chamado.id, consultorId: f.args.consultor.id, chave: crypto.randomUUID(), hash: 'outro', quantidadeAnexos: 0, origemIdentidade: 'teste', usuarioId: 'teste' }), { status: 409 });
});

test('falha explícita no posicionamento não dispara anexos ou comentário', async () => {
  const f = fixture({ files: 1, responder: () => ({ Status: 'FAILURE', Code: '-9' }) });
  assert.equal((await f.run()).status, 'falhou');
  assert.deepEqual(f.calls.map((c) => c.operacao), ['newChildEntityRecord']);
});

test('timeout de anexo não recria o arquivo nem o posicionamento', async () => {
  const f = fixture({ files: 1, responder: (req) => {
    if (req.operacao === 'newTableRecord') throw new Error('timeout após upload');
    return { Status: 'SUCCESS', Code: '1', RecordKey: 'chave' };
  } });
  assert.equal((await f.run()).status, 'indeterminado');
  assert.equal((await f.run()).status, 'indeterminado');
  assert.equal(f.calls.length, 2);
});

test('sucesso de upload sem identificador exige reconciliação, sem reenviar', async () => {
  const f = fixture({ files: 1, responder: req => ({ Status: 'SUCCESS', Code: '1', ...(req.operacao === 'newChildEntityRecord' ? { RecordKey: 'chave' } : {}) }) });
  assert.equal((await f.run()).status, 'indeterminado');
  await f.run();
  assert.equal(f.calls.length, 2);
});

test('upload aceita RecordKey do WSDL instalado sem reenviar arquivo confirmado', async () => {
  const f = fixture({ files: 2, responder: () => ({ Status: 'SUCCESS', Code: '1', RecordKey: 'chave-instalada' }) });
  assert.equal((await f.run()).status, 'registrado');
  assert.ok(repo.obter(f.args.tentativaId).anexos.every(a => a.registro_id === 'chave-instalada'));
  await f.run();
  assert.equal(f.calls.length, 3);
});

test('revogação de autorização entre grid e anexo interrompe a etapa seguinte', async () => {
  const f = fixture({ files: 1 });
  let checks = 0;
  f.args.validarAutorizacao = () => { if (++checks > 1) throw Object.assign(new Error('Acesso revogado'), { status: 403 }); };
  await assert.rejects(f.run(), { status: 403 });
  assert.equal(repo.obter(f.args.tentativaId).status_posicionamento, 'registrado');
  assert.equal(repo.obter(f.args.tentativaId).em_processamento, 0);
  assert.equal(f.calls.length, 1);
});

test('histórico automático validado não recebe comentário adicional', async () => {
  const f = fixture({ historico: { modo: 'automatico_validado' } });
  assert.equal((await f.run()).historico, 'automatico_previsto');
  assert.equal(f.calls.length, 1);
});

test('comentário explicitamente configurado: operação isolada e não repetida', async () => {
  const f = fixture({ historico: { modo: 'comentario_validado', privado: true } });
  assert.equal((await f.run()).historico, 'registrado');
  await f.run();
  assert.deepEqual(f.calls.map((c) => c.operacao), ['newChildEntityRecord', 'newComment']);
  assert.ok(f.calls[1].xml.includes('<urn:Private>1</urn:Private>'));
});

test('histórico começa com ID e nome confirmados do consultor seguidos de IA Service', async () => {
  const f = fixture({ historico: { modo: 'comentario_validado', privado: true }, resolveOwner: async () => ({ codigo: '124', nome: 'Edson Assis' }) });
  f.args.consultor.idSoftexpert = '124';
  f.args.consultor.nome = 'Nome recebido que não deve prevalecer';
  f.args.campos.DESCRICAO = 'Descrição com acentuação <teste> & retorno.';
  await f.run();
  assert.match(f.calls[1].xml, /<urn:Text>124 - Edson Assis - IA Service\n\nDescrição com acentuação &lt;teste&gt; &amp; retorno\.<\/urn:Text>/);
  assert.equal(f.calls[1].xml.includes('Nome recebido'), false);
  assert.equal(f.calls[0].xml.includes('124 - Edson Assis - IA Service'), false);
  await f.run();
  assert.equal(f.calls.length, 2);
});

test('retomada do histórico reconfirma o consultor sem duplicar a grid ou repetir o prefixo', async () => {
  let falhar = true;
  const f = fixture({ historico: { modo: 'comentario_validado', privado: true }, resolveOwner: async () => ({ codigo: '124', nome: 'Edson Assis' }), responder: req => req.operacao === 'newComment' && falhar ? { Status: 'FAILURE', Code: '-1' } : { Status: 'SUCCESS', Code: '1', RecordKey: 'pos' } });
  f.args.consultor.idSoftexpert = '124';
  assert.equal((await f.run()).status, 'parcial');
  falhar = false;
  assert.equal((await f.run()).status, 'registrado');
  assert.deepEqual(f.calls.map(c => c.operacao), ['newChildEntityRecord', 'newComment', 'newComment']);
  assert.equal(f.calls[1].xml, f.calls[2].xml);
  assert.equal((f.calls[2].xml.match(/124 - Edson Assis - IA Service/g) || []).length, 1);
});

test('comentário com timeout não é reenviado; grid permanece confirmada', async () => {
  const f = fixture({ historico: { modo: 'comentario_validado', privado: false }, responder: (req) => {
    if (req.operacao === 'newComment') throw new Error('timeout');
    return { Status: 'SUCCESS', Code: '1', RecordKey: 'chave' };
  } });
  const result = await f.run();
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.posicionamento, 'registrado');
  await f.run();
  assert.equal(f.calls.length, 2);
});

test('ausência de OID confirmado impede anexos e permite retomar sem duplicar a grid', async () => {
  let oid = null;
  const f = fixture({ files: 1, resolveOid: async () => oid });
  assert.equal((await f.run()).status, 'parcial');
  assert.equal(f.calls.length, 1);
  oid = 'oid-confirmado';
  assert.equal((await f.run()).status, 'registrado');
  assert.equal(f.calls.length, 2);
});

test('execuções concorrentes da mesma tentativa são bloqueadas no banco', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const f = fixture({ responder: async () => { await wait; return { Status: 'SUCCESS', Code: '1', RecordKey: 'chave' }; } });
  const first = f.run();
  await assert.rejects(f.run(), { status: 409 });
  release();
  await first;
  assert.equal(f.calls.length, 1);
});

test('falha de sincronização não altera o sucesso confirmado nem recria a grid', async () => {
  const f = fixture({ sync: async () => { throw new Error('origem indisponível'); } });
  assert.equal((await f.run()).sincronizacao, 'pendente');
  await f.run();
  assert.equal(f.calls.length, 1);
});

test('nenhuma operação de movimentação é permitida pelo transporte', async () => {
  for (const operacao of ['executeActivity', 'executeSystemActivity', 'INSERT', 'ALTER']) {
    await assert.rejects(soapReal.enviarOperacao({ operacao }));
  }
});

test('contrato exige validação; campos e opções inválidos não são enviados', () => {
  assert.throws(() => configService.validarContrato({ envioHabilitado: false }));
  const f = fixture();
  assert.throws(() => configService.mapearCampos({ DESCRICAO: 'x', ASSUNTO: 'não mapeado' }, f.args.config.contrato, { chamado: f.args.chamado, consultor: f.args.consultor, instante: new Date().toISOString() }), { status: 400 });
});

test('SOAP oficial de formulário e comentário: namespaces, arquivos e respostas próprias', () => {
  const xml = soapReal.montarInclusaoAnexo({ tableId: 't', relacionamentoId: 'r', posicionamentoOid: 'oid', campoArquivoId: 'f', nome: 'a&b.txt', conteudo: Buffer.from('abc'), userId: 'analista' });
  assert.ok(xml.includes('urn:form'));
  assert.ok(xml.includes('<urn:FileContent>YWJj</urn:FileContent>'));
  assert.ok(xml.includes('a&amp;b.txt'));
  const resposta = (op, ns) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:r="${ns}"><s:Body><r:${op}Response><r:Status>SUCCESS</r:Status><r:Code>1</r:Code></r:${op}Response></s:Body></s:Envelope>`;
  assert.equal(soapReal.interpretarResposta(resposta('newComment', 'urn:workflow'), 'newComment').Code, '1');
  assert.equal(soapReal.interpretarResposta(resposta('newTableRecord', 'urn:form'), 'newTableRecord').Status, 'SUCCESS');
  assert.throws(() => soapReal.interpretarResposta(resposta('newComment', 'urn:workflow'), 'newTableRecord'));
  assert.throws(() => soapReal.montarComentario({ workflowId: '1', texto: 'x' }));
});
