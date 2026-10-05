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

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { requireSessaoExterna } = require('../services/sessao-externa-middleware');
const atendimentoService = require('../services/atendimento-service');
const investigacaoService = require('../services/investigacao-service');
const extracaoConteudo = require('../services/extracao-conteudo');
const anexoRepo = require('../repositories/anexo-repository');
const turnoLockService = require('../services/turno-lock-service');
const armazenamento = require('../services/armazenamento-anexos');
const radarService = require('../services/radar-service');
const anexosSoftExpertService = require('../services/anexos-softexpert-service');
const consultorService = require('../services/consultor-service');
const loginExternoService = require('../services/login-externo-service');
const technicalResearchService = require('../services/technical-research-service');
const radarRefreshService = require('../services/radar-refresh-service');
const crud = require('../../../IAHUB/backend/crud');

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

  // Identidade da sessão externa — usado para exibir o badge fixo de
  // empresa/consultor no cabeçalho do chat (ver radar.html) e, agora, para
  // saber se o telefone tem OUTRAS empresas disponíveis (2026-09, troca de
  // empresa dentro do chat sem novo OTP — outrasEmpresas nunca inclui a
  // empresa atual). Não é usado para decisão de autorização (isso já é
  // feito por requireSessaoExterna a cada request via req.svcEmpresaId).
  //
  // logoUrl (2026-09): reaproveita empresas.login_logo_url, mesmo campo já
  // usado na tela de login principal do IAHub — a logomarca real só pode
  // ser mostrada AQUI (pós-login), não na tela de entrada por telefone
  // (entrar.html), porque a empresa só é conhecida depois do OTP.
  app.get('/api/ia-service-externo/whoami', (req, res) => {
    try {
      const empresa = crud.buscarPorId('empresas', req.svcEmpresaId);
      const consultor = consultorService.getConsultor(req.svcEmpresaId, req.svcConsultorExterno);
      const outrasEmpresas = consultor?.telefone
        ? loginExternoService.listarEmpresasDoTelefone(consultor.telefone)
            .filter(e => Number(e.id) !== Number(req.svcEmpresaId))
            .map(e => ({ id: e.id, nome: e.nome }))
        : [];
      res.json({
        empresaNome: empresa?.razao_social || empresa?.nome || null,
        empresaLogoUrl: empresa?.login_logo_url || null,
        // Antes só usava o nome do usuário IAHub vinculado (usuarioIdIahub),
        // que é opcional e raramente preenchido hoje (login é só por
        // telefone, ver migration v25) — ficava quase sempre null. Agora
        // resolve via técnico importado do SoftExpert como fallback
        // (consultorService.getNomeExibicao), pedido do usuário, 2026-10:
        // mostrar "Minha fila — <nome>" no radar.
        consultorNome: consultorService.getNomeExibicao(req.svcEmpresaId, req.svcConsultorExterno),
        outrasEmpresas,
      });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Troca a empresa ativa da sessão SEM novo OTP — o telefone já foi
  // validado uma vez no login; trocar de empresa só reconfirma (dentro de
  // login-externo-service.trocarEmpresa) que aquele telefone tem consultor
  // ativo na empresa de destino antes de emitir um token novo.
  app.post('/api/ia-service-externo/trocar-empresa', (req, res) => {
    try {
      const tokenAtual = req.headers['x-sessao-externa'];
      const resultado = loginExternoService.trocarEmpresa(String(tokenAtual), req.body?.empresaId);
      res.json({ ok: true, token: resultado.token, expiraEm: resultado.expiraEm });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/ia-service-externo/radar/fila', async (req, res) => {
    try {
      const { filtro_sla, limite, force_sync } = req.query || {};
      const sincronizacao = await radarRefreshService.sincronizarAntesDaFila(req.svcEmpresaId, {
        force: force_sync === 'true',
      });
      const resultado = radarService.getFilaPorConsultorId(req.svcEmpresaId, req.svcConsultorExterno, {
        filtroSla: filtro_sla || 'todos',
        limite: limite ? Number(limite) : undefined,
      });
      res.json({ ...resultado, sincronizacao });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Risco SLA é sempre uma visão de TODOS os consultores (mesmo motivo já
  // corrigido na rota de sessão por cookie, routes/index.js — "radar:
  // acompanhar todos, não só o que está logado"). Essa rota do modo
  // externo (login por telefone) usava getRiscoSlaPorConsultorId, que
  // SEMPRE restringe ao consultor da própria sessão — nunca existia um
  // caminho "todos" aqui, por isso quem entrava por telefone só via a
  // própria fila mesmo depois da correção equivalente na rota de sessão
  // normal (bug real, reportado múltiplas vezes pelo usuário, 2026-10).
  app.get('/api/ia-service-externo/radar/risco-sla', async (req, res) => {
    try {
      const { filtro, limite, force_sync } = req.query || {};
      const sincronizacao = await radarRefreshService.sincronizarAntesDaFila(req.svcEmpresaId, {
        force: force_sync === 'true',
      });
      const resultado = radarService.getRiscoSla(req.svcEmpresaId, {
        filtroRisco: filtro || 'todos',
        limite: limite ? Number(limite) : undefined,
      });
      res.json({ ...resultado, avisoSemVinculo: false, sincronizacao });
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

  // Espelho da rota interna (index.js) — usada pelo botão "Pesquisar
  // Soluções" do Radar externo (login por telefone) antes de reenviar tudo
  // para a IA. Faltava aqui: a rota só existia no canal interno, por isso o
  // clique no Radar externo retornava 404 (2026-10, achado real em produção).
  app.post('/api/ia-service-externo/radar/chamados/:chamadoId/anexos-softexpert/sincronizar', async (req, res) => {
    try {
      const { atendimentoId } = req.body || {};
      if (!atendimentoId) return res.status(400).json({ error: 'atendimentoId é obrigatório.' });
      const { sincronizados, indisponiveis } = await anexosSoftExpertService.sincronizarEValidarAnexosParaAtendimento(req.svcEmpresaId, req.params.chamadoId, atendimentoId);
      res.json({ sincronizados: sincronizados.length, indisponiveis });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  function iniciarAnaliseRadarExterno(req, res) {
    try {
      const { atendimento, reaberto } = radarService.iniciarAnalise(req.svcEmpresaId, req.params.chamadoId, {
        consultorId: req.svcConsultorExterno,
      });
      res.status(reaberto ? 200 : 201).json({ atendimentoId: atendimento.id, reaberto });
    } catch (err) {
      _handleErro(res, err);
    }
  }

  app.post('/api/ia-service-externo/radar/chamados/:chamadoId/iniciar-analise', iniciarAnaliseRadarExterno);
  app.post('/api/ia-service-externo/radar/chamados/:chamadoId/abrir-atendimento', iniciarAnaliseRadarExterno);

  app.get('/api/ia-service-externo/radar/chamados/:chamadoId/relacionados', (req, res) => {
    try {
      const { limite } = req.query || {};
      res.json(radarService.buscarRelacionados(req.svcEmpresaId, req.params.chamadoId, {
        limite: limite ? Number(limite) : undefined,
      }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service-externo/radar/chamados/:chamadoId/pesquisa-tecnica', async (req, res) => {
    try {
      res.json(await technicalResearchService.pesquisarParaChamado(req.svcEmpresaId, req.params.chamadoId, {
        limiteRelacionados: req.query?.limiteRelacionados ? Number(req.query.limiteRelacionados) : undefined,
      }));
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

  app.get('/api/ia-service-externo/anexos/:id/download', (req, res) => {
    try {
      const anexo = anexoRepo.getAnexo(req.svcEmpresaId, req.params.id);
      if (!anexo) return res.status(404).json({ error: 'Anexo não encontrado.' });

      const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
      if (!fs.existsSync(caminhoAbsoluto)) return res.status(404).json({ error: 'Arquivo não encontrado em disco.' });

      res.setHeader('Content-Type', anexo.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(anexo.nomeOriginal)}"`);
      fs.createReadStream(caminhoAbsoluto).pipe(res);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service-externo/atendimentos/:id/anexos', upload.single('arquivo'), async (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const atendimentoId = req.params.id;
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado (campo "arquivo").' });

      const atendimento = atendimentoService.getAtendimento(empresaId, atendimentoId);
      if (!atendimento) return res.status(404).json({ error: 'Atendimento não encontrado.' });

      const extraido = await extracaoConteudo.extrairConteudo({
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
    const empresaId = req.svcEmpresaId;
    const atendimentoId = req.params.id;
    if (!turnoLockService.tentarAdquirir(empresaId, atendimentoId)) {
      return res.status(409).json({ error: 'Este atendimento já está processando uma investigação. Aguarde a resposta atual.' });
    }
    try {
      const { texto, anexoIds, anexosComoContexto, forcarPesquisa } = req.body || {};
      if (!texto || !String(texto).trim()) {
        return res.status(400).json({ error: 'texto é obrigatório.' });
      }
      const mensagemAssistente = await investigacaoService.processarTurno(empresaId, atendimentoId, {
        texto: String(texto).trim(),
        usuarioId: null,
        anexoIds: Array.isArray(anexoIds) ? anexoIds : [],
        anexosComoContexto: anexosComoContexto === true,
        forcarPesquisa: forcarPesquisa === true,
      });
      res.status(201).json(mensagemAssistente);
    } catch (err) {
      _handleErro(res, err);
    } finally {
      turnoLockService.liberar(empresaId, atendimentoId);
    }
  });

  app.get('/api/ia-service-externo/radar/minhas-preferencias', (req, res) => {
    try {
      const consultor = consultorService.getConsultor(req.svcEmpresaId, req.svcConsultorExterno);
      if (!consultor) return res.status(404).json({ error: 'Consultor não encontrado nesta empresa.' });
      res.json({
        consultorEncontrado: true,
        consultorId: consultor.id,
        preAnaliseAutomatica: consultor.preAnaliseAutomatica !== false,
      });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service-externo/radar/minhas-preferencias', (req, res) => {
    try {
      const consultor = consultorService.getConsultor(req.svcEmpresaId, req.svcConsultorExterno);
      if (!consultor) return res.status(404).json({ error: 'Consultor não encontrado nesta empresa.' });

      const { preAnaliseAutomatica } = req.body || {};
      const atualizado = consultorService.atualizarConsultor(req.svcEmpresaId, consultor.id, {
        preAnaliseAutomatica: !!preAnaliseAutomatica,
      });
      res.json({
        consultorEncontrado: true,
        consultorId: atualizado.id,
        preAnaliseAutomatica: atualizado.preAnaliseAutomatica !== false,
      });
    } catch (err) {
      _handleErro(res, err);
    }
  });
};
