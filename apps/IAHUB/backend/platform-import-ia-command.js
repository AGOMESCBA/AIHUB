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
  const erp = String(row.erp || 'protheus').toLowerCase();
  const papel = row.papel || row.erp_tipo || (erp === 'softexpert' ? 'gestor' : 'usuario');
  // erp_id/cod_aprov_erp/cod_cliente_erp são códigos PROTHEUS do número —
  // nunca servem de identidade para módulos de outro ERP (ex.: SoftExpert,
  // cuja identidade é só o codigo_identidade do próprio módulo).
  const codigo =
    row.codigo_identidade ||
    (erp === 'protheus' && papel === 'aprovador' ? row.cod_aprov_erp : null) ||
    (erp === 'protheus' && papel === 'cliente' ? row.cod_cliente_erp : null) ||
    (erp === 'protheus' ? row.erp_id : null) ||
    null;
  return { papel, codigo: codigo || null, modulo };
}

function mesmoValor(a, b) { return String(a ?? '') === String(b ?? ''); }

// A importação COMPLEMENTA o cadastro do IAHub, nunca o destrói. Acha o role
// pela origem (origem_id) ou, se ele foi recriado pela tela sem origem, pela
// combinação sistema/módulo/papel — e o "adota" em vez de criar duplicata (era
// o ciclo importar → salvar → importar que multiplicava as linhas).
// Os acessos por empresa são somente consulta na tela do IAHub (espelho do IA
// Command), então papel/código/liberado sempre refletem o IA Command.
function upsertRole(platformDb, identityId, empresaId, role) {
  const stamp = now();
  let existing = role.origemId
    ? platformDb.prepare(`
        SELECT * FROM platform_identity_roles
         WHERE empresa_id = ? AND origem_sistema = 'ia-command' AND origem_id = ?
      `).get(empresaId, role.origemId)
    : null;
  if (!existing) {
    // Linha sem origem (criada/regravada pela tela): primeiro a idêntica; senão
    // a do mesmo sistema/módulo/papel (o código pode divergir do IA Command).
    existing = platformDb.prepare(`
      SELECT * FROM platform_identity_roles
       WHERE empresa_id = ? AND identity_id = ? AND lower(sistema) = lower(?) AND lower(modulo) = lower(?)
         AND COALESCE(papel, '') = COALESCE(?, '') AND origem_id IS NULL
       ORDER BY CASE WHEN COALESCE(codigo_identidade, '') = COALESCE(?, '') THEN 0 ELSE 1 END, criado_em ASC
       LIMIT 1
    `).get(empresaId, identityId, role.sistema, role.modulo, role.papel || null, role.codigoIdentidade || null);
  }

  if (existing) {
    const adotado = !existing.origem_id;
    const papel = role.papel || null;
    const codigo = role.codigoIdentidade || null;
    const liberado = role.liberado === false ? 0 : 1;
    const metadata = { ...parseJson(existing.metadata_json, {}), ...(role.metadata || {}) };
    const mudou = adotado || !mesmoValor(existing.papel, papel) || !mesmoValor(existing.codigo_identidade, codigo)
      || Number(existing.liberado) !== liberado || existing.metadata_json !== JSON.stringify(metadata);
    platformDb.prepare(`
      UPDATE platform_identity_roles
         SET papel = ?, codigo_identidade = ?, liberado = ?, metadata_json = ?,
             origem_sistema = 'ia-command', origem_id = ?, importado_em = ?, atualizado_em = ?
       WHERE id = ?
    `).run(papel, codigo, liberado, JSON.stringify(metadata), role.origemId || existing.origem_id || existing.id,
      stamp, stamp, existing.id);
    if (adotado) return 'adopted';
    return mudou ? 'updated' : 'unchanged';
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
  const resumo = {
    empresaId,
    identidadesCriadas: 0, identidadesAtualizadas: 0, identidadesPreservadas: 0,
    rolesCriadas: 0, rolesAtualizadas: 0, rolesReaproveitadas: 0, rolesSemAlteracao: 0,
  };

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
      const metadataIaCommand = {
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
        // Metadados MESCLADOS: os campos do IA Command são atualizados, mas o que
        // só existe no IAHub (bloco iaService — ID SoftExpert, usuário IAHub,
        // pré-análise — e o "tipo") nunca é apagado. Antes o metadata_json era
        // substituído inteiro e o login do IA Service perdia o ID SoftExpert.
        const metadataAtual = parseJson(existing.metadata_json, {});
        const metadata = { ...metadataAtual, ...metadataIaCommand };
        if (metadataAtual.iaService !== undefined) metadata.iaService = metadataAtual.iaService;
        if (metadataAtual.tipo !== undefined) metadata.tipo = metadataAtual.tipo;
        // Cadastro nunca importado ou editado na tela depois da última
        // importação: nome/observações/status ficam como estão no IAHub.
        const editadoManualmente = !existing.importado_em || String(existing.atualizado_em || '') > String(existing.importado_em);
        platformDb.prepare(`
          UPDATE platform_whatsapp_identities
             SET nome = ?, numero = ?, numero_normalizado = ?, wa_lid = ?, observacoes = ?, ativo = ?,
                 origem_sistema = 'ia-command', origem_id = ?, metadata_json = ?, importado_em = ?, atualizado_em = ?
           WHERE id = ?
        `).run(
          editadoManualmente ? existing.nome : (n.nome || numeroNormalizado),
          n.numero || numeroNormalizado, numeroNormalizado, n.wa_lid || existing.wa_lid || null,
          editadoManualmente ? (existing.observacoes || '') : (n.observacoes || ''),
          editadoManualmente ? (Number(existing.ativo) === 0 ? 0 : 1) : (Number(n.ativo) === 0 ? 0 : 1),
          n.id, JSON.stringify(metadata),
          editadoManualmente ? existing.importado_em : stamp,
          editadoManualmente ? existing.atualizado_em : stamp,
          identityId);
        resumo.identidadesAtualizadas += 1;
        if (editadoManualmente) resumo.identidadesPreservadas += 1;
      } else {
        const metadata = metadataIaCommand;
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
      const modulosDoNumero = porNumero.get(n.id) || [];
      for (const m of modulosDoNumero) {
        const defaults = roleDefaults({ ...m, ...n }, m.modulo);
        roles.push({
          sistema: m.erp || 'protheus',
          modulo: defaults.modulo,
          papel: defaults.papel,
          codigoIdentidade: defaults.codigo,
          liberado: Number(m.liberado) !== 0,
          origemId: m.id,
          metadata: { origem_tabela: 'whatsapp_numero_modulos' },
        });
      }
      if (n.cod_aprov_erp) roles.push({ sistema: 'protheus', modulo: 'compras', papel: 'aprovador', codigoIdentidade: n.cod_aprov_erp, liberado: true, origemId: `${n.id}:cod_aprov_erp`, metadata: { origem_coluna: 'cod_aprov_erp', legado: true } });
      if (n.cod_cliente_erp) roles.push({ sistema: 'protheus', modulo: 'financeiro', papel: 'cliente', codigoIdentidade: n.cod_cliente_erp, liberado: true, origemId: `${n.id}:cod_cliente_erp`, metadata: { origem_coluna: 'cod_cliente_erp', legado: true } });

      // Autorização PRÓPRIA do IA Service ('ia-service/chat-web'), nunca
      // emprestada de outro sistema — mas a importação já cria esse vínculo
      // automaticamente quando o número tem acesso liberado ao módulo
      // SoftExpert de chamados no IA Command (sinal de que é de fato um
      // consultor de sustentação), evitando configuração manual por
      // consultor na maioria dos casos. Segue liberado/desliberado igual ao
      // módulo de origem — se o SoftExpert for desativado no IA Command, a
      // reimportação reflete isso aqui também (não é "importar uma vez e
      // nunca mais sincronizar").
      //
      // O ID SoftExpert vem SÓ do codigo_identidade do módulo SoftExpert — o
      // erp_id do número é código Protheus (ex.: '000007') e, quando tinha
      // prioridade, o consultor logava com um ID inexistente no SoftExpert
      // (fila vazia no Radar). Se o IAHub já tem um vínculo chat-web
      // configurado na tela (aba IA Service), ele é a fonte de verdade e a
      // importação não cria um segundo.
      const moduloSoftexpert = modulosDoNumero.find(m => String(m.erp || '').toLowerCase() === 'softexpert' && String(m.modulo || '').toLowerCase() === 'chamados');
      const chatWebManual = platformDb.prepare(`
        SELECT 1 FROM platform_identity_roles
         WHERE empresa_id = ? AND identity_id = ? AND lower(sistema) = 'ia-service' AND lower(modulo) = 'chat-web'
           AND COALESCE(origem_id, '') <> ?
         LIMIT 1
      `).get(empresaId, identityId, `${n.id}:ia-service-auto`);
      if (moduloSoftexpert && !chatWebManual) {
        const idSoftexpert = moduloSoftexpert.codigo_identidade || null;
        if (idSoftexpert) {
          roles.push({
            sistema: 'ia-service',
            modulo: 'chat-web',
            papel: moduloSoftexpert.papel || 'analista',
            codigoIdentidade: idSoftexpert,
            liberado: Number(moduloSoftexpert.liberado) !== 0,
            origemId: `${n.id}:ia-service-auto`,
            metadata: { origem: 'auto-softexpert-chamados', idSoftexpert },
          });
        }
      }

      for (const role of roles) {
        const op = upsertRole(platformDb, identityId, empresaId, role);
        if (op === 'created') resumo.rolesCriadas += 1;
        else if (op === 'adopted') resumo.rolesReaproveitadas += 1;
        else if (op === 'updated') resumo.rolesAtualizadas += 1;
        else resumo.rolesSemAlteracao += 1;
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
