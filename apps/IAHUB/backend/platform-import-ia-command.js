const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('./platform-schema');

const PLATFORM_DB = path.join(__dirname, '..', 'data', 'iahub-platform.db');
const IAC_DB = path.join(__dirname, '..', '..', 'IA Command', 'data', 'ia-command.db');

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function normalizePhone(value) { return String(value || '').replace(/\D/g, ''); }
function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function roleDefaults(row, modulo) {
  const papel = row.papel || row.erp_tipo || (row.erp === 'softexpert' ? 'gestor' : 'usuario');
  const codigo =
    row.codigo_identidade ||
    (papel === 'aprovador' ? row.cod_aprov_erp : null) ||
    (papel === 'cliente' ? row.cod_cliente_erp : null) ||
    row.erp_id ||
    null;
  return { papel, codigo: codigo || null, modulo };
}

function upsertRole(platformDb, identityId, empresaId, role) {
  const stamp = now();
  const existing = role.origemId
    ? platformDb.prepare(`
        SELECT id FROM platform_identity_roles
         WHERE empresa_id = ? AND origem_sistema = 'ia-command' AND origem_id = ?
      `).get(empresaId, role.origemId)
    : platformDb.prepare(`
        SELECT id FROM platform_identity_roles
         WHERE empresa_id = ? AND identity_id = ? AND sistema = ? AND modulo = ?
           AND COALESCE(papel, '') = COALESCE(?, '') AND COALESCE(codigo_identidade, '') = COALESCE(?, '')
      `).get(empresaId, identityId, role.sistema, role.modulo, role.papel || null, role.codigoIdentidade || null);

  if (existing) {
    platformDb.prepare(`
      UPDATE platform_identity_roles
         SET sistema = ?, modulo = ?, papel = ?, codigo_identidade = ?, liberado = ?,
             metadata_json = ?, origem_sistema = 'ia-command', origem_id = ?, importado_em = ?, atualizado_em = ?
       WHERE id = ?
    `).run(role.sistema, role.modulo, role.papel || null, role.codigoIdentidade || null, role.liberado === false ? 0 : 1,
      JSON.stringify(role.metadata || {}), role.origemId || existing.id, stamp, stamp, existing.id);
    return 'updated';
  }

  platformDb.prepare(`
    INSERT INTO platform_identity_roles (
      id, identity_id, empresa_id, sistema, modulo, papel, codigo_identidade, liberado,
      metadata_json, origem_sistema, origem_id, importado_em, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ia-command', ?, ?, ?, ?)
  `).run(uuid(), identityId, empresaId, role.sistema, role.modulo, role.papel || null, role.codigoIdentidade || null,
    role.liberado === false ? 0 : 1, JSON.stringify(role.metadata || {}), role.origemId || null, stamp, stamp, stamp);
  return 'created';
}

function importarNumerosJ2A() {
  const empresaId = 1;
  const platformDb = new Database(PLATFORM_DB);
  const iacDb = new Database(IAC_DB, { readonly: true });
  platformDb.pragma('journal_mode = WAL');
  platformDb.pragma('foreign_keys = ON');
  ensurePlatformSchema(platformDb);

  const runId = uuid();
  const inicio = now();
  const resumo = { empresaId, identidadesCriadas: 0, identidadesAtualizadas: 0, rolesCriadas: 0, rolesAtualizadas: 0 };

  const tx = platformDb.transaction(() => {
    platformDb.prepare(`
      INSERT INTO platform_import_runs (id, origem_sistema, empresa_id, tipo, status, resumo_json, iniciado_em)
      VALUES (?, 'ia-command', ?, 'ia-command-j2a-whatsapp', 'running', '{}', ?)
    `).run(runId, empresaId, inicio);

    const numeros = iacDb.prepare('SELECT * FROM whatsapp_allowed_numbers WHERE empresa_id = ? ORDER BY nome').all(empresaId);
    const modulos = iacDb.prepare('SELECT * FROM whatsapp_numero_modulos WHERE empresa_id = ? AND liberado != 0').all(empresaId);
    const porNumero = new Map();
    modulos.forEach(m => {
      if (!porNumero.has(m.numero_id)) porNumero.set(m.numero_id, []);
      porNumero.get(m.numero_id).push(m);
    });

    for (const n of numeros) {
      const numeroNormalizado = normalizePhone(n.numero);
      if (!numeroNormalizado) continue;
      const stamp = now();
      const metadata = {
        ...parseJson(n.metadata_json, {}),
        erp_tipo: n.erp_tipo || null,
        erp_id: n.erp_id || null,
        cod_aprov_erp: n.cod_aprov_erp || null,
        cod_cliente_erp: n.cod_cliente_erp || null,
      };
      const existing = platformDb.prepare(`
        SELECT * FROM platform_whatsapp_identities
         WHERE empresa_id = ? AND (origem_sistema = 'ia-command' AND origem_id = ? OR numero_normalizado = ?)
      `).get(empresaId, n.id, numeroNormalizado);
      const identityId = existing?.id || uuid();

      if (existing) {
        platformDb.prepare(`
          UPDATE platform_whatsapp_identities
             SET nome = ?, numero = ?, numero_normalizado = ?, wa_lid = ?, observacoes = ?, ativo = ?,
                 origem_sistema = 'ia-command', origem_id = ?, metadata_json = ?, importado_em = ?, atualizado_em = ?
           WHERE id = ?
        `).run(n.nome || numeroNormalizado, n.numero || numeroNormalizado, numeroNormalizado, n.wa_lid || null,
          n.observacoes || '', Number(n.ativo) === 0 ? 0 : 1, n.id, JSON.stringify(metadata), stamp, stamp, identityId);
        resumo.identidadesAtualizadas += 1;
      } else {
        platformDb.prepare(`
          INSERT INTO platform_whatsapp_identities (
            id, empresa_id, nome, numero, numero_normalizado, wa_lid, observacoes, ativo,
            origem_sistema, origem_id, metadata_json, importado_em, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ia-command', ?, ?, ?, ?, ?)
        `).run(identityId, empresaId, n.nome || numeroNormalizado, n.numero || numeroNormalizado, numeroNormalizado,
          n.wa_lid || null, n.observacoes || '', Number(n.ativo) === 0 ? 0 : 1, n.id, JSON.stringify(metadata), stamp, stamp, stamp);
        resumo.identidadesCriadas += 1;
      }

      const roles = [];
      for (const m of porNumero.get(n.id) || []) {
        const defaults = roleDefaults({ ...m, ...n }, m.modulo);
        roles.push({
          sistema: m.erp || 'protheus',
          modulo: defaults.modulo,
          papel: defaults.papel,
          codigoIdentidade: defaults.codigo,
          liberado: true,
          origemId: m.id,
          metadata: { origem_tabela: 'whatsapp_numero_modulos' },
        });
      }
      if (n.cod_aprov_erp) roles.push({ sistema: 'protheus', modulo: 'compras', papel: 'aprovador', codigoIdentidade: n.cod_aprov_erp, liberado: true, origemId: `${n.id}:cod_aprov_erp`, metadata: { origem_coluna: 'cod_aprov_erp', legado: true } });
      if (n.cod_cliente_erp) roles.push({ sistema: 'protheus', modulo: 'financeiro', papel: 'cliente', codigoIdentidade: n.cod_cliente_erp, liberado: true, origemId: `${n.id}:cod_cliente_erp`, metadata: { origem_coluna: 'cod_cliente_erp', legado: true } });

      for (const role of roles) {
        const op = upsertRole(platformDb, identityId, empresaId, role);
        if (op === 'created') resumo.rolesCriadas += 1;
        else resumo.rolesAtualizadas += 1;
      }
    }

    platformDb.prepare(`
      UPDATE platform_import_runs SET status = 'ok', resumo_json = ?, finalizado_em = ? WHERE id = ?
    `).run(JSON.stringify(resumo), now(), runId);
  });

  try {
    tx();
    return { ok: true, runId, resumo };
  } catch (err) {
    platformDb.prepare(`
      INSERT OR REPLACE INTO platform_import_runs (id, origem_sistema, empresa_id, tipo, status, resumo_json, erro, iniciado_em, finalizado_em)
      VALUES (?, 'ia-command', ?, 'ia-command-j2a-whatsapp', 'erro', ?, ?, ?, ?)
    `).run(runId, empresaId, JSON.stringify(resumo), err.message, inicio, now());
    throw err;
  } finally {
    iacDb.close();
    platformDb.close();
  }
}

module.exports = { importarNumerosJ2A };
