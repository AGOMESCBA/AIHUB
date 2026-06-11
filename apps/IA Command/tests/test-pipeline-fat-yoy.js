'use strict';

/**
 * Testa pipeline SX2 + validador + formatação WhatsApp para:
 *
 * Pergunta 1: Faturamento 2025/2026 por mês/ano (Jan-Jun) com crescimento YoY
 * Pergunta 2: Comparativo mês a mês 2025 vs 2026 com percentual de crescimento
 * Pergunta 3: Faturamento por mês 2025 e 2026 agrupado por mês e por ano,
 *             mostrando apenas Jan-Jun, com crescimento vs mesmo mês do ano anterior
 *
 * Roda com: node tests/test-pipeline-fat-yoy.js
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
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${t}`);
  console.log('─'.repeat(64));
}

const sx2C3I = { SF2020: 'E', SA1020: 'E' };
const sx2J2A = { SF2990: 'E', SA1990: 'E' };

// ─────────────────────────────────────────────────────────────
// PERGUNTA 1 — CTE auto-join com GROUP BY (Faturamento Jan-Jun YoY)
// ─────────────────────────────────────────────────────────────
titulo('PERGUNTA 1 — Faturamento Jan-Jun 2025/2026 com crescimento YoY (CTE auto-join)');

const sqlP1 = `SET ROWCOUNT 50000;
WITH fat_mensal AS (
  SELECT
    SUBSTRING(SF2.F2_EMISSAO, 1, 4)           AS ano,
    CAST(SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS INT) AS mes,
    COALESCE(SUM(SF2.F2_VALBRUT), 0)          AS total
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) IN ('2025', '2026')
    AND CAST(SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS INT) BETWEEN 1 AND 6
  GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 4), SUBSTRING(SF2.F2_EMISSAO, 5, 2)
)
SELECT
  a.ano,
  a.mes,
  a.total             AS faturamento,
  p.total             AS faturamento_ano_anterior,
  CASE WHEN p.total > 0 THEN ROUND(((a.total - p.total) / p.total) * 100, 2) ELSE NULL END AS crescimento_pct
FROM fat_mensal a
LEFT JOIN fat_mensal p ON a.mes = p.mes AND CAST(a.ano AS INT) = CAST(p.ano AS INT) + 1
ORDER BY a.ano, a.mes`;

const valP1 = validarSqlIaOwnerBasico(sqlP1);
assert(valP1.ok, 'P1: SQL com CTE + GROUP BY aprovado', `erros: ${valP1.erros?.join('; ')}`);

const canonP1 = sqlParaCanonico(sqlP1);
assert(!canonP1.includes('SF2020') && canonP1.includes('FROM SF2 SF2'), 'P1: SF2020 → SF2 no canônico');
assert(!canonP1.includes('SF2990'), 'P1: sem sufixo 990 no canônico');

const p1J2A = adaptarSqlCanonicoPorSX2(canonP1, sx2J2A, { logPrefix: 'P1-J2A' });
const p1C3I = adaptarSqlCanonicoPorSX2(canonP1, sx2C3I, { logPrefix: 'P1-C3I' });

assert(p1J2A.includes('SF2990') && !p1J2A.includes('SF2020'), 'P1 J2A: SF2990 correto');
assert(p1C3I.includes('SF2020') && !p1C3I.includes('SF2990'), 'P1 C3I: SF2020 correto');
assert(p1J2A.includes('LEFT JOIN fat_mensal p'), 'P1 J2A: auto-join do CTE preservado');
assert(p1J2A.includes('BETWEEN 1 AND 6'), 'P1 J2A: filtro Jan-Jun preservado');

// Variante bugada (sem GROUP BY no CTE)
const sqlP1Bug = `SET ROWCOUNT 50000;
WITH fat_mensal AS (
  SELECT
    SUBSTRING(SF2.F2_EMISSAO, 1, 4) AS ano,
    CAST(SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS INT) AS mes,
    SUM(SF2.F2_VALBRUT) AS total
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
)
SELECT a.ano, a.mes, a.total FROM fat_mensal a
LEFT JOIN fat_mensal p ON a.mes = p.mes AND CAST(a.ano AS INT) = CAST(p.ano AS INT) + 1
ORDER BY a.ano, a.mes`;

const valP1Bug = validarSqlIaOwnerBasico(sqlP1Bug);
assert(!valP1Bug.ok, 'P1 bugado (sem GROUP BY): rejeitado');
assert((valP1Bug.erros || []).some(e => /GROUP BY|8120/i.test(e)), 'P1 bugado: erro menciona GROUP BY/8120');

// ─────────────────────────────────────────────────────────────
// PERGUNTA 2 — FULL OUTER JOIN nos CTEs (Comparativo 2025 vs 2026)
// ─────────────────────────────────────────────────────────────
titulo('PERGUNTA 2 — Comparativo mês a mês 2025 vs 2026 com crescimento % (FULL OUTER JOIN)');

const sqlP2 = `SET ROWCOUNT 50000;
WITH fat_base AS (
  SELECT
    SUBSTRING(SF2.F2_EMISSAO, 1, 4)  AS ano,
    SUBSTRING(SF2.F2_EMISSAO, 5, 2)  AS mes,
    COALESCE(SUM(SF2.F2_VALBRUT), 0) AS total
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) IN ('2025', '2026')
  GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 4), SUBSTRING(SF2.F2_EMISSAO, 5, 2)
)
SELECT
  COALESCE(f25.mes, f26.mes) AS mes,
  COALESCE(f25.total, 0)     AS fat_2025,
  COALESCE(f26.total, 0)     AS fat_2026,
  CASE
    WHEN COALESCE(f25.total, 0) > 0
    THEN ROUND(((COALESCE(f26.total, 0) - COALESCE(f25.total, 0)) / COALESCE(f25.total, 0)) * 100, 2)
    ELSE NULL
  END AS crescimento_pct
FROM fat_base f25
FULL OUTER JOIN fat_base f26 ON f25.mes = f26.mes AND f26.ano = '2026'
WHERE f25.ano = '2025' OR f25.ano IS NULL
ORDER BY mes`;

const valP2 = validarSqlIaOwnerBasico(sqlP2);
assert(valP2.ok, 'P2: SQL com CTE + GROUP BY + FULL JOIN aprovado', `erros: ${valP2.erros?.join('; ')}`);

const canonP2 = sqlParaCanonico(sqlP2);
assert(!canonP2.includes('SF2020') && canonP2.includes('FROM SF2 SF2'), 'P2: SF2020 → SF2 no canônico');

const p2J2A = adaptarSqlCanonicoPorSX2(canonP2, sx2J2A, { logPrefix: 'P2-J2A' });
const p2C3I = adaptarSqlCanonicoPorSX2(canonP2, sx2C3I, { logPrefix: 'P2-C3I' });

assert(p2J2A.includes('SF2990') && !p2J2A.includes('SF2020'), 'P2 J2A: SF2990 correto');
assert(p2C3I.includes('SF2020') && !p2C3I.includes('SF2990'), 'P2 C3I: SF2020 correto');
assert(p2J2A.includes('FULL OUTER JOIN fat_base f26'), 'P2 J2A: FULL OUTER JOIN preservado');

// Variante com subqueries escalares (sem CTE) — agora deve passar com o fix do validador
titulo('PERGUNTA 2 — Variante: subqueries escalares por mês com VALUES table');

const sqlP2Escalar = `SET ROWCOUNT 50000;
SELECT
  mes.num AS mes,
  COALESCE((SELECT SUM(SF2.F2_VALBRUT) FROM SF2020 SF2
            WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
              AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) = '2025'
              AND SUBSTRING(SF2.F2_EMISSAO, 5, 2) = mes.str), 0) AS fat_2025,
  COALESCE((SELECT SUM(SF2.F2_VALBRUT) FROM SF2020 SF2
            WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
              AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) = '2026'
              AND SUBSTRING(SF2.F2_EMISSAO, 5, 2) = mes.str), 0) AS fat_2026
FROM (VALUES (1,'01'),(2,'02'),(3,'03'),(4,'04'),(5,'05'),(6,'06'),
             (7,'07'),(8,'08'),(9,'09'),(10,'10'),(11,'11'),(12,'12')) AS mes(num, str)
ORDER BY mes.num`;

const valP2Esc = validarSqlIaOwnerBasico(sqlP2Escalar);
assert(valP2Esc.ok, 'P2 escalar: subqueries escalares no SELECT com VALUES table → aprovado (fix _stripParenContent)',
  `erros: ${valP2Esc.erros?.join('; ')}`);

// ─────────────────────────────────────────────────────────────
// PERGUNTA 3 — Mesma estrutura de P1 (reformulada pelo usuário)
// "Faturamento por mês de 2025 e 2026, agrupado por mês e por ano,
//  mostrando apenas Jan-Jun, com crescimento vs mesmo mês do ano anterior"
// ─────────────────────────────────────────────────────────────
titulo('PERGUNTA 3 — Faturamento mês/ano 2025 e 2026 (Jan-Jun) com crescimento YoY');

// Variação com alias mais descritivo — mesma estrutura CTE auto-join
const sqlP3 = `SET ROWCOUNT 50000;
WITH faturamento AS (
  SELECT
    SUBSTRING(SF2.F2_EMISSAO, 1, 4)           AS ano,
    CAST(SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS INT) AS mes,
    COALESCE(SUM(SF2.F2_VALBRUT), 0)          AS total_faturamento
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) IN ('2025', '2026')
    AND CAST(SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS INT) BETWEEN 1 AND 6
  GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 4), SUBSTRING(SF2.F2_EMISSAO, 5, 2)
)
SELECT
  atual.ano                  AS ano,
  atual.mes                  AS mes,
  atual.total_faturamento    AS faturamento_atual,
  anterior.total_faturamento AS faturamento_anterior,
  CASE
    WHEN anterior.total_faturamento > 0
    THEN ROUND(((atual.total_faturamento - anterior.total_faturamento) / anterior.total_faturamento) * 100, 2)
    ELSE NULL
  END AS crescimento_pct
FROM faturamento atual
LEFT JOIN faturamento anterior
  ON atual.mes = anterior.mes
 AND CAST(atual.ano AS INT) = CAST(anterior.ano AS INT) + 1
WHERE atual.ano = '2026'
ORDER BY atual.ano, atual.mes`;

const valP3 = validarSqlIaOwnerBasico(sqlP3);
assert(valP3.ok, 'P3: SQL com CTE + GROUP BY + auto-join aprovado', `erros: ${valP3.erros?.join('; ')}`);

const canonP3 = sqlParaCanonico(sqlP3);
assert(!canonP3.includes('SF2020') && canonP3.includes('FROM SF2 SF2'), 'P3: SF2020 → SF2 no canônico');

const p3J2A = adaptarSqlCanonicoPorSX2(canonP3, sx2J2A, { logPrefix: 'P3-J2A' });
const p3C3I = adaptarSqlCanonicoPorSX2(canonP3, sx2C3I, { logPrefix: 'P3-C3I' });

assert(p3J2A.includes('SF2990') && !p3J2A.includes('SF2020'), 'P3 J2A: SF2990 correto');
assert(p3C3I.includes('SF2020') && !p3C3I.includes('SF2990'), 'P3 C3I: SF2020 correto');
assert(p3J2A.includes('LEFT JOIN faturamento anterior'), 'P3 J2A: CTE "faturamento" auto-join preservado');
assert(p3J2A.includes("WHERE atual.ano = '2026'"), 'P3 J2A: filtro ano 2026 preservado');

// ─────────────────────────────────────────────────────────────
// FORMATAÇÃO WHATSAPP — demo com _formatarFallback (sem chamar IA)
// ─────────────────────────────────────────────────────────────
titulo('FORMATAÇÃO WHATSAPP — Prévia do fallback formatter');

// Mock: resultado típico de Pergunta 3 (J2A)
const rowsP3 = [
  { ano: '2026', mes: 1, faturamento_atual: 850000.50,  faturamento_anterior: 720000.00,  crescimento_pct: 18.06 },
  { ano: '2026', mes: 2, faturamento_atual: 910000.00,  faturamento_anterior: 780000.50,  crescimento_pct: 16.59 },
  { ano: '2026', mes: 3, faturamento_atual: 975000.75,  faturamento_anterior: 850000.00,  crescimento_pct: 14.71 },
  { ano: '2026', mes: 4, faturamento_atual: 1020000.00, faturamento_anterior: 920000.00,  crescimento_pct: 10.87 },
  { ano: '2026', mes: 5, faturamento_atual: 1100000.25, faturamento_anterior: 980000.00,  crescimento_pct: 12.24 },
  { ano: '2026', mes: 6, faturamento_atual: null,        faturamento_anterior: 1050000.00, crescimento_pct: null  },
];

console.log('\n[WhatsApp Fallback — Pergunta 3 (J2A)]');
console.log('─'.repeat(64));
const wppP3 = _formatarFallback(
  rowsP3,
  'Faturamento por mês de 2025 e 2026, Jan-Jun, com crescimento YoY'
);
console.log(wppP3);

// Mock: resultado típico de Pergunta 2 (Comparativo 2025 vs 2026)
const rowsP2 = [
  { mes: '01', fat_2025: 720000.00,   fat_2026: 850000.50,   crescimento_pct: 18.13 },
  { mes: '02', fat_2025: 780000.50,   fat_2026: 910000.00,   crescimento_pct: 16.59 },
  { mes: '03', fat_2025: 850000.00,   fat_2026: 975000.75,   crescimento_pct: 14.71 },
  { mes: '04', fat_2025: 920000.00,   fat_2026: 1020000.00,  crescimento_pct: 10.87 },
  { mes: '05', fat_2025: 980000.00,   fat_2026: 1100000.25,  crescimento_pct: 12.27 },
  { mes: '06', fat_2025: 1050000.00,  fat_2026: null,         crescimento_pct: null  },
  { mes: '07', fat_2025: 1150000.00,  fat_2026: null,         crescimento_pct: null  },
  { mes: '08', fat_2025: 1200000.00,  fat_2026: null,         crescimento_pct: null  },
  { mes: '09', fat_2025: 1050000.00,  fat_2026: null,         crescimento_pct: null  },
  { mes: '10', fat_2025: 1100000.00,  fat_2026: null,         crescimento_pct: null  },
  { mes: '11', fat_2025: 1250000.00,  fat_2026: null,         crescimento_pct: null  },
  { mes: '12', fat_2025: 1400000.00,  fat_2026: null,         crescimento_pct: null  },
];

console.log('\n[WhatsApp Fallback — Pergunta 2 (Comparativo 2025 vs 2026)]');
console.log('─'.repeat(64));
const wppP2 = _formatarFallback(
  rowsP2,
  'Comparativo de faturamento mês a mês 2025 vs 2026 com percentual de crescimento'
);
console.log(wppP2);

assert(wppP3.includes('faturamento_atual') || wppP3.includes('faturamento'), 'WhatsApp P3: campos de faturamento presentes');
assert(wppP2.includes('fat_2025') || wppP2.includes('fat_'), 'WhatsApp P2: campos fat_2025/fat_2026 presentes');

// ─────────────────────────────────────────────────────────────
// Resultado final
// ─────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log(`  RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log('═'.repeat(64));

process.exit(failed > 0 ? 1 : 0);
