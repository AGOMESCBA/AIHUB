'use strict';
/**
 * Re-teste das 3 perguntas que apresentaram bug na primeira rodada
 * (fluxo projetado, fluxo realizado, fluxo do ano por mes) apos correcao
 * do fragmento fluxo_caixa_projetado/fluxo_caixa_realizado.
 */

const EMPRESA_ID = Number(process.argv[2] || 1);
const SENDER     = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId  = EMPRESA_ID;
svc._channelId  = 'emp_1';
svc._channelName = 'teste';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const CASOS = [
  'Preciso do fluxo de caixa projetado dos próximos 30 dias desconsiderando os bancos CX1 e CX2 e detalhado por dia.',
  'Preciso do fluxo de caixa realizado dos próximos 30 dias desconsiderando os bancos CX1 e CX2 e detalhado por dia.',
  'Fluxo de caixa do ano por mes?',
];

(async () => {
  console.log(`\nEmpresa ${EMPRESA_ID} — re-teste de 3 perguntas\n`);
  for (const texto of CASOS) {
    console.log(`> ${texto}`);
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'teste' }], SENDER, {});
      console.log('  OK');
    } catch (e) {
      console.error('  ERRO:', e.message);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  const { getDB } = require(BASE_DIR + '/modules/database/index');
  const d = getDB();
  for (const texto of CASOS) {
    const row = d.prepare(`
      SELECT resultado_tipo, sql_final_executado, sql_ia_bruto, sql_validacao_erro
      FROM interpretation_log
      WHERE empresa_id = ? AND texto_original = ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(EMPRESA_ID, texto);
    console.log(`\n### ${texto}`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log('tipo=' + row.resultado_tipo);
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
