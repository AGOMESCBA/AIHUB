'use strict';
/**
 * Teste de integração real com IA — IA Command
 *
 * Invoca _pipeline() diretamente, bypassa WhatsApp e autenticação web.
 * Usa empresa_id=1 (J2A Consultoria) e sender=5565999875116 (Alessandro).
 * Requer que o banco SQLite esteja íntegro e as conexões ERP ativas.
 *
 * Uso:
 *   cd "c:/Apps/iahub/apps/IA Command"
 *   node tests/teste-ia-real.js
 *
 * Para testar outra empresa ou número, edite EMPRESA_ID e SENDER abaixo.
 */

const EMPRESA_ID = 1;                    // J2A Consultoria
const SENDER     = '5565999875116';      // Alessandro Gomes (autorizado)
const BASE_DIR = require('path').resolve(__dirname, '..');

// IMPORTANTE: chdir antes de qualquer require relativo
process.chdir(BASE_DIR);

// ── Inicializa banco ──────────────────────────────────────────────────────────
const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

// ── Instancia o service ───────────────────────────────────────────────────────
const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
// Setar empresa/canal diretamente (bypassa start() que exige WhatsApp real)
// Canal 'emp_1' = WhatsApp J2A Consultoria (ativo no banco, empresa_id=1)
svc._empresaId  = EMPRESA_ID;
svc._channelId  = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';

// Bypassa verificação de autorização (teste local — número já está no banco)
svc._isSenderAuthorized = () => true;

// Bypassa verificação de módulo (banco local tem modulo_* = 0; em prod estão habilitados)
const intentRouter = require(BASE_DIR + '/modules/erp/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

// Silencia envio real de WhatsApp (não há client conectado)
svc._enviarResposta = async (sender, texto) => {
  console.log(`\n📤 RESPOSTA PARA ${sender}:\n${'─'.repeat(60)}\n${texto}\n${'─'.repeat(60)}`);
};

// ── Casos de teste ────────────────────────────────────────────────────────────
const CASOS = [
  {
    desc  : 'Faturamento cliente COABRA em 2026',
    texto : 'faturamento feito para o cliente COABRA no ano de 2026',
  },
  {
    desc  : 'Cliente com maior faturamento em maio',
    texto : 'Qual cliente com maior faturamento no mês de maio?',
  },
  {
    desc  : 'Contas a pagar dos próximos 10 dias',
    texto : 'Contas a pagar dos próximos 10 dias?',
  },
  {
    desc  : 'Contas a receber do ano por mês',
    texto : 'Quais as nossas Contas a receber do ano por mes?',
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('TESTE DE INTEGRAÇÃO REAL — IA COMMAND');
  console.log(`Empresa: ${EMPRESA_ID}  |  Sender: ${SENDER}`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { desc, texto } = CASOS[i];
    console.log(`\n[${i + 1}/${CASOS.length}] ${desc}`);
    console.log(`    Mensagem: "${texto}"`);

    const t0 = Date.now();
    try {
      // Chama _pipelineAll diretamente com empresa_id=1 para pular seleção multiempresa
      const resposta = await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'J2A Consultoria' }], SENDER, {});
      const ms = Date.now() - t0;
      console.log(`    ✅ Concluído em ${ms}ms`);
      if (resposta) {
        console.log(`    Resposta (trecho): "${String(resposta).slice(0, 120)}..."`);
      }
    } catch (err) {
      const ms = Date.now() - t0;
      console.error(`    ❌ Erro após ${ms}ms: ${err.message}`);
    }

    // Pausa entre chamadas para não saturar a API
    if (i < CASOS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Verifica timing no banco ──────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log('Verificando timing_json no interpretation_log...\n');
  try {
    const { getDB } = require(BASE_DIR + '/modules/database/index');
    const d = getDB();
    const rows = d.prepare(`
      SELECT id, duracao_ms, timing_json, formatacao_caminho, criado_em
      FROM interpretation_log
      WHERE empresa_id = ?
      ORDER BY criado_em DESC
      LIMIT 5
    `).all(EMPRESA_ID);

    if (!rows.length) {
      console.log('  (sem registros — pipeline pode ter falhado antes de logar)');
    } else {
      for (const row of rows) {
        const timing = row.timing_json ? JSON.parse(row.timing_json) : null;
        console.log(`  id=${row.id} | ${row.duracao_ms}ms total | formatacao=${row.formatacao_caminho || 'n/a'}`);
        if (timing) {
          console.log(`    roteador=${timing.roteador_ms}ms | intent=${timing.intent_ms}ms | router=${timing.router_ms}ms`);
        }
      }
    }
  } catch (e) {
    console.error('  Erro ao ler interpretation_log:', e.message);
  }

  console.log(`\n${'═'.repeat(60)}\n`);
  process.exit(0);
})();
