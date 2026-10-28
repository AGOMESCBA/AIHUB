const db = require('./database');
const sistemasDb = require('../sistemas/database');
const { systemActiveFromRotinas } = require('./system-routines');
const { requireAdmin } = require('../auth');

// 2026-10-28: gravação e leitura de cadastro só para admin. Antes bastava
// estar logado — um usuário comum conseguia, chamando a API direto, criar um
// admin, se promover ou dar rotinas a si mesmo (achado na auditoria de
// segurança do IA Service). As telas que usam estas rotas já são de admin.

module.exports = function registerRoutes(app, { requireAuth }) {

  // ── Rotinas do usuário logado na empresa ativa (usado pelo sidebar) ──────────
  app.get('/api/minhas-rotinas', requireAuth, (req, res) => {
    // Admin: acesso irrestrito — retorna null como sinal de "sem filtro"
    if (req.session.role === 'admin') return res.json({ rotinas: null });

    // Aceita override via query param (MDI per-tab empresa)
    const override = Number(req.query.empresa_id || 0);
    let empresa_id = req.session.empresa_id;
    if (override && override !== empresa_id) {
      const { empresas: acesso } = req.session;
      const ok = acesso === 'all' || (Array.isArray(acesso) && acesso.includes(override));
      if (ok) empresa_id = override;
    }

    if (!empresa_id) return res.json({ rotinas: [] });

    const rotinas = db.getRotinas(req.session.user_id, empresa_id);
    // null = não configurado = bloquear tudo (regra: sem permissão = sem acesso)
    res.json({ rotinas: rotinas ?? [] });
  });

  // ── Permissões de um usuário (para a tela de edição) ─────────────────────────
  app.get('/api/permissoes/:usuarioId', requireAuth, (req, res) => {
    // O próprio usuário pode ler as suas; as dos outros, só admin.
    if (req.session.role !== 'admin' && Number(req.params.usuarioId) !== Number(req.session.user_id)) {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }
    res.json(db.getByUsuario(req.params.usuarioId));
  });

  // ── Salvar permissões de um usuário ──────────────────────────────────────────
  app.put('/api/permissoes/:usuarioId', requireAuth, requireAdmin, (req, res) => {
    const { permissoes } = req.body || {};
    if (!Array.isArray(permissoes)) {
      return res.status(400).json({ error: 'permissoes deve ser um array' });
    }
    db.salvar(req.params.usuarioId, permissoes);
    for (const permissao of permissoes) {
      sistemasDb.salvarUserSystems(
        req.params.usuarioId,
        permissao.empresa_id,
        sistemasDb.listarSystems().map(system => ({
          system_code: system.code,
          active: systemActiveFromRotinas(system.code, permissao.rotinas),
        }))
      );
    }
    res.json({ ok: true });
  });

};
