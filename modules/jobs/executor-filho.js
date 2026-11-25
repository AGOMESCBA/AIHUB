// Processo filho de UMA execução de job (aberto pelo supervisor com fork).
// Roda o job, manda o resultado pelo canal IPC e sai. Tudo que der errado aqui
// fica neste processo: o supervisor e os outros jobs seguem.
//
// argv: <módulo do catálogo> <jobId> <instancia> <origem>
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// Ctrl+C do NSSM chega a todos os processos do console: quem decide parar o
// filho é o supervisor (desligamento controlado), não o sinal.
process.on('SIGINT', () => {});
process.on('SIGBREAK', () => {});

const [moduloCatalogo, jobId, instancia, origem, execId] = process.argv.slice(2);
let enviado = false;

function terminar(mensagem, codigo) {
  if (enviado) return;
  enviado = true;
  // Sai mesmo com conexões keep-alive abertas: a execução acabou.
  const sair = () => process.exit(codigo);
  try {
    process.send(mensagem, sair);
  } catch (_) {
    sair();
  }
  setTimeout(sair, 5000).unref();
}

function _falha(err) {
  terminar({ tipo: 'fim', resultado: 'erro', erro: err?.stack || err?.message || String(err) }, 1);
}
process.on('uncaughtException', _falha);
process.on('unhandledRejection', _falha);

(async () => {
  const def = require(moduloCatalogo).padrao().obter(jobId);
  if (!def) throw new Error(`Job não encontrado no catálogo: ${jobId}`);
  if (def.preparar) await def.preparar();
  const r = (await def.executar(instancia, { origem, execId })) || {};
  const resultado = ['ok', 'vazio', 'aviso'].includes(r.resultado) ? r.resultado : 'ok';
  terminar({ tipo: 'fim', resultado, resumo: r.resumo ?? null }, 0);
})().catch(_falha);
