'use strict';
/**
 * Reexecucao das 4 perguntas usadas nesta sessao de correcao, para empresa 4 (CAIEIRA):
 * faturamento, carregamento, cross-modulo (compras x faturamento) e estoque.
 *
 * Uso:
 *   cd "c:/Apps/iahub/apps/IA Command"
 *   node tests/teste-empresa4-4casos.js
 */

const EMPRESA_ID = 4; // CAIEIRA
const SENDER     = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const intentService = require(BASE_DIR + '/modules/ai/intent-service');
const intentRouter  = require(BASE_DIR + '/modules/erp/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

const CASOS = [
  { desc: 'Faturamento', texto: 'faturamento deste ano' },
  { desc: 'Carregamento', texto: 'quantidade carregada no mes' },
  { desc: 'Cross-modulo (compras x faturamento)', texto: 'Compare o total de compras e faturamento deste ano' },
  { desc: 'Estoque', texto: 'Preciso do saldo em estoque do produto 000001' },
];

(async () => {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`TESTE — 4 CASOS — EMPRESA ${EMPRESA_ID} (CAIEIRA)`);
  console.log(`${'═'.repeat(70)}`);

  for (let i = 0; i < CASOS.length; i++) {
    const { desc, texto } = CASOS[i];
    console.log(`\n\n[${i + 1}/${CASOS.length}] ${desc}`);
    console.log(`Mensagem: "${texto}"`);
    console.log('─'.repeat(70));

    const t0 = Date.now();
    try {
      const intent = await intentService.classificar(texto, EMPRESA_ID, {});
      intent._mensagemOriginal = texto;
      intent._remetente = SENDER;
      console.log(`intencao: ${intent.intencao} | confianca: ${intent.confianca} | modulo: ${intent._moduloDinamico || 'n/a'}`);

      const resultado = await intentRouter.rotear(intent, EMPRESA_ID);
      const ms = Date.now() - t0;

      console.log(`\ntipo: ${resultado.tipo} | subtipo: ${resultado.subtipo || 'n/a'} | rows: ${Array.isArray(resultado.rows) ? resultado.rows.length : resultado.rows} | ${ms}ms`);
      console.log(`\nSQL gerado:\n${resultado.sql_gerado || resultado._sql_canonico || '(nenhum)'}`);
      console.log(`\nResposta/Resultado:`);
      console.log(resultado.resposta_direta || JSON.stringify(resultado.rows || resultado.mensagem || {}, null, 2));
    } catch (err) {
      console.error(`ERRO: ${err.message}`);
      console.error(err.stack);
    }
    console.log('─'.repeat(70));
  }

  console.log(`\n${'═'.repeat(70)}\n`);
  process.exit(0);
})();
