'use strict';

// Números Autorizados vistos SÓ pelo lado do IA Service (2026-10-28, pedido do
// usuário: manter os números pelo menu do IA Service, sem dar acesso ao painel
// de Administração). Mesmo cadastro da Platform que o login por telefone lê
// (platform-store.listarIaServicePorTelefone) — sem tabela nova, sem cópia.
//
// Regras (decisão explícita do usuário):
// - só enxerga/edita números que têm o vínculo 'ia-service/chat-web';
// - nunca cria, altera ou remove vínculos de outro sistema (ex.: IA Command);
// - não exclui: "Inativar" desliga só o vínculo do IA Service (liberado = 0).
//   O cadastro do número (ativo geral) continua sendo do painel de Administração;
// - nome/telefone/observações de um número que também é usado por outro
//   sistema ficam somente leitura aqui (trocar o telefone mudaria o acesso do
//   outro sistema também);
// - todo vínculo gravado por aqui passa a ser manual (origem limpa): a
//   importação do IA Command respeita vínculo manual e não reativa o que foi
//   inativado nesta tela (ver platform-import-ia-command.js, chatWebManual).

const crypto = require('crypto');
const { getDB } = require('./platform-store');
const { normalizarEstilo, validarEstilo } = require('./estilos-resposta');

const PAPEIS = Object.freeze(['analista', 'gestor']);
const ROTULO_SISTEMA = { 'ia-command': 'IA Command', 'ia-service': 'IA Service' };

function _erro(status, msg) {
  return Object.assign(new Error(msg), { status });
}

function _json(v, fallback = {}) {
  try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
}

function _ehChatWeb(r) {
  return String(r.sistema || '').toLowerCase() === 'ia-service' && String(r.modulo || '').toLowerCase() === 'chat-web';
}

function _normalizarTelefone(v) {
  return String(v || '').replace(/\D/g, '');
}

function _rolesDa(db, empresaId, identityId) {
  return db.prepare('SELECT * FROM platform_identity_roles WHERE empresa_id = ? AND identity_id = ?').all(empresaId, identityId);
}

function _paraTela(identity, roles) {
  const meta = _json(identity.metadata_json);
  const svc = meta.iaService || {};
  const chatWeb = roles.filter(_ehChatWeb);
  const role = chatWeb[0] || {};
  const roleMeta = _json(role.metadata_json);
  const outros = [...new Set(roles.filter(r => !_ehChatWeb(r)).map(r => ROTULO_SISTEMA[String(r.sistema || '').toLowerCase()] || r.sistema))];
  const liberado = chatWeb.some(r => Number(r.liberado) !== 0);
  const ativoCadastro = Number(identity.ativo) !== 0;
  return {
    id: identity.id,
    nome: identity.nome,
    numero: identity.numero || identity.numero_normalizado,
    observacoes: identity.observacoes || '',
    ativoCadastro,
    liberado,
    // Vale para o login: precisa do número ativo E do vínculo liberado.
    situacao: !ativoCadastro ? 'inativo_cadastro' : (liberado ? 'ativo' : 'inativo'),
    outrosSistemas: outros,
    compartilhado: outros.length > 0,
    papel: role.papel || svc.papel || 'analista',
    idSoftexpert: svc.idSoftexpert || roleMeta.idSoftexpert || role.codigo_identidade || '',
    usuarioIdIahub: Number(svc.usuarioIdIahub || roleMeta.usuarioIdIahub) || null,
    preAnaliseAutomatica: svc.preAnaliseAutomatica !== false && roleMeta.preAnaliseAutomatica !== false,
    estiloResposta: normalizarEstilo(svc.estiloResposta ?? roleMeta.estiloResposta),
    criadoEm: identity.criado_em || null,
    atualizadoEm: [identity.atualizado_em, ...chatWeb.map(r => r.atualizado_em)].filter(Boolean).sort().pop() || null,
  };
}

function listar(empresaId) {
  const eid = Number(empresaId);
  if (!eid) throw _erro(400, 'Empresa não definida.');
  const db = getDB();
  const ids = db.prepare(`
    SELECT DISTINCT identity_id FROM platform_identity_roles
     WHERE empresa_id = ? AND lower(sistema) = 'ia-service' AND lower(modulo) = 'chat-web'
  `).all(eid).map(r => r.identity_id);
  if (!ids.length) return [];
  const identities = db.prepare(`
    SELECT * FROM platform_whatsapp_identities WHERE empresa_id = ? AND id IN (${ids.map(() => '?').join(',')})
     ORDER BY nome COLLATE NOCASE ASC
  `).all(eid, ...ids);
  const roles = db.prepare(`
    SELECT * FROM platform_identity_roles WHERE empresa_id = ? AND identity_id IN (${ids.map(() => '?').join(',')})
  `).all(eid, ...ids);
  return identities.map(i => _paraTela(i, roles.filter(r => r.identity_id === i.id)));
}

function _dadosIaService(d) {
  const idSoftexpert = String(d.idSoftexpert || '').trim();
  if (!idSoftexpert) throw _erro(400, 'Informe o ID SoftExpert do consultor.');
  if (idSoftexpert.length > 40) throw _erro(400, 'ID SoftExpert inválido.');
  const papel = String(d.papel || 'analista').toLowerCase();
  if (!PAPEIS.includes(papel)) throw _erro(400, 'Perfil inválido.');
  const svc = {
    idSoftexpert,
    papel,
    preAnaliseAutomatica: d.preAnaliseAutomatica !== false,
    estiloResposta: validarEstilo(d.estiloResposta || 'NATURAL'),
  };
  // Ausente = mantém o vínculo atual; vazio = tira o vínculo.
  if (d.usuarioIdIahub !== undefined) {
    const usuario = d.usuarioIdIahub === null || d.usuarioIdIahub === '' ? null : Number(d.usuarioIdIahub);
    if (usuario !== null && !(Number.isInteger(usuario) && usuario > 0)) throw _erro(400, 'Usuário IAHub inválido.');
    svc.usuarioIdIahub = usuario;
  }
  return svc;
}

// O login grava o usuário em consultores, que aceita um só telefone por usuário
// e empresa: repetir aqui faria o login do segundo número falhar.
function _conferirUsuarioLivre(eid, svc, identityId) {
  if (!svc.usuarioIdIahub) return;
  const outro = listar(eid).find(i => i.id !== identityId && i.usuarioIdIahub === svc.usuarioIdIahub);
  if (outro) throw _erro(409, `Este usuário do IAHub já está vinculado ao número de ${outro.nome}.`);
}

function _gravarVinculo(db, eid, identity, svc, { liberado, stamp }) {
  const meta = _json(identity.metadata_json);
  meta.iaService = {
    ...meta.iaService,
    habilitado: liberado === undefined ? meta.iaService?.habilitado !== false : liberado,
    papel: svc.papel,
    idSoftexpert: svc.idSoftexpert,
    preAnaliseAutomatica: svc.preAnaliseAutomatica,
    estiloResposta: svc.estiloResposta,
  };
  if ('usuarioIdIahub' in svc) meta.iaService.usuarioIdIahub = svc.usuarioIdIahub;
  db.prepare('UPDATE platform_whatsapp_identities SET metadata_json = ?, atualizado_em = ? WHERE empresa_id = ? AND id = ?')
    .run(JSON.stringify(meta), stamp, eid, identity.id);

  const chatWeb = _rolesDa(db, eid, identity.id).filter(_ehChatWeb);
  if (!chatWeb.length) {
    db.prepare(`
      INSERT INTO platform_identity_roles (id, identity_id, empresa_id, sistema, modulo, papel, codigo_identidade, liberado, metadata_json, criado_em, atualizado_em)
      VALUES (?, ?, ?, 'ia-service', 'chat-web', ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), identity.id, eid, svc.papel, svc.idSoftexpert, liberado === false ? 0 : 1,
      JSON.stringify({ idSoftexpert: svc.idSoftexpert, preAnaliseAutomatica: svc.preAnaliseAutomatica, ...('usuarioIdIahub' in svc ? { usuarioIdIahub: svc.usuarioIdIahub } : {}) }), stamp, stamp);
    return;
  }
  for (const r of chatWeb) {
    const rMeta = { ..._json(r.metadata_json), idSoftexpert: svc.idSoftexpert, preAnaliseAutomatica: svc.preAnaliseAutomatica };
    if ('usuarioIdIahub' in svc) rMeta.usuarioIdIahub = svc.usuarioIdIahub;
    db.prepare(`
      UPDATE platform_identity_roles
         SET papel = ?, codigo_identidade = ?, liberado = ?, metadata_json = ?,
             origem_sistema = NULL, origem_id = NULL, atualizado_em = ?
       WHERE id = ?
    `).run(svc.papel, svc.idSoftexpert, liberado === undefined ? r.liberado : (liberado ? 1 : 0), JSON.stringify(rMeta), stamp, r.id);
  }
}

/**
 * Cria ou edita um número do IA Service.
 * - sem id: se o telefone já existe na empresa (ex.: só IA Command), ganha o
 *   vínculo do IA Service sem mexer no resto; se já tem o vínculo, é conflito.
 * - com id: só números que já têm o vínculo do IA Service.
 */
function salvar(empresaId, dados = {}) {
  const eid = Number(empresaId);
  if (!eid) throw _erro(400, 'Empresa não definida.');
  const svc = _dadosIaService(dados);
  const numero = _normalizarTelefone(dados.numero);
  if (numero.length < 10 || numero.length > 15) throw _erro(400, 'Telefone inválido. Informe DDI + DDD + número.');
  const nome = String(dados.nome || '').trim().slice(0, 120);
  const observacoes = String(dados.observacoes || '').trim().slice(0, 500);
  // Ausente = mantém a situação atual (novo número nasce liberado).
  const liberado = dados.liberado === undefined ? undefined : dados.liberado !== false;
  const db = getDB();

  return db.transaction(() => {
    const stamp = new Date().toISOString();
    const porNumero = db.prepare('SELECT * FROM platform_whatsapp_identities WHERE empresa_id = ? AND numero_normalizado = ?').get(eid, numero);

    if (!dados.id) {
      if (porNumero) {
        const roles = _rolesDa(db, eid, porNumero.id);
        if (roles.some(_ehChatWeb)) throw _erro(409, 'Este número já está cadastrado no IA Service.');
        _conferirUsuarioLivre(eid, svc, porNumero.id);
        _gravarVinculo(db, eid, porNumero, svc, { liberado: liberado !== false, stamp });
        return { id: porNumero.id, criado: false, vinculadoAExistente: true, inativoCadastro: Number(porNumero.ativo) === 0 };
      }
      if (!nome) throw _erro(400, 'Informe o nome.');
      _conferirUsuarioLivre(eid, svc, null);
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO platform_whatsapp_identities (id, empresa_id, nome, numero, numero_normalizado, observacoes, ativo, metadata_json, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, eid, nome, numero, numero, observacoes, JSON.stringify({ tipo: 'analista' }), stamp, stamp);
      _gravarVinculo(db, eid, db.prepare('SELECT * FROM platform_whatsapp_identities WHERE id = ?').get(id), svc, { liberado: liberado !== false, stamp });
      return { id, criado: true };
    }

    const atual = db.prepare('SELECT * FROM platform_whatsapp_identities WHERE empresa_id = ? AND id = ?').get(eid, String(dados.id));
    const roles = atual ? _rolesDa(db, eid, atual.id) : [];
    if (!atual || !roles.some(_ehChatWeb)) throw _erro(404, 'Número não encontrado no IA Service.');
    _conferirUsuarioLivre(eid, svc, atual.id);
    const compartilhado = roles.some(r => !_ehChatWeb(r));
    const trocouNumero = numero !== atual.numero_normalizado;
    if (compartilhado) {
      if (trocouNumero) throw _erro(409, 'Este número também é usado por outro sistema. A troca de telefone só pode ser feita no painel de Administração.');
    } else {
      if (!nome) throw _erro(400, 'Informe o nome.');
      if (trocouNumero && porNumero) throw _erro(409, 'Já existe outro cadastro com este telefone.');
      db.prepare('UPDATE platform_whatsapp_identities SET nome = ?, numero = ?, numero_normalizado = ?, observacoes = ?, atualizado_em = ? WHERE empresa_id = ? AND id = ?')
        .run(nome, numero, numero, observacoes, stamp, eid, atual.id);
    }
    _gravarVinculo(db, eid, db.prepare('SELECT * FROM platform_whatsapp_identities WHERE id = ?').get(atual.id), svc, { liberado, stamp });
    return { id: atual.id, criado: false };
  }).immediate();
}

/** Ativa/inativa só o vínculo do IA Service (nunca o número nem outro sistema). */
function definirLiberado(empresaId, identityId, liberado) {
  const eid = Number(empresaId);
  const db = getDB();
  return db.transaction(() => {
    const atual = db.prepare('SELECT * FROM platform_whatsapp_identities WHERE empresa_id = ? AND id = ?').get(eid, String(identityId || ''));
    const roles = atual ? _rolesDa(db, eid, atual.id) : [];
    if (!atual || !roles.some(_ehChatWeb)) throw _erro(404, 'Número não encontrado no IA Service.');
    const tela = _paraTela(atual, roles);
    _gravarVinculo(db, eid, atual, {
      idSoftexpert: tela.idSoftexpert, papel: tela.papel, preAnaliseAutomatica: tela.preAnaliseAutomatica, estiloResposta: tela.estiloResposta,
    }, { liberado: !!liberado, stamp: new Date().toISOString() });
    return { id: atual.id, liberado: !!liberado, numero: atual.numero_normalizado };
  }).immediate();
}

/** Caminho que o analista abre para entrar no chat desta empresa. */
function linkDeAcesso(empresaId) {
  try {
    const row = getDB().prepare('SELECT login_externo_apelido AS apelido FROM platform_ai_configs WHERE empresa_id = ?').get(Number(empresaId));
    return row?.apelido ? `/iaservice/${row.apelido}` : '/iaservice';
  } catch (_) {
    return '/iaservice';
  }
}

module.exports = { listar, salvar, definirLiberado, linkDeAcesso, PAPEIS };
