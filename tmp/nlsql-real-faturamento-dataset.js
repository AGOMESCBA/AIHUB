'use strict';

const path = require('path');

const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

delete process.env.IAC_NLSQL_DISABLE_SEMANTIC_DATASET;
process.env.IAC_NLSQL_SEMANTIC_FEWSHOT = '1';
process.env.IAC_NLSQL_SEMANTIC_SHADOW = '1';
process.env.IAC_NLSQL_SEMANTIC_EMBEDDING_RANKING = '1';
process.env.IAC_NLSQL_SEMANTIC_AUTO_REUSE = '0';

const EMPRESA_LOG_ID = 1;
const SENDER = '5565999875116';
const EMPRESAS_CANAL = [
  { empresa_id: 1, nome: 'J2A', alias: 'J2A' },
  { empresa_id: 2, nome: 'C3I', alias: 'C3I' },
];

const PERGUNTAS = [
  'Qual foi o faturamento de junho do ano passado?',
  'Agora me detalhe por cliente.',
  'Compare esse resultado com julho do ano passado.',
];

const { inicializarDB, getDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const IACWhatsAppService = require(path.join(BASE_DIR, 'modules/whatsapp/service'));
const svc = new IACWhatsAppService();
svc._empresaId = EMPRESA_LOG_ID;
svc._channelId = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(path.join(BASE_DIR, 'modules/erp/core/intent-router'));
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

function logsDaPergunta(pergunta, desdeIso) {
  return getDB().prepare(`
    SELECT id,
           empresa_id,
           criado_em,
           resultado_tipo,
           rows_count,
           modulo,
           intencao,
           dataset_id,
           dataset_nome,
           pipeline_origem,
           sql_canonico_origem,
           sql_canonico_reuso_motivo,
           cache_hit,
           chave_cache,
           sql_validacao_erro,
           sql_final_executado,
           sql_gerado,
           resposta_entregue,
           intent_json,
           intent_canonico_json
      FROM interpretation_log
     WHERE texto_original = ?
       AND criado_em >= ?
       AND empresa_id IN (1, 2)
     ORDER BY criado_em DESC
  `).all(pergunta, desdeIso);
}

function limparTexto(v, limite) {
  const s = String(v || '').replace(/\r/g, '').trim();
  if (!limite || s.length <= limite) return s;
  return `${s.slice(0, limite)}...`;
}

(async () => {
  const inicio = new Date().toISOString();
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);

  console.log(JSON.stringify({
    modulo: 'faturamento_dataset',
    empresas: EMPRESAS_CANAL.map(e => e.empresa_id),
    sender: SENDER,
    inicio,
    perguntas: PERGUNTAS,
  }, null, 2));

  const resultados = [];
  for (const pergunta of PERGUNTAS) {
    const t0 = Date.now();
    let erro = null;
    let respostaPipeline = null;
    try {
      respostaPipeline = await svc._pipelineAll(pergunta, EMPRESAS_CANAL, SENDER, {});
    } catch (e) {
      erro = e && e.stack ? e.stack : String(e && e.message || e);
    }

    resultados.push({
      pergunta,
      duracao_ms: Date.now() - t0,
      erro,
      resposta_pipeline: limparTexto(respostaPipeline, 3000),
      logs: logsDaPergunta(pergunta, inicio).map(log => ({
        id: log.id,
        empresa_id: log.empresa_id,
        criado_em: log.criado_em,
        resultado_tipo: log.resultado_tipo,
        rows_count: log.rows_count,
        modulo: log.modulo,
        intencao: log.intencao,
        dataset_id: log.dataset_id,
        dataset_nome: log.dataset_nome,
        pipeline_origem: log.pipeline_origem,
        sql_canonico_origem: log.sql_canonico_origem,
        sql_canonico_reuso_motivo: log.sql_canonico_reuso_motivo,
        cache_hit: log.cache_hit,
        chave_cache: log.chave_cache,
        sql_validacao_erro: log.sql_validacao_erro,
        sql: limparTexto(log.sql_final_executado || log.sql_gerado || '', 2500),
        resposta_entregue: limparTexto(log.resposta_entregue, 3000),
        intent_json: limparTexto(log.intent_json, 1600),
        intent_canonico_json: limparTexto(log.intent_canonico_json, 1000),
      })),
    });

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n@@RESULTADOS_NLSQL_DATASET@@');
  console.log(JSON.stringify(resultados, null, 2));
  process.exit(resultados.some(r => r.erro) ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
