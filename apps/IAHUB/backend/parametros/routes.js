// API dos Parâmetros por Empresa (IA Gestão). Só administrador do IAHub, como
// o resto da IA Gestão. Toda alteração vai ao histórico do parâmetro e à
// Auditoria da IA Gestão, com o usuário.
const store = require('./store');
const reserva = require('./alertas-reserva');
const empresasDb = require('../empresas/database');
const { registrarAuditoria } = require('../auth/database');

const BASE = '/api/iahub/parametros';

function _empresa(valor) {
  const id = Number(valor || 0);
  if (!id || !empresasDb.buscarPorId(id)) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
  return id;
}

function registrar(app, { requireAuth, requireAdmin }) {
  const guarda = [requireAuth, requireAdmin];
  const semCache = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const rota = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!err.status) console.error('[IAHub] Parâmetros por empresa:', err);
      res.status(err.status || 500).json({ error: err.message, ...(err.erros ? { erros: err.erros } : {}) });
    }
  };

  app.get(`${BASE}/empresas`, guarda, semCache, rota(() => ({
    empresas: empresasDb.listar().map(e => ({ id: Number(e.id), nome: e.razao_social || `Empresa ${e.id}` }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  })));

  app.get(BASE, guarda, semCache, rota((req) => store.paraTela(_empresa(req.query.empresa_id))));

  app.put(BASE, guarda, rota((req) => {
    const empresaId = _empresa(req.body?.empresaId);
    const usuario = req.session?.user || 'desconhecido';
    const r = store.salvar(empresaId, { alteracoes: req.body?.alteracoes || {}, restaurar: req.body?.restaurar || [] }, { usuario });
    if (r.alterados) {
      const chaves = [...Object.keys(req.body?.alteracoes || {}), ...(req.body?.restaurar || [])];
      registrarAuditoria({ usuario, acao: 'parametros_empresa_alterados', ip: req.ip, empresa_id: empresaId, detalhes: `${r.alterados} parâmetro(s): ${chaves.slice(0, 20).join(', ')}` });
    }
    return r;
  }));

  app.get(`${BASE}/historico`, guarda, semCache, rota((req) => ({
    historico: store.historico(_empresa(req.query.empresa_id), { chave: req.query.chave || null, limite: req.query.limite || 100 }),
  })));

  app.post(`${BASE}/testar`, guarda, rota(async (req) => {
    const empresaId = _empresa(req.body?.empresaId);
    const canal = String(req.body?.canal || '');
    const usuario = req.session?.user || 'desconhecido';
    try {
      await reserva.testar(empresaId, canal, usuario);
    } catch (err) {
      if (err.status) throw err;
      throw Object.assign(new Error(`Não enviou: ${err.message}`), { status: 400 });
    }
    registrarAuditoria({ usuario, acao: 'parametros_empresa_teste', ip: req.ip, empresa_id: empresaId, detalhes: `Teste de alerta por ${canal}` });
    return { ok: true };
  }));
}

module.exports = { registrar };
