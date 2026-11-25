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
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[Jobs] Promessa rejeitada sem tratamento no supervisor, encerrando:', err?.stack || err);
  process.exit(1);
});

jobsDb.inicializarDB();

// verificarSite: o serviço também vigia o site e avisa por e-mail/Telegram se ele cair.
const supervisor = new Supervisor({ catalogo: catalogo.padrao(), config: configDoAmbiente(), verificarSite: require('./modules/jobs/alerta').verificarSite });
let saindo = false;
const sair = async (sinal) => {
  if (saindo) return;
  saindo = true;
  console.log(`[Jobs] ${sinal} recebido: desligamento controlado.`);
  await supervisor.parar();
  jobsDb.fecharDB();
  process.exit(0);
};
// NSSM para o serviço com Ctrl+C (SIGINT no Windows); Ctrl+Break chega como SIGBREAK.
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sinal, () => sair(sinal));
supervisor.iniciar();
