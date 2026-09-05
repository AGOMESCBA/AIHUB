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
- Tipos de nota fiscal de entrada no Protheus (SF1.F1_TIPO):
  - N=Normal: tipo de nota com caracteristicas padroes; entra em compras/custo real.
  - C=Compl. Preco: nota complementar de preco; entra em compras/custo real junto com N.
  - D=Devolucao: retorno de uma nota de saida a empresa; nao entra em compras por padrao.
  - B=Beneficiamento: envio/recebimento de produto para guarda, reparo, conserto, beneficiamento etc.; nao entra em compras por padrao.
  - I=Compl. ICMS: complemento quando aliquota ou valor do ICMS da nota principal foi menor que o devido; nao entra em compras por padrao.
  - P=Compl. IPI: complemento quando aliquota ou valor do IPI da nota principal foi menor que o devido, podendo gerar duplicata; nao entra em compras por padrao.
  Para compras/custo real considere somente os tipos 'N' e 'C'.
- REGRA OBRIGATORIA — SF1.F1_TIPO: toda consulta fiscal que use SF1 deve informar explicitamente SF1.F1_TIPO no WHERE. Para compra normal/custo real use SF1.F1_TIPO IN ('N','C'). Para devolucao de venda use SF1.F1_TIPO = 'D'. Nunca use SF1.F1_TIPO = '1' e nunca use SF1 sem F1_TIPO.
- SF2: cabecalho de NF de saida do faturamento; para devolucao de compra use SF2.F2_TIPO = 'D'.
- SD2: itens de NF de saida do faturamento; para valor de devolucao use SD2.D2_TOTAL.
- SA2: fornecedores.
- SB1: produtos.
- SBM: grupo de produtos.
- SC7: pedidos de compra. Para status de aprovacao/aberto/atendido, use SEMPRE os campos do proprio SC7 (C7_APROV, C7_QUANT, C7_QUJE, C7_RESIDUO) — nunca infira status via SD1/SF1.
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
  WHERE SF1.D_E_L_E_T_ = ' ' AND SD1.D_E_L_E_T_ = ' ' AND SF1.F1_TIPO IN ('N','C') AND SD1.D1_DTDIGIT BETWEEN '20260601' AND '20260630'
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

function statusPedidoCompra() {
  return `
## Status de pedido de compra (SC7) — aberto, atendido, aprovado, nao aprovado, bloqueado
- Sinonimos para pedido de compra: pedido de compra, pedidos de compra, PC, PCs (singular ou plural, maiusculo ou minusculo) — todos referem-se a linhas de SC7.
- Campos de status no cabecalho/item do pedido: SC7.C7_APROV (situacao de ATENDIMENTO/liberacao para recebimento), SC7.C7_CONAPRO (situacao de ALCADA/aprovacao), SC7.C7_QUANT (quantidade pedida), SC7.C7_QUJE (quantidade ja atendida/recebida), SC7.C7_RESIDUO (quantidade residual/cancelada).
- REGRA CRITICA — C7_APROV e C7_CONAPRO sao EIXOS INDEPENDENTES, nunca confunda um pelo outro:
  - SC7.C7_CONAPRO responde "o pedido esta liberado pela ALCADA de aprovacao?" — valores: 'L' ou vazio/branco = aprovado/liberado (passou pela alcada, ou o pedido nunca exigiu controle de alcada — os dois casos contam como aprovado), 'B' = BLOQUEADO (aguardando liberacao do aprovador, por limite de valor/orcamento/regra de negocio), 'R' = rejeitado (um aprovador recusou; pedido precisa ser revisado ou cancelado). NUNCA use 'A' — esse valor NAO EXISTE no dominio deste campo.
  - SC7.C7_APROV responde "o pedido esta ativo para ATENDIMENTO/recebimento?" — valores: 'L' = liberado/em aberto (aguardando chegada da NF), 'E' = encerrado (totalmente atendido, C7_QUANT = C7_QUJE), 'R' = residuo eliminado (encerrado manualmente via MATA235 mesmo sem receber tudo).
- Saldo pendente de receber (quantidade que ainda falta chegar): (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO).
- Pedido de compra APROVADO/LIBERADO na alcada: SC7.C7_CONAPRO IN ('L', ''). Pedido de compra BLOQUEADO na alcada (aguardando aprovador): SC7.C7_CONAPRO = 'B'. Pedido de compra REJEITADO na alcada: SC7.C7_CONAPRO = 'R'.
- Pedido de compra LIBERADO/em aberto para atendimento: SC7.C7_APROV = 'L'. Pedido de compra NAO LIBERADO para atendimento: SC7.C7_APROV <> 'L'. Use C7_APROV apenas quando a pergunta for sobre atendimento/recebimento, nunca como sinonimo de "bloqueado" — bloqueio e sempre C7_CONAPRO = 'B'.
- Pedido de compra EM ABERTO (liberado para atendimento e com saldo pendente de nota fiscal de entrada): SC7.C7_APROV = 'L' AND (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0.
- Pedido de compra ATENDIDO (totalmente recebido, sem saldo pendente): (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) <= 0.
- Pedido de compra EM ABERTO E BLOQUEADO (combinacao pedida com frequencia): (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0 AND SC7.C7_CONAPRO = 'B'. NAO adicione SC7.C7_APROV = 'L' nesse caso — um pedido bloqueado na alcada normalmente ainda esta com C7_APROV = 'L' (em aberto), mas o campo que efetivamente identifica o bloqueio e SEMPRE C7_CONAPRO, nunca C7_APROV.
- Relacao com aprovacao por nivel/alcada (tabela SCR): quando a empresa tiver SCR disponivel (ver fragmento de aprovacao), SCR.CR_STATUS = '04' identifica QUAL nivel/aprovador esta bloqueando o pedido — SC7.C7_CONAPRO = 'B' e o resultado consolidado no pedido (nao exige JOIN com SCR). Para "quantos pedidos estao bloqueados", responda direto com C7_CONAPRO = 'B', sem JOIN. Para "quem precisa liberar" ou "por aprovador", use SCR (ver fragmento de aprovacao).
- REGRA OBRIGATORIA — nunca infira status de pedido de compra a partir de EXISTS/NOT EXISTS em SD1 (notas de entrada). O status correto vem SEMPRE dos campos SC7.C7_APROV, C7_CONAPRO, C7_QUANT, C7_QUJE, C7_RESIDUO, calculados diretamente no SC7, sem necessidade de JOIN com SD1/SF1.
- Periodo de pedidos de compra (dia/mes/ano, comparativos entre periodos): use sempre SC7.C7_EMISSAO (data de emissao do pedido), no mesmo formato CHAR(8) YYYYMMDD dos demais campos de data do modulo.
- "Pedidos de compra" sem qualificacao adicional refere-se a linhas de SC7 (FROM SC7), nao a notas fiscais de entrada (SD1/SF1) nem a produtos comprados via SD1.

### EXEMPLO CORRETO — pedidos de compra em aberto no mes
SELECT SC7.C7_NUM AS pedido, SC7.C7_ITEM AS item, SA2.A2_NOME AS fornecedor, SB1.B1_DESC AS produto,
       SC7.C7_QUANT AS quantidade_pedida, SC7.C7_QUJE AS quantidade_atendida,
       (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) AS quantidade_pendente
FROM SC7xxx SC7
JOIN SA2xxx SA2 ON SC7.C7_FORNECE = SA2.A2_COD AND SC7.C7_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '
JOIN SB1xxx SB1 ON SC7.C7_PRODUTO = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_APROV = 'L'
  AND (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0
  AND SC7.C7_EMISSAO BETWEEN '20260701' AND '20260731';

### EXEMPLO CORRETO — quantos pedidos de compra estao em aberto e bloqueados
SELECT COUNT(*) AS total_pedidos
FROM SC7xxx SC7
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_CONAPRO = 'B'
  AND (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0;

### EXEMPLO CORRETO — meus pedidos de compras aprovados no mes passado
SELECT SC7.C7_NUM AS pedido, SC7.C7_ITEM AS item, SA2.A2_NOME AS fornecedor, SB1.B1_DESC AS produto,
       SC7.C7_TOTAL AS valor_pedido
FROM SC7xxx SC7
JOIN SA2xxx SA2 ON SC7.C7_FORNECE = SA2.A2_COD AND SC7.C7_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '
JOIN SB1xxx SB1 ON SC7.C7_PRODUTO = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_CONAPRO IN ('L', '')
  AND SC7.C7_EMISSAO BETWEEN '20260701' AND '20260731';
-- "aprovado"/"liberado" (alcada) usa SEMPRE SC7.C7_CONAPRO IN ('L', ''), NUNCA C7_CONAPRO = 'A' (esse valor nao existe) e NUNCA C7_APROV (campo de ATENDIMENTO, nao de alcada). Sem qualificacao de "em aberto"/quantidade pendente na pergunta, NAO adicione o filtro de saldo pendente (C7_QUANT - C7_QUJE - C7_RESIDUO) — "aprovado" e status de alcada, independente de o pedido ja ter sido recebido ou nao.
`;
}

function aprovacaoPedidoCompra({ temNomeAprovador } = {}) {
  const joinAprovador = temNomeAprovador
    ? `- SCR -> SAK (nome do aprovador): SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '. Use LEFT JOIN (aprovador pode nao estar cadastrado em SAK) e exiba COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador. Quando o usuario pedir "nome do aprovador", SAK.AK_NOME e obrigatorio; SCR.CR_APROV sozinho e apenas codigo, nao nome.`
    : `- Esta empresa nao tem a tabela SAK (cadastro de aprovadores) disponivel: exiba SCR.CR_APROV (codigo do aprovador) diretamente, sem tentar resolver o nome. NUNCA invente JOIN com SAK ou outra tabela de usuarios nesse caso.`;
  return `
## Aprovacao/liberacao de pedido de compra por aprovador (SCR)
- Esta empresa POSSUI a tabela SCR (controle de aprovacao/alcada de documentos) disponivel — use-a SOMENTE quando a pergunta mencionar aprovador, nivel de aprovacao, alcada ou liberacao/aprovacao pendente de pedido de compra.
- SCR e tabela de CABECALHO de documento (nao tem item) — chave: SCR.CR_FILIAL + SCR.CR_NUM + SCR.CR_TIPO.
- SCR.CR_TIPO identifica o tipo de documento em aprovacao. Para pedido de compra, filtre SEMPRE SCR.CR_TIPO = 'PC'. NUNCA use SCR sem esse filtro — sem ele a consulta mistura outros tipos de documento (solicitacao de compra 'SC', nota fiscal 'NF', contrato 'CT', etc.), retornando aprovacoes que nao sao de pedido de compra.
- Join SCR -> SC7 (pedido de compra): SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SCR.D_E_L_E_T_ = ' '. E relacionamento de CABECALHO (SCR nao tem C7_ITEM) — nao junte por item.
- PROIBIDO — CR_LOJA nao existe em SCR. NUNCA adicione C7_LOJA = CR_LOJA a este JOIN.
${joinAprovador}
- SCR.CR_STATUS (controle da aprovacao, valores fixos do Protheus):
  '01' = aguardando nivel anterior.
  '02' = pendente no nivel atual (aguardando ESTE aprovador).
  '03' = liberado.
  '04' = bloqueado.
  '05' = liberado por outro aprovador (do mesmo nivel).
  '06' = rejeitado.
  '07' = rejeitado ou bloqueado por outro aprovador.
- REGRA CRITICA — "aguardando aprovacao", "pendente de liberacao", "bloqueado" ou "nao apto a ser comprado" (linguagem de negocio do usuario) identifica o PEDIDO sempre por SC7.C7_CONAPRO = 'B' — o campo CONSOLIDADO e definitivo (diferente de 'B', ou seja 'L'/vazio (liberado) ou 'R' (rejeitado), significa que nao ha bloqueio de aprovacao pendente). NUNCA use SCR.CR_STATUS sozinho para decidir SE um pedido esta bloqueado — SCR tem uma linha por NIVEL, entao um pedido pode ter niveis ja liberados ('03') e ainda assim estar bloqueado no nivel seguinte; so o campo consolidado do proprio pedido (C7_CONAPRO) resolve isso sem ambiguidade.
- Pergunta SEM "por aprovador" (ex: "quantos pedidos estao bloqueados", "pedidos aguardando aprovacao"): responda direto com SC7.C7_CONAPRO = 'B', SEM JOIN com SCR — nao ha necessidade de tocar a tabela de fluxo so para contar/listar pedidos.
- Pergunta COM "por aprovador" (agrupar por quem precisa liberar): alem de C7_CONAPRO = 'B' no pedido, filtre tambem SCR.CR_STATUS IN ('01','02','04') no WHERE — isso traz TODOS os niveis/aprovadores que ainda impedem a liberacao do pedido (aguardando nivel anterior, pendente no nivel atual, ou bloqueado), propositalmente EXCLUINDO niveis ja liberados ('03') do mesmo pedido. Se o pedido estiver pendente para mais de um aprovador/nivel simultaneamente, ele aparece uma vez PARA CADA aprovador — isso e o comportamento correto (cada aprovador precisa ver o pedido na propria fila), nao e duplicacao indevida.
- REGRA CRITICA — pedidos JA APROVADOS/LIBERADOS (C7_CONAPRO IN ('L','')) agrupados "por aprovador": aqui "aprovador" significa QUEM LIBEROU o pedido no fluxo, nao quem esta bloqueando — use JOIN com SCR filtrando SCR.CR_STATUS = '03' (liberado) e exiba SAK.AK_NOME/SCR.CR_APROV (mesma logica ja aplicada em "o que eu ja aprovei", generalizada para qualquer aprovador, nao so o remetente). NUNCA projete SC7.C7_CONAPRO ou SC7.C7_APROV como se fossem o nome/codigo do aprovador — esses campos guardam um STATUS ('L'/'B'/'R'), nao uma pessoa. Sem JOIN com SCR disponivel para esta empresa, informe que a identificacao de aprovador nao esta disponivel em vez de inventar uma coluna.
- SCR.CR_NIVEL identifica o nivel/etapa de alcada do fluxo de aprovacao (util quando o usuario pedir "por nivel de aprovacao").
- Quando o usuario pedir "por aprovador", agrupe pelo aprovador (COALESCE(SAK.AK_NOME, SCR.CR_APROV) quando SAK existir; SCR.CR_APROV somente quando SAK nao existir) — nao confunda com SC7.C7_APROV (que so indica se o PEDIDO esta liberado 'L' ou nao, sem identificar QUEM precisa aprovar).
- Diferenca entre SC7.C7_APROV e SCR: SC7.C7_APROV = 'L' informa que o pedido JA esta liberado para ATENDIMENTO (resultado final de recebimento). SCR detalha o FLUXO de aprovacao por ALCADA (quem, em que nivel, em que status) — use SCR apenas para identificar QUEM esta no caminho do bloqueio, nunca para decidir SE o pedido esta bloqueado (isso e sempre C7_CONAPRO).
- REGRA OBRIGATORIA — SEMPRE inclua o VALOR do pedido (SUM(SC7.C7_TOTAL)) na projecao, mesmo que o usuario nao peca valor explicitamente. SCR e cabecalho, mas SC7 e tabela de ITEM (varias linhas por pedido) — para nao duplicar o numero do pedido em N linhas, agrupe por SCR.CR_NUM (e demais colunas de identificacao) com SUM(SC7.C7_TOTAL) AS valor_pedido. Uma listagem de pedidos SEM nenhuma coluna de valor monetario e uma listagem incompleta — sempre agregue e exiba o valor.

### Linguagem de posse do proprio aprovador (remetente do WhatsApp)
- SCR tem UMA LINHA POR NIVEL de aprovacao (chave real: CR_FILIAL + CR_NUM + CR_TIPO + CR_NIVEL). CR_APROV identifica o aprovador responsavel APENAS por aquele nivel especifico — nao o pedido inteiro.
- "O que tenho que aprovar", "pedidos bloqueados/pendentes para eu aprovar", "minha alcada", "aguardando minha aprovacao": e uma variacao de "por aprovador" restrita ao proprio remetente — filtre SCR.CR_APROV = '<codigo do aprovador>' AND SC7.C7_CONAPRO = 'B' AND SCR.CR_STATUS IN ('01','02','04') (mesma logica da secao "por aprovador" acima: bloqueio consolidado no pedido + niveis nao liberados no fluxo).
- "O que eu ja aprovei" (hoje, ontem, na semana, no mes): este caso NAO e sobre bloqueio, e sim sobre o HISTORICO de liberacao no fluxo — aqui sim use SCR.CR_STATUS = '03' (liberado), pois C7_CONAPRO nao guarda quem/quando aprovou em cada nivel. Filtre SCR.CR_APROV = '<codigo do aprovador>' AND SCR.CR_STATUS = '03'. Para o periodo (hoje/mes/semana), use SCR.CR_DATALIB (data em que a liberacao de fato ocorreu) — NUNCA SCR.CR_EMISSAO (que e a emissao do documento original, nao a data da aprovacao).
- O codigo do aprovador vem do contexto tecnico (aprovadorFixo.codigo) quando a pergunta usa linguagem de posse referente ao proprio remetente — nunca peca o codigo ao usuario nem invente um.
- Se o usuario pedir "com os itens" ou "detalhado por item", nao agregue por SCR.CR_NUM: junte SC7 (1 linha por item, chave C7_FILIAL+C7_NUM+C7_ITEM) e exiba SC7.C7_ITEM, SC7.C7_PRODUTO e SC7.C7_TOTAL por linha, sem SUM nem GROUP BY. Sem pedido explicito de itens, mantenha o padrao agregado por pedido (SUM(SC7.C7_TOTAL) AS valor_pedido, agrupado por SCR.CR_NUM).
- REGRA ABSOLUTA — em linguagem de posse, SCR.CR_APROV = '<codigo do aprovador>' e OBRIGATORIO no WHERE em TODA variacao da query, inclusive quando o usuario pede "com os itens"/detalhamento por produto e o SQL ganha JOINs adicionais com SC7/SB1/SA2. Adicionar JOINs de item NUNCA e motivo para remover ou esquecer o filtro de CR_APROV do cabecalho SCR — ele continua valendo mesmo com mais tabelas na query.

### EXEMPLO CORRETO — pedidos de compra bloqueados/aguardando aprovacao, agrupados por aprovador
SELECT ${temNomeAprovador ? 'COALESCE(SAK.AK_NOME, SCR.CR_APROV)' : 'SCR.CR_APROV'} AS aprovador,
       CONVERT(VARCHAR(10), CAST(SCR.CR_EMISSAO AS DATE), 103) AS dia,
       SCR.CR_NUM AS numero_pedido,
       SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SCRxxx SCR
JOIN SC7xxx SC7 ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SC7.C7_CONAPRO = 'B' AND SC7.D_E_L_E_T_ = ' '
${temNomeAprovador ? "LEFT JOIN SAKxxx SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '\n" : ''}WHERE SCR.D_E_L_E_T_ = ' '
  AND SCR.CR_TIPO = 'PC'
  AND SCR.CR_STATUS IN ('01', '02', '04')
  AND SCR.CR_EMISSAO BETWEEN '20260701' AND '20260731'
GROUP BY ${temNomeAprovador ? 'COALESCE(SAK.AK_NOME, SCR.CR_APROV)' : 'SCR.CR_APROV'}, SCR.CR_EMISSAO, SCR.CR_NUM
ORDER BY aprovador, SCR.CR_EMISSAO, SCR.CR_NUM;

### EXEMPLO CORRETO — pedidos de compra APROVADOS, agrupados por dia, aprovador, pedido e valor
SELECT CONVERT(VARCHAR(10), CAST(SCR.CR_EMISSAO AS DATE), 103) AS dia,
       ${temNomeAprovador ? 'COALESCE(SAK.AK_NOME, SCR.CR_APROV)' : 'SCR.CR_APROV'} AS aprovador,
       SCR.CR_NUM AS numero_pedido,
       SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SCRxxx SCR
JOIN SC7xxx SC7 ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SC7.C7_CONAPRO IN ('L', '') AND SC7.D_E_L_E_T_ = ' '
${temNomeAprovador ? "LEFT JOIN SAKxxx SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '\n" : ''}WHERE SCR.D_E_L_E_T_ = ' '
  AND SCR.CR_TIPO = 'PC'
  AND SCR.CR_STATUS = '03'
  AND SCR.CR_DATALIB BETWEEN '20260701' AND '20260731'
GROUP BY CONVERT(VARCHAR(10), CAST(SCR.CR_EMISSAO AS DATE), 103), ${temNomeAprovador ? 'COALESCE(SAK.AK_NOME, SCR.CR_APROV)' : 'SCR.CR_APROV'}, SCR.CR_NUM
ORDER BY dia, aprovador, SCR.CR_NUM;
-- Nao confundir SCR.CR_EMISSAO (data de emissao do documento) com o periodo de aprovacao pedido pelo usuario: quando a pergunta for sobre pedidos APROVADOS num periodo (ex: "aprovados no mes passado"), filtre pela DATA DA LIBERACAO (SCR.CR_DATALIB), nao pela emissao — um pedido pode ter sido emitido num mes e liberado em outro.
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

// Linguagem de posse na 1a pessoa referente ao proprio remetente ("tenho que aprovar", "ja
// aprovei", "minhas aprovacoes", "bloqueados para eu aprovar"). Exportado para uso tambem em
// compras-ia-owner-spec.js (prepararIntent), que decide se injeta a entidadeSeguranca
// aprovador_fixo_seguranca — o mesmo criterio de deteccao precisa valer nos dois lugares:
// sem essas keywords a pergunta cai so em status_pedido_compra (SC7.C7_APROV) e a IA nunca ve
// a regra de SCR nem o filtro por CR_APROV do proprio aprovador.
const KEYWORDS_POSSE_APROVADOR = [
  /\b(?:tenho|preciso|tem)\s+(?:que\s+)?aprovar\b/i, /\bpara\s+(?:eu\s+)?aprovar\b/i, /\bpra\s+(?:eu\s+)?aprovar\b/i,
  /\b(?:eu\s+)?j[aá]\s+aprovei\b/i, /\baprovei\s+(?:hoje|ontem|essa?\s+semana|este\s+m[eê]s|esse\s+m[eê]s|no\s+m[eê]s)\b/i,
  /\bo\s+que\s+(?:eu\s+)?aprovei\b/i, /\bminhas?\s+aprova[cç][oõ]es\b/i, /\bbloqueados?\s+para\s+(?:eu\s+)?aprovar\b/i,
  /\bpendentes?\s+(?:para|de)\s+(?:eu\s+)?aprovar\b/i, /\baguardando\s+(?:minha\s+)?aprova[cç][aã]o\b/i,
  /\bminha\s+alcada\b/i,
];

function mensagemUsaLinguagemPosseAprovador(mensagem) {
  const texto = String(mensagem || '');
  return KEYWORDS_POSSE_APROVADOR.some(re => re.test(texto));
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
  status_pedido_compra: {
    texto: statusPedidoCompra,
    keywords: [/\bpedidos?\s+de\s+compras?\b/i, /\bpedidos?\s+em\s+aberto\b/i, /\bpedidos?\s+atendidos?\b/i, /\bpedidos?\s+aprovados?\b/i, /\bpedidos?\s+n[aã]o\s+aprovados?\b/i, /\bpedidos?\s+pendentes?\s+de\s+aprova[cç][aã]o\b/i, /\bpedidos?\s+bloqueados?\b/i, /\bbloquead\w*/i, /\bC7_APROV\b/i, /\bC7_CONAPRO\b/i, /\bPCs?\b/i],
  },
  aprovacao_pedido_compra: {
    texto: aprovacaoPedidoCompra,
    keywords: [
      /\bpor\s+aprovador\b/i, /\baprovador(?:es)?\b/i, /\bal[cç]ada\b/i, /\bn[ií]vel(?:eis)?\s+de\s+aprova[cç][aã]o\b/i,
      /\bpendente(?:s)?\s+de\s+(?:libera[cç][aã]o|aprova[cç][aã]o)\b/i, /\bfluxo\s+de\s+aprova[cç][aã]o\b/i, /\bCR_APROV\b/i, /\bSCR\b/,
      ...KEYWORDS_POSSE_APROVADOR,
    ],
    requerJunto: ['status_pedido_compra'],
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
  'status_pedido_compra',
  'aprovacao_pedido_compra',
];

module.exports = { base, FRAGMENTOS, ORDEM_FALLBACK, mensagemUsaLinguagemPosseAprovador };
