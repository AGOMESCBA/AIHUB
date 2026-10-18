// Monitor de Acessos (2026-10): sinal de presença das telas + leitura do
// painel. Ver services/presenca-service.js.
//
// ORDEM DE REGISTRO IMPORTA: registrarInterno() precisa ser chamado depois de
// app.use('/api/ia-service', requireAuth, requireIaService, requireEmpresaContext)
// e registrarExterno() depois de app.use('/api/ia-service-externo',
// requireSessaoExterna) — registrar antes deixaria a rota sem autenticação.

const presencaService = require('../services/presenca-service');
const { requireRotinaSvc } = require('../services/rotina-permissao');
const realtime = require('../services/chat-interno-realtime');

const ROTINA = 'svc-monitor-acessos';

function _handleErro(res, err) {
  const status = err.status || (/obrigatóri|inválid/i.test(err.message) ? 400 : 500);
  res.status(status).json({ error: err.message });
}

function _corpoSinal(req) {
  const b = req.body || {};
  return { tela: b.tela, acao: b.acao, chamadoId: b.chamadoId || null, visivel: b.visivel !== false };
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
      const resultado = presencaService.limparMonitor(req.svcEmpresaId);
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
      const { sessaoIds } = presencaService.derrubarPessoaChat(req.svcEmpresaId, consultorId);
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

module.exports = { registrarInterno, registrarExterno, ROTINA };
