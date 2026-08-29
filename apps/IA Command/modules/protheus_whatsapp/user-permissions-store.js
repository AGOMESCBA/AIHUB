const crypto = require('crypto');
const { getDB } = require('../database');
const tokenService = require('./token-service');

function normalizarNumero(valor) {
  return tokenService.normalizarCelular(valor);
}

function parseJson(valor, fallback) {
  try {
    if (!valor) return fallback;
    const parsed = JSON.parse(valor);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function serializar(row) {
  if (!row) return null;
  return {
    ...row,
    ativo: Number(row.ativo || 0) ? 1 : 0,
    empresasPermitidas: parseJson(row.empresas_permitidas_json, []),
    filiaisPermitidas: parseJson(row.filiais_permitidas_json, []),
  };
}

function salvarSync({
  empresaId,
  usuarioId,
  usuarioNome,
  celular,
  filialAtual = null,
  empresasPermitidas = [],
  filiaisPermitidas = [],
  origem = 'protheus_token',
}) {
  const empresaPrincipal = Number(empresaId || 0);
  const numero = normalizarNumero(celular);
  if (!empresaPrincipal) throw new Error('empresaId obrigatorio.');
  if (!numero) throw new Error('celular obrigatorio.');

  const uid = String(usuarioId || '').trim();
  const nome = String(usuarioNome || '').trim();
  const empresas = tokenService.normalizarEmpresasPermitidas(empresasPermitidas, empresaPrincipal);
  const filiais = tokenService.normalizarFiliaisPermitidas(filiaisPermitidas);
  const agora = new Date().toISOString();
  const db = getDB();

  const existente = uid
    ? db.prepare(`
        SELECT id
          FROM protheus_web_user_permissions
         WHERE empresa_id = ? AND usuario_id = ?
         LIMIT 1
      `).get(empresaPrincipal, uid)
    : db.prepare(`
        SELECT id
          FROM protheus_web_user_permissions
         WHERE empresa_id = ? AND celular = ?
         LIMIT 1
      `).get(empresaPrincipal, numero);

  if (existente) {
    db.prepare(`
      UPDATE protheus_web_user_permissions
         SET usuario_id = COALESCE(NULLIF(?, ''), usuario_id),
             usuario_nome = COALESCE(NULLIF(?, ''), usuario_nome),
             celular = ?,
             filial_atual = ?,
             empresas_permitidas_json = ?,
             filiais_permitidas_json = ?,
             origem = ?,
             ativo = 1,
             ultimo_sync_em = ?,
             atualizado_em = ?
       WHERE id = ?
    `).run(
      uid,
      nome,
      numero,
      filialAtual || null,
      JSON.stringify(empresas),
      JSON.stringify(filiais),
      origem,
      agora,
      agora,
      existente.id
    );
    return buscarPorId(existente.id);
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO protheus_web_user_permissions
      (id, empresa_id, usuario_id, usuario_nome, celular, filial_atual,
       empresas_permitidas_json, filiais_permitidas_json, origem, ativo,
       ultimo_sync_em, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id,
    empresaPrincipal,
    uid || null,
    nome || null,
    numero,
    filialAtual || null,
    JSON.stringify(empresas),
    JSON.stringify(filiais),
    origem,
    agora,
    agora,
    agora
  );
  return buscarPorId(id);
}

function criar({
  empresaId,
  usuarioId = null,
  usuarioNome = null,
  celular,
  filialAtual = null,
  empresasPermitidas = [],
  filiaisPermitidas = [],
  observacoes = null,
  ativo = true,
}) {
  const empresaPrincipal = Number(empresaId || 0);
  const numero = normalizarNumero(celular);
  if (!empresaPrincipal) throw new Error('empresaId obrigatorio.');
  if (!numero) throw new Error('celular obrigatorio.');

  const uid = String(usuarioId || '').trim() || null;
  const nome = String(usuarioNome || '').trim() || null;
  const empresas = tokenService.normalizarEmpresasPermitidas(empresasPermitidas, empresaPrincipal);
  const filiais = tokenService.normalizarFiliaisPermitidas(filiaisPermitidas);
  const agora = new Date().toISOString();
  const db = getDB();

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO protheus_web_user_permissions
      (id, empresa_id, usuario_id, usuario_nome, celular, filial_atual,
       empresas_permitidas_json, filiais_permitidas_json, origem, ativo,
       observacoes, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
  `).run(
    id,
    empresaPrincipal,
    uid,
    nome,
    numero,
    filialAtual || null,
    JSON.stringify(empresas),
    JSON.stringify(filiais),
    ativo ? 1 : 0,
    observacoes || null,
    agora,
    agora
  );
  return buscarPorId(id);
}

function excluir(id) {
  const existing = buscarPorId(id);
  if (!existing) return false;
  getDB().prepare(`DELETE FROM protheus_web_user_permissions WHERE id = ?`).run(id);
  return true;
}

function listar({ empresaIds = [], incluirInativos = true } = {}) {
  const ids = (empresaIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  const where = [`empresa_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  if (!incluirInativos) where.push('ativo = 1');
  return getDB().prepare(`
    SELECT *
      FROM protheus_web_user_permissions
     WHERE ${where.join(' AND ')}
     ORDER BY usuario_nome COLLATE NOCASE, usuario_id, celular
  `).all(...params).map(serializar);
}

function buscarPorId(id) {
  const row = getDB().prepare(`
    SELECT *
      FROM protheus_web_user_permissions
     WHERE id = ?
     LIMIT 1
  `).get(id);
  return serializar(row);
}

function listarAtivosPorCelular(celular, empresaId = null) {
  const numero = normalizarNumero(celular);
  if (!numero) return [];
  if (empresaId) {
    return getDB().prepare(`
      SELECT *
        FROM protheus_web_user_permissions
       WHERE celular = ?
         AND empresa_id = ?
         AND ativo = 1
       ORDER BY ultimo_sync_em DESC, atualizado_em DESC
    `).all(numero, Number(empresaId)).map(serializar);
  }
  return getDB().prepare(`
    SELECT *
      FROM protheus_web_user_permissions
     WHERE celular = ?
       AND ativo = 1
     ORDER BY ultimo_sync_em DESC, atualizado_em DESC
  `).all(numero).map(serializar);
}

function atualizar(id, campos = {}) {
  const existing = buscarPorId(id);
  if (!existing) return null;

  const sets = [];
  const params = [];
  const add = (coluna, valor) => {
    sets.push(`${coluna} = ?`);
    params.push(valor);
  };

  if (campos.usuario_id !== undefined) add('usuario_id', String(campos.usuario_id || '').trim() || null);
  if (campos.usuario_nome !== undefined) add('usuario_nome', String(campos.usuario_nome || '').trim() || null);
  if (campos.celular !== undefined) add('celular', normalizarNumero(campos.celular));
  if (campos.observacoes !== undefined) add('observacoes', campos.observacoes || null);
  if (campos.ativo !== undefined) add('ativo', campos.ativo ? 1 : 0);
  if (campos.empresasPermitidas !== undefined) {
    add('empresas_permitidas_json', JSON.stringify(tokenService.normalizarEmpresasPermitidas(campos.empresasPermitidas, existing.empresa_id)));
  }
  if (campos.filiaisPermitidas !== undefined) {
    add('filiais_permitidas_json', JSON.stringify(tokenService.normalizarFiliaisPermitidas(campos.filiaisPermitidas)));
  }

  if (!sets.length) return existing;
  add('atualizado_em', new Date().toISOString());
  params.push(id);
  getDB().prepare(`
    UPDATE protheus_web_user_permissions
       SET ${sets.join(', ')}
     WHERE id = ?
  `).run(...params);
  return buscarPorId(id);
}

module.exports = {
  salvarSync,
  criar,
  listar,
  buscarPorId,
  listarAtivosPorCelular,
  atualizar,
  excluir,
  normalizarNumero,
};
