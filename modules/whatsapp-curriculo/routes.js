const db       = require('./database');
const whatsapp = require('./service');

module.exports = function registerRoutes(app, { requireAuth, registrarLog, io }) {

  // ── Serviço ───────────────────────────────────────────────────────────────
  app.post('/api/service/start',  requireAuth, (_req, res) => { whatsapp.start(); res.json({ ok: true }); });
  app.post('/api/service/stop',   requireAuth, (_req, res) => { whatsapp.stop();  res.json({ ok: true }); });
  app.get ('/api/service/status', requireAuth, (_req, res) => res.json({ status: whatsapp.getStatus() }));

  // ── Configuração ──────────────────────────────────────────────────────────
  app.get('/api/config', requireAuth, (_req, res) => {
    res.json({
      numero_destino: db.getConfig('numero_destino') || '',
      label:          db.getConfig('label')          || '',
    });
  });

  app.post('/api/config', requireAuth, (req, res) => {
    const { numero_destino, label } = req.body;
    if (numero_destino !== undefined) db.setConfig('numero_destino', numero_destino);
    if (label          !== undefined) db.setConfig('label', label);
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
    res.json({
      total:  curriculos.length,
      hoje:   curriculos.filter(c => c.recebido_em?.startsWith(new Date().toISOString().slice(0, 10))).length,
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
