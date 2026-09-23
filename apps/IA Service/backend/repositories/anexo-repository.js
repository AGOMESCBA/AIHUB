// Unico ponto de acesso SQL a tabela `anexos` (apenas metadados — o binario
// fica em disco, fora do SQLite; ver services/armazenamento-anexos.js).

const crypto = require('crypto');
const { getDB } = require('../database');

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    mensagemId: row.mensagem_id,
    nomeOriginal: row.nome_original,
    nomeInterno: row.nome_interno,
    mimeType: row.mime_type,
    tamanho: row.tamanho,
    caminhoRelativo: row.caminho_relativo,
    usuarioId: row.usuario_id,
    criadoEm: row.criado_em,
  };
}

function salvarMetadadosAnexo(empresaId, atendimentoId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const db = getDB();
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  const pertence = db.prepare(`
    SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?
  `).get(atendimentoId, Number(empresaId));
  if (!pertence) throw new Error('Atendimento não encontrado nesta empresa.');

  db.prepare(`
    INSERT INTO anexos (
      id, empresa_id, atendimento_id, mensagem_id, nome_original, nome_interno,
      mime_type, tamanho, caminho_relativo, usuario_id, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    atendimentoId,
    dados.mensagemId ?? null,
    dados.nomeOriginal,
    dados.nomeInterno,
    dados.mimeType,
    dados.tamanho,
    dados.caminhoRelativo,
    dados.usuarioId ?? null,
    agora
  );

  return _rowParaDominio(db.prepare('SELECT * FROM anexos WHERE id = ?').get(id));
}

function listarAnexos(empresaId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM anexos WHERE empresa_id = ? AND atendimento_id = ? ORDER BY criado_em ASC
  `).all(Number(empresaId), atendimentoId);

  return rows.map(_rowParaDominio);
}

module.exports = { salvarMetadadosAnexo, listarAnexos };
