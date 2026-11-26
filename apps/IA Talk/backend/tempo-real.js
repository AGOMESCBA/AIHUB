'use strict';

// Socket.IO do Talk (path /app/ia-talk/socket.io, namespace /talk). O banco é a
// fonte da verdade; o socket só avisa (mesmo princípio do chat do IA Service,
// apps/IA Service/backend/services/chat-interno-realtime.js): a tela carrega
// pela API e usa o socket para atualizar. Autenticação pelo cookie da sessão
// do Talk, revalidada a cada 60 s (sessão encerrada derruba o socket).

const sessoes = require('./acesso/sessoes');
const { rotinasDaSessao, ROTINAS } = require('./acesso/papeis');
const { SQL_VISIVEIS } = require('./rotas/canais');
const { EVENTOS_SOCKET } = require('./contratos');

const REVALIDAR_MS = 60_000;

function lerCookieDoHandshake(socket) {
  return sessoes.lerCookie({ headers: { cookie: socket.handshake.headers.cookie || '' } });
}

function configurarTempoReal(ns, { db, supervisor }) {
  const C = EVENTOS_SOCKET.cliente;
  const S = EVENTOS_SOCKET.servidor;

  ns.use((socket, next) => {
    const s = sessoes.validar(db, lerCookieDoHandshake(socket));
    if (!s) return next(new Error('nao_autenticado'));
    socket.data.sessaoId = s.id;
    socket.data.empresaId = s.empresa_id;
    socket.data.rotinas = rotinasDaSessao(s);
    next();
  });

  ns.on('connection', (socket) => {
    socket.on(C.assinarCanal, ({ canal_id } = {}) => {
      if (!socket.data.rotinas.includes(ROTINAS.canais)) return socket.emit(S.erro, { codigo: 'sem_permissao', mensagem: 'Sem permissão para canais.' });
      const c = db.prepare(`SELECT * FROM (${SQL_VISIVEIS.replace(/@empresa_id/g, '?')}) WHERE id = ?`).get(socket.data.empresaId, socket.data.empresaId, String(canal_id || ''));
      if (!c) return socket.emit(S.erro, { codigo: 'nao_encontrado', mensagem: 'Canal não encontrado.' });
      socket.join(`canal:${c.id}`);
      socket.emit(S.estadoCanal, { canal_id: c.id, estado: c.estado, em: c.estado_desde });
      const q = c.estado === 'qr_pendente' ? supervisor.qrAtual(c.id) : null;
      if (q) socket.emit(S.qrCanal, { canal_id: c.id, ...q });
    });
    socket.on(C.sairCanal, ({ canal_id } = {}) => socket.leave(`canal:${canal_id}`));
  });

  const t = setInterval(async () => {
    for (const socket of await ns.fetchSockets()) {
      const s = db.prepare('SELECT revogada_em, expira_em FROM sessoes WHERE id = ?').get(socket.data.sessaoId);
      if (!s || s.revogada_em || Date.parse(s.expira_em) <= Date.now()) socket.disconnect(true);
    }
  }, REVALIDAR_MS);
  t.unref?.();

  return (canalId, evento, dados) => ns.to(`canal:${canalId}`).emit(evento, dados);
}

module.exports = { configurarTempoReal };
