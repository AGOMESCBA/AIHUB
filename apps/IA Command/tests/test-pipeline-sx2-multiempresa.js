'use strict';

/**
 * Teste direto do pipeline SX2 para os dois cenários de bug reportados.
 *
 * Roda com: node tests/test-pipeline-sx2-multiempresa.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const {
  sqlParaCanonico,
  adaptarSqlCanonicoPorSX2,
  normalizarTabelasPorAliasSX2,
  aliasTabelaSql,
} = require(path.join(ROOT, 'modules/erp/totvs_protheus/SX/sx2-sql-normalizer'));

let passed = 0;
let failed = 0;

function assert(condicao, descricao, detalhes = '') {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
    passed++;
  } else {
    console.error(`  ✗ FALHA: ${descricao}`);
    if (detalhes) console.error(`    ${detalhes}`);
    failed++;
  }
}

function titulo(t) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${t}`);
  console.log('─'.repeat(60));
}

// ─────────────────────────────────────────────────────────────
// CENÁRIO 1: Saldos bancários (SE8 + SA6 + CTE saldo_recente)
// SQL como gerado pela IA para C3I (sufixo 020)
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 1 — Saldos bancários (SE8 CTE + SA6)');

const sqlSaldosC3I = `SET ROWCOUNT 50000;
WITH saldo_recente AS (
  SELECT SE8.E8_BANCO, SE8.E8_AGENCIA, SE8.E8_CONTA,
         SE8.E8_DTSALAT, SE8.E8_SALATUA,
         ROW_NUMBER() OVER (PARTITION BY SE8.E8_BANCO, SE8.E8_AGENCIA, SE8.E8_CONTA
                            ORDER BY SE8.E8_DTSALAT DESC) AS RN
  FROM SE8020 SE8
  WHERE SE8.D_E_L_E_T_ = ' '
    AND SE8.E8_BANCO != 'CX1'
)
SELECT
  SR.E8_BANCO AS banco,
  SA6.A6_NOME AS banco_nome,
  SR.E8_AGENCIA AS agencia,
  SR.E8_CONTA AS conta,
  CONVERT(VARCHAR(10), SR.E8_DTSALAT, 103) AS data,
  SR.E8_SALATUA AS saldo
FROM saldo_recente SR
JOIN SA6020 SA6 ON SR.E8_BANCO = SA6.A6_COD AND SA6.D_E_L_E_T_ = ' '
WHERE SR.RN = 1
  AND SR.E8_SALATUA > 0
ORDER BY SR.E8_BANCO, SR.E8_AGENCIA, SR.E8_CONTA, SR.E8_DTSALAT`;

// Step 1: sqlParaCanonico — deve manter aliases do CTE, strip SA6020→SA6, SE8020→SE8
const sqlCanonico = sqlParaCanonico(sqlSaldosC3I);

console.log('\n[sqlParaCanonico output]');
console.log(sqlCanonico);

assert(
  !sqlCanonico.includes('SE8020') && sqlCanonico.includes('FROM SE8'),
  'SE8020 → SE8 no sqlParaCanonico (dentro do CTE)',
  `Contém SE8020: ${sqlCanonico.includes('SE8020')}`
);

assert(
  !sqlCanonico.includes('SA6020') && sqlCanonico.includes('SA6 SA6'),
  'SA6020 → SA6 no sqlParaCanonico',
  `Contém SA6020: ${sqlCanonico.includes('SA6020')}`
);

assert(
  sqlCanonico.includes('saldo_recente SR'),
  'CTE "saldo_recente" preservado como alias no JOIN (não substituído)',
);

assert(
  !sqlCanonico.includes('SE8990') && !sqlCanonico.includes('SA6990'),
  'Nenhum sufixo 990 no canônico (ainda não adaptado)',
);

// Step 2: adaptarSqlCanonicoPorSX2 para J2A (SX2 com sufixo 990)
const sx2J2A = { SE8990: 'E', SA6990: 'E' };
const sqlJ2A = adaptarSqlCanonicoPorSX2(sqlCanonico, sx2J2A, { logPrefix: 'TEST-J2A', sufixoFallback: '990' });

console.log('\n[adaptarSqlCanonicoPorSX2 para J2A (990) output]');
console.log(sqlJ2A);

assert(
  sqlJ2A.includes('SE8990') && !sqlJ2A.includes('FROM SE8 SE8') && !sqlJ2A.includes('FROM SE8020'),
  'J2A: SE8 → SE8990 re-adicionado corretamente',
  `SE8990 presente: ${sqlJ2A.includes('SE8990')}`
);

assert(
  sqlJ2A.includes('SA6990') && !sqlJ2A.includes('SA6020'),
  'J2A: SA6 → SA6990 re-adicionado corretamente (BUG 3 FIX)',
  `SA6990 presente: ${sqlJ2A.includes('SA6990')}`
);

assert(
  sqlJ2A.includes('saldo_recente SR'),
  'J2A: CTE "saldo_recente" não foi substituído por tabela física (BUG 2 FIX)',
);

assert(
  !sqlJ2A.includes('SE8020') && !sqlJ2A.includes('SA6020'),
  'J2A: Nenhum sufixo 020 (da C3I) no SQL final da J2A',
);

// Step 3: adaptarSqlCanonicoPorSX2 para C3I (SX2 com sufixo 020)
const sx2C3I = { SE8020: 'E', SA6020: 'E' };
const sqlC3IReconst = adaptarSqlCanonicoPorSX2(sqlCanonico, sx2C3I, { logPrefix: 'TEST-C3I', sufixoFallback: '020' });

assert(
  sqlC3IReconst.includes('SE8020') && sqlC3IReconst.includes('SA6020'),
  'C3I: SE8 → SE8020 e SA6 → SA6020 re-adicionados corretamente',
);

assert(
  !sqlC3IReconst.includes('SE8990') && !sqlC3IReconst.includes('SA6990'),
  'C3I: Nenhum sufixo 990 (da J2A) no SQL final da C3I',
);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 2: Query cross-module (SF2 + SC7/SD1) — sem CTEs
// Comparativo faturamento x compras (sem CTE, tabelas diretas)
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 2 — Cross-module Faturamento x Compras (SF2 + SC7)');

const sqlCrossC3I = `SET ROWCOUNT 50000;
SELECT
  (SELECT COALESCE(SUM(SF2.F2_VALBRUT), 0)
   FROM SF2020 SF2
   WHERE SF2.D_E_L_E_T_ = ' '
     AND SF2.F2_TIPO = 'N'
     AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531') AS faturamento_mai,
  (SELECT COALESCE(SUM(SC7.C7_TOTAL), 0)
   FROM SC7020 SC7
   WHERE SC7.D_E_L_E_T_ = ' '
     AND SC7.C7_EMISSAO BETWEEN '20260501' AND '20260531') AS compras_mai`;

const sqlCrossCanonico = sqlParaCanonico(sqlCrossC3I);

console.log('\n[sqlParaCanonico cross-module output]');
console.log(sqlCrossCanonico);

assert(
  !sqlCrossCanonico.includes('SF2020') && sqlCrossCanonico.includes('FROM SF2 SF2'),
  'SF2020 → SF2 no canônico',
);

assert(
  !sqlCrossCanonico.includes('SC7020') && sqlCrossCanonico.includes('FROM SC7 SC7'),
  'SC7020 → SC7 no canônico',
);

// Adaptar para J2A
const sx2J2ACompleto = { SE8990: 'E', SA6990: 'E', SF2990: 'E', SC7990: 'E', SA1990: 'E', SA2990: 'E' };
const sqlCrossJ2A = adaptarSqlCanonicoPorSX2(sqlCrossCanonico, sx2J2ACompleto, { logPrefix: 'TEST-CROSS-J2A' });

console.log('\n[adaptarSqlCanonicoPorSX2 cross-module J2A]');
console.log(sqlCrossJ2A);

assert(
  sqlCrossJ2A.includes('SF2990') && !sqlCrossJ2A.includes('SF2020'),
  'J2A cross: SF2 → SF2990',
);

assert(
  sqlCrossJ2A.includes('SC7990') && !sqlCrossJ2A.includes('SC7020'),
  'J2A cross: SC7 → SC7990',
);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 3: normalizarTabelasPorAliasSX2 com CTE
// Garante que CTE "saldo_recente" com alias SE8 não é substituído
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 3 — normalizarTabelasPorAliasSX2 guarda contra CTE');

const sqlComCTEWrong = `WITH saldo_recente AS (SELECT * FROM SE8990 SE8 WHERE SE8.D_E_L_E_T_ = ' ')
SELECT * FROM saldo_recente SE8`;

// Aqui SE8 como alias de saldo_recente é um CTE — não deve ser substituído por SE8990
const sx2Normalizar = { SE8990: 'E' };
const sqlNorm = normalizarTabelasPorAliasSX2(sqlComCTEWrong, sx2Normalizar, { logPrefix: 'TEST-NORM' });

assert(
  sqlNorm.includes('FROM saldo_recente SE8'),
  'normalizarTabelasPorAliasSX2: CTE "saldo_recente SE8" não substituído por tabela física (BUG 2 FIX)',
  `SQL resultante: ${sqlNorm}`
);

assert(
  sqlNorm.includes('FROM SE8990 SE8'),
  'normalizarTabelasPorAliasSX2: tabela física SE8990 SE8 preservada dentro do CTE',
);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 4: aliasTabelaSql — mapeamento correto com linha quebrada
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 4 — aliasTabelaSql não captura JOIN como alias');

const sqlMultilinha = `SELECT * FROM SE8020 SE8
WHERE SE8.D_E_L_E_T_ = ' '
JOIN SA6020 SA6 ON SE8.E8_BANCO = SA6.A6_COD`;

const aliases = aliasTabelaSql(sqlMultilinha);

assert(
  aliases['SE8'] === 'SE8',
  'aliasTabelaSql: SE8020 → alias SE8 = base SE8',
  `aliases: ${JSON.stringify(aliases)}`
);

assert(
  aliases['SA6'] === 'SA6',
  'aliasTabelaSql: SA6020 → alias SA6 = base SA6 (BUG 3 FIX)',
  `aliases: ${JSON.stringify(aliases)}`
);

assert(
  !aliases['JOIN'],
  'aliasTabelaSql: JOIN não é capturado como alias de tabela',
  `aliases: ${JSON.stringify(aliases)}`
);

// ─────────────────────────────────────────────────────────────
// Resultado final
// ─────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
