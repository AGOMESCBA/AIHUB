const QueryBuilder = require('./base/QueryBuilder');

// Protheus SC7 (Solicitação de Compra) + SA2 (Fornecedores)
// Representa pedidos de compra pendentes / em andamento
class PedidosCompraQueryBuilder extends QueryBuilder {
  build(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const sc7 = `SC7${suf}`;
    const sa2 = `SA2${suf}`;
    const { filtros = {}, periodo, limite } = intent;

    const lim = parseInt(limite) || 100;

    const fornecedorFilter = filtros.fornecedor
      ? `AND (A2.A2_NOME LIKE ${this._p('%' + filtros.fornecedor + '%')} OR C7.C7_FORNECE = ${this._p(filtros.fornecedor)})`
      : '';

    const filialFilter = filtros.filial
      ? `AND C7.C7_FILIAL = ${this._p(filtros.filial)}`
      : '';

    const produtoFilter = filtros.produto
      ? `AND (C7.C7_DESCRI LIKE ${this._p('%' + filtros.produto + '%')} OR C7.C7_PRODUTO = ${this._p(filtros.produto)})`
      : '';

    const dateFilter = periodo?.dataInicio && periodo?.dataFim
      ? `AND C7.C7_DATPRF BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`
      : '';

    // Apenas pedidos não atendidos (C7_QUJE < C7_QUANT)
    return `
SELECT TOP ${lim}
  C7.C7_FILIAL                                        AS filial,
  C7.C7_NUM                                           AS solicitacao,
  C7.C7_ITEM                                          AS item,
  C7.C7_PRODUTO                                       AS cod_produto,
  C7.C7_DESCRI                                        AS produto,
  C7.C7_QUANT                                         AS qtd_solicitada,
  C7.C7_QUJE                                          AS qtd_atendida,
  C7.C7_QUANT - C7.C7_QUJE                            AS qtd_pendente,
  C7.C7_PRECO                                         AS preco_unitario,
  (C7.C7_QUANT - C7.C7_QUJE) * C7.C7_PRECO           AS valor_pendente,
  C7.C7_DATPRF                                        AS previsao,
  C7.C7_FORNECE                                       AS cod_fornecedor,
  COALESCE(A2.A2_NOME, C7.C7_FORNECE)                AS fornecedor,
  C7.C7_USER                                          AS solicitante
FROM ${sc7} C7
LEFT JOIN ${sa2} A2 ON A2.A2_COD = C7.C7_FORNECE AND A2.D_E_L_E_T_ = ''
WHERE C7.D_E_L_E_T_ = ''
  AND C7.C7_QUANT > C7.C7_QUJE
  AND C7.C7_CONAPRO <> 'R'
  ${dateFilter}
  ${fornecedorFilter}
  ${produtoFilter}
  ${filialFilter}
ORDER BY C7.C7_DATPRF ASC
    `.trim();
  }

  buildResumo(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const sc7 = `SC7${suf}`;
    const { filtros = {}, periodo } = intent;

    const dateFilter = periodo?.dataInicio && periodo?.dataFim
      ? `AND C7.C7_DATPRF BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`
      : '';

    const filialFilter = filtros.filial
      ? `AND C7.C7_FILIAL = ${this._p(filtros.filial)}`
      : '';

    return `
SELECT
  COUNT(DISTINCT C7.C7_NUM)                                 AS total_solicitacoes,
  COUNT(*)                                                  AS total_itens,
  SUM((C7.C7_QUANT - C7.C7_QUJE) * C7.C7_PRECO)           AS valor_total_pendente,
  COUNT(DISTINCT C7.C7_FORNECE)                             AS total_fornecedores
FROM ${sc7} C7
WHERE C7.D_E_L_E_T_ = ''
  AND C7.C7_QUANT > C7.C7_QUJE
  AND C7.C7_CONAPRO <> 'R'
  ${dateFilter}
  ${filialFilter}
    `.trim();
  }
}

module.exports = PedidosCompraQueryBuilder;
