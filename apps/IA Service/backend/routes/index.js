// Registro central de rotas do IA Service — mesmo padrão de
// apps/IA Command/modules/routes.js: recebe (app, deps) e monta os
// sub-routers. Etapa 1: CRUD de fundação. Etapa 2: upload de anexos,
// investigação com IA (texto+imagem+código correlacionados), versionamento
// de fonte corrigido, configuração de providers de IA.

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { requireEmpresaContext } = require('../services/empresa-context');
const atendimentoService = require('../services/atendimento-service');
const consultorService = require('../services/consultor-service');
const armazenamento = require('../services/armazenamento-anexos');
const extracaoConteudo = require('../services/extracao-conteudo');
const anexoRepo = require('../repositories/anexo-repository');
const investigacaoService = require('../services/investigacao-service');
const versaoFonteService = require('../services/versao-fonte-service');
const aiConfigService = require('../services/ai-config-service');
const agenteLocalService = require('../services/agente-local-service');
const historicalImportService = require('../services/import/historical-import-service');
const historicalSyncService = require('../services/import/historical-sync-service');
const importacaoRepo = require('../repositories/importacao-repository');
const chamadoRepo = require('../repositories/chamado-repository');
const clienteRepo = require('../repositories/cliente-repository');
const radarService = require('../services/radar-service');
const anexosSoftExpertService = require('../services/anexos-softexpert-service');
const technicalResearchService = require('../services/technical-research-service');
const radarRefreshService = require('../services/radar-refresh-service');

// multer com storage em memória — o binário só vai para disco depois da
// validação (armazenamento.validarAnexo), nunca antes. Limite de tamanho
// aplicado aqui também (defesa em profundidade, além da validação do service).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: armazenamento.TAMANHO_MAXIMO_BYTES } });

function _erroParaStatus(err) {
  if (/não encontrado|not found/i.test(err.message)) return 404;
  if (/obrigatóri|inválid|Já existe|não permitid|excede o limite|vazio/i.test(err.message)) return 400;
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
  // Envio simples (sem acionar a IA) — usado internamente/testes. O fluxo
  // real do chat usa POST .../investigar (abaixo), que persiste a mensagem
  // do usuário E aciona a análise, na mesma chamada.
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

  // ── Investigação (Etapa 2) — o fluxo principal do chat técnico ──────────
  // Recebe texto + IDs de anexos já enviados (via /anexos abaixo), persiste o
  // turno do usuário, monta contexto (histórico + anexos), chama a IA,
  // persiste e devolve a resposta estruturada.
  app.post('/api/ia-service/atendimentos/:id/investigar', async (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { texto, anexoIds } = req.body || {};
      if (!texto || !String(texto).trim()) {
        return res.status(400).json({ error: 'texto é obrigatório.' });
      }
      const mensagemAssistente = await investigacaoService.processarTurno(empresaId, req.params.id, {
        texto: String(texto).trim(),
        usuarioId: req.session?.user_id || null,
        anexoIds: Array.isArray(anexoIds) ? anexoIds : [],
      });
      res.status(201).json(mensagemAssistente);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Anexos ───────────────────────────────────────────────────────────────
  app.get('/api/ia-service/atendimentos/:id/anexos', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const anexos = atendimentoService.listarAnexos(empresaId, req.params.id);
      res.json(anexos);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Upload real (multipart/form-data, campo "arquivo"). Valida, extrai
  // conteúdo (texto/linguagem/encoding — nunca confia só na extensão), salva
  // em disco (fora do SQLite) e grava metadados. Anexo fica "solto" (sem
  // mensagem_id) até ser referenciado em POST .../investigar.
  app.post('/api/ia-service/atendimentos/:id/anexos', upload.single('arquivo'), (req, res) => {
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
        usuarioId: req.session?.user_id || null,
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

  // ── Versionamento de fonte (Etapa 2, seção 9/10 do prompt) ───────────────
  app.get('/api/ia-service/anexos/:id/versoes', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const versoes = versaoFonteService.listarVersoes(empresaId, req.params.id);
      res.json(versoes);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/anexos/:id/diff/:versaoId', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const original = anexoRepo.getAnexo(empresaId, req.params.id);
      const versao = anexoRepo.getAnexo(empresaId, req.params.versaoId);
      if (!original || !versao) return res.status(404).json({ error: 'Anexo ou versão não encontrados.' });
      const diff = versaoFonteService.calcularDiff(original.conteudoExtraido, versao.conteudoExtraido);
      res.json({ diff });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Download do binário do anexo (original ou versão corrigida) — o caminho
  // em disco nunca é exposto ao cliente, só resolvido internamente a partir
  // do nome_interno já validado no momento do upload.
  app.get('/api/ia-service/anexos/:id/download', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const anexo = anexoRepo.getAnexo(empresaId, req.params.id);
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

  // ── Configuração de IA por empresa ────────────────────────────────────────
  app.get('/api/ia-service/config/ia', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      res.json(aiConfigService.getConfig(empresaId) || { empresaId, configurado: false });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service/config/ia', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { provedorPrimario, fallbackOrdem, groqApiKey, openaiApiKey, claudeApiKey, geminiApiKey } = req.body || {};
      aiConfigService.salvarConfig(empresaId, { provedorPrimario, fallbackOrdem, groqApiKey, openaiApiKey, claudeApiKey, geminiApiKey });
      res.json(aiConfigService.getConfig(empresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Consultores/Técnicos ───────────────────────────────────────────────
  app.post('/api/ia-service/consultores', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { usuarioIdIahub, idSoftexpert, telefone, preAnaliseAutomatica } = req.body || {};
      const consultor = consultorService.criarConsultor(empresaId, { usuarioIdIahub, idSoftexpert, telefone, preAnaliseAutomatica });
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
      const { idSoftexpert, telefone, ativo, preAnaliseAutomatica } = req.body || {};
      const consultor = consultorService.atualizarConsultor(empresaId, req.params.id, { idSoftexpert, telefone, ativo, preAnaliseAutomatica });
      if (!consultor) return res.status(404).json({ error: 'Consultor não encontrado.' });
      res.json(consultor);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.delete('/api/ia-service/consultores/:id', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const excluido = consultorService.excluirConsultor(empresaId, req.params.id);
      if (!excluido) return res.status(404).json({ error: 'Consultor não encontrado.' });
      res.status(204).end();
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Base histórica: Agente Local ─────────────────────────────────────────
  app.get('/api/ia-service/base-historica/agente-local', (req, res) => {
    try {
      res.json(agenteLocalService.getConfig(req.svcEmpresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service/base-historica/agente-local', (req, res) => {
    try {
      const { url, token, cryptoKey, cryptoAtivo } = req.body || {};
      res.json(agenteLocalService.salvarConfig(req.svcEmpresaId, { url, token, cryptoKey, cryptoAtivo }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Revela o token JÁ SALVO em texto puro — só sob clique explícito do
  // usuário no "olhinho" (nunca chamada junto do carregamento normal da
  // tela). Exige a mesma sessão autenticada de empresa que todo o resto do
  // IA Service (req.svcEmpresaId já populado pelo middleware do router).
  app.get('/api/ia-service/base-historica/agente-local/token', (req, res) => {
    try {
      res.json({ token: agenteLocalService.getTokenRevelado(req.svcEmpresaId) });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Mesmo padrão da rota de token acima, para a CRYPTO_KEY.
  app.get('/api/ia-service/base-historica/agente-local/crypto-key', (req, res) => {
    try {
      res.json({ cryptoKey: agenteLocalService.getCryptoKeyRevelada(req.svcEmpresaId) });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service/base-historica/agente-local/testar', async (req, res) => {
    try {
      res.json(await agenteLocalService.testarConexao(req.svcEmpresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Base histórica: Fontes ────────────────────────────────────────────────
  app.get('/api/ia-service/base-historica/fontes', (req, res) => {
    try {
      res.json(agenteLocalService.listarFontes(req.svcEmpresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service/base-historica/fontes', (req, res) => {
    try {
      const { connectionKey, nome, sistemaOrigem, adapter } = req.body || {};
      const fonte = agenteLocalService.criarFonte(req.svcEmpresaId, { connectionKey, nome, sistemaOrigem, adapter });
      res.status(201).json(fonte);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service/base-historica/fontes/:id', (req, res) => {
    try {
      const { nome, connectionKey, ativo } = req.body || {};
      const fonte = agenteLocalService.atualizarFonte(req.svcEmpresaId, req.params.id, { nome, connectionKey, ativo });
      if (!fonte) return res.status(404).json({ error: 'Fonte não encontrada.' });
      res.json(fonte);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Exclusão SEMPRE apaga em cascata (ON DELETE CASCADE) o histórico de
  // importações/chamados/posicionamentos vinculado — ver
  // agenteLocalService.excluirFonte. A confirmação clara disso fica na UI.
  app.delete('/api/ia-service/base-historica/fontes/:id', (req, res) => {
    try {
      const excluida = agenteLocalService.excluirFonte(req.svcEmpresaId, req.params.id);
      if (!excluida) return res.status(404).json({ error: 'Fonte não encontrada.' });
      res.status(204).end();
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service/base-historica/fontes/:id/testar', async (req, res) => {
    try {
      res.json(await agenteLocalService.testarFonte(req.svcEmpresaId, req.params.id));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Base histórica: Importação (Checkpoints 4-6) ─────────────────────────
  // Disparo em background — a requisição HTTP não fica presa esperando a
  // importação inteira (pode levar minutos/horas em bases grandes). O
  // cliente consulta progresso via GET /importacoes/:id (polling).
  app.post('/api/ia-service/base-historica/fontes/:id/importar', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { periodoInicio, periodoFim, tamanhoLote } = req.body || {};
      if (!periodoInicio || !periodoFim) {
        return res.status(400).json({ error: 'periodoInicio e periodoFim são obrigatórios (formato YYYYMMDD).' });
      }

      const importacaoInicial = importacaoRepo.criarImportacao(empresaId, {
        fonteId: req.params.id, tipo: 'full', periodoInicio, periodoFim,
      });

      // Dispara em background — erros são persistidos na própria importação
      // (status='falhou', mensagemErro), não precisam propagar para cá.
      historicalImportService.executarFullLoad(empresaId, req.params.id, {
        periodoInicio, periodoFim, tamanhoLote: tamanhoLote || historicalImportService.TAMANHO_LOTE_PADRAO,
        importacaoExistenteId: importacaoInicial.id,
      }).catch(err => {
        console.error('[IA Service] Importação histórica falhou:', err.message);
      });

      res.status(202).json(importacaoInicial);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service/base-historica/fontes/:id/importar/retomar/:importacaoId', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const importacao = importacaoRepo.getImportacao(empresaId, req.params.importacaoId);
      if (!importacao) return res.status(404).json({ error: 'Importação não encontrada.' });

      historicalImportService.executarFullLoad(empresaId, req.params.id, {
        periodoInicio: importacao.periodoInicio, periodoFim: importacao.periodoFim,
        importacaoExistenteId: importacao.id,
      }).catch(err => {
        console.error('[IA Service] Retomada de importação falhou:', err.message);
      });

      res.status(202).json(importacao);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service/base-historica/fontes/:id/sincronizar-incremental', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { janelaDias } = req.body || {};

      historicalSyncService.executarIncremental(empresaId, req.params.id, { janelaDias }).catch(err => {
        console.error('[IA Service] Sincronização incremental falhou:', err.message);
      });

      res.status(202).json({ ok: true, mensagem: 'Sincronização incremental iniciada.' });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/base-historica/importacoes', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { fonteId, limite } = req.query || {};
      res.json(importacaoRepo.listarImportacoes(empresaId, { fonteId, limite }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/base-historica/importacoes/:id', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const importacao = importacaoRepo.getImportacao(empresaId, req.params.id);
      if (!importacao) return res.status(404).json({ error: 'Importação não encontrada.' });
      res.json(importacao);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/base-historica/importacoes/:id/inconsistencias', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      res.json(importacaoRepo.listarInconsistencias(empresaId, req.params.id));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Base histórica: consulta (painel) ─────────────────────────────────────
  // "Aguardando indexação" aqui é só a contagem de chamados.precisa_indexacao=1
  // (marcado pelo importador, ver migration v15) — a FILA de indexação real
  // (Checkpoint 8+: conhecimento/chunks/FTS5/embeddings) não existe ainda
  // nesta etapa, então este número reflete apenas o que o importador marcou.
  app.get('/api/ia-service/base-historica/resumo', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      res.json({
        clientes: clienteRepo.contarClientes(empresaId),
        usuariosCliente: clienteRepo.contarUsuariosCliente(empresaId),
        tecnicos: clienteRepo.contarTecnicos(empresaId),
        chamados: chamadoRepo.contarChamados(empresaId),
        posicionamentos: chamadoRepo.contarPosicionamentos(empresaId),
        chamadosAguardandoIndexacao: chamadoRepo.listarChamados(empresaId, { precisaIndexacao: true, limite: 5000 }).length,
      });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Radar de chamados (fila do analista) ────────────────────────────────
  app.get('/api/ia-service/radar/fila', async (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { apenas_minha, filtro_sla, limite, force_sync } = req.query || {};
      const sincronizacao = await radarRefreshService.sincronizarAntesDaFila(empresaId, {
        force: force_sync === 'true',
      });
      const resultado = radarService.getFila(empresaId, req.session?.user_id || null, {
        apenasMinha: apenas_minha === 'true',
        filtroSla: filtro_sla || 'todos',
        limite: limite ? Number(limite) : undefined,
      });
      res.json({ ...resultado, sincronizacao });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  function iniciarAnaliseRadar(req, res) {
    try {
      const empresaId = req.svcEmpresaId;
      const { atendimento, reaberto } = radarService.iniciarAnalise(empresaId, req.params.chamadoId, {
        usuarioIdIahub: req.session?.user_id || null,
      });
      res.status(reaberto ? 200 : 201).json({ atendimentoId: atendimento.id, reaberto });
    } catch (err) {
      _handleErro(res, err);
    }
  }

  app.post('/api/ia-service/radar/chamados/:chamadoId/iniciar-analise', iniciarAnaliseRadar);
  app.post('/api/ia-service/radar/chamados/:chamadoId/abrir-atendimento', iniciarAnaliseRadar);

  app.get('/api/ia-service/radar/chamados/:chamadoId/relacionados', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { limite } = req.query || {};
      res.json(radarService.buscarRelacionados(empresaId, req.params.chamadoId, {
        limite: limite ? Number(limite) : undefined,
      }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/radar/chamados/:chamadoId/pesquisa-tecnica', async (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      res.json(await technicalResearchService.pesquisarParaChamado(empresaId, req.params.chamadoId, {
        limiteRelacionados: req.query?.limiteRelacionados ? Number(req.query.limiteRelacionados) : undefined,
      }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/radar/config', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      res.json(radarService.getConfig(empresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // ── Anexos REAIS do SoftExpert (distintos dos uploads do analista, ver
  // /atendimentos/:id/anexos acima) — buscados ao vivo via Agente Local, sem
  // cache local do binário (ver anexos-softexpert-service.js).
  app.get('/api/ia-service/radar/chamados/:chamadoId/anexos-softexpert', async (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const anexos = await anexosSoftExpertService.listarAnexosDoChamado(empresaId, req.params.chamadoId);
      res.json({ anexos });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/radar/chamados/:chamadoId/anexos-softexpert/:oid', async (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const anexo = await anexosSoftExpertService.baixarAnexo(empresaId, req.params.chamadoId, req.params.oid);
      res.setHeader('Content-Type', anexo.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(anexo.nome)}"`);
      res.send(anexo.buffer);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service/radar/config', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const { autoRefreshSegundos } = req.body || {};
      res.json(radarService.salvarConfig(empresaId, { autoRefreshSegundos }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/radar/minhas-preferencias', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const usuarioId = req.session?.user_id;
      const consultor = usuarioId ? consultorService.getConsultorPorUsuario(empresaId, usuarioId) : null;
      if (!consultor) {
        return res.json({ consultorEncontrado: false, preAnaliseAutomatica: false });
      }
      res.json({
        consultorEncontrado: true,
        consultorId: consultor.id,
        preAnaliseAutomatica: consultor.preAnaliseAutomatica !== false,
      });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.put('/api/ia-service/radar/minhas-preferencias', (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const usuarioId = req.session?.user_id;
      const consultor = usuarioId ? consultorService.getConsultorPorUsuario(empresaId, usuarioId) : null;
      if (!consultor) return res.status(404).json({ error: 'Consultor não encontrado para este usuário nesta empresa.' });

      const { preAnaliseAutomatica } = req.body || {};
      const atualizado = consultorService.atualizarConsultor(empresaId, consultor.id, {
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
