'use strict';

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

const SENDER = '5565999988066';
const PERGUNTA = 'Compare o faturamento de junho do ano passado com julho do ano passado';

const { inicializarDB, getDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const IACWhatsAppService = require(path.join(BASE_DIR, 'modules/whatsapp/service'));
const svc = new IACWhatsAppService();
svc._empresaId = 2;
svc._channelId = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(path.join(BASE_DIR, 'modules/erp/core/intent-router'));
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async (_sender, texto) => {
  console.log('\nRESPOSTA');
  console.log(String(texto || '').slice(0, 2000));
};

(async () => {
  const inicio = new Date(Date.now() - 1000).toISOString();
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);
  await svc._pipelineAll(PERGUNTA, [{ empresa_id: 2, nome: 'C3I', alias: 'C3I' }], SENDER, {});

  const rows = getDB().prepare(`
    SELECT empresa_id, modulo, resultado_tipo, rows_count, duracao_ms,
           pipeline_origem, sql_canonico_origem, sql_validacao_erro,
           intent_canonico_hash, chave_cache, sql_final_executado, sql_gerado
      FROM interpretation_log
     WHERE texto_original = ?
       AND criado_em >= ?
     ORDER BY criado_em DESC
     LIMIT 3
  `).all(PERGUNTA, inicio);

  console.log('\nLOGS');
  for (const r of rows) {
    console.log(JSON.stringify({
      empresa_id: r.empresa_id,
      modulo: r.modulo,
      resultado_tipo: r.resultado_tipo,
      rows_count: r.rows_count,
      duracao_ms: r.duracao_ms,
      pipeline_origem: r.pipeline_origem,
      sql_canonico_origem: r.sql_canonico_origem,
      sql_validacao_erro: r.sql_validacao_erro,
      intent_canonico_hash: r.intent_canonico_hash,
      chave_cache: r.chave_cache,
      sql: String(r.sql_final_executado || r.sql_gerado || '').replace(/\s+/g, ' ').slice(0, 1500),
    }, null, 2));
  }
})();
