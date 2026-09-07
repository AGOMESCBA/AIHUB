'use strict';

const { getDB } = require('../database');
const channelStore = require('./channel-store');

function empresaNome(empresaId) {
  try {
    const empresasDb = require('../../../../modules/empresas/database');
    const empresa = empresasDb.buscarPorId(Number(empresaId));
    return empresa?.razao_social || empresa?.nome || `Empresa #${empresaId}`;
  } catch (_) {
    return `Empresa #${empresaId}`;
  }
}

const LEGACY_MODULES = [
  ['financeiro', 'Financeiro', 'modulo_financeiro'],
  ['compras', 'Compras', 'modulo_compras'],
  ['faturamento', 'Faturamento', 'modulo_faturamento'],
  ['comissao', 'Comissao', 'modulo_comissao'],
  ['estoque', 'Estoque', 'modulo_estoque'],
];

function labelSistema(erp) {
  const v = String(erp || '').toLowerCase();
  if (v === 'protheus') return 'Protheus';
  if (v === 'softexpert') return 'SoftExpert';
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Sistema';
}

function labelModulo(modulo) {
  const found = LEGACY_MODULES.find(([id]) => id === String(modulo || '').toLowerCase());
  if (found) return found[1];
  return String(modulo || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function empresasDoCanal(channelId) {
  if (!channelId) return new Map();
  try {
    return new Map(channelStore.listarEmpresasDoCanal(channelId).map(e => [Number(e.empresa_id), e]));
  } catch (_) {
    return new Map();
  }
}

function buscarAcessosNumero(sender, { channelId = null } = {}) {
  const variantes = channelStore.variantesNumeroBrasil(sender);
  const lid = channelStore.extrairLid(sender);
  if (!variantes.length && !lid) return [];

  const db = getDB();
  const params = [];
  const conds = [];
  if (variantes.length) {
    conds.push(`w.numero IN (${variantes.map(() => '?').join(',')})`);
    params.push(...variantes);
  }
  if (lid) {
    conds.push('w.wa_lid = ?');
    params.push(lid);
  }

  const empresasCanal = empresasDoCanal(channelId);
  const filtroCanal = empresasCanal.size
    ? ` AND w.empresa_id IN (${[...empresasCanal.keys()].map(() => '?').join(',')})`
    : '';
  const rows = db.prepare(`
    SELECT w.*
      FROM whatsapp_allowed_numbers w
     WHERE w.ativo = 1
       AND (${conds.join(' OR ')})
       ${filtroCanal}
     ORDER BY w.empresa_id ASC, w.nome COLLATE NOCASE ASC
  `).all(...params, ...[...empresasCanal.keys()]);

  const modStmt = db.prepare(`
    SELECT erp, modulo, papel, codigo_identidade
      FROM whatsapp_numero_modulos
     WHERE numero_id = ? AND empresa_id = ? AND liberado = 1
     ORDER BY erp, modulo
  `);

  return rows.map(row => {
    const dinamicos = modStmt.all(row.id, row.empresa_id);
    const porSistema = new Map();
    const add = (erp, modulo) => {
      const sistema = labelSistema(erp);
      if (!porSistema.has(sistema)) porSistema.set(sistema, new Map());
      porSistema.get(sistema).set(String(modulo).toLowerCase(), labelModulo(modulo));
    };
    for (const item of dinamicos) add(item.erp || 'protheus', item.modulo);
    for (const [id, label, col] of LEGACY_MODULES) {
      if (row[col]) add('protheus', id, label);
    }
    return {
      empresaId: Number(row.empresa_id),
      empresaNome: empresasCanal.get(Number(row.empresa_id))?.nome || empresaNome(row.empresa_id),
      nome: row.nome,
      sistemas: [...porSistema.entries()].map(([sistema, modulos]) => ({
        sistema,
        modulos: [...modulos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      })),
    };
  });
}

function formatarAcessos(acessos = []) {
  if (!acessos.length) {
    return 'Nao encontrei modulos liberados para o seu numero neste canal. Peca ao gestor para revisar seu acesso no IA Command.';
  }

  const linhas = ['Voce tem acesso a:'];
  for (const acesso of acessos) {
    linhas.push('', `*${acesso.empresaNome}*`);
    if (!acesso.sistemas.length) {
      linhas.push('- Numero autorizado, mas sem modulos liberados.');
      continue;
    }
    for (const sistema of acesso.sistemas) {
      linhas.push(`- ${sistema.sistema}: ${sistema.modulos.join(', ')}`);
    }
  }
  return linhas.join('\n');
}

function responder(sender, opts = {}) {
  const acessos = buscarAcessosNumero(sender, opts);
  return { acessos, resposta: formatarAcessos(acessos) };
}

module.exports = {
  responder,
  buscarAcessosNumero,
  formatarAcessos,
  labelSistema,
  labelModulo,
};
