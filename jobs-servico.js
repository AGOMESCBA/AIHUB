// Serviço IAHub-Jobs (NSSM): roda os agendadores fora do site (pedido do
// usuário, 2026-11-24). Parar este serviço para os jobs sem tirar o site do
// ar; reiniciar o site não corta uma execução no meio.
//
// Onde os jobs rodam é escolhido na tela Jobs (IA Gestão), não no .env: em
// modo Site este serviço fica no ar dando sinal e atendendo só os pedidos da
// tela; em modo Serviço ele agenda. Se ele parar, o site reassume sozinho.
require('dotenv').config();
const jobsDb = require('./modules/jobs/database');
const catalogo = require('./modules/jobs/catalogo');
const { Supervisor, configDoAmbiente } = require('./modules/jobs/supervisor');

// Erro não tratado no supervisor: registra e sai; o NSSM sobe de novo e as
// concessões vencidas são retomadas (mais seguro que seguir em estado incerto).
process.on('uncaughtException', (err) => {
  console.error('[Jobs] Erro não tratado no supervisor, encerrando:', err?.stack || err);
  try { _gravarLog('erro', `Erro não tratado no supervisor, encerrando (o Windows sobe de novo): ${err?.message || err}`); } catch (_) { /* segue saindo */ }
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[Jobs] Promessa rejeitada sem tratamento no supervisor, encerrando:', err?.stack || err);
  try { _gravarLog('erro', `Promessa rejeitada sem tratamento, encerrando (o Windows sobe de novo): ${err?.message || err}`); } catch (_) { /* segue saindo */ }
  process.exit(1);
});

jobsDb.inicializarDB();

// Log do serviço: vai para o arquivo do NSSM (com hora) e para o log da aba
// Serviço da tela Jobs (cor por tipo, como o terminal do WhatsApp).
const repo = require('./modules/jobs/repositorio');
function _tipoLog(nivel, texto) {
  if (nivel === 'erro' || texto.includes('✖')) return 'error';
  if (/ALERTA|aviso|adiado|Limite de/i.test(texto)) return 'warning';
  if (texto.includes('▶') || /Supervisor|Modo (Serviço|Site)|desligamento/i.test(texto)) return 'system';
  if (texto.includes('■')) return 'success';
  return 'info';
}
function _gravarLog(nivel, texto) {
  try { repo.registrarLog(_tipoLog(nivel, String(texto)), String(texto).replace(/^\[Jobs\]\s*/, '')); } catch (_) { /* o log nunca derruba o serviço */ }
}
const logger = {
  log: (texto) => { console.log(`${new Date().toISOString()} ${texto}`); _gravarLog('info', texto); },
  error: (texto) => { console.error(`${new Date().toISOString()} ${texto}`); _gravarLog('erro', texto); },
};

// verificarSite: o serviço também vigia o site e avisa por e-mail/Telegram se ele cair.
const supervisor = new Supervisor({ catalogo: catalogo.padrao(), config: configDoAmbiente(), log: logger, verificarSite: require('./modules/jobs/alerta').verificarSite });
let saindo = false;
const sair = async (sinal) => {
  if (saindo) return;
  saindo = true;
  logger.log(`[Jobs] ${sinal} recebido: desligamento controlado.`);
  await supervisor.parar();
  jobsDb.fecharDB();
  process.exit(0);
};
// NSSM para o serviço com Ctrl+C (SIGINT no Windows); Ctrl+Break chega como SIGBREAK.
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sinal, () => sair(sinal));
supervisor.iniciar();
