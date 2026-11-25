'use strict';

// Sessões das pessoas (telas). Token opaco aleatório no cookie; no banco só o
// hash. Validade renovada a cada uso (8 h sem uso derrubam), com teto absoluto
// opcional — mesmo comportamento do chat Protheus do IA Command
// (apps/IA Command/modules/protheus_whatsapp/token-service.js).

const crypto = require('crypto');
const { novoId, agora } = require('../ids');
const { hashSecreto } = require('../seguranca/cifra');
const { Contexto } = require('../repositorios/base');
const config = require('../config');

const COOKIE = 'talk.sid';
const INATIVIDADE_MS = 8 * 60 * 60 * 1000;
const TETO_MS = 7 * 24 * 60 * 60 * 1000; // relogar ao menos 1 vez por semana

const hashToken = (token) => hashSecreto(token, 'sessao');

function criar(db, { usuarioId, empresaId, origem, ip = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const criada = agora();
  db.prepare(`INSERT INTO sessoes (id, token_hash, usuario_id, empresa_id, origem, criada_em, ultimo_uso_em, expira_em, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(novoId('sessao'), hashToken(token), usuarioId, empresaId, origem, criada, criada,
    new Date(Date.now() + INATIVIDADE_MS).toISOString(), ip);
  return token;
}

// Devolve { sessao, usuario, membro } válidos ou null. Renova a validade.
function validar(db, token, { agoraMs = Date.now() } = {}) {
  if (!token) return null;
  const s = db.prepare(`
    SELECT s.*, u.nome AS usuario_nome, u.telefone, u.administrador_plataforma, u.situacao AS usuario_situacao,
           e.situacao AS empresa_situacao, m.papel, m.situacao AS membro_situacao
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      JOIN empresas e ON e.id = s.empresa_id
      LEFT JOIN membros m ON m.usuario_id = s.usuario_id AND m.empresa_id = s.empresa_id
     WHERE s.token_hash = ?`).get(hashToken(token));
  if (!s || s.revogada_em) return null;
  if (Date.parse(s.expira_em) <= agoraMs || Date.parse(s.criada_em) + TETO_MS <= agoraMs) return null;
  if (s.usuario_situacao !== 'ativo' || s.empresa_situacao !== 'ativa') return null;
  // Sem vínculo ativo com a empresa só entra quem administra a plataforma.
  if ((!s.papel || s.membro_situacao !== 'ativo') && !s.administrador_plataforma) return null;
  const agoraIso = new Date(agoraMs).toISOString();
  db.prepare('UPDATE sessoes SET ultimo_uso_em = ?, expira_em = ? WHERE id = ?')
    .run(agoraIso, new Date(agoraMs + INATIVIDADE_MS).toISOString(), s.id);
  return s;
}

function revogar(db, sessaoId) {
  db.prepare('UPDATE sessoes SET revogada_em = COALESCE(revogada_em, ?) WHERE id = ?').run(agora(), sessaoId);
}

// Usuário inativado, removido da empresa ou trocou de papel: derruba as sessões.
function revogarDoUsuario(db, usuarioId, { empresaId = null } = {}) {
  const r = empresaId
    ? db.prepare('UPDATE sessoes SET revogada_em = ? WHERE usuario_id = ? AND empresa_id = ? AND revogada_em IS NULL').run(agora(), usuarioId, empresaId)
    : db.prepare('UPDATE sessoes SET revogada_em = ? WHERE usuario_id = ? AND revogada_em IS NULL').run(agora(), usuarioId);
  return r.changes;
}

function trocarEmpresa(db, sessaoId, empresaId) {
  db.prepare('UPDATE sessoes SET empresa_id = ? WHERE id = ?').run(empresaId, sessaoId);
}

function contextoDaSessao(s) {
  return new Contexto({
    empresaId: s.empresa_id,
    usuarioId: s.usuario_id,
    papel: s.papel || (s.administrador_plataforma ? 'admin_empresa' : null),
    plataforma: !!s.administrador_plataforma,
  });
}

function opcoesCookie(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // atrás do nginx com HTTPS (trust proxy) = true
    path: config.BASE_PATH,
    maxAge: TETO_MS,
  };
}

function lerCookie(req) {
  const bruto = String(req.headers.cookie || '');
  for (const parte of bruto.split(';')) {
    const [nome, ...resto] = parte.trim().split('=');
    if (nome === COOKIE) return decodeURIComponent(resto.join('='));
  }
  return null;
}

module.exports = { COOKIE, INATIVIDADE_MS, TETO_MS, criar, validar, revogar, revogarDoUsuario, trocarEmpresa, contextoDaSessao, opcoesCookie, lerCookie };
