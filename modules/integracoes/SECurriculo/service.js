const https = require('https');
const http  = require('http');
const { URL } = require('url');

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function fmtExperiencias(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map(e => {
    const parts = [];
    if (e.cargo)     parts.push(e.cargo);
    if (e.empresa)   parts.push(`em ${e.empresa}`);
    if (e.periodo)   parts.push(`(${e.periodo})`);
    if (e.descricao) parts.push(`\n  ${String(e.descricao).slice(0, 500)}`);
    return parts.join(' ');
  }).join('\n\n');
}

function fmtFormacao(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map(f => {
    const inst  = f.instituicao || f['instituição'] || f.institution || '';
    const curso = f.curso || f.nome || '';
    return [curso, inst, f.periodo].filter(Boolean).join(' — ');
  }).join('\n');
}

function fmtCapacitacoes(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map(c => {
    if (typeof c === 'string') return c;
    const nome = c.nome || c.titulo || c.curso || '';
    return c.data ? `${nome} (${c.data})` : nome;
  }).filter(Boolean).join('\n');
}

function fmtHabilidades(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.join(', ');
}

function montarSoap(curriculo) {
  const campos = [
    ['NM',   curriculo.nome        || ''],
    ['TLF',  curriculo.telefone    || ''],
    ['EML',  curriculo.email       || ''],
    ['ENDE', curriculo.endereco    || ''],
    ['LKD',  curriculo.linkedin    || ''],
    ['DSC',  curriculo.descricao   || ''],
    ['EXPC', fmtExperiencias(curriculo.experiencias)],
    ['FRM',  fmtFormacao(curriculo.formacao)],
    ['CTF',  fmtCapacitacoes(curriculo.capacitacoes)],
    ['CPT',  fmtHabilidades(curriculo.habilidades)],
    ['OUT',  curriculo.outros      || ''],
  ];

  const fields = campos.map(([id, val]) =>
    `               <urn:TableFieldID>${id}</urn:TableFieldID>\n               <urn:TableFieldValue>${esc(val)}</urn:TableFieldValue>`
  ).join('\n\n');

  const fileSection = (curriculo.pdf_base64 && curriculo.pdf_nome)
    ? `<urn:TableFieldFileList>
            <urn:TableFieldFile>
               <urn:TableFieldID>ANX</urn:TableFieldID>
               <urn:FileName>${esc(curriculo.pdf_nome)}</urn:FileName>
               <urn:FileContent>${curriculo.pdf_base64}</urn:FileContent>
            </urn:TableFieldFile>
         </urn:TableFieldFileList>`
    : `<urn:TableFieldFileList/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:form">
   <soapenv:Header/>
   <soapenv:Body>
      <urn:newTableRecord>
         <urn:UserID>se</urn:UserID>
         <urn:TableID>DDCDT</urn:TableID>
         <urn:TableFieldList>
            <urn:TableField>
${fields}
            </urn:TableField>
         </urn:TableFieldList>
         <urn:RelationshipList/>
         <urn:RelatedTo/>
         ${fileSection}
      </urn:newTableRecord>
   </soapenv:Body>
</soapenv:Envelope>`;
}

// Versão sem base64 para armazenar no log (evita blobs enormes)
function montarSoapResumido(curriculo) {
  const xml = montarSoap(curriculo);
  if (!curriculo.pdf_base64) return xml;
  const kb = Math.round(Buffer.byteLength(curriculo.pdf_base64, 'utf8') / 1024);
  return xml.replace(
    curriculo.pdf_base64,
    `[BASE64 OMITIDO DO LOG — ${kb} KB — arquivo: ${curriculo.pdf_nome || 'sem nome'}]`
  );
}

// Extrai os campos do retorno SE: Status, Code, Detail, RecordID
function parseSEResponse(xml) {
  const get = tag => {
    const m = xml.match(new RegExp(`<(?:[^:/>\\s]*:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:/>\\s]*:)?${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };
  return {
    se_status:    get('Status'),
    se_code:      get('Code'),
    se_detail:    get('Detail'),
    se_record_id: get('RecordID'),
  };
}

function enviarParaSE(curriculo, config) {
  const xml      = montarSoap(curriculo);
  const parsed   = new URL(config.se_url);
  const isSsl    = parsed.protocol === 'https:';
  const port     = parsed.port ? Number(parsed.port) : (isSsl ? 443 : 80);
  const body     = Buffer.from(xml, 'utf8');
  const inicioMs = Date.now();

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsed.hostname,
      port,
      path:    parsed.pathname + (parsed.search || ''),
      method:  'POST',
      headers: {
        'Content-Type':   'text/xml; charset=utf-8',
        'SOAPAction':     '""',
        'Authorization':  `Bearer ${config.se_token}`,
        'Content-Length': body.length,
      },
    };

    const lib = isSsl ? https : http;
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const duracao_ms  = Date.now() - inicioMs;
        const http_status = res.statusCode;

        if (http_status >= 200 && http_status < 300) {
          if (data.includes('<faultstring>')) {
            const mMsg  = data.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
            const mCode = data.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/);
            const msg   = mMsg ? mMsg[1].trim() : 'Erro SOAP retornado pelo servidor';
            const err   = new Error(msg);
            err.http_status    = http_status;
            err.resposta_api   = data;
            err.fault_code     = mCode ? mCode[1].trim() : null;
            err.duracao_ms     = duracao_ms;
            reject(err);
          } else {
            const se = parseSEResponse(data);
            if (se.se_status === 'FAILURE') {
              const msg = se.se_detail || `FAILURE retornado pelo Softexpert (code: ${se.se_code || '?'})`;
              const err = new Error(msg);
              err.http_status    = http_status;
              err.resposta_api   = data;
              err.se_status      = se.se_status;
              err.se_code        = se.se_code;
              err.se_detail      = se.se_detail;
              err.se_record_id   = se.se_record_id;
              err.duracao_ms     = duracao_ms;
              reject(err);
            } else {
              resolve({ http_status, resposta_api: data, duracao_ms, ...se });
            }
          }
        } else {
          const err = new Error(`HTTP ${http_status}`);
          err.http_status  = http_status;
          err.resposta_api = data;
          err.duracao_ms   = duracao_ms;
          reject(err);
        }
      });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      const err = new Error('Timeout: sem resposta do Softexpert após 30 segundos');
      err.http_status = null;
      err.duracao_ms  = Date.now() - inicioMs;
      reject(err);
    });
    req.on('error', e => {
      const err = new Error(`Falha de conexão: ${e.message}`);
      err.http_status    = null;
      err.resposta_api   = null;
      err.erro_detalhes  = e.stack || e.message;
      err.duracao_ms     = Date.now() - inicioMs;
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

module.exports = { enviarParaSE, montarSoap, montarSoapResumido, parseSEResponse };
