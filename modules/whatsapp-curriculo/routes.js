const fs       = require('fs');
const path     = require('path');
const db       = require('./database');
const whatsapp = require('./service');

// Pasta onde LocalAuth salva a sessão (padrão do whatsapp-web.js)
const SESSION_DIR = path.join(__dirname, '..', '..', '.wwebjs_auth');

module.exports = function registerRoutes(app, { requireAuth, registrarLog, io }) {

  // ── Serviço ───────────────────────────────────────────────────────────────
  app.post('/api/service/start',  requireAuth, (_req, res) => { whatsapp.start(); res.json({ ok: true }); });
  app.post('/api/service/stop',   requireAuth, (_req, res) => { whatsapp.stop();  res.json({ ok: true }); });
  app.get ('/api/service/status', requireAuth, (_req, res) => res.json({ status: whatsapp.getStatus() }));
  app.get ('/api/service/qr',     requireAuth, (_req, res) => res.json({ qr: whatsapp.getQr() || null }));

  // Limpa sessão salva (permite conectar um número diferente)
  app.post('/api/service/clear-session', requireAuth, async (_req, res) => {
    try {
      await whatsapp.stop();
      if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Configuração ──────────────────────────────────────────────────────────
  app.get('/api/config', requireAuth, (_req, res) => {
    res.json({
      numero_destino:  db.getConfig('numero_destino')  || '',
      label:           db.getConfig('label')           || '',
      msg_confirmacao: db.getConfig('msg_confirmacao') || '',
      msg_nao_pdf:     db.getConfig('msg_nao_pdf')     || '',
      msg_pdf_ilegivel:db.getConfig('msg_pdf_ilegivel')|| '',
      msg_nao_curriculo:db.getConfig('msg_nao_curriculo')||'',
      msg_duplicata:   db.getConfig('msg_duplicata')   || '',
      msg_nao_atualizar:db.getConfig('msg_nao_atualizar')||'',
      msg_erro:        db.getConfig('msg_erro')        || '',
    });
  });

  app.post('/api/config', requireAuth, (req, res) => {
    const campos = ['numero_destino','label','msg_confirmacao','msg_nao_pdf',
                    'msg_pdf_ilegivel','msg_nao_curriculo','msg_duplicata',
                    'msg_nao_atualizar','msg_erro'];
    campos.forEach(c => { if (req.body[c] !== undefined) db.setConfig(c, req.body[c]); });
    res.json({ ok: true });
  });

  // ── Currículos ────────────────────────────────────────────────────────────
  app.get   ('/api/curriculos',     requireAuth, (_req, res) => res.json(db.listCurriculos()));
  app.get   ('/api/curriculos/:id', requireAuth, (req, res) => {
    const row = db.getCurriculo(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Não encontrado' });
    res.json(row);
  });
  app.delete('/api/curriculos/:id', requireAuth, (req, res) => {
    const ok = db.deleteCurriculo(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get('/api/stats', requireAuth, (_req, res) => {
    const curriculos = db.listCurriculos();
    const hoje = new Date().toISOString().slice(0, 10);
    const isWA    = c => !c.remetente?.startsWith('email-externo:') && !c.remetente?.startsWith('ps:');
    const isEmail = c =>  c.remetente?.startsWith('email-externo:');
    res.json({
      wa: {
        total: curriculos.filter(isWA).length,
        hoje:  curriculos.filter(c => isWA(c) && c.recebido_em?.startsWith(hoje)).length,
      },
      email: {
        total: curriculos.filter(isEmail).length,
        hoje:  curriculos.filter(c => isEmail(c) && c.recebido_em?.startsWith(hoje)).length,
      },
      status: whatsapp.getStatus(),
    });
  });

  // ── Eventos do WhatsApp → Socket.IO ───────────────────────────────────────
  whatsapp.on('log', (entry) => {
    registrarLog(entry);
    io.emit('log', entry);
  });

  whatsapp.on('status', (status) => io.emit('status', status));
  whatsapp.on('qr',     (url)    => io.emit('qr', url));

  whatsapp.on('curriculo', ({ remetente, dados, pdf_base64, pdf_nome }) => {
    const id = db.saveCurriculo({
      remetente,
      ...dados,
      dados_completos: JSON.stringify(dados),
      pdf_base64,
      pdf_nome,
    });
    const entry = {
      message:   `Currículo gravado. ID #${id} — ${dados.nome || remetente}`,
      type:      'saved',
      timestamp: new Date().toLocaleTimeString('pt-BR'),
    };
    registrarLog(entry);
    io.emit('log', entry);
  });
};
