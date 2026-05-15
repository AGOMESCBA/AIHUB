/**
 * ERP Registry — mapa central de ERPs suportados e seus QueryBuilders por módulo.
 *
 * Para adicionar um novo ERP:
 *  1. Crie a pasta  query-builders/erp/<nome>/index.js  exportando os builders.
 *  2. Adicione a entrada no objeto REGISTRY abaixo.
 *  3. Cadastre a conexão com o campo `erp` correspondente no banco.
 */

// ── Protheus (TOTVS) — implementado ──────────────────────────────────────────
const protheus = {
  faturamento:    require('./query-builders/FaturamentoQueryBuilder'),
  financeiro:     require('./query-builders/FinanceiroQueryBuilder'),
  clientes:       require('./query-builders/ClientesQueryBuilder'),
  produtos:       require('./query-builders/ProdutosQueryBuilder'),
  pedidos:        require('./query-builders/PedidosVendaQueryBuilder'),
  pedidos_compra: require('./query-builders/PedidosCompraQueryBuilder'),
  compras:        require('./query-builders/ComprasQueryBuilder'),
};

// ── Outros ERPs — stubs preparados para implementação futura ─────────────────
const sankhya = require('./query-builders/erp/sankhya');
const sap     = require('./query-builders/erp/sap');
const senior  = require('./query-builders/erp/senior');
const mxm     = require('./query-builders/erp/mxm');

// ── Catálogo ──────────────────────────────────────────────────────────────────
const REGISTRY = {
  protheus: {
    label:         'TOTVS Protheus',
    dbTipoPadrao:  'sqlserver',
    implementado:  true,
    builders:      protheus,
  },
  sankhya: {
    label:         'Sankhya',
    dbTipoPadrao:  'sqlserver',
    implementado:  false,
    builders:      sankhya,
  },
  sap: {
    label:         'SAP Business One',
    dbTipoPadrao:  'sqlserver',
    implementado:  false,
    builders:      sap,
  },
  senior: {
    label:         'Senior Sistemas',
    dbTipoPadrao:  'sqlserver',
    implementado:  false,
    builders:      senior,
  },
  mxm: {
    label:         'MXM Sistemas',
    dbTipoPadrao:  'sqlserver',
    implementado:  false,
    builders:      mxm,
  },
};

/**
 * Retorna a classe QueryBuilder para o ERP e módulo informados.
 * Lança erro descritivo se o ERP não existir ou o módulo não estiver implementado.
 */
function getBuilder(erp, modulo) {
  const key   = (erp || 'protheus').toLowerCase();
  const entry = REGISTRY[key];
  if (!entry) {
    throw new Error(
      `ERP não suportado: "${erp}". Opções disponíveis: ${Object.keys(REGISTRY).join(', ')}`
    );
  }
  const BuilderClass = entry.builders[modulo];
  if (!BuilderClass) {
    throw new Error(
      `Módulo "${modulo}" não implementado para ERP "${key}". ` +
      `Implemente em query-builders/erp/${key}/index.js`
    );
  }
  return BuilderClass;
}

/** Retorna metadata do ERP (label, dbTipoPadrao, implementado). */
function getErpInfo(erp) {
  return REGISTRY[(erp || 'protheus').toLowerCase()] || null;
}

/** Lista todos os ERPs cadastrados — usado pelo frontend para montar dropdowns. */
function listarErps() {
  return Object.entries(REGISTRY).map(([id, e]) => ({
    id,
    label:        e.label,
    dbTipoPadrao: e.dbTipoPadrao,
    implementado: e.implementado,
  }));
}

module.exports = { getBuilder, getErpInfo, listarErps, REGISTRY };
