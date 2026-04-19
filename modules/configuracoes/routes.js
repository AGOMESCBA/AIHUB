module.exports = function registerRoutes(app, { requireAuth }) {

  app.post('/api/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
      req.session.authenticated = true;
      req.session.user = user;
      return res.json({ ok: true, user });
    }
    res.status(401).json({ error: 'Usuário ou senha inválidos' });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
  });

};
