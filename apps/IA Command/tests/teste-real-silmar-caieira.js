'use strict';
/**
 * Teste real — Silmar - Caieira no canal emp_1
 *
 * Silmar tem acesso SOMENTE a empresa_id=4 (Caieira do Sul).
 * J2A (1) e C3I (2) estão no canal mas Silmar NÃO está autorizado.
 *
 * Simula o caso real: Silmar escolhe "Todas as empresas" →
 * o sistema deve filtrar e mostrar APENAS Caieira do Sul.
 */

const SENDER   = '556599833100'; // Silmar - Caieira
const BASE_DIR = require('path').resolve(__dirname, '..');
process.chdir(BASE_DIR);

const { inicializarDB, getDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId   = 1;
svc._channelId   = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

// Silmar só enxerga CAIEIRA — J2A e C3I não aparecem para ele
const EMPRESAS_SILMAR = [
  { empresa_id: 4, nome: 'Caieira do Sul', alias: 'CAIEIRA' },
];

svc._enviarResposta = async (sender, texto) => {
  console.log(`\n📤 RESPOSTA:\n${'─'.repeat(70)}\n${texto}\n${'─'.repeat(70)}`);
};

function sep(titulo) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(titulo);
  console.log('═'.repeat(70));
}

function resumoLog(textoOriginal, limite = 5) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT empresa_id, resultado_tipo, duracao_ms, rows_count, sql_validacao_erro, resposta_entregue
    FROM interpretation_log
    WHERE texto_original = ? AND numero_wa = ? AND criado_em >= datetime('now', '-10 minutes')
    ORDER BY criado_em DESC LIMIT ?
  `).all(textoOriginal, SENDER, limite);
  console.log(`\n📋 LOG (${rows.length} registro(s)):`);
  for (const r of rows) {
    console.log(`  empresa=${r.empresa_id} | tipo=${r.resultado_tipo} | linhas=${r.rows_count} | ${r.duracao_ms}ms`);
    if (r.sql_validacao_erro) console.log(`    ❌ ERRO: ${r.sql_validacao_erro}`);
    if (r.resposta_entregue) console.log('\n' + r.resposta_entregue);
  }
  return rows;
}

(async () => {

  sep('CONFIGURAÇÃO DO TESTE');
  console.log('Sender  : Silmar - Caieira (' + SENDER + ')');
  console.log('Canal   : emp_1 (WhatsApp J2A Consultoria)');
  console.log('Acesso  : SOMENTE Caieira do Sul (4)');
  console.log('J2A (1) e C3I (2) NÃO autorizados para este número');

  const PERGUNTA = 'Faturamento do mes por produto com valor e quantidade';

  sep('TESTE — ' + PERGUNTA);
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);

  const t0 = Date.now();
  try {
    await svc._pipelineAll(PERGUNTA, EMPRESAS_SILMAR, SENDER, {});
    console.log(`\n✅ Concluído em ${Date.now() - t0}ms`);
  } catch (e) {
    console.error('❌ Erro:', e.message);
  }

  resumoLog(PERGUNTA, 5);

  // ── Verificação de segurança ─────────────────────────────────────────────────
  sep('VERIFICAÇÃO DE SEGURANÇA');
  const db = getDB();
  const check = db.prepare(`
    SELECT DISTINCT empresa_id FROM interpretation_log
    WHERE texto_original = ? AND numero_wa = ? AND criado_em >= datetime('now', '-10 minutes')
    ORDER BY empresa_id
  `).all(PERGUNTA, SENDER);

  const ids = check.map(r => r.empresa_id);
  console.log('Empresas que responderam:', ids);

  if (ids.includes(1)) console.log('❌ FALHA DE SEGURANÇA: J2A (1) respondeu — Silmar não deveria ver esses dados!');
  else                 console.log('✅ J2A (1) não respondeu — correto');

  if (ids.includes(2)) console.log('❌ FALHA DE SEGURANÇA: C3I (2) respondeu — Silmar não deveria ver esses dados!');
  else                 console.log('✅ C3I (2) não respondeu — correto');

  if (ids.includes(4)) console.log('✅ CAIEIRA (4) respondeu — correto');
  else                 console.log('❌ CAIEIRA (4) não respondeu — problema!');

  console.log('\n' + '═'.repeat(70) + '\n');
  process.exit(0);
})();
