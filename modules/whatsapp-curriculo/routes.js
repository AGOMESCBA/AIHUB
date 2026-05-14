const fs                  = require('fs');
const path                = require('path');
const db                  = require('./database');
const manager             = require('./service-manager');
const MetaWhatsAppService = require('./service-meta');

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function _maskKey(key) {
  if (!key || key.length < 8) return '';
  return key.slice(0, 6) + '••••••••••••' + key.slice(-4);
}

// Pasta onde LocalAuth salva sessões por empresa
const AUTH_BASE = path.join(__dirname, '..', '..', '.wwebjs_auth');

function _resolverEid(req, res) {
  const explicit = Number(req.body?.empresa_id || req.query?.empresa_id || 0);
  if (!explicit) return req.session.empresa_id;
  const { empresas: acesso, role } = req.session;
  const ok = role === 'admin' || acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(explicit));
  if (!ok) { res.status(403).json({ error: 'Acesso negado a esta empresa' }); return null; }
  return explicit;
}

module.exports = function registerRoutes(app, { requireAuth, requireEmpresa, registrarLog, io }) {

  // Conecta os eventos de uma instância à sala Socket.IO da empresa (uma vez só)
  function wireEvents(svc, eid) {
    if (svc._wired) return;
    svc._wired = true;
    const room = `emp_${eid}`;

    svc.on('log', (entry) => {
      registrarLog(entry, eid);
      io.to(room).emit('log', entry);
    });

    svc.on('status', (status) => io.to(room).emit('status', {
      status,
      empresa_id:   eid,
      empresa_nome: svc.getEmpresaNome(),
    }));

    svc.on('qr', (url) => io.to(room).emit('qr', url));

    svc.on('curriculo', ({ remetente, dados, pdf_base64, pdf_nome, empresaId, empresaNome }) => {
      const id = db.saveCurriculo(empresaId, {
        remetente,
        ...dados,
        empresa_nome:    empresaNome || null,
        dados_completos: JSON.stringify(dados),
        pdf_base64,
        pdf_nome,
      });
      const entry = {
        message:   `Currículo gravado. ID #${id} — ${dados.nome || remetente}`,
        type:      'saved',
        timestamp: new Date().toLocaleTimeString('pt-BR'),
      };
      registrarLog(entry, eid);
      io.to(room).emit('log', entry);
    });
  }

  // ── Serviço ───────────────────────────────────────────────────────────────
  app.post('/api/service/start', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const empNome = req.session.empresa_id === eid ? req.session.empresa_nome
      : require('../crud').buscarPorId('empresas', eid)?.razao_social || null;
    const svc = manager.getOrCreate(eid);
    wireEvents(svc, eid);
    svc.start(eid, empNome);
    res.json({ ok: true });
  });

  app.post('/api/service/stop', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    manager.get(eid)?.stop();
    res.json({ ok: true });
  });

  app.get('/api/service/status', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const svc = manager.get(eid);
    const metaAtivo = db.getConfig(eid, 'meta_wa_ativo') === 'true';
    res.json({
      status:       svc?.getStatus()     || 'stopped',
      empresa_id:   svc?.getEmpresaId()  || null,
      empresa_nome: svc?.getEmpresaNome()|| null,
      provider:     metaAtivo ? 'meta' : 'webjs',
    });
  });

  app.get('/api/service/qr', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json({ qr: manager.get(eid)?.getQr() || null });
  });

  app.post('/api/service/clear-log', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    manager.get(eid)?.clearBuffer();
    res.json({ ok: true });
  });

  // Limpa a sessão da empresa atual (permite conectar um número diferente)
  app.post('/api/service/clear-session', requireAuth, requireEmpresa, async (req, res) => {
    try {
      const eid = _resolverEid(req, res);
      if (eid === null) return;
      const svc = manager.get(eid);
      if (svc) await svc.stop();
      const sessionDir = path.join(AUTH_BASE, `session-empresa_${eid}`);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Configuração geral ────────────────────────────────────────────────────
  app.get('/api/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const metaToken   = db.getConfig(eid, 'meta_wa_token')    || '';
    const metaPhoneId = db.getConfig(eid, 'meta_wa_phone_id') || '';
    res.json({
      numero_destino:           db.getConfig(eid, 'numero_destino')        || '',
      label:                    db.getConfig(eid, 'label')                 || '',
      msg_confirmacao:          db.getConfig(eid, 'msg_confirmacao')       || '',
      msg_nao_pdf:              db.getConfig(eid, 'msg_nao_pdf')           || '',
      msg_pdf_ilegivel:         db.getConfig(eid, 'msg_pdf_ilegivel')      || '',
      msg_nao_curriculo:        db.getConfig(eid, 'msg_nao_curriculo')     || '',
      msg_duplicata:            db.getConfig(eid, 'msg_duplicata')         || '',
      msg_nao_atualizar:        db.getConfig(eid, 'msg_nao_atualizar')     || '',
      msg_erro:                 db.getConfig(eid, 'msg_erro')              || '',
      // Meta API
      meta_wa_ativo:            db.getConfig(eid, 'meta_wa_ativo') === 'true',
      meta_wa_token:            metaToken   ? _maskKey(metaToken)   : '',
      meta_wa_token_salvo:      !!metaToken,
      meta_wa_phone_id:         metaPhoneId ? _maskKey(metaPhoneId) : '',
      meta_wa_phone_id_salvo:   !!metaPhoneId,
      meta_wa_webhook_token:    db.getConfig(eid, 'meta_wa_webhook_token') || '',
    });
  });

  app.post('/api/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const campos = ['numero_destino','label','msg_confirmacao','msg_nao_pdf',
                    'msg_pdf_ilegivel','msg_nao_curriculo','msg_duplicata',
                    'msg_nao_atualizar','msg_erro'];
    campos.forEach(c => { if (req.body[c] !== undefined) db.setConfig(eid, c, req.body[c]); });

    // Meta: só salva se não tiver bullets (campo mascarado = sem alteração)
    if (req.body.meta_wa_ativo !== undefined)
      db.setConfig(eid, 'meta_wa_ativo', req.body.meta_wa_ativo ? 'true' : 'false');
    if (req.body.meta_wa_token !== undefined && !req.body.meta_wa_token.includes('•'))
      db.setConfig(eid, 'meta_wa_token', req.body.meta_wa_token.trim());
    if (req.body.meta_wa_phone_id !== undefined && !req.body.meta_wa_phone_id.includes('•'))
      db.setConfig(eid, 'meta_wa_phone_id', req.body.meta_wa_phone_id.trim());
    if (req.body.meta_wa_webhook_token !== undefined)
      db.setConfig(eid, 'meta_wa_webhook_token', req.body.meta_wa_webhook_token.trim());

    res.json({ ok: true });
  });

  // ── Meta: testar conexão ──────────────────────────────────────────────────
  app.post('/api/meta/test-connection', requireAuth, requireEmpresa, async (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    let { token, phone_id } = req.body || {};

    // Usa valores salvos se o usuário não enviou novos
    if (!token    || token.includes('•'))    token    = db.getConfig(eid, 'meta_wa_token')    || '';
    if (!phone_id || phone_id.includes('•')) phone_id = db.getConfig(eid, 'meta_wa_phone_id') || '';

    if (!token)    return res.status(400).json({ ok: false, error: 'Token de acesso não configurado.' });
    if (!phone_id) return res.status(400).json({ ok: false, error: 'Phone Number ID não configurado.' });

    try {
      const resp = await fetch(
        `${GRAPH_API}/${phone_id}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await resp.json();
      if (!resp.ok) {
        return res.json({ ok: false, error: data?.error?.message || `HTTP ${resp.status}` });
      }
      return res.json({
        ok:                   true,
        display_phone_number: data.display_phone_number,
        verified_name:        data.verified_name,
        quality_rating:       data.quality_rating,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Meta webhook: verificação GET (público — chamado pela Meta) ───────────
  app.get('/api/whatsapp/webhook/meta', (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe' || !token) return res.sendStatus(403);

    const eid = manager.findByMetaWebhookToken(token);
    if (eid === null) return res.sendStatus(403);

    res.send(challenge);
  });

  // ── Meta webhook: receber mensagens POST (público — chamado pela Meta) ────
  app.post('/api/whatsapp/webhook/meta', (req, res) => {
    res.sendStatus(200); // responde imediatamente para Meta não reenviar

    const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    if (!phoneNumberId) return;

    const eid = manager.findByMetaPhoneId(phoneNumberId);
    if (eid === null) return;

    const svc = manager.get(eid);
    if (!svc || !(svc instanceof MetaWhatsAppService)) return;

    svc.handleWebhook(req.body).catch(err =>
      console.error('[Meta webhook] Erro ao processar:', err.message)
    );
  });

  // ── Currículos ────────────────────────────────────────────────────────────
  app.get('/api/curriculos', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    res.json(db.listCurriculos(eid));
  });

  app.get('/api/curriculos/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const row = db.getCurriculo(eid, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Não encontrado' });
    res.json(row);
  });

  app.delete('/api/curriculos/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req, res);
    if (eid === null) return;
    const ok = db.deleteCurriculo(eid, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get('/api/stats', requireAuth, requireEmpresa, (req, res) => {
    const eid       = _resolverEid(req, res);
    if (eid === null) return;
    const curriculos = db.listCurriculos(eid);
    const hoje      = new Date().toISOString().slice(0, 10);
    const isWA      = c => !c.remetente?.startsWith('email-externo:') && !c.remetente?.startsWith('email-livre:') && !c.remetente?.startsWith('ps:');
    const isEmail   = c =>  c.remetente?.startsWith('email-externo:') || c.remetente?.startsWith('email-livre:');
    const svc       = manager.get(eid);
    res.json({
      wa: {
        total: curriculos.filter(isWA).length,
        hoje:  curriculos.filter(c => isWA(c) && c.recebido_em?.startsWith(hoje)).length,
      },
      email: {
        total: curriculos.filter(isEmail).length,
        hoje:  curriculos.filter(c => isEmail(c) && c.recebido_em?.startsWith(hoje)).length,
      },
      status: svc?.getStatus() || 'stopped',
    });
  });
};
