const manager = require('./service-manager');
const crud    = require('../database/crud');
const { requireRotina } = require('../permissions');

module.exports = function registrarRotasWhatsApp(app, { requireAuth, requireIaCommand, io }) {

  function _eid(req) { return req.session.empresa_id; }
  const canMonitorWhatsapp = requireRotina('iac-monitor-whatsapp');

  // Conecta eventos do service ao Socket.IO (executado uma única vez por instância)
  function wireEvents(svc, eid) {
    if (svc._wired) return;
    svc._wired = true;
    const room = `emp_${eid}`;

    svc.on('iac-log',    (entry) => io.to(room).emit('iac-log', entry));
    svc.on('iac-status', (data)  => io.to(room).emit('iac-status', data));
    svc.on('iac-qr',     (url)   => io.to(room).emit('iac-qr', url));
    svc.on('iac-msg',    (data)  => io.to(room).emit('iac-msg', data));

    // Persiste status no SQLite
    svc.on('iac-status', ({ status }) => {
      try {
        const db = require('../database').getDB();
        const existing = db.prepare('SELECT empresa_id FROM whatsapp_sessions WHERE empresa_id = ?').get(eid);
        const agora = new Date().toISOString();
        if (existing) {
          db.prepare(`UPDATE whatsapp_sessions SET status = ?, atualizado_em = ?,
            ${status === 'connected' ? 'conectado_em = ?,' : status === 'stopped' ? 'desconectado_em = ?,' : 'atualizado_em = ?,'}
            atualizado_em = ? WHERE empresa_id = ?`)
            .run(status, agora, agora, agora, eid);
        } else {
          db.prepare(`INSERT INTO whatsapp_sessions (empresa_id, status, atualizado_em) VALUES (?, ?, ?)`)
            .run(eid, status, agora);
        }
      } catch (_) {}
    });
  }

  // ── START ────────────────────────────────────────────────────────────────────
  app.post('/api/ia-command/whatsapp/start', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const eid = _eid(req);
    const svc = manager.getOrCreate(eid);
    wireEvents(svc, eid);
    svc.start(eid);
    res.json({ ok: true });
  });

  // ── STOP ─────────────────────────────────────────────────────────────────────
  app.post('/api/ia-command/whatsapp/stop', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const eid = _eid(req);
    const svc = manager.get(eid);
    if (svc) svc.stop();
    res.json({ ok: true });
  });

  // ── STATUS ───────────────────────────────────────────────────────────────────
  app.get('/api/ia-command/whatsapp/status', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const eid = _eid(req);
    const svc = manager.get(eid);
    res.json({
      status:    svc?.getStatus()  || 'stopped',
      qr:        svc?.getQr()      || null,
      msgCount:  svc?.getMsgCount()|| 0,
      empresa_id: eid,
    });
  });

  // ── ENVIAR MENSAGEM DE TESTE ──────────────────────────────────────────────────
  app.post('/api/ia-command/whatsapp/send-test', requireAuth, requireIaCommand, canMonitorWhatsapp, async (req, res) => {
    const eid    = _eid(req);
    const { numero, mensagem } = req.body || {};
    if (!numero) return res.status(400).json({ error: 'Campo "numero" é obrigatório.' });

    const svc = manager.get(eid);
    if (!svc || svc.getStatus() !== 'connected')
      return res.status(400).json({ error: 'WhatsApp não está conectado.' });

    try {
      await svc.sendMessage(numero, mensagem || '✅ *IA Command* — Teste de envio realizado com sucesso!');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── LIMPAR LOGS ───────────────────────────────────────────────────────────────
  app.post('/api/ia-command/whatsapp/clear-logs', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const svc = manager.get(_eid(req));
    if (svc) svc.clearBuffer();
    res.json({ ok: true });
  });
};
