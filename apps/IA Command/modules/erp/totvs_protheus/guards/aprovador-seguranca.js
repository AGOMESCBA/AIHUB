'use strict';

// Resolucao de identidade de aprovador de pedido de compra a partir do numero de WhatsApp.
// Espelha vendedor-seguranca.js, mas usa o campo independente cod_aprov_erp — o mesmo
// numero pode ser vendedor (comissao) E aprovador (compras) simultaneamente, com codigos
// diferentes, porque cod_aprov_erp nao depende de erp_tipo/erp_id.

// Retorna { codigo } se o numero tiver cod_aprov_erp cadastrado para a empresa, ou null
// se nao cadastrado/inativo/sem codigo — nesse caso o modulo de compras nao aplica filtro
// de aprovador (comportamento deve ser decidido pelo spec chamador).
function resolverAprovadorFixoPorEmpresa(remetente, empresaId) {
  if (!remetente) return { estado: 'sem_remetente' };
  try {
    const { getDB } = require('../../../database');
    const channelStore = require('../../../whatsapp/channel-store');
    const db = getDB();

    const variantes = channelStore.variantesNumeroBrasil(remetente);
    const lid = channelStore.extrairLid(remetente);
    const placeholders = variantes.map(() => '?').join(',');

    const row = db.prepare(
      `SELECT nome, cod_aprov_erp FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1`
    ).get(empresaId, ...variantes, lid);

    if (!row) return { estado: 'nao_cadastrado' };
    const codigo = String(row.cod_aprov_erp || '').trim().toUpperCase();
    if (!codigo) return { estado: 'sem_codigo' };
    return { estado: 'aprovador', codigo, nome: row.nome };
  } catch (e) {
    console.warn('[AprovadorSeguranca] Falha ao resolver identidade do aprovador:', e.message);
    return { estado: 'erro' };
  }
}

module.exports = {
  resolverAprovadorFixoPorEmpresa,
};
