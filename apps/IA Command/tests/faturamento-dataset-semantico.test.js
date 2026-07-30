'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runner = require(path.join(ROOT, 'modules/erp/core/semantic-dataset-ai-runner'));

const camposPermitidos = ['F2_EMISSAO', 'D2_TOTAL', 'A1_NOME'];

const sqlModeloUnion = `
SET ROWCOUNT 10000;
SELECT '202506' AS competencia, SUM(SD2.D2_TOTAL) AS faturamento_total
FROM SF2020 SF2
JOIN SD2020 SD2 ON SD2.D2_DOC = SF2.F2_DOC
WHERE SF2.F2_EMISSAO BETWEEN '20250601' AND '20250630'
UNION ALL
SELECT '202507' AS competencia, SUM(SD2.D2_TOTAL) AS faturamento_total
FROM SF2020 SF2
JOIN SD2020 SD2 ON SD2.D2_DOC = SF2.F2_DOC
WHERE SF2.F2_EMISSAO BETWEEN '20250701' AND '20250731';
`;

assert.strictEqual(runner._test._temUnionTopLevel(sqlModeloUnion), true, 'dataset deve detectar UNION no SQL modelo');

const sqlDataset = `
SELECT TOP 10000 SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
`;
const estrutura = runner._test._aplicarEstruturaSqlModelo(sqlDataset, sqlModeloUnion, camposPermitidos);
assert.strictEqual(estrutura.aplicado, false, 'dataset nao deve aplicar estrutura de modelo com UNION');
assert.strictEqual(estrutura.motivo, 'modelo_union_nao_aplicado_dataset');
assert.strictEqual(estrutura.sql, sqlDataset);

const intentComparativo = {
  _mensagemOriginal: 'Compare esse resultado com julho do ano passado.',
  periodo: { tipo: 'mes', dataInicio: '20250701', dataFim: '20250731' },
  _contextoUsadoOrquestrador: {
    periodo: { tipo: 'mes', dataInicio: '20250601', dataFim: '20250630' },
  },
};

const sqlComparativoIncompleto = `
SELECT TOP 10000 '202506' AS competencia, SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
`;
const validacaoIncompleta = runner._test._validarPeriodoDataset(sqlComparativoIncompleto, 'F2_EMISSAO', intentComparativo, {});
assert.strictEqual(validacaoIncompleta.ok, false, 'dataset deve rejeitar comparativo que nao filtra periodo_base');
assert(validacaoIncompleta.erros.join(' ').includes('20250601'), 'erro deve citar periodo_base faltante');
assert(validacaoIncompleta.erros.join(' ').includes('Competencia literal 202506'), 'erro deve citar competencia literal divergente');

const sqlComparativoCorreto = `
SELECT TOP 10000 '202506' AS competencia, SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250601' AND '20250630'
UNION ALL
SELECT '202507' AS competencia, SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
`;
const validacaoCorreta = runner._test._validarPeriodoDataset(sqlComparativoCorreto, 'F2_EMISSAO', intentComparativo, {});
assert.strictEqual(validacaoCorreta.ok, true, `dataset deve aceitar comparativo correto: ${validacaoCorreta.erros.join(' | ')}`);

const sqlDatasetGroupByQuebrado = `
SELECT TOP 10000 SUBSTRING(F2_EMISSAO, 1, 6) AS competencia, COALESCE(SUM(D2_TOTAL), 0) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250601' AND '20250630'
GROUP BY SUBSTRING(F2_EMISSAO, 1, 6 UNION ALL
SELECT SUBSTRING(F2_EMISSAO, 1, 6) AS competencia, COALESCE(SUM(D2_TOTAL), 0) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
GROUP BY SUBSTRING(F2_EMISSAO, 1, 6
`;
const sqlDatasetGroupByCorrigido = runner._test._corrigirGroupBySubstringIncompleto(sqlDatasetGroupByQuebrado);
assert(sqlDatasetGroupByCorrigido.includes('GROUP BY SUBSTRING(F2_EMISSAO, 1, 6) UNION ALL'), 'dataset deve fechar SUBSTRING antes do UNION');
assert(sqlDatasetGroupByCorrigido.trim().endsWith('GROUP BY SUBSTRING(F2_EMISSAO, 1, 6)'), 'dataset deve fechar SUBSTRING no ultimo SELECT');
const validacaoSintaxeCorrigida = runner._test._validarSintaxeBasicaSqlDataset(sqlDatasetGroupByCorrigido);
assert.strictEqual(validacaoSintaxeCorrigida.ok, true, `dataset corrigido deve ter sintaxe valida: ${validacaoSintaxeCorrigida.erros.join(' | ')}`);

console.log('faturamento-dataset-semantico.test.js: ok');
