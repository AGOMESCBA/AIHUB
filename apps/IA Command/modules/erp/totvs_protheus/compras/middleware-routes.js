'use strict';

const { getDB }        = require('../../../database');
const { requireRotina } = require('../../../permissions');
const { getEmpresaId } = require('../../../empresa-context');

module.exports = function registrar(app, { requireAuth, requireIaCommand }) {
  const canMiddleware = requireRotina('iac-config-middleware');
  const eid = req => getEmpresaId(req);

  // GET — carregar configuração do middleware para a empresa
  app.get('/api/ia-command/compras/middleware-config',
    requireAuth, requireIaCommand, canMiddleware,
    (req, res) => {
      try {
        const row = getDB().prepare(
          "SELECT config FROM erp_config WHERE empresa_id = ? AND erp = 'protheus' AND connection_id IS NULL ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1"
        ).get(eid(req));
        res.json(row?.config ? JSON.parse(row.config) : {});
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // PUT — salvar configuração do middleware
  app.put('/api/ia-command/compras/middleware-config',
    requireAuth, requireIaCommand, canMiddleware,
    (req, res) => {
      try {
        const db        = getDB();
        const empresaId = eid(req);
        const cfg       = req.body || {};

        // Sanitizar valores numéricos e booleanos
        const configSalvar = {
          modelo_dados:      String(cfg.modelo_dados || 'TRADICIONAL'),
          tenant_id:         String(cfg.tenant_id    || '').trim(),
          campo_empresa:     String(cfg.campo_empresa || '').trim(),
          campo_filial:      String(cfg.campo_filial  || '').trim(),
          tabelas_bloqueadas: _normalizarLista(cfg.tabelas_bloqueadas),
          campos_sensiveis:   _normalizarLista(cfg.campos_sensiveis),
          limite_registros:  Math.min(Math.max(parseInt(cfg.limite_registros) || 10000, 100), 50000),
          timeout_ms:        Math.min(Math.max(parseInt(cfg.timeout_ms) || 30000, 5000), 300000),
        };

        if (configSalvar.modelo_dados === 'LOBO_GUARA' && !configSalvar.tenant_id) {
          return res.status(400).json({ error: 'tenant_id e obrigatorio para o modelo LOBO_GUARA.' });
        }

        const now      = new Date().toISOString();
        const existing = db.prepare(
          "SELECT id FROM erp_config WHERE empresa_id = ? AND erp = 'protheus' AND connection_id IS NULL ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1"
        ).get(empresaId);

        if (existing) {
          db.prepare(
            "UPDATE erp_config SET config = ?, atualizado_em = ? WHERE id = ?"
          ).run(JSON.stringify(configSalvar), now, existing.id);
        } else {
          const id = require('crypto').randomUUID
            ? require('crypto').randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
          db.prepare(
            "INSERT INTO erp_config (id, connection_id, empresa_id, erp, config, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)"
          ).run(id, null, empresaId, 'protheus', JSON.stringify(configSalvar), now, now);
        }

        res.json({ ok: true });
      } catch (e) {
        console.error('[MiddlewareRoutes] Erro ao salvar config:', e.message);
        res.status(500).json({ error: e.message });
      }
    }
  );
  // POST — testar middleware com SQL personalizado (sem executar no ERP)
  app.post('/api/ia-command/compras/middleware-test',
    requireAuth, requireIaCommand, canMiddleware,
    (req, res) => {
      try {
        const { sql, cfg } = req.body || {};
        if (!sql) return res.status(400).json({ error: 'Informe o campo sql.' });
        const sqlMiddleware = require('./sql-middleware');
        const resultado = sqlMiddleware.processar(sql, cfg || {});
        res.json(resultado);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );
};

function _normalizarLista(valor) {
  if (!valor) return '[]';
  if (Array.isArray(valor)) return JSON.stringify(valor.filter(Boolean));
  if (typeof valor === 'string') {
    try { JSON.parse(valor); return valor; } catch (_) {}
    return JSON.stringify(valor.split(',').map(s => s.trim()).filter(Boolean));
  }
  return '[]';
}
