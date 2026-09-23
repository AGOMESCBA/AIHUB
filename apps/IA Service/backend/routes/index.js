// Registro central de rotas do IA Service — mesmo padrão de
// apps/IA Command/modules/routes.js: recebe (app, deps) e monta os
// sub-routers. Escopo da Etapa 1: CRUD de fundação (atendimento, mensagem,
// anexo-metadados, consultor) — sem motor de IA, sem chat completo.

const { requireEmpresaContext } = require('../services/empresa-context');
const atendimentoService = require('../services/atendimento-service');
const consultorService = require('../services/consultor-service');

function _erroParaStatus(err) {
  if (/não encontrado|not found/i.test(err.message)) return 404;
  if (/obrigatóri|inválid|Já existe/i.test(err.message)) return 400;
  return 500;
}

// Nunca expor err.stack ao frontend (seção 24 do prompt) — apenas a mensagem,
// que já é controlada e em pt-BR nos services/repositories acima.
function _handleErro(res, err) {
  const status = _erroParaStatus(err);
  res.status(status).json({ error: err.message });
}

module.exports = function registrarRotas(app, { requireAuth, requireIaService }) {
  app.use('/api/ia-service', requireAuth, requireIaService, requireEmpresaContext);

  // ── Atendimentos ────────────────────────────────────────────────────────
  app.post('/api/ia-service/atendimentos', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { conteudoBruto, origem, canalEntrada, referenciaExterna, anexos } = req.body || {};
      const atendimento = atendimentoService.criarAtendimentoDeEntradaCanonica({
        origem,
        canalEntrada: canalEntrada || 'web',
        referenciaExterna,
        empresaId,
        conteudoBruto,
        anexos,
        metadados: { criadoPorUsuarioId: req.session?.user_id || null },
      });
      res.status(201).json(atendimento);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/atendimentos', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { status, consultorId, limite } = req.query || {};
      const lista = atendimentoService.listarAtendimentos(empresaId, { status, consultorId, limite });
      res.json(lista);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/atendimentos/:id', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const atendimento = atendimentoService.getAtendimento(empresaId, req.params.id);
      if (!atendimento) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      res.json(atendimento);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service/atendimentos/:id/status', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const atendimento = atendimentoService.atualizarStatus(empresaId, req.params.id, req.body?.status);
      if (!atendimento) return res.status(404).json({ error: 'Atendimento não encontrado.' });
      res.json(atendimento);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Mensagens ───────────────────────────────────────────────────────────
  app.post('/api/ia-service/atendimentos/:id/mensagens', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { papel, conteudo } = req.body || {};
      const mensagem = atendimentoService.adicionarMensagem(empresaId, req.params.id, {
        papel: papel || 'user',
        conteudo,
        usuarioId: req.session?.user_id || null,
      });
      res.status(201).json(mensagem);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/atendimentos/:id/mensagens', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const mensagens = atendimentoService.listarMensagens(empresaId, req.params.id);
      res.json(mensagens);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Anexos (fundação de metadados — upload completo fica para a Etapa 2) ──
  app.get('/api/ia-service/atendimentos/:id/anexos', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const anexos = atendimentoService.listarAnexos(empresaId, req.params.id);
      res.json(anexos);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Consultores/Técnicos ───────────────────────────────────────────────
  app.post('/api/ia-service/consultores', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { usuarioIdIahub, idSoftexpert } = req.body || {};
      const consultor = consultorService.criarConsultor(empresaId, { usuarioIdIahub, idSoftexpert });
      res.status(201).json(consultor);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/consultores', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { ativo } = req.query || {};
      const filtros = ativo !== undefined ? { ativo: ativo === 'true' } : {};
      const lista = consultorService.listarConsultores(empresaId, filtros);
      res.json(lista);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/consultores/:id', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const consultor = consultorService.getConsultor(empresaId, req.params.id);
      if (!consultor) return res.status(404).json({ error: 'Consultor não encontrado.' });
      res.json(consultor);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service/consultores/:id', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { idSoftexpert, ativo } = req.body || {};
      const consultor = consultorService.atualizarConsultor(empresaId, req.params.id, { idSoftexpert, ativo });
      if (!consultor) return res.status(404).json({ error: 'Consultor não encontrado.' });
      res.json(consultor);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Health check (mesmo padrão do IA Command) ──────────────────────────
  app.get('/api/ia-service/health', requireAuth, requireIaService, (req, res) => {
    try {
      const { getDB } = require('../database');
      const db = getDB();
      const versoes = db.prepare('SELECT COUNT(*) as total FROM schema_migrations').get();
      res.json({
        status: 'ok',
        sistema: 'IA Service',
        versao: '0.1.0-etapa1',
        migracoes: versoes.total,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ status: 'erro', mensagem: err.message });
    }
  });
};
