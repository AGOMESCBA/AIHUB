'use strict';
/**
 * Teste de faturamento completo — 4 perguntas + 1 multi-turn
 * Empresas: CAIEIRA (4), J2A (1), C3I (2)
 */

const SENDER = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');
process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId   = 1;
svc._channelId   = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

const EMPRESAS_CANAL = [
  { empresa_id: 1, nome: 'J2A Consultoria',  alias: 'J2A' },
  { empresa_id: 2, nome: 'C3I',               alias: 'C3I' },
  { empresa_id: 4, nome: 'Caieira do Sul',    alias: 'CAIEIRA' },
];

svc._enviarResposta = async (sender, texto) => {
  console.log(`\n📤 RESPOSTA:\n${'─'.repeat(70)}\n${texto}\n${'─'.repeat(70)}`);
};

// Casos: desc, texto, resetContexto (true = limpa sessão antes)
const CASOS = [
  {
    desc : '1 — CAIEIRA: faturamento do mês por produto com valor e quantidade + devoluções',
    texto: 'Faturamento da CAIEIRA do mes por produto com valor e quantidade considerando devolução',
    reset: true,
  },
  {
    desc : '2 — J2A: faturamento do mês por produto com valor e quantidade',
    texto: 'Faturamento da empresa J2A do mes por produto com valor e quantidade',
    reset: true,
  },
  {
    desc : '2.1 — J2A multi-turn: detalhar por cliente',
    texto: 'Me detalhe por cliente',
    reset: false,
  },
  {
    desc : '3 — C3I: faturamento do mês por produto com valor e quantidade',
    texto: 'Faturamento da empresa C3I do mes por produto com valor e quantidade',
    reset: true,
  },
  {
    desc : '4 — J2A + C3I: faturamento do mês por produto com valor e quantidade',
    texto: 'Faturamento da J2A e C3I do mes por produto com valor e quantidade',
    reset: true,
  },
];

(async () => {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('TESTE FATURAMENTO COMPLETO — 3 EMPRESAS');
  console.log(`Sender: ${SENDER} | Canal: emp_1`);
  console.log(`Empresas: ${EMPRESAS_CANAL.map(e => `${e.alias}(${e.empresa_id})`).join(', ')}`);
  console.log(`${'═'.repeat(70)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { desc, texto, reset } = CASOS[i];

    if (reset) {
      // Limpa contexto de sessão para não herdar de caso anterior
      if (typeof svc._clearLastIntent === 'function') {
        svc._clearLastIntent(SENDER);
      }
      console.log(`\n${'▶'.repeat(3)} [NOVO CONTEXTO] ${desc}`);
    } else {
      console.log(`\n${'▶'.repeat(3)} [MULTI-TURN] ${desc}`);
    }
    console.log(`    Mensagem: "${texto}"`);

    const t0 = Date.now();
    try {
      await svc._pipelineAll(texto, EMPRESAS_CANAL, SENDER, {});
      console.log(`\n    ✅ ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`\n    ❌ ERRO (${Date.now() - t0}ms): ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 3).join('\n'));
    }

    if (i < CASOS.length - 1) {
      const pausa = reset ? 3000 : 1500;
      console.log(`\n    ⏳ Aguardando ${pausa/1000}s...`);
      await new Promise(r => setTimeout(r, pausa));
    }
  }

  // Resumo dos SQLs gerados
  console.log(`\n${'═'.repeat(70)}`);
  console.log('RESUMO — SQLs gerados (últimos 6 registros, todas empresas):\n');
  try {
    const { getDB } = require(BASE_DIR + '/modules/database/index');
    const db = getDB();
    const rows = db.prepare(`
      SELECT empresa_id, duracao_ms, resultado_tipo, sql_gerado, resposta_entregue, criado_em
      FROM interpretation_log
      ORDER BY criado_em DESC
      LIMIT 6
    `).all();

    for (const r of rows) {
      console.log(`\n[empresa=${r.empresa_id}] ${r.criado_em} | ${r.duracao_ms}ms | tipo=${r.resultado_tipo || 'n/a'}`);
      const sqlTrecho = String(r.sql_gerado || '').replace(/\s+/g, ' ').slice(0, 180);
      console.log(`  SQL: ${sqlTrecho || '(vazio)'}...`);
      if (r.resposta_entregue) {
        console.log(`  RESPOSTA: ${String(r.resposta_entregue).slice(0, 300)}`);
      }
    }
  } catch (e) {
    console.error('Erro ao ler log:', e.message);
  }

  console.log(`\n${'═'.repeat(70)}\n`);
  process.exit(0);
})();
