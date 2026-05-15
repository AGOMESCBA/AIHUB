const QueryBuilder = require('./base/QueryBuilder');

// Protheus SD2 (Itens NF) + SB1 (Cadastro de Produtos)
class ProdutosQueryBuilder extends QueryBuilder {
  build(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const sd2 = `SD2${suf}`;
    const sb1 = `SB1${suf}`;
    const sf2 = `SF2${suf}`;
    const { filtros = {}, periodo, limite } = intent;

    const lim = parseInt(limite) || 20;

    const dateFilter = periodo?.dataInicio && periodo?.dataFim
      ? `AND F2.F2_EMISSAO BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`
      : '';

    const filialFilter = filtros.filial
      ? `AND D2.D2_FILIAL = ${this._p(filtros.filial)}`
      : '';

    const produtoFilter = filtros.produto
      ? `AND (B1.B1_DESC LIKE ${this._p('%' + filtros.produto + '%')} OR D2.D2_COD = ${this._p(filtros.produto)})`
      : '';

    // ordenar_por: 'valor' (padrão) ou 'quantidade'
    const orderBy = intent.ordenar_por === 'quantidade:desc' || intent.ordenar_por === 'quantidade'
      ? 'quantidade_vendida DESC'
      : 'faturamento_total DESC';

    return `
SELECT TOP ${lim}
  D2.D2_COD                                           AS cod_produto,
  COALESCE(B1.B1_DESC, D2.D2_DESCRI)                 AS produto,
  B1.B1_TIPO                                          AS tipo,
  B1.B1_UM                                            AS unidade,
  SUM(D2.D2_QUANT)                                    AS quantidade_vendida,
  SUM(D2.D2_TOTAL)                                    AS faturamento_total,
  AVG(D2.D2_PRCVEN)                                   AS preco_medio,
  COUNT(DISTINCT F2.F2_CLIENTE)                       AS total_clientes
FROM ${sd2} D2
INNER JOIN ${sf2} F2 ON F2.F2_DOC   = D2.D2_DOC
                     AND F2.F2_SERIE  = D2.D2_SERIE
                     AND F2.F2_FILIAL = D2.D2_FILIAL
                     AND F2.D_E_L_E_T_ = ''
                     AND F2.F2_TIPO IN ('N','B')
LEFT  JOIN ${sb1} B1 ON B1.B1_COD  = D2.D2_COD
                     AND B1.D_E_L_E_T_ = ''
WHERE D2.D_E_L_E_T_ = ''
  ${dateFilter}
  ${filialFilter}
  ${produtoFilter}
GROUP BY D2.D2_COD, B1.B1_DESC, D2.D2_DESCRI, B1.B1_TIPO, B1.B1_UM
ORDER BY ${orderBy}
    `.trim();
  }
}

module.exports = ProdutosQueryBuilder;
