const QueryBuilder = require('./base/QueryBuilder');

// Protheus tables: SF2 (Notas Fiscais), SD2 (Itens NF), SA1 (Clientes)
// Always filter D_E_L_E_T_ = '' and use dynamic suffix

class FaturamentoQueryBuilder extends QueryBuilder {
  build(intent) {
    const suf     = this._suffix(intent.filtros?.filial);
    const sf2     = `SF2${suf}`;
    const sd2     = `SD2${suf}`;
    const sa1     = `SA1${suf}`;
    const { periodo, filtros, acao, limite, agrupar_por, ordenar_por } = intent;

    switch (acao) {
      case 'top_n':    return this._buildTopClientes(sf2, sd2, sa1, intent);
      case 'comparacao': return this._buildComparacao(sf2, sd2, sa1, intent);
      case 'ticket_medio': return this._buildTicketMedio(sf2, sd2, sa1, intent);
      default:
        if (intent.intencao === 'consultar_faturamento_por_cliente') return this._buildPorCliente(sf2, sd2, sa1, intent);
        if (intent.intencao === 'consultar_faturamento_por_vendedor') return this._buildPorVendedor(sf2, sd2, sa1, intent);
        return this._buildResumo(sf2, sd2, sa1, intent);
    }
  }

  _dateFilter(alias, campo, periodo) {
    if (!periodo?.dataInicio || !periodo?.dataFim) return '';
    return `AND ${alias}.${campo} BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`;
  }

  _buildResumo(sf2, sd2, sa1, intent) {
    const df = this._dateFilter('F2', 'F2_EMISSAO', intent.periodo);
    const filialFilter = intent.filtros?.filial
      ? `AND F2.F2_FILIAL = ${this._p(intent.filtros.filial)}`
      : '';

    return `
SELECT
  COUNT(DISTINCT F2.F2_DOC)                         AS total_notas,
  SUM(D2.D2_TOTAL)                                  AS faturamento_total,
  AVG(D2.D2_TOTAL)                                  AS ticket_medio,
  MIN(F2.F2_EMISSAO)                                AS data_inicio,
  MAX(F2.F2_EMISSAO)                                AS data_fim
FROM ${sf2} F2
INNER JOIN ${sd2} D2 ON D2.D2_DOC = F2.F2_DOC AND D2.D2_SERIE = F2.F2_SERIE
  AND D2.D_E_L_E_T_ = ''
WHERE F2.D_E_L_E_T_ = ''
  AND F2.F2_TIPO IN ('N','B')
  ${df}
  ${filialFilter}
`.trim();
  }

  _buildPorCliente(sf2, sd2, sa1, intent) {
    const df = this._dateFilter('F2', 'F2_EMISSAO', intent.periodo);
    const clienteFilter = intent.filtros?.cliente
      ? `AND (A1.A1_NOME LIKE ${this._p('%' + intent.filtros.cliente + '%')} OR F2.F2_CLIENTE = ${this._p(intent.filtros.cliente)})`
      : '';
    const lim = intent.limite ? `TOP ${parseInt(intent.limite)}` : 'TOP 50';

    return `
SELECT ${lim}
  F2.F2_CLIENTE                                     AS cod_cliente,
  A1.A1_NOME                                        AS cliente,
  COUNT(DISTINCT F2.F2_DOC)                         AS total_notas,
  SUM(D2.D2_TOTAL)                                  AS faturamento_total
FROM ${sf2} F2
INNER JOIN ${sd2} D2 ON D2.D2_DOC = F2.F2_DOC AND D2.D2_SERIE = F2.F2_SERIE AND D2.D_E_L_E_T_ = ''
LEFT  JOIN ${sa1} A1 ON A1.A1_COD = F2.F2_CLIENTE  AND A1.D_E_L_E_T_ = ''
WHERE F2.D_E_L_E_T_ = ''
  AND F2.F2_TIPO IN ('N','B')
  ${df}
  ${clienteFilter}
GROUP BY F2.F2_CLIENTE, A1.A1_NOME
ORDER BY faturamento_total DESC
`.trim();
  }

  _buildPorVendedor(sf2, sd2, sa1, intent) {
    const df  = this._dateFilter('F2', 'F2_EMISSAO', intent.periodo);
    const lim = intent.limite ? `TOP ${parseInt(intent.limite)}` : 'TOP 50';

    return `
SELECT ${lim}
  F2.F2_VEND1                                       AS cod_vendedor,
  COUNT(DISTINCT F2.F2_DOC)                         AS total_notas,
  SUM(D2.D2_TOTAL)                                  AS faturamento_total,
  COUNT(DISTINCT F2.F2_CLIENTE)                     AS total_clientes
FROM ${sf2} F2
INNER JOIN ${sd2} D2 ON D2.D2_DOC = F2.F2_DOC AND D2.D2_SERIE = F2.F2_SERIE AND D2.D_E_L_E_T_ = ''
WHERE F2.D_E_L_E_T_ = ''
  AND F2.F2_TIPO IN ('N','B')
  ${df}
GROUP BY F2.F2_VEND1
ORDER BY faturamento_total DESC
`.trim();
  }

  _buildTopClientes(sf2, sd2, sa1, intent) {
    const df  = this._dateFilter('F2', 'F2_EMISSAO', intent.periodo);
    const n   = parseInt(intent.limite) || 10;

    return `
SELECT TOP ${n}
  F2.F2_CLIENTE                                     AS cod_cliente,
  A1.A1_NOME                                        AS cliente,
  A1.A1_EST                                         AS estado,
  SUM(D2.D2_TOTAL)                                  AS faturamento_total,
  COUNT(DISTINCT F2.F2_DOC)                         AS total_notas
FROM ${sf2} F2
INNER JOIN ${sd2} D2 ON D2.D2_DOC = F2.F2_DOC AND D2.D2_SERIE = F2.F2_SERIE AND D2.D_E_L_E_T_ = ''
LEFT  JOIN ${sa1} A1 ON A1.A1_COD = F2.F2_CLIENTE  AND A1.D_E_L_E_T_ = ''
WHERE F2.D_E_L_E_T_ = ''
  AND F2.F2_TIPO IN ('N','B')
  ${df}
GROUP BY F2.F2_CLIENTE, A1.A1_NOME, A1.A1_EST
ORDER BY faturamento_total DESC
`.trim();
  }

  _buildComparacao(sf2, sd2, sa1, intent) {
    // Returns two periods side by side using CASE WHEN
    const p1 = intent.periodo;     // periodo principal
    const p2 = intent.periodo2 || null;  // periodo anterior (optional)

    const df1 = p1?.dataInicio ? `AND F2.F2_EMISSAO BETWEEN ${this._p(p1.dataInicio)} AND ${this._p(p1.dataFim)}` : '';

    return `
SELECT
  SUM(CASE WHEN F2.F2_EMISSAO BETWEEN ${this._p(p1?.dataInicio || '')} AND ${this._p(p1?.dataFim || '')}
       THEN D2.D2_TOTAL ELSE 0 END)                 AS periodo_atual,
  COUNT(DISTINCT CASE WHEN F2.F2_EMISSAO BETWEEN ${this._p(p1?.dataInicio || '')} AND ${this._p(p1?.dataFim || '')}
       THEN F2.F2_DOC END)                          AS notas_periodo_atual
FROM ${sf2} F2
INNER JOIN ${sd2} D2 ON D2.D2_DOC = F2.F2_DOC AND D2.D2_SERIE = F2.F2_SERIE AND D2.D_E_L_E_T_ = ''
WHERE F2.D_E_L_E_T_ = ''
  AND F2.F2_TIPO IN ('N','B')
`.trim();
  }

  _buildTicketMedio(sf2, sd2, sa1, intent) {
    const df = this._dateFilter('F2', 'F2_EMISSAO', intent.periodo);

    return `
SELECT
  COUNT(DISTINCT F2.F2_DOC)                         AS total_notas,
  SUM(D2.D2_TOTAL)                                  AS faturamento_total,
  SUM(D2.D2_TOTAL) / NULLIF(COUNT(DISTINCT F2.F2_DOC), 0) AS ticket_medio
FROM ${sf2} F2
INNER JOIN ${sd2} D2 ON D2.D2_DOC = F2.F2_DOC AND D2.D2_SERIE = F2.F2_SERIE AND D2.D_E_L_E_T_ = ''
WHERE F2.D_E_L_E_T_ = ''
  AND F2.F2_TIPO IN ('N','B')
  ${df}
`.trim();
  }
}

module.exports = FaturamentoQueryBuilder;
