'use strict';

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

const SENDER = '5565999988066';
const EMPRESAS = [
  { empresa_id: 1, nome: 'J2A Consultoria', alias: 'J2A' },
  { empresa_id: 2, nome: 'C3I', alias: 'C3I' },
];

const { inicializarDB, getDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const IACWhatsAppService = require(path.join(BASE_DIR, 'modules/whatsapp/service'));
const svc = new IACWhatsAppService();
svc._empresaId = 1;
svc._channelId = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(path.join(BASE_DIR, 'modules/erp/core/intent-router'));
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

const respostas = [];
svc._enviarResposta = async (_sender, texto) => respostas.push(String(texto || ''));

const CASOS = [
  { nome: 'Base comparativa', texto: 'Compare o faturamento de junho do ano passado com julho do ano passado', reset: true },
  { nome: 'Continuidade comparativa por cliente', texto: 'Agora detalhe por cliente' },
  { nome: 'Cross-over compras x faturamento', texto: 'Compare compras e faturamento por mes nos ultimos 6 meses', reset: true },
  { nome: 'Repeticao cross-over', texto: 'Compare compras e faturamento por mes nos ultimos 6 meses', reset: true },
];

function oneLine(valor, max = 700) {
  return String(valor || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function logsDoCaso(texto, desdeIso) {
  return getDB().prepare(`
    SELECT empresa_id, modulo, resultado_tipo, rows_count, duracao_ms,
           origem, pipeline_origem, sql_canonico_origem, cache_hit,
           dataset_nome, sql_validacao_erro, intent_canonico_hash, chave_cache,
           sql_final_executado, sql_gerado, resposta_entregue, criado_em
      FROM interpretation_log
     WHERE texto_original = ?
       AND criado_em >= ?
     ORDER BY criado_em ASC
     LIMIT 12
  `).all(texto, desdeIso);
}

function resumoExecutionLog(desdeIso) {
  return getDB().prepare(`
    SELECT empresa_id, status, cache_status, COUNT(*) AS total
      FROM execution_log
     WHERE criado_em >= ?
     GROUP BY empresa_id, status, cache_status
     ORDER BY empresa_id, status, cache_status
  `).all(desdeIso);
}

(async () => {
  const inicio = new Date(Date.now() - 1000).toISOString();
  console.log(`Inicio: ${inicio}`);
  console.log(`Empresas: ${EMPRESAS.map(e => `${e.nome} #${e.empresa_id}`).join(' + ')}`);

  for (let i = 0; i < CASOS.length; i += 1) {
    const caso = CASOS[i];
    if (caso.reset) svc._clearLastIntent(SENDER);
    respostas.length = 0;
    const t0 = Date.now();
    console.log(`\n[${i + 1}/${CASOS.length}] ${caso.nome}`);
    console.log(`Pergunta: ${caso.texto}`);
    try {
      await svc._pipelineAll(caso.texto, EMPRESAS, SENDER, {});
      console.log(`Status: OK em ${Date.now() - t0}ms`);
    } catch (err) {
      console.log(`Status: ERRO em ${Date.now() - t0}ms`);
      console.log(oneLine(err.stack || err.message, 1000));
    }
    const resposta = respostas[respostas.length - 1] || '';
    if (resposta) console.log(`Resposta: ${oneLine(resposta, 900)}`);
    for (const row of logsDoCaso(caso.texto, inicio)) {
      console.log(`- emp=${row.empresa_id} modulo=${row.modulo || '-'} tipo=${row.resultado_tipo || '-'} rows=${row.rows_count ?? '-'} origem=${row.origem || '-'} pipeline=${row.pipeline_origem || '-'} canonico=${row.sql_canonico_origem || '-'} cache_hit=${row.cache_hit ?? '-'}`);
      console.log(`  hash=${row.intent_canonico_hash || '-'} chave=${row.chave_cache || '-'} dataset=${row.dataset_nome || '-'}`);
      if (row.sql_validacao_erro) console.log(`  ERRO_SQL=${oneLine(row.sql_validacao_erro, 700)}`);
      const sql = row.sql_final_executado || row.sql_gerado || '';
      if (sql) console.log(`  SQL=${oneLine(sql, 1200)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }

  console.log('\nEXECUTION_LOG DO TESTE');
  for (const row of resumoExecutionLog(inicio)) {
    console.log(`- emp=${row.empresa_id} status=${row.status} cache_status=${row.cache_status} total=${row.total}`);
  }
})();
