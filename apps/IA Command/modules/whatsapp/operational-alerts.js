'use strict';

// Alerta operacional fora do WhatsApp. Usado justamente quando o canal WhatsApp
// pode estar indisponivel, aguardando QR ou sem sessao valida.
const TELEGRAM_ALERT_BOT_TOKEN = String(process.env.IAC_TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_ALERT_CHAT_ID = String(process.env.IAC_TELEGRAM_ALERT_CHAT_ID || '').trim();
const TELEGRAM_ALERT_COOLDOWN_MS = Math.max(
  60000,
  Number(process.env.IAC_TELEGRAM_ALERT_COOLDOWN_MS || 1800000)
);

const ultimoAlertaPorChave = new Map();
let avisouTelegramNaoConfigurado = false;

function telegramConfigurado() {
  return Boolean(TELEGRAM_ALERT_BOT_TOKEN && TELEGRAM_ALERT_CHAT_ID);
}

function podeAlertar(chave) {
  const agora = Date.now();
  const anterior = ultimoAlertaPorChave.get(chave) || 0;
  if (agora - anterior < TELEGRAM_ALERT_COOLDOWN_MS) return false;
  ultimoAlertaPorChave.set(chave, agora);
  return true;
}

async function alertarOperacionalTelegram(mensagem, opts = {}) {
  if (!telegramConfigurado()) {
    if (!avisouTelegramNaoConfigurado) {
      avisouTelegramNaoConfigurado = true;
      process.stdout.write(
        `[${new Date().toISOString()}] [WARN] Alerta Telegram nao configurado: ` +
        `defina IAC_TELEGRAM_BOT_TOKEN e IAC_TELEGRAM_ALERT_CHAT_ID.\n`
      );
    }
    return { ok: false, skipped: 'telegram_nao_configurado' };
  }

  const chave = opts.chave ? String(opts.chave) : '';
  if (chave && !podeAlertar(chave)) return { ok: false, skipped: 'cooldown' };

  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_ALERT_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_ALERT_CHAT_ID, text: mensagem }),
    });

    if (!resp.ok) {
      process.stdout.write(`[${new Date().toISOString()}] [WARN] Alerta Telegram falhou: HTTP ${resp.status}\n`);
      return { ok: false, status: resp.status };
    }

    return { ok: true };
  } catch (err) {
    process.stdout.write(`[${new Date().toISOString()}] [WARN] Alerta Telegram falhou: ${err.message}\n`);
    return { ok: false, error: err.message };
  }
}

function descreverCanal(canal, channelId) {
  if (!canal) return String(channelId || 'desconhecido');
  return `${canal.nome || canal.id || channelId}${canal.id ? ` (${canal.id})` : ''}`;
}

function alertarEventoWorkerWhatsapp({ channelId, event, payload, canal }) {
  const dados = payload && typeof payload === 'object' ? payload : {};
  const status = String(dados.status || '').trim();
  const msg = String(dados.msg || dados.message || '').trim();
  const canalDesc = descreverCanal(canal, channelId);

  if (event === 'iac-qr') {
    return alertarOperacionalTelegram(
      `🟡 IAHub — WhatsApp aguardando QR Code\n` +
      `Canal: ${canalDesc}\n` +
      `Um novo QR Code foi gerado. Abra o painel do IA Command e escaneie o QR para reconectar o atendimento.`,
      { chave: `wa:${channelId}:qr` }
    );
  }

  if (event === 'iac-status' && status === 'stopped') {
    return alertarOperacionalTelegram(
      `🔴 IAHub — WhatsApp parado\n` +
      `Canal: ${canalDesc}\n` +
      `O worker informou status stopped. Verifique o painel do IA Command; pode ser necessario iniciar o servico ou escanear um novo QR Code.`,
      { chave: `wa:${channelId}:stopped` }
    );
  }

  if (event === 'iac-log' && /(QR Code gerado|Sem sess[aã]o WhatsApp salva|LOGOUT|reconex[aã]o autom[aá]tica.*esgotou)/i.test(msg)) {
    return alertarOperacionalTelegram(
      `🟡 IAHub — Atenção no WhatsApp\n` +
      `Canal: ${canalDesc}\n` +
      `${msg}`,
      { chave: `wa:${channelId}:log:${msg.slice(0, 60)}` }
    );
  }

  return Promise.resolve({ ok: false, skipped: 'evento_sem_alerta' });
}

module.exports = {
  alertarOperacionalTelegram,
  alertarEventoWorkerWhatsapp,
  telegramConfigurado,
};
