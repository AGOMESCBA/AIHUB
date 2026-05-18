const manager = require('./service-manager');
const channels = require('./channel-store');
const { requireRotina } = require('../permissions');
const { getEmpresaId } = require('../empresa-context');
const sistemasDb = require('../../../../modules/sistemas/database');
const permissoesDb = require('../../../../modules/permissoes/database');

module.exports = function registrarRotasWhatsApp(app, { requireAuth, requireIaCommand, io }) {
  function eid(req) { return getEmpresaId(req); }

  const canMonitorWhatsapp = requireRotina('iac-monitor-whatsapp');
  const canAdminCanais = requireRotina('iac-admin-canais-whatsapp');

  function userCanAccessEmpresa(req, empresaId, rotina = 'iac-monitor-whatsapp') {
    const id = Number(empresaId);
    const sess = req.session || {};
    const temEmpresa = sess.role === 'admin' || sess.empresas === 'all' ||
      (Array.isArray(sess.empresas) && sess.empresas.includes(id));
    if (!temEmpresa) return false;
    if (!sistemasDb.hasCompanySystem(id, 'ia-command')) return false;
    if (sess.role === 'admin') return true;
    if (!sistemasDb.hasUserSystem(sess.user_id, id, 'ia-command')) return false;
    const rotinas = permissoesDb.getRotinas(sess.user_id, id);
    return Array.isArray(rotinas) && rotinas.includes(rotina);
  }

  function resolveChannel(req, { createDefault = true } = {}) {
    const empresaId = eid(req);
    const channelId = req.body?.channel_id || req.query?.channel_id || null;

    if (channelId) {
      const channel = channels.buscarCanalDaEmpresa(String(channelId), empresaId);
      return channel
        ? { empresaId, channel }
        : { empresaId, error: 'Canal WhatsApp nao encontrado para esta empresa.' };
    }

    const channel = createDefault
      ? channels.ensureDefaultForEmpresa(empresaId)
      : channels.getDefaultForEmpresa(empresaId);
    return { empresaId, channel };
  }

  function emitToChannelCompanies(channelId, event, payload) {
    channels.listarEmpresasDoCanal(channelId)
      .forEach(empresa => io.to(`emp_${empresa.empresa_id}`).emit(event, payload));
  }

  function wireEvents(svc, channel) {
    if (svc._wired) return;
    svc._wired = true;

    svc.on('iac-log',    entry => emitToChannelCompanies(channel.id, 'iac-log', entry));
    svc.on('iac-status', data  => emitToChannelCompanies(channel.id, 'iac-status', data));
    svc.on('iac-qr',     url   => emitToChannelCompanies(channel.id, 'iac-qr', url));
    svc.on('iac-msg',    data  => emitToChannelCompanies(channel.id, 'iac-msg', data));
    svc.on('iac-intent', data  => emitToChannelCompanies(channel.id, 'iac-intent', data));

    svc.on('iac-status', ({ status }) => {
      try {
        const db = require('../database').getDB();
        const agora = new Date().toISOString();
        for (const empresa of channels.listarEmpresasDoCanal(channel.id)) {
          const empresaId = empresa.empresa_id;
          const existing = db.prepare('SELECT empresa_id FROM whatsapp_sessions WHERE empresa_id = ?').get(empresaId);
          if (existing) {
            db.prepare(`
              UPDATE whatsapp_sessions
              SET status = ?, atualizado_em = ?,
                  conectado_em = CASE WHEN ? = 'connected' THEN ? ELSE conectado_em END,
                  desconectado_em = CASE WHEN ? = 'stopped' THEN ? ELSE desconectado_em END
              WHERE empresa_id = ?
            `).run(status, agora, status, agora, status, agora, empresaId);
          } else {
            db.prepare('INSERT INTO whatsapp_sessions (empresa_id, status, atualizado_em) VALUES (?, ?, ?)')
              .run(empresaId, status, agora);
          }
        }
      } catch (_) {}
    });
  }

  app.get('/api/ia-command/whatsapp/channels', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const empresaId = eid(req);
    const rows = channels.listarPorEmpresa(empresaId);
    res.json(rows.length ? rows : [channels.ensureDefaultForEmpresa(empresaId)]);
  });

  app.get('/api/ia-command/admin/canais-whatsapp', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const empresaId = eid(req);
    const rows = channels.listarPorEmpresa(empresaId);
    res.json(rows.length ? rows : [channels.ensureDefaultForEmpresa(empresaId)]);
  });

  app.get('/api/ia-command/admin/canais-whatsapp/:id', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const channel = channels.buscarCanalDaEmpresa(req.params.id, eid(req));
    if (!channel) return res.status(404).json({ error: 'Canal WhatsApp nao encontrado para esta empresa.' });
    res.json(channel);
  });

  app.post('/api/ia-command/admin/canais-whatsapp', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const empresaId = eid(req);
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Campo obrigatorio: nome.' });
    const channel = channels.criarCanal({ nome, numero: req.body?.numero || '', ativo: req.body?.ativo !== false });
    channels.vincularEmpresa(channel.id, empresaId, {
      aliases: req.body?.aliases || null,
      padrao: channels.listarPorEmpresa(empresaId).length ? 0 : 1,
    });
    res.status(201).json(channels.buscarCanalDaEmpresa(channel.id, empresaId));
  });

  app.put('/api/ia-command/admin/canais-whatsapp/:id', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const empresaId = eid(req);
    const existing = channels.buscarCanalDaEmpresa(req.params.id, empresaId);
    if (!existing) return res.status(404).json({ error: 'Canal WhatsApp nao encontrado para esta empresa.' });
    if (req.body?.nome !== undefined && !String(req.body.nome || '').trim()) {
      return res.status(400).json({ error: 'Campo obrigatorio: nome.' });
    }
    channels.atualizarCanal(req.params.id, {
      nome: req.body?.nome,
      numero: req.body?.numero,
      ativo: req.body?.ativo,
    });
    channels.vincularEmpresa(req.params.id, empresaId, {
      aliases: req.body?.aliases ?? existing.aliases,
      padrao: req.body?.padrao !== undefined ? Number(req.body.padrao) : existing.padrao,
      ativo: 1,
    });
    res.json(channels.buscarCanalDaEmpresa(req.params.id, empresaId));
  });

  app.delete('/api/ia-command/admin/canais-whatsapp/:id', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const empresaId = eid(req);
    const channel = channels.buscarCanalDaEmpresa(req.params.id, empresaId);
    if (!channel) return res.status(404).json({ error: 'Canal WhatsApp nao encontrado para esta empresa.' });
    if (channel.empresas.length <= 1) channels.desativarCanal(channel.id);
    else channels.desvincularEmpresa(channel.id, empresaId);
    res.json({ ok: true });
  });

  app.post('/api/ia-command/admin/canais-whatsapp/:id/empresas', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const origemEmpresaId = eid(req);
    const channel = channels.buscarCanalDaEmpresa(req.params.id, origemEmpresaId);
    if (!channel) return res.status(404).json({ error: 'Canal WhatsApp nao encontrado para esta empresa.' });
    const targetEmpresaId = Number(req.body?.target_empresa_id || req.body?.empresa_destino_id || req.body?.empresa_id || 0);
    if (!targetEmpresaId) return res.status(400).json({ error: 'empresa_id e obrigatorio.' });
    if (!userCanAccessEmpresa(req, targetEmpresaId, 'iac-admin-canais-whatsapp')) {
      return res.status(403).json({ error: 'Usuario sem permissao para administrar canais na empresa de destino.' });
    }
    channels.vincularEmpresa(channel.id, targetEmpresaId, {
      aliases: req.body?.aliases || null,
      padrao: channels.listarPorEmpresa(targetEmpresaId).length ? 0 : 1,
    });
    res.json(channels.buscarCanalDaEmpresa(channel.id, origemEmpresaId));
  });

  app.put('/api/ia-command/admin/canais-whatsapp/:id/empresas/:empresaId', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const origemEmpresaId = eid(req);
    const targetEmpresaId = Number(req.params.empresaId || 0);
    const channel = channels.buscarCanalDaEmpresa(req.params.id, origemEmpresaId);
    if (!channel) return res.status(404).json({ error: 'Canal WhatsApp nao encontrado para esta empresa.' });
    if (!userCanAccessEmpresa(req, targetEmpresaId, 'iac-admin-canais-whatsapp')) {
      return res.status(403).json({ error: 'Usuario sem permissao para administrar canais na empresa de destino.' });
    }
    channels.vincularEmpresa(channel.id, targetEmpresaId, {
      aliases: req.body?.aliases || null,
      padrao: req.body?.padrao ? 1 : 0,
      ativo: 1,
    });
    res.json(channels.buscarCanalDaEmpresa(channel.id, origemEmpresaId));
  });

  app.delete('/api/ia-command/admin/canais-whatsapp/:id/empresas/:empresaId', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const origemEmpresaId = eid(req);
    const targetEmpresaId = Number(req.params.empresaId || 0);
    const channel = channels.buscarCanalDaEmpresa(req.params.id, origemEmpresaId);
    if (!channel) return res.status(404).json({ error: 'Canal WhatsApp nao encontrado para esta empresa.' });
    if (channel.empresas.length <= 1) return res.status(400).json({ error: 'Nao e possivel remover o ultimo vinculo do canal. Exclua o canal.' });
    if (!userCanAccessEmpresa(req, targetEmpresaId, 'iac-admin-canais-whatsapp')) {
      return res.status(403).json({ error: 'Usuario sem permissao para administrar canais na empresa de destino.' });
    }
    channels.desvincularEmpresa(channel.id, targetEmpresaId);
    res.json(channels.buscarCanalDaEmpresa(channel.id, origemEmpresaId));
  });

  app.post('/api/ia-command/whatsapp/channels', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const empresaId = eid(req);
    const nome = String(req.body?.nome || '').trim() || `WhatsApp Empresa ${empresaId}`;
    const channel = channels.criarCanal({ nome, numero: req.body?.numero || '' });
    channels.vincularEmpresa(channel.id, empresaId, { padrao: channels.listarPorEmpresa(empresaId).length ? 0 : 1 });
    res.status(201).json(channels.buscarCanalDaEmpresa(channel.id, empresaId));
  });

  app.post('/api/ia-command/whatsapp/channels/:id/empresas', requireAuth, requireIaCommand, canAdminCanais, (req, res) => {
    const origemEmpresaId = eid(req);
    const channel = channels.buscarCanalDaEmpresa(req.params.id, origemEmpresaId);
    if (!channel) return res.status(404).json({ error: 'Canal WhatsApp nao encontrado para esta empresa.' });

    const targetEmpresaId = Number(req.body?.target_empresa_id || req.body?.empresa_destino_id || req.body?.empresa_id || 0);
    if (!targetEmpresaId) return res.status(400).json({ error: 'empresa_id e obrigatorio.' });
    if (!userCanAccessEmpresa(req, targetEmpresaId, 'iac-admin-canais-whatsapp')) {
      return res.status(403).json({ error: 'Usuario sem acesso a empresa de destino.' });
    }

    channels.vincularEmpresa(channel.id, targetEmpresaId, {
      aliases: req.body?.aliases || null,
      padrao: channels.listarPorEmpresa(targetEmpresaId).length ? 0 : 1,
    });
    res.json(channels.buscarCanalDaEmpresa(channel.id, origemEmpresaId));
  });

  app.post('/api/ia-command/whatsapp/start', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const { empresaId, channel, error } = resolveChannel(req);
    if (error) return res.status(404).json({ error });
    if (!channel) return res.status(400).json({ error: 'Nenhum canal WhatsApp vinculado a esta empresa.' });

    const svc = manager.getOrCreate(channel.id);
    wireEvents(svc, channel);
    svc.start({ empresaId, channel });
    res.json({ ok: true, channel });
  });

  app.post('/api/ia-command/whatsapp/stop', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const { channel, error } = resolveChannel(req, { createDefault: false });
    if (error) return res.status(404).json({ error });
    const svc = channel ? manager.get(channel.id) : null;
    if (svc) svc.stop();
    res.json({ ok: true });
  });

  app.post('/api/ia-command/whatsapp/disconnect', requireAuth, requireIaCommand, canMonitorWhatsapp, async (req, res) => {
    const { channel, error } = resolveChannel(req, { createDefault: false });
    if (error) return res.status(404).json({ error });
    if (!channel) return res.status(400).json({ error: 'Nenhum canal WhatsApp vinculado a esta empresa.' });
    const svc = manager.getOrCreate(channel.id);
    wireEvents(svc, channel);
    await svc.disconnectSession(channel.auth_client_id || `iac_ch_${channel.id}`);
    res.json({ ok: true });
  });

  app.get('/api/ia-command/whatsapp/status', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const { empresaId, channel, error } = resolveChannel(req);
    if (error) return res.status(404).json({ error });
    const svc = channel ? manager.get(channel.id) : null;
    res.json({
      status: svc?.getStatus() || 'stopped',
      qr: svc?.getQr() || null,
      msgCount: svc?.getMsgCount() || 0,
      empresa_id: empresaId,
      channel,
    });
  });

  app.post('/api/ia-command/whatsapp/send-test', requireAuth, requireIaCommand, canMonitorWhatsapp, async (req, res) => {
    const { numero, mensagem } = req.body || {};
    if (!numero) return res.status(400).json({ error: 'Campo "numero" e obrigatorio.' });

    const { channel, error } = resolveChannel(req, { createDefault: false });
    if (error) return res.status(404).json({ error });
    const svc = channel ? manager.get(channel.id) : null;
    if (!svc || svc.getStatus() !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp nao esta conectado.' });
    }

    try {
      await svc.sendMessage(numero, mensagem || '✅ *IA Command* - Teste de envio realizado com sucesso!');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/whatsapp/clear-logs', requireAuth, requireIaCommand, canMonitorWhatsapp, (req, res) => {
    const { channel } = resolveChannel(req, { createDefault: false });
    const svc = channel ? manager.get(channel.id) : null;
    if (svc) svc.clearBuffer();
    res.json({ ok: true });
  });
};
