'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const normalizer = require(path.join(ROOT, 'modules/erp/totvs_protheus/SX/lobo-guara-normalizer'));
function assertNaoContem(sql, trecho, mensagem) {
  assert.strictEqual(sql.includes(trecho), false, mensagem || `nao deve conter ${trecho}`);
}

const sqlFaturamentoComCadastrosCompartilhados = `
SET ROWCOUNT 10000;
SELECT SA1.A1_NOME AS cliente,
       SB1.B1_DESC AS produto,
       COALESCE(SUM(SD2.D2_QUANT - SD2.D2_QTDEDEV), 0) AS quantidade_carregada_liquida
FROM SD2010 SD2
JOIN SF2010 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC
JOIN SA1010 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '
JOIN SB1010 SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
JOIN SF4010 SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S'
WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' '
GROUP BY SA1.A1_NOME, SB1.B1_DESC
ORDER BY quantidade_carregada_liquida DESC;
`;

const aliasesFaturamento = {
  SD2: 'SD2',
  SF2: 'SF2',
  SA1: 'SA1',
  SB1: 'SB1',
  SF4: 'SF4',
};

const sx2Faturamento = {
  SD2010: 'E',
  SF2010: 'E',
  SA1010: 'C',
  SB1010: 'C',
  SF4010: 'C',
};

const escopoFiliais = ['0100', '0101', '0102'];

const filtrado = normalizer._injetarFiltroFilial(
  sqlFaturamentoComCadastrosCompartilhados,
  aliasesFaturamento,
  sx2Faturamento,
  null,
  escopoFiliais,
  null,
);

assert.strictEqual(filtrado.aplicado, true, 'deve aplicar filtro apenas nas tabelas exclusivas por filial');
assert(filtrado.sql.includes("SD2.D2_FILIAL IN ('0100', '0101', '0102')"), 'SD2 deve filtrar pelas filiais selecionadas');
assert(filtrado.sql.includes("SF2.F2_FILIAL IN ('0100', '0101', '0102')"), 'SF2 deve filtrar pelas filiais selecionadas');
assertNaoContem(filtrado.sql, 'SA1.A1_FILIAL IN', 'SA1 compartilhada nao pode receber filtro de filial');
assertNaoContem(filtrado.sql, 'SB1.B1_FILIAL IN', 'SB1 compartilhada nao pode receber filtro de filial');
assertNaoContem(filtrado.sql, 'SF4.F4_FILIAL IN', 'SF4 compartilhada nao pode receber filtro de filial');

const desconhecida = normalizer._injetarFiltroFilial(
  "SELECT SB1.B1_DESC FROM SB1010 SB1 WHERE SB1.D_E_L_E_T_ = ' '",
  { SB1: 'SB1' },
  null,
  null,
  escopoFiliais,
  null,
);

assert.strictEqual(desconhecida.aplicado, false, 'sem SX2 real, nao deve filtrar por filial por fallback');
assertNaoContem(desconhecida.sql, 'SB1.B1_FILIAL IN', 'tabela sem SX2 real nao pode receber filtro de filial');

const movimentaisSemSx2 = normalizer._injetarFiltroFilial(
  `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS faturamento
FROM SD2010 SD2
JOIN SF2010 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL
WHERE SUBSTRING(SF2.F2_EMISSAO, 1, 8) = '20260914'
  AND SF2.F2_TIPO = 'N'
  AND SD2.D_E_L_E_T_ = ' '
  AND SF2.D_E_L_E_T_ = ' ';
`,
  { SD2: 'SD2', SF2: 'SF2' },
  null,
  null,
  escopoFiliais,
  null,
);

assert.strictEqual(movimentaisSemSx2.aplicado, true, 'movimentais sem SX2 devem aceitar recorte manual de filial');
assert(movimentaisSemSx2.sql.includes("SD2.D2_FILIAL IN ('0100', '0101', '0102')"), 'SD2 sem SX2 deve filtrar por filial');
assert(movimentaisSemSx2.sql.includes("SF2.F2_FILIAL IN ('0100', '0101', '0102')"), 'SF2 sem SX2 deve filtrar por filial');

const escopoCompletoSemSx2 = normalizer.aplicarEscopoLoboGuara(
  `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS faturamento
FROM SD2010 SD2
JOIN SF2010 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL
WHERE SUBSTRING(SF2.F2_EMISSAO, 1, 8) = '20260914'
  AND SF2.F2_TIPO = 'N'
  AND SD2.D_E_L_E_T_ = ' '
  AND SF2.D_E_L_E_T_ = ' ';
`,
  {
    db: {},
    ctx: { connectionId: 123 },
    sx2: null,
    sx2Empresa: null,
    filialState: { modo: 'especifica', chaves: escopoFiliais },
  },
);

assert.strictEqual(escopoCompletoSemSx2.aplicado, true, 'normalizador completo deve aplicar escopo em SD2/SF2 sem SX2');
assert.strictEqual(escopoCompletoSemSx2.motivo, null, 'normalizador completo nao deve retornar nenhuma_tabela_aceitou_filtro');
assert(escopoCompletoSemSx2.sql.includes("SD2.D2_FILIAL IN ('0100', '0101', '0102')"), 'normalizador completo deve filtrar SD2');
assert(escopoCompletoSemSx2.sql.includes("SF2.F2_FILIAL IN ('0100', '0101', '0102')"), 'normalizador completo deve filtrar SF2');

const exclusivaPorEmpresa = normalizer._injetarFiltroFilial(
  "SELECT SA1.A1_NOME FROM SA1010 SA1 WHERE SA1.D_E_L_E_T_ = ' '",
  { SA1: 'SA1' },
  { SA1010: 'C' },
  { SA1010: 'E' },
  escopoFiliais,
  ['01'],
);

assert.strictEqual(exclusivaPorEmpresa.aplicado, true, 'tabela exclusiva por empresa deve receber codigo de empresa curto');
assert(exclusivaPorEmpresa.sql.includes("SA1.A1_FILIAL IN ('01')"), 'SA1 exclusiva por empresa deve usar codigo de empresa, nao filial completa');
assertNaoContem(exclusivaPorEmpresa.sql, "'0100'", 'filtro por empresa nao deve usar filial completa');

const todasCompartilhadas = normalizer._injetarFiltroFilial(
  "SELECT SA1.A1_NOME, SB1.B1_DESC FROM SA1010 SA1 JOIN SB1010 SB1 ON SB1.B1_COD = SA1.A1_COD WHERE SA1.D_E_L_E_T_ = ' '",
  { SA1: 'SA1', SB1: 'SB1' },
  { SA1010: 'C', SB1010: 'C' },
  null,
  escopoFiliais,
  null,
);

assert.strictEqual(todasCompartilhadas.aplicado, false, 'se todas as tabelas sao compartilhadas, nao deve injetar filtro de filial');
assertNaoContem(todasCompartilhadas.sql, '_FILIAL IN', 'nenhum filtro de filial deve ser criado em tabelas compartilhadas');

console.log('lobo-guara-sx2-filial-scope.test.js: ok');
