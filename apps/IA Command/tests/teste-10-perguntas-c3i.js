'use strict';
/**
 * Mesmo lote de 10 perguntas, agora para C3I (empresa_id=2), para comparar
 * comportamento entre tenants apos a fragmentacao do spec do financeiro.
 */

const EMPRESA_ID = 2;
const SENDER     = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId  = EMPRESA_ID;
svc._channelId  = 'emp_1';
svc._channelName = 'C3i Systems';
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
  'Contas a pagar em aberto por mes?',
  'Contas a receber em aberto por mes?',
  'Quais os 10 fornecedores com maior valor de compras em maio?',
  'Lista de fornecedores que tiveram compras no ano?',
  'Qual o faturamento feito para a empresa COABRA no ano de 2026?',
  'Comissão de vendas em aberto por vendedor?',
  'Compras do mes x faturamento do mes?',
];

(async () => {
  console.log(`\nEmpresa ${EMPRESA_ID} (C3I) — 10 perguntas\n`);
  for (let i = 0; i < CASOS.length; i++) {
    const texto = CASOS[i];
    console.log(`[${i + 1}/10] ${texto}`);
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'C3i Systems' }], SENDER, {});
      console.log('  OK');
    } catch (e) {
      console.error('  ERRO:', e.message);
    }
    if (i < CASOS.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  const { getDB } = require(BASE_DIR + '/modules/database/index');
  const d = getDB();
  console.log('\n--- RESUMO ---');
  for (const texto of CASOS) {
    const row = d.prepare(`
      SELECT modulo, resultado_tipo, sql_final_executado, sql_ia_bruto, sql_validacao_erro
      FROM interpretation_log
      WHERE empresa_id = ? AND texto_original = ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(EMPRESA_ID, texto);
    console.log(`\n### ${texto}`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log(`modulo=${row.modulo} tipo=${row.resultado_tipo}`);
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
