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
    origemSistema: row.origem_sistema,
    origemOid: row.origem_oid,
    origemTipo: row.origem_tipo,
    origemReferenciaOid: row.origem_referencia_oid,
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
      mime_type, tamanho, caminho_relativo, usuario_id,
      origem_sistema, origem_oid, origem_tipo, origem_referencia_oid,
      criado_em,
      conteudo_extraido, linguagem_detectada, encoding_detectado, e_codigo,
      anexo_original_id, mensagem_origem_id, explicacao_alteracao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    dados.origemSistema ?? null,
    dados.origemOid ?? null,
    dados.origemTipo ?? null,
    dados.origemReferenciaOid ?? null,
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

function getAnexoPorOrigem(empresaId, atendimentoId, { origemSistema, origemOid }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  if (!origemSistema || !origemOid) return null;

  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM anexos
     WHERE empresa_id = ?
       AND atendimento_id = ?
       AND origem_sistema = ?
       AND origem_oid = ?
     LIMIT 1
  `).get(Number(empresaId), atendimentoId, origemSistema, origemOid);
  return _rowParaDominio(row);
}

function vincularOrigem(empresaId, anexoId, { origemSistema, origemOid, origemTipo, origemReferenciaOid }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!anexoId) throw new Error('anexoId é obrigatório.');
  if (!origemSistema || !origemOid) throw new Error('origemSistema e origemOid são obrigatórios.');

  const db = getDB();
  const info = db.prepare(`
    UPDATE anexos
       SET origem_sistema = ?,
           origem_oid = ?,
           origem_tipo = ?,
           origem_referencia_oid = ?
     WHERE id = ? AND empresa_id = ?
  `).run(
    origemSistema,
    origemOid,
    origemTipo ?? null,
    origemReferenciaOid ?? null,
    anexoId,
    Number(empresaId)
  );
  if (info.changes === 0) return null;
  return getAnexo(empresaId, anexoId);
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

function vincularMensagem(empresaId, anexoId, mensagemId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!anexoId) throw new Error('anexoId é obrigatório.');
  if (!mensagemId) throw new Error('mensagemId é obrigatório.');
  const db = getDB();
  const info = db.prepare(`
    UPDATE anexos
       SET mensagem_id = ?
     WHERE id = ?
       AND empresa_id = ?
       AND atendimento_id = (
         SELECT atendimento_id
           FROM mensagens
          WHERE id = ?
            AND empresa_id = ?
       )
  `).run(mensagemId, anexoId, Number(empresaId), mensagemId, Number(empresaId));
  if (info.changes === 0) return null;
  return getAnexo(empresaId, anexoId);
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

module.exports = {
  salvarMetadadosAnexo,
  listarAnexos,
  getAnexo,
  getAnexoPorOrigem,
  vincularOrigem,
  vincularMensagem,
  atualizarExtracao,
  listarVersoes,
};
