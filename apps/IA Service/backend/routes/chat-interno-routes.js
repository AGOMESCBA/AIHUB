// Chat interno (2026-10) — API do J2A (sessão externa por telefone).
// ORDEM DE REGISTRO IMPORTA: chamar depois de
// app.use('/api/ia-service-externo', requireSessaoExterna) — ver externo-routes.js.

const chatService = require('../services/chat-interno-service');
const realtime = require('../services/chat-interno-realtime');

const BASE = '/api/ia-service-externo/chat-interno';

function _handleErro(res, err) {
  const status = err.status || (/obrigatóri|inválid|vazia|limite/i.test(err.message) ? 400 : 500);
  res.status(status).json({ error: err.message });
}

module.exports = function registrarChatInterno(app) {
  const eu = (req) => req.svcConsultorExterno;

  app.get(`${BASE}/contatos`, (req, res) => {
    try {
      res.json(chatService.listarContatos(req.svcEmpresaId, eu(req)));
    } catch (err) { _handleErro(res, err); }
  });

  app.post(`${BASE}/conversas`, (req, res) => {
    try {
      const conversaId = chatService.abrirConversaDireta(req.svcEmpresaId, eu(req), req.body?.consultorId);
      res.json({ conversaId });
    } catch (err) { _handleErro(res, err); }
  });

  app.get(`${BASE}/conversas/:conversaId/mensagens`, (req, res) => {
    try {
      res.json(chatService.listarMensagens(req.svcEmpresaId, eu(req), req.params.conversaId, { antesDe: req.query.antesDe || null }));
    } catch (err) { _handleErro(res, err); }
  });

  app.post(`${BASE}/conversas/:conversaId/mensagens`, (req, res) => {
    try {
      const enviado = chatService.enviarMensagem(req.svcEmpresaId, eu(req), req.params.conversaId, req.body?.texto);
      realtime.emitirMensagem(req.svcEmpresaId, enviado);
      res.status(201).json({ ...enviado.mensagem, minha: true });
    } catch (err) { _handleErro(res, err); }
  });

  app.patch(`${BASE}/conversas/:conversaId/mensagens/:mensagemId`, (req, res) => {
    try {
      const alterada = chatService.editarMensagem(req.svcEmpresaId, eu(req), req.params.conversaId, req.params.mensagemId, req.body?.texto);
      realtime.emitirMensagem(req.svcEmpresaId, alterada, 'chat:mensagem-alterada');
      res.json(alterada.mensagem);
    } catch (err) { _handleErro(res, err); }
  });

  app.delete(`${BASE}/conversas/:conversaId/mensagens/:mensagemId`, (req, res) => {
    try {
      const alterada = chatService.apagarMensagem(req.svcEmpresaId, eu(req), req.params.conversaId, req.params.mensagemId);
      realtime.emitirMensagem(req.svcEmpresaId, alterada, 'chat:mensagem-alterada');
      res.json(alterada.mensagem);
    } catch (err) { _handleErro(res, err); }
  });

  app.post(`${BASE}/conversas/:conversaId/excluir-mensagens`, (req, res) => {
    try {
      const resultado = chatService.excluirMensagens(req.svcEmpresaId, eu(req), req.params.conversaId, req.body);
      if (resultado.alteradas) {
        resultado.alteradas.forEach((alterada) => realtime.emitirMensagem(req.svcEmpresaId, alterada, 'chat:mensagem-alterada'));
        return res.json({ conversaId: resultado.conversaId, mensagens: resultado.alteradas.map((a) => a.mensagem) });
      }
      realtime.emitirExclusaoPessoal(req.svcEmpresaId, eu(req), resultado);
      res.json(resultado);
    } catch (err) { _handleErro(res, err); }
  });

  app.post(`${BASE}/conversas/:conversaId/vistas`, (req, res) => {
    try {
      const grupos = chatService.marcarVistas(req.svcEmpresaId, eu(req), req.params.conversaId);
      realtime.emitirRecibos(req.svcEmpresaId, grupos);
      res.json({ ok: true });
    } catch (err) { _handleErro(res, err); }
  });

  app.post(`${BASE}/entregues`, (req, res) => {
    try {
      const ids = Array.isArray(req.body?.mensagemIds) ? req.body.mensagemIds : null;
      realtime.emitirRecibos(req.svcEmpresaId, chatService.marcarEntregues(req.svcEmpresaId, eu(req), ids));
      res.json({ ok: true });
    } catch (err) { _handleErro(res, err); }
  });

  app.post(`${BASE}/para-todos`, (req, res) => {
    try {
      const enviados = chatService.enviarParaTodos(req.svcEmpresaId, eu(req), req.body?.texto);
      enviados.forEach(e => realtime.emitirMensagem(req.svcEmpresaId, e));
      res.status(201).json({ enviados: enviados.length });
    } catch (err) { _handleErro(res, err); }
  });
};
