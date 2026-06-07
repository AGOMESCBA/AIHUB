const { getDB } = require('./database');
const { requireRotina } = require('./permissions');
const { requireEmpresaContext } = require('./empresa-context');

module.exports = function registrarRotas(app, { requireAuth, requireIaCommand, io }) {
  const canDashboard = requireRotina('iac-dashboard');

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
  require('./erp/compras/middleware-routes')(app, { requireAuth, requireIaCommand });

  // Rotas do dicionário SX2 do Protheus
  require('./erp/SX/sx2-routes')(app, { requireAuth, requireIaCommand });
  require('./erp/SX/sx3-routes')(app, { requireAuth, requireIaCommand });

  // Rotas do painel administrativo (intenções, datasets, logs)
  require('./admin-routes')(app, { requireAuth, requireIaCommand });

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
