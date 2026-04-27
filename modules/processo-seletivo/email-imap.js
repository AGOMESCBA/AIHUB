const { ImapFlow } = require('imapflow');
const nodemailer   = require('nodemailer');
const pdfParse     = require('pdf-parse/lib/pdf-parse.js');
const fs           = require('fs');

// Tenta carregar TNEF (winmail.dat do Outlook) — opcional
let tnef = null;
try { tnef = require('node-tnef'); } catch {}

// Formato com ID:  [1] - [Analista Softexpert] - [Vanusa Cardoso]
// Formato sem ID:  [Analista Softexpert] - [Vanusa Cardoso]
// O ] final é opcional para aceitar assuntos truncados pelo cliente de e-mail
const REGEX_COM_ID  = /^\[(\d+)\]\s*-\s*\[([^\]]+)\]\s*-\s*\[([^\]]+)\]?/i;
const REGEX_SEM_ID  = /^\[([^\]]+)\]\s*-\s*\[([^\]]+)\]?/i;

let _timer       = null;
let _rodando     = false;
let _status      = 'stopped';
let _io          = null;
let _intervaloMs = 120_000;
let _logFile     = null;

const _logBuffer  = [];
const MAX_BUFFER  = 300;

// ── Helpers de log/status via socket ─────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString('pt-BR');
}

function emitLog(message, type = 'info') {
  const entry = { message, type, timestamp: ts() };
  _logBuffer.push(entry);
  if (_logBuffer.length > MAX_BUFFER) _logBuffer.shift();
  if (_io) _io.emit('email-log', entry);
  if (_logFile) {
    const linha = `[${entry.timestamp}] [${(type || 'info').toUpperCase().padEnd(8)}] ${message}\n`;
    try { fs.appendFileSync(_logFile, linha, 'utf8'); } catch (_) {}
  }
}

function emitStatus(s) {
  _status = s;
  if (_io) _io.emit('email-status', s);
}

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
function resolverVaga(subject, analisadorDb) {
  const assunto = normalizarAssunto(subject);
  const mId = assunto.match(REGEX_COM_ID);
  if (mId) {
    const vagaId = Number(mId[1]);
    const vaga   = analisadorDb.getVaga(vagaId);
    if (vaga?.status === 'aberta') return { vaga, nomeCandidato: mId[3].trim(), descricaoAssunto: mId[2].trim() };
    const desc = mId[2].trim().toLowerCase();
    const nome = mId[3].trim();
    const porNome = analisadorDb.listVagas().find(v => v.status === 'aberta' && (v.funcao?.nome || '').toLowerCase().includes(desc));
    return porNome ? { vaga: porNome, nomeCandidato: nome, descricaoAssunto: mId[2].trim() } : null;
  }
  const mSemId = assunto.match(REGEX_SEM_ID);
  if (mSemId) {
    const desc = mSemId[1].trim().toLowerCase();
    const nome = mSemId[2].trim();
    const vaga = analisadorDb.listVagas().find(v => v.status === 'aberta' && (v.funcao?.nome || '').toLowerCase().includes(desc));
    return vaga ? { vaga, nomeCandidato: nome, descricaoAssunto: mSemId[1].trim() } : null;
  }
  return null;
}

// ── Emails de resposta ao candidato ──────────────────────────────────────────
function renderTpl(tpl, vars) {
  return tpl
    .replace(/\{\{NOME\}\}/g,   vars.nome   || '')
    .replace(/\{\{VAGA\}\}/g,   vars.vaga   || '')
    .replace(/\{\{MOTIVO\}\}/g, vars.motivo || '');
}

const TPL_CONF_ASSUNTO_PADRAO = 'Currículo processado com sucesso — {{VAGA}}';
const TPL_CONF_HTML_PADRAO    = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)"><tr><td style="background:linear-gradient(135deg,#059669,#10b981);padding:32px 40px;text-align:center"><div style="font-size:32px;margin-bottom:8px">✅</div><div style="color:#fff;font-size:22px;font-weight:700">Currículo Processado com Sucesso!</div><div style="color:rgba(255,255,255,.8);font-size:14px;margin-top:6px">Seu currículo foi analisado e cadastrado em nossa base</div></td></tr><tr><td style="padding:36px 40px"><p style="font-size:16px;color:#1f2937;margin:0 0 16px">Olá, <strong>{{NOME}}</strong>!</p><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">Recebemos seu currículo para a vaga de <strong style="color:#059669">{{VAGA}}</strong>. Ele foi <strong>processado pela nossa inteligência artificial</strong> e está <strong>gravado em nossa base de candidatos</strong>. 🎉</p><table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px"><tr><td style="padding:16px 20px"><div style="font-size:13px;color:#166534;font-weight:600;margin-bottom:10px">📋 Status do seu currículo:</div><table width="100%" cellpadding="3" cellspacing="0"><tr><td style="font-size:13px;color:#166534;width:20px">✔</td><td style="font-size:13px;color:#374151">PDF recebido e lido com sucesso</td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Dados extraídos via inteligência artificial</td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Candidatura registrada para a vaga de <strong>{{VAGA}}</strong></td></tr><tr><td style="font-size:13px;color:#166534">✔</td><td style="font-size:13px;color:#374151">Currículo gravado na base de candidatos</td></tr></table></td></tr></table><p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">Nossa equipe irá analisar seu perfil e entrar em contato. Fique atento ao seu e-mail e telefone.</p><div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:6px;padding:14px 18px;font-size:13px;color:#1e40af">💡 Em caso de dúvidas, responda este e-mail e nossa equipe irá te atender.</div></td></tr><tr><td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb"><p style="font-size:12px;color:#9ca3af;margin:0">Enviado automaticamente pelo <strong>IAHub</strong></p></td></tr></table></td></tr></table></body></html>`;

const TPL_REJ_ASSUNTO_PADRAO = 'Seu currículo não pôde ser processado — {{VAGA}}';
const TPL_REJ_HTML_PADRAO    = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)"><tr><td style="background:linear-gradient(135deg,#dc2626,#f87171);padding:32px 36px;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">⚠️ Currículo não processado</h1></td></tr><tr><td style="padding:36px 36px 24px"><p style="font-size:16px;color:#374151;margin:0 0 16px">Olá, <strong>{{NOME}}</strong>!</p><p style="font-size:15px;color:#6b7280;line-height:1.75;margin:0 0 16px">Não foi possível processar seu currículo para a vaga de <strong style="color:#dc2626">{{VAGA}}</strong>.</p><p style="font-size:14px;color:#991b1b;background:#fef2f2;border-radius:8px;padding:14px 18px;margin:0 0 20px"><strong>Motivo:</strong> {{MOTIVO}}</p><p style="font-size:13px;color:#9ca3af">Por favor reenvie o currículo em formato <strong>PDF</strong>.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center"><p style="font-size:12px;color:#9ca3af;margin:0">Enviado automaticamente pelo <strong>IAHub</strong></p></td></tr></table></td></tr></table></body></html>`;

async function enviarConfirmacao(cfg, senha, toEmail, nomeCandidato, nomeVaga, db) {
  if (!toEmail) return;
  const tpls   = db ? db.getEmailTemplates() : {};
  const assunto = renderTpl(tpls.conf_assunto || TPL_CONF_ASSUNTO_PADRAO, { nome: nomeCandidato, vaga: nomeVaga });
  const html    = renderTpl(tpls.conf_html    || TPL_CONF_HTML_PADRAO,    { nome: nomeCandidato, vaga: nomeVaga });
  const t = getSmtpTransporter(cfg, senha);
  await t.sendMail({ from: `"Recrutamento IAHub" <${cfg.email}>`, to: toEmail, subject: assunto, html });
}

async function enviarRejeicao(cfg, senha, toEmail, nomeCandidato, nomeVaga, motivo, db) {
  if (!toEmail) return;
  const motivoTexto = motivo === 'sem_pdf'
    ? 'Seu e-mail não continha um arquivo PDF em anexo.'
    : motivo === 'pdf_ilegivel'
    ? 'O PDF enviado está ilegível, protegido por senha ou não contém texto selecionável.'
    : 'O arquivo enviado não foi reconhecido como um currículo válido.';
  const tpls   = db ? db.getEmailTemplates() : {};
  const assunto = renderTpl(tpls.rej_assunto || TPL_REJ_ASSUNTO_PADRAO, { nome: nomeCandidato, vaga: nomeVaga, motivo: motivoTexto });
  const html    = renderTpl(tpls.rej_html    || TPL_REJ_HTML_PADRAO,    { nome: nomeCandidato, vaga: nomeVaga, motivo: motivoTexto });
  const t = getSmtpTransporter(cfg, senha);
  await t.sendMail({ from: `"Recrutamento IAHub" <${cfg.email}>`, to: toEmail, subject: assunto, html });
}

// ── Processamento de um email ─────────────────────────────────────────────────
async function processarEmail(msg, client, deps) {
  const { db, whatsappDb, whatsapp, analisadorDb } = deps;
  const subject   = msg.envelope?.subject || '';
  const fromEmail = msg.envelope?.from?.[0]?.address || '';
  const uid       = msg.uid;

  const marcarLido = () =>
    client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});

  const cfg   = db.getEmailConfig();
  const senha = db.getSenhaReal();

  emitLog(`[IMAP] Analisando e-mail — assunto: "${subject}" | De: ${fromEmail}`, 'info');

  const resolved = resolverVaga(subject, analisadorDb);
  if (!resolved) {
    emitLog(`[IMAP] E-mail ignorado — assunto fora do padrão esperado: "${subject}"`, 'warning');
    return;
  }

  const { vaga, nomeCandidato } = resolved;
  const nomeVaga = vaga.funcao?.nome || `Vaga #${vaga.id}`;

  emitLog(`[IMAP] Vaga identificada — "${nomeVaga}" | Candidato: "${nomeCandidato}"`, 'info');

  // Localiza partes PDF ou TNEF
  const parts = findParts(msg.bodyStructure);
  if (!parts.length) {
    emitLog(`[IMAP] Estrutura MIME: ${JSON.stringify(msg.bodyStructure).slice(0, 400)}`, 'info');
    emitLog(`[IMAP] Sem PDF no e-mail de "${nomeCandidato}" — enviando rejeição`, 'warning');
    enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'sem_pdf', db)
      .then(() => emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
      .catch(e => emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
    return;
  }

  emitLog(`[IMAP] ${parts.length} anexo(s) encontrado(s) — baixando PDF…`, 'info');

  let pdfBuffer = null;
  let pdfNome   = 'curriculo.pdf';

  for (const part of parts) {
    try {
      const { content } = await client.download(uid, part.path, { uid: true });
      const buf = await streamToBuffer(content);

      if (part.type === 'pdf') {
        pdfBuffer = buf;
        pdfNome   = part.filename;
        emitLog(`[IMAP] PDF baixado — "${pdfNome}" (${Math.round(buf.length / 1024)} KB)`, 'info');
        break;
      }
      if (part.type === 'tnef') {
        emitLog(`[IMAP] Processando winmail.dat (Outlook) — ${Math.round(buf.length / 1024)} KB…`, 'info');
        const extracted = await extractPdfFromTnef(buf);
        if (extracted) {
          pdfBuffer = extracted.buffer;
          pdfNome   = extracted.filename;
          emitLog(`[IMAP] PDF extraído do winmail.dat — "${pdfNome}" (${Math.round(pdfBuffer.length / 1024)} KB)`, 'info');
          break;
        }
        emitLog(`[IMAP] winmail.dat de "${nomeCandidato}" não contém PDF reconhecível — verifique se o PDF foi enviado como anexo e não embutido no corpo do e-mail`, 'warning');
      }
    } catch (e) {
      emitLog(`[IMAP] Falha ao baixar anexo "${part.path}": ${e.message}`, 'warning');
    }
  }

  if (!pdfBuffer) {
    emitLog(`[IMAP] PDF não encontrado no e-mail de "${nomeCandidato}" — enviando rejeição`, 'warning');
    enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'sem_pdf', db)
      .then(() => emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
      .catch(e => emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
    return;
  }

  try {
    emitLog(`[IMAP] Extraindo texto do PDF…`, 'info');
    const pdfData = await pdfParse(pdfBuffer);
    const texto   = pdfData.text.trim();
    if (!texto) {
      emitLog(`[IMAP] PDF de "${nomeCandidato}" ilegível ou protegido — enviando rejeição`, 'warning');
      enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'pdf_ilegivel', db)
        .then(() => emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
        .catch(e => emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
      return;
    }

    emitLog(`[IMAP] Texto extraído — ${texto.length} caracteres | Verificando se é currículo via IA…`, 'info');
    const ehCurriculo = await whatsapp.verificarSeCurriculo(texto);
    if (!ehCurriculo) {
      emitLog(`[IMAP] Documento de "${nomeCandidato}" não reconhecido como currículo pela IA — enviando rejeição`, 'warning');
      enviarRejeicao(cfg, senha, fromEmail, nomeCandidato, nomeVaga, 'nao_curriculo', db)
        .then(() => emitLog(`[IMAP] E-mail de rejeição enviado → ${fromEmail}`, 'info'))
        .catch(e => emitLog(`[IMAP] Falha ao enviar rejeição: ${e.message}`, 'error'));
      return;
    }

    emitLog(`[IMAP] Currículo confirmado pela IA — verificando idioma…`, 'info');
    const { texto: textoFinal, traduzido } = await whatsapp.traduzirSeNecessario(texto);
    if (traduzido) emitLog(`[IMAP] Currículo traduzido para português`, 'info');

    emitLog(`[IMAP] Extraindo dados estruturados via IA…`, 'info');
    const dados = await whatsapp.analisarComRetry(textoFinal);
    dados.nome  = dados.nome  || nomeCandidato || null;
    dados.email = dados.email || fromEmail     || null;

    emitLog(`[IMAP] Dados extraídos — Nome: ${dados.nome || '—'} | Tel: ${dados.telefone || '—'} | E-mail: ${dados.email || '—'}`, 'info');

    emitLog(`[IMAP] Verificando duplicatas na base de currículos…`, 'info');
    const existente = whatsappDb.findByPhoneOrEmail(dados.telefone, dados.email);
    if (existente) {
      emitLog(`[IMAP] Duplicata encontrada — "${existente.nome}" (ID #${existente.id}) será substituído por "${dados.nome}"`, 'warning');
      whatsappDb.deleteCurriculo(existente.id);
    }

    emitLog(`[IMAP] Salvando currículo na base de dados…`, 'info');
    const curriculo_id = whatsappDb.saveCurriculo({
      remetente:       `email-externo:${fromEmail || nomeCandidato}`,
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
    emitLog(`[IMAP] Currículo salvo — ID #${curriculo_id}`, 'saved');

    emitLog(`[IMAP] Registrando candidatura para "${nomeVaga}"…`, 'info');
    const candExist = db.findCandidaturaByVagaAndCandidato(vaga.id, dados.email, dados.nome);
    if (candExist) {
      db.updateCandidaturaCurriculoId(candExist.id, curriculo_id);
      emitLog(`[IMAP] Candidatura atualizada — "${dados.nome}" → "${nomeVaga}"`, 'info');
    } else {
      db.saveCandidatura({ vaga_id: vaga.id, curriculo_id, canal: 'email', candidato_nome: dados.nome, candidato_email: dados.email });
      emitLog(`[IMAP] Nova candidatura registrada — "${dados.nome}" → "${nomeVaga}"`, 'success');
    }

    // Marca como lido SOMENTE após gravar o currículo com sucesso
    emitLog(`[IMAP] Marcando e-mail como lido…`, 'info');
    await marcarLido();
    emitLog(`[IMAP] E-mail de "${nomeCandidato}" gravado e marcado como lido`, 'received');

    emitLog(`[IMAP] Enviando e-mail de confirmação → ${dados.email || fromEmail}…`, 'info');
    enviarConfirmacao(cfg, senha, dados.email || fromEmail, dados.nome || nomeCandidato, nomeVaga, db)
      .then(() => emitLog(`[IMAP] Confirmação enviada com sucesso → ${dados.email || fromEmail}`, 'success'))
      .catch(e => emitLog(`[IMAP] Falha ao enviar confirmação: ${e.message}`, 'error'));

  } catch (err) {
    emitLog(`[IMAP] Erro ao processar currículo de "${nomeCandidato}": ${err.message}`, 'error');
  }
}

// ── Poll principal ────────────────────────────────────────────────────────────
async function poll(deps) {
  if (_rodando) return;
  _rodando = true;
  const { db } = deps;
  const cfg   = db.getEmailConfig();
  const senha = db.getSenhaReal();

  if (!cfg.email || !senha) {
    emitLog('[IMAP] E-mail ou senha não configurados — verifique as configurações', 'warning');
    _rodando = false;
    return;
  }

  const servidor = cfg.tipo === 'gmail' ? `Gmail (${cfg.email})` : `${cfg.imap_host}:${cfg.imap_port}`;
  emitLog(`[IMAP] Conectando ao servidor — ${servidor}…`, 'info');

  const client = new ImapFlow({ ...getImapOpts(cfg, senha), logger: false });
  client.on('error', err => emitLog(`[IMAP] Erro de socket: ${err.message}`, 'error'));

  try {
    await client.connect();
    emitLog(`[IMAP] Conectado — verificando caixa de entrada…`, 'info');

    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids.length) {
        emitLog(`[IMAP] Nenhum e-mail novo na caixa de entrada`, 'info');
      } else {
        emitLog(`[IMAP] ${uids.length} e-mail(s) não lido(s) encontrado(s) — coletando metadados…`, 'received');

        // Fase 1: coleta TODOS os metadados sem nenhuma operação no servidor dentro do loop.
        // Fazer client.download ou client.messageFlagsAdd dentro do for await quebra a iteração.
        const mensagens = [];
        for await (const msg of client.fetch(uids, { envelope: true, bodyStructure: true }, { uid: true })) {
          mensagens.push({ uid: msg.uid, envelope: msg.envelope, bodyStructure: msg.bodyStructure });
        }

        // Fase 2: processa cada mensagem fora do loop de fetch
        emitLog(`[IMAP] Iniciando processamento de ${mensagens.length} e-mail(s)…`, 'info');
        let idx = 0;
        for (const msg of mensagens) {
          idx++;
          emitLog(`[IMAP] Processando e-mail ${idx} de ${mensagens.length}…`, 'info');
          await processarEmail(msg, client, deps);
        }
        emitLog(`[IMAP] Processamento concluído — ${mensagens.length} e-mail(s) tratado(s)`, 'success');
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    emitLog(`[IMAP] Erro ao verificar caixa: ${err.message}`, 'error');
  } finally {
    await client.logout().catch(() => {});
    emitLog(`[IMAP] Desconectado — próxima verificação em ${Math.round(_intervaloMs / 60000)} min`, 'info');
    _rodando = false;
  }
}

// ── API de teste de conexão IMAP ──────────────────────────────────────────────
async function testarConexao(cfg, senha) {
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

// ── Controle do serviço ───────────────────────────────────────────────────────
module.exports = {
  iniciarServico(deps, io, intervaloMs = 120_000) {
    if (_timer) {
      emitLog('[Email] Serviço já está em execução', 'warning');
      return;
    }
    _io          = io;
    _intervaloMs = intervaloMs;
    emitStatus('running');
    emitLog(`[Email] Serviço de monitoramento de e-mail iniciado — verificação a cada ${Math.round(intervaloMs / 60000)} min`, 'success');

    const executar = () => poll(deps).catch(err => {
      emitLog(`[Email] Erro inesperado no ciclo de verificação: ${err.message}`, 'error');
      _rodando = false;
    });
    executar();
    _timer = setInterval(executar, intervaloMs);
  },

  pararServico() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _rodando = false;
    emitStatus('stopped');
    emitLog('[Email] Serviço de monitoramento de e-mail parado', 'warning');
  },

  getStatus() { return _status; },
  getLogBuffer() { return [..._logBuffer]; },
  setLogFile(filePath) { _logFile = filePath; },
  testarConexao,
};
