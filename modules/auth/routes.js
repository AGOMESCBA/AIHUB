const { verificarCredenciais, requireAuth } = require('./index');
const tentativas  = require('./tentativas');
const { registrarAuditoria } = require('./database');

function obterIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'desconhecido';
}

module.exports = function registerAuthRoutes(app) {

  // ── Login ──────────────────────────────────────────────────────────────────
  app.post('/api/login', async (req, res) => {
    const ip = obterIp(req);

    // Bloqueio por IP
    if (tentativas.estaBloqueado(ip)) {
      const min = tentativas.minutosRestantes(ip);
      registrarAuditoria({ usuario: req.body?.user || '?', acao: 'login_bloqueado', ip });
      return res.status(429).json({
        error: `Acesso bloqueado por tentativas excessivas. Tente novamente em ${min} minuto(s).`,
      });
    }

    const { user, pass } = req.body || {};

    // Validação de entrada
    if (!user || !pass || typeof user !== 'string' || typeof pass !== 'string') {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    const usuario = await verificarCredenciais(user.trim(), pass);

    if (!usuario) {
      const r = tentativas.registrarFalha(ip);
      registrarAuditoria({ usuario: user, acao: 'login_falha', ip, detalhes: `tentativa ${r.count}` });
      if (r.bloqueado) {
        return res.status(429).json({ error: 'IP bloqueado por tentativas excessivas.' });
      }
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Sucesso — regenera o ID de sessão para prevenir fixação
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Erro interno de sessão' });

      req.session.authenticated = true;
      req.session.user          = usuario.usuario;
      req.session.user_id       = usuario.id;
      req.session.role          = usuario.role;
      req.session.empresas      = usuario.empresas;

      tentativas.resetar(ip);
      registrarAuditoria({ usuario: usuario.usuario, acao: 'login_sucesso', ip });

      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Erro ao salvar sessão' });
        res.json({ ok: true, user: usuario.usuario, role: usuario.role });
      });
    });
  });

  // ── Logout ─────────────────────────────────────────────────────────────────
  app.post('/api/logout', (req, res) => {
    const ip      = obterIp(req);
    const usuario = req.session?.user || 'desconhecido';
    registrarAuditoria({ usuario, acao: 'logout', ip });
    req.session.destroy(() => {
      res.clearCookie('connect.sid', { path: '/', httpOnly: true, sameSite: 'strict' });
      res.json({ ok: true });
    });
  });

  // ── Sessão atual ───────────────────────────────────────────────────────────
  app.get('/api/me', requireAuth, (req, res) => {
    res.json({
      user:         req.session.user,
      user_id:      req.session.user_id,
      role:         req.session.role,
      empresas:     req.session.empresas,
      empresa_id:   req.session.empresa_id   ?? null,
      empresa_nome: req.session.empresa_nome ?? null,
    });
  });

};
