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
const { Atendimento } = require('./atendimento/servico');
const repoAtd = require('./atendimento/repositorio');

const REVALIDAR_MS = 60_000;

function lerCookieDoHandshake(socket) {
  return sessoes.lerCookie({ headers: { cookie: socket.handshake.headers.cookie || '' } });
}

function configurarTempoReal(ns, { db, supervisor, atendimento = null }) {
  const C = EVENTOS_SOCKET.cliente;
  const S = EVENTOS_SOCKET.servidor;

  ns.use((socket, next) => {
    const s = sessoes.validar(db, lerCookieDoHandshake(socket));
    if (!s) return next(new Error('nao_autenticado'));
    socket.data.sessaoId = s.id;
    socket.data.empresaId = s.empresa_id;
    socket.data.rotinas = rotinasDaSessao(s);
    // Atendimento (C9): quem é e o que vê (supervisão vê tudo; atendente, os setores dele).
    socket.data.acesso = Atendimento.acessoDe(sessoes.contextoDaSessao(s), socket.data.rotinas);
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
    // Painel/Mensagens: sala da empresa da sessão (nunca recebe mensagens de outra empresa).
    socket.on(C.assinarPainel, () => {
      if (!socket.data.rotinas.includes(ROTINAS.mensagens) && !socket.data.rotinas.includes(ROTINAS.painel)) return;
      socket.join(`painel:${socket.data.empresaId}`);
    });
    // Central de atendimento: contadores na hora; conversa só se a pessoa pode vê-la.
    socket.on(C.assinarAtendimento, () => {
      if (!atendimento || !socket.data.rotinas.includes(ROTINAS.atendimento)) return socket.emit(S.erro, { codigo: 'sem_permissao', mensagem: 'Sem permissão para o atendimento.' });
      socket.join(`atd:${socket.data.empresaId}`);
      socket.emit(S.contadoresAtendimento, atendimento.contadores(socket.data.acesso));
    });
    socket.on(C.assinarConversa, ({ conversa_id } = {}) => {
      const cv = atendimento && socket.data.rotinas.includes(ROTINAS.atendimento) ? repoAtd.buscarConversa(db, socket.data.empresaId, conversa_id) : null;
      if (!cv || !atendimento.podeVer(socket.data.acesso, cv)) return socket.emit(S.erro, { codigo: 'nao_encontrado', mensagem: 'Conversa não encontrada.' });
      socket.join(`conversa:${cv.id}`);
    });
    socket.on(C.sairConversa, ({ conversa_id } = {}) => socket.leave(`conversa:${conversa_id}`));
  });

  const t = setInterval(async () => {
    for (const socket of await ns.fetchSockets()) {
      const s = db.prepare('SELECT revogada_em, expira_em FROM sessoes WHERE id = ?').get(socket.data.sessaoId);
      if (!s || s.revogada_em || Date.parse(s.expira_em) <= Date.now()) socket.disconnect(true);
    }
  }, REVALIDAR_MS);
  t.unref?.();

  // empresaId: também avisa o painel daquela empresa (estado das mensagens dela).
  return (canalId, evento, dados, { empresaId } = {}) => {
    ns.to(`canal:${canalId}`).emit(evento, dados);
    if (empresaId) ns.to(`painel:${empresaId}`).emit(evento, dados);
  };
}

// Avisos do atendimento (C9), conferindo a visibilidade de cada socket: quem não vê mais a
// conversa recebe só conversa:saiu { id } e sai da sala dela (texto nunca vaza para quem não vê).
function avisosDoAtendimento(ns, { db, atendimento }) {
  const S = EVENTOS_SOCKET.servidor;
  const seguro = (fn) => (...a) => { Promise.resolve().then(() => fn(...a)).catch(() => { /* aviso perdido: a tela recarrega pela API */ }); };
  return {
    aoMudar: seguro(async (conversaId, { empresaId }) => {
      const cv = repoAtd.buscarConversa(db, empresaId, conversaId);
      if (!cv) return;
      const resumo = repoAtd.paraConversaResumo(db, cv);
      for (const sk of await ns.in(`atd:${empresaId}`).fetchSockets()) {
        if (atendimento.podeVer(sk.data.acesso, cv)) sk.emit(S.conversaAtualizada, resumo);
        else sk.emit(S.conversaSaiu, { id: cv.id });
        sk.emit(S.contadoresAtendimento, atendimento.contadores(sk.data.acesso));
      }
      for (const sk of await ns.in(`conversa:${cv.id}`).fetchSockets()) {
        if (!atendimento.podeVer(sk.data.acesso, cv)) { sk.leave(`conversa:${cv.id}`); sk.emit(S.conversaSaiu, { id: cv.id }); }
      }
    }),
    // Item (com texto) e estado: confere de novo quem pode ver, porque numa transferência o
    // item chega antes de a sala ser limpa — a nota interna não pode ir para quem perdeu o acesso.
    aoItem: seguro((conversaId, item) => paraQuemVe(conversaId, S.itemConversa, { conversa_id: conversaId, item })),
    aoEstadoItem: seguro((conversaId, dados) => paraQuemVe(conversaId, S.estadoItemConversa, dados)),
  };

  async function paraQuemVe(conversaId, evento, corpo) {
    const sockets = await ns.in(`conversa:${conversaId}`).fetchSockets();
    if (!sockets.length) return;
    const cv = db.prepare('SELECT empresa_id FROM conversas WHERE id = ?').get(conversaId);
    const completa = cv && repoAtd.buscarConversa(db, cv.empresa_id, conversaId);
    for (const sk of sockets) if (completa && atendimento.podeVer(sk.data.acesso, completa)) sk.emit(evento, corpo);
  }
}

module.exports = { configurarTempoReal, avisosDoAtendimento };
