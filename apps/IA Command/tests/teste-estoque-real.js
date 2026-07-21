'use strict';
/**
 * Teste real e isolado — pergunta de estoque (sem spec dedicado).
 * Verifica se o fallback erp_generico (spec global enxuto) é acionado
 * corretamente em vez de a IA forçar o módulo faturamento, e imprime o SQL gerado.
 *
 * Uso:
 *   cd "c:/Apps/iahub/apps/IA Command"
 *   node tests/teste-estoque-real.js
 */

const EMPRESA_ID = Number(process.argv[2]) || 1;  // 1=J2A, 4=CAIEIRA (padrao: J2A)
const SENDER     = '5565999875116';      // Alessandro Gomes (autorizado)
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const intentService = require(BASE_DIR + '/modules/ai/intent-service');
const intentRouter  = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

const TEXTO = 'Preciso do saldo em estoque do produto 000001';

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('TESTE REAL — PERGUNTA DE ESTOQUE (sem spec dedicado)');
  console.log(`Empresa: ${EMPRESA_ID}  |  Mensagem: "${TEXTO}"`);
  console.log(`${'═'.repeat(60)}\n`);

  const intent = await intentService.classificar(TEXTO, EMPRESA_ID, {});
  intent._mensagemOriginal = TEXTO;
  intent._remetente = SENDER;
  console.log('--- intent classificado ---');
  console.log(JSON.stringify({ intencao: intent.intencao, confianca: intent.confianca, _moduloDinamico: intent._moduloDinamico }, null, 2));

  const t0 = Date.now();
  const resultado = await intentRouter.rotear(intent, EMPRESA_ID);
  const ms = Date.now() - t0;

  console.log(`\n--- resultado (${ms}ms) ---`);
  console.log('tipo:', resultado.tipo, '| subtipo:', resultado.subtipo, '| dataset_nome:', resultado.dataset_nome);
  console.log('rows:', Array.isArray(resultado.rows) ? resultado.rows.length : resultado.rows);
  console.log('resposta_direta:', resultado.resposta_direta || '(nenhuma)');

  console.log('\n--- SQL gerado (sql_gerado) ---');
  console.log(resultado.sql_gerado || '(null)');

  console.log('\n--- SQL final executado (sql_auditoria.sql_final_executado) ---');
  console.log(resultado._sql_auditoria?.sql_final_executado || '(null)');

  console.log('\n--- SQL canônico adaptado (_sql_canonico) ---');
  console.log(resultado._sql_canonico || '(null)');

  if (Array.isArray(resultado.rows) && resultado.rows.length) {
    console.log('\n--- primeiras linhas ---');
    console.log(JSON.stringify(resultado.rows.slice(0, 5), null, 2));
  }

  console.log(`\n${'═'.repeat(60)}\n`);
  process.exit(0);
})().catch(err => {
  console.error('ERRO:', err.message);
  console.error(err.stack);
  process.exit(1);
});
