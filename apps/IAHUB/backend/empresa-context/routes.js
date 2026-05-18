const crud = require('../crud');
const { registrarAuditoria } = require('../auth/database');
const sistemasDb = require('../sistemas/database');

function obterIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'desconhecido';
}

module.exports = function registerRoutes(app, { requireAuth }) {

  // ── Empresas acessíveis pelo usuário logado ────────────────────────────────
  app.get('/api/empresas/minhas', requireAuth, (req, res) => {
    const { empresas: acesso, role } = req.session;
    const todas = crud.listar('empresas');

    // Admin tem acesso irrestrito
    if (role === 'admin' || acesso === 'all') return res.json(todas);

    // Usuário comum: filtra pelas empresas permitidas
    const permitidas = Array.isArray(acesso) ? acesso : [];
    res.json(todas.filter(e => permitidas.includes(e.id)));
  });

  // ── Selecionar empresa ativa ───────────────────────────────────────────────
  app.post('/api/empresas/selecionar', requireAuth, (req, res) => {
    const { empresa_id } = req.body || {};
    const systemCode = String(req.body?.system_code || '').trim();
    const ip = obterIp(req);

    if (!empresa_id) {
      return res.status(400).json({ error: 'empresa_id é obrigatório' });
    }

    // Verifica se o usuário tem acesso à empresa
    const { empresas: acesso, role } = req.session;
    const temAcesso = role === 'admin'
      || acesso === 'all'
      || (Array.isArray(acesso) && acesso.includes(Number(empresa_id)));

    if (!temAcesso) {
      return res.status(403).json({ error: 'Acesso negado a esta empresa' });
    }

    // Confirma que a empresa existe
    const empresa = crud.buscarPorId('empresas', empresa_id);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    let system = null;
    if (systemCode) {
      system = sistemasDb.getSystem(systemCode);
      if (!system?.active) return res.status(404).json({ error: 'Sistema não encontrado ou inativo' });
      if (!sistemasDb.hasCompanySystem(empresa.id, systemCode)) {
        return res.status(403).json({ error: 'Empresa sem acesso ao sistema' });
      }
      if (!sistemasDb.hasUserSystem(req.session.user_id, empresa.id, systemCode)) {
        return res.status(403).json({ error: 'Usuário sem acesso ao sistema nesta empresa' });
      }
    }

    const empresa_anterior = req.session.empresa_id || null;
    req.session.empresa_id   = empresa.id;
    req.session.empresa_nome = empresa.razao_social;
    req.session.system_code  = system ? system.code : null;
    req.session.system_name  = system ? system.name : null;

    registrarAuditoria({
      usuario:   req.session.user,
      acao:      'empresa_selecionada',
      ip,
      empresa_id: empresa.id,
      detalhes:  `anterior: ${empresa_anterior ?? 'nenhuma'}`,
    });

    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Erro ao salvar sessão' });
      res.json({ ok: true, empresa_id: empresa.id, empresa_nome: empresa.razao_social, system: system || null });
    });
  });

  // ── Limpar empresa ativa (voltar à seleção) ────────────────────────────────
  app.post('/api/empresas/limpar', requireAuth, (req, res) => {
    req.session.empresa_id   = null;
    req.session.empresa_nome = null;
    req.session.system_code  = null;
    req.session.system_name  = null;
    res.json({ ok: true });
  });

  // ── Empresa da sessão atual ────────────────────────────────────────────────
  app.get('/api/session/empresa', requireAuth, (req, res) => {
    res.json({
      empresa_id:   req.session.empresa_id   ?? null,
      empresa_nome: req.session.empresa_nome ?? null,
    });
  });

};
