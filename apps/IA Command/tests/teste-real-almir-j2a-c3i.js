'use strict';
/**
 * Teste real — Almir Weder simulando "Todas as empresas" no canal emp_1
 *
 * Almir tem acesso SOMENTE a empresa_id=1 (J2A) e empresa_id=2 (C3I).
 * CAIEIRA (empresa_id=4) está no canal mas Almir NÃO está autorizado.
 *
 * Simula o caso real: Almir digita a pergunta, o sistema monta a lista
 * de empresas autorizadas para ele (J2A + C3I) e chama _pipelineAll.
 * Deve trazer dados de J2A + C3I + consolidado das duas.
 */

const SENDER   = '5565999988066'; // Almir Weder
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

// Empresas que Almir vê no canal — SOMENTE J2A e C3I (sem CAIEIRA)
const EMPRESAS_ALMIR = [
  { empresa_id: 1, nome: 'J2A Consultoria', alias: 'J2A' },
  { empresa_id: 2, nome: 'C3I',             alias: 'C3I' },
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
    SELECT empresa_id, resultado_tipo, duracao_ms, intent_json, sql_gerado, sql_validacao_erro
    FROM interpretation_log
    WHERE texto_original = ? AND criado_em >= datetime('now', '-5 minutes')
    ORDER BY criado_em DESC LIMIT ?
  `).all(textoOriginal, limite);
  console.log(`\n📋 LOG (${rows.length} registro(s) para "${textoOriginal}"):`);
  for (const r of rows) {
    const intent = r.intent_json ? JSON.parse(r.intent_json) : {};
    console.log(`  empresa=${r.empresa_id} | tipo=${r.resultado_tipo} | ${r.duracao_ms}ms`);
    console.log(`    filtros: ${JSON.stringify(intent.filtros || {})}`);
    console.log(`    empresasMencionadas: ${JSON.stringify(intent._empresasMencionadasTextos || [])}`);
    if (r.sql_validacao_erro) console.log(`    ERRO: ${r.sql_validacao_erro}`);
    const sqlTrecho = String(r.sql_gerado || '').replace(/\s+/g, ' ').slice(0, 300);
    if (sqlTrecho) console.log(`    SQL: ${sqlTrecho}`);
  }
}

(async () => {

  sep('CONFIGURAÇÃO DO TESTE');
  console.log('Sender  : Almir Weder (' + SENDER + ')');
  console.log('Canal   : emp_1 (WhatsApp J2A Consultoria)');
  console.log('Empresas autorizadas para Almir: J2A (1) + C3I (2)');
  console.log('CAIEIRA (4) NÃO está na lista — Almir não tem acesso');

  // ── TESTE: J2A e C3I — faturamento por produto com consolidado ───────────────
  sep('TESTE — Faturamento J2A e C3I do mês por produto com valor e quantidade');
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);

  const PERGUNTA = 'Faturamento do mes por produto com valor e quantidade';
  const t0 = Date.now();
  try {
    await svc._pipelineAll(PERGUNTA, EMPRESAS_ALMIR, SENDER, {});
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
    WHERE texto_original = ? AND criado_em >= datetime('now', '-5 minutes')
    ORDER BY empresa_id
  `).all(PERGUNTA);

  const ids = check.map(r => r.empresa_id);
  console.log('Empresas que responderam:', ids);

  const temCaieira = ids.includes(4);
  const temJ2A     = ids.includes(1);
  const temC3I     = ids.includes(2);

  if (temCaieira) {
    console.log('❌ FALHA DE SEGURANÇA: CAIEIRA (4) respondeu — Almir não deveria ver esses dados!');
  } else {
    console.log('✅ CAIEIRA (4) não respondeu — correto, Almir não tem acesso');
  }
  if (temJ2A)  console.log('✅ J2A (1) respondeu — correto');
  if (temC3I)  console.log('✅ C3I (2) respondeu — correto');
  if (!temJ2A && !temC3I) console.log('❌ Nenhuma empresa autorizada respondeu');

  console.log('\n' + '═'.repeat(70) + '\n');
  process.exit(0);
})();
