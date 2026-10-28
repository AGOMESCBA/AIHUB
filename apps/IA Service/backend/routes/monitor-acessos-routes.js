// Monitor de Acessos (2026-10): sinal de presença das telas + leitura do
// painel. Ver services/presenca-service.js.
//
// ORDEM DE REGISTRO IMPORTA: registrarInterno() precisa ser chamado depois de
// app.use('/api/ia-service', requireAuth, requireIaService, requireEmpresaContext)
// e registrarExterno() depois de app.use('/api/ia-service-externo',
// requireSessaoExterna) — registrar antes deixaria a rota sem autenticação.

const presencaService = require('../services/presenca-service');
const historicoAcessos = require('../services/acesso-historico-service');
const { requireRotinaSvc } = require('../services/rotina-permissao');
const realtime = require('../services/chat-interno-realtime');
const chatService = require('../services/chat-interno-service');
const consultorRepo = require('../repositories/consultor-repository');

const ROTINA = 'svc-monitor-acessos';

function _handleErro(res, err) {
  const status = err.status || (/obrigatóri|inválid/i.test(err.message) ? 400 : 500);
  res.status(status).json({ error: err.message });
}

function _corpoSinal(req) {
  const b = req.body || {};
  return { tela: b.tela, acao: b.acao, chamadoId: b.chamadoId || null, visivel: b.visivel !== false, cliente: historicoAcessos.clienteDaRequisicao(req) };
}

function registrarInterno(app) {
  const podeMonitorar = requireRotinaSvc(ROTINA);

  app.post('/api/ia-service/presenca', (req, res) => {
    try {
      if (!req.sessionID) return res.status(401).json({ error: 'Sessão ausente.' });
      res.json(presencaService.registrarSinal({
        empresaId: req.svcEmpresaId,
        origem: 'interno',
        sessaoRef: presencaService.hashSessaoInterna(req.sessionID),
        usuarioIdIahub: Number(req.session?.user_id) || null,
        ..._corpoSinal(req),
      }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Aba/janela fechada (pagehide com keepalive) — ver presencaService.registrarSaida.
  app.post('/api/ia-service/presenca/saindo', (req, res) => {
    try {
      if (!req.sessionID) return res.status(401).json({ error: 'Sessão ausente.' });
      res.json(presencaService.registrarSaida({
        empresaId: req.svcEmpresaId,
        origem: 'interno',
        sessaoRef: presencaService.hashSessaoInterna(req.sessionID),
      }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/monitor-acessos', podeMonitorar, (req, res) => {
    try {
      res.json(presencaService.listarMonitor(req.svcEmpresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Limpar: zera a presença e encerra todos os logins do chat J2A da empresa
  // da sessão (ver presencaService.limparMonitor). Mesma permissão da tela.
  app.delete('/api/ia-service/monitor-acessos', podeMonitorar, (req, res) => {
    try {
      const resultado = presencaService.limparMonitor(req.svcEmpresaId, Date.now(), Number(req.session?.user_id) || null);
      presencaService.registrarAuditoria({ empresaId: req.svcEmpresaId, acao: 'limpar', usuarioId: Number(req.session?.user_id) || null, detalhe: resultado });
      res.json(resultado);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Derrubar o acesso de UMA pessoa ao chat J2A (todas as sessões dela). A
  // tela dela volta para o login na hora (socket) e o registro fica auditado.
  app.post('/api/ia-service/monitor-acessos/derrubar', podeMonitorar, (req, res) => {
    try {
      const consultorId = String(req.body?.consultorId || '');
      const { sessaoIds } = presencaService.derrubarPessoaChat(req.svcEmpresaId, consultorId, Number(req.session?.user_id) || null);
      realtime.encerrarSessoes(sessaoIds);
      presencaService.registrarAuditoria({
        empresaId: req.svcEmpresaId, acao: 'derrubar', alvo: `chat:${consultorId}`,
        usuarioId: Number(req.session?.user_id) || null, motivo: req.body?.motivo, detalhe: { sessoes: sessaoIds.length },
      });
      res.json({ sessoesEncerradas: sessaoIds.length });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Mensagem do Monitor para uma pessoa do chat J2A (2026-10-28). Sai pelo
  // Chat interno EM NOME de quem envia — o cadastro de analista dele nesta
  // empresa (consultores.usuario_id_iahub) —, sem remetente "sistema" nem
  // tabela nova: é a mesma conversa 1a1 e a resposta chega no chat J2A de
  // quem enviou. O texto não vai para a auditoria (só o tamanho).
  app.post('/api/ia-service/monitor-acessos/mensagem', podeMonitorar, (req, res) => {
    try {
      const destino = String(req.body?.consultorId || '');
      if (!destino) return res.status(400).json({ error: 'Analista obrigatório.' });
      const usuarioId = Number(req.session?.user_id) || null;
      const remetente = usuarioId ? consultorRepo.getConsultorPorUsuario(req.svcEmpresaId, usuarioId) : null;
      if (!remetente?.ativo) {
        return res.status(409).json({ error: 'Seu usuário não tem número ativo no chat desta empresa. Cadastre seu telefone em Números Autorizados para enviar mensagens.' });
      }
      const conversaId = chatService.abrirConversaDireta(req.svcEmpresaId, remetente.id, destino);
      const enviado = chatService.enviarMensagem(req.svcEmpresaId, remetente.id, conversaId, req.body?.texto);
      realtime.emitirMensagem(req.svcEmpresaId, enviado);
      presencaService.registrarAuditoria({
        empresaId: req.svcEmpresaId, acao: 'mensagem', alvo: `chat:${destino}`,
        usuarioId, detalhe: { caracteres: String(req.body?.texto || '').length },
      });
      res.status(201).json({ ok: true, conversaId, enviadaEm: enviado.mensagem.criadoEm });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Desconectar em massa (botão "Desconectar" do painel, 2026-10-28):
  // alvo 'ia-service' = sessões internas só do IA Service; 'chat' = logins
  // do chat J2A; 'todos' = os dois. Nunca desconecta quem está pedindo.
  app.post('/api/ia-service/monitor-acessos/desconectar', podeMonitorar, (req, res) => {
    try {
      const alvo = String(req.body?.alvo || '');
      if (!['ia-service', 'chat', 'todos'].includes(alvo)) return res.status(400).json({ error: 'Escolha IA Service, Chat ou Todos.' });
      const usuarioId = Number(req.session?.user_id) || null;
      let internas = 0;
      let chat = [];
      if (alvo !== 'chat') {
        internas = presencaService.desconectarInternos(req.svcEmpresaId, { escopo: 'ia-service', excetoSessionId: req.sessionID, usuarioId }).sessoesDesconectadas;
      }
      if (alvo !== 'ia-service') {
        chat = presencaService.desconectarChatTodos(req.svcEmpresaId, usuarioId).sessaoIds;
        realtime.encerrarSessoes(chat);
      }
      presencaService.registrarAuditoria({
        empresaId: req.svcEmpresaId, acao: 'desconectar', alvo, usuarioId,
        motivo: req.body?.motivo, detalhe: { internas, chat: chat.length },
      });
      res.json({ internasDesconectadas: internas, chatEncerradas: chat.length });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Desconectar UMA pessoa interna (todas as sessões dela que estão no
  // painel, menos a de quem pede). escopo 'iahub' (sai do IAHub inteiro,
  // inclusive dos outros sistemas) só para admin.
  app.post('/api/ia-service/monitor-acessos/desconectar-interno', podeMonitorar, (req, res) => {
    try {
      const escopo = String(req.body?.escopo || '');
      if (escopo === 'iahub' && req.session?.role !== 'admin') {
        return res.status(403).json({ error: 'Só administradores podem desconectar do IAHub inteiro.' });
      }
      const presencaIds = Array.isArray(req.body?.presencaIds) ? req.body.presencaIds.map(Number).filter(Number.isFinite) : [];
      if (!presencaIds.length) return res.status(400).json({ error: 'Sessão obrigatória.' });
      const usuarioId = Number(req.session?.user_id) || null;
      const r = presencaService.desconectarInternos(req.svcEmpresaId, { presencaIds, escopo, excetoSessionId: req.sessionID, usuarioId });
      if (!r.sessoesDesconectadas && r.ignorouPropria) {
        return res.status(400).json({ error: 'Esta é a sua própria sessão — para sair, use o botão Sair.' });
      }
      presencaService.registrarAuditoria({
        empresaId: req.svcEmpresaId, acao: escopo === 'iahub' ? 'desconectar_iahub' : 'desconectar', alvo: `interno:${presencaIds.join(',')}`,
        usuarioId, motivo: req.body?.motivo, detalhe: r,
      });
      res.json(r);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Histórico de Acessos: logins e falhas de login da empresa da sessão num
  // período (de/ate = instantes ISO calculados no fuso do navegador).
  app.get('/api/ia-service/monitor-acessos/historico', podeMonitorar, (req, res) => {
    try {
      const q = req.query || {};
      res.json(historicoAcessos.listarHistorico(req.svcEmpresaId, { de: q.de, ate: q.ate, origem: q.origem, busca: q.busca }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Única forma de apagar o histórico (decisão do usuário, 2026-10-28):
  // exclusão de um período, só da empresa da sessão, sempre auditada.
  app.delete('/api/ia-service/monitor-acessos/historico', podeMonitorar, (req, res) => {
    try {
      const { de, ate, motivo } = req.body || {};
      const resultado = historicoAcessos.excluirPeriodo(req.svcEmpresaId, { de, ate });
      presencaService.registrarAuditoria({
        empresaId: req.svcEmpresaId, acao: 'excluir_historico', usuarioId: Number(req.session?.user_id) || null,
        motivo, detalhe: { de, ate, ...resultado },
      });
      res.json(resultado);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/monitor-acessos/chamados/:chamadoId', podeMonitorar, (req, res) => {
    try {
      const resumo = presencaService.resumoChamado(req.svcEmpresaId, req.params.chamadoId);
      if (!resumo) return res.status(404).json({ error: 'Chamado não encontrado.' });
      res.json(resumo);
    } catch (err) {
      _handleErro(res, err);
    }
  });
}

function registrarExterno(app) {
  app.post('/api/ia-service-externo/presenca', (req, res) => {
    try {
      if (!req.svcSessaoExternaId) return res.status(401).json({ error: 'Sessão externa inválida ou expirada.' });
      res.json(presencaService.registrarSinal({
        empresaId: req.svcEmpresaId,
        origem: 'chat',
        sessaoRef: req.svcSessaoExternaId,
        consultorId: req.svcConsultorExterno,
        ..._corpoSinal(req),
      }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service-externo/presenca/saindo', (req, res) => {
    try {
      res.json(presencaService.registrarSaida({ empresaId: req.svcEmpresaId, origem: 'chat', sessaoRef: req.svcSessaoExternaId }));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Botão "Sair" do J2A: encerra a sessão no servidor (não só no navegador).
  app.post('/api/ia-service-externo/sessao/encerrar', (req, res) => {
    try {
      res.json(presencaService.encerrarSessaoChat(req.svcEmpresaId, req.svcSessaoExternaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });
}

// Sessão interna desconectada pelo Monitor (ver presencaService.desconectarInternos).
// Registrar logo depois de requireEmpresaContext, antes das rotas. O sinal de
// presença do shell consome a marca e recebe o aviso para sair da tela.
function bloquearDesconectados(req, res, next) {
  const escopo = presencaService.desconexaoPendente(req.sessionID);
  if (!escopo) return next();
  const caminho = req.baseUrl + req.path;
  if (escopo === 'iahub') {
    presencaService.consumirDesconexao(req.sessionID);
    return req.session.destroy(() => res.status(401).json({ error: 'Sua sessão foi encerrada pelo administrador.', desconectado: 'iahub' }));
  }
  if (caminho === '/api/ia-service/presenca') presencaService.consumirDesconexao(req.sessionID);
  return res.status(403).json({ error: 'Você foi desconectado do IA Service pelo administrador.', desconectado: 'ia-service' });
}

module.exports = { registrarInterno, registrarExterno, bloquearDesconectados, ROTINA };
