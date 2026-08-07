'use strict';
/**
 * Validacao manual REAL (contra a IA) das novas regras de linguagem de posse do
 * aprovador em compras (SCR.CR_APROV) — fragmento aprovacao_pedido_compra.
 *
 * Usa o cadastro REAL do numero 5565999875116 na empresa Caieira (empresa_id=4),
 * ja configurado pelo usuario: erp_tipo=usuario, cod_aprov_erp=000003.
 *
 * Nao insere/altera nada no banco — apenas dispara mensagens via pipeline real.
 */

const EMPRESA_ID = 4;
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId  = EMPRESA_ID;
svc._channelId  = 'emp_1';
svc._channelName = 'teste-aprovador-real-compras';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const SENDER_APROVADOR = '5565999875116'; // cod_aprov_erp=000003 (real), empresa_id=4 (Caieira)

const CASOS = [
  { desc: 'Pedidos bloqueados/pendentes para EU aprovar (deve filtrar CR_APROV=000003 AND CR_STATUS IN (01,02))',
    texto: 'Me liste os pedidos de compras que tenho que aprovar' },
  { desc: 'Variacao "bloqueados para eu aprovar"',
    texto: 'Quais pedidos estao bloqueados para eu aprovar?' },
  { desc: 'O que eu ja aprovei hoje (deve usar CR_STATUS=03 AND CR_DATALIB=hoje)',
    texto: 'O que eu ja aprovei hoje?' },
  { desc: 'O que eu aprovei no mes, com os itens (deve detalhar por SC7.C7_ITEM, sem SUM/GROUP BY)',
    texto: 'O que eu aprovei este mes, com os itens?' },
  { desc: 'Pergunta GENERICA sobre aprovadores (NAO deve aplicar filtro do proprio remetente)',
    texto: 'Quais pedidos estao pendentes de aprovacao, agrupados por aprovador?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO — LINGUAGEM DE POSSE DO APROVADOR EM COMPRAS (IA REAL)');
  console.log(`Sender: ${SENDER_APROVADOR} | Empresa: ${EMPRESA_ID} (Caieira) | cod_aprov_erp=000003 (real)`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { desc, texto } = CASOS[i];
    console.log(`[${i + 1}/${CASOS.length}] ${desc}`);
    console.log(`    Mensagem: "${texto}"`);
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'teste' }], SENDER_APROVADOR, {});
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
  for (const { desc, texto } of CASOS) {
    const row = d.prepare(`
      SELECT modulo, resultado_tipo, resposta_entregue, sql_final_executado, sql_ia_bruto, sql_validacao_erro
      FROM interpretation_log
      WHERE empresa_id = ? AND texto_original = ? AND numero_wa = ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(EMPRESA_ID, texto, SENDER_APROVADOR);
    console.log(`\n### ${desc}`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log(`tipo=${row.resultado_tipo}`);
    console.log(`resposta_entregue=${row.resposta_entregue}`);
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO VALIDACAO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
