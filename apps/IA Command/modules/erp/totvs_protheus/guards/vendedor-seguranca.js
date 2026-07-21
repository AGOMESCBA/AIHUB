'use strict';

// Resolucao de identidade de vendedor/gestor compartilhada entre os modulos que
// restringem acesso por remetente (comissao, faturamento, financeiro). Extraido de
// comissao-ia-owner-spec.js para evitar duplicar a mesma query/normalizacao em cada spec.

// Retorna o registro completo do número na empresa, ou null se não cadastrado/inativo.
// Três estados possíveis:
//   null                          → não cadastrado nesta empresa → bloquear
//   { erp_tipo: 'gestor', ... }  → acesso total, sem filtro de vendedor
//   { erp_tipo: 'vendedor', erp_id: 'XXXXXX', ... } → acesso restrito ao próprio código
function resolverIdentidadeVendedor(remetente, empresaId) {
  try {
    const { getDB } = require('../../../database');
    const channelStore = require('../../../whatsapp/channel-store');
    const db = getDB();

    const variantes = channelStore.variantesNumeroBrasil(remetente);
    const lid = channelStore.extrairLid(remetente);
    const placeholders = variantes.map(() => '?').join(',');

    const row = db.prepare(
      `SELECT nome, erp_tipo, erp_id FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1`
    ).get(empresaId, ...variantes, lid);

    if (!row) return null;
    return {
      nome:     row.nome,
      erp_tipo: String(row.erp_tipo || '').trim().toLowerCase(),
      erp_id:   String(row.erp_id  || '').trim().toUpperCase(),
    };
  } catch (e) {
    console.warn('[VendedorSeguranca] Falha ao resolver identidade do vendedor:', e.message);
    return null;
  }
}

// Resolve o vendedorFixo de segurança para uma empresa específica dado o remetente.
// Retorna um dos estados de segurança:
//   { estado: 'nao_cadastrado' }                        → bloquear execução
//   { estado: 'gestor' }                                → executar sem filtro
//   { estado: 'vendedor', codigo, nome }                → executar com filtro do código
//   { estado: 'vendedor_sem_codigo' }                   → bloquear — config incompleta
//   { estado: 'sem_restricao' }                         → erp_tipo vazio/desconhecido
//   { estado: 'sem_remetente' }                         → sem remetente para resolver
function resolverVendedorFixoPorEmpresa(remetente, empresaId) {
  if (!remetente) return { estado: 'sem_remetente' };
  const identidade = resolverIdentidadeVendedor(remetente, empresaId);
  if (!identidade) return { estado: 'nao_cadastrado' };
  if (identidade.erp_tipo === 'gestor') return { estado: 'gestor', nome: identidade.nome };
  if (identidade.erp_tipo === 'vendedor' && identidade.erp_id) {
    return { estado: 'vendedor', codigo: identidade.erp_id, nome: identidade.nome };
  }
  if (identidade.erp_tipo === 'vendedor' && !identidade.erp_id) {
    return { estado: 'vendedor_sem_codigo', nome: identidade.nome };
  }
  // erp_tipo vazio ou desconhecido: sem restrição (número cadastrado mas sem perfil ERP)
  return { estado: 'sem_restricao' };
}

module.exports = {
  resolverIdentidadeVendedor,
  resolverVendedorFixoPorEmpresa,
};
