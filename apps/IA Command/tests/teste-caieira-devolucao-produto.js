'use strict';
const SENDER = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');
process.chdir(BASE_DIR);
const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();
const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId = 1; svc._channelId = 'emp_1'; svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;
const intentRouter = require(BASE_DIR + '/modules/erp/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') intentRouter._verificarAutorizacaoModulo = () => null;
const EMPRESAS_CANAL = [
  { empresa_id: 1, nome: 'J2A Consultoria', alias: 'J2A' },
  { empresa_id: 2, nome: 'C3I', alias: 'C3I' },
  { empresa_id: 4, nome: 'Caieira do Sul', alias: 'CAIEIRA' },
];
svc._enviarResposta = async (sender, texto) => {
  console.log(`\n📤 RESPOSTA:\n${'─'.repeat(70)}\n${texto}\n${'─'.repeat(70)}`);
};
(async () => {
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);
  console.log('\n▶ Faturamento da CAIEIRA do mes por produto com valor e quantidade considerando devolução\n');
  const t0 = Date.now();
  try {
    await svc._pipelineAll('Faturamento da CAIEIRA do mes por produto com valor e quantidade considerando devolução', EMPRESAS_CANAL, SENDER, {});
    console.log(`\n✅ ${Date.now()-t0}ms`);
  } catch(e) { console.error('❌', e.message); }
  // Log do resultado
  const { getDB } = require(BASE_DIR + '/modules/database/index');
  const db = getDB();
  const rows = db.prepare(`SELECT empresa_id, resultado_tipo, sql_gerado, sql_validacao_erro FROM interpretation_log WHERE empresa_id=4 ORDER BY criado_em DESC LIMIT 1`).all();
  for (const r of rows) {
    console.log(`\n[empresa=${r.empresa_id}] tipo=${r.resultado_tipo}`);
    if (r.sql_validacao_erro) console.log('ERRO:', r.sql_validacao_erro);
    console.log('SQL:\n', r.sql_gerado);
  }
  process.exit(0);
})();
