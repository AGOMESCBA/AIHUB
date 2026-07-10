'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const { combinarSpecs } = require(path.join(ROOT, 'modules/erp/cross-module-spec-combiner'));
const faturamentoSpec = require(path.join(ROOT, 'modules/erp/faturamento/faturamento-ia-owner-spec'));
const comprasSpec = require(path.join(ROOT, 'modules/erp/compras/compras-ia-owner-spec'));

const spec = combinarSpecs([faturamentoSpec, comprasSpec]);

const systemPrompt = promptBuilder.buildSystemPrompt(spec);
const perguntaComparativoJunho = 'Preciso do total das compras e do faturamento do mes de junho de 2026 comparando com o mes de junho de 2025.';
const systemPromptPerguntaComparativoJunho = promptBuilder.buildSystemPrompt(spec, { mensagem: perguntaComparativoJunho });
const posContratos = systemPrompt.indexOf('## Contratos Relacionais do Schema Protheus');
const posEscopo = systemPrompt.indexOf('## Escopo IAHub vs Entidades Cadastrais');
assert.ok(posContratos > 0, 'prompt cross-module deve incluir contratos relacionais do schema');
assert.ok(posContratos < posEscopo, 'contratos relacionais devem aparecer no inicio do prompt');
assert.ok(systemPrompt.includes('Use estes contratos como templates de escrita de JOIN para cabecalho/itens.'), 'contratos relacionais devem orientar o uso de template de JOIN');
assert.ok(systemPrompt.includes('Ao fazer JOIN entre essas tabelas, copie a estrutura completa do template correspondente.'), 'contratos relacionais devem orientar o uso da chave completa');
assert.ok(systemPrompt.includes('Nao use apenas filial, documento e serie quando o contrato tambem incluir fornecedor/cliente e loja.'), 'contratos relacionais devem remover ambiguidade sobre chave parcial');
assert.ok(systemPrompt.includes('Um JOIN de cabecalho/itens que use somente DOC/SERIE e tecnicamente incompleto'), 'contratos relacionais devem declarar incompleto o JOIN parcial por doc/serie');
assert.ok(systemPrompt.includes('AND SD1.D1_FORNECE = SF1.F1_FORNECE'), 'contrato SD1/SF1 deve incluir fornecedor');
assert.ok(systemPrompt.includes('AND SD1.D1_LOJA = SF1.F1_LOJA'), 'contrato SD1/SF1 deve incluir loja');
assert.ok(systemPrompt.includes('dono semantico das metricas'), 'prompt cross-module deve declarar dono semantico por metrica');
assert.ok(systemPrompt.includes('Aliases de faturamento (total_faturamento, faturamento, valor_faturamento, receita)'), 'prompt cross-module deve mapear aliases de faturamento');
assert.ok(systemPrompt.includes('devem usar SF2.F2_VALBRUT'), 'faturamento cross-module deve orientar SF2.F2_VALBRUT para valor sem item');
assert.ok(systemPrompt.includes('SF1/SD1 nao sao faturamento normal'), 'prompt cross-module deve impedir SF1/SD1 como faturamento normal');
assert.ok(systemPrompt.includes('compras = SD1/SF1 filtrado por SD1.D1_DTDIGIT; faturamento = SF2 filtrado por SF2.F2_EMISSAO'), 'prompt deve orientar comparativo compras x faturamento por data correta');
assert.ok(systemPromptPerguntaComparativoJunho.includes('comparativo compras x faturamento'), 'prompt classificado para pergunta real deve manter regra cross-module');

const sx2 = {
  SF2990: 'E',
  SD2990: 'E',
  SF1990: 'E',
  SD1990: 'E',
};

const sqlCanonico = `
SET ROWCOUNT 50000;
WITH Faturamento AS (
  SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia,
         COALESCE(SUM(SF2.F2_VALBRUT), 0) AS total_faturamento
  FROM SF2990 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531'
  GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)
),
Compras AS (
  SELECT SUBSTRING(SD1.D1_DTDIGIT, 1, 6) AS competencia,
         COALESCE(SUM(SD1.D1_TOTAL), 0) AS total_compras
  FROM SD1990 SD1
  INNER JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL
    AND SD1.D1_DOC = SF1.F1_DOC
    AND SD1.D1_SERIE = SF1.F1_SERIE
    AND SD1.D1_FORNECE = SF1.F1_FORNECE
    AND SD1.D1_LOJA = SF1.F1_LOJA
    AND SF1.D_E_L_E_T_ = ' '
  WHERE SD1.D_E_L_E_T_ = ' '
    AND SF1.F1_TIPO = 'N'
    AND SD1.D1_DTDIGIT BETWEEN '20260501' AND '20260531'
  GROUP BY SUBSTRING(SD1.D1_DTDIGIT, 1, 6)
),
Base AS (
  SELECT F.competencia, F.total_faturamento, COALESCE(C.total_compras, 0) AS total_compras
  FROM Faturamento F
  LEFT JOIN Compras C ON C.competencia = F.competencia
  UNION ALL
  SELECT C.competencia, 0 AS total_faturamento, C.total_compras
  FROM Compras C
  LEFT JOIN Faturamento F ON F.competencia = C.competencia
  WHERE F.competencia IS NULL
),
Consolidado AS (
  SELECT Base.competencia,
         COALESCE(SUM(Base.total_faturamento), 0) AS total_faturamento,
         COALESCE(SUM(Base.total_compras), 0) AS total_compras
  FROM Base
  GROUP BY Base.competencia
)
SELECT Consolidado.competencia,
       Consolidado.total_faturamento,
       Consolidado.total_compras,
       (Consolidado.total_faturamento - Consolidado.total_compras) AS diferenca,
       LAG(Consolidado.total_faturamento) OVER (ORDER BY Consolidado.competencia) AS faturamento_mes_anterior,
       LAG(Consolidado.total_compras) OVER (ORDER BY Consolidado.competencia) AS compras_mes_anterior,
       CASE WHEN LAG(Consolidado.total_faturamento) OVER (ORDER BY Consolidado.competencia) IS NULL
              OR LAG(Consolidado.total_faturamento) OVER (ORDER BY Consolidado.competencia) = 0
            THEN NULL
            ELSE ((Consolidado.total_faturamento - LAG(Consolidado.total_faturamento) OVER (ORDER BY Consolidado.competencia)) * 100.0
                  / LAG(Consolidado.total_faturamento) OVER (ORDER BY Consolidado.competencia))
       END AS crescimento_faturamento_percentual,
       CASE WHEN LAG(Consolidado.total_compras) OVER (ORDER BY Consolidado.competencia) IS NULL
              OR LAG(Consolidado.total_compras) OVER (ORDER BY Consolidado.competencia) = 0
            THEN NULL
            ELSE ((Consolidado.total_compras - LAG(Consolidado.total_compras) OVER (ORDER BY Consolidado.competencia)) * 100.0
                  / LAG(Consolidado.total_compras) OVER (ORDER BY Consolidado.competencia))
       END AS crescimento_compras_percentual
FROM Consolidado
ORDER BY Consolidado.competencia;
`;

const validacaoBoa = runner._test.validarSqlIaOwnerBasico(sqlCanonico, spec, sx2);
assert.strictEqual(validacaoBoa.ok, true, `SQL cross-module canonico deve passar: ${validacaoBoa.erros.join(' | ')}`);

const sqlComparativoJunho2026vs2025Canonico = `
SET ROWCOUNT 50000;
SELECT
    COALESCE((SELECT SUM(SD1.D1_TOTAL)
              FROM SD1990 SD1
              JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL
                AND SD1.D1_DOC = SF1.F1_DOC
                AND SD1.D1_SERIE = SF1.F1_SERIE
                AND SD1.D1_FORNECE = SF1.F1_FORNECE
                AND SD1.D1_LOJA = SF1.F1_LOJA
                AND SF1.D_E_L_E_T_ = ' '
              WHERE SD1.D_E_L_E_T_ = ' '
                AND SF1.F1_TIPO = 'N'
                AND SUBSTRING(SD1.D1_DTDIGIT, 1, 6) = '202606'), 0) AS total_compras,
    COALESCE((SELECT SUM(SF2.F2_VALBRUT)
              FROM SF2990 SF2
              WHERE SF2.D_E_L_E_T_ = ' '
                AND SF2.F2_TIPO = 'N'
                AND SUBSTRING(SF2.F2_EMISSAO, 1, 6) = '202606'), 0) AS total_faturamento,
    COALESCE((SELECT SUM(SD1.D1_TOTAL)
              FROM SD1990 SD1
              JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL
                AND SD1.D1_DOC = SF1.F1_DOC
                AND SD1.D1_SERIE = SF1.F1_SERIE
                AND SD1.D1_FORNECE = SF1.F1_FORNECE
                AND SD1.D1_LOJA = SF1.F1_LOJA
                AND SF1.D_E_L_E_T_ = ' '
              WHERE SD1.D_E_L_E_T_ = ' '
                AND SF1.F1_TIPO = 'N'
                AND SUBSTRING(SD1.D1_DTDIGIT, 1, 6) = '202506'), 0) AS total_compras_2025,
    COALESCE((SELECT SUM(SF2.F2_VALBRUT)
              FROM SF2990 SF2
              WHERE SF2.D_E_L_E_T_ = ' '
                AND SF2.F2_TIPO = 'N'
                AND SUBSTRING(SF2.F2_EMISSAO, 1, 6) = '202506'), 0) AS total_faturamento_2025;
`;

assert.ok(/AS total_faturamento[\s\S]*FROM SF2990 SF2|FROM SF2990 SF2[\s\S]*AS total_faturamento/i.test(sqlComparativoJunho2026vs2025Canonico), 'SQL canonico da pergunta real deve calcular faturamento em SF2');
assert.ok(!/SUM\s*\(\s*SF1\s*\.\s*F1_VALBRUT\s*\)[\s\S]{0,250}\bAS\s+total_faturamento/i.test(sqlComparativoJunho2026vs2025Canonico), 'SQL canonico da pergunta real nao deve calcular total_faturamento com SF1');
const validacaoComparativoJunho = runner._test.validarSqlIaOwnerBasico(sqlComparativoJunho2026vs2025Canonico, spec, sx2, perguntaComparativoJunho);
assert.strictEqual(validacaoComparativoJunho.ok, true, `SQL canonico junho/2026 vs junho/2025 deve passar: ${validacaoComparativoJunho.erros.join(' | ')}`);

const sqlCteVirgula = `
SET ROWCOUNT 50000;
WITH faturamento AS (
  SELECT COALESCE(SUM(SF2.F2_VALBRUT), 0) AS total_faturamento
  FROM SF2990 SF2
  WHERE SF2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531'
),
compras AS (
  SELECT COALESCE(SUM(SD1.D1_TOTAL), 0) AS total_compras
  FROM SD1990 SD1
  JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL
    AND SD1.D1_DOC = SF1.F1_DOC
    AND SD1.D1_SERIE = SF1.F1_SERIE
    AND SF1.D_E_L_E_T_ = ' '
  WHERE SD1.D_E_L_E_T_ = ' '
    AND SF1.F1_TIPO = 'N'
    AND SD1.D1_DTDIGIT BETWEEN '20260501' AND '20260531'
)
SELECT f.total_faturamento, c.total_compras
FROM faturamento f, compras c;
`;

const validacaoCteVirgula = runner._test.validarSqlIaOwnerBasico(sqlCteVirgula, spec, sx2);
assert.strictEqual(validacaoCteVirgula.ok, true, `CTE usada em FROM separado por virgula deve ser aceita: ${validacaoCteVirgula.erros.join(' | ')}`);

const sqlJoinIncompleto = sqlCanonico
  .replace(/\s+AND SD1\.D1_FORNECE = SF1\.F1_FORNECE/, '')
  .replace(/\s+AND SD1\.D1_LOJA = SF1\.F1_LOJA/, '');
const validacaoRuim = runner._test.validarSqlIaOwnerBasico(sqlJoinIncompleto, spec, sx2);
assert.strictEqual(validacaoRuim.ok, true, `SQL cross-module decidido pela IA nao deve ser bloqueado por JOIN SD1/SF1 incompleto: ${validacaoRuim.erros.join(' | ')}`);
const contratoCompletado = runner._test.completarContratoRelacionalSD1SF1(sqlJoinIncompleto);
assert.strictEqual(contratoCompletado.alterou, true, 'SQL canonico com SD1/SF1 incompleto deve ser completado tecnicamente');
assert.ok(contratoCompletado.contratosAplicados.includes('SD1_SF1_FORNECE_LOJA'), 'auditoria deve registrar contrato SD1/SF1 aplicado');
assert.ok(contratoCompletado.sql.includes('AND SD1.D1_FORNECE = SF1.F1_FORNECE'), 'normalizador deve adicionar fornecedor no JOIN SD1/SF1');
assert.ok(contratoCompletado.sql.includes('AND SD1.D1_LOJA = SF1.F1_LOJA'), 'normalizador deve adicionar loja no JOIN SD1/SF1');
const contratoJaCompleto = runner._test.completarContratoRelacionalSD1SF1(sqlCanonico);
assert.strictEqual(contratoJaCompleto.alterou, false, 'SQL canonico ja completo nao deve receber condicoes duplicadas');

const sqlComprasPuroJoinIncompleto = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD1.D1_TOTAL), 0) AS total_compras
FROM SD1990 SD1
INNER JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL
  AND SD1.D1_DOC = SF1.F1_DOC
  AND SD1.D1_SERIE = SF1.F1_SERIE
  AND SF1.D_E_L_E_T_ = ' '
WHERE SD1.D_E_L_E_T_ = ' '
  AND SF1.F1_TIPO = 'N'
  AND SD1.D1_DTDIGIT BETWEEN '20260501' AND '20260531';
`;

const validacaoComprasPuro = runner._test.validarSqlIaOwnerBasico(sqlComprasPuroJoinIncompleto, comprasSpec, sx2);
assert.strictEqual(validacaoComprasPuro.ok, true, `SQL puro de compras decidido pela IA nao deve ser bloqueado por JOIN SD1/SF1 incompleto: ${validacaoComprasPuro.erros.join(' | ')}`);

const sqlDevolucaoVendaJoinIncompleto = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD1.D1_TOTAL), 0) AS total_devolucoes
FROM SF1990 SF1
INNER JOIN SD1990 SD1 ON SD1.D1_FILIAL = SF1.F1_FILIAL
  AND SD1.D1_DOC = SF1.F1_DOC
  AND SD1.D1_SERIE = SF1.F1_SERIE
  AND SD1.D_E_L_E_T_ = ' '
WHERE SF1.D_E_L_E_T_ = ' '
  AND SF1.F1_TIPO = 'D'
  AND SF1.F1_DTDIGIT BETWEEN '20260501' AND '20260531';
`;

const validacaoDevolucaoVenda = runner._test.validarSqlIaOwnerBasico(sqlDevolucaoVendaJoinIncompleto, faturamentoSpec, sx2);
assert.strictEqual(validacaoDevolucaoVenda.ok, true, `devolucao de venda decidida pela IA nao deve ser bloqueada por JOIN SD1/SF1 incompleto: ${validacaoDevolucaoVenda.erros.join(' | ')}`);

const sqlDevolucaoCompraJoinIncompleto = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS total_devolucoes
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL
  AND SD2.D2_DOC = SF2.F2_DOC
  AND SD2.D2_SERIE = SF2.F2_SERIE
  AND SF2.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'D'
  AND SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531';
`;

const validacaoDevolucaoCompra = runner._test.validarSqlIaOwnerBasico(sqlDevolucaoCompraJoinIncompleto, comprasSpec, sx2);
assert.strictEqual(validacaoDevolucaoCompra.ok, true, `devolucao de compra decidida pela IA nao deve ser bloqueada por JOIN SD2/SF2 incompleto: ${validacaoDevolucaoCompra.erros.join(' | ')}`);

console.log('faturamento-compras-cross-module.test.js: ok');
