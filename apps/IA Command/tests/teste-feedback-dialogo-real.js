'use strict';
/**
 * Teste de integração real com IA — dialogo de feedback tecnico (IA Command)
 *
 * Simula o fluxo completo via WhatsApp real: faz uma consulta, pede "mostre o
 * SQL usado", reporta um erro, conduz o dialogo natural com a IA e verifica
 * se a proposta foi (ou nao) registrada em spec_feedback_propostas conforme
 * o desfecho (fechamento ou abandono).
 *
 * Uso:
 *   cd "c:/Apps/iahub/apps/IA Command"
 *   node tests/teste-feedback-dialogo-real.js
 */

const EMPRESA_ID = 1;
const SENDER     = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');
process.chdir(BASE_DIR);

const { inicializarDB, getDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const specFeedbackStore = require(BASE_DIR + '/modules/ai/spec-feedback-store');

function novoServico() {
  const svc = new IACWhatsAppService();
  svc._empresaId = EMPRESA_ID;
  svc._channelId = 'emp_1';
  svc._channelName = 'WhatsApp J2A Consultoria';
  svc._isSenderAuthorized = () => true;
  svc._enviarResposta = async () => {};
  const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
  if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
    intentRouter._verificarAutorizacaoModulo = () => null;
  }
  return svc;
}

function ultimaPropostaId() {
  const row = getDB().prepare('SELECT id FROM spec_feedback_propostas ORDER BY criado_em DESC LIMIT 1').get();
  return row ? row.id : null;
}

async function cenarioFechamentoDireto() {
  console.log('\n[Cenário 1] Reporte de erro direto, ancorado em consulta recente -> espera fechamento ou pergunta');
  const svc = novoServico();

  const r1 = await svc._pipeline('Saldo bancário desconsiderando os Bancos CX1 e CX2', SENDER, {});
  console.log('  Q1 resposta (trecho):', String(r1 || '').slice(0, 150).replace(/\n/g, ' '));

  const idAntes = ultimaPropostaId();
  const r2 = await svc._pipeline('Você não desconsiderou os bancos CX1 e CX2 como pedi, isso está errado', SENDER, {});
  console.log('  Q2 (reporte de erro) resposta (trecho):', String(r2 || '').slice(0, 200).replace(/\n/g, ' '));

  const ctx = svc._getSenderContext(SENDER);
  if (ctx?._feedbackSession) {
    console.log('  -> Sessão de feedback ABERTA (tipo=pergunta). Continuando diálogo...');
    const r3 = await svc._pipeline('Sim, exatamente isso. O filtro NOT IN não foi aplicado no SQL final.', SENDER, {});
    console.log('  Q3 resposta (trecho):', String(r3 || '').slice(0, 200).replace(/\n/g, ' '));
    const ctx2 = svc._getSenderContext(SENDER);
    console.log('  -> Sessão ainda aberta após Q3?', !!ctx2?._feedbackSession);
  } else {
    console.log('  -> Fechou direto na primeira resposta (tipo=fechamento).');
  }

  const idDepois = ultimaPropostaId();
  if (idDepois && idDepois !== idAntes) {
    const row = specFeedbackStore.obterPorId(idDepois, EMPRESA_ID);
    console.log('  ✅ Proposta registrada:', { id: row.id, modulo: row.modulo, fragmento: row.fragmento_afetado, status: row.status });
    console.log('  diagnostico_ia:', row.diagnostico_ia);
    console.log('  texto_proposto (trecho):', String(row.texto_proposto || '').slice(0, 200));
  } else {
    console.log('  ⚠️  Nenhuma proposta nova registrada (diálogo pode ainda estar em aberto, ou IA decidiu não fechar).');
  }
}

async function cenarioAbandono() {
  console.log('\n[Cenário 2] Reporte de erro, depois muda de assunto no meio -> espera abandono silencioso');
  const svc = novoServico();

  await svc._pipeline('Contas a pagar dos próximos 10 dias', SENDER, {});
  const idAntes = ultimaPropostaId();
  await svc._pipeline('Isso está errado, o valor não confere', SENDER, {});
  const ctxAberta = svc._getSenderContext(SENDER);
  console.log('  Sessão de feedback aberta após reporte?', !!ctxAberta?._feedbackSession);

  if (ctxAberta?._feedbackSession) {
    const r = await svc._pipeline('Qual cliente com maior faturamento no mês de maio?', SENDER, {});
    console.log('  Resposta após mudar de assunto (trecho):', String(r || '').slice(0, 150).replace(/\n/g, ' '));
    const ctxDepois = svc._getSenderContext(SENDER);
    console.log('  Sessão de feedback foi encerrada (abandono)?', !ctxDepois?._feedbackSession);
    const respostaParecePergunta = /faturamento|maio|cliente/i.test(String(r || ''));
    console.log('  Resposta parece ter reprocessado a NOVA pergunta pelo pipeline normal?', respostaParecePergunta);
  } else {
    console.log('  -> Não abriu sessão (fechou ou não ancorou) — cenário de abandono não testável neste turno.');
  }

  const idDepois = ultimaPropostaId();
  console.log('  Nenhuma proposta deveria ter sido criada no abandono:', idDepois === idAntes ? 'OK (nenhuma nova)' : 'gerou proposta mesmo assim - revisar');
}

async function cenarioSemAncoragem() {
  console.log('\n[Cenário 3] Reporte de erro SEM nenhuma consulta recente -> não deve abrir diálogo');
  const svc = novoServico();
  // Sender diferente, sem histórico de interpretation_log recente nesta sessão de teste.
  const senderIsolado = '5565999800000';
  svc._isSenderAuthorized = () => true;
  const r = await svc._pipeline('Isso está errado, o valor não confere', senderIsolado, {});
  console.log('  Resposta (trecho):', String(r || '').slice(0, 200).replace(/\n/g, ' '));
  const ctx = svc._getSenderContext(senderIsolado);
  console.log('  Não deveria ter aberto sessão de feedback:', !ctx?._feedbackSession ? 'OK' : 'FALHOU - abriu sessão sem ancora');
}

(async () => {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('TESTE DE INTEGRAÇÃO REAL — DIÁLOGO DE FEEDBACK TÉCNICO (IA Command)');
  console.log(`Empresa: ${EMPRESA_ID}  |  Sender: ${SENDER}`);
  console.log(`${'═'.repeat(70)}`);

  try {
    await cenarioSemAncoragem();
    await new Promise(r => setTimeout(r, 1500));
    await cenarioFechamentoDireto();
    await new Promise(r => setTimeout(r, 1500));
    await cenarioAbandono();
  } catch (e) {
    console.error('\n❌ Erro inesperado durante os cenários:', e.message);
    console.error(e.stack);
  }

  console.log(`\n${'═'.repeat(70)}\n`);
  process.exit(0);
})();
