'use strict';
/**
 * Validacao manual REAL (contra a IA) de que o perfil GESTOR continua com
 * acesso total nos modulos faturamento, financeiro e compras — sem nenhuma
 * alteracao de comportamento apos a introducao do filtro de vendedor.
 * Numero real fornecido pelo usuario, erp_tipo='gestor', empresa_id=1.
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
svc._channelName = 'teste-seguranca-gestor-real';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const SENDER_GESTOR = '5565999875116'; // erp_tipo=gestor, empresa_id=1

const CASOS = [
  { modulo: 'faturamento', desc: 'Gestor pede faturamento total de todos os vendedores (deve funcionar sem filtro)',
    texto: 'Qual o faturamento total de todos os vendedores este mes, consulta gestor?' },
  { modulo: 'financeiro', desc: 'Gestor pede contas a receber de todos (deve funcionar sem filtro)',
    texto: 'Quais sao as contas a receber em aberto, consulta gestor?' },
  { modulo: 'financeiro', desc: 'Gestor pede contas a PAGAR (deve funcionar normalmente, SE2 nao e bloqueado para gestor)',
    texto: 'Quais sao as contas a pagar deste mes, consulta gestor?' },
  { modulo: 'compras', desc: 'Gestor pede dados de compras (deve funcionar normalmente)',
    texto: 'Quanto compramos este mes, consulta gestor?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO — GESTOR SEM ALTERACAO DE COMPORTAMENTO (IA REAL)');
  console.log(`Sender: ${SENDER_GESTOR} | Empresa: ${EMPRESA_ID}`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { modulo, desc, texto } = CASOS[i];
    console.log(`[${i + 1}/${CASOS.length}] (${modulo}) ${desc}`);
    console.log(`    Mensagem: "${texto}"`);
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'teste' }], SENDER_GESTOR, {});
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
    `).get(EMPRESA_ID, texto, SENDER_GESTOR);
    console.log(`\n### (${modulo}) ${desc}`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log(`tipo=${row.resultado_tipo}`);
    console.log(`resposta_entregue=${row.resposta_entregue}`);
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO VALIDACAO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
