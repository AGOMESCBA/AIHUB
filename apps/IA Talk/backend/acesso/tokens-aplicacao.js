'use strict';

// Tokens de integração das aplicações (API v1). Mesmo conceito do token do
// Agente Local (por empresa, gerado e regerado na tela), com uma diferença de
// segurança: o token completo aparece UMA vez; no banco fica só o hash.

const crypto = require('crypto');
const { novoId, agora } = require('../ids');
const { hashSecreto } = require('../seguranca/cifra');

const PREFIXO = 'tk_live_';
const hashToken = (t) => hashSecreto(t, 'token-aplicacao');

function gerar(db, { aplicacaoId, empresaId }) {
  const token = `${PREFIXO}${crypto.randomBytes(32).toString('base64url')}`;
  const registro = { id: novoId('token'), prefixo: token.slice(0, 14), criado_em: agora(), ultimo_uso_em: null, revogado_em: null };
  db.prepare(`INSERT INTO aplicacao_tokens (id, aplicacao_id, empresa_id, prefixo, token_hash, criado_em) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(registro.id, aplicacaoId, empresaId, registro.prefixo, hashToken(token), registro.criado_em);
  return { token, registro };
}

// Para a API v1 (C3): devolve a aplicação dona do token, ou null.
function validar(db, token) {
  if (!String(token || '').startsWith(PREFIXO)) return null;
  const t = db.prepare(`
    SELECT t.id AS token_id, a.*, e.situacao AS empresa_situacao
      FROM aplicacao_tokens t
      JOIN aplicacoes a ON a.id = t.aplicacao_id
      JOIN empresas e ON e.id = a.empresa_id
     WHERE t.token_hash = ? AND t.revogado_em IS NULL`).get(hashToken(token));
  if (!t || t.situacao !== 'ativa' || t.empresa_situacao !== 'ativa') return null;
  db.prepare('UPDATE aplicacao_tokens SET ultimo_uso_em = ? WHERE id = ?').run(agora(), t.token_id);
  return { aplicacaoId: t.id, empresaId: t.empresa_id, nome: t.nome, escopos: JSON.parse(t.escopos || '[]') };
}

module.exports = { gerar, validar, PREFIXO };
