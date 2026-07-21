'use strict';
/**
 * Validacao manual REAL (contra a IA) dos cenarios de seguranca de vendedor
 * nos modulos faturamento, financeiro e compras. Usa o numero real fornecido
 * pelo usuario, ja cadastrado em whatsapp_allowed_numbers como
 * erp_tipo='vendedor', erp_id='000007', empresa_id=1.
 *
 * Nao insere/altera nada no banco — apenas dispara mensagens via pipeline real.
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
svc._channelName = 'teste-seguranca-vendedor-real';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const SENDER_VENDEDOR = '5565996385530'; // erp_tipo=vendedor, erp_id=000007, empresa_id=1

const CASOS = [
  { modulo: 'faturamento', desc: 'Vendedor pede o proprio faturamento do mes (deve funcionar filtrado)',
    texto: 'Qual meu faturamento este mes?' },
  { modulo: 'faturamento', desc: 'Vendedor pede faturamento de TODOS os vendedores (deve filtrar so o proprio codigo)',
    texto: 'Qual o faturamento total de todos os vendedores este mes?' },
  { modulo: 'financeiro', desc: 'Vendedor pede as proprias contas a receber (deve funcionar filtrado em SE1)',
    texto: 'Quais sao minhas contas a receber em aberto?' },
  { modulo: 'financeiro', desc: 'Vendedor pede contas a PAGAR (DEVE SER BLOQUEADO — SE2 sem campo de vendedor)',
    texto: 'Quais sao as contas a pagar deste mes?' },
  { modulo: 'compras', desc: 'Vendedor pede dados de compras (DEVE SER BLOQUEADO — modulo inteiro sem campo de vendedor)',
    texto: 'Quanto compramos este mes?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO DE SEGURANCA — FATURAMENTO / FINANCEIRO / COMPRAS (IA REAL)');
  console.log(`Sender: ${SENDER_VENDEDOR} | Empresa: ${EMPRESA_ID}`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { modulo, desc, texto } = CASOS[i];
    console.log(`[${i + 1}/${CASOS.length}] (${modulo}) ${desc}`);
    console.log(`    Mensagem: "${texto}"`);
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
  for (const { modulo, desc, texto } of CASOS) {
    const row = d.prepare(`
      SELECT modulo, resultado_tipo, resposta_entregue, sql_final_executado, sql_ia_bruto, sql_validacao_erro
      FROM interpretation_log
      WHERE empresa_id = ? AND texto_original = ? AND numero_wa = ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(EMPRESA_ID, texto, SENDER_VENDEDOR);
    console.log(`\n### (${modulo}) ${desc}`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log(`tipo=${row.resultado_tipo}`);
    console.log(`resposta_entregue=${row.resposta_entregue}`);
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO VALIDACAO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
