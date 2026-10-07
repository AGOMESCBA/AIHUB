// Repository de `clientes`, `usuarios_cliente`, `tecnicos` — entidades
// normalizadas da base histórica. CNPJ único por empresa (tenant do IA
// Service), nunca globalmente (seção 7 do prompt + isolamento multiempresa).

const crypto = require('crypto');
const { getDB } = require('../database');

function _clienteParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, cnpj: row.cnpj, nome: row.nome,
    nomeFantasia: row.nome_fantasia, ativo: !!row.ativo,
    criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

/**
 * Upsert por (empresa_id, cnpj) — chave natural do cliente. Retorna
 * { cliente, criado: boolean } para o importador contabilizar inseridos vs.
 * atualizados vs. sem alteração.
 */
function upsertCliente(empresaId, { cnpj, nome, nomeFantasia }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!cnpj) throw new Error('cnpj é obrigatório para localizar/criar cliente.');
  const db = getDB();
  const agora = new Date().toISOString();

  const existente = db.prepare(`SELECT * FROM clientes WHERE empresa_id = ? AND cnpj = ?`).get(Number(empresaId), cnpj);

  if (existente) {
    const mudou = (nome && nome !== existente.nome) || (nomeFantasia && nomeFantasia !== existente.nome_fantasia);
    if (mudou) {
      db.prepare(`UPDATE clientes SET nome = COALESCE(?, nome), nome_fantasia = COALESCE(?, nome_fantasia), atualizado_em = ? WHERE id = ?`)
        .run(nome ?? null, nomeFantasia ?? null, agora, existente.id);
    }
    return { cliente: _clienteParaDominio(db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(existente.id)), criado: false, atualizado: mudou };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO clientes (id, empresa_id, cnpj, nome, nome_fantasia, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, Number(empresaId), cnpj, nome ?? null, nomeFantasia ?? null, agora, agora);
  return { cliente: _clienteParaDominio(db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(id)), criado: true, atualizado: false };
}

function getClientePorCnpj(empresaId, cnpj) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _clienteParaDominio(db.prepare(`SELECT * FROM clientes WHERE empresa_id = ? AND cnpj = ?`).get(Number(empresaId), cnpj));
}

function listarClientes(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const limite = Math.min(Number(filtros.limite) || 100, 1000);
  const rows = db.prepare(`SELECT * FROM clientes WHERE empresa_id = ? ORDER BY nome LIMIT ?`).all(Number(empresaId), limite);
  return rows.map(_clienteParaDominio);
}

function contarClientes(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return db.prepare(`SELECT COUNT(*) AS total FROM clientes WHERE empresa_id = ?`).get(Number(empresaId)).total;
}

// ── Usuários de cliente ──────────────────────────────────────────────────

function _usuarioParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, clienteId: row.cliente_id,
    sistemaOrigem: row.sistema_origem, idOrigem: row.id_origem, identificador: row.identificador,
    nome: row.nome, email: row.email, telefone: row.telefone, ativo: !!row.ativo,
    criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

function getUsuarioClientePorId(empresaId, id) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!id) return null;
  const db = getDB();
  const row = db.prepare(`SELECT * FROM usuarios_cliente WHERE id = ? AND empresa_id = ?`).get(id, Number(empresaId));
  return _usuarioParaDominio(row);
}

/**
 * Upsert por (empresa, sistema_origem, id_origem) quando id_origem existe;
 * senão sempre cria (não há chave natural confiável para deduplicar).
 */
function upsertUsuarioCliente(empresaId, { clienteId, sistemaOrigem, idOrigem, identificador, nome, email, telefone }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!clienteId) throw new Error('clienteId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();

  if (idOrigem) {
    const existente = db.prepare(`
      SELECT * FROM usuarios_cliente WHERE empresa_id = ? AND sistema_origem = ? AND id_origem = ?
    `).get(Number(empresaId), sistemaOrigem, idOrigem);

    if (existente) {
      db.prepare(`
        UPDATE usuarios_cliente SET cliente_id = ?, identificador = COALESCE(?, identificador),
          nome = COALESCE(?, nome), email = COALESCE(?, email), telefone = COALESCE(?, telefone), atualizado_em = ?
        WHERE id = ?
      `).run(clienteId, identificador ?? null, nome ?? null, email ?? null, telefone ?? null, agora, existente.id);
      return { usuario: _usuarioParaDominio(db.prepare(`SELECT * FROM usuarios_cliente WHERE id = ?`).get(existente.id)), criado: false };
    }
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO usuarios_cliente (id, empresa_id, cliente_id, sistema_origem, id_origem, identificador, nome, email, telefone, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, Number(empresaId), clienteId, sistemaOrigem, idOrigem ?? null, identificador ?? null, nome ?? null, email ?? null, telefone ?? null, agora, agora);
  return { usuario: _usuarioParaDominio(db.prepare(`SELECT * FROM usuarios_cliente WHERE id = ?`).get(id)), criado: true };
}

function contarUsuariosCliente(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return db.prepare(`SELECT COUNT(*) AS total FROM usuarios_cliente WHERE empresa_id = ?`).get(Number(empresaId)).total;
}

// ── Técnicos ──────────────────────────────────────────────────────────────

function _tecnicoParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, sistemaOrigem: row.sistema_origem,
    idOrigem: row.id_origem, nome: row.nome, email: row.email, ativo: !!row.ativo,
    criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

function upsertTecnico(empresaId, { sistemaOrigem, idOrigem, nome, email }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!idOrigem) throw new Error('idOrigem é obrigatório para localizar/criar técnico.');
  const db = getDB();
  const agora = new Date().toISOString();

  const existente = db.prepare(`
    SELECT * FROM tecnicos WHERE empresa_id = ? AND sistema_origem = ? AND id_origem = ?
  `).get(Number(empresaId), sistemaOrigem, idOrigem);

  if (existente) {
    const mudou = (nome && nome !== existente.nome) || (email && email !== existente.email);
    if (mudou) {
      db.prepare(`UPDATE tecnicos SET nome = COALESCE(?, nome), email = COALESCE(?, email), atualizado_em = ? WHERE id = ?`)
        .run(nome ?? null, email ?? null, agora, existente.id);
    }
    return { tecnico: _tecnicoParaDominio(db.prepare(`SELECT * FROM tecnicos WHERE id = ?`).get(existente.id)), criado: false };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO tecnicos (id, empresa_id, sistema_origem, id_origem, nome, email, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, Number(empresaId), sistemaOrigem, idOrigem, nome ?? null, email ?? null, agora, agora);
  return { tecnico: _tecnicoParaDominio(db.prepare(`SELECT * FROM tecnicos WHERE id = ?`).get(id)), criado: true };
}

function contarTecnicos(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return db.prepare(`SELECT COUNT(*) AS total FROM tecnicos WHERE empresa_id = ?`).get(Number(empresaId)).total;
}

/**
 * Resolve o registro de `tecnicos` a partir do par (sistema_origem, id_origem)
 * — usado para cruzar `consultores.id_softexpert` (cadastro manual) com o
 * técnico que a importação criou a partir de CDUSERANA. Retorna `null` se
 * esse id_origem ainda não apareceu em nenhuma importação (consultor
 * cadastrado, mas nunca visto como responsável/posicionador em um chamado).
 */
function getTecnicoPorOrigem(empresaId, sistemaOrigem, idOrigem) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!idOrigem) return null;
  const db = getDB();
  return _tecnicoParaDominio(db.prepare(`
    SELECT * FROM tecnicos WHERE empresa_id = ? AND sistema_origem = ? AND id_origem = ?
  `).get(Number(empresaId), sistemaOrigem, idOrigem));
}

function getTecnicoPorId(empresaId, id) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!id) return null;
  const db = getDB();
  return _tecnicoParaDominio(db.prepare(`SELECT * FROM tecnicos WHERE id = ? AND empresa_id = ?`).get(id, Number(empresaId)));
}

module.exports = {
  upsertCliente, getClientePorCnpj, listarClientes, contarClientes,
  upsertUsuarioCliente, getUsuarioClientePorId, contarUsuariosCliente,
  upsertTecnico, contarTecnicos, getTecnicoPorOrigem, getTecnicoPorId,
};
