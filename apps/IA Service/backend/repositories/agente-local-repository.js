// Unico ponto de acesso SQL as tabelas `agente_local_config` e
// `fontes_historicas`. Segredos (token, senha SQL Server) chegam aqui já
// criptografados pelo service — este repository nunca criptografa/descriptografa,
// apenas persiste e lê o que recebe.

const crypto = require('crypto');
const { getDB } = require('../database');

function _configParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    url: row.url,
    tokenEnc: row.token_enc,
    cryptoKeyEnc: row.crypto_key_enc,
    cryptoAtivo: !!row.crypto_ativo,
    ultimoTesteEm: row.ultimo_teste_em,
    ultimoTesteOk: row.ultimo_teste_ok === null ? null : !!row.ultimo_teste_ok,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function getConfig(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _configParaDominio(db.prepare(`SELECT * FROM agente_local_config WHERE empresa_id = ?`).get(Number(empresaId)));
}

function salvarConfig(empresaId, { url, tokenEnc, cryptoKeyEnc, cryptoAtivo }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const existente = getConfig(empresaId);

  if (existente) {
    db.prepare(`
      UPDATE agente_local_config
         SET url = ?, token_enc = COALESCE(?, token_enc), crypto_key_enc = COALESCE(?, crypto_key_enc),
             crypto_ativo = ?, atualizado_em = ?
       WHERE empresa_id = ?
    `).run(
      url ?? existente.url,
      tokenEnc ?? null,
      cryptoKeyEnc ?? null,
      cryptoAtivo === undefined ? (existente.cryptoAtivo ? 1 : 0) : (cryptoAtivo ? 1 : 0),
      agora,
      Number(empresaId)
    );
  } else {
    db.prepare(`
      INSERT INTO agente_local_config (empresa_id, url, token_enc, crypto_key_enc, crypto_ativo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(Number(empresaId), url ?? null, tokenEnc ?? null, cryptoKeyEnc ?? null, cryptoAtivo ? 1 : 0, agora, agora);
  }

  return getConfig(empresaId);
}

function registrarTeste(empresaId, ok) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  db.prepare(`
    UPDATE agente_local_config SET ultimo_teste_em = ?, ultimo_teste_ok = ? WHERE empresa_id = ?
  `).run(agora, ok ? 1 : 0, Number(empresaId));
  return getConfig(empresaId);
}

// ── Fontes históricas ──────────────────────────────────────────────────────

function _fonteParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    connectionKey: row.connection_key,
    nome: row.nome,
    sistemaOrigem: row.sistema_origem,
    adapter: row.adapter,
    dbHost: row.db_host,
    dbPort: row.db_port,
    dbName: row.db_name,
    dbUser: row.db_user,
    dbPassEnc: row.db_pass_enc,
    dbDriver: row.db_driver,
    ativo: !!row.ativo,
    sincronizadaAgenteEm: row.sincronizada_agente_em,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function criarFonte(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO fontes_historicas (
      id, empresa_id, connection_key, nome, sistema_origem, adapter,
      db_host, db_port, db_name, db_user, db_pass_enc, db_driver, ativo,
      criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, Number(empresaId), dados.connectionKey, dados.nome, dados.sistemaOrigem, dados.adapter,
    dados.dbHost ?? null, dados.dbPort != null ? String(dados.dbPort) : null, dados.dbName ?? null, dados.dbUser ?? null,
    dados.dbPassEnc ?? null, dados.dbDriver ?? null, dados.ativo === false ? 0 : 1,
    agora, agora
  );

  return getFonte(empresaId, id);
}

function atualizarFonte(empresaId, fonteId, patch) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const atual = getFonte(empresaId, fonteId);
  if (!atual) return null;
  const agora = new Date().toISOString();

  db.prepare(`
    UPDATE fontes_historicas
       SET nome = ?, db_host = ?, db_port = ?, db_name = ?, db_user = ?,
           db_pass_enc = COALESCE(?, db_pass_enc), db_driver = ?, ativo = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ?
  `).run(
    patch.nome ?? atual.nome,
    patch.dbHost ?? atual.dbHost,
    patch.dbPort != null ? String(patch.dbPort) : atual.dbPort,
    patch.dbName ?? atual.dbName,
    patch.dbUser ?? atual.dbUser,
    patch.dbPassEnc ?? null,
    patch.dbDriver ?? atual.dbDriver,
    patch.ativo === undefined ? (atual.ativo ? 1 : 0) : (patch.ativo ? 1 : 0),
    agora,
    fonteId,
    Number(empresaId)
  );

  return getFonte(empresaId, fonteId);
}

function marcarSincronizadaNoAgente(empresaId, fonteId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  db.prepare(`UPDATE fontes_historicas SET sincronizada_agente_em = ? WHERE id = ? AND empresa_id = ?`)
    .run(agora, fonteId, Number(empresaId));
  return getFonte(empresaId, fonteId);
}

function getFonte(empresaId, fonteId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _fonteParaDominio(db.prepare(`SELECT * FROM fontes_historicas WHERE id = ? AND empresa_id = ?`).get(fonteId, Number(empresaId)));
}

function listarFontes(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.ativo !== undefined) {
    condicoes.push('ativo = ?');
    params.push(filtros.ativo ? 1 : 0);
  }
  const rows = db.prepare(`SELECT * FROM fontes_historicas WHERE ${condicoes.join(' AND ')} ORDER BY criado_em ASC`).all(...params);
  return rows.map(_fonteParaDominio);
}

module.exports = {
  getConfig,
  salvarConfig,
  registrarTeste,
  criarFonte,
  atualizarFonte,
  marcarSincronizadaNoAgente,
  getFonte,
  listarFontes,
};
