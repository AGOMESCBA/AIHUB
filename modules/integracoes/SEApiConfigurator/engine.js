const https = require('https');
const http  = require('http');
const { URL } = require('url');

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

// Placeholder reservado: o motor gera os blocos de campo automaticamente
const FORM_FIELDS_PLACEHOLDER = 'form_fields';

// Placeholder reservado: o motor gera os registros da grid (newChildEntityRecordList)
const GRID_ROWS_PLACEHOLDER = 'grid_rows';

// Formato padrão do bloco — pode ser sobrescrito por template.block_xml_template
const DEFAULT_BLOCK_TPL =
`        <item>
          <fieldID>{SE_FIELD_ID}</fieldID>
          <fieldValue>{SE_FIELD_VALUE}</fieldValue>
        </item>`;

// Formato padrão de um atributo dentro de cada ChildEntity da grid (namespace urn:)
// Compatível com newChildEntityRecordList do SoftExpert wf_ws.php
const DEFAULT_GRID_ATTR_TPL =
`            <urn:EntityAttribute>
              <urn:EntityAttributeID>{SE_FIELD_ID}</urn:EntityAttributeID>
              <urn:EntityAttributeValue>{SE_FIELD_VALUE}</urn:EntityAttributeValue>
            </urn:EntityAttribute>`;

// ── Extração de placeholders ──────────────────────────────────────────────────

function extractPlaceholders(xml) {
  const found = new Set();
  const re    = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(xml)) !== null) found.add(m[1]);
  return [...found];
}

// ── Escape XML ────────────────────────────────────────────────────────────────

function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

// ── Substituição de placeholders ──────────────────────────────────────────────
// rawSet: conjunto de chaves cujo valor já é XML e NÃO deve ser escapado

function replacePlaceholders(xml, values, rawSet = new Set()) {
  const missing = [];
  const result  = xml.replace(PLACEHOLDER_RE, (_, key) => {
    if (!(key in values)) { missing.push(key); return `{{${key}}}`; }
    const val = values[key];
    if (rawSet.has(key)) return val === null || val === undefined ? '' : String(val);
    return (val === null || val === undefined) ? '' : escapeXml(val);
  });
  if (missing.length) {
    throw new Error(`Placeholders sem mapeamento: ${missing.join(', ')}`);
  }
  return result;
}

// ── Validação do corpo SOAP — lança erro se a resposta contiver falha ─────────
// Cobre dois casos: SOAP Fault (<faultstring>) e falha SE (<Status>FAILURE</Status>)

function checkSoapBody(body) {
  if (!body) return;

  const getTag = tag => {
    const m = body.match(new RegExp(`<(?:[^:/>\\s]*:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:/>\\s]*:)?${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };

  if (body.includes('<faultstring')) {
    const msg  = getTag('faultstring') || 'Erro SOAP retornado pelo servidor';
    const code = getTag('faultcode');
    const err  = new Error(msg);
    if (code) err.fault_code = code;
    throw err;
  }

  const seStatus = getTag('Status');
  if (seStatus && seStatus.toUpperCase() === 'FAILURE') {
    const detail = getTag('Detail');
    const code   = getTag('Code');
    const msg    = detail || `FAILURE retornado pelo Softexpert (code: ${code || '?'})`;
    const err    = new Error(msg);
    err.se_status = 'FAILURE';
    err.se_code   = code;
    err.se_detail = detail;
    throw err;
  }
}

// ── Extração de WorkflowID da resposta SOAP ───────────────────────────────────

function extractWorkflowId(body) {
  if (!body) return null;
  const m = body.match(/<(?:[^:/>\\s]*:)?WorkflowID[^>]*>([\s\S]*?)<\/(?:[^:/>\\s]*:)?WorkflowID>/i);
  return m ? m[1].trim() : null;
}

// ── Geração do bloco {{grid_rows}} (um ChildEntity por linha do array) ────────
//
// Compatível com newChildEntityRecordList (wf_ws.php) do SoftExpert.
// attrTpl define a estrutura XML de UM atributo dentro do ChildEntity. Marcadores:
//   {SE_FIELD_ID}    → EntityAttributeID  (ex: NM_CANDIDATO)
//   {SE_FIELD_VALUE} → valor do campo de cada linha do array
//
// O motor envolve os atributos em:
//   <urn:ChildEntity><urn:EntityAttributeList>...</urn:EntityAttributeList></urn:ChildEntity>

function buildGridRowsBlock(mappings, rows, attrTpl) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const tpl      = (attrTpl || DEFAULT_GRID_ATTR_TPL).trim();
  const camposSE = mappings.filter(m => m.se_field_id && m.se_field_id.trim());

  return rows.map(row => {
    const attrs = camposSE.map(m => {
      const val = row[m.source_field] ?? m.default_value ?? '';
      return tpl
        .replace(/\{SE_FIELD_ID\}/g,    escapeXml(m.se_field_id.trim()))
        .replace(/\{SE_FIELD_VALUE\}/g,  escapeXml(String(val)));
    }).join('\n');
    return `        <urn:ChildEntity>\n          <urn:EntityAttributeList>\n${attrs}\n          </urn:EntityAttributeList>\n        </urn:ChildEntity>`;
  }).join('\n');
}

// ── Geração do bloco {{form_fields}} (formato configurável por template) ───────
//
// blockTpl define a estrutura XML de um campo. Marcadores:
//   {SE_FIELD_ID}    → código do campo no SE  (ex: NM, TLF, CANDIDATE_NAME)
//   {SE_FIELD_VALUE} → valor vindo dos dados de entrada
//
// Exemplo para SoftExpert com namespace urn:
//   <urn:EntityAttribute>
//      <urn:EntityAttributeID>{SE_FIELD_ID}</urn:EntityAttributeID>
//      <urn:EntityAttributeValue>{SE_FIELD_VALUE}</urn:EntityAttributeValue>
//   </urn:EntityAttribute>

function buildFormFieldsBlock(mappings, data, blockTpl) {
  const tpl      = (blockTpl || DEFAULT_BLOCK_TPL).trim();
  const camposSE = mappings.filter(m => m.se_field_id && m.se_field_id.trim());
  if (!camposSE.length) return '';
  return camposSE.map(m => {
    const val = data[m.source_field] ?? m.default_value ?? '';
    return tpl
      .replace(/\{SE_FIELD_ID\}/g,    escapeXml(m.se_field_id.trim()))
      .replace(/\{SE_FIELD_VALUE\}/g,  escapeXml(String(val)));
  }).join('\n');
}

// ── Requisição HTTP ───────────────────────────────────────────────────────────

function httpRequest(endpoint, method, headers, body) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(endpoint); }
    catch { return reject(new Error(`Endpoint inválido: ${endpoint}`)); }

    const lib    = url.protocol === 'https:' ? https : http;
    const bodyBuf = Buffer.from(body, 'utf8');

    const options = {
      hostname:           url.hostname,
      port:               url.port || (url.protocol === 'https:' ? 443 : 80),
      path:               url.pathname + url.search,
      method:             (method || 'POST').toUpperCase(),
      rejectUnauthorized: false,
      headers:  {
        'Content-Type':   'text/xml; charset=utf-8',
        'Content-Length': bodyBuf.length,
        ...headers,
      },
    };

    const start = Date.now();

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({
        status_code: res.statusCode,
        body:        data,
        duracao_ms:  Date.now() - start,
      }));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(Object.assign(new Error('Timeout: a requisição excedeu 30 segundos'), { duracao_ms: 30000 }));
    });

    req.on('error', (err) => {
      reject(Object.assign(new Error(err.message), { duracao_ms: Date.now() - start }));
    });

    req.write(bodyBuf);
    req.end();
  });
}

// ── Pipeline de execução de uma config ───────────────────────────────────────

async function executeConfig(db, empresaId, configId, data = {}) {
  const config = db.getConfig(empresaId, configId);
  if (!config) throw new Error(`Configuração ID ${configId} não encontrada`);
  if (!config.ativo) throw new Error(`Configuração "${config.nome}" está inativa`);

  const template = db.getTemplate(empresaId, config.template_id);
  if (!template) throw new Error(`Template ID ${config.template_id} não encontrado`);
  if (!template.xml_template) throw new Error(`Template "${template.nome}" não possui XML`);

  // Se a config tem tabela de origem, carrega o registro e mescla com data
  let dadosFinais = { ...data };
  if (config.source_table && config.source_id_field) {
    const recordId = data[config.source_id_field];
    if (!recordId) throw new Error(`Campo de ID "${config.source_id_field}" não informado para carregar da tabela "${config.source_table}"`);
    const registro = db.loadSourceRecord(empresaId, config.source_table, recordId);
    dadosFinais = { ...registro, ...data }; // data explícita tem prioridade
  }

  const placeholders = extractPlaceholders(template.xml_template);
  const mappings     = db.listMappings(empresaId, configId);
  const headers      = db.listHeaders(empresaId, configId);

  const values   = {};
  const rawSet   = new Set();
  const semValor = [];

  for (const ph of placeholders) {
    // Placeholder especial: gera bloco de campos SE usando o formato do template
    if (ph === FORM_FIELDS_PLACEHOLDER) {
      values[FORM_FIELDS_PLACEHOLDER] = buildFormFieldsBlock(mappings, dadosFinais, template.block_xml_template);
      rawSet.add(FORM_FIELDS_PLACEHOLDER);
      continue;
    }

    // Placeholder especial: gera linhas EntityRecord para grids (newChildEntityRecordList)
    if (ph === GRID_ROWS_PLACEHOLDER) {
      const rows = Array.isArray(dadosFinais.grid_rows) ? dadosFinais.grid_rows : [];
      values[GRID_ROWS_PLACEHOLDER] = buildGridRowsBlock(mappings, rows, template.block_xml_template);
      rawSet.add(GRID_ROWS_PLACEHOLDER);
      continue;
    }

    const mapping = mappings.find(m => m.placeholder === ph);
    if (!mapping) { semValor.push(ph); continue; }
    values[ph] = dadosFinais[mapping.source_field] ?? mapping.default_value ?? null;
  }

  if (semValor.length) {
    throw new Error(`Placeholders sem mapeamento definido: ${semValor.join(', ')}`);
  }

  let xmlFinal = replacePlaceholders(template.xml_template, values, rawSet);

  // Quando FileContent ficou vazio (currículo sem PDF), colapsa o bloco inteiro
  // para evitar que o SE rejeite a requisição com arquivo inválido
  xmlFinal = xmlFinal.replace(
    /<urn:EntityAttributeFileList\b[^>]*>[\s\S]*?<urn:FileContent>\s*<\/urn:FileContent>[\s\S]*?<\/urn:EntityAttributeFileList>/g,
    '<urn:EntityAttributeFileList/>'
  );

  const headersObj = {};
  for (const h of headers) headersObj[h.key] = h.value;

  const resultado = await httpRequest(config.endpoint, config.method, headersObj, xmlFinal);

  try {
    checkSoapBody(resultado.body);
  } catch (err) {
    err.duracao_ms  = resultado.duracao_ms;
    err.status_code = resultado.status_code;
    err.body        = resultado.body;
    throw err;
  }

  // Salva WorkflowID retornado pelo SE de volta no registro de origem (ex: vagas)
  // Requer config.save_workflow_id_field + source_table + source_id_field configurados
  if (config.save_workflow_id_field && config.source_table && config.source_id_field) {
    const workflowId = extractWorkflowId(resultado.body);
    if (workflowId) {
      const recordId = dadosFinais[config.source_id_field];
      try {
        db.updateSourceRecord(empresaId, config.source_table, recordId, {
          [config.save_workflow_id_field]: workflowId,
        });
      } catch (_) { /* não falha a execução principal */ }
    }
  }

  return {
    config_id:        config.id,
    config_nome:      config.nome,
    template_id:      template.id,
    template_nome:    template.nome,
    xml_enviado:      xmlFinal,
    se_workflow_id:   extractWorkflowId(resultado.body),
    ...resultado,
  };
}

// ── Pipeline de execução de um flow ──────────────────────────────────────────

async function executeFlow(db, empresaId, flowId, data = {}) {
  const flow = db.getFlow(empresaId, flowId);
  if (!flow) throw new Error(`Flow ID ${flowId} não encontrado`);

  const steps      = db.listFlowSteps(empresaId, flowId);
  const resultados = [];
  let   sucesso    = true;

  for (const step of steps) {
    let stepResult;
    try {
      stepResult = await executeConfig(db, empresaId, step.config_id, data);
      stepResult.step_ordem = step.ordem;
      stepResult.status     = 'sucesso';
      resultados.push(stepResult);
    } catch (err) {
      stepResult = {
        step_ordem:  step.ordem,
        config_id:   step.config_id,
        status:      'erro',
        erro:        err.message,
        duracao_ms:  err.duracao_ms  ?? null,
        status_code: err.status_code ?? null,
        body:        err.body        ?? null,
      };
      resultados.push(stepResult);
      sucesso = false;
      if (step.parar_em_erro !== false) break;
    }
  }

  return {
    flow_id:   flow.id,
    flow_nome: flow.nome,
    sucesso,
    steps:     resultados,
  };
}

module.exports = {
  extractPlaceholders,
  escapeXml,
  replacePlaceholders,
  buildFormFieldsBlock,
  buildGridRowsBlock,
  extractWorkflowId,
  httpRequest,
  executeConfig,
  executeFlow,
};
