// Onde os jobs rodam (tela Jobs, gravado no banco do serviço — não no .env,
// pedido do usuário, 2026-11-24). Site e serviço leem a cada ciclo: a troca
// vale sem reiniciar nada.
//
// servicoNoComando(): modo 'servico' E serviço dando sinal. Se o serviço some
// (sem sinal há alertaSemSinalMin, ou parou de forma limpa), o site reassume
// sozinho; quando o serviço volta, ele reassume. Na troca, a trava própria de
// cada job (ex.: a da Jaade) impede duas execuções do mesmo trabalho.
const repo = require('./repositorio');

function modoConfigurado() {
  try {
    return repo.getConfigJobs().modo === 'servico' ? 'servico' : 'site';
  } catch (_) {
    // Banco do serviço ilegível: o site segue rodando (nunca fica sem ninguém).
    return 'site';
  }
}

function servicoNoComando({ agora = new Date() } = {}) {
  try {
    const cfg = repo.getConfigJobs();
    if (cfg.modo !== 'servico') return false;
    return repo.estadoServico({ agora, toleranciaMs: Math.max(1, Number(cfg.alertaSemSinalMin) || 5) * 60000 }).ativo;
  } catch (_) {
    return false;
  }
}

module.exports = { modoConfigurado, servicoNoComando };
