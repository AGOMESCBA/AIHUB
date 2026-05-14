const { ImapFlow } = require('imapflow');
const crud         = require('../crud');
const nodemailer   = require('nodemailer');
const pdfParse     = require('pdf-parse/lib/pdf-parse.js');
const fs           = require('fs');
const ia           = require('../ia');

// Tenta carregar TNEF (winmail.dat do Outlook) — opcional
let tnef = null;
try { tnef = require('node-tnef'); } catch {}

const REGEX_COM_ID  = /^\[(\d+)\]\s*-\s*\[([^\]]+)\]\s*-\s*\[([^\]]+)\]?/i;
const REGEX_SEM_ID  = /^\[([^\]]+)\]\s*-\s*\[([^\]]+)\]?/i;



// ── Config IMAP ───────────────────────────────────────────────────────────────
function getImapOpts(cfg, senha) {
  const auth = { user: cfg.email, pass: senha };
  const host = cfg.imap_host ||
    (cfg.tipo === 'gmail' ? 'imap.gmail.com' : (cfg.smtp_host || '').replace(/^smtp\./i, 'imap.'));
  return {
    host,
    port:              Number(cfg.imap_port) || 993,
    secure:            cfg.imap_secure !== false,
    auth,
    tls:               { rejectUnauthorized: false },
    socketTimeout:     30000,
    connectionTimeout: 15000,
  };
}

function getSmtpTransporter(cfg, senha) {
  const opts = cfg.tipo === 'gmail'
    ? { service: 'gmail', auth: { user: cfg.email, pass: senha }, family: Number(cfg.family) || 4, tls: { rejectUnauthorized: false } }
    : { host: cfg.smtp_host, port: Number(cfg.smtp_port) || 587, secure: !!cfg.smtp_secure, auth: { user: cfg.email, pass: senha }, family: Number(cfg.family) || 4, tls: { rejectUnauthorized: false } };
  return nodemailer.createTransport(opts);
}

// ── Helpers de estrutura MIME ─────────────────────────────────────────────────

// Decodifica filenames RFC 2047 (=?UTF-8?Q?...?= ou =?UTF-8?B?...?=)
function decodeFilename(raw) {
  if (!raw) return '';
  try {
    return raw.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, charset, enc, text) => {
      if (enc.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString(charset);
      return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m2, h) => String.fromCharCode(parseInt(h, 16)));
    });
  } catch { return raw; }
}

function findParts(node, _path) {
  if (!node) return [];

  const typeRaw = (node.type || '').toLowerCase();

  // Aceita "multipart" OU "multipart/mixed" / "multipart/alternative" etc.
  // (ImapFlow ora retorna o tipo composto, ora separado dependendo da versão/cliente)
  if (typeRaw === 'multipart' || typeRaw.startsWith('multipart/')) {
    const children = node.childNodes || node.parts || node.children || [];
    return children.flatMap((child, i) => findParts(child, `${_path ? _path + '.' : ''}${i + 1}`));
  }

  // Monta content-type: aceita "application/pdf" (composto) ou "application" + subtype "pdf" (separado)
  const ct = typeRaw.includes('/')
    ? typeRaw
    : `${typeRaw}/${(node.subtype || '').toLowerCase()}`;

  const fname = decodeFilename(
    node.dispositionParameters?.filename ||
    node.parameters?.name ||
    node.disposition?.parameters?.filename || ''
  );
  const path = node.part || _path || '1';

  if (ct === 'application/pdf' || (ct === 'application/octet-stream' && fname.endsWith('.pdf')) || fname.endsWith('.pdf'))
    return [{ path, filename: fname || 'curriculo.pdf', type: 'pdf' }];
  if (ct === 'application/ms-tnef' || ct.startsWith('application/ms-tnef') || fname === 'winmail.dat')
    return [{ path, filename: 'winmail.dat', type: 'tnef' }];
  return [];
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

function extractPdfFromTnef(buf) {
  if (!tnef) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      tnef.parseBuffer(buf, (err, content) => {
        if (err || !content) return resolve(null);
        const atts = content.Attachments || [];
        for (const att of atts) {
          const title = att.Title || att.FileName || '';
          if (title.toLowerCase().endsWith('.pdf') && att.Data?.length) {
            return resolve({ buffer: Buffer.from(att.Data), filename: title });
          }
        }
        resolve(null);
      });
    } catch { resolve(null); }
  });
}

// ── Normalização do assunto (remove prefixos de resposta/encaminhamento) ──────
// Exemplos removidos: "Re:", "RE:", "Res:", "RES:", "Enc:", "ENC:", "Fwd:", "FWD:"
// Suporta múltiplos níveis: "Re: Enc: Re: [1] - ..." → "[1] - ..."
const REGEX_PREFIXO_EMAIL = /^(re|res|fw|fwd|enc|encaminhado|encam|tr|aw)\s*:\s*/i;

function normalizarAssunto(subject) {
  let s = (subject || '').trim();
  let anterior;
  do {
    anterior = s;
    s = s.replace(REGEX_PREFIXO_EMAIL, '').trim();
  } while (s !== anterior);
  return s;
}

// ── Resolução da vaga ─────────────────────────────────────────────────────────
function resolverVaga(subject, analisadorDb, empresaId) {
  const assunto = normalizarAssunto(subject);
  const mId = assunto.match(REGEX_COM_ID);
  if (mId) {
    const vagaId = Number(mId[1]);
    const vaga   = analisadorDb.getVaga(empresaId, vagaId);
    if (vaga?.status === 'aberta') return { vaga, nomeCandidato: mId[3].trim(), descricaoAssunto: mId[2].trim() };
    const desc = mId[2].trim().toLowerCase();
    const nome = mId[3].trim();
    const porNome = analisadorDb.listVagas(empresaId).find(v => v.status === 'aberta' && (v.funcao?.nome || '').toLowerCase().includes(desc));
    return porNome ? { vaga: porNome, nomeCandidato: nome, descricaoAssunto: mId[2].trim() } : null;
  }
  const mSemId = assunto.match(REGEX_SEM_ID);
  if (mSemId) {
    const desc = mSemId[1].trim().toLowerCase();
    const nome = mSemId[2].trim();
    const vaga = analisadorDb.listVagas(empresaId).find(v => v.status === 'aberta' && (v.funcao?.nome || '').toLowerCase().includes(desc));
    return vaga ? { vaga, nomeCandidato: nome, descricaoAssunto: mSemId[1].trim() } : null;
  }
  return null;
}

// ── Emails de resposta ao candidato ──────────────────────────────────────────
function renderTpl(tpl, vars) {
  return tpl
    .replace(/\{\{NOME\}\}/g,        vars.nome        || '')
    .replace(/\{\{VAGA\}\}/g,        vars.vaga        || '')
    .replace(/\{\{MOTIVO\}\}/g,      vars.motivo      || '')
    .replace(/\{\{NOMEEMPRESA\}\}/g, vars.nomeEmpresa || '');
}

const TPL_CONF_ASSUNTO_PADRAO = '{{NOMEEMPRESA}} - Currículo processado com sucesso — {{VAGA}}';
const TPL_CONF_HTML_PADRAO    = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)"><tr><td style="background:linear-gradient(135deg,#059669,#10b981);padding:32px 40px;text-align:center"><div style="font-size:32px;margin-bottom:8px">✅</div><div style="color:#fff;font-size:22px;font-weight:700">Currículo Processado com Sucesso!</div><div style="color:rgba(255,255,255,.8);font-size:14px;margin-top:6px">Seu currículo foi analisado e cadastrado em nossa base</div></td></tr><tr><td style="padding:36px 40px"><p style="font-size:16px;color:#1f2937;margin:0 0 16px">Olá, <strong>{{NOME}}</strong>!</p><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">Recebemos seu currículo para a vaga de <strong style="color:#059669">{{VAGA}}</strong>. Ele foi <strong>processado pela nossa inteligência artificial</strong> e está <strong>gravado em nossa base de candidatos</strong>. 🎉</p><table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px"><tr><td style="padding:16px 20px"><div style="font-size:13px;color:#166534;font-weight:600;margin-bottom:10px">📋 Status do seu currículo:</div><table width="100%" cellpadding="3" cellspacing="0"><tr><td style="font-size:13px;color:#166534;width:20px">✔</td><td style="font-size:13px;color:#374151">PDF recebido e lido com sucesso</td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Dados extraídos via inteligência artificial</td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Candidatura registrada para a vaga de <strong>{{VAGA}}</strong></td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Currículo gravado na base de candidatos</td></tr></table></td></tr></table><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">Nossa equipe irá analisar seu perfil e entrar em contato. Fique atento ao seu e-mail e telefone.</p><div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:6px;padding:14px 18px;font-size:13px;color:#1e40af">💡 Em caso de dúvidas, responda este e-mail e nossa equipe irá te atender.</div></td></tr><tr><td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb"><p style="font-size:12px;color:#9ca3af;margin:0">Enviado automaticamente pelo <strong>IAHub</strong></p></td></tr></table></td></tr></table></body></html>`;

const TPL_REJ_ASSUNTO_PADRAO = '{{NOMEEMPRESA}} - Seu currículo não pôde ser processado — {{VAGA}}';
const TPL_REJ_HTML_PADRAO    = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)"><tr><td style="background:linear-gradient(135deg,#dc2626,#f87171);padding:32px 36px;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">⚠️ Currículo não processado</h1></td></tr><tr><td style="padding:36px 36px 24px"><p style="font-size:16px;color:#374151;margin:0 0 16px">Olá, <strong>{{NOME}}</strong>!</p><p style="font-size:15px;color:#6b7280;line-height:1.75;margin:0 0 16px">Não foi possível processar seu currículo para a vaga de <strong style="color:#dc2626">{{VAGA}}</strong>.</p><p style="font-size:14px;color:#991b1b;background:#fef2f2;border-radius:8px;padding:14px 18px;margin:0 0 20px"><strong>Motivo:</strong> {{MOTIVO}}</p><p style="font-size:13px;color:#9ca3af">Por favor reenvie o currículo em formato <strong>PDF</strong>.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center"><p style="font-size:12px;color:#9ca3af;margin:0">Enviado automaticamente pelo <strong>IAHub</strong></p></td></tr></table></td></tr></table></body></html>`;

// Templates para e-mail avulso (sem assunto formatado / sem vaga vinculada)
const TPL_CONF_LIVRE_ASSUNTO_PADRAO = '{{NOMEEMPRESA}} — Currículo recebido com sucesso';
const TPL_CONF_LIVRE_HTML_PADRAO    = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)"><tr><td style="background:linear-gradient(135deg,#059669,#10b981);padding:32px 40px;text-align:center"><div style="font-size:32px;margin-bottom:8px">✅</div><div style="color:#fff;font-size:22px;font-weight:700">Currículo Recebido com Sucesso!</div><div style="color:rgba(255,255,255,.8);font-size:14px;margin-top:6px">Seu currículo foi analisado e cadastrado em nossa base</div></td></tr><tr><td style="padding:36px 40px"><p style="font-size:16px;color:#1f2937;margin:0 0 16px">Olá, <strong>{{NOME}}</strong>!</p><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">Recebemos seu currículo e ele foi <strong>processado pela nossa inteligência artificial</strong> e está <strong>gravado em nossa base de candidatos</strong>. 🎉</p><table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px"><tr><td style="padding:16px 20px"><div style="font-size:13px;color:#166534;font-weight:600;margin-bottom:10px">📋 Status do seu currículo:</div><table width="100%" cellpadding="3" cellspacing="0"><tr><td style="font-size:13px;color:#166534;width:20px">✔</td><td style="font-size:13px;color:#374151">PDF recebido e lido com sucesso</td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Dados extraídos via inteligência artificial</td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Currículo gravado na base de candidatos</td></tr></table></td></tr></table><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">Nossa equipe irá analisar seu perfil e entrar em contato em breve. Fique atento ao seu e-mail e telefone.</p><div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:6px;padding:14px 18px;font-size:13px;color:#1e40af">💡 Em caso de dúvidas, responda este e-mail e nossa equipe irá te atender.</div></td></tr><tr><td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb"><p style="font-size:12px;color:#9ca3af;margin:0">Enviado automaticamente pelo <strong>IAHub</strong></p></td></tr></table></td></tr></table></body></html>`;

const TPL_REJ_LIVRE_ASSUNTO_PADRAO = '{{NOMEEMPRESA}} — Não foi possível processar seu arquivo';
const TPL_REJ_LIVRE_HTML_PADRAO    = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)"><tr><td style="background:linear-gradient(135deg,#dc2626,#f87171);padding:32px 36px;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">⚠️ Arquivo não processado</h1></td></tr><tr><td style="padding:36px 36px 24px"><p style="font-size:16px;color:#374151;margin:0 0 16px">Olá, <strong>{{NOME}}</strong>!</p><p style="font-size:15px;color:#6b7280;line-height:1.75;margin:0 0 16px">Recebemos seu e-mail, mas não foi possível processar o arquivo em anexo.</p><p style="font-size:14px;color:#991b1b;background:#fef2f2;border-radius:8px;padding:14px 18px;margin:0 0 20px"><strong>Motivo:</strong> {{MOTIVO}}</p><p style="font-size:13px;color:#9ca3af">Por favor reenvie seu currículo em formato <strong>PDF</strong>.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center"><p style="font-size:12px;color:#9ca3af;margin:0">Enviado automaticamente pelo <strong>IAHub</strong></p></td></tr></table></td></tr></table></body></html>`;

async function enviarConfirmacaoLivre(cfg, senha, toEmail, nomeCandidato, db, empresaId) {
  if (!toEmail) return;
  const empresa     = crud.buscarPorId('empresas', empresaId);
  const nomeEmpresa = empresa?.razao_social || 'IAHub';
  const tpls    = db ? db.getEmailTemplates(empresaId) : {};
  const vars    = { nome: nomeCandidato, nomeEmpresa };
  const assunto = renderTpl(tpls.conf_livre_assunto || TPL_CONF_LIVRE_ASSUNTO_PADRAO, vars);
  const html    = renderTpl(tpls.conf_livre_html    || TPL_CONF_LIVRE_HTML_PADRAO,    vars);
  const t = getSmtpTransporter(cfg, senha);
  await t.sendMail({ from: `"${nomeEmpresa} Recrutamento" <${cfg.email}>`, to: toEmail, subject: assunto, html });
}

async function enviarRejeicaoLivre(cfg, senha, toEmail, nomeCandidato, motivo, db, empresaId) {
  if (!toEmail) return;
  const motivoTexto = motivo === 'pdf_ilegivel'
    ? 'O PDF enviado está ilegível, protegido por senha ou não contém texto selecionável.'
    : 'O arquivo enviado não foi reconhecido como um currículo válido.';
  const empresa     = crud.buscarPorId('empresas', empresaId);
  const nomeEmpresa = empresa?.razao_social || 'IAHub';
  const tpls    = db ? db.getEmailTemplates(empresaId) : {};
  const vars    = { nome: nomeCandidato, motivo: motivoTexto, nomeEmpresa };
  const assunto = renderTpl(tpls.rej_livre_assunto || TPL_REJ_LIVRE_ASSUNTO_PADRAO, vars);
  const html    = renderTpl(tpls.rej_livre_html    || TPL_REJ_LIVRE_HTML_PADRAO,    vars);
  const t = getSmtpTransporter(cfg, senha);
  await t.sendMail({ from: `"${nomeEmpresa} Recrutamento" <${cfg.email}>`, to: toEmail, subject: assunto, html });
}

async function enviarConfirmacao(cfg, senha, toEmail, nomeCandidato, nomeVaga, db, empresaId) {
  if (!toEmail) return;
  const empresa    = crud.buscarPorId('empresas', empresaId);
  const nomeEmpresa = empresa?.razao_social || 'IAHub';
  const tpls   = db ? db.getEmailTemplates(empresaId) : {};
  const vars   = { nome: nomeCandidato, vaga: nomeVaga, nomeEmpresa };
  const assunto = renderTpl(tpls.conf_assunto || TPL_CONF_ASSUNTO_PADRAO, vars);
  const html    = renderTpl(tpls.conf_html    || TPL_CONF_HTML_PADRAO,    vars);
  const t = getSmtpTransporter(cfg, senha);
  await t.sendMail({ from: `"${nomeEmpresa} Recrutamento" <${cfg.email}>`, to: toEmail, subject: assunto, html });
}

async function enviarRejeicao(cfg, senha, toEmail, nomeCandidato, nomeVaga, motivo, db, empresaId) {
  if (!toEmail) return;
  const motivoTexto = motivo === 'sem_pdf'
    ? 'Seu e-mail não continha um arquivo PDF em anexo.'
    : motivo === 'pdf_ilegivel'
    ? 'O PDF enviado está ilegível, protegido por senha ou não contém texto selecionável.'
    : 'O arquivo enviado não foi reconhecido como um currículo válido.';
  const empresa    = crud.buscarPorId('empresas', empresaId);
  const nomeEmpresa = empresa?.razao_social || 'IAHub';
  const tpls   = db ? db.getEmailTemplates(empresaId) : {};
  const vars   = { nome: nomeCandidato, vaga: nomeVaga, motivo: motivoTexto, nomeEmpresa };
  const assunto = renderTpl(tpls.rej_assunto || TPL_REJ_ASSUNTO_PADRAO, vars);
  const html    = renderTpl(tpls.rej_html    || TPL_REJ_HTML_PADRAO,    vars);
  const t = getSmtpTransporter(cfg, senha);
  await t.sendMail({ from: `"${nomeEmpresa} Recrutamento" <${cfg.email}>`, to: toEmail, subject: assunto, html });
}

// ── Processamento de e-mail avulso (PDF sem assunto formatado) ────────────────
const MAX_BUFFER = 300;

class EmailImapService {
  constructor() {
    this._timer       = null;
    this._rodando     = false;
    this._status      = 'stopped';
    this._io          = null;
    this._intervaloMs = 120_000;
    this._logFile     = null;
    this._empresaId   = null;
    this._logBuffer   = [];
    this._deps        = null;
  }

  _ts() { return new Date().toLocaleTimeString('pt-BR'); }

  _emitLog(message, type = 'info') {
    const entry = { message, type, timestamp: this._ts() };
    this._logBuffer.push(entry);
    if (this._logBuffer.length > MAX_BUFFER) this._logBuffer.shift();
    if (this._io && this._empresaId) this._io.to(`emp_${this._empresaId}`).emit('email-log', entry);
    if (this._logFile) {
      const linha = `[${entry.timestamp}] [${(type || 'info').toUpperCase().padEnd(8)}] ${message}
`;
      try { fs.appendFileSync(this._logFile, linha, 'utf8'); } catch (_) {}
    }
  }

  _emitStatus(s) {
    this._status = s;
    if (this._io && this._empresaId) this._io.to(`emp_${this._empresaId}`).emit('email-status', s);
  }


  async _processarEmailLivre(msg, client) {
  const { db, whatsappDb } = this._deps;
  const empresaId = this._empresaId;
    const subject   = msg.envelope?.subject || '';
  const fromEmail = msg.envelope?.from?.[0]?.address || '';
  const fromName  = msg.envelope?.from?.[0]?.name    || fromEmail;
  const uid       = msg.uid;

  const marcarLido = () =>
    client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});

  const cfg   = db.getEmailConfig(empresaId);
  const senha = db.getSenhaReal(empresaId);

  // Sem PDF e sem assunto formatado: ignora silenciosamente (e-mail comum)
  const parts = findParts(msg.bodyStructure);
  if (!parts.length) {
    this._emitLog(`[IMAP] E-mail sem PDF e sem assunto formatado — ignorado: "${subject}"`, 'info');
    return;
  }

  this._emitLog(`[IMAP] Assunto livre + PDF detectado — processando como currículo avulso | De: ${fromEmail}`, 'info');
  this._emitLog(`[IMAP] ${parts.length} anexo(s) encontrado(s) — baixando PDF…`, 'info');

  let pdfBuffer = null;
  let pdfNome   = 'curriculo.pdf';

  for (const part of parts) {
    try {
      const { content } = await client.download(uid, part.path, { uid: true });
      const buf = await streamToBuffer(content);

      if (part.type === 'pdf') {
        pdfBuffer = buf;
        pdfNome   = part.filename;
        this._emitLog(`[IMAP] PDF baixado — "${pdfNome}" (${Math.round(buf.length / 1024)} KB)`, 'info');
        break;
      }
      if (part.type === 'tnef') {
        this._emitLog(`[IMAP] Processando winmail.dat (Outlook)…`, 'info');
        const extracted = await extractPdfFromTnef(buf);
        if (extracted) {
          pdfBuffer = extracted.buffer;
          pdfNome   = extracted.filename;
          this._emitLog(`[IMAP] PDF extraído do winmail.dat — "${pdfNome}"`, 'info');
          break;
        }
      }
    } catch (e) {
      this._emitLog(`[IMAP] Falha ao baixar anexo "${part.path}": ${e.message}`, 'warning');
    }
  }

  if (!pdfBuffer) {
    this._emitLog(`[IMAP] PDF não extraível no e-mail avulso — ignorado`, 'warning');
    return;
  }

  try {
    this._emitLog(`[IMAP] Extraindo texto do PDF (avulso)…`, 'info');
    const pdfData = await pdfParse(pdfBuffer);
    const texto   = pdfData.text.trim();
    if (!texto) {
      this._emitLog(`[IMAP] PDF ilegível — enviando rejeição para ${fromEmail}`, 'warning');
      await marcarLido();
      enviarRejeicaoLivre(cfg, senha, fromEmail, fromName, 'pdf_ilegivel', db, empresaId)
        .then(() => this._emitLog(`[IMAP] Rejeição (avulso) enviada → ${fromEmail}`, 'info'))
        .catch(e => this._emitLog(`[IMAP] Falha ao enviar rejeição (avulso): ${e.message}`, 'error'));
      return;
    }

    this._emitLog(`[IMAP] Texto extraído — ${texto.length} chars | Verificando se é currículo via IA…`, 'info');
    const ehCurriculo = await ia.verificarSeCurriculo(texto, (m,t) => this._emitLog(m,t), empresaId);
    if (!ehCurriculo) {
      this._emitLog(`[IMAP] PDF não reconhecido como currículo — enviando rejeição para ${fromEmail}`, 'warning');
      await marcarLido();
      enviarRejeicaoLivre(cfg, senha, fromEmail, fromName, 'nao_curriculo', db, empresaId)
        .then(() => this._emitLog(`[IMAP] Rejeição (avulso) enviada → ${fromEmail}`, 'info'))
        .catch(e => this._emitLog(`[IMAP] Falha ao enviar rejeição (avulso): ${e.message}`, 'error'));
      return;
    }

    this._emitLog(`[IMAP] Currículo confirmado — extraindo dados via IA…`, 'info');
    const { texto: textoFinal, traduzido } = await ia.traduzirSeNecessario(texto, (m,t) => this._emitLog(m,t), empresaId);
    if (traduzido) this._emitLog(`[IMAP] Currículo traduzido para português`, 'info');

    const dados = await ia.analisarComRetry(textoFinal, (m,t) => this._emitLog(m,t), empresaId);
    dados.nome  = dados.nome  || fromName  || null;
    dados.email = dados.email || fromEmail || null;

    this._emitLog(`[IMAP] Dados extraídos — Nome: ${dados.nome || '—'} | Tel: ${dados.telefone || '—'} | E-mail: ${dados.email || '—'}`, 'info');

    const existente = whatsappDb.findByPhoneOrEmail(empresaId, dados.telefone, dados.email);
    if (existente) {
      this._emitLog(`[IMAP] Duplicata encontrada — "${existente.nome}" (ID #${existente.id}) será substituído`, 'warning');
      whatsappDb.deleteCurriculo(empresaId, existente.id);
    }

    const curriculo_id = whatsappDb.saveCurriculo(empresaId, {
      remetente:       `email-livre:${fromEmail}`,
      empresa_nome:    this._empresaNome || null,
      nome:            dados.nome,
      telefone:        dados.telefone     || null,
      email:           dados.email        || null,
      endereco:        dados.endereco     || null,
      linkedin:        dados.linkedin     || null,
      descricao:       dados.descricao    || null,
      experiencias:    dados.experiencias || [],
      formacao:        dados.formacao     || [],
      capacitacoes:    dados.capacitacoes || [],
      habilidades:     dados.habilidades  || [],
      dados_completos: JSON.stringify(dados),
      pdf_base64:      pdfBuffer.toString('base64'),
      pdf_nome:        pdfNome,
    });
    this._emitLog(`[IMAP] Currículo avulso salvo — ID #${curriculo_id}`, 'saved');

    await marcarLido();
    this._emitLog(`[IMAP] E-mail avulso de "${dados.nome}" marcado como lido`, 'received');

    enviarConfirmacaoLivre(cfg, senha, dados.email || fromEmail, dados.nome || fromName, db, empresaId)
      .then(() => this._emitLog(`[IMAP] Confirmação (avulso) enviada → ${dados.email || fromEmail}`, 'success'))
      .catch(e => this._emitLog(`[IMAP] Falha ao enviar confirmação (avulso): ${e.message}`, 'error'));

  } catch (err) {
    this._emitLog(`[IMAP] Erro ao processar e-mail avulso de "${fromName}": ${err.message}`, 'error');
  }
  }

// ── Processamento de um email ─────────────────────────────────────────────────
  async _processarEmail(msg, client) {
  const { db, whatsappDb, analisadorDb } = this._deps;
  const empresaId = this._empresaId;
    const subject   = msg.envelope?.subject || '';
  const fromEmail = msg.envelope?.from?.[0]?.address || '';
  const uid       = msg.uid;

  const marcarLido = () =>
    client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});

  const cfg   = db.getEmailConfig(empresaId);
  const senha = db.getSenhaReal(empresaId);

  this._emitLog(`[IMAP] Analisando e-mail — assunto: "${subject}" | De: ${fromEmail}`, 'info');

  const resolved = resolverVaga(subject, analisadorDb, empresaId);
  if (!resolved) {
    // Tenta importar como currículo avulso (PDF sem assunto formatado)
    await this._processarEmailLivre(msg, client);
    return;
  }

  const { vaga, nomeCandidato } = resolved;
  const nomeVaga = vaga.funcao?.nome || `Vaga #${vaga.id}`;

  this._emitLog(`[IMAP] Vaga identificada — "${nomeVaga}" | Candidato: "${nomeCandidato}"`, 'info');

  // Localiza partes PDF ou TNEF
  const parts = findParts(msg.bodyStructure);
  if (!parts.length) {
    this._emitLog(`[IMAP] Estrutura MIME: ${JSON.stringify(msg.bodyStructure).slice(0, 400)}`, 'info');
    this._emitLog(`[IMAP] Sem PDF no e-mail de "${nomeCandidato}" — enviando rejeição`, 'warning');
    enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'sem_pdf', db, empresaId)
      .then(() => this._emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
      .catch(e => this._emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
    return;
  }

  this._emitLog(`[IMAP] ${parts.length} anexo(s) encontrado(s) — baixando PDF…`, 'info');

  let pdfBuffer = null;
  let pdfNome   = 'curriculo.pdf';

  for (const part of parts) {
    try {
      const { content } = await client.download(uid, part.path, { uid: true });
      const buf = await streamToBuffer(content);

      if (part.type === 'pdf') {
        pdfBuffer = buf;
        pdfNome   = part.filename;
        this._emitLog(`[IMAP] PDF baixado — "${pdfNome}" (${Math.round(buf.length / 1024)} KB)`, 'info');
        break;
      }
      if (part.type === 'tnef') {
        this._emitLog(`[IMAP] Processando winmail.dat (Outlook) — ${Math.round(buf.length / 1024)} KB…`, 'info');
        const extracted = await extractPdfFromTnef(buf);
        if (extracted) {
          pdfBuffer = extracted.buffer;
          pdfNome   = extracted.filename;
          this._emitLog(`[IMAP] PDF extraído do winmail.dat — "${pdfNome}" (${Math.round(pdfBuffer.length / 1024)} KB)`, 'info');
          break;
        }
        this._emitLog(`[IMAP] winmail.dat de "${nomeCandidato}" não contém PDF reconhecível — verifique se o PDF foi enviado como anexo e não embutido no corpo do e-mail`, 'warning');
      }
    } catch (e) {
      this._emitLog(`[IMAP] Falha ao baixar anexo "${part.path}": ${e.message}`, 'warning');
    }
  }

  if (!pdfBuffer) {
    this._emitLog(`[IMAP] PDF não encontrado no e-mail de "${nomeCandidato}" — enviando rejeição`, 'warning');
    enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'sem_pdf', db, empresaId)
      .then(() => this._emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
      .catch(e => this._emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
    return;
  }

  try {
    this._emitLog(`[IMAP] Extraindo texto do PDF…`, 'info');
    const pdfData = await pdfParse(pdfBuffer);
    const texto   = pdfData.text.trim();
    if (!texto) {
      this._emitLog(`[IMAP] PDF de "${nomeCandidato}" ilegível ou protegido — enviando rejeição`, 'warning');
      enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'pdf_ilegivel', db, empresaId)
        .then(() => this._emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
        .catch(e => this._emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
      return;
    }

    this._emitLog(`[IMAP] Texto extraído — ${texto.length} caracteres | Verificando se é currículo via IA…`, 'info');
    const ehCurriculo = await ia.verificarSeCurriculo(texto, (m,t) => this._emitLog(m,t), empresaId);
    if (!ehCurriculo) {
      this._emitLog(`[IMAP] Documento de "${nomeCandidato}" não reconhecido como currículo pela IA — enviando rejeição`, 'warning');
      enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'nao_curriculo', db, empresaId)
        .then(() => this._emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
        .catch(e => this._emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
      return;
    }

    this._emitLog(`[IMAP] Currículo confirmado pela IA — verificando idioma…`, 'info');
    const { texto: textoFinal, traduzido } = await ia.traduzirSeNecessario(texto, (m,t) => this._emitLog(m,t), empresaId);
    if (traduzido) this._emitLog(`[IMAP] Currículo traduzido para português`, 'info');

    this._emitLog(`[IMAP] Extraindo dados estruturados via IA…`, 'info');
    const dados = await ia.analisarComRetry(textoFinal, (m,t) => this._emitLog(m,t), empresaId);
    dados.nome  = dados.nome  || nomeCandidato || null;
    dados.email = dados.email || fromEmail     || null;

    this._emitLog(`[IMAP] Dados extraídos — Nome: ${dados.nome || '—'} | Tel: ${dados.telefone || '—'} | E-mail: ${dados.email || '—'}`, 'info');

    this._emitLog(`[IMAP] Verificando duplicatas na base de currículos…`, 'info');
    const existente = whatsappDb.findByPhoneOrEmail(empresaId, dados.telefone, dados.email);
    if (existente) {
      this._emitLog(`[IMAP] Duplicata encontrada — "${existente.nome}" (ID #${existente.id}) será substituído por "${dados.nome}"`, 'warning');
      whatsappDb.deleteCurriculo(empresaId, existente.id);
    }

    this._emitLog(`[IMAP] Salvando currículo na base de dados…`, 'info');
    const curriculo_id = whatsappDb.saveCurriculo(empresaId, {
      remetente:       `email-externo:${fromEmail || nomeCandidato}`,
      empresa_nome:    this._empresaNome || null,
      nome:            dados.nome,
      telefone:        dados.telefone        || null,
      email:           dados.email           || null,
      endereco:        dados.endereco        || null,
      linkedin:        dados.linkedin        || null,
      descricao:       dados.descricao       || null,
      experiencias:    dados.experiencias    || [],
      formacao:        dados.formacao        || [],
      capacitacoes:    dados.capacitacoes    || [],
      habilidades:     dados.habilidades     || [],
      dados_completos: JSON.stringify(dados),
      pdf_base64:      pdfBuffer.toString('base64'),
      pdf_nome:        pdfNome,
    });
    this._emitLog(`[IMAP] Currículo salvo — ID #${curriculo_id}`, 'saved');

    this._emitLog(`[IMAP] Registrando candidatura para "${nomeVaga}"…`, 'info');
    const candExist = db.findCandidaturaByVagaAndCandidato(empresaId, vaga.id, dados.email, dados.nome);
    if (candExist) {
      db.updateCandidaturaCurriculoId(empresaId, candExist.id, curriculo_id);
      this._emitLog(`[IMAP] Candidatura atualizada — "${dados.nome}" → "${nomeVaga}"`, 'info');
    } else {
      db.saveCandidatura(empresaId, { vaga_id: vaga.id, curriculo_id, canal: 'email', candidato_nome: dados.nome, candidato_email: dados.email });
      this._emitLog(`[IMAP] Nova candidatura registrada — "${dados.nome}" → "${nomeVaga}"`, 'success');
    }

    // Marca como lido SOMENTE após gravar o currículo com sucesso
    this._emitLog(`[IMAP] Marcando e-mail como lido…`, 'info');
    await marcarLido();
    this._emitLog(`[IMAP] E-mail de "${nomeCandidato}" gravado e marcado como lido`, 'received');

    this._emitLog(`[IMAP] Enviando e-mail de confirmação → ${dados.email || fromEmail}…`, 'info');
    enviarConfirmacao(cfg, senha, dados.email || fromEmail, dados.nome || nomeCandidato, nomeVaga, db, empresaId)
      .then(() => this._emitLog(`[IMAP] Confirmação enviada com sucesso → ${dados.email || fromEmail}`, 'success'))
      .catch(e => this._emitLog(`[IMAP] Falha ao enviar confirmação: ${e.message}`, 'error'));

  } catch (err) {
    this._emitLog(`[IMAP] Erro ao processar currículo de "${nomeCandidato}": ${err.message}`, 'error');
  }
  }

// ── Poll principal ────────────────────────────────────────────────────────────
  async _poll() {
  if (this._rodando) return;
  this._rodando = true;
  const { db, analisadorDb, whatsappDb } = this._deps;
  const empresaId = this._empresaId;
  const cfg   = db.getEmailConfig(empresaId);
  const senha = db.getSenhaReal(empresaId);

  if (!cfg.email || !senha) {
    this._emitLog('[IMAP] E-mail ou senha não configurados — verifique as configurações', 'warning');
    this._rodando = false;
    return;
  }

  const servidor = cfg.tipo === 'gmail' ? `Gmail (${cfg.email})` : `${cfg.imap_host}:${cfg.imap_port}`;
  this._emitLog(`[IMAP] Conectando ao servidor — ${servidor}…`, 'info');

  const client = new ImapFlow({ ...getImapOpts(cfg, senha), logger: false });
  client.on('error', err => this._emitLog(`[IMAP] Erro de socket: ${err.message}`, 'error'));

  try {
    await client.connect();
    this._emitLog(`[IMAP] Conectado — verificando caixa de entrada…`, 'info');

    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids.length) {
        this._emitLog(`[IMAP] Nenhum e-mail novo na caixa de entrada`, 'info');
      } else {
        this._emitLog(`[IMAP] ${uids.length} e-mail(s) não lido(s) encontrado(s) — coletando metadados…`, 'received');

        // Fase 1: coleta TODOS os metadados sem nenhuma operação no servidor dentro do loop.
        // Fazer client.download ou client.messageFlagsAdd dentro do for await quebra a iteração.
        const mensagens = [];
        for await (const msg of client.fetch(uids, { envelope: true, bodyStructure: true }, { uid: true })) {
          mensagens.push({ uid: msg.uid, envelope: msg.envelope, bodyStructure: msg.bodyStructure });
        }

        // Fase 2: processa cada mensagem fora do loop de fetch
        this._emitLog(`[IMAP] Iniciando processamento de ${mensagens.length} e-mail(s)…`, 'info');
        let idx = 0;
        for (const msg of mensagens) {
          idx++;
          this._emitLog(`[IMAP] Processando e-mail ${idx} de ${mensagens.length}…`, 'info');
          await this._processarEmail(msg, client);
        }
        this._emitLog(`[IMAP] Processamento concluído — ${mensagens.length} e-mail(s) tratado(s)`, 'success');
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    this._emitLog(`[IMAP] Erro ao verificar caixa: ${err.message}`, 'error');
  } finally {
    await client.logout().catch(() => {});
    this._emitLog(`[IMAP] Desconectado — próxima verificação em ${Math.round(this._intervaloMs / 60000)} min`, 'info');
    this._rodando = false;
  }
  }

// ── API de teste de conexão IMAP ──────────────────────────────────────────────
  async testarConexao(cfg, senha) {
  const client = new ImapFlow({ ...getImapOpts(cfg, senha), logger: false });
  client.on('error', () => {});
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const uids = await client.search({ seen: false }, { uid: true });
  const count = uids.length;
  lock.release();
  await client.logout();
  return { ok: true, naoLidos: count };
  }

  iniciarServico(deps, io, intervaloMs = 120_000, empresaId, empresaNome = null) {
    if (!empresaId) throw new Error('empresa_id é obrigatório para iniciar o serviço de e-mail');
    this._deps        = { ...deps, empresaId };
    this._io          = io;
    this._empresaId   = Number(empresaId);
    this._empresaNome = empresaNome || null;
    this._intervaloMs = intervaloMs;
    if (this._timer) {
      this._emitLog('[Email] Serviço já está em execução', 'warning');
      return;
    }
    this._emitStatus('running');
    this._emitLog(`[Email] Serviço de monitoramento de e-mail iniciado — verificação a cada ${Math.round(intervaloMs / 60000)} min`, 'success');

    const executar = () => this._poll().catch(err => {
      this._emitLog(`[Email] Erro inesperado no ciclo de verificação: ${err.message}`, 'error');
      this._rodando = false;
    });
    executar();
    this._timer = setInterval(executar, intervaloMs);
  }

  pararServico() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._rodando = false;
    this._emitStatus('stopped');
    this._emitLog('[Email] Serviço de monitoramento de e-mail parado', 'warning');
    // Não zera _empresaId imediatamente: promises de envio de e-mail ainda em voo
    // usam this._empresaId nos callbacks de log. Defer para o próximo tick.
    const eid = this._empresaId;
    setImmediate(() => {
      if (this._empresaId === eid) { this._empresaId = null; this._deps = null; }
    });
  }

  getStatus()    { return this._status; }
  getEmpresaId() { return this._empresaId; }
  getLogBuffer() { return [...this._logBuffer]; }
  clearBuffer()  { this._logBuffer.length = 0; }
  setLogFile(fp) { this._logFile = fp; }
}

module.exports = EmailImapService;
