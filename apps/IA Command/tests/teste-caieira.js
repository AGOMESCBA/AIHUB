'use strict';
/**
 * Teste de integração CAIEIRA — IA Command
 *
 * Casos:
 *   1) Faturamento da CAIEIRA do mes por valor e quantidade
 *   2) Faturamento da empresa CAIEIRA do mes por valor e quantidade demonstrando as devoluções
 *      (multi-turn: enviado na mesma sessão, herda contexto do caso 1)
 *
 * Uso:
 *   cd "c:/Apps/iahub/apps/IA Command"
 *   node tests/teste-caieira.js
 */

const EMPRESA_CANAL = 1;   // empresa_id do canal (J2A = canal ativo no banco local)
const EMPRESA_CAIEIRA = 4; // empresa_id alvo nas respostas
const SENDER = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();

svc._empresaId   = EMPRESA_CANAL;
svc._channelId   = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

// Lista de empresas do canal — inclui CAIEIRA para que o pipeline resolva o tenant
const EMPRESAS_CANAL = [
  { empresa_id: 1, nome: 'J2A Consultoria',    alias: 'J2A' },
  { empresa_id: 4, nome: 'Caieira do Sul',      alias: 'CAIEIRA' },
];

let respostaCapturada = null;
svc._enviarResposta = async (sender, texto) => {
  respostaCapturada = texto;
  console.log(`\n📤 RESPOSTA PARA ${sender}:\n${'─'.repeat(70)}\n${texto}\n${'─'.repeat(70)}`);
};

const CASOS = [
  {
    desc : 'TESTE 1 — Faturamento CAIEIRA do mês por valor e quantidade',
    texto: 'Faturamento da CAIEIRA do mes por valor e quantidade',
  },
  {
    desc : 'TESTE 2 — Multi-turn: valor e quantidade demonstrando devoluções',
    texto: 'Faturamento da empresa CAIEIRA do mes por valor e quantidade demonstrando as devoluções',
  },
];

(async () => {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('TESTE CAIEIRA — FATURAMENTO MULTI-TURN');
  console.log(`Canal: emp_1 (J2A)  |  Sender: ${SENDER}`);
  console.log(`Empresas no canal: ${EMPRESAS_CANAL.map(e => e.alias || e.nome).join(', ')}`);
  console.log(`${'═'.repeat(70)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { desc, texto } = CASOS[i];
    console.log(`\n${'▶'.repeat(3)} ${desc}`);
    console.log(`    Mensagem: "${texto}"`);

    respostaCapturada = null;
    const t0 = Date.now();
    try {
      await svc._pipelineAll(texto, EMPRESAS_CANAL, SENDER, {});
      const ms = Date.now() - t0;
      console.log(`\n    ✅ Concluído em ${ms}ms`);
    } catch (err) {
      const ms = Date.now() - t0;
      console.error(`\n    ❌ ERRO após ${ms}ms:`, err.message);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }

    if (i < CASOS.length - 1) {
      console.log('\n    ⏳ Aguardando 3s antes do próximo caso...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Últimos logs do interpretation_log
  console.log(`\n${'─'.repeat(70)}`);
  console.log('Últimas entradas no interpretation_log (empresa_id=4):\n');
  try {
    const { getDB } = require(BASE_DIR + '/modules/database/index');
    const db = getDB();
    const rows = db.prepare(`
      SELECT id, duracao_ms, timing_json, formatacao_caminho, sql_gerado, criado_em
      FROM interpretation_log
      WHERE empresa_id = 4
      ORDER BY criado_em DESC
      LIMIT 4
    `).all();

    if (!rows.length) {
      console.log('  (sem registros — empresa_id=4 pode não ter sido ativada)');
    } else {
      for (const row of rows) {
        const timing = row.timing_json ? JSON.parse(row.timing_json) : null;
        console.log(`  id=${row.id} | ${row.duracao_ms}ms | formatacao=${row.formatacao_caminho || 'n/a'} | ${row.criado_em}`);
        if (timing) {
          const t = timing;
          console.log(`    roteador=${t.roteador_ms}ms | intent=${t.intent_ms}ms | router=${t.router_ms}ms`);
        }
        if (row.sql_gerado) {
          const sqlTrecho = String(row.sql_gerado).replace(/\s+/g, ' ').slice(0, 200);
          console.log(`    SQL: ${sqlTrecho}...`);
        }
      }
    }
  } catch (e) {
    console.error('  Erro ao ler interpretation_log:', e.message);
  }

  console.log(`\n${'═'.repeat(70)}\n`);
  process.exit(0);
})();
