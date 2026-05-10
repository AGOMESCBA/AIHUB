const db = require('./database');

module.exports = function registerRoutes(app, { requireAuth }) {

  // ── Rotinas do usuário logado na empresa ativa (usado pelo sidebar) ──────────
  app.get('/api/minhas-rotinas', requireAuth, (req, res) => {
    // Admin: acesso irrestrito — retorna null como sinal de "sem filtro"
    if (req.session.role === 'admin') return res.json({ rotinas: null });

    const empresa_id = req.session.empresa_id;
    if (!empresa_id) return res.json({ rotinas: [] });

    const rotinas = db.getRotinas(req.session.user_id, empresa_id);
    // null = não configurado = bloquear tudo (regra: sem permissão = sem acesso)
    res.json({ rotinas: rotinas ?? [] });
  });

  // ── Permissões de um usuário (para a tela de edição) ─────────────────────────
  app.get('/api/permissoes/:usuarioId', requireAuth, (req, res) => {
    res.json(db.getByUsuario(req.params.usuarioId));
  });

  // ── Salvar permissões de um usuário ──────────────────────────────────────────
  app.put('/api/permissoes/:usuarioId', requireAuth, (req, res) => {
    const { permissoes } = req.body || {};
    if (!Array.isArray(permissoes)) {
      return res.status(400).json({ error: 'permissoes deve ser um array' });
    }
    db.salvar(req.params.usuarioId, permissoes);
    res.json({ ok: true });
  });

};
