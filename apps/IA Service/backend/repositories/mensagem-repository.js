// Unico ponto de acesso SQL a tabela `mensagens`.
// Toda operacao exige empresaId explicito e atendimentoId ja pertencente aquela
// empresa (validado pelo chamador via atendimento-repository.getAtendimento).

const crypto = require('crypto');
const { getDB } = require('../database');

const PAPEIS_VALIDOS = new Set(['user', 'assistant', 'system']);

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    papel: row.papel,
    conteudo: row.conteudo,
    usuarioId: row.usuario_id,
    criadoEm: row.criado_em,
  };
}

function salvarMensagem(empresaId, atendimentoId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  if (!PAPEIS_VALIDOS.has(dados.papel)) {
    throw new Error(`papel inválido: ${dados.papel}. Use user, assistant ou system.`);
  }

  const db = getDB();
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  // FK garante que atendimento_id existe, mas nao garante que pertence a empresaId
  // informado — checagem explicita evita gravar mensagem em atendimento de outra empresa.
  const pertence = db.prepare(`
    SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?
  `).get(atendimentoId, Number(empresaId));
  if (!pertence) throw new Error('Atendimento não encontrado nesta empresa.');

  db.prepare(`
    INSERT INTO mensagens (id, empresa_id, atendimento_id, papel, conteudo, usuario_id, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), atendimentoId, dados.papel, dados.conteudo, dados.usuarioId ?? null, agora);

  return _rowParaDominio(db.prepare('SELECT * FROM mensagens WHERE id = ?').get(id));
}

function listarMensagens(empresaId, atendimentoId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const db = getDB();
  const limite = Math.min(Number(filtros.limite) || 100, 500);

  const rows = db.prepare(`
    SELECT * FROM mensagens
    WHERE empresa_id = ? AND atendimento_id = ?
    ORDER BY criado_em ASC
    LIMIT ?
  `).all(Number(empresaId), atendimentoId, limite);

  return rows.map(_rowParaDominio);
}

module.exports = { salvarMensagem, listarMensagens, PAPEIS_VALIDOS };
