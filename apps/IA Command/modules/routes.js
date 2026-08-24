const { getDB } = require('./database');
const { requireRotina } = require('./permissions');
const { requireEmpresaContext } = require('./empresa-context');
const channels = require('./whatsapp/channel-store');
const { alertarEventoWorkerWhatsapp } = require('./whatsapp/operational-alerts');

const WORKER_TOKEN = process.env.IAC_HUB_INTERNAL_TOKEN || '';

module.exports = function registrarRotas(app, { requireAuth, requireIaCommand, io }) {
  const canDashboard = requireRotina('iac-dashboard');

  // IMPORTANTE: worker-event é chamado pelo processo Windows Service (sem sessão de usuário).
  // Deve ser registrado ANTES do app.use que aplica requireAuth a todo /api/ia-command/*.
  // Segurança via X-Worker-Token (token de segredo), não via sessão de usuário.
  app.post('/api/ia-command/whatsapp/worker-event', (req, res) => {
    if (WORKER_TOKEN && req.headers['x-worker-token'] !== WORKER_TOKEN) {
      return res.status(401).json({ error: 'Token inválido.' });
    }
    const { channelId, event, payload } = req.body || {};
    if (!channelId || !event) return res.status(400).json({ error: 'channelId e event obrigatórios.' });
    try {
      const enriched = payload && typeof payload === 'object' ? { ...payload, channelId } : payload;
      const canal = channels.buscarCanal(channelId);
      const empresas = channels.listarEmpresasDoCanal(channelId);
      for (const emp of empresas) io.to(`emp_${emp.empresa_id}`).emit(event, enriched);
      io.to(`channel_${channelId}`).emit(event, enriched);
      alertarEventoWorkerWhatsapp({ channelId, event, payload: enriched, canal }).catch(err => {
        process.stdout.write(`[${new Date().toISOString()}] [WARN] Alerta worker WhatsApp falhou: ${err.message}\n`);
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // IMPORTANTE: canal Protheus WhatsApp e chamado pela rotina ADVPL (servidor-a-
  // servidor) e pelo TWebEngine embutido no Protheus (sem sessao de usuario do
  // IAHub). Deve ser registrado ANTES do app.use que aplica requireAuth a todo
  // /api/ia-command/*. Autenticacao propria via IAC_PROTHEUS_CHAT_SECRET (emissao
  // de token) e token de sessao (demais rotas) — ver modules/protheus_whatsapp/routes.js.
  require('./protheus_whatsapp/routes')(app);

  app.use('/api/ia-command', requireAuth, requireIaCommand, requireEmpresaContext);

  // Rotas do WhatsApp
  require('./whatsapp/routes')(app, { requireAuth, requireIaCommand, io });

  // Rotas de configuração de conexões ERP
  require('./connections-routes')(app, { requireAuth, requireIaCommand });

  // Rotas de configuração de IA
  require('./ai-config-routes')(app, { requireAuth, requireIaCommand });

  // Rotas do Agente Local (cloud_extension)
  require('../cloud_extension/agente-local-routes')(app, { requireAuth, requireIaCommand });

  // Rotas do middleware SQL Protheus
  require('./erp/totvs_protheus/compras/middleware-routes')(app, { requireAuth, requireIaCommand });

  // Rotas do dicionário SX2 do Protheus
  require('./erp/totvs_protheus/SX/sx2-routes')(app, { requireAuth, requireIaCommand });
  require('./erp/totvs_protheus/SX/sx3-routes')(app, { requireAuth, requireIaCommand });

  // Rotas dos dicionários SYS_COMPANY / SYS_COMPANY_CFG (hierarquia organizacional
  // para grupos Protheus com mais de uma empresa jurídica — cenário LOBO_GUARA)
  require('./erp/totvs_protheus/SX/sys-company-routes')(app, { requireAuth, requireIaCommand });
  require('./erp/totvs_protheus/SX/sys-company-cfg-routes')(app, { requireAuth, requireIaCommand });

  // Rotas do painel administrativo (intenções, datasets, logs)
  require('./admin-routes')(app, { requireAuth, requireIaCommand });
  require('./scheduler/scheduled-question-routes')(app, { requireAuth, requireIaCommand });
  require('./scheduler/scheduled-question-executor').start();

  // Rota para geração do instalador do Agente Local
  require('./instalador-agente-routes')(app, { requireAuth, requireIaCommand });

  // Health check
  app.get('/api/ia-command/health', requireAuth, requireIaCommand, canDashboard, (req, res) => {
    try {
      const db      = getDB();
      const versoes = db.prepare('SELECT COUNT(*) as total FROM schema_migrations').get();
      res.json({
        status:    'ok',
        sistema:   'IA Command',
        versao:    '1.0.0',
        migracoes: versoes.total,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ status: 'erro', mensagem: err.message });
    }
  });

  // Status resumido para o dashboard
  app.get('/api/ia-command/status', requireAuth, requireIaCommand, canDashboard, (req, res) => {
    res.json({
      fases: {
        fase1: { nome: 'Fundação + Integração IAHub',       status: 'concluida' },
        fase2: { nome: 'WhatsApp + Monitor',                status: 'concluida' },
        fase3: { nome: 'Motor IA + Primeiro Fluxo',         status: 'concluida' },
        fase4: { nome: 'Query Builders Protheus (completo)', status: 'pendente'  },
        fase5: { nome: 'Painel Administrativo',             status: 'pendente'  },
        fase6: { nome: 'Multi-ERP',                         status: 'pendente'  },
        fase7: { nome: 'Produção e Deploy',                 status: 'pendente'  },
      },
    });
  });

};
