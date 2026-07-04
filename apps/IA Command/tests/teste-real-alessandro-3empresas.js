'use strict';
/**
 * Teste real — Alessandro Gomes simulando "Todas as empresas" no canal emp_1
 *
 * Alessandro tem acesso a empresa_id=1 (J2A), 2 (C3I) e 4 (CAIEIRA).
 * Simula o caso real: usuário escolheu "Todas as empresas".
 * Deve trazer dados de J2A + C3I + CAIEIRA + consolidado das três.
 */

const SENDER   = '5565999875116'; // Alessandro Gomes
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

const EMPRESAS_ALESSANDRO = [
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

function resumoLog(textoOriginal, limite = 5) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT empresa_id, resultado_tipo, duracao_ms, rows_count, sql_validacao_erro, resposta_entregue
    FROM interpretation_log
    WHERE texto_original = ? AND criado_em >= datetime('now', '-10 minutes')
    ORDER BY criado_em DESC LIMIT ?
  `).all(textoOriginal, limite);
  console.log(`\n📋 LOG (${rows.length} registro(s)):`);
  for (const r of rows) {
    console.log(`  empresa=${r.empresa_id} | tipo=${r.resultado_tipo} | linhas=${r.rows_count} | ${r.duracao_ms}ms`);
    if (r.sql_validacao_erro) console.log(`    ❌ ERRO: ${r.sql_validacao_erro}`);
  }
  return rows;
}

(async () => {

  sep('CONFIGURAÇÃO DO TESTE');
  console.log('Sender  : Alessandro Gomes (' + SENDER + ')');
  console.log('Canal   : emp_1 (WhatsApp J2A Consultoria)');
  console.log('Empresas: J2A (1) + C3I (2) + CAIEIRA (4)');

  const PERGUNTA = 'Faturamento do mes por produto com valor e quantidade';

  sep('TESTE — ' + PERGUNTA);
  if (typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);

  const t0 = Date.now();
  try {
    await svc._pipelineAll(PERGUNTA, EMPRESAS_ALESSANDRO, SENDER, {});
    console.log(`\n✅ Concluído em ${Date.now() - t0}ms`);
  } catch (e) {
    console.error('❌ Erro:', e.message);
  }

  resumoLog(PERGUNTA, 5);

  // ── Resposta final entregue ──────────────────────────────────────────────────
  sep('RESPOSTA ENTREGUE AO USUÁRIO');
  const db = getDB();
  const principal = db.prepare(`
    SELECT resposta_entregue FROM interpretation_log
    WHERE texto_original = ? AND criado_em >= datetime('now', '-10 minutes')
      AND escopo_execucao = 'whatsapp_all'
    ORDER BY criado_em DESC LIMIT 1
  `).get(PERGUNTA);
  if (principal?.resposta_entregue) {
    console.log(principal.resposta_entregue);
  } else {
    // fallback: pega o registro com mais linhas (consolidado)
    const fallback = db.prepare(`
      SELECT resposta_entregue FROM interpretation_log
      WHERE texto_original = ? AND criado_em >= datetime('now', '-10 minutes')
      ORDER BY rows_count DESC LIMIT 1
    `).get(PERGUNTA);
    if (fallback?.resposta_entregue) console.log(fallback.resposta_entregue);
    else console.log('(resposta não encontrada no log)');
  }

  // ── Verificação de segurança ─────────────────────────────────────────────────
  sep('VERIFICAÇÃO DE SEGURANÇA');
  const check = db.prepare(`
    SELECT DISTINCT empresa_id FROM interpretation_log
    WHERE texto_original = ? AND criado_em >= datetime('now', '-10 minutes')
    ORDER BY empresa_id
  `).all(PERGUNTA);
  const ids = check.map(r => r.empresa_id);
  console.log('Empresas que responderam:', ids);
  console.log(ids.includes(1) ? '✅ J2A (1)' : '❌ J2A (1) — ausente');
  console.log(ids.includes(2) ? '✅ C3I (2)' : '❌ C3I (2) — ausente');
  console.log(ids.includes(4) ? '✅ CAIEIRA (4)' : '❌ CAIEIRA (4) — ausente');

  console.log('\n' + '═'.repeat(70) + '\n');
  process.exit(0);
})();
