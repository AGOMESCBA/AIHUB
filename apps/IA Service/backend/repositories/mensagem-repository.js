// Unico ponto de acesso SQL a tabela `mensagens`.
// Toda operacao exige empresaId explicito e atendimentoId ja pertencente aquela
// empresa (validado pelo chamador via atendimento-repository.getAtendimento).

const crypto = require('crypto');
const { getDB } = require('../database');

const PAPEIS_VALIDOS = new Set(['user', 'assistant', 'system', 'customer']);

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
    diagnostico: row.diagnostico_json ? JSON.parse(row.diagnostico_json) : null,
    nivelConfianca: row.nivel_confianca,
    provider: row.provider,
    model: row.model,
    origemSistema: row.origem_sistema,
    origemReferencia: row.origem_referencia,
    origemData: row.origem_data,
    origemAutor: row.origem_autor,
  };
}

function salvarMensagem(empresaId, atendimentoId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  if (!PAPEIS_VALIDOS.has(dados.papel)) {
    throw new Error(`papel inválido: ${dados.papel}. Use user, assistant, customer ou system.`);
  }

  const db = getDB();
  const id = crypto.randomUUID();
  const agora = dados.criadoEm || new Date().toISOString();

  // FK garante que atendimento_id existe, mas nao garante que pertence a empresaId
  // informado — checagem explicita evita gravar mensagem em atendimento de outra empresa.
  const pertence = db.prepare(`
    SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?
  `).get(atendimentoId, Number(empresaId));
  if (!pertence) throw new Error('Atendimento não encontrado nesta empresa.');

  db.prepare(`
    INSERT INTO mensagens (
      id, empresa_id, atendimento_id, papel, conteudo, usuario_id, criado_em,
      diagnostico_json, nivel_confianca, provider, model
      , origem_sistema, origem_referencia, origem_data, origem_autor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    atendimentoId,
    dados.papel,
    dados.conteudo,
    dados.usuarioId ?? null,
    agora,
    dados.diagnostico ? JSON.stringify(dados.diagnostico) : null,
    dados.nivelConfianca ?? null,
    dados.provider ?? null,
    dados.model ?? null,
    dados.origemSistema ?? null,
    dados.origemReferencia ?? null,
    dados.origemData ?? null,
    dados.origemAutor ?? null
  );

  return _rowParaDominio(db.prepare('SELECT * FROM mensagens WHERE id = ?').get(id));
}

function removerHistoricoImportado(empresaId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  const db = getDB();
  return db.prepare(`
    DELETE FROM mensagens
     WHERE empresa_id = ?
       AND atendimento_id = ?
       AND (
         origem_sistema = 'softexpert'
         OR (
           papel IN ('user', 'customer')
           AND diagnostico_json IS NULL
           AND provider IS NULL
           AND (
             conteudo LIKE 'Chamado SoftExpert #%'
             OR conteudo LIKE 'Abertura do chamado SoftExpert #%'
             OR conteudo LIKE '[%] %:%'
             OR conteudo LIKE '[____-__-__] %'
           )
         )
       )
  `).run(Number(empresaId), atendimentoId);
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

function getMensagem(empresaId, mensagemId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`SELECT * FROM mensagens WHERE id = ? AND empresa_id = ?`).get(mensagemId, Number(empresaId));
  return _rowParaDominio(row);
}

module.exports = { salvarMensagem, listarMensagens, getMensagem, removerHistoricoImportado, PAPEIS_VALIDOS };
