// Unico ponto de acesso SQL a tabela `mensagens`.
// Toda operacao exige empresaId explicito e atendimentoId ja pertencente aquela
// empresa (validado pelo chamador via atendimento-repository.getAtendimento).

const crypto = require('crypto');
const { getDB } = require('../database');

const PAPEIS_VALIDOS = new Set(['user', 'assistant', 'system', 'customer']);
const META_AVISOS_FONTE_CORRIGIDO = '__avisosFonteCorrigido';

function _parseDiagnostico(json) {
  if (!json) return { diagnostico: null, avisosFonteCorrigido: [] };
  const parsed = JSON.parse(json);
  const avisosFonteCorrigido = Array.isArray(parsed?.[META_AVISOS_FONTE_CORRIGIDO])
    ? parsed[META_AVISOS_FONTE_CORRIGIDO]
    : [];
  if (parsed && typeof parsed === 'object') delete parsed[META_AVISOS_FONTE_CORRIGIDO];
  return {
    diagnostico: parsed && Object.keys(parsed).length ? parsed : null,
    avisosFonteCorrigido,
  };
}

function _serializarDiagnostico(diagnostico, avisosFonteCorrigido = []) {
  const payload = { ...(diagnostico || {}) };
  if (Array.isArray(avisosFonteCorrigido) && avisosFonteCorrigido.length) {
    payload[META_AVISOS_FONTE_CORRIGIDO] = avisosFonteCorrigido;
  }
  return Object.keys(payload).length ? JSON.stringify(payload) : null;
}

function _rowParaDominio(row) {
  if (!row) return null;
  const { diagnostico, avisosFonteCorrigido } = _parseDiagnostico(row.diagnostico_json);
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    papel: row.papel,
    conteudo: row.conteudo,
    usuarioId: row.usuario_id,
    criadoEm: row.criado_em,
    diagnostico,
    avisosFonteCorrigido,
    nivelConfianca: row.nivel_confianca,
    provider: row.provider,
    model: row.model,
    origemSistema: row.origem_sistema,
    origemReferencia: row.origem_referencia,
    origemReferenciaOid: row.origem_referencia_oid ?? null,
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
    _serializarDiagnostico(dados.diagnostico, dados.avisosFonteCorrigido),
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

function atualizarAvisosFonteCorrigido(empresaId, mensagemId, avisosFonteCorrigido = []) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!mensagemId) throw new Error('mensagemId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`SELECT diagnostico_json FROM mensagens WHERE id = ? AND empresa_id = ?`).get(mensagemId, Number(empresaId));
  if (!row) throw new Error('Mensagem não encontrada nesta empresa.');
  const { diagnostico } = _parseDiagnostico(row.diagnostico_json);
  db.prepare(`
    UPDATE mensagens
       SET diagnostico_json = ?
     WHERE id = ? AND empresa_id = ?
  `).run(_serializarDiagnostico(diagnostico, avisosFonteCorrigido), mensagemId, Number(empresaId));
  return getMensagem(empresaId, mensagemId);
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
    SELECT m.*,
           CASE
             WHEN m.origem_referencia LIKE 'posicionamento:%' THEN (
               SELECT p.oid_origem
                 FROM posicionamentos p
                WHERE p.empresa_id = m.empresa_id
                  AND p.id = substr(m.origem_referencia, 16)
             )
             WHEN m.origem_referencia LIKE 'chamado:%' THEN (
               SELECT c.oid_origem
                 FROM chamados c
                WHERE c.empresa_id = m.empresa_id
                  AND c.id = substr(m.origem_referencia, 9)
             )
             ELSE NULL
           END AS origem_referencia_oid
      FROM mensagens m
     WHERE m.empresa_id = ? AND m.atendimento_id = ?
     ORDER BY m.criado_em ASC
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

function getUltimaMensagemAssistente(empresaId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM mensagens
     WHERE empresa_id = ?
       AND atendimento_id = ?
       AND papel = 'assistant'
       AND TRIM(COALESCE(conteudo, '')) <> ''
     ORDER BY criado_em DESC, rowid DESC
     LIMIT 1
  `).get(Number(empresaId), atendimentoId);
  return _rowParaDominio(row);
}

module.exports = { salvarMensagem, listarMensagens, getMensagem, getUltimaMensagemAssistente, removerHistoricoImportado, atualizarAvisosFonteCorrigido, PAPEIS_VALIDOS };
