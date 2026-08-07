'use strict';
/**
 * Validacao manual REAL (contra a IA) das regras de seguranca de cliente
 * (SE1.E1_CLIENTE) no modulo financeiro — clienteFixo sempre restrito.
 *
 * Usa o cadastro REAL do numero 5565999875116 na empresa Caieira (empresa_id=4),
 * ja configurado pelo usuario: cod_cliente_erp=001020.
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
svc._channelName = 'teste-cliente-real-financeiro';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const SENDER_CLIENTE = '5565999875116'; // cod_cliente_erp=001020 (real), empresa_id=4 (Caieira)

const CASOS = [
  { desc: 'Cliente pede as proprias contas a receber (deve filtrar SE1.E1_CLIENTE=001020)',
    texto: 'Quais sao minhas contas a receber em aberto?' },
  { desc: 'Cliente pede titulos vencidos (deve continuar filtrado no proprio codigo)',
    texto: 'Quais titulos meus estao vencidos?' },
  { desc: 'Cliente pede contas a PAGAR (DEVE SER BLOQUEADO — SE2 e so para fornecedor, nunca cliente)',
    texto: 'Quais sao as contas a pagar deste mes?' },
  { desc: 'Cliente tenta pedir dados de OUTRO cliente por codigo (DEVE SER BLOQUEADO — acesso negado)',
    texto: 'Quais as contas a receber do cliente 000037?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO — SEGURANCA DE CLIENTE NO FINANCEIRO (IA REAL)');
  console.log(`Sender: ${SENDER_CLIENTE} | Empresa: ${EMPRESA_ID} (Caieira) | cod_cliente_erp=001020 (real)`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { desc, texto } = CASOS[i];
    console.log(`[${i + 1}/${CASOS.length}] ${desc}`);
    console.log(`    Mensagem: "${texto}"`);
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'teste' }], SENDER_CLIENTE, {});
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
    `).get(EMPRESA_ID, texto, SENDER_CLIENTE);
    console.log(`\n### ${desc}`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log(`tipo=${row.resultado_tipo}`);
    console.log(`resposta_entregue=${row.resposta_entregue}`);
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO VALIDACAO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
