'use strict';

/**
 * Novos endpoints REST para gerenciamento de canais WhatsApp como Windows Services.
 * Montado em routes.js via: require('./windows-service/service-routes')(app, { requireAuth, requireIaCommand, io })
 *
 * NÃO toca nos endpoints existentes (/start, /stop, /status, etc.).
 * Opera exclusivamente em canais com is_windows_service = 1.
 */

const http       = require('http');
const nssm       = require('./nssm-manager');
const channels   = require('../channel-store');
const { requireRotina } = require('../../permissions');

// Porta base para alocação automática de workers (3101, 3102, ...)
const WORKER_PORT_BASE = 3101;
const WORKER_TOKEN     = process.env.IAC_HUB_INTERNAL_TOKEN || '';

module.exports = function registrarRotasWindowsService(app, { requireAuth, requireIaCommand, io }) {

  const canMonitor = requireRotina('iac-monitor-whatsapp');
  const canAdmin   = requireRotina('iac-admin-canais-whatsapp');

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _proximo_port(canaisWS) {
    const usadas = new Set(canaisWS.map(c => c.worker_port).filter(Boolean));
    let porta = WORKER_PORT_BASE;
    while (usadas.has(porta)) porta++;
    return porta;
  }

  async function _workerHealth(workerPort) {
    return new Promise((resolve) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: workerPort, path: '/health', method: 'GET', timeout: 2000 },
        (res) => {
          let body = '';
          res.on('data', d => { body += d; });
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  async function _workerBuffer(workerPort) {
    return new Promise((resolve) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: workerPort, path: '/buffer', method: 'GET', timeout: 3000 },
        (res) => {
          let body = '';
          res.on('data', d => { body += d; });
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (_) { resolve({ buffer: [] }); }
          });
        }
      );
      req.on('error', () => resolve({ buffer: [] }));
      req.on('timeout', () => { req.destroy(); resolve({ buffer: [] }); });
      req.end();
    });
  }

  async function _workerCommand(workerPort, cmd) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ cmd });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: workerPort,
          path: '/command',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: 5000,
        },
        (res) => {
          let b = '';
          res.on('data', d => { b += d; });
          res.on('end', () => {
            try { resolve(JSON.parse(b)); } catch (_) { resolve({}); }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }

  function _statusConsolidado(nssmStatus, workerAlive) {
    if (nssmStatus === 'not_installed')    return 'sem_servico';
    if (nssmStatus === 'SERVICE_RUNNING')  return workerAlive ? 'connected' : 'starting';
    if (nssmStatus === 'SERVICE_STOPPED')  return 'stopped';
    if (nssmStatus === 'SERVICE_PAUSED')   return 'stopped'; // NSSM pausa quando processo filho morre rápido
    return 'unknown';
  }

  // ── GET /api/ia-command/whatsapp/services/status ──────────────────────────
  // Retorna TODOS os canais ativos — com ou sem serviço Windows instalado.

  app.get('/api/ia-command/whatsapp/services/status', requireAuth, requireIaCommand, canMonitor, async (req, res) => {
    try {
      const todosCanais = channels.listarTodosCanais()
        .filter(canal => channels.listarEmpresasDoCanal(canal.id).length > 0);

      const resultado = await Promise.all(
        todosCanais.map(async (canal) => {
          const slug       = canal.service_slug || nssm.slugDoCanal(canal.id, canal.nome);
          const empresas   = channels.listarEmpresasDoCanal(canal.id);

          // Canais sem is_windows_service=1 aparecem como "sem_servico" sem consultar NSSM
          if (!canal.is_windows_service) {
            return {
              id:           canal.id,
              nome:         canal.nome,
              numero:       canal.numero || '',
              slug,
              service_name: nssm.nomeServico(slug),
              worker_port:  canal.worker_port,
              status:       'sem_servico',
              nssm_status:  'not_installed',
              worker_alive: false,
              worker_pid:   null,
              worker_uptime: null,
              empresas:     empresas.map(e => ({ empresa_id: e.empresa_id, padrao: e.padrao, nome: e.nome })),
            };
          }

          const nssmStatus  = nssm.statusServico(slug);
          const health      = canal.worker_port && nssmStatus === 'SERVICE_RUNNING'
            ? await _workerHealth(canal.worker_port)
            : null;
          const workerAlive = health !== null;
          const status      = _statusConsolidado(nssmStatus, workerAlive);

          return {
            id:           canal.id,
            nome:         canal.nome,
            numero:       canal.numero || '',
            slug,
            service_name: nssm.nomeServico(slug),
            worker_port:  canal.worker_port,
            status,
            nssm_status:  nssmStatus,
            worker_alive: workerAlive,
            worker_pid:   health?.pid || null,
            worker_uptime: health?.uptime || null,
            empresas:     empresas.map(e => ({
              empresa_id: e.empresa_id,
              padrao:     e.padrao,
              nome:       e.nome,
            })),
          };
        })
      );

      res.json({ canais: resultado });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/ia-command/whatsapp/services/install ────────────────────────

  app.post('/api/ia-command/whatsapp/services/install', requireAuth, requireIaCommand, canAdmin, async (req, res) => {
    const { channel_id } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id obrigatório.' });

    try {
      const canal = channels.buscarCanal(channel_id);
      if (!canal) return res.status(404).json({ error: 'Canal não encontrado.' });

      const todosCanaisWS = channels.listarTodosCanais().filter(c => c.is_windows_service);
      const porta         = canal.worker_port || _proximo_port(todosCanaisWS);
      const slug          = canal.service_slug || nssm.slugDoCanal(canal.id, canal.nome);

      const resultado = nssm.instalarServico(canal.id, slug, porta, {
        IAC_HUB_CALLBACK_URL: `http://localhost:${process.env.PORT || 3000}/api/ia-command/whatsapp/worker-event`,
        IAC_HUB_INTERNAL_TOKEN: WORKER_TOKEN,
      });

      // Persiste slug e porta no banco
      channels.atualizarCanalWindowsService(canal.id, { slug, porta, is_windows_service: 1 });

      res.json({ ok: true, ...resultado, slug, worker_port: porta });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/ia-command/whatsapp/services/start ──────────────────────────

  app.post('/api/ia-command/whatsapp/services/start', requireAuth, requireIaCommand, canMonitor, async (req, res) => {
    const { channel_id } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id obrigatório.' });

    try {
      const canal = channels.buscarCanal(channel_id);
      if (!canal) return res.status(404).json({ error: 'Canal não encontrado.' });
      if (!canal.is_windows_service) return res.status(400).json({ error: 'Canal não configurado como Windows Service.' });

      const slug = canal.service_slug || nssm.slugDoCanal(canal.id, canal.nome);
      const porta = canal.worker_port;
      if (!porta) return res.status(400).json({ error: 'Canal sem porta worker configurada. Execute /install primeiro.' });

      const resultado = nssm.iniciarServico(canal.id, slug, porta, {
        IAC_HUB_CALLBACK_URL: `http://localhost:${process.env.PORT || 3000}/api/ia-command/whatsapp/worker-event`,
        IAC_HUB_INTERNAL_TOKEN: WORKER_TOKEN,
      });

      res.json({ ok: true, ...resultado });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/ia-command/whatsapp/services/stop ───────────────────────────

  app.post('/api/ia-command/whatsapp/services/stop', requireAuth, requireIaCommand, canMonitor, async (req, res) => {
    const { channel_id } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id obrigatório.' });

    try {
      const canal = channels.buscarCanal(channel_id);
      if (!canal) return res.status(404).json({ error: 'Canal não encontrado.' });

      const slug = canal.service_slug || nssm.slugDoCanal(canal.id, canal.nome);

      // Sinaliza ao worker para encerrar graciosamente antes do NSSM matar o processo
      if (canal.worker_port) {
        try { await _workerCommand(canal.worker_port, 'stop'); } catch (_) {}
        await _sleep(1500);
      }

      const resultado = nssm.pararServico(slug);

      // Emite log e status de parada via Socket.IO
      const empresas = channels.listarEmpresasDoCanal(canal.id);
      const logPayload = { tipo: 'warning', msg: `Serviço parado pelo operador.` };
      const statusPayload = { channelId: canal.id, status: 'stopped' };
      for (const emp of empresas) { io.to(`emp_${emp.empresa_id}`).emit('iac-log', logPayload); }
      io.to(`channel_${canal.id}`).emit('iac-log', logPayload);
      io.to(`channel_${canal.id}`).emit('iac-status', statusPayload);

      res.json({ ok: true, ...resultado });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/ia-command/whatsapp/services/remove ────────────────────────

  app.post('/api/ia-command/whatsapp/services/remove', requireAuth, requireIaCommand, canAdmin, async (req, res) => {
    const { channel_id } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id obrigatório.' });

    try {
      const canal = channels.buscarCanal(channel_id);
      if (!canal) return res.status(404).json({ error: 'Canal não encontrado.' });

      const slug = canal.service_slug || nssm.slugDoCanal(canal.id, canal.nome);
      const resultado = nssm.removerServico(slug);

      // Remove flag is_windows_service do banco (canal volta ao modo legado)
      channels.atualizarCanalWindowsService(canal.id, { slug: null, porta: null, is_windows_service: 0 });

      res.json({ ok: true, ...resultado });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/ia-command/whatsapp/services/get-qr ────────────────────────
  // Solicita o QR atual do worker e repassa via Socket.IO

  app.post('/api/ia-command/whatsapp/services/get-qr', requireAuth, requireIaCommand, canMonitor, async (req, res) => {
    const { channel_id } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id obrigatório.' });

    try {
      const canal = channels.buscarCanal(channel_id);
      if (!canal || !canal.worker_port) return res.status(400).json({ error: 'Canal sem worker configurado.' });

      const resultado = await _workerCommand(canal.worker_port, 'get-qr');
      res.json({ ok: true, ...resultado });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/ia-command/whatsapp/services/reconnect ─────────────────────
  // Força reconexão do worker (gera novo QR se sessão expirou)

  app.post('/api/ia-command/whatsapp/services/reconnect', requireAuth, requireIaCommand, canMonitor, async (req, res) => {
    const { channel_id } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id obrigatório.' });

    try {
      const canal = channels.buscarCanal(channel_id);
      if (!canal || !canal.worker_port) return res.status(400).json({ error: 'Canal sem worker configurado.' });

      const resultado = await _workerCommand(canal.worker_port, 'reconnect');
      res.json({ ok: true, ...resultado });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/ia-command/whatsapp/services/:channelId/buffer ──────────────
  // Replay de logs ao vivo ao reconectar o frontend.

  app.get('/api/ia-command/whatsapp/services/:channelId/buffer', requireAuth, requireIaCommand, canMonitor, async (req, res) => {
    try {
      const canal = channels.buscarCanal(req.params.channelId);
      if (!canal || !canal.worker_port) return res.json({ buffer: [] });

      const dados = await _workerBuffer(canal.worker_port);
      res.json(dados);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
