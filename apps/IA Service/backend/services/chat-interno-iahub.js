// Chat interno pelo login do IAHub (Monitor de Acessos, 2026-10-28).
//
// O chat nasceu no J2A (sessão externa por telefone). No Monitor, quem usa é
// o usuário do IAHub, e ele conversa COMO o seu cadastro de analista na
// empresa (consultores.usuario_id_iahub) — sem remetente "sistema" e sem
// tabela nova: são as mesmas conversas do J2A dele.
//
// Mesmas exigências das rotas internas do IA Service, conferidas aqui também
// para o tempo real (o socket não passa pela cadeia do Express): sessão do
// IAHub autenticada, empresa e sistema liberados (resolveEmpresaId), rotina
// do Monitor, sem desconexão pendente e com analista ativo na empresa.

const consultorRepo = require('../repositories/consultor-repository');
const permissoesDb = require('../../../IAHUB/backend/permissoes/database');
const presencaService = require('./presenca-service');
const { resolveEmpresaId } = require('./empresa-context');

const ROTINA = 'svc-monitor-acessos';
const SEM_ANALISTA = 'Seu usuário não tem número ativo no chat desta empresa. Cadastre seu telefone em Números Autorizados para usar as mensagens.';

function _erro(msg, status) {
  return Object.assign(new Error(msg), { status });
}

/** Analista (consultores.id) do usuário do IAHub na empresa; lança 409 se não houver. */
function consultorDoUsuario(empresaId, usuarioId) {
  const consultor = usuarioId ? consultorRepo.getConsultorPorUsuario(Number(empresaId), Number(usuarioId)) : null;
  if (!consultor?.ativo) throw _erro(SEM_ANALISTA, 409);
  return String(consultor.id);
}

/**
 * Validação completa para o socket. `req` = socket.request já com a sessão
 * carregada. Devolve { empresaId, consultorId } ou lança (status 401/403/409).
 */
function identidadeDoSocket(req, empresaIdPedido) {
  const session = req.session;
  if (!session?.authenticated || !session.user_id) throw _erro('Não autenticado.', 401);
  if (presencaService.desconexaoPendente(req.sessionID)) throw _erro('Desconectado pelo administrador.', 403);
  const ctx = resolveEmpresaId({ session, query: { empresa_id: empresaIdPedido }, body: {} });
  if (!ctx.ok) throw _erro(ctx.error, ctx.status || 403);
  if (session.role !== 'admin') {
    const rotinas = permissoesDb.getRotinas(Number(session.user_id), ctx.empresaId);
    if (!Array.isArray(rotinas) || !rotinas.includes(ROTINA)) throw _erro('Usuário sem permissão para esta rotina.', 403);
  }
  return { empresaId: ctx.empresaId, consultorId: consultorDoUsuario(ctx.empresaId, session.user_id) };
}

module.exports = { consultorDoUsuario, identidadeDoSocket, ROTINA };
