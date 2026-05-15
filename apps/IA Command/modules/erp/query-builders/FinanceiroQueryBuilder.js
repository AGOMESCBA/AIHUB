const QueryBuilder = require('./base/QueryBuilder');

// Protheus SE1 — Títulos a Receber
class FinanceiroQueryBuilder extends QueryBuilder {
  build(intent) {
    const suf  = this._suffix(intent.filtros?.filial);
    const se1  = `SE1${suf}`;
    const sa1  = `SA1${suf}`;
    const { filtros = {}, periodo, limite } = intent;

    // Todos os títulos em aberto (saldo > 0, não cancelados)
    const lim = parseInt(limite) || 100;

    // Filtros opcionais
    const clienteFilter = filtros.cliente
      ? `AND (A1.A1_NOME LIKE ${this._p('%' + filtros.cliente + '%')} OR E1.E1_CLIENTE = ${this._p(filtros.cliente)})`
      : '';

    const filialFilter = filtros.filial
      ? `AND E1.E1_FILIAL = ${this._p(filtros.filial)}`
      : '';

    // Filtro de período sobre vencimento
    const dateFilter = periodo?.dataInicio && periodo?.dataFim
      ? `AND E1.E1_VENCTO BETWEEN ${this._p(periodo.dataInicio)} AND ${this._p(periodo.dataFim)}`
      : '';

    // Filtro de vencidos: vencto < hoje
    const today = _hoje();
    const vencidoFilter = filtros.apenas_vencidos === true
      ? `AND E1.E1_VENCTO < ${this._p(today)}`
      : '';

    return `
SELECT TOP ${lim}
  E1.E1_FILIAL                          AS filial,
  E1.E1_CLIENTE                         AS cod_cliente,
  COALESCE(A1.A1_NOME, E1.E1_NOME)      AS cliente,
  E1.E1_NUM                             AS titulo,
  E1.E1_PARCELA                         AS parcela,
  E1.E1_TIPO                            AS tipo,
  E1.E1_EMISSAO                         AS emissao,
  E1.E1_VENCTO                          AS vencimento,
  E1.E1_VALOR                           AS valor,
  E1.E1_SALDO                           AS saldo,
  CASE WHEN E1.E1_VENCTO < ${this._p(today)} THEN 'Vencido' ELSE 'A Vencer' END AS status_venc
FROM ${se1} E1
LEFT JOIN ${sa1} A1 ON A1.A1_COD = E1.E1_CLIENTE AND A1.D_E_L_E_T_ = ''
WHERE E1.D_E_L_E_T_ = ''
  AND E1.E1_TIPO NOT IN ('NDF','DP')
  AND E1.E1_SALDO > 0
  ${dateFilter}
  ${vencidoFilter}
  ${clienteFilter}
  ${filialFilter}
ORDER BY E1.E1_VENCTO ASC
    `.trim();
  }

  // Query de resumo: total em aberto, total vencido, total a vencer
  buildResumo(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const se1 = `SE1${suf}`;
    const today = _hoje();
    const todayParam = this._p(today);

    const filialFilter = intent.filtros?.filial
      ? `AND E1.E1_FILIAL = ${this._p(intent.filtros.filial)}`
      : '';

    return `
SELECT
  COUNT(*)                                                      AS total_titulos,
  SUM(E1.E1_SALDO)                                             AS total_em_aberto,
  SUM(CASE WHEN E1.E1_VENCTO < ${todayParam} THEN E1.E1_SALDO ELSE 0 END) AS total_vencido,
  SUM(CASE WHEN E1.E1_VENCTO >= ${todayParam} THEN E1.E1_SALDO ELSE 0 END) AS total_a_vencer,
  COUNT(CASE WHEN E1.E1_VENCTO < ${todayParam} THEN 1 END)     AS qtd_vencidos,
  COUNT(CASE WHEN E1.E1_VENCTO >= ${todayParam} THEN 1 END)    AS qtd_a_vencer
FROM ${se1} E1
WHERE E1.D_E_L_E_T_ = ''
  AND E1.E1_TIPO NOT IN ('NDF','DP')
  AND E1.E1_SALDO > 0
  ${filialFilter}
    `.trim();
  }
}

function _hoje() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

module.exports = FinanceiroQueryBuilder;
