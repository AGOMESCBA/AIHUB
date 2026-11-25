// Vigia do serviço de jobs, rodando no SITE (o serviço não consegue avisar
// que ele mesmo morreu). Com a tela Jobs em modo Serviço: serviço sem sinal
// (ou parado) há mais de alertaSemSinalMin → evento + alerta por WhatsApp;
// quando volta → outro alerta. O site já reassume os jobs sozinho (modo.js);
// o alerta é para alguém olhar o serviço.
const repo = require('./repositorio');
const alertaPadrao = require('./alerta');

const CHAVE = 'servico_sem_sinal';
let _ultimaFalha = -Infinity;
const INTERVALO_MS = 60 * 1000;

// Hora local do servidor (o mesmo relógio da tela).
const _hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : 'nunca');

/** Uma verificação (exportada para teste). */
async function verificar({ agora = new Date(), alertar = alertaPadrao.enviar } = {}) {
  const cfg = repo.getConfigJobs();
  if (cfg.modo !== 'servico') {
    // Modo Site: o serviço parado não deixa nada sem rodar.
    repo.fecharAlerta(CHAVE);
    return 'modo_site';
  }
  const toleranciaMs = Math.max(1, Number(cfg.alertaSemSinalMin) || 5) * 60000;
  const estado = repo.estadoServico({ agora, toleranciaMs });
  if (estado.ativo) {
    if (repo.fecharAlerta(CHAVE)) {
      repo.registrarEvento({ nivel: 'info', tipo: 'servico_voltou', texto: 'Serviço de jobs voltou a dar sinal e reassumiu os jobs.', agora });
      const texto = '✅ O serviço de jobs (IAHub-Jobs) voltou a dar sinal e reassumiu os jobs.';
      const r = await alertar(texto, { tipo: 'servico', referencia: CHAVE });
      // Não chegou: fica pendente; o próprio serviço (que voltou) reenvia por até 1 h.
      if (r && !r.enviado && r.motivo !== 'sem destino configurado') repo.abrirAlerta(`${CHAVE}:ok`, texto, { agora });
      return 'voltou';
    }
    return 'ok';
  }
  // Parada limpa (deploy, reinício): dá o mesmo prazo antes de alertar.
  const desde = estado.batimentoEm || estado.paradoEm;
  if (desde && agora.getTime() - Date.parse(desde) < toleranciaMs) return 'aguardando';
  const texto = estado.paradoEm && !estado.batimentoEm
    ? `Serviço de jobs (IAHub-Jobs) parado desde ${_hora(estado.paradoEm)}.`
    : `Serviço de jobs (IAHub-Jobs) sem sinal desde ${_hora(estado.batimentoEm)}.`;
  // Canais fora: nova tentativa no máximo a cada 5 min.
  if (agora.getTime() - _ultimaFalha < 5 * 60000) return 'aguardando_reenvio';
  if (!repo.abrirAlerta(CHAVE, texto, { agora })) return 'ja_alertado';
  repo.registrarEvento({ nivel: 'erro', tipo: 'servico_sem_sinal', texto: `${texto} O site reassumiu os jobs.`, agora });
  const r = await alertar(`❌ ${texto}\nO site reassumiu os jobs automaticamente. Verifique o serviço no servidor (services.msc / logs\\jobs-error.log).`, { tipo: 'servico', referencia: CHAVE });
  // Não chegou (WhatsApp/IA Command fora): reabre para tentar no próximo minuto.
  if (r && !r.enviado && r.motivo !== 'sem destino configurado') {
    repo.fecharAlerta(CHAVE);
    _ultimaFalha = agora.getTime();
    return 'reenviar';
  }
  _ultimaFalha = -Infinity;
  return 'alertado';
}

function iniciar() {
  const rodar = () => verificar().catch(err => console.error('[Jobs] Vigia do serviço falhou:', err.message));
  setInterval(rodar, INTERVALO_MS).unref?.();
}

module.exports = { verificar, iniciar, CHAVE };
