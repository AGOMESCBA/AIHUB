'use strict';

/**
 * Fragmentos de regrasTecnicas de compras, organizados por sub-operacao
 * (devolucoes, metrica valor total, metrica quantidade/item, fiscal/TES,
 * media, crescimento, comparativo entre periodos) em vez de um unico bloco
 * monolitico. Mesma arquitetura aplicada ao financeiro e ao faturamento.
 *
 * A concatenacao de TODOS os fragmentos (fallback, quando a pergunta nao
 * classifica em nenhuma sub-operacao especifica) reproduz o regrasTecnicas
 * anterior, preservando os testes existentes.
 */

function base() {
  return `
## Campos de data padrao
- Notas de entrada (compras): SD1.D1_DTDIGIT (CHAR(8) YYYYMMDD).
- Pedidos de compra: SC7.C7_EMISSAO.

## Tabelas padrao do modulo Compras
- SF1: cabecalho de NF de entrada. F1_VALBRUT e o valor bruto total da nota (nivel cabecalho).
- SD1: itens de NF de entrada. Metrica principal: SD1.D1_TOTAL. Quantidade: SD1.D1_QUANT.
- Tipos de nota fiscal de entrada no Protheus (SF1.F1_TIPO): N=Normal (compra de mercadoria/insumo/servico), D=Devolucao de venda (retorno de nota de saida para a empresa), B=Beneficiamento/guarda/reparo/conserto, I=Complementar de ICMS, P=Complementar de IPI. Apenas tipo 'N' representa compra real.
- REGRA OBRIGATORIA — SF1.F1_TIPO: toda consulta fiscal que use SF1 deve informar explicitamente SF1.F1_TIPO no WHERE. Para compra normal/custo real use SF1.F1_TIPO = 'N'. Para devolucao de venda use SF1.F1_TIPO = 'D'. Nunca use SF1.F1_TIPO = '1' e nunca use SF1 sem F1_TIPO.
- SF2: cabecalho de NF de saida do faturamento; para devolucao de compra use SF2.F2_TIPO = 'D'.
- SD2: itens de NF de saida do faturamento; para valor de devolucao use SD2.D2_TOTAL.
- SA2: fornecedores.
- SB1: produtos.
- SBM: grupo de produtos.
- SC7: pedidos de compra.
- CTT: centro de custo.
- SED: natureza.
- SF4: TES.

## Joins padrao
- SD1 -> SF1:
  SD1.D1_FILIAL = SF1.F1_FILIAL
  AND SD1.D1_DOC = SF1.F1_DOC
  AND SD1.D1_SERIE = SF1.F1_SERIE
  AND SD1.D1_FORNECE = SF1.F1_FORNECE
  AND SD1.D1_LOJA = SF1.F1_LOJA
- Regra tecnica: sempre que SD1 e SF1 forem usados juntos para somar SD1.D1_TOTAL, o JOIN deve conter D1_FORNECE/F1_FORNECE e D1_LOJA/F1_LOJA para evitar duplicidade de notas com mesmo numero e serie.
- SF1 -> SA2:
  SF1.F1_FORNECE = SA2.A2_COD
  AND SF1.F1_LOJA = SA2.A2_LOJA
- SD1 -> SB1: SD1.D1_COD = SB1.B1_COD
- SB1 -> SBM: SB1.B1_GRUPO = SBM.BM_GRUPO
- SD1 -> SC7: SD1.D1_PEDIDO = SC7.C7_NUM AND SD1.D1_ITEMPC = SC7.C7_ITEM
- SD1 -> CTT: SD1.D1_CC = CTT.CTT_CUSTO
- SD1 -> SED: SD1.D1_NATUREZ = SED.ED_CODIGO
- SD1 -> SF4: SD1.D1_TES = SF4.F4_CODIGO
- SD2 -> SF2:
  SD2.D2_FILIAL = SF2.F2_FILIAL
  AND SD2.D2_DOC = SF2.F2_DOC
  AND SD2.D2_SERIE = SF2.F2_SERIE
  AND SD2.D2_CLIENTE = SF2.F2_CLIENTE
  AND SD2.D2_LOJA = SF2.F2_LOJA
- SF2 -> SA2 para devolucao de compra:
  SF2.F2_CLIENTE = SA2.A2_COD
  AND SF2.F2_LOJA = SA2.A2_LOJA

## Regras obrigatorias de SQL
- Inicie sempre com SET ROWCOUNT 50000.
- Use aliases explicitos iguais a base da tabela: SD1, SF1, SA2, SB1, SBM, SC7, CTT, SED, SF4.
- Qualifique campos sempre pelo alias base (SD1.D1_TOTAL, nunca SD1990.D1_TOTAL).
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.

## Exibicao de entidades
- fornecedor: SA2.A2_NOME AS fornecedor. Codigo/loja como cod_fornecedor e loja_fornecedor.
- produto: SB1.B1_DESC AS produto. Codigo como cod_produto.
- grupo_produto: SBM.BM_DESC AS grupo_produto.
- centro_custo: CTT.CTT_DESC01 AS centro_custo.
- natureza: SED.ED_DESCRIC AS natureza.
- tes: SF4.F4_TEXTO AS tes.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.

## Entidades cadastrais
Quando precisar filtrar fornecedor, produto, grupo_produto, centro_custo, natureza ou TES por nome citado pelo usuario, retorne em entidades_necessarias.
Depois que o sistema devolver entidades_resolvidas, filtre por codigo interno, nao por LIKE de nome.
- Se a mensagem mencionar "empresa(s) J2A/C3I/todas as empresas" ou o estado tecnico trouxer empresas_iahub_mencionadas, trate esses nomes como escopo de tenant IAHub, nunca como fornecedor. Nao gere filtro em SA2.A2_NOME, SA2.A2_FILIAL ou subquery em SA2 por esses termos.
- REGRA CRITICA — palavra "empresa" como escopo de tenant: Quando a mensagem usa "empresa(s) [NOME1] e/ou [NOME2]" e esses nomes estao em empresas_iahub_mencionadas, a palavra "empresa" indica APENAS o escopo de execucao multiempresa. Ela NAO e um agrupamento SQL nem um filtro cadastral. Nao adicione GROUP BY, nao agrupe por empresa, nao filtre por fornecedor/filial baseado nesses nomes.
- REGRA CRITICA — agrupamentos: ["empresa"] no estado anterior: Quando contrato_orquestrador ou estado anterior trouxer agrupamentos: ["empresa"], isso e metadata do backend (agrupamento multiempresa para exibicao), NAO e instrucao para GROUP BY SQL. Ignore-o na geracao do SQL. So adicione GROUP BY SQL quando o usuario pedir explicitamente agrupamento por mes, fornecedor, produto, etc.
`;
}

function devolucoes() {
  return `
## Devolucoes
- Nao inclua devolucoes nas metricas de compras por padrao.
- Somente considere devolucoes quando o usuario pedir explicitamente: devolucao, devolucoes, retorno, estorno, abatendo devolucoes, considerar devolucoes.
- "considerando devolucao", "com devolucao", "abatendo devolucao" ou "liquido de devolucao" significa compras liquidas: compras normais positivas menos devolucoes/retornos quando for possivel identificar ambos.
- So retorne apenas devolucoes quando o usuario disser claramente "somente devolucoes", "apenas devolucoes", "total de devolucoes" ou equivalente.
- No Protheus, devolucao de compra e nota de saida do SIGAFAT: use obrigatoriamente SF2/SD2, com SF2.F2_TIPO = 'D'. Nao use SF4/TES nem CASE em SD1 para identificar devolucao de compra.
- Quando o usuario pedir para considerar devolucoes, compras liquidas ou abatendo devolucoes, monte obrigatoriamente uma consulta externa sobre subqueries unificadas por UNION ALL:
  1. Subquery de compras: origem SD1/SF1. Projete COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_compra e 0 AS valor_devolucao.
  2. Subquery de devolucoes: origem SD2/SF2. Filtre SF2.F2_TIPO = 'D'. Projete 0 AS valor_compra e COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_devolucao.
- A query externa deve selecionar SUM(valor_compra) AS total_compras, SUM(valor_devolucao) AS total_devolucoes e (SUM(valor_compra) - SUM(valor_devolucao)) AS total_liquido.
- REGRA ABSOLUTA — cada subquery do UNION ALL deve ser ESCALAR (sem GROUP BY, retornando 1 linha com o total ja agregado por SUM). PROIBIDO agrupar a subquery por chave de documento (filial+doc+serie+fornecedor/loja) — isso gera 1 linha por nota fiscal em vez de 1 linha com o total, tornando o UNION ALL inutilmente grande e fragil.
- Aplique o mesmo periodo e os mesmos filtros cadastrais nas duas subqueries quando fizer sentido. Para compras use SD1.D1_DTDIGIT ou SF1.F1_DTDIGIT. Para devolucoes use SF2.F2_EMISSAO ou SD2.D2_EMISSAO conforme campos disponiveis.
- Nota Protheus: na devolucao de compras (SF2 tipo D), o codigo do fornecedor e gravado em F2_CLIENTE/SD2.D2_CLIENTE e loja em F2_LOJA/SD2.D2_LOJA. Se houver filtro de fornecedor resolvido, filtre compras por SF1.F1_FORNECE/F1_LOJA e devolucoes por SF2.F2_CLIENTE/F2_LOJA.
- Quando houver necessidade de associar devolucao a uma nota de compra original, use os campos de origem da SD2, como D2_NFORI e D2_SERIORI, junto da nota/serie da compra quando esses campos estiverem disponiveis.

### EXEMPLO CORRETO — compras liquidas (subqueries escalares, sem GROUP BY por documento)
SELECT SUM(valor_compra) AS total_compras, SUM(valor_devolucao) AS total_devolucoes,
       (SUM(valor_compra) - SUM(valor_devolucao)) AS total_liquido
FROM (
  SELECT COALESCE(SUM(SD1.D1_TOTAL), 0) AS valor_compra, 0 AS valor_devolucao
  FROM SD1xxx SD1
  JOIN SF1xxx SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
  WHERE SF1.D_E_L_E_T_ = ' ' AND SD1.D_E_L_E_T_ = ' ' AND SF1.F1_TIPO = 'N' AND SD1.D1_DTDIGIT BETWEEN '20260601' AND '20260630'
  UNION ALL
  SELECT 0 AS valor_compra, COALESCE(SUM(SD2.D2_TOTAL), 0) AS valor_devolucao
  FROM SD2xxx SD2
  JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'D' AND SF2.F2_EMISSAO BETWEEN '20260601' AND '20260630'
) AS subquery;
`;
}

function metricaValorTotal() {
  return `
## DIRETRIZ DE SELECAO DE TABELAS: Cabecalho (SF1) vs Itens (SD1)
Avalie a METRICA e a granularidade da pergunta para determinar a estrutura do FROM/JOIN. O uso incorreto gera duplicidade matematica ou metricas zeradas.

### Consultas por VALOR Financeiro Total (sem produto/item)
- Quando o usuario pedir "Total de compras", "Compras do ano", "Compras do mes" ou "Compras de um periodo" — metricas puramente monetarias, sem especificar produto, grupo de produto ou QUANTIDADE — use FROM SD1 JOIN SF1 com metrica COALESCE(SUM(SD1.D1_TOTAL), 0) AS valor_compra.
- Agrupamentos por fornecedor sao compativeis com SD1 JOIN SF1: faca JOIN com SA2 (via Joins padrao SF1->SA2). SD1 continua como origem da metrica.
- Se usar SF1 sozinha (sem SD1) a metrica pode ser COALESCE(SUM(SF1.F1_VALBRUT), 0) AS valor_compra. Porem EXPRESSAMENTE PROIBIDO usar SUM(SF1.F1_VALBRUT) quando SD1 estiver no FROM/JOIN: o relacionamento 1-para-muitos entre SF1 e SD1 multiplica F1_VALBRUT pela quantidade de itens da nota, gerando valores duplicados errados.
`;
}

function metricaQuantidadeItem() {
  return `
### Consultas por QUANTIDADE ou filtros de Produto/Item
- Quando o usuario pedir "Quantidade comprada", "Volume de compras", "Total de pecas compradas" (mesmo total escalar de uma unica linha), ou quando citar produtos e grupos de produtos, use OBRIGATORIAMENTE FROM SD1 JOIN SF1.
- Metrica de quantidade escalar obrigatoria: COALESCE(SUM(SD1.D1_QUANT), 0) AS quantidade_comprada.
- NUNCA use SF1 sozinha quando a pergunta contiver "Quantidade": o cabecalho nao armazena volume de itens.
- Quando o usuario pedir SIMULTANEAMENTE "por valor" e "por quantidade" com agrupamento por produto/grupo: ambas as metricas devem vir de SD1. Exemplo: SELECT ..., COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_compra, COALESCE(SUM(SD1.D1_QUANT),0) AS quantidade_comprada FROM SD1... JOIN SF1...
`;
}

function cfopTes() {
  return `
## Codigo Fiscal (CF/CFOP) e TES — Compras
- Sinonimos para nota fiscal de entrada/compras: nota de entrada, nota fiscal de entrada, NF de entrada, compra, aquisicao.
- CF, CFOP, codigo fiscal e codigo fiscal de operacao sao sinonimos — referem-se ao campo SD1.D1_CF.
- Por padrao, em consultas de valor financeiro ou despesas (contas a pagar), excluir remessas e transferencias:
  SD1.D1_CF NOT LIKE '19%'
  Razao: CFs iniciados com 19 sao remessas/transferencias — nao geram obrigacao financeira (contas a pagar).
- Em consultas de volume fisico, quantidade ou movimentacao de estoque: incluir CF 19 — a nota pode ter gerado movimentacao fisica.
- Excecao (incluir CF 19 em qualquer contexto): quando o usuario pedir explicitamente remessas, transferencias, ou citar CF/CFOP/codigo fiscal com o valor 19.
- TES pode ser chamado de TES, Tipos de Entrada ou tipo de entrada. Refere-se ao campo SD1.D1_TES / tabela SF4 (F4_CODIGO, F4_TEXTO).
- SF4.F4_ESTOQUE: 'S' = TES gera movimentacao de estoque; 'N' = nao gera.
  REGRA ABSOLUTA: quando o usuario perguntar sobre notas que geraram estoque ou movimentaram estoque, o JOIN SD1 -> SF4 sozinho NAO BASTA — e OBRIGATORIO incluir tambem AND SF4.F4_ESTOQUE = 'S' no WHERE (ou na condicao do ON). Sem esse filtro no WHERE, o JOIN apenas associa o TES sem restringir aos que geram estoque, somando TODAS as compras com qualquer TES vinculado.
  EXEMPLO CORRETO: ...JOIN SF4xxx SF4 ON SD1.D1_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' WHERE SD1.D_E_L_E_T_ = ' ' AND SF1.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S' AND <periodo>.
- SF4.F4_DUPLIC: 'S' = TES gera lancamento financeiro (duplicata/pagar); 'N' = nao gera financeiro.
  REGRA ABSOLUTA: quando o usuario perguntar sobre notas que geraram financeiro, contas a pagar ou duplicatas, e OBRIGATORIO incluir AND SF4.F4_DUPLIC = 'S' no WHERE — o JOIN sozinho nao filtra nada.
  Este filtro e mais preciso que filtrar por CF para identificar compras que geraram obrigacao financeira real.
`;
}

const TRUNC_POR_GRANULARIDADE = {
  diaria: { tam: 8, alias: 'dia' },
  mensal: { tam: 6, alias: 'competencia' },
  anual: { tam: 4, alias: 'ano' },
};

function media({ granularidade = 'mensal' } = {}) {
  const { tam, alias } = TRUNC_POR_GRANULARIDADE[granularidade] || TRUNC_POR_GRANULARIDADE.mensal;
  const aliasMetrica = granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes';
  return `
## Media de compras — granularidade ${granularidade}
- PROIBIDO ABSOLUTO — NUNCA use AVG(SD1.D1_TOTAL), AVG(SF1.F1_VALBRUT) ou qualquer AVG() direto sobre a tabela fato (SD1/SF1) com GROUP BY por dia/mes/ano. Isso calcula a media do VALOR DE CADA NOTA dentro de cada dia/mes/ano (ticket medio por nota), NAO a media do TOTAL COMPRADO entre os periodos — sao numeros completamente diferentes e essa e a confusao mais comum ao gerar media. A unica forma correta e a estrutura de DUAS CAMADAS abaixo.
- REGRA ESTRUTURAL OBRIGATORIA — SEMPRE DUAS CAMADAS, SEM EXCECAO: toda consulta de media e composta por (1) uma subquery/CTE interna que agrupa por periodo com SUM() e soma o valor TOTAL de cada periodo, e (2) uma query externa que faz SELECT ... AVG(h.valor_compra_${aliasMetrica}) ... FROM (<subquery interna>) AS h — o AVG() da camada externa calcula a media dos totais por periodo, nunca dos valores de notas individuais. PROIBIDO retornar apenas a subquery interna (que lista o total POR periodo) como resultado final — isso nao e uma media, e uma listagem. PROIBIDO fazer AVG(SD1.D1_TOTAL) com GROUP BY na MESMA query (camada unica) — isso e sempre o erro de "ticket medio" do paragrafo anterior, nunca a media correta. O resultado final OBRIGATORIAMENTE passa por uma camada externa com AVG(), mesmo quando o resultado e 1 linha escalar.
- Subquery/CTE interna agrupa por SUBSTRING(SD1.D1_DTDIGIT,1,${tam}) AS ${alias} (sempre a partir da posicao 1, contando ${tam} caracteres da data completa YYYYMMDD — NUNCA SUBSTRING(campo,7,2), que extrai apenas o dia do mes isolado e mistura meses/anos diferentes no mesmo agrupamento), exportando COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_compra_${aliasMetrica}.
- Media mensal por ano (subquery agrupada por nivel maior): Subquery interna OBRIGATORIAMENTE exporta DOIS aliases de data: o nivel de detalhe (ex: SUBSTRING(SD1.D1_DTDIGIT,1,6) AS competencia) E o nivel de agrupamento externo (ex: SUBSTRING(SD1.D1_DTDIGIT,1,4) AS ano). Nunca exporte so o nivel de detalhe — sem o alias do nivel externo, a query externa nao consegue agrupar (GROUP BY h.ano).
- REGRA DE DECISAO — agrupar ou nao na query externa: SO agrupe a query externa (GROUP BY h.<nivel_externo>) quando o usuario pedir explicitamente a media "POR" o nivel externo (ex: "media mensal POR ano" = uma media para cada ano, GROUP BY h.ano). Quando o usuario pedir a media de UM CONJUNTO de periodos especificos sem dizer "por" (ex: "media anual considerando 2025 e 2026", "media mensal de 2026") — mesmo citando varios periodos — o resultado e ESCALAR (1 linha, sem GROUP BY na query externa): a subquery interna filtra os periodos pedidos no WHERE, e a query externa faz AVG(h.valor_compra_${aliasMetrica}) sem GROUP BY. PROIBIDO agrupar por h.ano/h.competencia/h.dia quando o usuario apenas cita os periodos a incluir na media, sem pedir "por ano/mes/dia".
- Query externa (quando agrupada): SELECT h.<nivel_externo>, AVG(h.valor_compra_${aliasMetrica}) AS media FROM (...) AS h GROUP BY h.<nivel_externo>.
- Media mensal escalar (1 ano especifico, caso mais comum): Query externa: SELECT AVG(h.valor_compra_${aliasMetrica}) AS media FROM (...) AS h. Sem GROUP BY.
- Media anual escalar: subquery interna SUM por ano (filtrando no WHERE os anos pedidos) → query externa AVG dos totais anuais SEM GROUP BY. Camada externa usa SOMENTE h.valor_compra_ano — nunca SD1.* ou SF1.*.
- REGRA ABSOLUTA — subquery interna SEMPRE precisa de GROUP BY pelo nivel de detalhe, mesmo quando a query externa e escalar: ao filtrar 2+ anos especificos (ex: "2025 e 2026") e calcular SUBSTRING(...,1,4) AS ano + SUM(...), a subquery interna OBRIGATORIAMENTE precisa de GROUP BY SUBSTRING(...,1,4) — sem esse GROUP BY, o SQL Server agrega TODAS as linhas filtradas em uma unica linha (somando os 2 anos juntos em vez de retornar uma linha por ano), e a media externa fica sobre essa linha unica (= o proprio total combinado, nao a media entre os anos). O numero de linhas retornadas pela subquery interna deve ser igual ao numero de periodos distintos filtrados.
### EXEMPLO CORRETO — media anual entre 2025 e 2026
SELECT AVG(h.valor_compra_ano) AS media_anual
FROM (
  SELECT SUBSTRING(SD1.D1_DTDIGIT, 1, 4) AS ano, COALESCE(SUM(SD1.D1_TOTAL), 0) AS valor_compra_ano
  FROM SD1xxx SD1
  JOIN SF1xxx SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
  WHERE SD1.D_E_L_E_T_ = ' ' AND SF1.D_E_L_E_T_ = ' ' AND SUBSTRING(SD1.D1_DTDIGIT, 1, 4) IN ('2025', '2026')
  GROUP BY SUBSTRING(SD1.D1_DTDIGIT, 1, 4)
) AS h;
- NUNCA use AVG(SF1.F1_VALBRUT) ou AVG(SD1.D1_TOTAL) diretamente sobre a tabela fato: isso calcula media de nota/item, nao media de periodo.
- EXCECAO A REGRA GERAL DE FORMATACAO DE DIA: a regra universal de converter campo "dia" para DD/MM/YYYY na projecao NAO se aplica aqui quando a media e ESCALAR (1 linha, sem GROUP BY na query externa) — nesse caso a query externa nao projeta nenhuma coluna de dia/competencia/ano, apenas AVG(...). PROIBIDO adicionar SELECT/GROUP BY de dia formatado (CONVERT/CAST) na query externa de uma media escalar — isso causa erro de SQL (coluna no SELECT ausente do GROUP BY), pois a subquery interna ja agregou por dia e a externa nao deve re-agrupar por ele.
`;
}

function crescimento({ granularidade = 'mensal' } = {}) {
  const { tam, alias } = TRUNC_POR_GRANULARIDADE[granularidade] || TRUNC_POR_GRANULARIDADE.mensal;
  const periodoLabel = granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes';
  return `
## Crescimento mensal / variacao mensal / evolucao mes a mes de compras (granularidade ${granularidade})
- Quando o usuario pedir compras por ${periodoLabel} demonstrando crescimento, variacao, aumento, queda ou evolucao, a SQL deve calcular a comparacao contra o periodo anterior (LAG). Nao retorne apenas ${alias} + valor_compra.
- Use duas camadas: (1) subquery/CTE com SUBSTRING(SD1.D1_DTDIGIT,1,${tam}) AS ${alias} e COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_compra; (2) query externa com h.${alias}, h.valor_compra, LAG(h.valor_compra) OVER (ORDER BY h.${alias}) AS valor_compra_anterior, (h.valor_compra - LAG(h.valor_compra) OVER (ORDER BY h.${alias})) AS crescimento_valor e CASE WHEN LAG(h.valor_compra) OVER (ORDER BY h.${alias}) IS NULL OR LAG(h.valor_compra) OVER (ORDER BY h.${alias}) = 0 THEN NULL ELSE ((h.valor_compra - LAG(h.valor_compra) OVER (ORDER BY h.${alias})) * 100.0 / LAG(h.valor_compra) OVER (ORDER BY h.${alias})) END AS crescimento_percentual.
- Na query externa use SOMENTE aliases exportados pela camada interna (h.${alias}, h.valor_compra). NUNCA referencie SD1.* ou SF1.* fora da subquery/CTE.
- Se o usuario pedir "crescimento" sem especificar valor ou percentual, inclua ambos: crescimento_valor e crescimento_percentual. O primeiro periodo deve ficar com crescimento_percentual NULL por nao haver periodo anterior.
`;
}

function comparativoPeriodos() {
  return `
## Comparativo entre periodos especificos (nao necessariamente adjacentes)
- Diferente de crescimento (que compara cada periodo com o IMEDIATAMENTE anterior via LAG), comparativo trata de periodos ESPECIFICOS escolhidos pelo usuario, que podem nao ser adjacentes (ex: "junho de 2025 vs junho de 2026", "este ano comparado a 2 anos atras").
- Para comparar UM periodo de referencia contra OUTROS periodos: o periodo de REFERENCIA vai em subquery escalar SEM GROUP BY (retorna 1 valor); os periodos COMPARADOS ficam na query principal com GROUP BY.
- PROIBIDO: subquery com GROUP BY dentro de uma comparacao escalar (=, <, >, <=, >=, HAVING). GROUP BY na subquery retorna N linhas, causando erro do SQL Server ("Subquery returned more than 1 value").
- Para comparar MULTIPLOS periodos especificos lado a lado (ex: "2024 vs 2025 vs 2026"): use GROUP BY pela mesma dimensao em todos, com filtro WHERE restringindo exatamente aos periodos pedidos.
- Granularidade do comparativo (dia/mes/ano) e definida pela pergunta do usuario — use SUBSTRING(SD1.D1_DTDIGIT,1,8) para dia, 1,6 para mes, 1,4 para ano, sempre consistente entre os periodos comparados.
- REGRA ABSOLUTA — calculo de competencia "mesmo mes, ano diferente": ao montar o valor de competencia (formato AAAAMM) para "mesmo mes do ano anterior/seguinte", o MES permanece IDENTICO e SOMENTE o ANO muda. Erro comum a evitar: ao comparar "junho de 2026 com junho de 2025", o periodo comparado e competencia = '202506' (ano 2025, mes 06) — NUNCA mude o mes ao trocar o ano.
- EXEMPLO CORRETO — junho/2026 vs junho/2025: SUBSTRING(SD1.D1_DTDIGIT,1,6) IN ('202606', '202506') — mesmo mes "06" nos dois anos.
`;
}

const FRAGMENTOS = {
  devolucoes: {
    texto: devolucoes,
    keywords: [/\bdevolu\w*/i, /\bestorno\b/i, /\bretorno\b/i, /\bl[ií]quido\b/i, /\babatendo\b/i],
  },
  metrica_valor_total: {
    texto: metricaValorTotal,
    keywords: [/\bcompras?\s+(do|de|no)\s+(mes|ano|periodo)\b/i, /\btotal\s+de\s+compras?\b/i],
    excluiSe: [/\bquantidade\b/i, /\bvolume\b/i, /\bpe[çc]as?\b/i, /\bproduto\w*\b/i, /\bgrupo\b/i],
  },
  metrica_quantidade_item: {
    texto: metricaQuantidadeItem,
    keywords: [/\bquantidade\b/i, /\bvolume\b/i, /\bpe[çc]as?\b/i, /\bproduto\w*\b/i, /\bgrupo\s+de\s+produto\w*\b/i],
  },
  cfop_tes: {
    texto: cfopTes,
    keywords: [/\bCFOP\b/i, /\bCF\b/, /\bTES\b/, /\bestoque\b/i, /\bcentro\s+de\s+custo\b/i, /\bremessa\b/i, /\btransferencia\b/i],
  },
  media_diaria: {
    texto: () => media({ granularidade: 'diaria' }),
    keywords: [/\bm[eé]di[ao]\b.*\bdi[aá]ri[ao]\b|\bdi[aá]ri[ao]\b.*\bm[eé]di[ao]\b/i, /\bm[eé]di[ao]\s+por\s+dia\b/i],
  },
  media_anual: {
    texto: () => media({ granularidade: 'anual' }),
    keywords: [/\bm[eé]di[ao]\b.*\banual\b|\banual\b.*\bm[eé]di[ao]\b/i, /\bm[eé]di[ao]\s+por\s+ano\b/i, /\bm[eé]dia\s+anual\b/i],
  },
  media_mensal: {
    texto: () => media({ granularidade: 'mensal' }),
    keywords: [/\bm[eé]di[ao]\b/i],
    excluiSe: [
      /\bm[eé]di[ao]\b.*\b(di[aá]ri[ao]|anual)\b|\b(di[aá]ri[ao]|anual)\b.*\bm[eé]di[ao]\b/i,
      /\bm[eé]di[ao]\s+por\s+dia\b/i,
      /\bm[eé]di[ao]\s+por\s+ano\b/i,
    ],
  },
  crescimento_diario: {
    texto: () => crescimento({ granularidade: 'diaria' }),
    keywords: [/\b(crescimento|varia[cç][aã]o|evolu[cç][aã]o|aumento|queda)\b.*\bdi[aá]ri[ao]\b|\bdi[aá]ri[ao]\b.*\b(crescimento|varia[cç][aã]o)\b/i, /\bdia\s+a\s+dia\b/i],
  },
  crescimento_anual: {
    texto: () => crescimento({ granularidade: 'anual' }),
    keywords: [/\b(crescimento|varia[cç][aã]o|evolu[cç][aã]o|aumento|queda)\b.*\banual\b|\banual\b.*\b(crescimento|varia[cç][aã]o)\b/i, /\bano\s+a\s+ano\b/i, /\bentre\s+os\s+anos\b/i],
  },
  crescimento_mensal: {
    texto: () => crescimento({ granularidade: 'mensal' }),
    keywords: [/\bcrescimento\b/i, /\bvaria[cç][aã]o\b/i, /\bevolu[cç][aã]o\b/i, /\baumento\b/i, /\bqueda\b/i, /\bm[eê]s\s+a\s+m[eê]s\b/i],
    excluiSe: [/\b(crescimento|varia[cç][aã]o)\b.*\b(di[aá]ri[ao]|anual)\b|\b(di[aá]ri[ao]|anual)\b.*\b(crescimento|varia[cç][aã]o)\b/i],
  },
  comparativo_periodos: {
    texto: comparativoPeriodos,
    keywords: [/\bcompar\w*\b/i, /\bversus\b/i, /\bvs\.?\b/i, /\bem\s+rela[cç][aã]o\s+a\b/i, /\bcontra\b.*\b(mes|ano|periodo)\b/i],
  },
};

const ORDEM_FALLBACK = [
  'devolucoes',
  'metrica_valor_total',
  'metrica_quantidade_item',
  'cfop_tes',
  'media_diaria',
  'media_mensal',
  'media_anual',
  'crescimento_diario',
  'crescimento_mensal',
  'crescimento_anual',
  'comparativo_periodos',
];

module.exports = { base, FRAGMENTOS, ORDEM_FALLBACK };
