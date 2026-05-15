// CRUD genérico para SQLite — mesma API do modules/crud/index.js do IAHub
// Todas as operações são síncronas (better-sqlite3)

const { getDB } = require('./index');

function _uuid() {
  return require('crypto').randomUUID
    ? require('crypto').randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function _agora() {
  return new Date().toISOString();
}

function _idAutoincremento(tabela) {
  const idCol = getDB().prepare(`PRAGMA table_info(${tabela})`).all().find(c => c.name === 'id');
  return !!idCol?.pk && String(idCol.type || '').toUpperCase().includes('INTEGER');
}

// Lista registros com filtros opcionais { campo: valor }
function listar(tabela, filtros = {}) {
  const db = getDB();
  const chaves = Object.keys(filtros);

  if (!chaves.length) {
    return db.prepare(`SELECT * FROM ${tabela} ORDER BY rowid DESC`).all();
  }

  const where = chaves.map(k => `${k} = ?`).join(' AND ');
  const vals  = chaves.map(k => filtros[k]);
  return db.prepare(`SELECT * FROM ${tabela} WHERE ${where} ORDER BY rowid DESC`).all(vals);
}

// Busca um registro pelo id
function buscarPorId(tabela, id) {
  return getDB().prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(id) || null;
}

// Busca registros por um campo específico
function buscarPor(tabela, campo, valor) {
  return getDB().prepare(`SELECT * FROM ${tabela} WHERE ${campo} = ? LIMIT 1`).get(valor) || null;
}

// Cria um registro — auto-gera id (TEXT uuid) e criado_em/atualizado_em se não fornecidos
function criar(tabela, dados) {
  const db     = getDB();
  const agora  = _agora();
  const registro = {
    criado_em:    agora,
    atualizado_em: agora,
    ...dados,
  };
  const autoId = _idAutoincremento(tabela);
  if (!autoId && registro.id === undefined) registro.id = _uuid();

  const cols = Object.keys(registro);
  const placeholders = cols.map(() => '?').join(', ');
  const vals = cols.map(c => registro[c]);

  const info = db.prepare(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${placeholders})`).run(vals);
  if (autoId && registro.id === undefined) return buscarPorId(tabela, info.lastInsertRowid);
  return registro;
}

// Atualiza um registro pelo id — nunca sobrescreve id e criado_em
function atualizar(tabela, id, dados) {
  const db = getDB();
  const { id: _ignoreId, criado_em: _ignoreCriadoEm, ...patch } = dados;
  const atualizado = { ...patch, atualizado_em: _agora() };
  const set  = Object.keys(atualizado).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(atualizado), id];
  db.prepare(`UPDATE ${tabela} SET ${set} WHERE id = ?`).run(vals);
  return buscarPorId(tabela, id);
}

// Exclui um registro pelo id
function excluir(tabela, id) {
  const info = getDB().prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(id);
  return info.changes > 0;
}

// Conta registros com filtros opcionais
function contar(tabela, filtros = {}) {
  const db    = getDB();
  const chaves = Object.keys(filtros);
  if (!chaves.length) {
    return db.prepare(`SELECT COUNT(*) as total FROM ${tabela}`).get().total;
  }
  const where = chaves.map(k => `${k} = ?`).join(' AND ');
  const vals  = chaves.map(k => filtros[k]);
  return db.prepare(`SELECT COUNT(*) as total FROM ${tabela} WHERE ${where}`).get(vals).total;
}

module.exports = { listar, buscarPorId, buscarPor, criar, atualizar, excluir, contar };
