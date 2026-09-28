// Unico ponto de acesso SQL a tabela `consultores`.
//
// Modelo escolhido (ver decisao documentada em IA_SERVICE_ETAPA1_IMPLEMENTACAO.md,
// secao "Multiempresa no cadastro de Consultores"): usuario_id_iahub + empresa_id,
// NAO usuario_id_iahub global. Um mesmo usuario do IA HUB pode ter empresas=[...]
// com acesso a mais de uma empresa cliente (confirmado em
// apps/IAHUB/backend/usuarios/database.js), e id_softexpert e especifico da
// instancia SoftExpert de cada empresa cliente — um consultor global colidiria
// dois id_softexpert diferentes no mesmo registro.

const crypto = require('crypto');
const { getDB } = require('../database');

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    usuarioIdIahub: row.usuario_id_iahub,
    empresaId: row.empresa_id,
    idSoftexpert: row.id_softexpert,
    telefone: row.telefone,
    ativo: !!row.ativo,
    preAnaliseAutomatica: !!row.pre_analise_automatica,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function criarConsultor(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!dados.usuarioIdIahub) throw new Error('usuarioIdIahub é obrigatório.');

  const db = getDB();
  const existente = db.prepare(`
    SELECT * FROM consultores WHERE usuario_id_iahub = ? AND empresa_id = ?
  `).get(Number(dados.usuarioIdIahub), Number(empresaId));
  if (existente) throw new Error('Já existe um consultor para este usuário nesta empresa.');

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO consultores (id, usuario_id_iahub, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(dados.usuarioIdIahub),
    Number(empresaId),
    dados.idSoftexpert ?? null,
    dados.telefone ?? null,
    dados.ativo === false ? 0 : 1,
    dados.preAnaliseAutomatica === false ? 0 : 1,
    agora,
    agora
  );

  return _rowParaDominio(db.prepare('SELECT * FROM consultores WHERE id = ?').get(id));
}

function getConsultor(empresaId, consultorId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM consultores WHERE id = ? AND empresa_id = ?
  `).get(consultorId, Number(empresaId));
  return _rowParaDominio(row);
}

function getConsultorPorUsuario(empresaId, usuarioIdIahub) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM consultores WHERE usuario_id_iahub = ? AND empresa_id = ?
  `).get(Number(usuarioIdIahub), Number(empresaId));
  return _rowParaDominio(row);
}

function listarConsultores(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];

  if (filtros.ativo !== undefined) {
    condicoes.push('ativo = ?');
    params.push(filtros.ativo ? 1 : 0);
  }

  const rows = db.prepare(`
    SELECT * FROM consultores WHERE ${condicoes.join(' AND ')} ORDER BY criado_em ASC
  `).all(...params);

  return rows.map(_rowParaDominio);
}

function atualizarConsultor(empresaId, consultorId, patch) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const atual = getConsultor(empresaId, consultorId);
  if (!atual) return null;

  const agora = new Date().toISOString();
  db.prepare(`
    UPDATE consultores SET id_softexpert = ?, telefone = ?, ativo = ?, pre_analise_automatica = ?, atualizado_em = ?
    WHERE id = ? AND empresa_id = ?
  `).run(
    patch.idSoftexpert !== undefined ? patch.idSoftexpert : atual.idSoftexpert,
    patch.telefone !== undefined ? patch.telefone : atual.telefone,
    patch.ativo !== undefined ? (patch.ativo ? 1 : 0) : (atual.ativo ? 1 : 0),
    patch.preAnaliseAutomatica !== undefined ? (patch.preAnaliseAutomatica ? 1 : 0) : (atual.preAnaliseAutomatica ? 1 : 0),
    agora,
    consultorId,
    Number(empresaId)
  );

  return getConsultor(empresaId, consultorId);
}

/**
 * Exclusão física — seguro porque atendimentos.consultor_id é
 * ON DELETE SET NULL (migration v2): apagar um consultor nunca deixa
 * atendimento órfão quebrado, só perde a referência de "quem atendeu"
 * nos atendimentos já vinculados a ele.
 */
function excluirConsultor(empresaId, consultorId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const resultado = db.prepare(`DELETE FROM consultores WHERE id = ? AND empresa_id = ?`).run(consultorId, Number(empresaId));
  return resultado.changes > 0;
}

module.exports = {
  criarConsultor,
  getConsultor,
  getConsultorPorUsuario,
  listarConsultores,
  atualizarConsultor,
  excluirConsultor,
};
