'use strict';

// Entrega do código de login. Ordem: WhatsApp pelo canal vinculado à empresa;
// se falhar, e-mail de envio da empresa (reserva). Decisão de 25/11/2026.
//
// Até a C2 (canal próprio do Talk), o WhatsApp sai pelo canal do IA Command
// já vinculado à empresa do IAHub, pela mesma rota interna que o login do IA
// Service usa (apps/IA Service/backend/routes/login-externo-routes.js →
// /api/ia-command/whatsapp/enviar-servico-externo). Só chamada local, sem
// alterar o IA Command. Na C2 este transporte é trocado pelo canal do Talk.

const nodemailer = require('nodemailer');
const { decifrar } = require('../seguranca/cifra');

function textoDoCodigo(codigo, empresaNome) {
  return `*${empresaNome}* — IA Talk\nSeu código de acesso é *${codigo}*.\nVale por 5 minutos. Se não foi você, ignore esta mensagem.`;
}

// Transporte provisório (até a C2). Precisa de hub_empresa_id (empresa integrada ao IAHub).
function criarTransporteIaCommand({ env = process.env, fetchFn = fetch } = {}) {
  return async ({ empresa, telefone, codigo }) => {
    if (!empresa.hub_empresa_id) return { ok: false, motivo: 'empresa_sem_canal' };
    const segredo = String(env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET || env.SVC_WHATSAPP_OTP_SECRET || '').trim();
    if (!segredo) return { ok: false, motivo: 'transporte_nao_configurado' };
    const base = env.IA_COMMAND_INTERNAL_URL || 'http://127.0.0.1:3000';
    try {
      const r = await fetchFn(`${base}/api/ia-command/whatsapp/enviar-servico-externo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Servico-Externo-Secret': segredo },
        body: JSON.stringify({ empresaId: empresa.hub_empresa_id, numero: telefone, texto: textoDoCodigo(codigo, empresa.nome), finalidadeEnvio: 'ia_talk_login' }),
        signal: AbortSignal.timeout(30_000),
      });
      return r.ok ? { ok: true } : { ok: false, motivo: `http_${r.status}` };
    } catch (_) {
      return { ok: false, motivo: 'falha_rede' };
    }
  };
}

function criarTransporteSmtp(config, senha) {
  return config.tipo === 'gmail'
    ? nodemailer.createTransport({ service: 'gmail', auth: { user: config.email, pass: senha } })
    : nodemailer.createTransport({ host: config.smtp_host, port: Number(config.smtp_porta) || 465, secure: !!config.smtp_seguro,
      auth: { user: config.email, pass: senha }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
}

function criarTransporteEmail({ db, criarTransporte = criarTransporteSmtp } = {}) {
  return async ({ empresa, email, codigo }) => {
    if (!email) return { ok: false, motivo: 'usuario_sem_email' };
    const cfg = db.prepare('SELECT * FROM email_envio WHERE empresa_id = ?').get(empresa.id);
    if (!cfg || !cfg.senha_cifrada) return { ok: false, motivo: 'email_nao_configurado' };
    try {
      const t = criarTransporte(cfg, decifrar(cfg.senha_cifrada));
      await t.sendMail({
        from: `"${(cfg.remetente_nome || empresa.nome).replace(/"/g, '')}" <${cfg.email}>`,
        to: email,
        subject: `${empresa.nome} — seu código de acesso ao IA Talk`,
        text: `Seu código de acesso é ${codigo}. Vale por 5 minutos. Se não foi você, ignore este e-mail.`,
      });
      return { ok: true };
    } catch (_) {
      return { ok: false, motivo: 'falha_email' };
    }
  };
}

// Devolve { enviado_por: 'whatsapp'|'email'|'nenhum', motivos: [...] } — motivos só para log/auditoria.
async function enviarCodigo({ whatsapp, email }, dados) {
  const motivos = [];
  if (whatsapp) {
    const r = await whatsapp(dados);
    if (r.ok) return { enviado_por: 'whatsapp', motivos };
    motivos.push(`whatsapp:${r.motivo}`);
  }
  if (email) {
    const r = await email(dados);
    if (r.ok) return { enviado_por: 'email', motivos };
    motivos.push(`email:${r.motivo}`);
  }
  return { enviado_por: 'nenhum', motivos };
}

module.exports = { enviarCodigo, criarTransporteIaCommand, criarTransporteEmail, criarTransporteSmtp, textoDoCodigo };
