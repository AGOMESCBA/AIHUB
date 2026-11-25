// Canais de reserva dos alertas operacionais (e-mail e Telegram), configurados
// por empresa em Parâmetros por Empresa (IAHub). Usados quando o WhatsApp não
// entrega — inclusive pelo serviço de jobs com o site fora do ar, porque
// falam direto com o SMTP/Telegram, sem passar pelo site.
//
// Sem nada configurado na empresa, cai no Telegram do .env
// (IAC_TELEGRAM_BOT_TOKEN/IAC_TELEGRAM_ALERT_CHAT_ID), que segue só como
// última reserva global até todas as empresas estarem configuradas.
const nodemailer = require('nodemailer');
const store = require('./store');

const TIMEOUT_MS = 20000;

function _cfgEmail(v) {
  return {
    host: v['alertas.email.smtp_host'], porta: v['alertas.email.smtp_porta'], seguranca: v['alertas.email.seguranca'],
    usuario: v['alertas.email.usuario'], senha: v['alertas.email.senha'],
    remetente: v['alertas.email.remetente'] || v['alertas.email.usuario'], destinos: v['alertas.email.destinatarios'] || [],
  };
}

async function _enviarEmail(c, assunto, texto) {
  if (!c.host || !c.usuario || !c.senha || !c.destinos.length) throw new Error('e-mail incompleto (servidor, usuário, senha e destinatários).');
  const transporte = nodemailer.createTransport({
    host: c.host, port: Number(c.porta), secure: c.seguranca === 'ssl', requireTLS: c.seguranca === 'starttls',
    ignoreTLS: c.seguranca === 'nenhuma', auth: { user: c.usuario, pass: c.senha },
    connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
  });
  try {
    await transporte.sendMail({ from: c.remetente, to: c.destinos.join(', '), subject: assunto, text: texto });
  } finally {
    transporte.close();
  }
}

async function _enviarTelegram(token, chatId, texto) {
  if (!token || !chatId) throw new Error('Telegram incompleto (token e chat).');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await r.json().catch(() => ({}));
  // A mensagem do Telegram nunca traz o token; a URL (que traz) não é repassada.
  if (!r.ok || json.ok === false) throw new Error(`Telegram recusou: ${json.description || `HTTP ${r.status}`}.`);
}

function _envTelegram() {
  return {
    token: String(process.env.IAC_TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: String(process.env.IAC_TELEGRAM_ALERT_CHAT_ID || '').trim(),
  };
}

/**
 * Envia pela reserva da empresa conforme os parâmetros:
 *   whatsappFalhou: o WhatsApp não entregou (com "só quando falhar", só aí envia).
 * Devolve { enviado, canais: ['email'|'telegram'|'telegram_env'], erros: [] }.
 * Nunca lança.
 */
async function enviar(empresaId, texto, { assunto = 'IAHub · Alerta operacional', whatsappFalhou = true, usarEnv = true } = {}) {
  const erros = [];
  const canais = [];
  let v;
  try {
    v = store.valores(empresaId || null);
  } catch (err) {
    return { enviado: false, canais, erros: [`parâmetros ilegíveis: ${err.message}`] };
  }
  const quando = v['alertas.reserva.quando'];
  if (quando === 'nunca' || (quando === 'falha_whatsapp' && !whatsappFalhou)) return { enviado: false, canais, erros, pulado: quando };
  const ligados = [];
  if (v['alertas.email.ativo']) ligados.push('email');
  if (v['alertas.telegram.ativo']) ligados.push('telegram');
  if (v['alertas.reserva.ordem'] === 'telegram_email') ligados.reverse();

  const tentar = async (canal) => {
    try {
      if (canal === 'email') await _enviarEmail(_cfgEmail(v), assunto, texto);
      else await _enviarTelegram(v['alertas.telegram.token'], v['alertas.telegram.chat_id'], texto);
      canais.push(canal);
      return true;
    } catch (err) {
      erros.push(`${canal}: ${err.message}`);
      return false;
    }
  };
  if (v['alertas.reserva.ordem'] === 'todos') {
    for (const c of ligados) await tentar(c);
  } else {
    for (const c of ligados) if (await tentar(c)) break;
  }
  // Nenhum canal da empresa entregou (ou nenhum ligado): Telegram global do .env.
  if (!canais.length && usarEnv) {
    const env = _envTelegram();
    if (env.token && env.chatId) {
      try {
        await _enviarTelegram(env.token, env.chatId, texto);
        canais.push('telegram_env');
      } catch (err) {
        erros.push(`telegram (.env): ${err.message}`);
      }
    } else if (!ligados.length) {
      erros.push('nenhum canal de reserva ligado nesta empresa (Parâmetros por Empresa › Alertas).');
    }
  }
  return { enviado: canais.length > 0, canais, erros };
}

/** Botão "Enviar teste" da tela: usa o que está SALVO, ignorando ligado/desligado e a regra de quando. */
async function testar(empresaId, canal, usuario) {
  const v = store.valores(empresaId);
  const texto = `🧪 Teste de alerta do IAHub (${canal === 'email' ? 'e-mail' : 'Telegram'}) pedido por ${usuario || 'administrador'}. Se chegou, este canal está pronto para os avisos de problema.`;
  if (canal === 'email') await _enviarEmail(_cfgEmail(v), 'IAHub · Teste de alerta', texto);
  else if (canal === 'telegram') await _enviarTelegram(v['alertas.telegram.token'], v['alertas.telegram.chat_id'], texto);
  else throw Object.assign(new Error('Canal de teste inválido.'), { status: 400 });
  return { ok: true };
}

/** Telegram do .env (reserva global), para quem já resolveu as empresas antes. */
async function enviarEnv(texto) {
  const env = _envTelegram();
  if (!env.token || !env.chatId) return { enviado: false, motivo: 'telegram do .env não configurado' };
  try {
    await _enviarTelegram(env.token, env.chatId, texto);
    return { enviado: true };
  } catch (err) {
    return { enviado: false, motivo: err.message };
  }
}

module.exports = { enviar, enviarEnv, testar };
