// Rotas do radar/chat para SESSÃO EXTERNA (login por telefone/WhatsApp,
// namespace /api/ia-service-externo/*) — mesma lógica de negócio das rotas
// normais em routes/index.js (reaproveita os MESMOS services), só troca a
// origem da identidade: em vez de req.session (cookie do IA HUB) + middleware
// requireAuth/requireIaService/requireEmpresaContext, usa
// requireSessaoExterna (token validado em login-externo-service.js), que
// popula req.svcEmpresaId/req.svcConsultorExterno.
//
// Superfície minima: só os 5 endpoints que radar.html usa em modo externo
// (fila, abrir-atendimento, mensagens, anexos, investigar, config). Nada
// além disso é exposto neste namespace.

const multer = require('multer');
const { requireSessaoExterna } = require('../services/sessao-externa-middleware');
const atendimentoService = require('../services/atendimento-service');
const investigacaoService = require('../services/investigacao-service');
const extracaoConteudo = require('../services/extracao-conteudo');
const anexoRepo = require('../repositories/anexo-repository');
const armazenamento = require('../services/armazenamento-anexos');
const radarService = require('../services/radar-service');
const anexosSoftExpertService = require('../services/anexos-softexpert-service');
const consultorService = require('../services/consultor-service');
const crud = require('../../../IAHUB/backend/crud');
const usuariosDb = require('../../../IAHUB/backend/usuarios/database');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: armazenamento.TAMANHO_MAXIMO_BYTES } });

function _erroParaStatus(err) {
  if (/não encontrado|not found/i.test(err.message)) return 404;
  if (/obrigatóri|inválid|Já existe|não permitid|excede o limite|vazio/i.test(err.message)) return 400;
  return 500;
}
function _handleErro(res, err) {
  res.status(_erroParaStatus(err)).json({ error: err.message });
}

module.exports = function registrarRotasExterno(app) {
  app.use('/api/ia-service-externo', requireSessaoExterna);

  // Identidade da sessão externa — usado só para exibir o badge fixo de
  // empresa/consultor no cabeçalho do chat (ver radar.html), nunca para
  // decisão de autorização (isso já é feito por requireSessaoExterna a cada
  // request via req.svcEmpresaId).
  app.get('/api/ia-service-externo/whoami', (req, res) => {
    try {
      const empresa = crud.buscarPorId('empresas', req.svcEmpresaId);
      const consultor = consultorService.getConsultor(req.svcEmpresaId, req.svcConsultorExterno);
      const usuario = consultor?.usuarioIdIahub ? usuariosDb.buscarPorId(consultor.usuarioIdIahub) : null;
      res.json({
        empresaNome: empresa?.razao_social || empresa?.nome || null,
        consultorNome: usuario?.nome || null,
      });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service-externo/radar/fila', (req, res) => {
    try {
      const { filtro_sla, limite } = req.query || {};
      const resultado = radarService.getFilaPorConsultorId(req.svcEmpresaId, req.svcConsultorExterno, {
        filtroSla: filtro_sla || 'todos',
        limite: limite ? Number(limite) : undefined,
      });
      res.json(resultado);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service-externo/radar/chamados/:chamadoId/anexos-softexpert', async (req, res) => {
    try {
      const anexos = await anexosSoftExpertService.listarAnexosDoChamado(req.svcEmpresaId, req.params.chamadoId);
      res.json({ anexos });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service-externo/radar/chamados/:chamadoId/anexos-softexpert/:oid', async (req, res) => {
    try {
      const anexo = await anexosSoftExpertService.baixarAnexo(req.svcEmpresaId, req.params.chamadoId, req.params.oid);
      res.setHeader('Content-Type', anexo.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(anexo.nome)}"`);
      res.send(anexo.buffer);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service-externo/radar/chamados/:chamadoId/abrir-atendimento', (req, res) => {
    try {
      const { atendimento, reaberto } = radarService.abrirOuCriarAtendimento(req.svcEmpresaId, req.params.chamadoId, {
        consultorId: req.svcConsultorExterno,
      });
      res.status(reaberto ? 200 : 201).json({ atendimentoId: atendimento.id, reaberto });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service-externo/radar/config', (req, res) => {
    try {
      res.json(radarService.getConfig(req.svcEmpresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service-externo/radar/config', (req, res) => {
    try {
      const { autoRefreshSegundos } = req.body || {};
      res.json(radarService.salvarConfig(req.svcEmpresaId, { autoRefreshSegundos }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service-externo/atendimentos/:id/mensagens', (req, res) => {
    try {
      res.json(atendimentoService.listarMensagens(req.svcEmpresaId, req.params.id));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service-externo/atendimentos/:id/anexos', (req, res) => {
    try {
      res.json(atendimentoService.listarAnexos(req.svcEmpresaId, req.params.id));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service-externo/atendimentos/:id/anexos', upload.single('arquivo'), (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const atendimentoId = req.params.id;
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado (campo "arquivo").' });

      const atendimento = atendimentoService.getAtendimento(empresaId, atendimentoId);
      if (!atendimento) return res.status(404).json({ error: 'Atendimento não encontrado.' });

      const extraido = extracaoConteudo.extrairConteudo({
        buffer: req.file.buffer,
        nomeOriginal: req.file.originalname,
        mimeDeclarado: req.file.mimetype,
      });

      const anexo = armazenamento.salvarAnexo(empresaId, atendimentoId, {
        nomeOriginal: req.file.originalname,
        mimeType: extraido.mimeReal,
        tamanho: req.file.size,
        conteudo: req.file.buffer,
        usuarioId: null,
      });

      const anexoAtualizado = anexoRepo.atualizarExtracao(empresaId, anexo.id, {
        conteudoExtraido: extraido.conteudoExtraido,
        linguagemDetectada: extraido.linguagemDetectada,
        encodingDetectado: extraido.encodingDetectado,
        eCodigo: extraido.eCodigo,
      });

      res.status(201).json(anexoAtualizado);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service-externo/atendimentos/:id/investigar', async (req, res) => {
    try {
      const { texto, anexoIds } = req.body || {};
      if (!texto || !String(texto).trim()) {
        return res.status(400).json({ error: 'texto é obrigatório.' });
      }
      const mensagemAssistente = await investigacaoService.processarTurno(req.svcEmpresaId, req.params.id, {
        texto: String(texto).trim(),
        usuarioId: null,
        anexoIds: Array.isArray(anexoIds) ? anexoIds : [],
      });
      res.status(201).json(mensagemAssistente);
    } catch (err) {
      _handleErro(res, err);
    }
  });
};
