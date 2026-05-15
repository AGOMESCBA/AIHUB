const QueryBuilder = require('./base/QueryBuilder');

// Protheus SA1 — Cadastro de Clientes
class ClientesQueryBuilder extends QueryBuilder {
  build(intent) {
    const suf = this._suffix(intent.filtros?.filial);
    const sa1 = `SA1${suf}`;
    const sf2 = `SF2${suf}`;
    const sd2 = `SD2${suf}`;

    // consultar_clientes_inativos: clients with no billing in last N months
    if (intent.intencao === 'consultar_clientes_inativos') {
      const meses = intent.filtros?.meses_sem_compra || 3;
      const corte = this._p(_dataCorte(meses));
      return `
SELECT TOP 50
  A1.A1_COD                         AS cod_cliente,
  A1.A1_NOME                        AS cliente,
  A1.A1_EST                         AS estado,
  A1.A1_TEL                         AS telefone,
  MAX(F2.F2_EMISSAO)                AS ultima_compra
FROM ${sa1} A1
LEFT JOIN ${sf2} F2 ON F2.F2_CLIENTE = A1.A1_COD AND F2.D_E_L_E_T_ = '' AND F2.F2_TIPO IN ('N','B')
WHERE A1.D_E_L_E_T_ = ''
  AND A1.A1_ATIVO <> '2'
GROUP BY A1.A1_COD, A1.A1_NOME, A1.A1_EST, A1.A1_TEL
HAVING MAX(F2.F2_EMISSAO) < ${corte} OR MAX(F2.F2_EMISSAO) IS NULL
ORDER BY ultima_compra ASC
      `.trim();
    }

    return `
SELECT TOP 50
  A1.A1_COD                         AS cod_cliente,
  A1.A1_NOME                        AS cliente,
  A1.A1_EST                         AS estado,
  A1.A1_CGC                         AS cnpj,
  A1.A1_TEL                         AS telefone
FROM ${sa1} A1
WHERE A1.D_E_L_E_T_ = ''
ORDER BY A1.A1_NOME ASC
    `.trim();
  }
}

function _dataCorte(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

module.exports = ClientesQueryBuilder;
