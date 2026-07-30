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
svc._enviarResposta = async () => {};

const intentRouter = require(path.join(BASE_DIR, 'modules/erp/core/intent-router'));
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

function oneLine(valor, max = 900) {
  return String(valor || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function logs(texto, desdeIso) {
  return getDB().prepare(`
    SELECT empresa_id, modulo, resultado_tipo, rows_count, pipeline_origem,
           sql_canonico_origem, dataset_nome, sql_validacao_erro,
           sql_final_executado, sql_gerado, criado_em
      FROM interpretation_log
     WHERE texto_original = ?
       AND criado_em >= ?
     ORDER BY criado_em ASC
     LIMIT 10
  `).all(texto, desdeIso);
}

(async () => {
  const inicio = new Date(Date.now() - 1000).toISOString();
  const casos = [
    'Compare o faturamento de junho do ano passado com julho do ano passado',
    'Agora detalhe por cliente',
  ];
  svc._clearLastIntent(SENDER);
  for (const texto of casos) {
    console.log(`\nPergunta: ${texto}`);
    await svc._pipelineAll(texto, EMPRESAS, SENDER, {});
    for (const row of logs(texto, inicio)) {
      console.log(`- emp=${row.empresa_id} tipo=${row.resultado_tipo || '-'} rows=${row.rows_count ?? '-'} pipeline=${row.pipeline_origem || '-'} canonico=${row.sql_canonico_origem || '-'} dataset=${row.dataset_nome || '-'}`);
      if (row.sql_validacao_erro) console.log(`  ERRO=${oneLine(row.sql_validacao_erro)}`);
      console.log(`  SQL=${oneLine(row.sql_final_executado || row.sql_gerado || '')}`);
    }
  }
})();
