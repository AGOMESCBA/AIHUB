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
//
// 2026-09: login passou de "por empresa" (URL /entrar-servico/:slug travava
// a empresa antes do telefone) para "por telefone puro" — mesma mecânica de
// resolverEmpresaDoCanal() do IA Command (channel-store.js:297-348): um
// telefone pode ter consultor em N empresas, resolve direto se for só 1,
// pergunta se for mais. A escolha de empresa e a troca posterior dentro do
// chat NUNCA pedem novo OTP — o telefone já foi validado uma vez.

const crypto = require('crypto');
const { getDB } = require('../database');
const consultorRepo = require('../repositories/consultor-repository');
const crud = require('../../../IAHUB/backend/crud');

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
 * Resolve todas as empresas às quais um telefone tem acesso via consultor
 * ativo — equivalente ao filtro de senderAutorizadoEmpresa do IA Command,
 * mas no domínio de `consultores`. Retorna [] se o telefone não é
 * consultor de nenhuma empresa (chamador decide a mensagem de erro).
 */
function listarEmpresasDoTelefone(telefoneBruto) {
  const telefone = normalizarTelefone(telefoneBruto);
  if (!telefone) return [];
  const consultores = consultorRepo.listarConsultoresPorTelefoneNormalizado(telefone, normalizarTelefone);
  return consultores
    .map(c => {
      const empresa = crud.buscarPorId('empresas', c.empresaId);
      if (!empresa) return null;
      return { id: c.empresaId, nome: empresa.razao_social || empresa.nome || `Empresa #${c.empresaId}`, consultorId: c.id };
    })
    .filter(Boolean);
}

/**
 * Inicia o login: localiza o(s) consultor(es) pelo telefone em QUALQUER
 * empresa (não recebe mais empresaId — a empresa só é conhecida depois de
 * validar o código, ver verificarLogin), gera um código de 6 dígitos, grava
 * só o hash, e pede ao chamador (rota) para disparar o envio via WhatsApp.
 * Erro genérico quando o telefone não é encontrado — nunca revela se o
 * número existe, mesma cautela do fluxo original do IA Command.
 */
function iniciarLogin(telefoneBruto) {
  const telefone = normalizarTelefone(telefoneBruto);
  if (telefone.length < 10 || telefone.length > 15) {
    throw new Error('Informe o WhatsApp com DDI e DDD.');
  }

  const db = getDB();
  _limparChallengesExpirados(db);

  const empresas = listarEmpresasDoTelefone(telefone);
  if (empresas.length === 0) {
    throw new Error('Número não encontrado ou sem permissão sincronizada.');
  }

  const id = crypto.randomUUID();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + TTL_CODIGO_MS);
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

  db.prepare(`
    INSERT INTO svc_login_challenges (id, telefone, codigo_hash, expira_em, criado_em)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, telefone, _hashCodigo(id, telefone, codigo), expiraEm.toISOString(), agora.toISOString());

  return { challengeId: id, expiraEm: expiraEm.toISOString(), codigo, telefone };
}

/**
 * Valida o código informado contra o challenge — mesma lógica de
 * validarLoginChallenge do IA Command: expira, conta tentativas, marca como
 * usado (nunca reutilizável), hash de comparação com o mesmo sal. Challenge
 * agora é só por telefone (sem empresa_id) — a empresa é resolvida depois.
 */
function _validarChallenge(challengeId, telefoneBruto, codigoBruto) {
  const id = String(challengeId || '').trim();
  const telefone = normalizarTelefone(telefoneBruto);
  const codigo = String(codigoBruto || '').replace(/\D/g, '');
  if (!id || !telefone || codigo.length !== 6) return { ok: false, error: 'Código inválido.' };

  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM svc_login_challenges WHERE id = ? AND telefone = ?
  `).get(id, telefone);
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

function _emitirSessao(empresaId, consultorId) {
  const db = getDB();
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + TTL_SESSAO_MS);
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), consultorId, _hashToken(token), expiraEm.toISOString(), agora.toISOString(), agora.toISOString());

  return { token, expiraEm: expiraEm.toISOString() };
}

/**
 * Verifica o código e resolve a(s) empresa(s) do telefone (mesma mecânica
 * de resolverEmpresaDoCanal do IA Command): 1 empresa → emite sessão direto;
 * N empresas → NÃO emite sessão ainda, retorna a lista para o front pedir a
 * escolha (ver escolherEmpresa). 0 empresas nunca chega aqui — já barrado em
 * iniciarLogin.
 */
function verificarLogin(challengeId, telefoneBruto, codigoBruto) {
  const validacao = _validarChallenge(challengeId, telefoneBruto, codigoBruto);
  if (!validacao.ok) throw new Error(validacao.error);

  const empresas = listarEmpresasDoTelefone(validacao.telefone);
  if (empresas.length === 0) throw new Error('Permissão sincronizada não encontrada.');

  if (empresas.length > 1) {
    return { escolhaEmpresa: true, telefone: validacao.telefone, empresas: empresas.map(e => ({ id: e.id, nome: e.nome })) };
  }

  const unica = empresas[0];
  const sessao = _emitirSessao(unica.id, unica.consultorId);
  return { escolhaEmpresa: false, token: sessao.token, expiraEm: sessao.expiraEm, empresaId: unica.id, consultorId: unica.consultorId };
}

/**
 * Emite a sessão depois que o telefone já foi validado por OTP e o usuário
 * escolheu qual das N empresas quer acessar (tela de escolha em entrar.html).
 * Reconfirma que o telefone de fato tem consultor ativo naquela empresa —
 * nunca confia cegamente no empresaId vindo do cliente.
 */
function escolherEmpresa(telefoneBruto, empresaId) {
  const telefone = normalizarTelefone(telefoneBruto);
  const empresas = listarEmpresasDoTelefone(telefone);
  const escolhida = empresas.find(e => Number(e.id) === Number(empresaId));
  if (!escolhida) throw new Error('Empresa não disponível para este telefone.');

  const sessao = _emitirSessao(escolhida.id, escolhida.consultorId);
  return { token: sessao.token, expiraEm: sessao.expiraEm, empresaId: escolhida.id, consultorId: escolhida.consultorId };
}

/**
 * Troca a empresa ativa de uma sessão externa já autenticada — SEM novo OTP,
 * igual ao IA Command (o telefone já foi validado uma vez; trocar de
 * empresa não é uma nova identidade, é o mesmo consultor mudando de
 * contexto). Reconfirma, a partir do telefone da sessão atual, que ele tem
 * consultor ativo na empresa de destino antes de emitir o novo token —
 * nunca aceita um empresaId arbitrário só porque o token atual é válido.
 */
function trocarEmpresa(tokenAtual, novoEmpresaId) {
  const sessaoAtual = validarSessaoExterna(tokenAtual);
  if (!sessaoAtual) throw new Error('Sessão externa inválida ou expirada.');

  const consultorAtual = consultorRepo.getConsultor(sessaoAtual.empresaId, sessaoAtual.consultorId);
  if (!consultorAtual?.telefone) throw new Error('Consultor sem telefone vinculado.');

  const empresas = listarEmpresasDoTelefone(consultorAtual.telefone);
  const destino = empresas.find(e => Number(e.id) === Number(novoEmpresaId));
  if (!destino) throw new Error('Empresa não disponível para este telefone.');

  const sessao = _emitirSessao(destino.id, destino.consultorId);
  return { token: sessao.token, expiraEm: sessao.expiraEm, empresaId: destino.id, consultorId: destino.consultorId };
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
  listarEmpresasDoTelefone,
  iniciarLogin,
  verificarLogin,
  escolherEmpresa,
  trocarEmpresa,
  validarSessaoExterna,
  TTL_CODIGO_MS,
  MAX_TENTATIVAS,
};
