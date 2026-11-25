// Alertas do serviço de jobs por WhatsApp (pedido do usuário, 2026-11-24): job
// com falhas seguidas, serviço sem sinal e a volta ao normal de cada um. Envia
// pela mesma rota server-to-server do IA Command que a Jaade usa; o destino
// (empresa do canal + grupos) é escolhido na tela Jobs.
const repo = require('./repositorio');
// Reserva por empresa (e-mail/Telegram): fala direto com SMTP/Telegram, sem o site.
const reservaPadrao = require('../../apps/IAHUB/backend/parametros/alertas-reserva');

const TIMEOUT_MS = 60 * 1000;

function _base() {
  return process.env.IA_COMMAND_INTERNAL_URL || 'http://127.0.0.1:' + (process.env.PORT || 3000);
}

function _segredo() {
  return String(process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET || process.env.SVC_WHATSAPP_OTP_SECRET || '').trim();
}

async function _iaCommand(caminho, corpo = null) {
  const segredo = _segredo();
  if (!segredo) throw new Error('Envio de WhatsApp não configurado (segredo do serviço externo ausente).');
  const r = await fetch(`${_base()}${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-servico-externo-secret': segredo },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `IA Command respondeu HTTP ${r.status}.`);
  return json;
}

/** Grupos ativos da empresa no IA Command (tela escolhe o destino). */
function listarGrupos(empresaId) {
  return _iaCommand(`/api/ia-command/whatsapp/grupos-servico-externo?empresaId=${Number(empresaId)}`);
}

const TIPOS = { falha: 'falha de job', servico: 'serviço' };

/** Grupos do tipo de alerta ('teste' = todos os marcados, sem repetir). */
function gruposDoTipo(cfg, tipo) {
  if (tipo === 'falha') return cfg.alertaGruposFalha || [];
  if (tipo === 'servico') return cfg.alertaGruposServico || [];
  return [...new Set([...(cfg.alertaGruposFalha || []), ...(cfg.alertaGruposServico || [])])];
}

/**
 * Envia o alerta aos grupos do tipo ('falha' | 'servico' | 'teste') e, pela
 * regra da empresa (Parâmetros por Empresa › Alertas), também pela reserva
 * (e-mail/Telegram) — normalmente só se o WhatsApp não entregar.
 * semWhatsapp: o site está fora (o WhatsApp sai por ele), vai direto à reserva.
 * Nunca lança: o resultado vira evento na tela Jobs.
 */
async function enviar(texto, { tipo = 'falha', referencia = '', usuario = null, semWhatsapp = false, reserva = reservaPadrao.enviar } = {}) {
  let cfg;
  try {
    cfg = repo.getConfigJobs();
  } catch (err) {
    return { enviado: false, motivo: `configuração ilegível: ${err.message}` };
  }
  const mensagem = `⚠️ IAHub · Serviço de jobs\n\n${texto}`;
  const grupos = gruposDoTipo(cfg, tipo);
  const canais = [];
  let motivoWhats = null;
  if (semWhatsapp) {
    motivoWhats = 'site fora do ar';
  } else if (!cfg.alertaEmpresaId || !grupos.length) {
    motivoWhats = 'sem destino configurado';
  } else {
    try {
      await _iaCommand('/api/ia-command/whatsapp/enviar-grupo-servico-externo', {
        empresaId: Number(cfg.alertaEmpresaId), grupoIds: grupos, texto: mensagem,
        finalidadeEnvio: 'iahub_jobs_alerta', referencia,
      });
      canais.push('WhatsApp');
    } catch (err) {
      motivoWhats = err.message;
      _evento('erro', 'alerta_falhou', `Alerta por WhatsApp falhou (${err.message}): ${texto}`, usuario);
    }
  }
  const r = await reserva(cfg.alertaEmpresaId, mensagem, { assunto: `IAHub · Alerta (${TIPOS[tipo] || tipo})`, whatsappFalhou: !canais.length });
  const NOMES = { email: 'e-mail', telegram: 'Telegram', telegram_env: 'Telegram (.env)' };
  canais.push(...(r.canais || []).map(c => NOMES[c] || c));
  if (r.erros?.length && !r.pulado && !r.enviado) _evento('erro', 'alerta_reserva_falhou', `Reserva do alerta falhou (${r.erros.join('; ')}): ${texto}`, usuario);
  if (canais.length) {
    _evento('info', 'alerta_enviado', `Alerta enviado por ${canais.join(' e ')}: ${texto}`, usuario);
    return { enviado: true, canais };
  }
  if (motivoWhats === 'sem destino configurado' && !(r.erros || []).some(e => !/nenhum canal de reserva/.test(e))) {
    _evento('aviso', 'alerta_sem_destino', `Alerta de ${TIPOS[tipo] || tipo} não enviado: sem grupos na tela Jobs e sem e-mail/Telegram em Parâmetros por Empresa. ${texto}`, usuario);
    return { enviado: false, motivo: 'sem destino configurado' };
  }
  return { enviado: false, motivo: [motivoWhats, ...(r.erros || [])].filter(Boolean).join('; ') };
}

function _evento(nivel, tipo, texto, usuario) {
  try {
    repo.registrarEvento({ nivel, tipo, texto, usuario });
  } catch (err) {
    console.error('[Jobs] Evento do alerta não gravado:', err.message);
  }
}

/** Vigilância mútua: o site responde? (rota pública e leve do próprio site). */
async function verificarSite() {
  try {
    const r = await fetch(`${_base()}/api/config/publico`, { signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

module.exports = { listarGrupos, enviar, gruposDoTipo, verificarSite };
