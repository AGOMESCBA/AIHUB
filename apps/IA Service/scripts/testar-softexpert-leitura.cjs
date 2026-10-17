// Consumo real explicitamente somente leitura. Não inicia a aplicação nem seus bancos.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { SaxesParser } = require('saxes');
const soap = require('../backend/services/softexpert-soap-client');
const root = path.resolve(__dirname, '../../..');

function analisarWsdl(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD não permitido.');
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  const operacoes = new Set();
  const tipos = {};
  let wsdl = false;
  parser.on('opentag', (n) => {
    stack.push(n);
    if (stack.length === 1) wsdl = n.local === 'definitions' && n.uri === 'http://schemas.xmlsoap.org/wsdl/';
    if (n.local === 'operation' && stack.at(-2)?.local === 'portType') operacoes.add(n.attributes.name?.value);
    const tipo = stack.findLast((p) => p.local === 'complexType' && p.attributes.name);
    if (n.local === 'element' && tipo) {
      const nome = tipo.attributes.name.value;
      (tipos[nome] ||= []).push({ nome: n.attributes.name?.value, tipo: n.attributes.type?.value, minimo: n.attributes.minOccurs?.value || '1' });
    }
  });
  parser.on('closetag', () => stack.pop());
  parser.write(xml).close();
  if (!wsdl) throw new Error('Resposta não é WSDL.');
  const relevantes = ['newChildEntityRecordRequestType', 'editChildEntityRecordRequestType', 'newCommentRequestType', 'newTableRecordRequestType', 'getWorkflowRequestType', 'getTableRecordRequestType', 'fieldFileData'];
  return { operacoes: [...operacoes].sort(), tipos: Object.fromEntries(relevantes.filter((n) => tipos[n]).map((n) => [n, tipos[n]])) };
}

function lerWsdl(origem, ws, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.get(new URL(`/apigateway/se/ws/${ws}?wsdl`, origem), {
      rejectUnauthorized: true, ca: soap.autoridadesConfiaveis(), headers: { Authorization: apiKey },
    }, (res) => {
      let tamanho = 0;
      const chunks = [];
      res.on('data', (chunk) => { tamanho += chunk.length; if (tamanho > 4 * 1024 * 1024) req.destroy(new Error('Limite de WSDL excedido.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Resposta interrompida.')));
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ httpStatus: res.statusCode, sucesso: false });
        try { resolve({ httpStatus: res.statusCode, sucesso: true, ...analisarWsdl(Buffer.concat(chunks).toString('utf8')) }); } catch (e) { reject(e); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Timeout de WSDL.')), 20000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}

async function main() {
  const empresa = process.argv.find((v) => v.startsWith('--empresa='))?.split('=')[1] || '1';
  const workflow = process.argv.find((v) => v.startsWith('--workflow='))?.split('=')[1] || '036646';
  const configEscolhida = process.argv.find((v) => v.startsWith('--config='))?.slice('--config='.length);
  if (!/^\d+$/.test(empresa) || !/^\d+$/.test(workflow)) throw new Error('Informe empresa e Workflow numéricos.');
  const arquivo = path.join(root, 'apps/IA Recruit/data', `empresa_${empresa}.json`);
  const recruit = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const candidatos = [{ nome: 'se_config', endpoint: recruit.se_config?.se_url, apiKey: recruit.se_config?.se_token }];
  for (const c of recruit.se_api_configs || []) {
    if (!c.ativo) continue;
    const h = (recruit.se_api_headers || []).find((h) => h.config_id === c.id && /^authorization$/i.test(h.key));
    candidatos.push({ nome: `config_${c.id}`, endpoint: c.endpoint, apiKey: h?.value });
  }
  const configs = [];
  for (const c of candidatos) {
    if (!c.endpoint || !c.apiKey) continue;
    const url = new URL(c.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/apigateway\/se\/ws\/(wf|fm)_ws\.php$/.test(url.pathname)) throw new Error('Endpoint do Recruit fora do contrato esperado.');
    const existente = configs.find((p) => p.origem === url.origin && p.apiKey === c.apiKey);
    if (existente) existente.fontes.push(c.nome);
    else configs.push({ fontes: [c.nome], origem: url.origin, apiKey: c.apiKey });
  }
  const selecionadas = configEscolhida ? configs.filter((c) => c.fontes.includes(configEscolhida)) : configs;
  if (!selecionadas.length) throw new Error('Nenhuma configuração SoftExpert encontrada no Recruit.');
  const report = { executadoEmUtc: new Date().toISOString(), empresa, workflow, somenteLeitura: true, tlsValidado: true, configuracoes: [] };
  for (const c of selecionadas) {
    const entry = { fontes: c.fontes, origem: c.origem, wsdl: {}, consultas: [] };
    report.configuracoes.push(entry);
    for (const ws of ['wf_ws.php', 'fm_ws.php']) {
      try { entry.wsdl[ws] = await lerWsdl(c.origem, ws, c.apiKey); }
      catch (e) { entry.wsdl[ws] = { sucesso: false, codigoTransporte: e.code || 'FALHA_TRANSPORTE_OU_XML' }; }
    }
    const queries = [
      { operacao: 'getWorkflow', xml: soap.montarConsultaWorkflow({ workflowId: workflow }) },
      ...[
        ['itsm', { idprocess: workflow }],
        ['ITSMGRIDREGISTR', { chamado: workflow }],
        ['ITSMGRIDANEXOAP', { data1: '2026-09-30' }],
      ].map(([tableId, filtros]) => ({ operacao: 'getTableRecord', tabela: tableId, xml: soap.montarConsultaTabela({ tableId, filtros }) })),
    ];
    for (const query of queries) {
      const result = { operacao: query.operacao, ...(query.tabela ? { tabela: query.tabela } : {}) };
      try {
        // Mesmo cliente de transporte da integração; wrapper rejeita operações de escrita.
        const response = await soap.enviarConsulta({ origem: c.origem, apiKey: c.apiKey, authorizationMode: 'jwt', encoding: 'utf8', xml: query.xml, operacao: query.operacao, timeoutMs: 20000 });
        Object.assign(result, { httpStatus: response.httpStatus, status: response.Status, code: response.Code, sucesso: response.Status === 'SUCCESS', quantidadeRegistros: response.quantidadeRegistros, totalPaginas: response.TotalPagination });
      } catch (e) { Object.assign(result, { sucesso: false, httpStatus: e.httpStatus, codigoTransporte: e.codigoTransporte || 'FALHA_TRANSPORTE_OU_XML' }); }
      entry.consultas.push(result);
      console.log(JSON.stringify({ origem: c.origem, ...result }));
    }
  }
  const destino = path.join(root, configEscolhida ? 'tmp/softexpert-acesso-selecionado-real.json' : 'tmp/softexpert-acessos-reais.json');
  fs.writeFileSync(destino, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ relatorio: destino, configuracoes: selecionadas.length, semGravacoes: true }));
  if (!report.configuracoes.some((c) => Object.values(c.wsdl).every((w) => w.sucesso) && c.consultas.every((q) => q.sucesso))) process.exitCode = 1;
}

if (require.main === module) main().catch(() => { console.error('Falha ao preparar o teste de leitura. Nenhuma credencial foi exibida.'); process.exitCode = 1; });
module.exports = { analisarWsdl };
