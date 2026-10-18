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
const presencaService = require('./presenca-service');

const NAMESPACE = '/ia-service-chat';
// Tolerância antes de marcar "saiu": recarregar a página (F5) derruba e
// reconecta o socket em ~1-2s e não pode aparecer como saída.
const TOLERANCIA_SAIDA_MS = 8 * 1000;
let _ns = null;
const _saidasPendentes = new Map(); // sessaoId -> timeout

function _socketsDaSessao(sessaoId) {
  if (!_ns) return [];
  return [..._ns.sockets.values()].filter((s) => s.data.sessaoId === sessaoId);
}

/**
 * Derrubar pelo Monitor: avisa a tela (que volta para o login na hora) e
 * fecha os sockets das sessões encerradas.
 */
function encerrarSessoes(sessaoIds, mensagem = 'Sua sessão foi encerrada pelo administrador.') {
  const ids = new Set((sessaoIds || []).map(String));
  if (!_ns || !ids.size) return 0;
  let n = 0;
  for (const socket of _ns.sockets.values()) {
    if (!ids.has(String(socket.data.sessaoId))) continue;
    socket.emit('sessao:encerrada', { mensagem });
    socket.disconnect(true);
    n += 1;
  }
  return n;
}

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
    const { empresaId, consultorId, sessaoId } = socket.data;
    socket.join(_sala(empresaId, consultorId));
    clearTimeout(_saidasPendentes.get(sessaoId));
    _saidasPendentes.delete(sessaoId);

    // Saída detectada pelo SERVIDOR: aba/navegador fechado, logoff, queda de
    // internet ou PC suspenso derrubam o socket — não depende de a página
    // conseguir avisar (pagehide falha em fechamento brusco e em abas com
    // código antigo). Sem outro socket da mesma sessão após a tolerância,
    // o Monitor de Acessos passa a mostrar "Fora da tela" na hora.
    socket.on('disconnect', () => {
      if (_socketsDaSessao(sessaoId).length) return;
      clearTimeout(_saidasPendentes.get(sessaoId));
      _saidasPendentes.set(sessaoId, setTimeout(() => {
        _saidasPendentes.delete(sessaoId);
        if (_socketsDaSessao(sessaoId).length) return;
        try { presencaService.registrarSaida({ empresaId, origem: 'chat', sessaoRef: sessaoId }); } catch (_) { /* melhor esforço */ }
      }, TOLERANCIA_SAIDA_MS));
    });

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

module.exports = { iniciar, emitirMensagem, emitirRecibos, encerrarSessoes, NAMESPACE };
