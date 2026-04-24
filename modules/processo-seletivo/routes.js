const path       = require('path');
const nodemailer = require('nodemailer');
const pdfParse   = require('pdf-parse/lib/pdf-parse.js');

const db          = require('./database');
const analisadorDb = require('../analisador-curriculos/database');
const whatsappDb   = require('../whatsapp-curriculo/database');
const whatsapp     = require('../whatsapp-curriculo/service');

function criarTransporter(cfg) {
  const senha = cfg.senha || db.getSenhaReal();
  if (cfg.tipo === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: cfg.email, pass: senha },
    });
  }
  return nodemailer.createTransport({
    host:   cfg.smtp_host,
    port:   Number(cfg.smtp_port) || 587,
    secure: !!cfg.smtp_secure,
    auth:   { user: cfg.email, pass: senha },
  });
}

async function enviarEmailNotificacao(cfg, vaga, dados, pdf_base64, pdf_nome) {
  const t = criarTransporter({ ...cfg, senha: db.getSenhaReal() });
  const funcaoNome = vaga.funcao?.nome || `Vaga #${vaga.id}`;

  const exps = (dados.experiencias || []).slice(0, 3)
    .map(e => `<li>${e.cargo || '—'} em ${e.empresa || '—'} (${e.periodo || '—'})</li>`).join('');
  const habs = (dados.habilidades || []).slice(0, 10).join(', ');

  await t.sendMail({
    from:    cfg.email,
    to:      cfg.email,
    subject: `[IAHub] Currículo recebido — ${funcaoNome}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
        <div style="background:#1d4ed8;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">📋 Novo Currículo Recebido</h2>
          <p style="margin:6px 0 0;opacity:.85;font-size:13px">Via Processo Seletivo — IAHub</p>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:120px">Vaga</td><td style="padding:6px 0;font-size:13px;font-weight:600">${funcaoNome}</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">Candidato</td><td style="padding:6px 0;font-size:13px">${dados.nome || '—'}</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">E-mail</td><td style="padding:6px 0;font-size:13px">${dados.email || '—'}</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">Telefone</td><td style="padding:6px 0;font-size:13px">${dados.telefone || '—'}</td></tr>
            ${dados.endereco ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280">Endereço</td><td style="padding:6px 0;font-size:13px">${dados.endereco}</td></tr>` : ''}
          </table>
          ${exps ? `<div style="margin-bottom:12px"><strong style="font-size:13px">Experiências:</strong><ul style="margin:6px 0;padding-left:20px;font-size:13px">${exps}</ul></div>` : ''}
          ${habs ? `<p style="font-size:13px;margin-bottom:0"><strong>Habilidades:</strong> ${habs}</p>` : ''}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
          <p style="font-size:11px;color:#9ca3af;margin:0">Enviado automaticamente pelo IAHub · ${new Date().toLocaleString('pt-BR')}</p>
        </div>
      </div>`,
    attachments: [{
      filename:    pdf_nome || 'curriculo.pdf',
      content:     Buffer.from(pdf_base64, 'base64'),
      contentType: 'application/pdf',
    }],
  });
}

module.exports = function registerRoutes(app, { requireAuth, registrarLog }) {

  function log(message, type = 'info') {
    if (registrarLog) registrarLog({ message, type, timestamp: new Date().toLocaleTimeString('pt-BR') });
  }

  // ── Email Config (autenticado) ────────────────────────────────────────────────
  app.get('/api/ps/email-config', requireAuth, (_req, res) => {
    const cfg = db.getEmailConfig();
    res.json({ ...cfg, senha: cfg.senha ? '••••••••' : '' });
  });

  app.post('/api/ps/email-config', requireAuth, (req, res) => {
    db.setEmailConfig(req.body);
    res.json({ ok: true });
  });

  app.post('/api/ps/email-test', requireAuth, async (req, res) => {
    const cfg = db.getEmailConfig();
    if (!cfg.email) return res.status(400).json({ error: 'Configure o email primeiro.' });
    try {
      const t = criarTransporter({ ...cfg, senha: db.getSenhaReal() });
      await t.sendMail({
        from: cfg.email, to: cfg.email,
        subject: '[IAHub] Teste de configuração de email',
        text: 'Configuração de email funcionando! O IAHub está pronto para enviar notificações de currículos.',
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Token Público (autenticado) ───────────────────────────────────────────────
  app.get('/api/ps/public-token', requireAuth, (_req, res) => {
    res.json({ token: db.getPublicToken() });
  });

  app.post('/api/ps/regenerate-token', requireAuth, (_req, res) => {
    res.json({ token: db.regenerateToken() });
  });

  // ── Candidaturas (autenticado) ────────────────────────────────────────────────
  app.get('/api/ps/candidaturas', requireAuth, (_req, res) => {
    res.json(db.listCandidaturas());
  });

  app.get('/api/ps/candidaturas/vaga/:vagaId', requireAuth, (req, res) => {
    res.json(db.listCandidaturasByVaga(Number(req.params.vagaId)));
  });

  // ── API Pública ───────────────────────────────────────────────────────────────
  function tokenValido(req, res) {
    if (!db.validateToken(req.params.token)) {
      res.status(403).json({ error: 'Link inválido ou expirado.' });
      return false;
    }
    return true;
  }

  app.get('/api/public/ps/:token/info', (req, res) => {
    if (!tokenValido(req, res)) return;
    const numero = (whatsappDb.getConfig('numero_destino') || '').replace(/\D/g, '');
    res.json({ wa_numero: numero || null });
  });

  app.get('/api/public/ps/:token/vagas', (req, res) => {
    if (!tokenValido(req, res)) return;
    const vagas = analisadorDb.listVagas().filter(v => v.status === 'aberta');
    res.json(vagas);
  });

  app.post('/api/public/ps/:token/candidatar', async (req, res) => {
    if (!tokenValido(req, res)) return;

    const { vaga_id, nome, email, pdf_base64, pdf_nome } = req.body;
    if (!vaga_id)      return res.status(400).json({ error: 'Selecione uma vaga.' });
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!pdf_base64)   return res.status(400).json({ error: 'Anexe seu currículo em PDF.' });

    const vaga = analisadorDb.getVaga(Number(vaga_id));
    if (!vaga || vaga.status !== 'aberta')
      return res.status(400).json({ error: 'Esta vaga não está disponível.' });

    try {
      // Extrai texto do PDF
      const buffer   = Buffer.from(pdf_base64, 'base64');
      const pdfData  = await pdfParse(buffer);
      const texto    = pdfData.text.trim();
      if (!texto)
        return res.status(400).json({ error: 'PDF ilegível ou protegido. Envie um PDF com texto selecionável.' });

      // Verifica se é currículo
      const ehCurriculo = await whatsapp.verificarSeCurriculo(texto);
      if (!ehCurriculo)
        return res.status(400).json({ error: 'O arquivo não parece ser um currículo. Verifique e tente novamente.' });

      // Traduz se necessário
      const { texto: textoFinal } = await whatsapp.traduzirSeNecessario(texto);

      // Analisa com IA
      const dados = await whatsapp.analisarComRetry(textoFinal);
      dados.nome  = dados.nome  || nome  || null;
      dados.email = dados.email || email || null;

      // Verifica duplicata
      const existente = whatsappDb.findByPhoneOrEmail(dados.telefone, dados.email || email);
      if (existente) whatsappDb.deleteCurriculo(existente.id);

      // Salva currículo
      const curriculo_id = whatsappDb.saveCurriculo({
        remetente:    `ps:${email || nome || 'desconhecido'}`,
        nome:         dados.nome,
        telefone:     dados.telefone     || null,
        email:        dados.email        || null,
        endereco:     dados.endereco     || null,
        linkedin:     dados.linkedin     || null,
        descricao:    dados.descricao    || null,
        experiencias: dados.experiencias || [],
        formacao:     dados.formacao     || [],
        capacitacoes: dados.capacitacoes || [],
        habilidades:  dados.habilidades  || [],
        dados_completos: JSON.stringify(dados),
        pdf_base64,
        pdf_nome: pdf_nome || 'curriculo.pdf',
      });

      // Registra candidatura
      db.saveCandidatura({
        vaga_id:        Number(vaga_id),
        curriculo_id,
        canal:          'email',
        candidato_nome:  dados.nome  || nome,
        candidato_email: dados.email || email,
      });

      // Notificação por email (não bloqueia a resposta)
      const emailCfg = db.getEmailConfig();
      if (emailCfg.email && db.getSenhaReal()) {
        enviarEmailNotificacao(emailCfg, vaga, dados, pdf_base64, pdf_nome || 'curriculo.pdf')
          .catch(err => log(`[PS] Falha no email de notificação: ${err.message}`, 'warning'));
      }

      log(`[PS] Currículo recebido de "${dados.nome || nome}" para vaga "${vaga.funcao?.nome}"`, 'success');
      res.json({ ok: true, curriculo_id });

    } catch (err) {
      log(`[PS] Erro ao processar candidatura: ${err.message}`, 'error');
      res.status(500).json({ error: 'Erro ao processar currículo. Tente novamente em instantes.' });
    }
  });

  // ── Serve página pública ──────────────────────────────────────────────────────
  app.get('/ps/:token', (req, res) => {
    if (!db.validateToken(req.params.token)) {
      return res.status(403).send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Link Inválido</title>
        <style>body{font-family:sans-serif;text-align:center;padding:80px;background:#0d1117;color:#f0f6fc}
        h2{color:#f0f6fc}p{color:#8b949e}</style></head>
        <body><h2>🔒 Link Inválido</h2><p>Este link não é mais válido. Solicite um novo link ao recrutador.</p></body></html>`);
    }
    res.sendFile(path.join(__dirname, 'frontend', 'ps-publico.html'));
  });
};
