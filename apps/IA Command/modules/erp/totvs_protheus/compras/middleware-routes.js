'use strict';

const { getDB }        = require('../../../database');
const { requireRotina } = require('../../../permissions');
const { getEmpresaId } = require('../../../empresa-context');
const connectionFactory = require('../../providers/connection-factory');
const { baseTabelaSX2, campoFilialBase } = require('../SX/sx2-sql-normalizer');

// connectionFactory.carregarConexao retorna a linha real de `connections` (campo
// `id`) quando a conexão é direta, mas monta um objeto sintético sem `id` quando
// o Agente Local/API Proxy está ativo — nesse caso o id real vem em `_connection_id`
// (ver connection-factory.js::_montarApiProxy). protheus_company_tree/profile
// sempre guardam o `id` real de `connections`, então é isso que precisamos aqui.
function _resolverConnectionIdProtheus(empresaId) {
  const conn = connectionFactory.carregarConexao(empresaId, { sistemaOrigem: 'protheus' });
  const connectionId = conn.id || conn._connection_id;
  if (!connectionId) throw new Error('Não foi possível resolver o ID da conexão Protheus desta empresa.');
  return connectionId;
}

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
          // empresa_codigo: qual codigo de empresa (dentro do grupo, ex 01/02) este
          // cadastro do IAHub representa na hierarquia SYS_COMPANY importada.
          // So relevante quando modelo_dados=LOBO_GUARA e o mecanismo novo (hierarquia)
          // esta em uso — mecanismo antigo (tenant_id/campo_empresa) continua funcionando
          // sem isso, como legado.
          empresa_codigo:    String(cfg.empresa_codigo || '').trim(),
          tabelas_bloqueadas: _normalizarLista(cfg.tabelas_bloqueadas),
          campos_sensiveis:   _normalizarLista(cfg.campos_sensiveis),
          limite_registros:  Math.min(Math.max(parseInt(cfg.limite_registros) || 10000, 100), 50000),
          timeout_ms:        Math.min(Math.max(parseInt(cfg.timeout_ms) || 30000, 5000), 300000),
        };

        // Nao exige tenant_id/empresa_codigo no momento de salvar: no primeiro cadastro
        // LOBO_GUARA nenhum dos dois existe ainda — empresa_codigo so fica disponivel
        // depois de importar a hierarquia nas telas de Dicionario SYS_COMPANY/
        // SYS_COMPANY_CFG, que por sua vez exigem modelo_dados=LOBO_GUARA ja salvo.
        // Bloquear aqui criaria um ciclo sem saida no primeiro cadastro.

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

  // GET — empresas distintas já presentes na hierarquia importada (para o select
  // "Empresa desta conexão" da tela de Middleware). A importação em si acontece
  // nas telas dedicadas de Dicionário SYS_COMPANY / SYS_COMPANY_CFG.
  app.get('/api/ia-command/compras/company-empresas',
    requireAuth, requireIaCommand, canMiddleware,
    (req, res) => {
      try {
        const connectionId = _resolverConnectionIdProtheus(eid(req));
        const db = getDB();
        // Preferência: nó 'empresa' (vem de SYS_COMPANY_CFG, nome correto e único
        // por empresa). Se SYS_COMPANY_CFG não foi importada, cai para o código de
        // empresa já presente nas filiais (SYS_COMPANY sozinha) — nesse caso não há
        // nome de empresa isolado, então usa o próprio código como rótulo.
        let rows = db.prepare(`
          SELECT DISTINCT empresa_codigo, nome
            FROM protheus_company_tree
           WHERE connection_id = ? AND tipo_no = 'empresa' AND empresa_codigo IS NOT NULL
           ORDER BY empresa_codigo
        `).all(connectionId);
        if (!rows.length) {
          rows = db.prepare(`
            SELECT DISTINCT empresa_codigo, NULL AS nome
              FROM protheus_company_tree
             WHERE connection_id = ? AND tipo_no = 'filial' AND empresa_codigo IS NOT NULL
             ORDER BY empresa_codigo
          `).all(connectionId);
        }
        res.json(rows);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }
  );

  // GET — status do perfil de validacao (protheus_company_profile) desta
  // conexao, mais dados para PRE-PREENCHER a tela de Validar (grupo_codigo ja
  // conhecido pela arvore importada + sugestao de tabela/campo a partir do
  // primeiro registro SX2 com modo Exclusivo). Nunca decide sozinho, so
  // sugere — quem confirma a validacao continua sendo o usuario na tela
  // dedicada (SYS_COMPANY_CFG > Validar). Ver lobo-guara-filial-resolver.js::
  // contextoLoboGuara — e essa mesma linha de protheus_company_profile que
  // decide se o Lobo Guara aplica filtro (falha fechada sem ela).
  app.get('/api/ia-command/compras/company-profile',
    requireAuth, requireIaCommand, canMiddleware,
    (req, res) => {
      try {
        const connectionId = _resolverConnectionIdProtheus(eid(req));
        const db = getDB();
        const perfil = db.prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(connectionId);

        const grupos = db.prepare(`
          SELECT DISTINCT grupo_codigo FROM protheus_company_tree
           WHERE connection_id = ? AND grupo_codigo IS NOT NULL
           ORDER BY grupo_codigo
        `).all(connectionId).map(r => r.grupo_codigo);

        const sx2Exclusiva = db.prepare(`
          SELECT arquivo FROM protheus_sx2
           WHERE connection_id = ? AND modo = 'E'
           ORDER BY chave LIMIT 1
        `).get(connectionId);
        const sugestao = sx2Exclusiva
          ? { tabela: sx2Exclusiva.arquivo, campo_filial: campoFilialBase(baseTabelaSX2(sx2Exclusiva.arquivo)) }
          : null;

        res.json({
          validated: Boolean(perfil?.validated),
          connection_id: connectionId,
          grupos_disponiveis: grupos,
          grupo_sugerido: grupos.length === 1 ? grupos[0] : null,
          sugestao_validacao: sugestao,
        });
      } catch (e) {
        res.status(400).json({ error: e.message });
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
