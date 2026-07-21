'use strict';
/**
 * Teste manual REAL (contra a IA) com 3 perguntas especificas pedidas pelo
 * usuario, usando o numero real de vendedor (erp_tipo='vendedor',
 * erp_id='000007', empresa_id=1).
 */

const EMPRESA_ID = 1;
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId  = EMPRESA_ID;
svc._channelId  = 'emp_1';
svc._channelName = 'teste-3perguntas-vendedor';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const SENDER_VENDEDOR = '5565996385530'; // erp_tipo=vendedor, erp_id=000007, empresa_id=1

const CASOS = [
  { modulo: 'comissao', texto: 'Valor da comissão em aberto por mes' },
  { modulo: 'financeiro', texto: 'Contas a receber por cliente' },
  { modulo: 'comissao', texto: 'Comissão paga no mes passado' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('TESTE — 3 PERGUNTAS ESPECIFICAS (VENDEDOR, IA REAL)');
  console.log(`Sender: ${SENDER_VENDEDOR} | Empresa: ${EMPRESA_ID}`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { modulo, texto } = CASOS[i];
    console.log(`[${i + 1}/${CASOS.length}] (${modulo}) "${texto}"`);
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'teste' }], SENDER_VENDEDOR, {});
      console.log('    OK (sem exceção)');
    } catch (e) {
      console.error('    ERRO:', e.message);
    }
    if (i < CASOS.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  const { getDB } = require(BASE_DIR + '/modules/database/index');
  const d = getDB();
  console.log(`\n${'─'.repeat(60)}`);
  console.log('RESULTADO POR CASO\n');
  for (const { modulo, texto } of CASOS) {
    const row = d.prepare(`
      SELECT modulo, resultado_tipo, resposta_entregue, sql_final_executado, sql_ia_bruto, sql_validacao_erro
      FROM interpretation_log
      WHERE empresa_id = ? AND texto_original = ? AND numero_wa = ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(EMPRESA_ID, texto, SENDER_VENDEDOR);
    console.log(`\n### (${modulo}) "${texto}"`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log(`tipo=${row.resultado_tipo}`);
    console.log(`resposta_entregue=${row.resposta_entregue}`);
    console.log('\nSQL:');
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO VALIDACAO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
