const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const pdfParse   = require('pdf-parse/lib/pdf-parse.js');

const db          = require('./database');
const crud        = require('../crud');
const analisadorDb = require('../analisador-curriculos/database');
const whatsappDb   = require('../whatsapp-curriculo/database');
const emailSvcMgr  = require('./email-service-manager');
const ia           = require('../ia');
const LOG_DIR      = path.join(__dirname, '..', '..', '..', '..', 'logs');

function _resolverEid(req, res) {
  const explicit = Number(req.body?.empresa_id || req.query?.empresa_id || 0);
  if (!explicit) return req.session.empresa_id;
  const { empresas: acesso, role } = req.session;
  const ok = role === 'admin' || acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(explicit));
  if (!ok) { res.status(403).json({ error: 'Acesso negado a esta empresa' }); return null; }
  return explicit;
}

function criarTransporter(cfg) {
  const senha  = cfg.senha;
  const family = Number(cfg.family) || 4;
  if (cfg.tipo === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: cfg.email, pass: senha },
      family,
      tls: { rejectUnauthorized: false },
    });
  }
  return nodemailer.createTransport({
    host:   cfg.smtp_host,
    port:   Number(cfg.smtp_port) || 587,
    secure: !!cfg.smtp_secure,
    auth:   { user: cfg.email, pass: senha },
    family,
    tls:    { rejectUnauthorized: false },
  });
}

async function enviarEmailNotificacao(cfg, vaga, dados, pdf_base64, pdf_nome, logFn, empresaId) {
  const t = criarTransporter({ ...cfg, senha: db.getSenhaReal(empresaId) });
  const funcaoNome = vaga.funcao?.nome || `Vaga #${vaga.id}`;

  const exps = (dados.experiencias || []).slice(0, 3)
    .map(e => `<li>${e.cargo || '—'} em ${e.empresa || '—'} (${e.periodo || '—'})</li>`).join('');
  const habs = (dados.habilidades || []).slice(0, 10).join(', ');

  const servidor = cfg.tipo === 'gmail' ? `Gmail (${cfg.email})` : `SMTP ${cfg.smtp_host}:${cfg.smtp_port}`;
  logFn(`[Email] Conectando ao servidor — ${servidor}`, 'info');

  await t.sendMail({
    from:    `"IAHub Recrutamento" <${cfg.email}>`,
    to:      cfg.email,
    subject: `[IAHUB] - ${dados.nome || 'Candidato'}`,
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
  logFn(`[Email] Notificação enviada → ${cfg.email} | Candidato: ${dados.nome || '—'} | Vaga: ${funcaoNome}`, 'success');
}

module.exports = function registerRoutes(app, { requireAuth, requireEmpresa, registrarLog, io }) {

  function log(message, type = 'info') {
    if (registrarLog) registrarLog({ message, type, timestamp: new Date().toLocaleTimeString('pt-BR') });
  }

  // ── Email Config (autenticado) ────────────────────────────────────────────────
  app.get('/api/ps/email-config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const cfg = db.getEmailConfig(eid);
    res.json({ ...cfg, senha: cfg.senha ? '••••••••' : '' });
  });

  app.post('/api/ps/email-config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    db.setEmailConfig(eid, req.body);
    res.json({ ok: true });
  });

  app.post('/api/ps/email-test', requireAuth, requireEmpresa, async (req, res) => {
    const eid  = _resolverEid(req, res);
    if (eid === null) return;
    const cfg  = db.getEmailConfig(eid);
    const senha = db.getSenhaReal(eid);
    if (!cfg.email) return res.status(400).json({ error: 'Configure o e-mail primeiro.' });
    if (!senha)     return res.status(400).json({ error: 'Configure a senha primeiro.' });
    const servidor = cfg.tipo === 'gmail' ? `Gmail (${cfg.email})` : `SMTP ${cfg.smtp_host}:${cfg.smtp_port}`;
    log(`[Email] Iniciando teste de conexão — ${servidor}`, 'info');
    try {
      const t = criarTransporter({ ...cfg, senha });
      await t.verify();
      log(`[Email] Conexão verificada com sucesso — ${servidor}`, 'success');
      const empNome = crud.buscarPorId('empresas', eid)?.razao_social || req.session.empresa_nome || 'IAHub';
      await t.sendMail({
        from:    `"${empNome} Recrutamento" <${cfg.email}>`,
        to:      cfg.email,
        subject: `[${empNome}] Teste de configuração de e-mail ✅`,
        text:    `Configuração de e-mail funcionando! O sistema está pronto para enviar notificações de currículos.`,
      });
      log(`[Email] E-mail de teste enviado com sucesso → ${cfg.email}`, 'success');
      res.json({ ok: true });
    } catch (err) {
      log(`[Email] Falha no teste de conexão (${servidor}): ${err.message}`, 'error');
      res.status(500).json({ error: err.message });
    }
  });

  // ── Email Geral Config ────────────────────────────────────────────────────────
  app.get('/api/email-geral/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const cfg = db.getEmailGeralConfig(eid);
    res.json({ ...cfg, senha: cfg.senha ? '••••••••' : '' });
  });

  app.post('/api/email-geral/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    db.setEmailGeralConfig(eid, req.body);
    res.json({ ok: true });
  });

  app.post('/api/email-geral/imap-test', requireAuth, requireEmpresa, async (req, res) => {
    const eid   = _resolverEid(req, res);
    if (eid === null) return;
    const cfg   = db.getEmailGeralConfig(eid);
    const senha = db.getSenhaGeralReal(eid);
    if (!cfg.email) return res.status(400).json({ error: 'Configure o e-mail primeiro.' });
    if (!senha)     return res.status(400).json({ error: 'Configure a senha primeiro.' });
    try {
      await emailImap.testarConexao({ ...cfg, imap_host: cfg.imap_host, imap_port: cfg.imap_port, imap_secure: cfg.imap_secure }, senha);
      res.json({ ok: true });
    } catch (err) {
      log(`[Email Geral] Falha no teste IMAP: ${err.message}`, 'error');
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/email-geral/test', requireAuth, requireEmpresa, async (req, res) => {
    const eid   = _resolverEid(req, res);
    if (eid === null) return;
    const cfg   = db.getEmailGeralConfig(eid);
    const senha = db.getSenhaGeralReal(eid);
    if (!cfg.email) return res.status(400).json({ error: 'Configure o e-mail primeiro.' });
    if (!senha)     return res.status(400).json({ error: 'Configure a senha primeiro.' });
    const servidor = cfg.tipo === 'gmail' ? `Gmail (${cfg.email})` : `SMTP ${cfg.smtp_host}:${cfg.smtp_port}`;
    log(`[Email Geral] Iniciando teste de conexão — ${servidor}`, 'info');
    try {
      const t = criarTransporter({ ...cfg, senha });
      await t.verify();
      log(`[Email Geral] Conexão verificada com sucesso — ${servidor}`, 'success');
      const empNomeGeral = crud.buscarPorId('empresas', eid)?.razao_social || req.session.empresa_nome || 'IAHub';
      await t.sendMail({
        from:    `"${empNomeGeral}" <${cfg.email}>`,
        to:      cfg.email,
        subject: `[${empNomeGeral}] Teste de configuração de e-mail (Geral) ✅`,
        text:    `Configuração de e-mail geral funcionando! O sistema está pronto para enviar notificações.`,
      });
      log(`[Email Geral] E-mail de teste enviado com sucesso → ${cfg.email}`, 'success');
      res.json({ ok: true });
    } catch (err) {
      log(`[Email Geral] Falha no teste de conexão (${servidor}): ${err.message}`, 'error');
      res.status(500).json({ error: err.message });
    }
  });

  // ── Slug (autenticado) ────────────────────────────────────────────────────────
  app.get('/api/ps/slug', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json({ slug: db.getSlug(eid) || '' });
  });

  app.post('/api/ps/slug', requireAuth, requireEmpresa, (req, res) => {
    const eid  = _resolverEid(req, res);
    if (eid === null) return;
    const slug = (req.body.slug || '').trim().toLowerCase();
    if (slug && !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug))
      return res.status(400).json({ error: 'Slug inválido. Use apenas letras minúsculas, números e hífens (mín. 3 chars).' });
    db.setSlug(eid, slug || null);
    res.json({ ok: true });
  });

  // ── Token Público (autenticado) ───────────────────────────────────────────────
  app.get('/api/ps/public-token', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json({ token: db.getPublicToken(eid), slug: db.getSlug(eid) || null });
  });

  app.post('/api/ps/regenerate-token', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json({ token: db.regenerateToken(eid), slug: db.getSlug(eid) || null });
  });

  // ── Candidaturas (autenticado) ────────────────────────────────────────────────
  app.get('/api/ps/candidaturas', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json(db.listCandidaturas(eid));
  });

  app.get('/api/ps/candidaturas/vaga/:vagaId', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json(db.listCandidaturasByVaga(eid, Number(req.params.vagaId)));
  });

  app.get('/api/ps/curriculos-sem-vaga', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const vinculados = new Set(db.listCandidaturas(eid).map(c => c.curriculo_id));
    const todos = whatsappDb.listCurriculos(eid);
    res.json(todos.filter(c => !vinculados.has(c.id)));
  });

  // ── API Pública ───────────────────────────────────────────────────────────────
  function resolverEmpresaPorToken(req, res) {
    const empresaId = db.findEmpresaIdByToken(req.params.token);
    if (!empresaId) {
      res.status(403).json({ error: 'Link inválido ou expirado.' });
      return null;
    }
    return empresaId;
  }

  app.get('/api/public/ps/:token/info', (req, res) => {
    const empresaId = resolverEmpresaPorToken(req, res);
    if (!empresaId) return;
    const numero  = (whatsappDb.getConfig(empresaId, 'numero_destino') || '').replace(/\D/g, '');
    const empresa = crud.buscarPorId('empresas', empresaId);
    res.json({ wa_numero: numero || null, empresa_nome: empresa?.razao_social || null });
  });

  app.get('/api/public/ps/:token/vagas', (req, res) => {
    const empresaId = resolverEmpresaPorToken(req, res);
    if (!empresaId) return;
    const vagas = analisadorDb.listVagas(empresaId).filter(v => v.status === 'aberta');
    res.json(vagas);
  });

  app.post('/api/public/ps/:token/candidatar', async (req, res) => {
    const empresaId = resolverEmpresaPorToken(req, res);
    if (!empresaId) return;

    console.log(`[PS-Público] Candidatura recebida — empresa ${empresaId} — token ${req.params.token?.slice(0,8)}...`);

    const body = req.body || {};
    const { vaga_id, nome, email, pdf_base64, pdf_nome } = body;
    if (!vaga_id)      return res.status(400).json({ error: 'Selecione uma vaga.' });
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!pdf_base64)   return res.status(400).json({ error: 'Anexe seu currículo em PDF.' });

    const vaga = analisadorDb.getVaga(empresaId, Number(vaga_id));
    if (!vaga || vaga.status !== 'aberta')
      return res.status(400).json({ error: 'Esta vaga não está disponível.' });

    function logPs(message, type = 'info') {
      if (registrarLog) registrarLog({ message, type, timestamp: new Date().toLocaleTimeString('pt-BR') }, empresaId);
      if (type === 'error') console.error('[PS-Público]', message);
      else console.log('[PS-Público]', message);
    }

    // Timeout de segurança: se o processamento travar, responde após 90s
    let _timeoutDone = false;
    const _timeout = setTimeout(() => {
      _timeoutDone = true;
      console.error('[PS-Público] Timeout de 90s atingido — sem resposta ao candidato.');
      if (registrarLog) registrarLog({ message: '[PS] Timeout de 90s ao processar candidatura', type: 'error', timestamp: new Date().toLocaleTimeString('pt-BR') }, empresaId);
      if (!res.headersSent) res.status(500).json({ error: 'Processamento demorou demais. Tente novamente em instantes.' });
    }, 90000);

    try {
      const buffer  = Buffer.from(pdf_base64, 'base64');

      let pdfData;
      try {
        pdfData = await Promise.race([
          pdfParse(buffer),
          new Promise((_, rej) => setTimeout(() => rej(new Error('PDF parsing timeout')), 30000)),
        ]);
      } catch (pdfErr) {
        logPs(`[PS] Falha ao ler PDF: ${pdfErr.message}`, 'error');
        clearTimeout(_timeout);
        if (!res.headersSent) res.status(400).json({ error: 'Não foi possível ler o PDF. Certifique-se de que o arquivo não está protegido por senha e tente novamente.' });
        return;
      }

      const texto = pdfData.text.trim();
      if (!texto)
        return res.status(400).json({ error: 'PDF ilegível ou protegido. Envie um PDF com texto selecionável.' });

      const ehCurriculo = await ia.verificarSeCurriculo(texto, logPs, empresaId);
      if (!ehCurriculo)
        return res.status(400).json({ error: 'O arquivo não parece ser um currículo. Verifique e tente novamente.' });

      const { texto: textoFinal } = await ia.traduzirSeNecessario(texto, logPs, empresaId);
      const dados = await ia.analisarComRetry(textoFinal, logPs, empresaId);
      dados.nome  = dados.nome  || nome  || null;
      dados.email = dados.email || email || null;

      // Sobrescreve silenciosamente se já existe na base
      const existente = whatsappDb.findByPhoneOrEmail(empresaId, dados.telefone, dados.email || email);
      if (existente) {
        logPs(`[PS] Currículo duplicado — "${existente.nome || '?'}" (ID #${existente.id}) substituído por novo envio de "${dados.nome || nome}"`, 'warning');
        whatsappDb.deleteCurriculo(empresaId, existente.id);
      }

      const curriculo_id = whatsappDb.saveCurriculo(empresaId, {
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

      const candExist = db.findCandidaturaByVagaAndCandidato(empresaId, Number(vaga_id), dados.email || email, dados.nome || nome);
      if (candExist) {
        db.updateCandidaturaCurriculoId(empresaId, candExist.id, curriculo_id);
        logPs(`[PS] Reenvio detectado — candidatura de "${dados.nome || nome}" atualizada, contagem mantida`, 'info');
      } else {
        db.saveCandidatura(empresaId, {
          vaga_id:         Number(vaga_id),
          curriculo_id,
          canal:           'email',
          candidato_nome:  dados.nome  || nome,
          candidato_email: dados.email || email,
        });
      }

      logPs(`[PS] Currículo recebido de "${dados.nome || nome}" para vaga "${vaga.funcao?.nome}"`, 'success');

      const emailCfg = db.getEmailConfig(empresaId);
      if (emailCfg.email && db.getSenhaReal(empresaId)) {
        enviarEmailNotificacao(emailCfg, vaga, dados, pdf_base64, pdf_nome || 'curriculo.pdf', logPs, empresaId)
          .catch(err => logPs(`[Email] Falha ao enviar notificação para "${dados.nome || nome}": ${err.message}`, 'error'));
      } else {
        logPs('[Email] Notificação por e-mail desativada — sem e-mail ou senha configurados.', 'warning');
      }
      clearTimeout(_timeout);
      if (!_timeoutDone) res.json({ ok: true, curriculo_id });

    } catch (err) {
      clearTimeout(_timeout);
      console.error('[PS-Público] Erro ao processar candidatura:', err);
      if (registrarLog) registrarLog({ message: `[PS] Erro ao processar candidatura: ${err.message}`, type: 'error', timestamp: new Date().toLocaleTimeString('pt-BR') }, empresaId);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao processar currículo. Tente novamente em instantes.' });
    }
  });

  // ── Serve página pública (aceita token UUID ou slug) ─────────────────────────
  app.get('/ps/:identifier', (req, res) => {
    const empresaId = db.findEmpresaIdByToken(req.params.identifier);
    if (!empresaId) {
      return res.status(403).send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Link Inválido</title>
        <style>body{font-family:sans-serif;text-align:center;padding:80px;background:#0d1117;color:#f0f6fc}
        h2{color:#f0f6fc}p{color:#8b949e}</style></head>
        <body><h2>🔒 Link Inválido</h2><p>Este link não é mais válido. Solicite um novo link ao recrutador.</p></body></html>`);
    }
    const realToken = db.resolveToToken(empresaId, req.params.identifier);
    // Injeta o token real no HTML para que a página use sempre o UUID nas chamadas de API
    const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'modules', 'processo-seletivo', 'frontend', 'ps-publico.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html.replace('__PS_TOKEN__', realToken));
  });

  // ── Teste de conexão IMAP ─────────────────────────────────────────────────────
  app.post('/api/ps/imap-test', requireAuth, requireEmpresa, async (req, res) => {
    const eid   = _resolverEid(req, res);
    if (eid === null) return;
    const cfg   = db.getEmailConfig(eid);
    const senha = db.getSenhaReal(eid);
    if (!cfg.email || !senha) return res.status(400).json({ error: 'Configure o e-mail primeiro.' });
    try {
      const result = await emailImap.testarConexao(cfg, senha);
      log(`[IMAP] Teste de conexão OK — ${result.naoLidos} e-mail(s) não lido(s) na caixa de entrada`, 'success');
      res.json(result);
    } catch (err) {
      log(`[IMAP] Falha no teste de conexão: ${err.message}`, 'error');
      res.status(500).json({ error: err.message });
    }
  });

  // ── Templates de E-mail ───────────────────────────────────────────────────────
  app.get('/api/ps/email-templates', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json(db.getEmailTemplates(eid));
  });

  app.post('/api/ps/email-templates', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    db.setEmailTemplates(eid, req.body);
    res.json({ ok: true });
  });

  // ── Serviço de E-mail IMAP — controle manual via monitor ─────────────────────
  app.get('/api/email-service/status', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const svc = emailSvcMgr.get(eid);
    res.json({ status: svc?.getStatus() || 'stopped' });
  });

  app.post('/api/email-service/start', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const svc = emailSvcMgr.getOrCreate(eid);
    if (svc.getStatus() === 'running')
      return res.status(400).json({ error: 'Serviço já está em execução para esta empresa.' });
    if (!io) return res.status(500).json({ error: 'Socket.IO não disponível.' });
    const cfg         = db.getEmailConfig(eid);
    const intervaloMs = Math.max(1, Number(cfg.imap_intervalo_min) || 2) * 60_000;
    const empNome     = crud.buscarPorId('empresas', eid)?.razao_social || null;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    svc.setLogFile(path.join(LOG_DIR, `emailcurriculo_${eid}.log`));
    svc.iniciarServico({ db, whatsappDb, analisadorDb }, io, intervaloMs, eid, empNome);
    res.json({ ok: true });
  });

  app.post('/api/email-service/stop', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    emailSvcMgr.get(eid)?.pararServico();
    res.json({ ok: true });
  });

  app.post('/api/email-service/clear-log', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    emailSvcMgr.get(eid)?.clearBuffer();
    res.json({ ok: true });
  });
};
