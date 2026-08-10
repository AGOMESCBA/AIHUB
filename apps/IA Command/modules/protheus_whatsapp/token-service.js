// Emissao e validacao de token curto de sessao para o canal Protheus WhatsApp.
//
// Segue o mesmo padrao ja usado no projeto para autenticacao servidor-a-servidor
// (agente local, worker do WhatsApp): token opaco (nao JWT), guardado em tabela
// com expiracao, comparado por lookup direto. O projeto nao usa jsonwebtoken em
// nenhum outro lugar — nao ha motivo para introduzir essa dependencia aqui.

const crypto = require('crypto');
const { getDB } = require('../database');

const TTL_MS = 5 * 60 * 1000; // 5 minutos

// Mesma normalizacao usada pelo canal WhatsApp real (_normalizarNumeroWa em
// modules/whatsapp/service.js): so digitos. Aplicada aqui, na entrada do celular
// no sistema, para que qualquer formato digitado no cadastro Protheus (com
// tracos, parenteses, espacos) chegue normalizado ao resto do pipeline — sem
// depender de disciplina manual de quem cadastra — e ja case corretamente
// contra whatsapp_allowed_numbers.
function normalizarCelular(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function emitir({ empresaId, celular, filial = null }) {
  if (!empresaId) throw new Error('empresaId obrigatorio.');
  const celularNormalizado = normalizarCelular(celular);
  if (!celularNormalizado) throw new Error('celular obrigatorio.');

  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + TTL_MS);

  getDB().prepare(`
    INSERT INTO protheus_chat_tokens (token, empresa_id, celular, filial, expira_em, criado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, empresaId, celularNormalizado, filial, expiraEm.toISOString(), agora.toISOString());

  return { token, expiraEm: expiraEm.toISOString() };
}

function validar(token) {
  if (!token) return null;

  const row = getDB().prepare(`
    SELECT token, empresa_id, celular, filial, expira_em
    FROM protheus_chat_tokens
    WHERE token = ?
  `).get(token);

  if (!row) return null;
  if (new Date(row.expira_em).getTime() < Date.now()) return null;

  getDB().prepare(`UPDATE protheus_chat_tokens SET usado_em = ? WHERE token = ?`)
    .run(new Date().toISOString(), token);

  return { empresaId: row.empresa_id, celular: row.celular, filial: row.filial };
}

function limparExpirados() {
  getDB().prepare(`DELETE FROM protheus_chat_tokens WHERE expira_em < ?`)
    .run(new Date().toISOString());
}

module.exports = { emitir, validar, limparExpirados, normalizarCelular, TTL_MS };
