'use strict';
/**
 * Teste real com IA — perguntas 1, 2 e 2.1
 *
 * 1   — CAIEIRA: faturamento do mês por produto com valor e quantidade considerando devolução
 * 2   — J2A: faturamento do mês por produto com valor e quantidade
 * 2.1 — (multi-turn) Me detalhe por cliente   ← deve responder SOMENTE J2A
 *
 * Usa _pipelineAll com canal multi-empresa (emp_1) e sender real.
 * Grava nos logs de histórico (interpretation_log).
 */

const SENDER   = '5565999875116';
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

const EMPRESAS_CANAL = [
  { empresa_id: 1, nome: 'J2A Consultoria', alias: 'J2A' },
  { empresa_id: 2, nome: 'C3I',             alias: 'C3I' },
  { empresa_id: 4, nome: 'Caieira do Sul',  alias: 'CAIEIRA' },
];

svc._enviarResposta = async (sender, texto) => {
  console.log(`\n📤 RESPOSTA:\n${'─'.repeat(70)}\n${texto}\n${'─'.repeat(70)}`);
};

function sep(titulo) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(titulo);
  console.log('═'.repeat(70));
}

function resumoLog(textoOriginal, limite = 3) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT empresa_id, resultado_tipo, duracao_ms, intent_json, sql_gerado, sql_validacao_erro
    FROM interpretation_log
    WHERE texto_original = ?
    ORDER BY criado_em DESC LIMIT ?
  `).all(textoOriginal, limite);
  console.log(`\n📋 LOG (${rows.length} registro(s) para "${textoOriginal}"):`);
  for (const r of rows) {
    const intent = r.intent_json ? JSON.parse(r.intent_json) : {};
    console.log(`  empresa=${r.empresa_id} | tipo=${r.resultado_tipo} | ${r.duracao_ms}ms`);
    console.log(`    filtros: ${JSON.stringify(intent.filtros || {})}`);
    console.log(`    empresasMencionadas: ${JSON.stringify(intent._empresasMencionadasTextos || [])}`);
    if (r.sql_validacao_erro) console.log(`    ERRO: ${r.sql_validacao_erro}`);
    const sqlTrecho = String(r.sql_gerado || '').replace(/\s+/g, ' ').slice(0, 250);
    if (sqlTrecho) console.log(`    SQL: ${sqlTrecho}`);
  }
}

(async () => {

  // ── TESTE 1 ──────────────────────────────────────────────────────────────────
  sep('TESTE 1 — CAIEIRA: faturamento do mês por produto + devoluções');
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);
  const t1 = Date.now();
  try {
    await svc._pipelineAll(
      'Faturamento da CAIEIRA do mes por produto com valor e quantidade considerando devolução',
      EMPRESAS_CANAL, SENDER, {}
    );
    console.log(`\n✅ Teste 1 concluído em ${Date.now() - t1}ms`);
  } catch (e) { console.error('❌ Teste 1 erro:', e.message); }
  resumoLog('Faturamento da CAIEIRA do mes por produto com valor e quantidade considerando devolução', 1);

  await new Promise(r => setTimeout(r, 3000));

  // ── TESTE 2 ──────────────────────────────────────────────────────────────────
  sep('TESTE 2 — J2A: faturamento do mês por produto com valor e quantidade');
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);
  const t2 = Date.now();
  try {
    await svc._pipelineAll(
      'Faturamento da empresa J2A do mes por produto com valor e quantidade',
      EMPRESAS_CANAL, SENDER, {}
    );
    console.log(`\n✅ Teste 2 concluído em ${Date.now() - t2}ms`);
  } catch (e) { console.error('❌ Teste 2 erro:', e.message); }
  resumoLog('Faturamento da empresa J2A do mes por produto com valor e quantidade', 3);

  await new Promise(r => setTimeout(r, 3000));

  // ── TESTE 2.1 (multi-turn — NÃO limpar contexto) ────────────────────────────
  sep('TESTE 2.1 — Multi-turn: Me detalhe por cliente (deve responder SOMENTE J2A)');
  const t21 = Date.now();
  try {
    await svc._pipelineAll(
      'Me detalhe por cliente',
      EMPRESAS_CANAL, SENDER, {}
    );
    console.log(`\n✅ Teste 2.1 concluído em ${Date.now() - t21}ms`);
  } catch (e) { console.error('❌ Teste 2.1 erro:', e.message); }
  resumoLog('Me detalhe por cliente', 3);

  // ── Verificação final ────────────────────────────────────────────────────────
  sep('VERIFICAÇÃO FINAL — empresas que responderam ao 2.1');
  const db = getDB();
  const check = db.prepare(`
    SELECT empresa_id, resultado_tipo
    FROM interpretation_log
    WHERE texto_original = 'Me detalhe por cliente'
    ORDER BY criado_em DESC LIMIT 5
  `).all();
  const empresas21 = [...new Set(check.map(r => r.empresa_id))];
  if (empresas21.length === 1 && empresas21[0] === 1) {
    console.log('✅ CORRETO: somente empresa=1 (J2A) respondeu ao 2.1');
  } else {
    console.log('❌ PROBLEMA: responderam', empresas21, '— esperado apenas [1]');
  }

  console.log('\n' + '═'.repeat(70) + '\n');
  process.exit(0);
})();
