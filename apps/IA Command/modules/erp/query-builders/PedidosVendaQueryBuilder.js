const QueryBuilder = require('./base/QueryBuilder');

// Protheus SC5 (Cabeçalho Pedido de Venda) + SC6 (Itens) + SA1 (Clientes)
class PedidosVendaQueryBuilder extends QueryBuilder {
  build(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const sc5 = `SC5${suf}`;
    const sc6 = `SC6${suf}`;
    const sa1 = `SA1${suf}`;
    const { filtros = {}, periodo, limite } = intent;

    const lim = parseInt(limite) || 100;

    const clienteFilter = filtros.cliente
      ? `AND (A1.A1_NOME LIKE ${this._p('%' + filtros.cliente + '%')} OR C5.C5_CLIENTE = ${this._p(filtros.cliente)})`
      : '';

    const filialFilter = filtros.filial
      ? `AND C5.C5_FILIAL = ${this._p(filtros.filial)}`
      : '';

    const vendedorFilter = filtros.vendedor
      ? `AND C5.C5_VEND1 = ${this._p(filtros.vendedor)}`
      : '';

    const dateFilter = periodo?.dataInicio && periodo?.dataFim
      ? `AND C5.C5_EMISSAO BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`
      : '';

    return `
SELECT TOP ${lim}
  C5.C5_FILIAL                                        AS filial,
  C5.C5_NUM                                           AS pedido,
  C5.C5_CLIENTE                                       AS cod_cliente,
  COALESCE(A1.A1_NOME, C5.C5_NOMECOM)                AS cliente,
  C5.C5_EMISSAO                                       AS emissao,
  C5.C5_VEND1                                         AS vendedor,
  C5.C5_LIBEROK                                       AS status_lib,
  SUM(C6.C6_PRCVEN * C6.C6_QTDVEN)                   AS valor_total,
  SUM(C6.C6_QTDVEN)                                   AS qtd_itens,
  SUM(C6.C6_QTDENT)                                   AS qtd_entregue,
  SUM(C6.C6_QTDVEN - C6.C6_QTDENT)                   AS qtd_pendente
FROM ${sc5} C5
INNER JOIN ${sc6} C6 ON C6.C6_NUM    = C5.C5_NUM
                     AND C6.C6_FILIAL = C5.C5_FILIAL
                     AND C6.D_E_L_E_T_ = ''
LEFT  JOIN ${sa1} A1 ON A1.A1_COD = C5.C5_CLIENTE AND A1.D_E_L_E_T_ = ''
WHERE C5.D_E_L_E_T_ = ''
  AND C5.C5_LIBEROK = 'L'
  AND (C6.C6_QTDVEN - C6.C6_QTDENT) > 0
  ${dateFilter}
  ${clienteFilter}
  ${vendedorFilter}
  ${filialFilter}
GROUP BY
  C5.C5_FILIAL, C5.C5_NUM, C5.C5_CLIENTE,
  A1.A1_NOME, C5.C5_NOMECOM,
  C5.C5_EMISSAO, C5.C5_VEND1, C5.C5_LIBEROK
ORDER BY C5.C5_EMISSAO DESC
    `.trim();
  }

  buildResumo(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const sc5 = `SC5${suf}`;
    const sc6 = `SC6${suf}`;
    const { filtros = {}, periodo } = intent;

    const dateFilter = periodo?.dataInicio && periodo?.dataFim
      ? `AND C5.C5_EMISSAO BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`
      : '';

    const filialFilter = filtros.filial
      ? `AND C5.C5_FILIAL = ${this._p(filtros.filial)}`
      : '';

    return `
SELECT
  COUNT(DISTINCT C5.C5_NUM)                          AS total_pedidos,
  SUM(C6.C6_PRCVEN * C6.C6_QTDVEN)                  AS valor_total,
  AVG(C6.C6_PRCVEN * C6.C6_QTDVEN)                  AS ticket_medio,
  COUNT(DISTINCT C5.C5_CLIENTE)                      AS total_clientes
FROM ${sc5} C5
INNER JOIN ${sc6} C6 ON C6.C6_NUM = C5.C5_NUM AND C6.C6_FILIAL = C5.C5_FILIAL AND C6.D_E_L_E_T_ = ''
WHERE C5.D_E_L_E_T_ = ''
  AND C5.C5_LIBEROK = 'L'
  AND (C6.C6_QTDVEN - C6.C6_QTDENT) > 0
  ${dateFilter}
  ${filialFilter}
    `.trim();
  }
}

module.exports = PedidosVendaQueryBuilder;
