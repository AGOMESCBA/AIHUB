// Tempo real do Chat interno (Socket.IO, namespace próprio). O banco é a
// fonte da verdade (chat-interno-service); o socket só AVISA. Se o socket
// cair, nada se perde: a tela sincroniza pela API ao reconectar e, enquanto
// estiver sem socket, consulta a API no ciclo de 30s.
//
// Produção roda em 1 processo (serviço NSSM com index.js) — salas em memória
// são suficientes. Se um dia houver mais de um processo, trocar por um
// adapter compartilhado do Socket.IO.
//
// Autenticação: o mesmo token de telefone do J2A (handshake.auth.token),
// validado por login-externo-service. A cada 60s os sockets cuja sessão
// expirou/foi encerrada (Sair, Limpar do Monitor) são desconectados — sem
// renovar a sessão (sessaoExternaAtiva).

const loginExternoService = require('./login-externo-service');
const chatService = require('./chat-interno-service');

const NAMESPACE = '/ia-service-chat';
let _ns = null;

function _sala(empresaId, consultorId) {
  return `e${Number(empresaId)}:c${String(consultorId)}`;
}

function emitirParaConsultor(empresaId, consultorId, evento, payload) {
  if (!_ns || !consultorId) return;
  _ns.to(_sala(empresaId, consultorId)).emit(evento, payload);
}

// Avisa cada remetente que suas mensagens foram entregues/vistas.
function emitirRecibos(empresaId, grupos) {
  for (const g of grupos || []) {
    emitirParaConsultor(empresaId, g.remetenteId, 'chat:recibo', { conversaId: g.conversaId, tipo: g.tipo, em: g.em, mensagemIds: g.mensagemIds });
  }
}

function emitirMensagem(empresaId, { mensagem, destinatario }) {
  if (destinatario) emitirParaConsultor(empresaId, destinatario, 'chat:mensagem', { ...mensagem, minha: false });
  // Outras abas/aparelhos de quem enviou também recebem (modelo WhatsApp).
  emitirParaConsultor(empresaId, mensagem.remetenteId, 'chat:mensagem', { ...mensagem, minha: true });
}

function iniciar(io) {
  if (_ns || !io) return;
  _ns = io.of(NAMESPACE);

  _ns.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const sessao = token ? loginExternoService.validarSessaoExterna(String(token)) : null;
    if (!sessao) return next(new Error('nao_autorizado'));
    socket.data.empresaId = sessao.empresaId;
    socket.data.consultorId = sessao.consultorId;
    socket.data.sessaoId = sessao.sessaoId;
    next();
  });

  _ns.on('connection', (socket) => {
    const { empresaId, consultorId } = socket.data;
    socket.join(_sala(empresaId, consultorId));

    socket.on('chat:entregue', (payload) => {
      try {
        if (!loginExternoService.sessaoExternaAtiva(socket.data.sessaoId)) return socket.disconnect(true);
        const ids = Array.isArray(payload?.mensagemIds) ? payload.mensagemIds : null;
        emitirRecibos(empresaId, chatService.marcarEntregues(empresaId, consultorId, ids));
      } catch (_) { /* recibo é melhor esforço; a API sincroniza depois */ }
    });
  });

  setInterval(() => {
    for (const socket of _ns.sockets.values()) {
      if (!loginExternoService.sessaoExternaAtiva(socket.data.sessaoId)) socket.disconnect(true);
    }
  }, 60 * 1000).unref();
}

module.exports = { iniciar, emitirMensagem, emitirRecibos, NAMESPACE };
