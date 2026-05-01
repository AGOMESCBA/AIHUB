const fs      = require('fs');
const path    = require('path');
const db      = require('./database');
const manager = require('./service-manager');

// Pasta onde LocalAuth salva sessões por empresa
const AUTH_BASE = path.join(__dirname, '..', '..', '.wwebjs_auth');

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

    svc.on('curriculo', ({ remetente, dados, pdf_base64, pdf_nome, empresaId }) => {
      const id = db.saveCurriculo(empresaId, {
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
      registrarLog(entry, eid);
      io.to(room).emit('log', entry);
    });
  }

  // ── Serviço ───────────────────────────────────────────────────────────────
  app.post('/api/service/start', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const svc = manager.getOrCreate(eid);
    wireEvents(svc, eid);
    svc.start(eid, req.session.empresa_nome);
    res.json({ ok: true });
  });

  app.post('/api/service/stop', requireAuth, requireEmpresa, (req, res) => {
    const svc = manager.get(req.session.empresa_id);
    svc?.stop();
    res.json({ ok: true });
  });

  app.get('/api/service/status', requireAuth, requireEmpresa, (req, res) => {
    const svc = manager.get(req.session.empresa_id);
    res.json({
      status:       svc?.getStatus()     || 'stopped',
      empresa_id:   svc?.getEmpresaId()  || null,
      empresa_nome: svc?.getEmpresaNome()|| null,
    });
  });

  app.get('/api/service/qr', requireAuth, requireEmpresa, (req, res) => {
    const svc = manager.get(req.session.empresa_id);
    res.json({ qr: svc?.getQr() || null });
  });

  app.post('/api/service/clear-log', requireAuth, requireEmpresa, (req, res) => {
    const svc = manager.get(req.session.empresa_id);
    svc?.clearBuffer();
    res.json({ ok: true });
  });

  // Limpa a sessão da empresa atual (permite conectar um número diferente)
  app.post('/api/service/clear-session', requireAuth, requireEmpresa, async (req, res) => {
    try {
      const eid = req.session.empresa_id;
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

  // ── Configuração ──────────────────────────────────────────────────────────
  app.get('/api/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    res.json({
      numero_destino:   db.getConfig(eid, 'numero_destino')   || '',
      label:            db.getConfig(eid, 'label')            || '',
      msg_confirmacao:  db.getConfig(eid, 'msg_confirmacao')  || '',
      msg_nao_pdf:      db.getConfig(eid, 'msg_nao_pdf')      || '',
      msg_pdf_ilegivel: db.getConfig(eid, 'msg_pdf_ilegivel') || '',
      msg_nao_curriculo:db.getConfig(eid, 'msg_nao_curriculo')|| '',
      msg_duplicata:    db.getConfig(eid, 'msg_duplicata')    || '',
      msg_nao_atualizar:db.getConfig(eid, 'msg_nao_atualizar')|| '',
      msg_erro:         db.getConfig(eid, 'msg_erro')         || '',
    });
  });

  app.post('/api/config', requireAuth, requireEmpresa, (req, res) => {
    const eid = req.session.empresa_id;
    const campos = ['numero_destino','label','msg_confirmacao','msg_nao_pdf',
                    'msg_pdf_ilegivel','msg_nao_curriculo','msg_duplicata',
                    'msg_nao_atualizar','msg_erro'];
    campos.forEach(c => { if (req.body[c] !== undefined) db.setConfig(eid, c, req.body[c]); });
    res.json({ ok: true });
  });

  // ── Currículos ────────────────────────────────────────────────────────────
  app.get('/api/curriculos', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.listCurriculos(req.session.empresa_id));
  });

  app.get('/api/curriculos/:id', requireAuth, requireEmpresa, (req, res) => {
    const row = db.getCurriculo(req.session.empresa_id, Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Não encontrado' });
    res.json(row);
  });

  app.delete('/api/curriculos/:id', requireAuth, requireEmpresa, (req, res) => {
    const ok = db.deleteCurriculo(req.session.empresa_id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get('/api/stats', requireAuth, requireEmpresa, (req, res) => {
    const eid       = req.session.empresa_id;
    const curriculos = db.listCurriculos(eid);
    const hoje      = new Date().toISOString().slice(0, 10);
    const isWA      = c => !c.remetente?.startsWith('email-externo:') && !c.remetente?.startsWith('ps:');
    const isEmail   = c =>  c.remetente?.startsWith('email-externo:');
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
