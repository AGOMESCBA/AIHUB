// Unico ponto de acesso SQL a tabela `anexos` (apenas metadados — o binario
// fica em disco, fora do SQLite; ver services/armazenamento-anexos.js).
//
// Versionamento de fonte (Etapa 2): um anexo de codigo enviado pelo usuario
// (e_codigo=1) nunca e' sobrescrito. Uma correcao gerada pela IA vira uma NOVA
// linha em `anexos`, com anexo_original_id apontando para a primeira versao.
// O historico de versoes de um arquivo e' a lista de anexos com o mesmo
// anexo_original_id (ou o proprio id, se ele for a versao 1), ordenada por
// criado_em.

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
    conteudoExtraido: row.conteudo_extraido,
    linguagemDetectada: row.linguagem_detectada,
    encodingDetectado: row.encoding_detectado,
    eCodigo: !!row.e_codigo,
    anexoOriginalId: row.anexo_original_id,
    mensagemOrigemId: row.mensagem_origem_id,
    explicacaoAlteracao: row.explicacao_alteracao,
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
      mime_type, tamanho, caminho_relativo, usuario_id, criado_em,
      conteudo_extraido, linguagem_detectada, encoding_detectado, e_codigo,
      anexo_original_id, mensagem_origem_id, explicacao_alteracao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    agora,
    dados.conteudoExtraido ?? null,
    dados.linguagemDetectada ?? null,
    dados.encodingDetectado ?? null,
    dados.eCodigo ? 1 : 0,
    dados.anexoOriginalId ?? null,
    dados.mensagemOrigemId ?? null,
    dados.explicacaoAlteracao ?? null
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

function getAnexo(empresaId, anexoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`SELECT * FROM anexos WHERE id = ? AND empresa_id = ?`).get(anexoId, Number(empresaId));
  return _rowParaDominio(row);
}

/**
 * Grava o resultado da extração de conteúdo (texto, linguagem, encoding) sem
 * criar uma nova versão — é um complemento de metadados do MESMO anexo, não
 * uma correção. Chamado logo após o upload, antes de qualquer análise de IA.
 */
function atualizarExtracao(empresaId, anexoId, { conteudoExtraido, linguagemDetectada, encodingDetectado, eCodigo }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const info = db.prepare(`
    UPDATE anexos
       SET conteudo_extraido = ?, linguagem_detectada = ?, encoding_detectado = ?, e_codigo = ?
     WHERE id = ? AND empresa_id = ?
  `).run(
    conteudoExtraido ?? null,
    linguagemDetectada ?? null,
    encodingDetectado ?? null,
    eCodigo ? 1 : 0,
    anexoId,
    Number(empresaId)
  );
  if (info.changes === 0) return null;
  return getAnexo(empresaId, anexoId);
}

/**
 * Lista todas as versões de um arquivo de código: a versão 1 (o próprio anexo
 * original) + todas as correções geradas a partir dele, em ordem cronológica.
 */
function listarVersoes(empresaId, anexoOriginalId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();

  const original = getAnexo(empresaId, anexoOriginalId);
  if (!original) throw new Error('Anexo original não encontrado nesta empresa.');

  const correcoes = db.prepare(`
    SELECT * FROM anexos WHERE empresa_id = ? AND anexo_original_id = ? ORDER BY criado_em ASC
  `).all(Number(empresaId), anexoOriginalId);

  return [original, ...correcoes.map(_rowParaDominio)];
}

module.exports = { salvarMetadadosAnexo, listarAnexos, getAnexo, atualizarExtracao, listarVersoes };
