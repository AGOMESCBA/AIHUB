'use strict';

// IDs públicos aleatórios com prefixo por tipo (nunca sequenciais): quem vê
// "cn_..." num log sabe que é um canal, e não dá para adivinhar o próximo.

const crypto = require('crypto');

const PREFIXOS = Object.freeze({
  empresa: 'emp',
  usuario: 'usr',
  membro: 'mbr',
  aplicacao: 'app',
  token: 'tok',
  canal: 'cn',
  conversa: 'cv',
  mensagem: 'msg',
  anexo: 'anx',
  evento: 'evt',
  auditoria: 'aud',
  desafio: 'dsf',
});

function novoId(tipo) {
  const prefixo = PREFIXOS[tipo];
  if (!prefixo) throw new Error(`Tipo de ID desconhecido: ${tipo}`);
  return `${prefixo}_${crypto.randomBytes(12).toString('base64url')}`;
}

function agora() {
  return new Date().toISOString();
}

module.exports = { PREFIXOS, novoId, agora };
