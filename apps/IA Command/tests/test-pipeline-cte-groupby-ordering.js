'use strict';

/**
 * Testes: validador de CTEs com GROUP BY (Bug 1) e ordenação de empresas (Bug 4)
 *
 * Roda com: node tests/test-pipeline-cte-groupby-ordering.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

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
// CENÁRIO 1: Validador de GROUP BY dentro de CTEs (Bug 1 fix)
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 1 — Validador: CTE com agregação sem GROUP BY (Msg 8120)');

// Importar validarSqlIaOwnerBasico do runner
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));

// SQL cross-module com CTE problemático (sem GROUP BY, com coluna não agregada)
const sqlCrossBugado = `SET ROWCOUNT 50000;
WITH faturamento_mensal AS (
  SELECT SF2.F2_EMISSAO, SUM(SF2.F2_VALBRUT) AS total_fat
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
),
compras_mensais AS (
  SELECT SC7.C7_EMISSAO, SUM(SC7.C7_TOTAL) AS total_cmp
  FROM SC7020 SC7
  WHERE SC7.D_E_L_E_T_ = ' '
)
SELECT f.F2_EMISSAO, f.total_fat, c.total_cmp
FROM faturamento_mensal f
JOIN compras_mensais c ON f.F2_EMISSAO = c.C7_EMISSAO`;

const { validarSqlIaOwnerBasico } = runner._test;
const resultadoBugado = validarSqlIaOwnerBasico(sqlCrossBugado);
console.log('\n[Validação SQL bugado]', JSON.stringify(resultadoBugado));

assert(
  !resultadoBugado.ok,
  'SQL com CTE sem GROUP BY deve ser rejeitado (BUG 1 FIX)',
  `ok=${resultadoBugado.ok}, erros=${resultadoBugado.erros?.join('; ')}`
);

assert(
  (resultadoBugado.erros || []).some(e => /GROUP BY|8120|agrega/i.test(e)),
  'Erro deve mencionar GROUP BY / agregação',
  `erros: ${resultadoBugado.erros?.join('; ')}`
);

// SQL correto com GROUP BY
const sqlCrossCorreto = `SET ROWCOUNT 50000;
WITH faturamento_mensal AS (
  SELECT SF2.F2_EMISSAO, SUM(SF2.F2_VALBRUT) AS total_fat
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
  GROUP BY SF2.F2_EMISSAO
),
compras_mensais AS (
  SELECT SC7.C7_EMISSAO, SUM(SC7.C7_TOTAL) AS total_cmp
  FROM SC7020 SC7
  WHERE SC7.D_E_L_E_T_ = ' '
  GROUP BY SC7.C7_EMISSAO
)
SELECT f.F2_EMISSAO, f.total_fat, c.total_cmp
FROM faturamento_mensal f
JOIN compras_mensais c ON f.F2_EMISSAO = c.C7_EMISSAO`;

const resultadoCorreto = validarSqlIaOwnerBasico(sqlCrossCorreto);
console.log('\n[Validação SQL correto]', JSON.stringify(resultadoCorreto));

assert(
  resultadoCorreto.ok,
  'SQL com CTEs com GROUP BY correto deve ser aprovado',
  `ok=${resultadoCorreto.ok}, erros=${resultadoCorreto.erros?.join('; ')}`
);

// SQL com subquery escalar (sem CTEs) — deve ser aprovado
const sqlSubqueryEscalar = `SET ROWCOUNT 50000;
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

const resultadoEscalar = validarSqlIaOwnerBasico(sqlSubqueryEscalar);
console.log('\n[Validação SQL subquery escalar]', JSON.stringify(resultadoEscalar));

assert(
  resultadoEscalar.ok,
  'SQL cross-module com subqueries escalares deve ser aprovado',
  `ok=${resultadoEscalar.ok}, erros=${resultadoEscalar.erros?.join('; ')}`
);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 2: Ordenação de empresas no pipeline multiempresa
// J2A (empresa_id=1, padrao=1) deve vir antes de C3I (empresa_id=2, padrao=1)
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 2 — Ordenação de empresas: J2A antes de C3I (Bug 4 fix)');

// Simular a função _ordenarEmpresasPipelineAll com o mesmo código de service.js
function ordenarEmpresasPipelineAll(empresas, principalId) {
  return [...(empresas || [])].sort((a, b) => {
    const aId = Number(a?.empresa_id || 0);
    const bId = Number(b?.empresa_id || 0);
    // 1. padrao do canal
    const padraoDiff = Number(b?.padrao || 0) - Number(a?.padrao || 0);
    if (padraoDiff) return padraoDiff;
    // 2. empresa_id crescente (ordem natural)
    if (aId !== bId) return aId - bId;
    // 3. principalId somente como último desempate
    if (principalId) {
      if (aId === principalId && bId !== principalId) return -1;
      if (bId === principalId && aId !== principalId) return 1;
    }
    return 0;
  });
}

// Cenário: ambas padrao=1, principalId=2 (C3I iniciou o serviço WhatsApp)
const empresas = [
  { empresa_id: 1, nome: 'J2A', padrao: 1 },
  { empresa_id: 2, nome: 'C3I', padrao: 1 },
];

const ordenado = ordenarEmpresasPipelineAll(empresas, 2); // principalId = C3I (id=2)
console.log('\n[Ordenação com principalId=2 (C3I)]');
console.log(ordenado.map(e => `${e.nome} (id=${e.empresa_id}, padrao=${e.padrao})`));

assert(
  ordenado[0].empresa_id === 1,
  'J2A (empresa_id=1) deve ser primeira quando ambas têm padrao=1 (BUG 4 FIX)',
  `Primeira empresa: ${ordenado[0].nome} (id=${ordenado[0].empresa_id})`
);

assert(
  ordenado[1].empresa_id === 2,
  'C3I (empresa_id=2) deve ser segunda mesmo sendo principalId',
  `Segunda empresa: ${ordenado[1].nome} (id=${ordenado[1].empresa_id})`
);

// Cenário: C3I com padrao=1, J2A com padrao=0 → C3I deve ser primeira
const empresasPadrao = [
  { empresa_id: 1, nome: 'J2A', padrao: 0 },
  { empresa_id: 2, nome: 'C3I', padrao: 1 },
];

const ordenadoPadrao = ordenarEmpresasPipelineAll(empresasPadrao, 1);
console.log('\n[Ordenação: C3I padrao=1, J2A padrao=0]');
console.log(ordenadoPadrao.map(e => `${e.nome} (id=${e.empresa_id}, padrao=${e.padrao})`));

assert(
  ordenadoPadrao[0].empresa_id === 2,
  'C3I (padrao=1) deve ser primeira quando padrao diferente',
  `Primeira empresa: ${ordenadoPadrao[0].nome}`
);

// Cenário: ambas padrao=0, principalId=2 → principalId como desempate
const empresasSemPadrao = [
  { empresa_id: 1, nome: 'J2A', padrao: 0 },
  { empresa_id: 2, nome: 'C3I', padrao: 0 },
];

const ordenadoPrincipal = ordenarEmpresasPipelineAll(empresasSemPadrao, 2);
console.log('\n[Ordenação: ambas padrao=0, principalId=2]');
console.log(ordenadoPrincipal.map(e => `${e.nome} (id=${e.empresa_id}, padrao=${e.padrao})`));

assert(
  ordenadoPrincipal[0].empresa_id === 1,
  'Sem padrao definido: empresa_id ASC deve ganhar sobre principalId (J2A primeiro)',
  `Primeira empresa: ${ordenadoPrincipal[0].nome}`
);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 3: validarCTEsDefinidaUsada — Bug 6
// CTE saldo_recente definida mas query externa usa FROM SE8020 diretamente
// Padrão real reportado: saldos bancários por banco/agência/conta/dia
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 3 — CTE definida mas query externa usa tabela física (Bug 6 fix)');

const { validarCTEsDefinidaUsada } = runner._test;

// SQL exato que gerou o bug no ambiente de produção
const sqlSaldosBugado = `SET ROWCOUNT 50000;
WITH saldo_recente AS (
  SELECT E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA, E8_SALATUA, E8_DTSALAT,
         ROW_NUMBER() OVER (PARTITION BY E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC) AS rn
  FROM SE8020 SE8
  WHERE SE8.D_E_L_E_T_ = ' '
)
SELECT SA6.A6_NOME AS banco, SE8.E8_AGENCIA, SE8.E8_CONTA,
       CONVERT(VARCHAR(10), CAST(SE8.E8_DTSALAT AS DATE), 103) AS dia,
       SUM(SE8.E8_SALATUA) AS saldo
FROM SE8020 SE8
JOIN SA6020 SA6 ON SE8.E8_BANCO = SA6.A6_COD AND SA6.D_E_L_E_T_ = ' '
WHERE SE8.rn = 1 AND SE8.E8_SALATUA > 0 AND SA6.A6_COD <> 'CX1'
GROUP BY SA6.A6_NOME, SE8.E8_AGENCIA, SE8.E8_CONTA, SE8.E8_DTSALAT
ORDER BY dia`;

const valCTEBugada = validarCTEsDefinidaUsada(sqlSaldosBugado);
console.log('\n[validarCTEsDefinidaUsada — SQL bugado]', JSON.stringify(valCTEBugada));

assert(!valCTEBugada.ok,
  'CTE saldo_recente nunca usada em FROM/JOIN deve ser rejeitada (Bug 6 fix)',
  `ok=${valCTEBugada.ok}`);
assert((valCTEBugada.erros || []).some(e => /saldo_recente/i.test(e)),
  'Erro menciona o nome da CTE não utilizada',
  `erros: ${valCTEBugada.erros?.join('; ')}`);
assert((valCTEBugada.erros || []).some(e => /FROM saldo_recente/i.test(e)),
  'Mensagem de erro orienta a usar FROM saldo_recente',
  `erros: ${valCTEBugada.erros?.join('; ')}`);

// SQL correto: query externa usa FROM saldo_recente SR
const sqlSaldosCorreto = `SET ROWCOUNT 50000;
WITH saldo_recente AS (
  SELECT SE8.E8_BANCO, SE8.E8_AGENCIA, SE8.E8_CONTA,
         SE8.E8_DTSALAT, SE8.E8_SALATUA,
         ROW_NUMBER() OVER (PARTITION BY SE8.E8_BANCO, SE8.E8_AGENCIA, SE8.E8_CONTA
                            ORDER BY SE8.E8_DTSALAT DESC) AS rn
  FROM SE8020 SE8
  WHERE SE8.D_E_L_E_T_ = ' '
)
SELECT SR.E8_BANCO AS banco, SA6.A6_NOME AS banco_nome,
       SR.E8_AGENCIA AS agencia, SR.E8_CONTA AS conta,
       CONVERT(VARCHAR(10), SR.E8_DTSALAT, 103) AS dia,
       SR.E8_SALATUA AS saldo
FROM saldo_recente SR
JOIN SA6020 SA6 ON SR.E8_BANCO = SA6.A6_COD AND SA6.D_E_L_E_T_ = ' '
WHERE SR.rn = 1 AND SR.E8_SALATUA > 0 AND SA6.A6_COD <> 'CX1'
ORDER BY SR.E8_BANCO, SR.E8_AGENCIA, SR.E8_CONTA, SR.E8_DTSALAT`;

const valCTECorreta = validarCTEsDefinidaUsada(sqlSaldosCorreto);
console.log('\n[validarCTEsDefinidaUsada — SQL correto]', JSON.stringify(valCTECorreta));

assert(valCTECorreta.ok,
  'SQL com FROM saldo_recente SR deve ser aprovado',
  `erros: ${valCTECorreta.erros?.join('; ')}`);

// Múltiplas CTEs: todas devem ser usadas
const sqlMultiCTEBugada = `SET ROWCOUNT 50000;
WITH fat_mensal AS (
  SELECT SF2.F2_EMISSAO, SUM(SF2.F2_VALBRUT) AS total
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
  GROUP BY SF2.F2_EMISSAO
),
cmp_mensal AS (
  SELECT SC7.C7_EMISSAO, SUM(SC7.C7_TOTAL) AS total
  FROM SC7020 SC7
  WHERE SC7.D_E_L_E_T_ = ' '
  GROUP BY SC7.C7_EMISSAO
)
SELECT f.F2_EMISSAO, f.total AS fat
FROM fat_mensal f`;

const valMulti = validarCTEsDefinidaUsada(sqlMultiCTEBugada);
console.log('\n[validarCTEsDefinidaUsada — multi-CTE, cmp_mensal nunca usada]', JSON.stringify(valMulti));

assert(!valMulti.ok,
  'cmp_mensal definida mas nunca referenciada deve ser rejeitada',
  `ok=${valMulti.ok}`);
assert((valMulti.erros || []).some(e => /cmp_mensal/i.test(e)),
  'Erro menciona cmp_mensal como CTE não utilizada');

// CTE usada dentro de outra CTE — deve ser OK
const sqlCTECadeada = `SET ROWCOUNT 50000;
WITH base_fat AS (
  SELECT SF2.F2_EMISSAO, SUM(SF2.F2_VALBRUT) AS total
  FROM SF2020 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
  GROUP BY SF2.F2_EMISSAO
),
fat_filtrada AS (
  SELECT * FROM base_fat WHERE total > 0
)
SELECT * FROM fat_filtrada`;

const valCadeada = validarCTEsDefinidaUsada(sqlCTECadeada);
console.log('\n[validarCTEsDefinidaUsada — CTE encadeada]', JSON.stringify(valCadeada));

assert(valCadeada.ok,
  'CTE usada dentro de outra CTE (encadeamento) deve ser aprovada',
  `erros: ${valCadeada.erros?.join('; ')}`);

// validarSqlIaOwnerBasico deve rejeitar o SQL bugado antes do SX3
const valBasicaBugada = validarSqlIaOwnerBasico(sqlSaldosBugado);
console.log('\n[validarSqlIaOwnerBasico — SQL saldos bugado]', JSON.stringify({ ok: valBasicaBugada.ok, erros: valBasicaBugada.erros?.slice(0, 2) }));

assert(!valBasicaBugada.ok,
  'validarSqlIaOwnerBasico deve rejeitar SQL com CTE não utilizada (antes do SX3)',
  `ok=${valBasicaBugada.ok}`);

// ─────────────────────────────────────────────────────────────
// Resultado final
// ─────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
