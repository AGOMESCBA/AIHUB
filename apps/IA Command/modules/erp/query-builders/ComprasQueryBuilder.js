const QueryBuilder = require('./base/QueryBuilder');

// Protheus SF1 (Cabeçalho NF Entrada) + SD1 (Itens NF Entrada) + SA2 (Fornecedores)
// Representa compras efetivadas (notas fiscais de entrada já recebidas)
class ComprasQueryBuilder extends QueryBuilder {
  build(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const sf1 = `SF1${suf}`;
    const sd1 = `SD1${suf}`;
    const sa2 = `SA2${suf}`;
    const { filtros = {}, periodo, limite, acao } = intent;

    switch (acao) {
      case 'top_n':    return this._buildTopFornecedores(sf1, sd1, sa2, intent);
      case 'detalhado': return this._buildDetalhado(sf1, sd1, sa2, intent);
      default:          return this._buildResumo(sf1, sd1, sa2, intent);
    }
  }

  _dateFilter(alias, campo, periodo) {
    if (!periodo?.dataInicio || !periodo?.dataFim) return '';
    return `AND ${alias}.${campo} BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`;
  }

  _buildResumo(sf1, sd1, sa2, intent) {
    const df = this._dateFilter('F1', 'F1_EMISSAO', intent.periodo);
    const filialFilter = intent.filtros?.filial
      ? `AND F1.F1_FILIAL = ${this._p(intent.filtros.filial)}`
      : '';

    return `
SELECT
  COUNT(DISTINCT F1.F1_DOC)                           AS total_notas,
  SUM(D1.D1_TOTAL)                                    AS total_compras,
  AVG(D1.D1_TOTAL)                                    AS ticket_medio,
  COUNT(DISTINCT F1.F1_FORNECE)                       AS total_fornecedores,
  MIN(F1.F1_EMISSAO)                                  AS data_inicio,
  MAX(F1.F1_EMISSAO)                                  AS data_fim
FROM ${sf1} F1
INNER JOIN ${sd1} D1 ON D1.D1_DOC    = F1.F1_DOC
                     AND D1.D1_SERIE   = F1.F1_SERIE
                     AND D1.D1_FORNECE = F1.F1_FORNECE
                     AND D1.D_E_L_E_T_ = ''
WHERE F1.D_E_L_E_T_ = ''
  AND F1.F1_TIPO NOT IN ('D','B')
  ${df}
  ${filialFilter}
    `.trim();
  }

  _buildDetalhado(sf1, sd1, sa2, intent) {
    const df  = this._dateFilter('F1', 'F1_EMISSAO', intent.periodo);
    const lim = parseInt(intent.limite) || 100;

    const fornecedorFilter = intent.filtros?.fornecedor
      ? `AND (A2.A2_NOME LIKE ${this._p('%' + intent.filtros.fornecedor + '%')} OR F1.F1_FORNECE = ${this._p(intent.filtros.fornecedor)})`
      : '';

    const filialFilter = intent.filtros?.filial
      ? `AND F1.F1_FILIAL = ${this._p(intent.filtros.filial)}`
      : '';

    return `
SELECT TOP ${lim}
  F1.F1_FILIAL                                        AS filial,
  F1.F1_DOC                                           AS nota,
  F1.F1_SERIE                                         AS serie,
  F1.F1_FORNECE                                       AS cod_fornecedor,
  COALESCE(A2.A2_NOME, F1.F1_FORNECE)                AS fornecedor,
  F1.F1_EMISSAO                                       AS emissao,
  SUM(D1.D1_TOTAL)                                    AS valor_nota,
  COUNT(D1.D1_ITEM)                                   AS qtd_itens
FROM ${sf1} F1
INNER JOIN ${sd1} D1 ON D1.D1_DOC    = F1.F1_DOC
                     AND D1.D1_SERIE   = F1.F1_SERIE
                     AND D1.D1_FORNECE = F1.F1_FORNECE
                     AND D1.D_E_L_E_T_ = ''
LEFT  JOIN ${sa2} A2 ON A2.A2_COD = F1.F1_FORNECE AND A2.D_E_L_E_T_ = ''
WHERE F1.D_E_L_E_T_ = ''
  AND F1.F1_TIPO NOT IN ('D','B')
  ${df}
  ${fornecedorFilter}
  ${filialFilter}
GROUP BY
  F1.F1_FILIAL, F1.F1_DOC, F1.F1_SERIE,
  F1.F1_FORNECE, A2.A2_NOME, F1.F1_EMISSAO
ORDER BY F1.F1_EMISSAO DESC
    `.trim();
  }

  _buildTopFornecedores(sf1, sd1, sa2, intent) {
    const df  = this._dateFilter('F1', 'F1_EMISSAO', intent.periodo);
    const n   = parseInt(intent.limite) || 10;

    const filialFilter = intent.filtros?.filial
      ? `AND F1.F1_FILIAL = ${this._p(intent.filtros.filial)}`
      : '';

    return `
SELECT TOP ${n}
  F1.F1_FORNECE                                       AS cod_fornecedor,
  COALESCE(A2.A2_NOME, F1.F1_FORNECE)                AS fornecedor,
  A2.A2_EST                                           AS estado,
  COUNT(DISTINCT F1.F1_DOC)                           AS total_notas,
  SUM(D1.D1_TOTAL)                                    AS total_compras
FROM ${sf1} F1
INNER JOIN ${sd1} D1 ON D1.D1_DOC    = F1.F1_DOC
                     AND D1.D1_SERIE   = F1.F1_SERIE
                     AND D1.D1_FORNECE = F1.F1_FORNECE
                     AND D1.D_E_L_E_T_ = ''
LEFT  JOIN ${sa2} A2 ON A2.A2_COD = F1.F1_FORNECE AND A2.D_E_L_E_T_ = ''
WHERE F1.D_E_L_E_T_ = ''
  AND F1.F1_TIPO NOT IN ('D','B')
  ${df}
  ${filialFilter}
GROUP BY F1.F1_FORNECE, A2.A2_NOME, A2.A2_EST
ORDER BY total_compras DESC
    `.trim();
  }
}

module.exports = ComprasQueryBuilder;
