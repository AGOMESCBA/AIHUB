'use strict';

// Login por telefone (código de 6 dígitos) e link de acesso de uso único.
// Nada em texto puro no banco: telefone, código e token só em hash.
// A resposta do pedido de código é igual para número cadastrado ou não (não
// revela quem é usuário), salvo quando nenhum envio funcionou para um usuário
// existente — aí a pessoa precisa saber que o código não vai chegar.

const crypto = require('crypto');
const { novoId, agora } = require('../ids');
const { hashSecreto } = require('../seguranca/cifra');
const telefone = require('../seguranca/telefone');
const { enviarCodigo } = require('./envio-codigo');
const { erro } = require('../erros');

const VALIDADE_CODIGO_MS = 5 * 60 * 1000;
const MAX_TENTATIVAS = 5;
const JANELA_LIMITE_MS = 10 * 60 * 1000;
const LIMITE_POR_TELEFONE = 3;
const LIMITE_POR_IP = 10;
const VALIDADE_LINK_MS = 15 * 60 * 1000;

const hashTelefone = (t) => hashSecreto(telefone.normalizar(t), 'telefone-login');
const hashCodigo = (desafioId, codigo) => hashSecreto(`${desafioId}:${codigo}`, 'codigo-login');

function empresaPorApelido(db, apelido) {
  const e = db.prepare("SELECT * FROM empresas WHERE apelido = ? AND situacao = 'ativa'").get(String(apelido || '').toLowerCase());
  if (!e) throw erro('nao_encontrado', 'Link de acesso não encontrado. Confira o endereço com a sua empresa.');
  return e;
}

// Usuário ativo que pode entrar nesta empresa (vínculo ativo ou administração da plataforma).
function usuarioDoTelefone(db, empresaId, tel) {
  const variantes = telefone.variantesBrasil(tel);
  if (!variantes.length) return null;
  const marcas = variantes.map(() => '?').join(',');
  return db.prepare(`
    SELECT u.* FROM usuarios u
      LEFT JOIN membros m ON m.usuario_id = u.id AND m.empresa_id = ? AND m.situacao = 'ativo'
     WHERE u.telefone IN (${marcas}) AND u.situacao = 'ativo'
       AND (m.id IS NOT NULL OR u.administrador_plataforma = 1)
     LIMIT 1`).get(empresaId, ...variantes) || null;
}

function conferirLimites(db, { telHash, ip, agoraMs }) {
  const desde = new Date(agoraMs - JANELA_LIMITE_MS).toISOString();
  const porTel = db.prepare('SELECT COUNT(*) n FROM desafios_login WHERE telefone_hash = ? AND criado_em >= ?').get(telHash, desde).n;
  const porIp = ip ? db.prepare('SELECT COUNT(*) n FROM desafios_login WHERE ip = ? AND criado_em >= ?').get(ip, desde).n : 0;
  if (porTel >= LIMITE_POR_TELEFONE || porIp >= LIMITE_POR_IP) {
    throw erro('limite_excedido', 'Muitos pedidos de código. Aguarde alguns minutos e tente de novo.', { detalhe: { tentar_novamente_em_seg: 600 } });
  }
}

async function pedirCodigo(db, { apelido, telefone: tel, ip = null, transportes = {}, agoraMs = Date.now() }) {
  if (!telefone.valido(tel)) throw erro('requisicao_invalida', 'Informe o celular com DDD.', { campos: { telefone: 'Informe o celular com DDI e DDD (ex.: 65 99999-0000).' } });
  const empresa = empresaPorApelido(db, apelido);
  const telHash = hashTelefone(tel);
  conferirLimites(db, { telHash, ip, agoraMs });

  const usuario = usuarioDoTelefone(db, empresa.id, tel);
  const id = novoId('desafio');
  const criado = new Date(agoraMs).toISOString();
  const expira = new Date(agoraMs + VALIDADE_CODIGO_MS).toISOString();
  let enviadoPor = 'whatsapp';
  let codigoHash = null;

  if (usuario) {
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    codigoHash = hashCodigo(id, codigo);
    const r = await enviarCodigo(transportes, { empresa, telefone: usuario.telefone, email: usuario.email, codigo });
    enviadoPor = r.enviado_por;
    if (enviadoPor === 'nenhum') {
      db.prepare(`INSERT INTO desafios_login (id, empresa_id, usuario_id, telefone_hash, codigo_hash, enviado_por, criado_em, expira_em, consumido_em, ip)
        VALUES (?, ?, ?, ?, NULL, 'nenhum', ?, ?, ?, ?)`).run(id, empresa.id, usuario.id, telHash, criado, expira, criado, ip);
      throw erro('indisponivel', 'Não foi possível enviar o código agora. Tente de novo em instantes ou fale com o administrador da empresa.',
        { detalhe: { motivos: r.motivos } });
    }
  }
  db.prepare(`INSERT INTO desafios_login (id, empresa_id, usuario_id, telefone_hash, codigo_hash, enviado_por, criado_em, expira_em, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, empresa.id, usuario?.id || null, telHash, codigoHash, enviadoPor, criado, expira, ip);

  return {
    desafio_id: id,
    expira_em: expira,
    enviado_por: enviadoPor,
    destino_mascarado: enviadoPor === 'email' ? telefone.mascararEmail(usuario.email) : telefone.mascarar(tel),
  };
}

// Devolve { usuario_id, empresa_id } se o código confere; consome o desafio.
function confirmarCodigo(db, { desafioId, codigo, agoraMs = Date.now() }) {
  const d = db.prepare('SELECT * FROM desafios_login WHERE id = ?').get(String(desafioId || ''));
  if (!d || d.consumido_em || Date.parse(d.expira_em) <= agoraMs) throw erro('nao_encontrado', 'O código expirou. Peça um novo.');
  const tentativas = d.tentativas + 1;
  if (tentativas > MAX_TENTATIVAS) {
    db.prepare('UPDATE desafios_login SET tentativas = ?, consumido_em = ? WHERE id = ?').run(tentativas, agora(), d.id);
    throw erro('limite_excedido', 'Muitas tentativas. Peça um novo código.');
  }
  const confere = d.codigo_hash && /^\d{6}$/.test(String(codigo || '')) && crypto.timingSafeEqual(Buffer.from(d.codigo_hash), Buffer.from(hashCodigo(d.id, String(codigo))));
  if (!confere) {
    db.prepare('UPDATE desafios_login SET tentativas = ? WHERE id = ?').run(tentativas, d.id);
    throw erro('requisicao_invalida', 'Código incorreto.', { campos: { codigo: 'Código incorreto.' }, detalhe: { tentativas_restantes: MAX_TENTATIVAS - tentativas } });
  }
  db.prepare('UPDATE desafios_login SET tentativas = ?, consumido_em = ? WHERE id = ?').run(tentativas, agora(), d.id);
  return { usuario_id: d.usuario_id, empresa_id: d.empresa_id };
}

// Link de uso único (primeiro administrador, suporte). Gerado só no servidor (cli/).
function criarLink(db, { usuarioId, empresaId, agoraMs = Date.now() }) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO links_acesso (id, token_hash, usuario_id, empresa_id, criado_em, expira_em) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(novoId('link'), hashSecreto(token, 'link-acesso'), usuarioId, empresaId, new Date(agoraMs).toISOString(), new Date(agoraMs + VALIDADE_LINK_MS).toISOString());
  return token;
}

function usarLink(db, token, { agoraMs = Date.now() } = {}) {
  const l = db.prepare('SELECT * FROM links_acesso WHERE token_hash = ?').get(hashSecreto(String(token || ''), 'link-acesso'));
  if (!l || l.usado_em || Date.parse(l.expira_em) <= agoraMs) throw erro('nao_autenticado', 'Link de acesso inválido, vencido ou já usado. Peça um novo ao administrador.');
  db.prepare('UPDATE links_acesso SET usado_em = ? WHERE id = ?').run(agora(), l.id);
  return { usuario_id: l.usuario_id, empresa_id: l.empresa_id };
}

module.exports = { pedirCodigo, confirmarCodigo, criarLink, usarLink, empresaPorApelido, VALIDADE_CODIGO_MS, MAX_TENTATIVAS, LIMITE_POR_TELEFONE };
