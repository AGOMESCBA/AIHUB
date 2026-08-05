'use strict';

// Resolucao de identidade de cliente a partir do numero de WhatsApp. Espelha
// aprovador-seguranca.js: usa o campo independente cod_cliente_erp — nao depende de
// erp_tipo/erp_id, entao o mesmo numero pode ser vendedor (comissao/faturamento) E
// cliente (faturamento/financeiro) simultaneamente, com codigos diferentes.
//
// Diferente de aprovador (filtro condicional a intencao da pergunta), o filtro de
// cliente e sempre obrigatorio quando presente — mesmo nivel de rigor do vendedorFixo,
// por tratar de dado financeiro sensivel de terceiros (titulos a receber de outro cliente).

// Retorna um dos estados:
//   { estado: 'nao_cadastrado' }                → numero nao cadastrado/inativo nesta empresa
//   { estado: 'sem_codigo' }                     → cadastrado mas sem cod_cliente_erp preenchido
//   { estado: 'cliente', codigo, nome }          → acesso restrito ao proprio codigo de cliente
//   { estado: 'sem_remetente' }                  → sem remetente para resolver
//   { estado: 'erro' }                            → falha ao consultar o banco
function resolverClienteFixoPorEmpresa(remetente, empresaId) {
  if (!remetente) return { estado: 'sem_remetente' };
  try {
    const { getDB } = require('../../../database');
    const channelStore = require('../../../whatsapp/channel-store');
    const db = getDB();

    const variantes = channelStore.variantesNumeroBrasil(remetente);
    const lid = channelStore.extrairLid(remetente);
    const placeholders = variantes.map(() => '?').join(',');

    const row = db.prepare(
      `SELECT nome, cod_cliente_erp FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1`
    ).get(empresaId, ...variantes, lid);

    if (!row) return { estado: 'nao_cadastrado' };
    const codigo = String(row.cod_cliente_erp || '').trim().toUpperCase();
    if (!codigo) return { estado: 'sem_codigo' };
    return { estado: 'cliente', codigo, nome: row.nome };
  } catch (e) {
    console.warn('[ClienteSeguranca] Falha ao resolver identidade do cliente:', e.message);
    return { estado: 'erro' };
  }
}

module.exports = {
  resolverClienteFixoPorEmpresa,
};
