'use strict';

/**
 * Testes multi-turn: filtros por cliente/fornecedor/empresa com herança de contexto.
 *
 * Valida que:
 *  1. Consultas com FROM (...) BASE JOIN SA1020 SA1 não disparam falso positivo
 *     no validarEscopoSubqueryExterno (Bug 5 fix — JOINs externos excluídos do check)
 *  2. Pipeline canônico (sqlParaCanonico + adaptarSqlCanonicoPorSX2) funciona
 *     corretamente para SA1, SA2, SC7, SD1, SD2, SF2, SF1
 *  3. Refinamento multi-turn (add GROUP BY mes) não quebra validação nem pipeline
 *
 * Perguntas cobertas:
 *  P1  — "Faturamento do cliente ASTER no ano de 2026"
 *  P1b — "Agora detalhe por mes" (herda cliente=ASTER + periodo=2026)
 *  P2  — "Compras do fornecedor Softexpert no ano de 2026"
 *  P2b — "Agora me detalhe por mes" (herda fornecedor=Softexpert + periodo=2026)
 *  P3  — "Faturamento da empresa Softexpert detalhada por mes"
 *
 * Roda com: node tests/test-pipeline-multiturn.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const {
  sqlParaCanonico,
  adaptarSqlCanonicoPorSX2,
} = require(path.join(ROOT, 'modules/erp/sx2-sql-normalizer'));

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

// SX2 das duas empresas
const sx2C3I = { SF2020:'E', SD2020:'E', SF1020:'E', SD1020:'E', SA1020:'E', SA2020:'E', SC7020:'E' };
const sx2J2A = { SF2990:'E', SD2990:'E', SF1990:'E', SD1990:'E', SA1990:'E', SA2990:'E', SC7990:'E' };

// ═══════════════════════════════════════════════════════════════════
// P1 — Faturamento do cliente ASTER no ano de 2026
// Padrão simples: SF2+SD2 JOIN SA1, sem tabela derivada
// ═══════════════════════════════════════════════════════════════════
titulo('P1 — Faturamento cliente ASTER 2026 (SF2+SD2 JOIN SA1, sem subquery)');

const sqlFatAsterAnual = `SET ROWCOUNT 50000;
SELECT
  SA1.A1_COD                        AS cod_cliente,
  SA1.A1_NOME                       AS nome_cliente,
  COALESCE(SUM(SD2.D2_TOTAL), 0)    AS faturamento_total
FROM SD2020 SD2
JOIN SF2020 SF2
  ON SD2.D2_DOC    = SF2.F2_DOC
 AND SD2.D2_SERIE  = SF2.F2_SERIE
 AND SD2.D2_FILIAL = SF2.F2_FILIAL
 AND SF2.D_E_L_E_T_ = ' '
JOIN SA1020 SA1
  ON SD2.D2_CLIENTE = SA1.A1_COD
 AND SA1.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SF2.F2_EMISSAO BETWEEN '20260101' AND '20261231'
  AND SA1.A1_NOME LIKE '%ASTER%'
GROUP BY SA1.A1_COD, SA1.A1_NOME
ORDER BY faturamento_total DESC`;

const valP1 = validarSqlIaOwnerBasico(sqlFatAsterAnual);
console.log('\n[Validação P1]', JSON.stringify(valP1));

assert(valP1.ok, 'P1: validador aprova SQL (SA1 em JOIN direto)', `erros: ${valP1.erros?.join('; ')}`);

const canonP1 = sqlParaCanonico(sqlFatAsterAnual);
assert(!canonP1.includes('SF2020') && !canonP1.includes('SD2020') && !canonP1.includes('SA1020'),
  'P1: canônico sem sufixos 020', `canonico: ${canonP1.slice(0, 200)}`);
assert(canonP1.includes('FROM SD2 SD2'), 'P1: SD2 no canônico');
assert(canonP1.includes('JOIN SF2 SF2'), 'P1: SF2 no canônico');
assert(canonP1.includes('JOIN SA1 SA1'), 'P1: SA1 no canônico');

const sqlP1J2A = adaptarSqlCanonicoPorSX2(canonP1, sx2J2A, { logPrefix: 'P1-J2A' });
assert(sqlP1J2A.includes('SD2990') && sqlP1J2A.includes('SF2990') && sqlP1J2A.includes('SA1990'),
  'P1 J2A: suffixos 990 corretos', `sql: ${sqlP1J2A.slice(0, 200)}`);

const sqlP1C3I = adaptarSqlCanonicoPorSX2(canonP1, sx2C3I, { logPrefix: 'P1-C3I' });
assert(sqlP1C3I.includes('SD2020') && sqlP1C3I.includes('SF2020') && sqlP1C3I.includes('SA1020'),
  'P1 C3I: suffixos 020 corretos');

// ═══════════════════════════════════════════════════════════════════
// P1b — Multi-turn: "Agora detalhe por mes"
// Herda cliente=ASTER + periodo=2026, adiciona GROUP BY mes
// Usa tabela derivada com UNION ALL (para incluir devolucoes) + JOIN SA1 externo
// ═══════════════════════════════════════════════════════════════════
titulo('P1b — Multi-turn: detalhe por mes (UNION ALL + JOIN SA1 externo = Bug 5 fix)');

// A IA pode gerar um padrão com UNION ALL de NF + devolução + JOIN SA1 no externo.
// Antes do Bug 5 fix, SA1.A1_NOME no GROUP BY externo disparava falso positivo.
const sqlFatAsterPorMes = `SET ROWCOUNT 50000;
SELECT
  YEAR(CONVERT(DATE, BASE.emissao, 112))    AS ano,
  MONTH(CONVERT(DATE, BASE.emissao, 112))   AS mes,
  SA1.A1_COD                                AS cod_cliente,
  SA1.A1_NOME                               AS nome_cliente,
  COALESCE(SUM(BASE.faturamento), 0)        AS faturamento_total,
  COALESCE(SUM(BASE.devolucao), 0)          AS total_devolucao,
  COALESCE(SUM(BASE.faturamento), 0) - COALESCE(SUM(BASE.devolucao), 0) AS faturamento_liquido
FROM (
  SELECT
    SD2.D2_CLIENTE   AS cod_cliente,
    SF2.F2_EMISSAO   AS emissao,
    SD2.D2_TOTAL     AS faturamento,
    0                AS devolucao
  FROM SD2020 SD2
  JOIN SF2020 SF2
    ON SD2.D2_DOC    = SF2.F2_DOC
   AND SD2.D2_SERIE  = SF2.F2_SERIE
   AND SD2.D2_FILIAL = SF2.F2_FILIAL
   AND SF2.D_E_L_E_T_ = ' '
  WHERE SD2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SF2.F2_EMISSAO BETWEEN '20260101' AND '20261231'
  UNION ALL
  SELECT
    SD1.D1_CLIENTE   AS cod_cliente,
    SF1.F1_EMISSAO   AS emissao,
    0                AS faturamento,
    SD1.D1_TOTAL     AS devolucao
  FROM SD1020 SD1
  JOIN SF1020 SF1
    ON SD1.D1_DOC    = SF1.F1_DOC
   AND SD1.D1_SERIE  = SF1.F1_SERIE
   AND SD1.D1_FILIAL = SF1.F1_FILIAL
   AND SF1.D_E_L_E_T_ = ' '
  WHERE SD1.D_E_L_E_T_ = ' '
    AND SF1.F1_TIPO = 'D'
    AND SF1.F1_EMISSAO BETWEEN '20260101' AND '20261231'
) BASE
JOIN SA1020 SA1
  ON BASE.cod_cliente = SA1.A1_COD
 AND SA1.D_E_L_E_T_ = ' '
WHERE SA1.A1_NOME LIKE '%ASTER%'
GROUP BY
  YEAR(CONVERT(DATE, BASE.emissao, 112)),
  MONTH(CONVERT(DATE, BASE.emissao, 112)),
  SA1.A1_COD,
  SA1.A1_NOME
ORDER BY ano, mes`;

const valP1b = validarSqlIaOwnerBasico(sqlFatAsterPorMes);
console.log('\n[Validação P1b]', JSON.stringify(valP1b));

assert(valP1b.ok,
  'P1b: validador aprova SQL com UNION ALL + JOIN SA1 externo (Bug 5 fix)',
  `erros: ${valP1b.erros?.join('; ')}`);

const canonP1b = sqlParaCanonico(sqlFatAsterPorMes);
const sufixosP1b = canonP1b.match(/\b[A-Z]{2,4}(020|990|010|030)\b/g) || [];
assert(sufixosP1b.length === 0, 'P1b: canônico sem sufixos', `encontrados: ${sufixosP1b.join(', ')}`);
assert(canonP1b.includes('JOIN SA1 SA1'), 'P1b: SA1 no canônico (JOIN externo preservado)');

const sqlP1bJ2A = adaptarSqlCanonicoPorSX2(canonP1b, sx2J2A, { logPrefix: 'P1b-J2A' });
assert(sqlP1bJ2A.includes('SA1990'), 'P1b J2A: SA1990 no SQL final');
assert(sqlP1bJ2A.includes('SF2990') && sqlP1bJ2A.includes('SD2990'), 'P1b J2A: SF2990+SD2990 corretos');
assert(sqlP1bJ2A.includes('SF1990') && sqlP1bJ2A.includes('SD1990'), 'P1b J2A: SF1990+SD1990 (devolução) corretos');
assert(!sqlP1bJ2A.includes('SA1020') && !sqlP1bJ2A.includes('SF2020'), 'P1b J2A: sem contaminação 020');

// ═══════════════════════════════════════════════════════════════════
// P2 — Compras do fornecedor Softexpert no ano de 2026
// SC7 + SA2, filtro por A2_NOME LIKE '%SOFTEXPERT%'
// ═══════════════════════════════════════════════════════════════════
titulo('P2 — Compras fornecedor Softexpert 2026 (SC7 JOIN SA2, sem subquery)');

const sqlComprasSoftAnual = `SET ROWCOUNT 50000;
SELECT
  SA2.A2_COD                        AS cod_fornecedor,
  SA2.A2_NOME                       AS nome_fornecedor,
  COALESCE(SUM(SC7.C7_TOTAL), 0)    AS total_compras,
  COUNT(DISTINCT SC7.C7_NUM)        AS qtd_pedidos
FROM SC7020 SC7
JOIN SA2020 SA2
  ON SC7.C7_FORNECE = SA2.A2_COD
 AND SA2.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_EMISSAO BETWEEN '20260101' AND '20261231'
  AND SA2.A2_NOME LIKE '%SOFTEXPERT%'
GROUP BY SA2.A2_COD, SA2.A2_NOME
ORDER BY total_compras DESC`;

const valP2 = validarSqlIaOwnerBasico(sqlComprasSoftAnual);
console.log('\n[Validação P2]', JSON.stringify(valP2));

assert(valP2.ok, 'P2: validador aprova SQL compras fornecedor', `erros: ${valP2.erros?.join('; ')}`);

const canonP2 = sqlParaCanonico(sqlComprasSoftAnual);
assert(!canonP2.includes('SC7020') && !canonP2.includes('SA2020'), 'P2: canônico sem sufixos');
assert(canonP2.includes('FROM SC7 SC7'), 'P2: SC7 no canônico');
assert(canonP2.includes('JOIN SA2 SA2'), 'P2: SA2 no canônico');

const sqlP2J2A = adaptarSqlCanonicoPorSX2(canonP2, sx2J2A, { logPrefix: 'P2-J2A' });
assert(sqlP2J2A.includes('SC7990') && sqlP2J2A.includes('SA2990'),
  'P2 J2A: SC7990+SA2990 corretos');
assert(!sqlP2J2A.includes('SC7020') && !sqlP2J2A.includes('SA2020'),
  'P2 J2A: sem sufixo 020');

// ═══════════════════════════════════════════════════════════════════
// P2b — Multi-turn: "Agora me detalhe por mes"
// Herda fornecedor=Softexpert + periodo=2026, GROUP BY mes
// Usa tabela derivada + JOIN SA2 externo (mesmo padrão Bug 5)
// ═══════════════════════════════════════════════════════════════════
titulo('P2b — Multi-turn compras por mes (FROM (...) AS BASE JOIN SA2 externo = Bug 5 fix)');

const sqlComprasSoftPorMes = `SET ROWCOUNT 50000;
SELECT
  YEAR(CONVERT(DATE, BASE.emissao, 112))   AS ano,
  MONTH(CONVERT(DATE, BASE.emissao, 112))  AS mes,
  SA2.A2_COD                               AS cod_fornecedor,
  SA2.A2_NOME                              AS nome_fornecedor,
  COALESCE(SUM(BASE.total_compras), 0)     AS total_compras,
  COUNT(BASE.num_pedido)                   AS qtd_pedidos
FROM (
  SELECT
    SC7.C7_FORNECE  AS cod_fornecedor,
    SC7.C7_EMISSAO  AS emissao,
    SC7.C7_TOTAL    AS total_compras,
    SC7.C7_NUM      AS num_pedido
  FROM SC7020 SC7
  WHERE SC7.D_E_L_E_T_ = ' '
    AND SC7.C7_EMISSAO BETWEEN '20260101' AND '20261231'
) BASE
JOIN SA2020 SA2
  ON BASE.cod_fornecedor = SA2.A2_COD
 AND SA2.D_E_L_E_T_ = ' '
WHERE SA2.A2_NOME LIKE '%SOFTEXPERT%'
GROUP BY
  YEAR(CONVERT(DATE, BASE.emissao, 112)),
  MONTH(CONVERT(DATE, BASE.emissao, 112)),
  SA2.A2_COD,
  SA2.A2_NOME
ORDER BY ano, mes`;

const valP2b = validarSqlIaOwnerBasico(sqlComprasSoftPorMes);
console.log('\n[Validação P2b]', JSON.stringify(valP2b));

assert(valP2b.ok,
  'P2b: validador aprova SQL com FROM (...) + JOIN SA2 externo (Bug 5 fix)',
  `erros: ${valP2b.erros?.join('; ')}`);

const canonP2b = sqlParaCanonico(sqlComprasSoftPorMes);
const sufixosP2b = canonP2b.match(/\b[A-Z]{2,4}(020|990|010|030)\b/g) || [];
assert(sufixosP2b.length === 0, 'P2b: canônico sem sufixos', `encontrados: ${sufixosP2b.join(', ')}`);
assert(canonP2b.includes('JOIN SA2 SA2'), 'P2b: SA2 no canônico (JOIN externo)');

const sqlP2bJ2A = adaptarSqlCanonicoPorSX2(canonP2b, sx2J2A, { logPrefix: 'P2b-J2A' });
assert(sqlP2bJ2A.includes('SC7990') && sqlP2bJ2A.includes('SA2990'),
  'P2b J2A: SC7990+SA2990 presentes');
assert(!sqlP2bJ2A.includes('SC7020'), 'P2b J2A: sem contaminação C3I');

const sqlP2bC3I = adaptarSqlCanonicoPorSX2(canonP2b, sx2C3I, { logPrefix: 'P2b-C3I' });
assert(sqlP2bC3I.includes('SC7020') && sqlP2bC3I.includes('SA2020'),
  'P2b C3I: SC7020+SA2020 presentes');
assert(!sqlP2bC3I.includes('SC7990'), 'P2b C3I: sem contaminação J2A');

// ═══════════════════════════════════════════════════════════════════
// P3 — Faturamento da empresa Softexpert detalhado por mes
// Filtro por SA1.A1_NOME LIKE '%SOFTEXPERT%' + GROUP BY mes
// Com UNION ALL (NF + devolução) + JOIN SA1 externo
// ═══════════════════════════════════════════════════════════════════
titulo('P3 — Faturamento empresa Softexpert por mes (UNION ALL + JOIN SA1 externo)');

const sqlFatSoftPorMes = `SET ROWCOUNT 50000;
SELECT
  SUBSTRING(BASE.emissao, 1, 6)             AS mes_ano,
  SA1.A1_COD                                AS cod_cliente,
  SA1.A1_NOME                               AS nome_cliente,
  COALESCE(SUM(BASE.faturamento), 0)        AS faturamento_bruto,
  COALESCE(SUM(BASE.devolucao), 0)          AS valor_devolucao,
  COALESCE(SUM(BASE.faturamento), 0) - COALESCE(SUM(BASE.devolucao), 0) AS faturamento_liquido
FROM (
  SELECT
    SD2.D2_CLIENTE   AS cod_cliente,
    SF2.F2_EMISSAO   AS emissao,
    SD2.D2_TOTAL     AS faturamento,
    0                AS devolucao
  FROM SD2020 SD2
  JOIN SF2020 SF2
    ON SD2.D2_DOC    = SF2.F2_DOC
   AND SD2.D2_SERIE  = SF2.F2_SERIE
   AND SD2.D2_FILIAL = SF2.F2_FILIAL
   AND SF2.D_E_L_E_T_ = ' '
  WHERE SD2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SF2.F2_EMISSAO BETWEEN '20260101' AND '20261231'
  UNION ALL
  SELECT
    SD1.D1_CLIENTE   AS cod_cliente,
    SF1.F1_EMISSAO   AS emissao,
    0                AS faturamento,
    SD1.D1_TOTAL     AS devolucao
  FROM SD1020 SD1
  JOIN SF1020 SF1
    ON SD1.D1_DOC    = SF1.F1_DOC
   AND SD1.D1_SERIE  = SF1.F1_SERIE
   AND SD1.D1_FILIAL = SF1.F1_FILIAL
   AND SF1.D_E_L_E_T_ = ' '
  WHERE SD1.D_E_L_E_T_ = ' '
    AND SF1.F1_TIPO = 'D'
    AND SF1.F1_EMISSAO BETWEEN '20260101' AND '20261231'
) BASE
JOIN SA1020 SA1
  ON BASE.cod_cliente = SA1.A1_COD
 AND SA1.D_E_L_E_T_ = ' '
WHERE SA1.A1_NOME LIKE '%SOFTEXPERT%'
GROUP BY
  SUBSTRING(BASE.emissao, 1, 6),
  SA1.A1_COD,
  SA1.A1_NOME
ORDER BY mes_ano`;

const valP3 = validarSqlIaOwnerBasico(sqlFatSoftPorMes);
console.log('\n[Validação P3]', JSON.stringify(valP3));

assert(valP3.ok,
  'P3: validador aprova faturamento empresa Softexpert por mes (Bug 5 fix)',
  `erros: ${valP3.erros?.join('; ')}`);

const canonP3 = sqlParaCanonico(sqlFatSoftPorMes);
const sufixosP3 = canonP3.match(/\b[A-Z]{2,4}(020|990|010|030)\b/g) || [];
assert(sufixosP3.length === 0, 'P3: canônico sem sufixos', `encontrados: ${sufixosP3.join(', ')}`);
assert(canonP3.includes('JOIN SA1 SA1'), 'P3: SA1 no canônico');
assert(canonP3.includes('JOIN SF2 SF2') && canonP3.includes('JOIN SF1 SF1'), 'P3: SF2+SF1 no canônico');

const sqlP3J2A = adaptarSqlCanonicoPorSX2(canonP3, sx2J2A, { logPrefix: 'P3-J2A' });
assert(sqlP3J2A.includes('SA1990') && sqlP3J2A.includes('SF2990') && sqlP3J2A.includes('SF1990'),
  'P3 J2A: SA1990+SF2990+SF1990 presentes');
assert(!sqlP3J2A.includes('SA1020') && !sqlP3J2A.includes('SF2020'),
  'P3 J2A: sem contaminação 020');

// ═══════════════════════════════════════════════════════════════════
// P3 — WhatsApp formatting para faturamento por mes com devolucao
// ═══════════════════════════════════════════════════════════════════
titulo('P3 — WhatsApp formatting: faturamento_bruto, valor_devolucao, faturamento_liquido');

const rowsP3Wpp = [
  { mes_ano: '202601', cod_cliente: '000001', nome_cliente: 'SOFTEXPERT S.A.', faturamento_bruto: 125000.00, valor_devolucao: 3500.00, faturamento_liquido: 121500.00 },
  { mes_ano: '202602', cod_cliente: '000001', nome_cliente: 'SOFTEXPERT S.A.', faturamento_bruto: 98000.50,  valor_devolucao: 1200.00, faturamento_liquido: 96800.50  },
  { mes_ano: '202603', cod_cliente: '000001', nome_cliente: 'SOFTEXPERT S.A.', faturamento_bruto: 142000.00, valor_devolucao: 0,       faturamento_liquido: 142000.00 },
];

console.log('\n[WhatsApp — P3 Faturamento Softexpert por mês]');
console.log('─'.repeat(68));
const wppP3 = _formatarFallback(rowsP3Wpp, 'Faturamento empresa Softexpert por mes 2026');
console.log(wppP3);

assert(wppP3.includes('*faturamento_bruto:') || wppP3.includes('faturamento_bruto: *'),
  'P3 WhatsApp: faturamento_bruto em negrito BRL');
assert(wppP3.includes('*valor_devolucao:') || wppP3.includes('valor_devolucao: *'),
  'P3 WhatsApp: valor_devolucao em negrito BRL');
assert(wppP3.includes('*faturamento_liquido:') || wppP3.includes('faturamento_liquido: *'),
  'P3 WhatsApp: faturamento_liquido em negrito BRL');
assert(!wppP3.includes('125000'), 'P3 WhatsApp: sem número bruto 125000');
assert(wppP3.includes('SOFTEXPERT'), 'P3 WhatsApp: nome_cliente presente');

// ═══════════════════════════════════════════════════════════════════
// Validação de que SA1 DENTRO do subquery ainda é flagrado (falso negativo não criado)
// ═══════════════════════════════════════════════════════════════════
titulo('REGRESSÃO — SA1 dentro da subquery e referenciado fora DEVE ser rejeitado');

const sqlRegressa = `SET ROWCOUNT 50000;
SELECT BASE.cod_cliente, SA1.A1_NOME
FROM (
  SELECT SD2.D2_CLIENTE AS cod_cliente, SA1.A1_NOME AS nome
  FROM SD2020 SD2
  JOIN SA1020 SA1 ON SD2.D2_CLIENTE = SA1.A1_COD AND SA1.D_E_L_E_T_ = ' '
  WHERE SD2.D_E_L_E_T_ = ' '
) BASE
GROUP BY BASE.cod_cliente, SA1.A1_NOME`;

const valReg = validarSqlIaOwnerBasico(sqlRegressa);
console.log('\n[Validação REGRESSÃO]', JSON.stringify(valReg));

assert(!valReg.ok,
  'REGRESSÃO: SA1 referenciado fora da subquery SEM JOIN externo DEVE ser rejeitado',
  `ok=${valReg.ok} — esperado false (violação de escopo)`);
assert((valReg.erros || []).some(e => /SA1|escopo|subquery/i.test(e)),
  'REGRESSÃO: erro menciona SA1/escopo',
  `erros: ${valReg.erros?.join('; ')}`);

// ═══════════════════════════════════════════════════════════════════
// Resultado final
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(68)}`);
console.log(`  RESULTADO MULTI-TURN: ${passed} passaram, ${failed} falharam`);
console.log('═'.repeat(68));

process.exit(failed > 0 ? 1 : 0);
