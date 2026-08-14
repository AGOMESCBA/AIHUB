const crypto = require('crypto');
const { getDB } = require('../database');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function agora() {
  return new Date().toISOString();
}

function groupFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    empresa_id: Number(row.empresa_id),
    ativo: row.ativo ? 1 : 0,
    membros_count: Number(row.membros_count || 0),
  };
}

function memberFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    empresa_id: Number(row.empresa_id),
    numero_ativo: row.numero_ativo ? 1 : 0,
  };
}

function listarGrupos(empresaId, { somenteAtivos = false } = {}) {
  return getDB().prepare(`
    SELECT g.*,
      (SELECT COUNT(*)
         FROM whatsapp_recipient_group_members m
         JOIN whatsapp_allowed_numbers n ON n.id = m.numero_id AND n.empresa_id = m.empresa_id AND n.ativo = 1
        WHERE m.grupo_id = g.id AND m.ativo = 1) AS membros_count
    FROM whatsapp_recipient_groups g
    WHERE g.empresa_id = ?
      ${somenteAtivos ? 'AND g.ativo = 1' : ''}
    ORDER BY g.nome COLLATE NOCASE ASC
  `).all(Number(empresaId)).map(groupFromRow);
}

function buscarGrupo(empresaId, id) {
  const grupo = groupFromRow(getDB().prepare(`
    SELECT g.*,
      (SELECT COUNT(*)
         FROM whatsapp_recipient_group_members m
         JOIN whatsapp_allowed_numbers n ON n.id = m.numero_id AND n.empresa_id = m.empresa_id AND n.ativo = 1
        WHERE m.grupo_id = g.id AND m.ativo = 1) AS membros_count
    FROM whatsapp_recipient_groups g
    WHERE g.empresa_id = ? AND g.id = ?
  `).get(Number(empresaId), String(id)));
  if (!grupo) return null;
  grupo.membros = listarMembros(empresaId, id);
  return grupo;
}

function nomeEmUso(empresaId, nome, ignorarId = null) {
  return !!getDB().prepare(`
    SELECT id
    FROM whatsapp_recipient_groups
    WHERE empresa_id = ? AND nome = ? AND (? IS NULL OR id <> ?)
    LIMIT 1
  `).get(Number(empresaId), String(nome || '').trim(), ignorarId ? String(ignorarId) : null, ignorarId ? String(ignorarId) : null);
}

function criarGrupo(empresaId, dados = {}) {
  const nome = String(dados.nome || '').trim();
  if (!nome) throw Object.assign(new Error('Campo obrigatorio: nome.'), { statusCode: 400 });
  if (nomeEmUso(empresaId, nome)) throw Object.assign(new Error('Ja existe um grupo com este nome nesta empresa.'), { statusCode: 400 });
  const now = agora();
  const id = uuid();
  getDB().prepare(`
    INSERT INTO whatsapp_recipient_groups (id, empresa_id, nome, descricao, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), nome, String(dados.descricao || '').trim() || null, dados.ativo === false ? 0 : 1, now, now);
  return buscarGrupo(empresaId, id);
}

function atualizarGrupo(empresaId, id, dados = {}) {
  const atual = buscarGrupo(empresaId, id);
  if (!atual) return null;
  const allowed = ['nome', 'descricao', 'ativo'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (dados[key] === undefined) continue;
    if (key === 'nome') {
      const nome = String(dados.nome || '').trim();
      if (!nome) throw Object.assign(new Error('Campo obrigatorio: nome.'), { statusCode: 400 });
      if (nomeEmUso(empresaId, nome, id)) throw Object.assign(new Error('Ja existe um grupo com este nome nesta empresa.'), { statusCode: 400 });
      sets.push('nome = ?');
      values.push(nome);
    } else if (key === 'descricao') {
      sets.push('descricao = ?');
      values.push(String(dados.descricao || '').trim() || null);
    } else if (key === 'ativo') {
      sets.push('ativo = ?');
      values.push(dados.ativo ? 1 : 0);
    }
  }
  if (!sets.length) return atual;
  sets.push('atualizado_em = ?');
  values.push(agora(), Number(empresaId), String(id));
  getDB().prepare(`UPDATE whatsapp_recipient_groups SET ${sets.join(', ')} WHERE empresa_id = ? AND id = ?`).run(...values);
  return buscarGrupo(empresaId, id);
}

function excluirGrupo(empresaId, id) {
  const atual = buscarGrupo(empresaId, id);
  if (!atual) return null;
  getDB().prepare(`
    UPDATE whatsapp_recipient_groups
    SET ativo = 0, atualizado_em = ?
    WHERE empresa_id = ? AND id = ?
  `).run(agora(), Number(empresaId), String(id));
  return { ok: true };
}

function listarMembros(empresaId, grupoId) {
  return getDB().prepare(`
    SELECT m.id, m.grupo_id, m.empresa_id, m.numero_id, m.ativo, m.criado_em, m.atualizado_em,
           n.nome, n.numero, n.ativo AS numero_ativo,
           n.modulo_financeiro, n.modulo_compras, n.modulo_faturamento, n.modulo_comissao, n.modulo_estoque,
           n.erp_tipo, n.erp_id
    FROM whatsapp_recipient_group_members m
    JOIN whatsapp_allowed_numbers n ON n.id = m.numero_id AND n.empresa_id = m.empresa_id
    WHERE m.empresa_id = ? AND m.grupo_id = ? AND m.ativo = 1
    ORDER BY n.nome COLLATE NOCASE ASC, n.numero ASC
  `).all(Number(empresaId), String(grupoId)).map(memberFromRow);
}

function substituirMembros(empresaId, grupoId, numeroIds = []) {
  const grupo = buscarGrupo(empresaId, grupoId);
  if (!grupo) throw Object.assign(new Error('Grupo nao encontrado.'), { statusCode: 404 });
  const ids = [...new Set((numeroIds || [])
    .map(item => typeof item === 'object' && item ? (item.id || item.numero_id) : item)
    .map(String)
    .filter(Boolean))];
  const db = getDB();
  const tx = db.transaction(() => {
    const now = agora();
    db.prepare('UPDATE whatsapp_recipient_group_members SET ativo = 0, atualizado_em = ? WHERE empresa_id = ? AND grupo_id = ?')
      .run(now, Number(empresaId), String(grupoId));
    if (!ids.length) return buscarGrupo(empresaId, grupoId);
    const placeholders = ids.map(() => '?').join(',');
    const numeros = db.prepare(`
      SELECT id
      FROM whatsapp_allowed_numbers
      WHERE empresa_id = ? AND ativo = 1 AND id IN (${placeholders})
    `).all(Number(empresaId), ...ids).map(row => String(row.id));
    if (numeros.length !== ids.length) {
      throw Object.assign(new Error('Um ou mais membros nao pertencem aos numeros autorizados desta empresa.'), { statusCode: 400 });
    }
    const upsert = db.prepare(`
      INSERT INTO whatsapp_recipient_group_members (id, grupo_id, empresa_id, numero_id, ativo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(grupo_id, numero_id) DO UPDATE SET ativo = 1, atualizado_em = excluded.atualizado_em
    `);
    for (const numeroId of numeros) upsert.run(uuid(), String(grupoId), Number(empresaId), numeroId, now, now);
    return buscarGrupo(empresaId, grupoId);
  });
  return tx();
}

function buscarGruposPorIds(empresaId, ids = []) {
  const lista = [...new Set((ids || [])
    .map(item => typeof item === 'object' && item ? (item.id || item.grupo_id) : item)
    .map(String)
    .filter(Boolean))];
  if (!lista.length) return [];
  const placeholders = lista.map(() => '?').join(',');
  return getDB().prepare(`
    SELECT g.*,
      (SELECT COUNT(*)
         FROM whatsapp_recipient_group_members m
         JOIN whatsapp_allowed_numbers n ON n.id = m.numero_id AND n.empresa_id = m.empresa_id AND n.ativo = 1
        WHERE m.grupo_id = g.id AND m.ativo = 1) AS membros_count
    FROM whatsapp_recipient_groups g
    WHERE g.empresa_id = ? AND g.ativo = 1 AND g.id IN (${placeholders})
    ORDER BY g.nome COLLATE NOCASE ASC
  `).all(Number(empresaId), ...lista).map(groupFromRow);
}

function listarMembrosAtivosDosGrupos(empresaId, grupoIds = []) {
  const grupos = buscarGruposPorIds(empresaId, grupoIds).map(g => String(g.id));
  if (!grupos.length) return [];
  const placeholders = grupos.map(() => '?').join(',');
  return getDB().prepare(`
    SELECT DISTINCT n.id, n.nome, n.numero,
           n.modulo_financeiro, n.modulo_compras, n.modulo_faturamento, n.modulo_comissao, n.modulo_estoque,
           n.erp_tipo, n.erp_id
    FROM whatsapp_recipient_group_members m
    JOIN whatsapp_recipient_groups g ON g.id = m.grupo_id AND g.empresa_id = m.empresa_id AND g.ativo = 1
    JOIN whatsapp_allowed_numbers n ON n.id = m.numero_id AND n.empresa_id = m.empresa_id AND n.ativo = 1
    WHERE m.empresa_id = ? AND m.ativo = 1 AND m.grupo_id IN (${placeholders})
    ORDER BY n.nome COLLATE NOCASE ASC, n.numero ASC
  `).all(Number(empresaId), ...grupos);
}

module.exports = {
  listarGrupos,
  buscarGrupo,
  criarGrupo,
  atualizarGrupo,
  excluirGrupo,
  listarMembros,
  substituirMembros,
  buscarGruposPorIds,
  listarMembrosAtivosDosGrupos,
};
