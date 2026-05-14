const db = require('./database');

module.exports = function registerRoutes(app, { requireAuth }) {

  // ── Listar ─────────────────────────────────────────────────────────────────
  app.get('/api/usuarios', requireAuth, (req, res) => {
    res.json(db.listar());
  });

  // ── Buscar por ID ──────────────────────────────────────────────────────────
  app.get('/api/usuarios/:id', requireAuth, (req, res) => {
    const u = db.buscarPorId(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(u);
  });

  // ── Criar ──────────────────────────────────────────────────────────────────
  app.post('/api/usuarios', requireAuth, async (req, res) => {
    const { nome, usuario, senha, celular, email, role, empresas } = req.body || {};

    if (!nome?.trim())    return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!usuario?.trim()) return res.status(400).json({ error: 'Usuário é obrigatório' });
    if (!senha?.trim())   return res.status(400).json({ error: 'Senha é obrigatória' });

    // Validação força de senha: mínimo 8 chars, maiúscula, minúscula, número
    if (!validarSenha(senha)) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula e número',
      });
    }

    try {
      const novo = await db.criar({
        nome:     nome.trim(),
        usuario:  usuario.trim().toLowerCase(),
        senha,
        celular:  (celular  || '').trim(),
        email:    (email    || '').trim(),
        role:     role === 'admin' ? 'admin' : 'usuario',
        empresas: role === 'admin' ? 'all' : (Array.isArray(empresas) ? empresas : []),
        ativo:    true,
      });
      res.status(201).json(novo);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Atualizar ──────────────────────────────────────────────────────────────
  app.put('/api/usuarios/:id', requireAuth, async (req, res) => {
    const { nome, usuario, senha, celular, email, role, empresas, ativo } = req.body || {};

    if (!nome?.trim())    return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!usuario?.trim()) return res.status(400).json({ error: 'Usuário é obrigatório' });

    if (senha && !validarSenha(senha)) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula e número',
      });
    }

    const patch = {
      nome:     nome.trim(),
      usuario:  usuario.trim().toLowerCase(),
      celular:  (celular || '').trim(),
      email:    (email   || '').trim(),
      role:     role === 'admin' ? 'admin' : 'usuario',
      empresas: role === 'admin' ? 'all' : (Array.isArray(empresas) ? empresas : []),
      ativo:    ativo !== false,
    };
    if (senha) patch.senha = senha;

    try {
      const atualizado = await db.atualizar(req.params.id, patch);
      if (!atualizado) return res.status(404).json({ error: 'Usuário não encontrado' });
      res.json(atualizado);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Alterar senha (rota dedicada) ─────────────────────────────────────────
  app.put('/api/usuarios/:id/senha', requireAuth, async (req, res) => {
    const { senha, confirmar } = req.body || {};

    if (!senha)           return res.status(400).json({ error: 'Nova senha é obrigatória' });
    if (senha !== confirmar) return res.status(400).json({ error: 'As senhas não conferem' });
    if (!validarSenha(senha)) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula e número',
      });
    }

    try {
      const atualizado = await db.atualizar(req.params.id, { senha });
      if (!atualizado) return res.status(404).json({ error: 'Usuário não encontrado' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Excluir ────────────────────────────────────────────────────────────────
  app.delete('/api/usuarios/:id', requireAuth, (req, res) => {
    // Protege o usuário da sessão atual
    if (Number(req.params.id) === req.session.user_id) {
      return res.status(400).json({ error: 'Não é possível excluir o usuário logado' });
    }
    const ok = db.excluir(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ ok: true });
  });

};

function validarSenha(senha) {
  return senha.length >= 8 &&
    /[A-Z]/.test(senha) &&
    /[a-z]/.test(senha) &&
    /[0-9]/.test(senha);
}
