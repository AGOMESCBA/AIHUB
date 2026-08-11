const crypto = require('crypto');
const { getDB } = require('../database');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function agora() {
  return new Date().toISOString();
}

function normalizarNumero(numero) {
  return String(numero || '').replace(/\D/g, '');
}

function variantesNumeroBrasil(numero) {
  const base = normalizarNumero(String(numero || '').split('@')[0]);
  const variantes = new Set();
  if (base) variantes.add(base);

  // O WhatsApp Web pode entregar números BR com ou sem o nono dígito após o DDD.
  if (base.startsWith('55') && base.length === 13) {
    variantes.add(base.slice(0, 4) + base.slice(5));
  } else if (base.startsWith('55') && base.length === 12) {
    variantes.add(base.slice(0, 4) + '9' + base.slice(4));
  }

  return [...variantes];
}

function extrairLid(sender) {
  const valor = String(sender || '');
  if (!valor.includes('@lid')) return '';
  return normalizarNumero(valor.split('@')[0]);
}

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function empresaNome(empresaId) {
  try {
    const empresasDb = require('../../../../modules/empresas/database');
    const empresa = empresasDb.buscarPorId(Number(empresaId));
    return empresa?.razao_social || empresa?.nome || `Empresa #${empresaId}`;
  } catch (_) {
    return `Empresa #${empresaId}`;
  }
}

function _channelFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    numero: row.numero || '',
    provider: row.provider || 'wweb',
    auth_client_id: row.auth_client_id,
    ativo: row.ativo,
    is_windows_service: row.is_windows_service || 0,
    worker_port: row.worker_port || null,
    service_slug: row.service_slug || null,
  };
}

function criarCanal({ nome, numero, auth_client_id, ativo = 1 }) {
  const db = getDB();
  const now = agora();
  const id = uuid();
  db.prepare(`
    INSERT INTO whatsapp_channels (id, nome, numero, provider, auth_client_id, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, 'wweb', ?, ?, ?, ?)
  `).run(id, nome, normalizarNumero(numero), auth_client_id || `iac_ch_${id}`, ativo ? 1 : 0, now, now);
  return buscarCanal(id);
}

function vincularEmpresa(channelId, empresaId, opts = {}) {
  const { aliases, padrao = 0, ativo = 1, ocultar_selecao } = opts;
  const db = getDB();
  const now = agora();
  if (padrao) {
    db.prepare('UPDATE whatsapp_channel_companies SET padrao = 0, atualizado_em = ? WHERE empresa_id = ?')
      .run(now, Number(empresaId));
  }
  const existing = db.prepare(`
    SELECT * FROM whatsapp_channel_companies WHERE channel_id = ? AND empresa_id = ?
  `).get(channelId, Number(empresaId));

  if (existing) {
    db.prepare(`
      UPDATE whatsapp_channel_companies
      SET aliases = ?, padrao = ?, ativo = ?, ocultar_selecao = ?, atualizado_em = ?
      WHERE id = ?
    `).run(
      aliases !== undefined ? aliases : existing.aliases,
      padrao ? 1 : 0,
      ativo ? 1 : 0,
      ocultar_selecao !== undefined ? (ocultar_selecao ? 1 : 0) : (existing.ocultar_selecao ?? 0),
      now,
      existing.id
    );
    return existing.id;
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO whatsapp_channel_companies (id, channel_id, empresa_id, aliases, padrao, ativo, ocultar_selecao, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, channelId, Number(empresaId), aliases || null, padrao ? 1 : 0, ativo ? 1 : 0, ocultar_selecao ? 1 : 0, now, now);
  return id;
}

function atualizarCanal(channelId, dados = {}) {
  const db = getDB();
  const current = buscarCanal(channelId);
  if (!current) return null;
  db.prepare(`
    UPDATE whatsapp_channels
    SET nome = ?, numero = ?, ativo = ?, atualizado_em = ?
    WHERE id = ?
  `).run(
    String(dados.nome ?? current.nome).trim(),
    normalizarNumero(dados.numero ?? current.numero),
    dados.ativo !== undefined ? (Number(dados.ativo) ? 1 : 0) : current.ativo,
    agora(),
    channelId
  );
  return buscarCanal(channelId);
}

function desvincularEmpresa(channelId, empresaId) {
  return getDB().prepare(`
    UPDATE whatsapp_channel_companies
    SET ativo = 0, atualizado_em = ?
    WHERE channel_id = ? AND empresa_id = ?
  `).run(agora(), channelId, Number(empresaId)).changes > 0;
}

function desativarCanal(channelId) {
  return getDB().prepare('UPDATE whatsapp_channels SET ativo = 0, atualizado_em = ? WHERE id = ?')
    .run(agora(), channelId).changes > 0;
}

function buscarCanal(channelId) {
  return _channelFromRow(getDB().prepare('SELECT * FROM whatsapp_channels WHERE id = ?').get(channelId));
}

function buscarCanalAdmin(channelId) {
  const canal = buscarCanal(channelId);
  if (!canal) return null;
  return {
    ...canal,
    empresas: listarEmpresasDoCanal(canal.id),
    padrao: 0,
    aliases: '',
  };
}

function listarAtivosComSessao() {
  return getDB().prepare(`
    SELECT * FROM whatsapp_channels
    WHERE ativo = 1
      AND TRIM(COALESCE(numero, '')) <> ''
      AND TRIM(COALESCE(auth_client_id, '')) <> ''
    ORDER BY criado_em ASC
  `).all().map(_channelFromRow);
}

function listarPorEmpresa(empresaId) {
  return getDB().prepare(`
    SELECT c.*, l.padrao, l.aliases, l.ativo AS link_ativo
    FROM whatsapp_channels c
    JOIN whatsapp_channel_companies l ON l.channel_id = c.id
    WHERE l.empresa_id = ? AND l.ativo = 1 AND c.ativo = 1
    ORDER BY l.padrao DESC, c.criado_em ASC
  `).all(Number(empresaId)).map(row => ({
    ..._channelFromRow(row),
    padrao: row.padrao,
    aliases: row.aliases || '',
    empresas: listarEmpresasDoCanal(row.id),
  }));
}

function listarOrfaosAtivos() {
  return getDB().prepare(`
    SELECT c.*
    FROM whatsapp_channels c
    WHERE c.ativo = 1
      AND NOT EXISTS (
        SELECT 1
        FROM whatsapp_channel_companies l
        WHERE l.channel_id = c.id
          AND l.ativo = 1
      )
    ORDER BY c.nome COLLATE NOCASE ASC
  `).all().map(row => ({
    ..._channelFromRow(row),
    padrao: 0,
    aliases: '',
    empresas: [],
    orfao: 1,
  }));
}

function buscarCanalDaEmpresa(channelId, empresaId) {
  const row = getDB().prepare(`
    SELECT c.*, l.padrao, l.aliases
    FROM whatsapp_channels c
    JOIN whatsapp_channel_companies l ON l.channel_id = c.id
    WHERE c.id = ? AND l.empresa_id = ? AND c.ativo = 1 AND l.ativo = 1
    LIMIT 1
  `).get(channelId, Number(empresaId));
  if (!row) return null;
  return {
    ..._channelFromRow(row),
    padrao: row.padrao,
    aliases: row.aliases || '',
    empresas: listarEmpresasDoCanal(row.id),
  };
}

function getDefaultForEmpresa(empresaId) {
  const canais = listarPorEmpresa(empresaId);
  return canais[0] || null;
}

function ensureDefaultForEmpresa(empresaId) {
  const existente = getDefaultForEmpresa(empresaId);
  if (existente) return existente;

  const id = `emp_${Number(empresaId)}`;
  const db = getDB();
  const now = agora();
  let row = db.prepare('SELECT * FROM whatsapp_channels WHERE id = ?').get(id);
  if (!row) {
    db.prepare(`
      INSERT INTO whatsapp_channels (id, nome, numero, provider, auth_client_id, ativo, criado_em, atualizado_em)
      VALUES (?, ?, '', 'wweb', ?, 1, ?, ?)
    `).run(id, `WhatsApp ${empresaNome(empresaId)}`, `iac_${Number(empresaId)}`, now, now);
  }
  vincularEmpresa(id, empresaId, { padrao: 1, ativo: 1 });
  return buscarCanalDaEmpresa(id, empresaId);
}

function listarEmpresasDoCanal(channelId) {
  return getDB().prepare(`
    SELECT empresa_id, aliases, padrao, ativo, ocultar_selecao
    FROM whatsapp_channel_companies
    WHERE channel_id = ? AND ativo = 1
    ORDER BY padrao DESC, empresa_id ASC
  `).all(channelId).map(row => ({
    empresa_id: Number(row.empresa_id),
    nome: empresaNome(row.empresa_id),
    aliases: row.aliases || '',
    padrao: row.padrao ? 1 : 0,
    ocultar_selecao: row.ocultar_selecao ? 1 : 0,
  }));
}

function empresaProprietariaCanal(channel, empresas = []) {
  const referencias = [channel?.id, channel?.auth_client_id]
    .map(valor => String(valor || '').match(/^(?:emp|iac)_(\d+)$/i)?.[1])
    .map(Number)
    .filter(Number.isInteger);

  for (const empresaId of referencias) {
    const empresa = empresas.find(item => Number(item?.empresa_id) === empresaId);
    if (empresa) return empresa;
  }
  return null;
}

function senderAutorizadoEmpresa(empresaId, sender) {
  const numeros = variantesNumeroBrasil(sender);
  const lid = extrairLid(sender);
  if (!numeros.length) return false;
  const db = getDB();
  const total = db.prepare(
    'SELECT COUNT(*) AS total FROM whatsapp_allowed_numbers WHERE empresa_id = ? AND ativo = 1'
  ).get(Number(empresaId))?.total || 0;

  if (!total) return false;

  const placeholders = numeros.map(() => '?').join(',');
  return !!db.prepare(`
    SELECT id FROM whatsapp_allowed_numbers
    WHERE empresa_id = ? AND ativo = 1
      AND (numero IN (${placeholders}) OR wa_lid = ?)
    LIMIT 1
  `).get(Number(empresaId), ...numeros, lid);
}

function resolverEmpresaDoCanal({ channelId, sender, texto, sessaoEmpresaId = null, pending = null, usarPadrao = true, empresasDisponiveis = null }) {
  const empresasBase = Array.isArray(empresasDisponiveis) ? empresasDisponiveis : listarEmpresasDoCanal(channelId);
  const empresas = empresasBase.filter(e => senderAutorizadoEmpresa(e.empresa_id, sender));
  if (!empresas.length) return { status: 'unauthorized', empresas: [] };
  if (empresas.length === 1) return { status: 'resolved', empresaId: empresas[0].empresa_id, empresa: empresas[0], origem: 'unica' };

  // Seleção "todas" via sessão anterior
  if (sessaoEmpresaId === '__all__') return { status: 'all', empresas };

  const busca = normalizarBusca(texto);
  const textoTrim = String(texto || '').trim();

  // Seleção "todas" explícita (pending + palavra-chave ou "1")
  const isAllKeyword = ['ambas', 'todas', 'tudo', 'all', '1'].includes(textoTrim.toLowerCase());
  if (pending && isAllKeyword) return { status: 'all', empresas };

  const matches = empresas.filter(e => {
    const termos = [e.nome, ...(String(e.aliases || '').split(',').map(x => x.trim()))]
      .filter(t => t && normalizarBusca(t).length >= 2)
      .map(normalizarBusca);
    return termos.some(t => busca.includes(t));
  });
  if (matches.length === 1) return { status: 'resolved', empresaId: matches[0].empresa_id, empresa: matches[0], origem: 'texto' };

  if (pending && /^\d+$/.test(textoTrim)) {
    const n = Number(textoTrim);
    // 1 = todas (tratado acima), 2+ = empresa na posição n-2
    const chosen = empresas[n - 2];
    if (chosen) return { status: 'resolved', empresaId: chosen.empresa_id, empresa: chosen, origem: 'clarificacao' };
  }

  if (pending) {
    const pendingMatches = empresas.filter(e => normalizarBusca(e.nome).includes(busca) || busca.includes(normalizarBusca(e.nome)));
    if (pendingMatches.length === 1) {
      return { status: 'resolved', empresaId: pendingMatches[0].empresa_id, empresa: pendingMatches[0], origem: 'clarificacao' };
    }
  }

  if (sessaoEmpresaId && empresas.some(e => e.empresa_id === Number(sessaoEmpresaId))) {
    return {
      status: 'resolved',
      empresaId: Number(sessaoEmpresaId),
      empresa: empresas.find(e => e.empresa_id === Number(sessaoEmpresaId)),
      origem: 'sessao',
    };
  }

  const padroes = empresas.filter(e => e.padrao);
  if (usarPadrao && padroes.length === 1) return { status: 'resolved', empresaId: padroes[0].empresa_id, empresa: padroes[0], origem: 'padrao' };

  return { status: 'ambiguous', empresas };
}

function listarTodosCanais() {
  const db = getDB();
  return db.prepare('SELECT * FROM whatsapp_channels WHERE ativo = 1 ORDER BY nome').all();
}

function atualizarCanalWindowsService(channelId, { slug, porta, is_windows_service }) {
  const db  = getDB();
  const now = agora();
  db.prepare(`
    UPDATE whatsapp_channels
    SET service_slug       = ?,
        worker_port        = ?,
        is_windows_service = ?,
        atualizado_em      = ?
    WHERE id = ?
  `).run(slug ?? null, porta ?? null, is_windows_service ? 1 : 0, now, channelId);
}

module.exports = {
  criarCanal,
  atualizarCanal,
  desvincularEmpresa,
  desativarCanal,
  vincularEmpresa,
  buscarCanal,
  listarAtivosComSessao,
  listarPorEmpresa,
  listarOrfaosAtivos,
  buscarCanalDaEmpresa,
  buscarCanalAdmin,
  getDefaultForEmpresa,
  ensureDefaultForEmpresa,
  listarEmpresasDoCanal,
  empresaProprietariaCanal,
  senderAutorizadoEmpresa,
  resolverEmpresaDoCanal,
  normalizarNumero,
  variantesNumeroBrasil,
  extrairLid,
  listarTodosCanais,
  atualizarCanalWindowsService,
};
