const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');
const { SaxesParser } = require('saxes');
const soap = require('../backend/services/softexpert-soap-client');
const contrato = require('./fixtures/softexpert-contrato-instalado.json');
const { analisarWsdl } = require('../scripts/testar-softexpert-leitura.cjs');

const resposta = (op, code = '1', body = '') => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:r="${op === 'getWorkflow' ? 'urn:workflow' : 'urn:form'}"><s:Body><r:${op}Response><Status>SUCCESS</Status><Code>${code}</Code>${body}</r:${op}Response></s:Body></s:Envelope>`;
const transporte = { origem: 'https://invalid.example', apiKey: 'somente-mock', authorizationMode: 'jwt', encoding: 'utf8' };

function filhosOperacao(xml) {
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  const nomes = [];
  parser.on('opentag', (n) => { if (++depth === 4) nomes.push(n.local); });
  parser.on('closetag', () => depth--);
  parser.write(xml).close();
  return nomes;
}

test('requisições incluem os elementos obrigatórios publicados no WSDL instalado', () => {
  const requisicoes = {
    newChildEntityRecord: soap.montarInclusaoGrid({ workflowId: '1', mainEntityId: 'itsm', childRelationshipId: 'relagridregistr', campos: { descricao: 'Memo' } }),
    editChildEntityRecord: soap.montarEdicaoGrid({ workflowId: '1', mainEntityId: 'itsm', childRelationshipId: 'relagridregistr', childRecordOid: 'oid-existente', campos: { cduserana: '124', analistaj2a: 'Edson Assis' } }),
    editEntityRecord: soap.montarEdicaoFormulario({ workflowId: '1', entityId: 'itsm', campos: { responsavel: 'Edson Assis', cduserana: '124' } }),
    newComment: soap.montarComentario({ workflowId: '1', texto: 'Memo', privado: false }),
    newTableRecord: soap.montarInclusaoAnexo({ tableId: 'ITSMGRIDANEXOAP', relacionamentoId: 'relregistroanex', posicionamentoOid: 'oid-confirmado', campoArquivoId: 'arquivo1', nome: 'teste.txt', conteudo: Buffer.from('abc') }),
    getWorkflow: soap.montarConsultaWorkflow({ workflowId: '1' }),
    getTableRecord: soap.montarConsultaTabela({ tableId: 'itsm', filtros: { idprocess: '1' } }),
  };
  for (const [op, xml] of Object.entries(requisicoes)) {
    const ws = ['newChildEntityRecord', 'editChildEntityRecord', 'editEntityRecord', 'newComment', 'getWorkflow'].includes(op) ? 'wf_ws.php' : 'fm_ws.php';
    const obrigatorios = contrato.servicos[ws].tipos[`${op}RequestType`].filter((c) => c.minimo !== '0').map((c) => c.nome);
    assert.ok(obrigatorios.length > 0);
    for (const nome of obrigatorios) assert.ok(filhosOperacao(xml).includes(nome), `${op}: falta ${nome}`);
  }
  assert.equal(contrato.servicos['fm_ws.php'].tipos.fieldFileData.find((f) => f.nome === 'FileContent').tipo, 'xsd:base64Binary');
});

test('consulta vazia SUCCESS/3 é aceita exclusivamente no getTableRecord sem registros', () => {
  const r = soap.interpretarResposta(resposta('getTableRecord', '3', '<TotalPagination>0</TotalPagination><RecordList/>'), 'getTableRecord');
  assert.equal(r.quantidadeRegistros, 0);
  assert.equal(r.Code, '3');
  assert.throws(() => soap.interpretarResposta(resposta('newTableRecord', '3'), 'newTableRecord'));
  assert.throws(() => soap.interpretarResposta(resposta('getTableRecord', '3', '<RecordList><Record/></RecordList>'), 'getTableRecord'));
});

test('leitura conta registros sem retornar os textos e campos do atendimento', () => {
  const r = soap.interpretarResposta(resposta('getTableRecord', '1', '<RecordList><Record><memo>conteudo privado</memo></Record><Record/></RecordList>'), 'getTableRecord');
  assert.equal(r.quantidadeRegistros, 2);
  assert.equal(JSON.stringify(r).includes('conteudo privado'), false);
});

test('consulta exige filtro e escapa os identificadores e valores', () => {
  assert.throws(() => soap.montarConsultaTabela({ tableId: 'itsm', filtros: {} }));
  assert.throws(() => soap.montarConsultaTabela({ tableId: 'itsm', filtros: { chamado: '' } }));
  const xml = soap.montarConsultaTabela({ tableId: 'a&b', filtros: { chamado: '<1>' } });
  assert.ok(xml.includes('a&amp;b'));
  assert.ok(xml.includes('&lt;1&gt;'));
});

test('caminho de consulta não permite operação de escrita, movimento ou XML disfarçado', async () => {
  for (const operacao of ['newComment', 'newChildEntityRecord', 'editChildEntityRecord', 'editEntityRecord', 'newTableRecord', 'executeActivity', 'executeSystemActivity']) await assert.rejects(soap.enviarConsulta({ operacao }));
  const xml = soap.montarComentario({ workflowId: '1', texto: 'Memo', privado: false });
  await assert.rejects(soap.enviarConsulta({ ...transporte, operacao: 'getWorkflow', xml }), /diverge/);
  const two = soap.montarConsultaWorkflow({ workflowId: '1' }).replace('</soapenv:Body>', '<urn:getWorkflow><urn:WorkflowID>2</urn:WorkflowID></urn:getWorkflow></soapenv:Body>');
  await assert.rejects(soap.enviarConsulta({ ...transporte, operacao: 'getWorkflow', xml: two }), /única/);
});

test('transporte preserva validação TLS e envia consulta no endpoint oficial', async (t) => {
  let options;
  let endpoint;
  let payload;
  t.mock.method(https, 'request', (url, opts, callback) => {
    endpoint = url; options = opts;
    const req = new EventEmitter();
    req.end = (body) => {
      payload = body;
      process.nextTick(() => {
        const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': 'text/xml; charset=UTF-8' };
        callback(res); res.emit('data', Buffer.from(resposta('getWorkflow'))); res.emit('end'); req.emit('close');
      });
    };
    return req;
  });
  const result = await soap.enviarConsulta({ ...transporte, operacao: 'getWorkflow', xml: soap.montarConsultaWorkflow({ workflowId: '1' }) });
  assert.equal(result.httpStatus, 200);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.headers.Authorization, 'somente-mock');
  assert.equal(endpoint.pathname, '/apigateway/se/ws/wf_ws.php');
  assert.ok(payload.toString().includes('<urn:getWorkflow>'));
  if (options.ca) assert.ok(options.ca.every((c) => c.includes('CERTIFICATE')));
});

test('parser do WSDL limita a evidência às operações e aos tipos técnicos', () => {
  const xml = '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><types><xsd:schema><xsd:complexType name="fieldFileData"><xsd:all><xsd:element name="FileContent" type="xsd:base64Binary"/></xsd:all></xsd:complexType></xsd:schema></types><portType><operation name="getWorkflow"/></portType></definitions>';
  assert.deepEqual(analisarWsdl(xml).operacoes, ['getWorkflow']);
  assert.equal(analisarWsdl(xml).tipos.fieldFileData[0].tipo, 'xsd:base64Binary');
  assert.throws(() => analisarWsdl('<html/>'));
  assert.throws(() => analisarWsdl('<!DOCTYPE definitions><definitions/>'));
});
