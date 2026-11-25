'use strict';

// Entrada pelo card do IAHub. O IAHub assina um ticket (Ed25519, 60 s, uso
// único) com a chave PRIVADA dele; o Talk confere com a chave PÚBLICA. Nada de
// sessão compartilhada entre processos: o Talk cria a própria sessão.
// Lado do IAHub: apps/IAHUB/backend/ia-talk-entrada.js.
//
// Formato: <payload base64url>.<assinatura base64url>
// payload: { v: 1, jti, iat, exp, usuario: { id, nome, email, celular, admin },
//            empresa: { id, nome } }

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { erro } = require('../erros');

const VALIDADE_MAXIMA_SEG = 60;
const ARQUIVO_PUBLICA_PADRAO = path.join(config.RAIZ_REPO, 'apps', 'IAHUB', 'data', 'ia-talk', 'ticket-publica.pem');

function carregarChavePublica({ env = process.env } = {}) {
  const arquivo = env.IA_TALK_HUB_CHAVE_PUBLICA_ARQUIVO || ARQUIVO_PUBLICA_PADRAO;
  try {
    return crypto.createPublicKey(fs.readFileSync(arquivo, 'utf8'));
  } catch (_) {
    return null; // IAHub ainda não gerou a chave: entrada pelo card indisponível.
  }
}

const recusar = () => erro('nao_autenticado', 'O acesso pelo IAHub venceu ou não é válido. Volte ao IAHub e clique no card do IA Talk de novo.');

function verificar(ticket, { chavePublica, agoraSeg = Math.floor(Date.now() / 1000) }) {
  if (!chavePublica) throw erro('indisponivel', 'A entrada pelo IAHub ainda não está configurada neste servidor.');
  const [p, a] = String(ticket || '').split('.');
  if (!p || !a) throw recusar();
  const corpo = Buffer.from(p, 'base64url');
  let ok = false;
  try { ok = crypto.verify(null, corpo, chavePublica, Buffer.from(a, 'base64url')); } catch (_) { ok = false; }
  if (!ok) throw recusar();
  let dados;
  try { dados = JSON.parse(corpo.toString('utf8')); } catch (_) { throw recusar(); }
  const valido = dados?.v === 1 && dados.jti && Number.isInteger(dados.iat) && Number.isInteger(dados.exp)
    && dados.exp - dados.iat <= VALIDADE_MAXIMA_SEG && dados.iat <= agoraSeg + 5 && dados.exp >= agoraSeg
    && dados.usuario?.id && dados.empresa?.id;
  if (!valido) throw recusar();
  return dados;
}

// Marca o jti como usado; segundo uso = recusa. Limpa os vencidos.
function consumir(db, dados) {
  db.prepare('DELETE FROM tickets_hub_usados WHERE expira_em < ?').run(new Date(Date.now() - 3600_000).toISOString());
  const r = db.prepare('INSERT OR IGNORE INTO tickets_hub_usados (jti, usado_em, expira_em) VALUES (?, ?, ?)')
    .run(String(dados.jti), new Date().toISOString(), new Date(dados.exp * 1000).toISOString());
  if (r.changes !== 1) throw recusar();
}

module.exports = { verificar, consumir, carregarChavePublica, VALIDADE_MAXIMA_SEG };
