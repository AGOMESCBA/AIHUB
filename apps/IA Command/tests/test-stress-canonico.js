'use strict';

/**
 * STRESS TESTS — Pipeline canônico SX2 + validador + formatação WhatsApp
 *
 * Cobre:
 *  1. Faturamento: SD2+SF2 quantidade por produto, grupo, cliente (TES/CF)
 *  2. Faturamento: UNION ALL com devolução (SF1/SD1 F1_TIPO='D')
 *  3. Faturamento: Quantity por dia/mês/ano, código fiscal
 *  4. Financeiro: Aging recebível (CASE/WHEN por faixa de dias)
 *  5. Capital de giro: SE1+SE2 FULL OUTER JOIN
 *  6. Compras: SC7+SD1+SA2 multi-CTE
 *  7. Auditoria: casos-limite do sqlParaCanonico (NOLOCK, UNION ALL, subquery)
 *
 * Roda com: node tests/test-stress-canonico.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const {
  sqlParaCanonico,
  adaptarSqlCanonicoPorSX2,
  aliasTabelaSql,
  ALIASES_PROTHEUS,
} = require(path.join(ROOT, 'modules/erp/totvs_protheus/SX/sx2-sql-normalizer'));

const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const { validarSqlIaOwnerBasico } = runner._test;
const { _formatarFallback } = require(path.join(ROOT, 'modules/ai/chat/whatsapp-formatter'));

let passed = 0;
let failed = 0;

function assert(condicao, descricao, detalhes = '') {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
    passed++;
  } else {
    console.error(`  ✗ FALHA: ${descricao}`);
    if (detalhes) console.error(`    → ${detalhes}`);
    failed++;
  }
}

function titulo(t) {
  console.log(`\n${'─'.repeat(68)}`);
  console.log(`  ${t}`);
  console.log('─'.repeat(68));
}

function testarNormalizacao(label, sql, sx2C, sx2J) {
  const valResult = validarSqlIaOwnerBasico(sql);
  assert(valResult.ok, `${label}: validador aprova SQL`, `erros: ${valResult.erros?.join('; ')}`);

  const canonico = sqlParaCanonico(sql);
  const sufixosNoCanonico = canonico.match(/\b[A-Z]{2,4}(020|990|010|030)\b/g) || [];
  assert(sufixosNoCanonico.length === 0, `${label}: canônico sem sufixos`, `encontrados: ${sufixosNoCanonico.join(', ')}`);

  // Identifica apenas as tabelas que realmente aparecem no canônico
  const tabelasNoCanon = new Set(
    [...(canonico.matchAll(/\b(?:FROM|JOIN)\s+([A-Z]{2,4})\s+\1\b/gi))].map(m => m[1].toUpperCase())
  );

  if (sx2C) {
    const sqlC = adaptarSqlCanonicoPorSX2(canonico, sx2C, { logPrefix: `${label}-C3I` });
    for (const base of tabelasNoCanon) {
      const tabFisica = Object.keys(sx2C).find(k => k.startsWith(base) && /\d{3,4}$/.test(k));
      if (!tabFisica) continue;
      assert(sqlC.includes(tabFisica), `${label} C3I: ${tabFisica} presente (base ${base})`);
      if (sx2J) {
        const tabJ = Object.keys(sx2J).find(k => k.startsWith(base) && /\d{3,4}$/.test(k));
        if (tabJ) assert(!sqlC.includes(tabJ), `${label} C3I: sem contaminação J2A ${tabJ}`);
      }
    }
  }

  if (sx2J) {
    const sqlJ = adaptarSqlCanonicoPorSX2(canonico, sx2J, { logPrefix: `${label}-J2A` });
    for (const base of tabelasNoCanon) {
      const tabFisica = Object.keys(sx2J).find(k => k.startsWith(base) && /\d{3,4}$/.test(k));
      if (!tabFisica) continue;
      assert(sqlJ.includes(tabFisica), `${label} J2A: ${tabFisica} presente (base ${base})`);
      if (sx2C) {
        const tabC = Object.keys(sx2C).find(k => k.startsWith(base) && /\d{3,4}$/.test(k));
        if (tabC) assert(!sqlJ.includes(tabC), `${label} J2A: sem contaminação C3I ${tabC}`);
      }
    }
  }

  return canonico;
}

// SX2 das duas empresas
const sx2C3I = { SF2020: 'E', SD2020: 'E', SF1020: 'E', SD1020: 'E', SA1020: 'E', SB1020: 'E', SBM020: 'E', SF4020: 'E', SC7020: 'E', SA2020: 'E', SE1020: 'E', SE2020: 'E', SE8020: 'E', SA6020: 'E' };
const sx2J2A = { SF2990: 'E', SD2990: 'E', SF1990: 'E', SD1990: 'E', SA1990: 'E', SB1990: 'E', SBM990: 'E', SF4990: 'E', SC7990: 'E', SA2990: 'E', SE1990: 'E', SE2990: 'E', SE8990: 'E', SA6990: 'E' };

// ═══════════════════════════════════════════════════════════════════
// BLOCO 1 — FATURAMENTO: QUANTIDADE (SD2+SF2) COM TES E CÓDIGO FISCAL
// ═══════════════════════════════════════════════════════════════════

titulo('FATURAMENTO S1 — Quantidade faturada por produto no mês (SD2+SF2+SB1)');

// Regra: F2_TIPO='N', métrica = D2_QUANT, JOIN SD2 → SF2, lookup SB1
const sqlFatQtdProduto = `SET ROWCOUNT 50000;
SELECT
  SD2.D2_COD                       AS cod_produto,
  SB1.B1_DESC                      AS descricao,
  SBM.BM_DESC                      AS grupo,
  COALESCE(SUM(SD2.D2_QUANT), 0)   AS quantidade_faturada,
  COALESCE(SUM(SD2.D2_TOTAL), 0)   AS valor_total
FROM SD2020 SD2
JOIN SF2020 SF2
  ON SD2.D2_DOC    = SF2.F2_DOC
 AND SD2.D2_SERIE  = SF2.F2_SERIE
 AND SD2.D2_FILIAL = SF2.F2_FILIAL
 AND SF2.D_E_L_E_T_ = ' '
JOIN SB1020 SB1
  ON SD2.D2_COD    = SB1.B1_COD
 AND SB1.D_E_L_E_T_ = ' '
LEFT JOIN SBM020 SBM
  ON SB1.B1_GRUPO  = SBM.BM_GRUPO
 AND SBM.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO   = 'N'
  AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531'
GROUP BY SD2.D2_COD, SB1.B1_DESC, SBM.BM_DESC
ORDER BY quantidade_faturada DESC`;

testarNormalizacao('FatQtdProduto', sqlFatQtdProduto, sx2C3I, sx2J2A);

const canonFatQtdProduto = sqlParaCanonico(sqlFatQtdProduto);
// Verifica aliases extraídos — todos devem mapear para bases conhecidas
const aliasesFatQtd = aliasTabelaSql(canonFatQtdProduto);
assert(aliasesFatQtd['SD2'] === 'SD2', 'FatQtdProduto: alias SD2 → base SD2');
assert(aliasesFatQtd['SF2'] === 'SF2', 'FatQtdProduto: alias SF2 → base SF2');
assert(aliasesFatQtd['SB1'] === 'SB1', 'FatQtdProduto: alias SB1 → base SB1');
assert(aliasesFatQtd['SBM'] === 'SBM', 'FatQtdProduto: alias SBM → base SBM');

// ─────────────────────────────────────────────────────────────
titulo('FATURAMENTO S2 — Quantidade por dia no mês, com código fiscal (D2_CF)');

// Regra: filtrar apenas CF iniciados com '5' (saída) e excluir TES que não movimentam estoque
const sqlFatQtdDia = `SET ROWCOUNT 50000;
SELECT
  SF2.F2_EMISSAO                        AS data_emissao,
  SD2.D2_COD                            AS cod_produto,
  SD2.D2_TES                            AS tes,
  SD2.D2_CF                             AS codigo_fiscal,
  COALESCE(SUM(SD2.D2_QUANT), 0)        AS quantidade_faturada,
  COALESCE(SUM(SD2.D2_TOTAL), 0)        AS valor_total
FROM SD2020 SD2
JOIN SF2020 SF2
  ON SD2.D2_DOC    = SF2.F2_DOC
 AND SD2.D2_SERIE  = SF2.F2_SERIE
 AND SD2.D2_FILIAL = SF2.F2_FILIAL
 AND SF2.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO   = 'N'
  AND SD2.D2_CF LIKE '5%'
  AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531'
GROUP BY SF2.F2_EMISSAO, SD2.D2_COD, SD2.D2_TES, SD2.D2_CF
ORDER BY SF2.F2_EMISSAO, SD2.D2_COD`;

testarNormalizacao('FatQtdDia', sqlFatQtdDia, sx2C3I, sx2J2A);

// ─────────────────────────────────────────────────────────────
titulo('FATURAMENTO S3 — Faturamento por cliente/mês/ano com quantidade (SD2+SF2+SA1)');

const sqlFatClienteMes = `SET ROWCOUNT 50000;
WITH fat_item AS (
  SELECT
    SF2.F2_CLIENTE                          AS cod_cliente,
    SF2.F2_LOJA                             AS loja,
    SUBSTRING(SF2.F2_EMISSAO, 1, 4)         AS ano,
    SUBSTRING(SF2.F2_EMISSAO, 5, 2)         AS mes,
    COALESCE(SUM(SD2.D2_QUANT), 0)          AS quantidade,
    COALESCE(SUM(SD2.D2_TOTAL), 0)          AS valor_total
  FROM SD2020 SD2
  JOIN SF2020 SF2
    ON SD2.D2_DOC    = SF2.F2_DOC
   AND SD2.D2_SERIE  = SF2.F2_SERIE
   AND SD2.D2_FILIAL = SF2.F2_FILIAL
   AND SF2.D_E_L_E_T_ = ' '
  WHERE SD2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO    = 'N'
    AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) IN ('2025', '2026')
  GROUP BY SF2.F2_CLIENTE, SF2.F2_LOJA,
           SUBSTRING(SF2.F2_EMISSAO, 1, 4), SUBSTRING(SF2.F2_EMISSAO, 5, 2)
)
SELECT
  SA1.A1_NOME         AS cliente,
  f.ano,
  f.mes,
  f.quantidade,
  f.valor_total
FROM fat_item f
JOIN SA1020 SA1
  ON f.cod_cliente = SA1.A1_COD
 AND f.loja        = SA1.A1_LOJA
 AND SA1.D_E_L_E_T_ = ' '
ORDER BY f.ano, f.mes, f.valor_total DESC`;

testarNormalizacao('FatClienteMes', sqlFatClienteMes, sx2C3I, sx2J2A);

// ─────────────────────────────────────────────────────────────
titulo('FATURAMENTO S4 — Faturamento líquido com devolução (UNION ALL SF2/SD2 + SF1/SD1)');

// Regra do spec: SF1.F1_TIPO='D' para devolução; cliente em SF1.F1_FORNECE
const sqlFatLiquidoUnion = `SET ROWCOUNT 50000;
SELECT
  BASE.cod_cliente,
  SA1.A1_NOME                                   AS cliente,
  SUM(BASE.valor_faturamento)                   AS total_faturamento,
  SUM(BASE.valor_devolucao)                     AS total_devolucoes,
  SUM(BASE.valor_faturamento) - SUM(BASE.valor_devolucao) AS faturamento_liquido
FROM (
  SELECT
    SD2.D2_CLIENTE                AS cod_cliente,
    SD2.D2_LOJA                   AS loja,
    SD2.D2_TOTAL                  AS valor_faturamento,
    0                             AS valor_devolucao
  FROM SD2020 SD2
  JOIN SF2020 SF2
    ON SD2.D2_DOC    = SF2.F2_DOC
   AND SD2.D2_SERIE  = SF2.F2_SERIE
   AND SD2.D2_FILIAL = SF2.F2_FILIAL
   AND SF2.D_E_L_E_T_ = ' '
  WHERE SD2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO   = 'N'
    AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531'

  UNION ALL

  SELECT
    SD1.D1_FORNECE                AS cod_cliente,
    SD1.D1_LOJA                   AS loja,
    0                             AS valor_faturamento,
    SD1.D1_TOTAL                  AS valor_devolucao
  FROM SD1020 SD1
  JOIN SF1020 SF1
    ON SD1.D1_DOC    = SF1.F1_DOC
   AND SD1.D1_SERIE  = SF1.F1_SERIE
   AND SD1.D1_FILIAL = SF1.F1_FILIAL
   AND SF1.D_E_L_E_T_ = ' '
  WHERE SD1.D_E_L_E_T_ = ' '
    AND SF1.F1_TIPO   = 'D'
    AND SF1.F1_DTDIGIT BETWEEN '20260501' AND '20260531'
) BASE
JOIN SA1020 SA1
  ON BASE.cod_cliente = SA1.A1_COD
 AND SA1.D_E_L_E_T_ = ' '
GROUP BY BASE.cod_cliente, SA1.A1_NOME
ORDER BY faturamento_liquido DESC`;

testarNormalizacao('FatLiquidoUnion', sqlFatLiquidoUnion, sx2C3I, sx2J2A);

// Verifica que ambas as pernas do UNION ALL são normalizadas
const canonUnion = sqlParaCanonico(sqlFatLiquidoUnion);
const sd2Occurrences  = (canonUnion.match(/\bFROM SD2 SD2\b/gi) || []).length;
const sf2Occurrences  = (canonUnion.match(/\bJOIN SF2 SF2\b/gi) || []).length;
const sd1Occurrences  = (canonUnion.match(/\bFROM SD1 SD1\b/gi) || []).length;
const sf1Occurrences  = (canonUnion.match(/\bJOIN SF1 SF1\b/gi) || []).length;
assert(sd2Occurrences >= 1, `FatLiquidoUnion: SD2 normalizado no canônico (${sd2Occurrences}x)`);
assert(sf2Occurrences >= 1, `FatLiquidoUnion: SF2 normalizado no canônico (${sf2Occurrences}x)`);
assert(sd1Occurrences >= 1, `FatLiquidoUnion: SD1 normalizado no canônico (${sd1Occurrences}x)`);
assert(sf1Occurrences >= 1, `FatLiquidoUnion: SF1 normalizado no canônico (${sf1Occurrences}x)`);

// ═══════════════════════════════════════════════════════════════════
// BLOCO 2 — FINANCEIRO: AGING RECEBÍVEL + CAPITAL DE GIRO
// ═══════════════════════════════════════════════════════════════════

titulo('FINANCEIRO S1 — Aging de contas a receber por faixa (CASE/WHEN, SE1+SA1)');

const sqlAging = `SET ROWCOUNT 50000;
WITH vencidos AS (
  SELECT
    SE1.E1_CLIENTE                                   AS cod_cliente,
    SE1.E1_LOJA                                      AS loja,
    DATEDIFF(day, CONVERT(DATE, SE1.E1_VENCREA, 112), GETDATE()) AS dias_atraso,
    SE1.E1_SALDO
  FROM SE1020 SE1
  WHERE SE1.D_E_L_E_T_ = ' '
    AND SE1.E1_BAIXA  = '  '
    AND SE1.E1_SALDO  > 0
    AND SE1.E1_VENCREA < CONVERT(VARCHAR(8), GETDATE(), 112)
)
SELECT
  SA1.A1_NOME                                AS cliente,
  SUM(CASE WHEN v.dias_atraso BETWEEN  1 AND  30 THEN v.E1_SALDO ELSE 0 END) AS ate_30_dias,
  SUM(CASE WHEN v.dias_atraso BETWEEN 31 AND  60 THEN v.E1_SALDO ELSE 0 END) AS de_31_a_60_dias,
  SUM(CASE WHEN v.dias_atraso BETWEEN 61 AND  90 THEN v.E1_SALDO ELSE 0 END) AS de_61_a_90_dias,
  SUM(CASE WHEN v.dias_atraso > 90               THEN v.E1_SALDO ELSE 0 END) AS acima_90_dias,
  SUM(v.E1_SALDO)                            AS total_vencido
FROM vencidos v
JOIN SA1020 SA1
  ON v.cod_cliente = SA1.A1_COD
 AND v.loja        = SA1.A1_LOJA
 AND SA1.D_E_L_E_T_ = ' '
GROUP BY SA1.A1_NOME
ORDER BY total_vencido DESC`;

testarNormalizacao('Aging', sqlAging, sx2C3I, sx2J2A);

// CTE vencidos sem GROUP BY (apenas linha a linha) — o validador NÃO deve rejeitar
// pois não há função de agregação no corpo da CTE
const valAging = validarSqlIaOwnerBasico(sqlAging);
assert(valAging.ok, 'Aging: CTE row-level sem GROUP BY deve ser aprovado', `erros: ${valAging.erros?.join('; ')}`);

// ─────────────────────────────────────────────────────────────
titulo('FINANCEIRO S2 — Capital de giro: SE1 + SE2 FULL OUTER JOIN por mês');

const sqlCapGiro = `SET ROWCOUNT 50000;
WITH receber AS (
  SELECT
    SUBSTRING(SE1.E1_EMISSAO, 1, 6) AS mes_ano,
    SUM(SE1.E1_SALDO)               AS total_receber
  FROM SE1020 SE1
  WHERE SE1.D_E_L_E_T_ = ' '
    AND SE1.E1_BAIXA = '  '
    AND SE1.E1_SALDO > 0
  GROUP BY SUBSTRING(SE1.E1_EMISSAO, 1, 6)
),
pagar AS (
  SELECT
    SUBSTRING(SE2.E2_EMISSAO, 1, 6) AS mes_ano,
    SUM(SE2.E2_SALDO)               AS total_pagar
  FROM SE2020 SE2
  WHERE SE2.D_E_L_E_T_ = ' '
    AND SE2.E2_BAIXA = '  '
    AND SE2.E2_SALDO > 0
  GROUP BY SUBSTRING(SE2.E2_EMISSAO, 1, 6)
)
SELECT
  COALESCE(r.mes_ano, p.mes_ano)         AS mes_ano,
  COALESCE(r.total_receber, 0)           AS a_receber,
  COALESCE(p.total_pagar, 0)             AS a_pagar,
  COALESCE(r.total_receber, 0) - COALESCE(p.total_pagar, 0) AS capital_giro
FROM receber r
FULL OUTER JOIN pagar p ON r.mes_ano = p.mes_ano
ORDER BY mes_ano`;

testarNormalizacao('CapGiro', sqlCapGiro, sx2C3I, sx2J2A);

// ═══════════════════════════════════════════════════════════════════
// BLOCO 3 — COMPRAS: SC7 + SD1 + SA2 MULTI-CTE
// ═══════════════════════════════════════════════════════════════════

titulo('COMPRAS S1 — Pedidos pendentes vs entradas no mês (SC7+SD1+SA2)');

const sqlComprasPedidos = `SET ROWCOUNT 50000;
WITH pedidos AS (
  SELECT
    SC7.C7_FORNECE                    AS cod_fornecedor,
    SC7.C7_LOJA                       AS loja,
    COUNT(*)                          AS qtd_pedidos,
    SUM(SC7.C7_TOTAL)                 AS valor_pedidos
  FROM SC7020 SC7
  WHERE SC7.D_E_L_E_T_ = ' '
    AND SC7.C7_DATPRF >= CONVERT(VARCHAR(8), GETDATE(), 112)
  GROUP BY SC7.C7_FORNECE, SC7.C7_LOJA
),
entradas AS (
  SELECT
    SD1.D1_FORNECE                    AS cod_fornecedor,
    SD1.D1_LOJA                       AS loja,
    SUM(SD1.D1_TOTAL)                 AS valor_entrado
  FROM SD1020 SD1
  WHERE SD1.D_E_L_E_T_ = ' '
    AND SUBSTRING(SD1.D1_DTDIGIT, 1, 6) = SUBSTRING(CONVERT(VARCHAR(8), GETDATE(), 112), 1, 6)
  GROUP BY SD1.D1_FORNECE, SD1.D1_LOJA
)
SELECT
  SA2.A2_NOME                         AS fornecedor,
  COALESCE(p.qtd_pedidos, 0)          AS pedidos_pendentes,
  COALESCE(p.valor_pedidos, 0)        AS valor_pedidos_pendentes,
  COALESCE(e.valor_entrado, 0)        AS valor_entrado_mes
FROM SA2020 SA2
LEFT JOIN pedidos  p ON SA2.A2_COD = p.cod_fornecedor AND SA2.A2_LOJA = p.loja
LEFT JOIN entradas e ON SA2.A2_COD = e.cod_fornecedor AND SA2.A2_LOJA = e.loja
WHERE p.qtd_pedidos IS NOT NULL OR e.valor_entrado IS NOT NULL
ORDER BY valor_pedidos_pendentes DESC`;

testarNormalizacao('ComprasPedidos', sqlComprasPedidos, sx2C3I, sx2J2A);

// ═══════════════════════════════════════════════════════════════════
// BLOCO 4 — AUDITORIA DO PIPELINE CANÔNICO (edge cases)
// ═══════════════════════════════════════════════════════════════════

titulo('AUDITORIA 1 — WITH (NOLOCK): hint não deve corromper normalização');

const sqlNoLock = `SELECT SF2.F2_VALBRUT FROM SF2020 SF2 WITH (NOLOCK)
JOIN SA1020 SA1 WITH (NOLOCK) ON SF2.F2_CLIENTE = SA1.A1_COD
WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'`;

const canonNoLock = sqlParaCanonico(sqlNoLock);
assert(!canonNoLock.includes('SF2020'), 'NOLOCK: SF2020 → SF2 no canônico');
assert(!canonNoLock.includes('SA1020'), 'NOLOCK: SA1020 → SA1 no canônico');
assert(canonNoLock.includes('WITH (NOLOCK)'), 'NOLOCK: hint WITH (NOLOCK) preservado no canônico');

const sqlNLJ2A = adaptarSqlCanonicoPorSX2(canonNoLock, sx2J2A, { logPrefix: 'NOLOCK-J2A' });
assert(sqlNLJ2A.includes('SF2990') && sqlNLJ2A.includes('SA1990'), 'NOLOCK J2A: sufixos 990 re-adicionados');
assert(sqlNLJ2A.includes('WITH (NOLOCK)'), 'NOLOCK J2A: hint preservado após adaptação');

// ─────────────────────────────────────────────────────────────
titulo('AUDITORIA 2 — UNION ALL: mesmo alias em dois SELECT deve ser normalizado nas duas ocorrências');

const sqlUnionAll = `SELECT SUM(SF2.F2_VALBRUT) AS total FROM SF2020 SF2
WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
AND SF2.F2_EMISSAO BETWEEN '20260101' AND '20260631'
UNION ALL
SELECT SUM(SF2.F2_VALBRUT) AS total FROM SF2020 SF2
WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'D'
AND SF2.F2_EMISSAO BETWEEN '20260101' AND '20260631'`;

const canonUnionAll = sqlParaCanonico(sqlUnionAll);
const sf2Matches = (canonUnionAll.match(/\bFROM SF2 SF2\b/gi) || []).length;
assert(sf2Matches === 2, `UNION ALL: SF2 normalizado nas 2 ocorrências (encontrei ${sf2Matches})`);
assert(!canonUnionAll.includes('SF2020'), 'UNION ALL: zero SF2020 no canônico');

const sqlUAJ2A = adaptarSqlCanonicoPorSX2(canonUnionAll, sx2J2A, { logPrefix: 'UNIONALL-J2A' });
const sf2990Matches = (sqlUAJ2A.match(/\bFROM SF2990 SF2\b/gi) || []).length;
assert(sf2990Matches === 2, `UNION ALL J2A: SF2990 nas 2 ocorrências (encontrei ${sf2990Matches})`);

// ─────────────────────────────────────────────────────────────
titulo('AUDITORIA 3 — Subquery derivada em FROM: normalização dentro da subquery');

const sqlDerivedTable = `SET ROWCOUNT 50000;
SELECT h.ano, h.mes, SUM(h.total) AS faturamento
FROM (
  SELECT
    SUBSTRING(SF2.F2_EMISSAO, 1, 4) AS ano,
    SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS mes,
    SF2.F2_VALBRUT                  AS total
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
) h
GROUP BY h.ano, h.mes
ORDER BY h.ano, h.mes`;

const valDerived = validarSqlIaOwnerBasico(sqlDerivedTable);
assert(valDerived.ok, 'Subquery derivada: aprovada pelo validador', `erros: ${valDerived.erros?.join('; ')}`);

const canonDerived = sqlParaCanonico(sqlDerivedTable);
assert(!canonDerived.includes('SF2020'), 'Subquery derivada: SF2020 → SF2 no canônico (dentro da subquery)');

const sqlDervJ2A = adaptarSqlCanonicoPorSX2(canonDerived, sx2J2A, { logPrefix: 'DERIVED-J2A' });
assert(sqlDervJ2A.includes('SF2990'), 'Subquery derivada J2A: SF2990 dentro da subquery');

// ─────────────────────────────────────────────────────────────
titulo('AUDITORIA 4 — CTE multilevel (CTE referencia outra CTE)');

const sqlCTEMultilevel = `SET ROWCOUNT 50000;
WITH fat_item AS (
  SELECT SF2.F2_CLIENTE, SD2.D2_COD, SUM(SD2.D2_TOTAL) AS total_item
  FROM SD2020 SD2
  JOIN SF2020 SF2 ON SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SF2.D_E_L_E_T_ = ' '
  WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
    AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531'
  GROUP BY SF2.F2_CLIENTE, SD2.D2_COD
),
top_clientes AS (
  SELECT F2_CLIENTE, SUM(total_item) AS total_cliente
  FROM fat_item
  GROUP BY F2_CLIENTE
)
SELECT SA1.A1_NOME, tc.total_cliente
FROM top_clientes tc
JOIN SA1020 SA1 ON tc.F2_CLIENTE = SA1.A1_COD AND SA1.D_E_L_E_T_ = ' '
ORDER BY tc.total_cliente DESC`;

testarNormalizacao('CTEMultilevel', sqlCTEMultilevel, sx2C3I, sx2J2A);

// CTE top_clientes referencia fat_item (outra CTE) — não é tabela Protheus, não deve ser substituída
const canonML = sqlParaCanonico(sqlCTEMultilevel);
assert(canonML.includes('FROM fat_item'), 'CTE multilevel: fat_item preservado (não confundido com tabela Protheus)');
assert(canonML.includes('FROM top_clientes tc'), 'CTE multilevel: top_clientes preservado no FROM externo');

// ─────────────────────────────────────────────────────────────
titulo('AUDITORIA 5 — ALIASES_PROTHEUS: cobertura de todas as tabelas dos módulos');

// Garante que as tabelas usadas nos specs estão no conjunto
const tabelasCriticas = [
  'SF2','SD2','SF1','SD1','SA1','SA2','SA3','SA6',
  'SB1','SBM','SC7','SE1','SE2','SE5','SE8','SED',
  'SF4','CTT',
];
for (const t of tabelasCriticas) {
  assert(ALIASES_PROTHEUS.has(t), `ALIASES_PROTHEUS: ${t} registrado`);
}

// ═══════════════════════════════════════════════════════════════════
// BLOCO 5 — FORMATAÇÃO WHATSAPP com os novos campos (fix de regex)
// ═══════════════════════════════════════════════════════════════════

titulo('FORMATAÇÃO WHATSAPP — Quantity query e aging');

const rowsQtd = [
  { cod_produto: 'PR001', descricao: 'Produto Alpha',   grupo: 'GRPX', quantidade_faturada: 1200,    valor_total: 84000.00 },
  { cod_produto: 'PR002', descricao: 'Produto Beta',    grupo: 'GRPX', quantidade_faturada: 850,     valor_total: 46750.00 },
  { cod_produto: 'PR003', descricao: 'Produto Gamma',   grupo: 'GRPY', quantidade_faturada: 320,     valor_total: 28800.00 },
  { cod_produto: 'PR004', descricao: 'Produto Delta',   grupo: 'GRPY', quantidade_faturada: 75,      valor_total: 15000.00 },
];

console.log('\n[WhatsApp — Quantidade por produto]');
console.log('─'.repeat(68));
const wppQtd = _formatarFallback(rowsQtd, 'Quantidade faturada por produto em maio 2026');
console.log(wppQtd);

assert(wppQtd.includes('*'), 'WhatsApp Qtd: campos monetários em negrito');
assert(!wppQtd.includes('84000'), 'WhatsApp Qtd: valor_total formatado como BRL (sem número bruto)');

const rowsAging = [
  { cliente: 'Cliente Alpha S.A.',   ate_30_dias: 45000.00, de_31_a_60_dias: 12000.00, de_61_a_90_dias: 0,      acima_90_dias: 0,      total_vencido: 57000.00 },
  { cliente: 'Cliente Beta Ltda.',   ate_30_dias: 8000.00,  de_31_a_60_dias: 22000.00, de_61_a_90_dias: 9500.00, acima_90_dias: 35000.00, total_vencido: 74500.00 },
  { cliente: 'Indústria Gamma ME.',  ate_30_dias: 0,         de_31_a_60_dias: 0,         de_61_a_90_dias: 0,      acima_90_dias: 120000.00, total_vencido: 120000.00 },
];

console.log('\n[WhatsApp — Aging recebível]');
console.log('─'.repeat(68));
const wppAging = _formatarFallback(rowsAging, 'Aging de contas a receber por faixa de dias');
console.log(wppAging);

const rowsCapGiro = [
  { mes_ano: '202601', a_receber: 950000.00, a_pagar: 720000.00, capital_giro: 230000.00 },
  { mes_ano: '202602', a_receber: 880000.00, a_pagar: 810000.00, capital_giro: 70000.00  },
  { mes_ano: '202603', a_receber: 1100000.00, a_pagar: 890000.00, capital_giro: 210000.00 },
];

console.log('\n[WhatsApp — Capital de giro]');
console.log('─'.repeat(68));
const wppCapGiro = _formatarFallback(rowsCapGiro, 'Capital de giro por mês (SE1 - SE2)');
console.log(wppCapGiro);

const rowsYoY = [
  { ano: '2026', mes: 1, faturamento_atual: 850000.50,   faturamento_anterior: 720000.00,  crescimento_pct: 18.13 },
  { ano: '2026', mes: 2, faturamento_atual: 910000.00,   faturamento_anterior: 780000.50,  crescimento_pct: 16.59 },
  { ano: '2026', mes: 3, faturamento_atual: 975000.75,   faturamento_anterior: 850000.00,  crescimento_pct: 14.71 },
  { ano: '2026', mes: 4, faturamento_atual: 1020000.00,  faturamento_anterior: 920000.00,  crescimento_pct: 10.87 },
  { ano: '2026', mes: 5, faturamento_atual: 1100000.25,  faturamento_anterior: 980000.00,  crescimento_pct: 12.27 },
];

console.log('\n[WhatsApp — Faturamento YoY com crescimento% (fix)]');
console.log('─'.repeat(68));
const wppYoY = _formatarFallback(rowsYoY, 'Faturamento por mês 2026 vs 2025 com crescimento');
console.log(wppYoY);

assert(wppYoY.includes('+18.13%') || wppYoY.includes('+18,13%'), 'WhatsApp YoY: crescimento_pct formatado com +% (fix)');
assert(wppYoY.includes('*faturamento_atual:'), 'WhatsApp YoY: faturamento_atual em negrito (fix)');
assert(wppYoY.includes('*faturamento_anterior:'), 'WhatsApp YoY: faturamento_anterior em negrito (fix)');
assert(!wppYoY.includes('850000'), 'WhatsApp YoY: valores BRL sem número bruto');

// ═══════════════════════════════════════════════════════════════════
// Resultado final
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(68)}`);
console.log(`  RESULTADO STRESS: ${passed} passaram, ${failed} falharam`);
console.log('═'.repeat(68));

process.exit(failed > 0 ? 1 : 0);
