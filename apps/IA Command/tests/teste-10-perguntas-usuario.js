'use strict';
/**
 * Validacao manual das 10 perguntas enviadas pelo usuario para avaliar a
 * fragmentacao do spec do financeiro (Fase 1) e o comportamento atual dos
 * demais modulos (compras, faturamento, comissao — ainda nao fragmentados).
 *
 * Roda contra a IA real. Usa empresa_id=1 (J2A Consultoria).
 *
 * Uso:
 *   cd "c:/Apps/iahub/apps/IA Command"
 *   node tests/teste-10-perguntas-usuario.js
 */

const EMPRESA_ID = 1;
const SENDER     = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId  = EMPRESA_ID;
svc._channelId  = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async (sender, texto) => {
  console.log(`\n📤 RESPOSTA:\n${'─'.repeat(60)}\n${texto}\n${'─'.repeat(60)}`);
};

const CASOS = [
  { desc: '1. Fluxo de caixa projetado 30 dias, excluindo CX1/CX2, por dia',
    texto: 'Preciso do fluxo de caixa projetado dos próximos 30 dias desconsiderando os bancos CX1 e CX2 e detalhado por dia.' },
  { desc: '2. Fluxo de caixa realizado 30 dias, excluindo CX1/CX2, por dia',
    texto: 'Preciso do fluxo de caixa realizado dos próximos 30 dias desconsiderando os bancos CX1 e CX2 e detalhado por dia.' },
  { desc: '3. Fluxo de caixa do ano por mês',
    texto: 'Fluxo de caixa do ano por mes?' },
  { desc: '4. Contas a pagar em aberto por mês',
    texto: 'Contas a pagar em aberto por mes?' },
  { desc: '5. Contas a receber em aberto por mês',
    texto: 'Contas a receber em aberto por mes?' },
  { desc: '6. Top 10 fornecedores com maior valor de compras em maio',
    texto: 'Quais os 10 fornecedores com maior valor de compras em maio?' },
  { desc: '7. Lista de fornecedores com compras no ano',
    texto: 'Lista de fornecedores que tiveram compras no ano?' },
  { desc: '8. Faturamento para COABRA em 2026',
    texto: 'Qual o faturamento feito para a empresa COABRA no ano de 2026?' },
  { desc: '9. Comissão de vendas em aberto por vendedor',
    texto: 'Comissão de vendas em aberto por vendedor?' },
  { desc: '10. Compras do mês x faturamento do mês',
    texto: 'Compras do mes x faturamento do mes?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO — 10 PERGUNTAS DO USUARIO');
  console.log(`Empresa: ${EMPRESA_ID}  |  Sender: ${SENDER}`);
  console.log(`${'═'.repeat(60)}\n`);

  const resultados = [];

  for (let i = 0; i < CASOS.length; i++) {
    const { desc, texto } = CASOS[i];
    console.log(`\n[${i + 1}/${CASOS.length}] ${desc}`);
    console.log(`    Mensagem: "${texto}"`);

    const t0 = Date.now();
    let erro = null;
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'J2A Consultoria' }], SENDER, {});
      console.log(`    ✅ Concluído em ${Date.now() - t0}ms`);
    } catch (err) {
      erro = err.message;
      console.error(`    ❌ Erro após ${Date.now() - t0}ms: ${err.message}`);
    }
    resultados.push({ desc, texto, erro });

    if (i < CASOS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Recupera SQL gerado de cada chamada ────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log('SQL gerado (interpretation_log, últimos registros)\n');
  try {
    const { getDB } = require(BASE_DIR + '/modules/database/index');
    const d = getDB();
    const rows = d.prepare(`
      SELECT id, criado_em, modulo, sql_final_executado, sql_ia_bruto, status
      FROM interpretation_log
      WHERE empresa_id = ?
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(EMPRESA_ID, CASOS.length);

    // Banco retorna em ordem DESC — inverte para casar com a ordem das perguntas
    rows.reverse();
    rows.forEach((row, i) => {
      console.log(`\n[${i + 1}] modulo=${row.modulo} | status=${row.status}`);
      console.log(`SQL:\n${row.sql_final_executado || row.sql_ia_bruto || '(sem SQL registrado)'}`);
      console.log('─'.repeat(60));
    });
  } catch (e) {
    console.error('  Erro ao ler interpretation_log:', e.message);
  }

  console.log(`\n${'═'.repeat(60)}\n`);
  process.exit(0);
})();
