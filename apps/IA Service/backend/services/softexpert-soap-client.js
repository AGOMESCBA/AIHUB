const https = require('https');
const crypto = require('crypto');
const { SaxesParser } = require('saxes');

const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const WORKFLOW = 'urn:workflow';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const OPERACOES = { newChildEntityRecord: { ns: WORKFLOW, ws: 'wf_ws.php' }, newComment: { ns: WORKFLOW, ws: 'wf_ws.php' }, newTableRecord: { ns: 'urn:form', ws: 'fm_ws.php' } };

function envelope(operacao, body) {
  const contrato = OPERACOES[operacao];
  if (!contrato) throw new Error('Operação SOAP não permitida.');
  return `<soapenv:Envelope xmlns:soapenv="${SOAP}" xmlns:urn="${contrato.ns}"><soapenv:Header/><soapenv:Body><urn:${operacao}>${body}</urn:${operacao}></soapenv:Body></soapenv:Envelope>`;
}

function montarComentario({ workflowId, texto, activityId, privado }) {
  if (!workflowId || typeof texto !== 'string' || !texto.trim() || typeof privado !== 'boolean') throw new Error('Instância, texto e visibilidade explícita são obrigatórios.');
  return envelope('newComment', `<urn:WorkflowID>${escaparXml(workflowId)}</urn:WorkflowID>${activityId ? `<urn:ActivityID>${escaparXml(activityId)}</urn:ActivityID>` : ''}<urn:Text>${escaparXml(texto)}</urn:Text><urn:Private>${privado ? '1' : '0'}</urn:Private>`);
}

function montarInclusaoAnexo({ tableId, relacionamentoId, posicionamentoOid, campoArquivoId, nome, conteudo, userId, contentId }) {
  if (![tableId, relacionamentoId, posicionamentoOid, campoArquivoId, nome].every((v) => typeof v === 'string' && v.trim()) || !Buffer.isBuffer(conteudo) || !conteudo.length) throw new Error('Contrato de upload incompleto.');
  if (contentId !== undefined && !/^[a-zA-Z0-9@._-]{1,100}$/.test(contentId)) throw new Error('Identificador MIME inválido.');
  return envelope('newTableRecord', `${userId ? `<urn:UserID>${escaparXml(userId)}</urn:UserID>` : ''}<urn:TableID>${escaparXml(tableId)}</urn:TableID><urn:TableFieldFileList><urn:TableFieldFile><urn:TableFieldID>${escaparXml(campoArquivoId)}</urn:TableFieldID><urn:FileName>${escaparXml(nome)}</urn:FileName><urn:FileContent>${contentId ? `cid:${contentId}` : conteudo.toString('base64')}</urn:FileContent></urn:TableFieldFile></urn:TableFieldFileList><urn:RelatedTo><urn:RelatedRelationshipID>${escaparXml(relacionamentoId)}</urn:RelatedRelationshipID><urn:RelatedRelationshipValue>${escaparXml(posicionamentoOid)}</urn:RelatedRelationshipValue></urn:RelatedTo>`);
}

function montarCorpoRequisicao(xml, encoding, anexosSoap = []) {
  if (!['utf8', 'latin1'].includes(encoding)) throw new Error('Codificação SOAP não validada.');
  if (encoding === 'latin1' && /[^\u0000-\u00ff]/.test(xml)) throw new Error('Texto incompatível com a codificação configurada.');
  const soapContentType = `text/xml; charset=${encoding === 'latin1' ? 'ISO-8859-1' : 'UTF-8'}`;
  if (!anexosSoap.length) return { body: Buffer.from(xml, encoding), contentType: soapContentType };
  const boundary = `iaretorno-${crypto.randomUUID()}`;
  const rootId = `soap-${crypto.randomUUID()}@iahub`;
  const partes = [Buffer.from(`--${boundary}\r\nContent-Type: ${soapContentType}\r\nContent-Transfer-Encoding: 8bit\r\nContent-ID: <${rootId}>\r\n\r\n`, 'ascii'), Buffer.from(xml, encoding)];
  const ids = new Set();
  for (const anexo of anexosSoap) {
    if (!/^[a-zA-Z0-9@._-]{1,100}$/.test(anexo.contentId) || ids.has(anexo.contentId) || !Buffer.isBuffer(anexo.conteudo) || !anexo.conteudo.length || !xml.includes(`cid:${anexo.contentId}`)) throw new Error('Parte MIME inválida.');
    ids.add(anexo.contentId);
    partes.push(Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: binary\r\nContent-ID: <${anexo.contentId}>\r\n\r\n`, 'ascii'), anexo.conteudo);
  }
  partes.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii'));
  return { body: Buffer.concat(partes), contentType: `multipart/related; type="text/xml"; start="<${rootId}>"; boundary="${boundary}"` };
}

function escaparXml(value) {
  const text = String(value ?? '');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Texto contém caracteres inválidos para XML.');
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function montarInclusaoGrid({ workflowId, mainEntityId, childRelationshipId, campos }) {
  if (![workflowId, mainEntityId, childRelationshipId].every((v) => typeof v === 'string' && v.trim())) throw new Error('Identificadores lógicos do formulário são obrigatórios.');
  if (!campos || !Object.keys(campos).length) throw new Error('Campos do posicionamento são obrigatórios.');
  const attrs = Object.entries(campos).map(([id, value]) => {
    if (!id.trim()) throw new Error('Identificador de campo inválido.');
    return `<urn:EntityAttribute><urn:EntityAttributeID>${escaparXml(id)}</urn:EntityAttributeID><urn:EntityAttributeValue>${escaparXml(value)}</urn:EntityAttributeValue></urn:EntityAttribute>`;
  }).join('');
  return `<soapenv:Envelope xmlns:soapenv="${SOAP}" xmlns:urn="${WORKFLOW}"><soapenv:Header/><soapenv:Body><urn:newChildEntityRecord><urn:WorkflowID>${escaparXml(workflowId)}</urn:WorkflowID><urn:MainEntityID>${escaparXml(mainEntityId)}</urn:MainEntityID><urn:ChildRelationshipID>${escaparXml(childRelationshipId)}</urn:ChildRelationshipID><urn:EntityAttributeList>${attrs}</urn:EntityAttributeList></urn:newChildEntityRecord></soapenv:Body></soapenv:Envelope>`;
}

function interpretarResposta(xml, operacao = 'newChildEntityRecord') {
  const contrato = OPERACOES[operacao];
  if (!contrato) throw new Error('Operação SOAP não permitida.');
  const respostaEsperada = `${operacao}Response`;
  if (Buffer.byteLength(xml) > MAX_RESPONSE_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Resposta XML não permitida.');
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  const result = {};
  let responseSeen = false;
  let soapFault = false;
  const fields = new Set(['Status', 'Code', 'Detail', 'RecordKey', 'RecordID']);
  parser.on('opentag', (node) => {
    stack.push({ node, text: '' });
    if (stack.length > 20) throw new Error('Resposta XML excede profundidade permitida.');
    if (stack.length === 1 && (node.uri !== SOAP || node.local !== 'Envelope')) throw new Error('Envelope SOAP inválido.');
    if (node.local === 'Fault' && node.uri === SOAP) soapFault = true;
    if (stack.length === 3 && node.local === respostaEsperada && node.uri === contrato.ns && stack[1].node.local === 'Body' && stack[1].node.uri === SOAP) {
      if (responseSeen) throw new Error('Resposta SOAP duplicada.');
      responseSeen = true;
    }
  });
  const addText = (text) => { if (stack.length) stack[stack.length - 1].text += text; };
  parser.on('text', addText);
  parser.on('cdata', addText);
  parser.on('closetag', () => {
    const entry = stack.pop();
    if (stack.length === 3 && stack[2].node.local === respostaEsperada && stack[2].node.uri === contrato.ns && fields.has(entry.node.local) && (!entry.node.uri || entry.node.uri === contrato.ns)) {
      if (Object.hasOwn(result, entry.node.local)) throw new Error('Campo duplicado na resposta SOAP.');
      result[entry.node.local] = entry.text.trim();
    }
  });
  parser.write(xml).close();
  if (soapFault) throw new Error('O SoftExpert retornou uma falha SOAP.');
  if (!responseSeen || !['SUCCESS', 'FAILURE'].includes(result.Status) || !/^-?\d+$/.test(result.Code || '') || (result.Status === 'SUCCESS' && result.Code !== '1')) throw new Error('Resposta SOAP sem confirmação válida.');
  return result;
}

async function enviarOperacao({ origem, apiKey, authorizationMode, encoding, xml, anexosSoap = [], timeoutMs = 30000, operacao = 'newChildEntityRecord' }) {
  const contrato = OPERACOES[operacao];
  if (!contrato) throw new Error('Operação SOAP não permitida.');
  const url = new URL(origem);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Informe somente a origem HTTPS do SoftExpert.');
  if (!apiKey || /[\r\n]/.test(apiKey) || !['jwt', 'bearer'].includes(authorizationMode)) throw new Error('Credencial ou formato de autenticação não configurado.');
  if (anexosSoap.length && operacao !== 'newTableRecord') throw new Error('Anexos MIME não permitidos nesta operação.');
  const { body, contentType } = montarCorpoRequisicao(xml, encoding, anexosSoap);
  if (body.length > 36 * 1024 * 1024) throw new Error('Requisição SOAP excede o limite.');
  const endpoint = new URL(`/apigateway/se/ws/${contrato.ws}`, url);
  return new Promise((resolve, reject) => {
    const fail = () => reject(Object.assign(new Error('Não foi possível confirmar o resultado no SoftExpert. Não repita o envio sem verificar o registro.'), { resultadoIndeterminado: true }));
    const req = https.request(endpoint, { method: 'POST', rejectUnauthorized: true, headers: {
      Authorization: authorizationMode === 'bearer' ? `Bearer ${apiKey}` : apiKey,
      'Content-Type': contentType,
      'Content-Length': body.length, SOAPAction: '""',
    } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('error', fail);
      res.on('aborted', fail);
      res.on('data', (chunk) => { size += chunk.length; if (size > MAX_RESPONSE_BYTES) req.destroy(); else chunks.push(chunk); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return fail();
        try {
          const contentType = String(res.headers['content-type'] || '');
          const responseEncoding = /charset\s*=\s*["']?(?:iso-8859-1|windows-1252)/i.test(contentType) ? 'latin1' : 'utf8';
          resolve(interpretarResposta(Buffer.concat(chunks).toString(responseEncoding), operacao));
        } catch (_) { fail(); }
      });
    });
    const timer = setTimeout(() => req.destroy(), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', fail);
    req.end(body);
  });
}

const enviarInclusaoGrid = (config) => enviarOperacao({ ...config, operacao: 'newChildEntityRecord' });
module.exports = { escaparXml, montarInclusaoGrid, montarInclusaoAnexo, montarComentario, montarCorpoRequisicao, interpretarResposta, enviarInclusaoGrid, enviarOperacao };
