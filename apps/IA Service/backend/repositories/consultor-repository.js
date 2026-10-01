// Unico ponto de acesso SQL a tabela `consultores`.
//
// Modelo original (ver decisao documentada em IA_SERVICE_ETAPA1_IMPLEMENTACAO.md,
// secao "Multiempresa no cadastro de Consultores"): usuario_id_iahub + empresa_id,
// NAO usuario_id_iahub global. id_softexpert e especifico da instancia
// SoftExpert de cada empresa cliente — um consultor global colidiria dois
// id_softexpert diferentes no mesmo registro.
//
// 2026-09 (migration v25, decisao explicita do usuario, reverte v17):
// usuario_id_iahub deixou de ser obrigatorio — o unico caminho de acesso ao
// Radar hoje e por telefone (login externo), que nunca depende de
// usuario_id_iahub. A intencao e cadastrar consultores como "analista com
// telefone", sem exigir vincular/criar um usuario de login do IA HUB para
// cada um. Quando informado, o vinculo continua validado (consultor-service.js).

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

  const db = getDB();
  if (dados.usuarioIdIahub) {
    const existente = db.prepare(`
      SELECT * FROM consultores WHERE usuario_id_iahub = ? AND empresa_id = ?
    `).get(Number(dados.usuarioIdIahub), Number(empresaId));
    if (existente) throw new Error('Já existe um consultor para este usuário nesta empresa.');
  }

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO consultores (id, usuario_id_iahub, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    dados.usuarioIdIahub ? Number(dados.usuarioIdIahub) : null,
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

/**
 * Busca consultores ativos por telefone em TODAS as empresas (sem filtro de
 * empresaId) — usado só pelo login externo por telefone (login-externo-service.js)
 * para descobrir a quais empresas um número de WhatsApp está vinculado antes
 * de qualquer sessão existir. Comparação de telefone feita em JS (não em
 * SQL) porque a coluna guarda o valor como veio do cadastro, sem normalização
 * — mesmo padrão já usado em iniciarLogin antes desta função existir.
 */
function listarConsultoresPorTelefoneNormalizado(telefoneNormalizado, normalizarFn) {
  const db = getDB();
  const rows = db.prepare(`SELECT * FROM consultores WHERE ativo = 1 AND telefone IS NOT NULL`).all();
  return rows
    .map(_rowParaDominio)
    .filter(c => normalizarFn(c.telefone) === telefoneNormalizado);
}

function upsertConsultorPlatform(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const idPreferencial = dados.platformIdentityId || crypto.randomUUID();
  const existentePorId = db.prepare('SELECT * FROM consultores WHERE id = ? AND empresa_id = ?').get(idPreferencial, Number(empresaId));
  const existentePorSoftExpert = dados.idSoftexpert
    ? db.prepare('SELECT * FROM consultores WHERE empresa_id = ? AND id_softexpert = ?').get(Number(empresaId), String(dados.idSoftexpert))
    : null;
  const existente = existentePorId || existentePorSoftExpert;

  if (existente) {
    db.prepare(`
      UPDATE consultores
         SET usuario_id_iahub = ?, id_softexpert = ?, telefone = ?, ativo = ?, pre_analise_automatica = ?, atualizado_em = ?
       WHERE id = ? AND empresa_id = ?
    `).run(
      dados.usuarioIdIahub ? Number(dados.usuarioIdIahub) : existente.usuario_id_iahub,
      dados.idSoftexpert ?? existente.id_softexpert,
      dados.telefone ?? existente.telefone,
      dados.ativo === false ? 0 : 1,
      dados.preAnaliseAutomatica === false ? 0 : 1,
      agora,
      existente.id,
      Number(empresaId)
    );
    return _rowParaDominio(db.prepare('SELECT * FROM consultores WHERE id = ? AND empresa_id = ?').get(existente.id, Number(empresaId)));
  }

  db.prepare(`
    INSERT INTO consultores (id, usuario_id_iahub, empresa_id, id_softexpert, telefone, ativo, pre_analise_automatica, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    idPreferencial,
    dados.usuarioIdIahub ? Number(dados.usuarioIdIahub) : null,
    Number(empresaId),
    dados.idSoftexpert ?? null,
    dados.telefone ?? null,
    dados.ativo === false ? 0 : 1,
    dados.preAnaliseAutomatica === false ? 0 : 1,
    agora,
    agora
  );

  return _rowParaDominio(db.prepare('SELECT * FROM consultores WHERE id = ? AND empresa_id = ?').get(idPreferencial, Number(empresaId)));
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

// Nome de exibição do consultor — a tabela `consultores` não tem campo
// próprio de nome (só telefone/id_softexpert/vínculo opcional com usuário
// IAHub, ver nota no topo do arquivo). A fonte real do nome é `tecnicos`
// (importado do SoftExpert), cruzando id_softexpert do consultor com
// id_origem do técnico — funciona mesmo sem usuarioIdIahub vinculado, que é
// o cenário predominante hoje (login só por telefone). Usado para exibir
// "Minha fila — <nome>" no radar (pedido do usuário, 2026-10).
function getNomeTecnicoPorIdOrigem(empresaId, idSoftexpert) {
  if (!empresaId || !idSoftexpert) return null;
  const db = getDB();
  const row = db.prepare(`
    SELECT nome FROM tecnicos WHERE empresa_id = ? AND id_origem = ?
  `).get(Number(empresaId), String(idSoftexpert));
  return row?.nome || null;
}

module.exports = {
  criarConsultor,
  getConsultor,
  getConsultorPorUsuario,
  listarConsultores,
  listarConsultoresPorTelefoneNormalizado,
  upsertConsultorPlatform,
  atualizarConsultor,
  excluirConsultor,
  getNomeTecnicoPorIdOrigem,
};
