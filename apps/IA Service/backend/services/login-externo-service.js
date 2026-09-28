// Login externo por telefone/WhatsApp — canal alternativo ao login do IA HUB,
// para consultores que preferem entrar direto pelo telefone sem sessão
// completa do IAHub. Modelo replicado FIELMENTE de
// apps/IA Command/modules/protheus_whatsapp/routes.js (criarLoginChallenge/
// validarLoginChallenge/tokenService) — mesmos parâmetros de segurança
// (TTL, máximo de tentativas, hash do código com sal por challenge), mas
// aplicado ao domínio de `consultores` do IA Service em vez de usuários
// Protheus. NUNCA reimporta módulos do IA Command (bancos/módulos
// fisicamente separados, regra do projeto) — só consome, via HTTP, a rota
// nova e isolada de envio de WhatsApp (ver README da Frente A no plano).

const crypto = require('crypto');
const { getDB } = require('../database');
const consultorRepo = require('../repositories/consultor-repository');

const TTL_CODIGO_MS = 5 * 60 * 1000; // 5 minutos — mesmo default do IA Command
const MAX_TENTATIVAS = 5; // mesmo default do IA Command
const TTL_SESSAO_MS = 8 * 60 * 60 * 1000; // 8 horas — mesmo default do token-service do IA Command

function normalizarTelefone(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function _hashCodigo(challengeId, telefone, codigo) {
  const segredo = process.env.SVC_WHATSAPP_OTP_SECRET || process.env.SESSION_SECRET || 'iahub';
  return crypto.createHash('sha256').update(`${challengeId}:${telefone}:${codigo}:${segredo}`).digest('hex');
}

function _hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function _limparChallengesExpirados(db) {
  db.prepare(`
    DELETE FROM svc_login_challenges
     WHERE expira_em < ? OR usado_em IS NOT NULL
  `).run(new Date(Date.now() - 60 * 60 * 1000).toISOString());
}

/**
 * Inicia o login: localiza o consultor pelo telefone (escopado por empresa —
 * nunca cross-tenant), gera um código de 6 dígitos, grava só o hash, e pede
 * ao chamador (rota) para disparar o envio via WhatsApp. Erro genérico
 * quando o telefone não é encontrado — nunca revela se o número existe,
 * mesma cautela do fluxo original do IA Command.
 */
function iniciarLogin(empresaId, telefoneBruto) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const telefone = normalizarTelefone(telefoneBruto);
  if (telefone.length < 10 || telefone.length > 15) {
    throw new Error('Informe o WhatsApp com DDI e DDD.');
  }

  const db = getDB();
  _limparChallengesExpirados(db);

  const consultores = consultorRepo.listarConsultores(empresaId, { ativo: true });
  const consultor = consultores.find(c => normalizarTelefone(c.telefone) === telefone);
  if (!consultor) {
    throw new Error('Número não encontrado ou sem permissão sincronizada.');
  }

  const id = crypto.randomUUID();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + TTL_CODIGO_MS);
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

  db.prepare(`
    INSERT INTO svc_login_challenges (id, empresa_id, telefone, codigo_hash, expira_em, criado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), telefone, _hashCodigo(id, telefone, codigo), expiraEm.toISOString(), agora.toISOString());

  return { challengeId: id, expiraEm: expiraEm.toISOString(), codigo, telefone, consultorNome: `Usuário #${consultor.usuarioIdIahub}` };
}

/**
 * Valida o código informado contra o challenge — mesma lógica de
 * validarLoginChallenge do IA Command: expira, conta tentativas, marca como
 * usado (nunca reutilizável), hash de comparação com o mesmo sal.
 */
function _validarChallenge(empresaId, challengeId, telefoneBruto, codigoBruto) {
  const id = String(challengeId || '').trim();
  const telefone = normalizarTelefone(telefoneBruto);
  const codigo = String(codigoBruto || '').replace(/\D/g, '');
  if (!id || !telefone || codigo.length !== 6) return { ok: false, error: 'Código inválido.' };

  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM svc_login_challenges WHERE id = ? AND empresa_id = ? AND telefone = ?
  `).get(id, Number(empresaId), telefone);
  if (!row || row.usado_em) return { ok: false, error: 'Código expirado ou inválido.' };
  if (new Date(row.expira_em).getTime() < Date.now()) return { ok: false, error: 'Código expirado.' };
  if (Number(row.tentativas || 0) >= MAX_TENTATIVAS) return { ok: false, error: 'Limite de tentativas excedido.' };

  const informado = _hashCodigo(id, telefone, codigo);
  if (informado !== row.codigo_hash) {
    db.prepare(`UPDATE svc_login_challenges SET tentativas = tentativas + 1 WHERE id = ?`).run(id);
    return { ok: false, error: 'Código inválido.' };
  }

  db.prepare(`UPDATE svc_login_challenges SET usado_em = ? WHERE id = ?`).run(new Date().toISOString(), id);
  return { ok: true, telefone };
}

/**
 * Verifica o código e, se válido, emite um token de sessão externa opaco
 * (só o hash é persistido — mesmo padrão de protheus_chat_tokens).
 */
function verificarLogin(empresaId, challengeId, telefoneBruto, codigoBruto) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const validacao = _validarChallenge(empresaId, challengeId, telefoneBruto, codigoBruto);
  if (!validacao.ok) throw new Error(validacao.error);

  const consultores = consultorRepo.listarConsultores(empresaId, { ativo: true });
  const consultor = consultores.find(c => normalizarTelefone(c.telefone) === validacao.telefone);
  if (!consultor) throw new Error('Permissão sincronizada não encontrada.');

  const db = getDB();
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + TTL_SESSAO_MS);
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), consultor.id, _hashToken(token), expiraEm.toISOString(), agora.toISOString(), agora.toISOString());

  return { token, expiraEm: expiraEm.toISOString(), consultorId: consultor.id };
}

/**
 * Resolve e renova uma sessão externa a partir do token opaco (nunca
 * comparado em texto plano — sempre por hash). Renova o TTL por atividade,
 * mesmo padrão do token-service do IA Command.
 */
function validarSessaoExterna(token) {
  if (!token) return null;
  const db = getDB();
  const row = db.prepare(`SELECT * FROM svc_sessoes_externas WHERE token_hash = ?`).get(_hashToken(token));
  if (!row) return null;
  if (new Date(row.expira_em).getTime() < Date.now()) return null;

  const agora = new Date();
  const novaExpiracao = new Date(agora.getTime() + TTL_SESSAO_MS);
  db.prepare(`UPDATE svc_sessoes_externas SET ultimo_acesso_em = ?, expira_em = ? WHERE id = ?`)
    .run(agora.toISOString(), novaExpiracao.toISOString(), row.id);

  return { empresaId: row.empresa_id, consultorId: row.consultor_id };
}

module.exports = {
  normalizarTelefone,
  iniciarLogin,
  verificarLogin,
  validarSessaoExterna,
  TTL_CODIGO_MS,
  MAX_TENTATIVAS,
};
