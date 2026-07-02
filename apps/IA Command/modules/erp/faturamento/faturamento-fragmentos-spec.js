'use strict';

/**
 * Fragmentos de regrasTecnicas do faturamento, organizados por sub-operacao
 * (devolucoes, metrica valor total, metrica quantidade/item, fiscal, frequencia
 * de cliente, media, crescimento, comparativo entre periodos) em vez de um
 * unico bloco monolitico.
 *
 * A concatenacao de TODOS os fragmentos (fallback, quando a pergunta nao
 * classifica em nenhuma sub-operacao especifica) reproduz o regrasTecnicas
 * anterior, preservando os testes existentes.
 *
 * keywords: regex que, ao casar com a mensagem do usuario, aciona o fragmento.
 * excluiSe: regex que desativa o fragmento mesmo que keywords tenha batido.
 * requerJunto: outros fragmentos que devem ser injetados sempre que este for acionado.
 */

function base() {
  return `
## Campo de data padrao
- Faturamento: SF2.F2_EMISSAO (CHAR(8) YYYYMMDD).
- Devolucoes de venda: SF1.F1_DTDIGIT ou SF1.F1_EMISSAO; prefira SF1.F1_DTDIGIT.

## Tabelas padrao do modulo Faturamento
- SF2: cabecalho de NF de saida. Metrica geral preferencial: SF2.F2_VALBRUT quando nao precisar de item.
- SD2: itens de NF de saida. Use para produto, grupo, quantidade, valor medio, TES, centro de custo e faturamento liquido com devolucoes. Metrica de item: SD2.D2_TOTAL. Quantidade: SD2.D2_QUANT.
- Tipos de nota fiscal de saida no Protheus (SF2.F2_TIPO): N=Normal (venda real), D=Devolucao de cliente, B=Beneficiamento (envio para conserto/industrializacao por terceiro), I=Complementar de impostos (correcao de ICMS/IPI), P=Complementar alternativo. Apenas tipo 'N' representa receita de venda de produtos.
- REGRA OBRIGATORIA — SF2.F2_TIPO = 'N': toda consulta de faturamento/receita que use SF2 deve filtrar SF2.F2_TIPO = 'N' no WHERE, sem excecao. Notas tipo 'D' (devolucao), 'B' (beneficiamento), 'I'/'P' (complementar) nao representam receita real de venda e distorceriam o resultado. Nunca use SF2.F2_TIPO = '1'.
- SF1: cabecalho de NF de entrada; para devolucao de venda use SF1.F1_TIPO = 'D'.
- SD1: itens de NF de entrada; para valor de devolucao use SD1.D1_TOTAL.
- SA1: clientes.
- SA3: vendedores.
- SB1: produtos.
- SBM: grupo de produtos.
- SF4: TES.
- CTT: centro de custo.

## Joins padrao
- SD2 -> SF2:
  SD2.D2_FILIAL = SF2.F2_FILIAL
  AND SD2.D2_DOC = SF2.F2_DOC
  AND SD2.D2_SERIE = SF2.F2_SERIE
  AND SD2.D2_CLIENTE = SF2.F2_CLIENTE
  AND SD2.D2_LOJA = SF2.F2_LOJA
- SF2 -> SA1:
  SF2.F2_CLIENTE = SA1.A1_COD
  AND SF2.F2_LOJA = SA1.A1_LOJA
- SF2 -> SA3: SF2.F2_VEND1 = SA3.A3_COD
- SD2 -> SB1: SD2.D2_COD = SB1.B1_COD
- SB1 -> SBM: SB1.B1_GRUPO = SBM.BM_GRUPO
- SD2 -> SF4: SD2.D2_TES = SF4.F4_CODIGO
- SD2 -> CTT: SD2.D2_CCUSTO = CTT.CTT_CUSTO
- SD1 -> SF1:
  SD1.D1_FILIAL = SF1.F1_FILIAL
  AND SD1.D1_DOC = SF1.F1_DOC
  AND SD1.D1_SERIE = SF1.F1_SERIE
  AND SD1.D1_FORNECE = SF1.F1_FORNECE
  AND SD1.D1_LOJA = SF1.F1_LOJA
- Regra tecnica: sempre que SD1 e SF1 forem usados juntos para somar SD1.D1_TOTAL, o JOIN deve conter D1_FORNECE/F1_FORNECE e D1_LOJA/F1_LOJA para evitar duplicidade de notas com mesmo numero e serie.
- SF1 -> SA1 para devolucao de venda:
  SF1.F1_FORNECE = SA1.A1_COD
  AND SF1.F1_LOJA = SA1.A1_LOJA

## Regras obrigatorias de SQL
- Inicie sempre com SET ROWCOUNT 50000.
- Use aliases explicitos iguais a base da tabela: SF2, SD2, SF1, SD1, SA1, SA3, SB1, SBM, SF4, CTT.
- Qualifique campos sempre pelo alias base (SD2.D2_TOTAL, nunca SD2990.D2_TOTAL).
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.

## Exibicao de entidades
Sempre retorne nome/descricao para o usuario. Codigo sozinho nao serve.
- cliente: SA1.A1_NOME AS cliente. Codigo/loja podem vir como cod_cliente e loja_cliente.
- vendedor: SA3.A3_NOME AS vendedor.
- produto: SB1.B1_DESC AS produto. Codigo pode vir como cod_produto.
- grupo_produto: SBM.BM_DESC AS grupo_produto.
- centro_custo: CTT.CTT_DESC01 AS centro_custo.
- tes: SF4.F4_TEXTO AS tes.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.

## Regra Critica — entidades_necessarias Somente para Nomes Proprios Cadastrais
- PROIBIDO declarar em entidades_necessarias qualquer texto que seja uma condicao de filtro, criterio operacional ou frase descritiva — ex: "possuem faturamento todos os meses", "maior volume", "todos os clientes ativos", "com faturamento em todos os meses".
- entidades_necessarias e EXCLUSIVAMENTE para nomes proprios de entidades cadastrais: nome de cliente, nome de produto, nome de vendedor, nome de grupo de produto, etc.
- Se a pergunta nao citar um nome proprio de entidade cadastral, deixe entidades_necessarias vazio ([]).
- Teste interno: o texto declarado seria resultado valido de LIKE '%...%' em SA1.A1_NOME ou SB1.B1_DESC? Se nao for um nome proprio real, nao declare.

## Entidades cadastrais
Quando precisar filtrar cliente, vendedor, produto, grupo_produto, centro_custo ou TES por nome citado pelo usuario, retorne em entidades_necessarias.
Depois que o sistema devolver entidades_resolvidas, filtre por codigo interno, nao por LIKE de nome.
Para cliente SEM LOJA ou todos os registros do mesmo codigo, filtre apenas o codigo quando a entidade resolvida indicar _todos.
- Se a mensagem mencionar "empresa(s) J2A/C3I/todas as empresas" ou o estado tecnico trouxer empresas_iahub_mencionadas, trate esses nomes como escopo de tenant IAHub, nunca como cliente. Nao gere filtro em SA1.A1_NOME, SA1.A1_FILIAL ou subquery em SA1 por esses termos.
- REGRA CRITICA — palavra "empresa" como escopo de tenant: Quando a mensagem usa "empresa(s) [NOME1] e/ou [NOME2]" e esses nomes estao em empresas_iahub_mencionadas, a palavra "empresa" indica APENAS o escopo de execucao multiempresa. Ela NAO e um agrupamento SQL nem um filtro cadastral. Nao adicione GROUP BY, nao agrupe por empresa, nao filtre por cliente/filial baseado nesses nomes. O backend ja executa uma query separada por tenant — voce so precisa gerar o SQL correto para UM tenant.
- REGRA CRITICA — agrupamentos: ["empresa"] no estado anterior: Quando contrato_orquestrador ou estado anterior trouxer agrupamentos: ["empresa"], isso e metadata do backend (agrupamento multiempresa para exibicao), NAO e instrucao para GROUP BY SQL. Ignore-o na geracao do SQL. So adicione GROUP BY SQL quando o usuario pedir explicitamente agrupamento por mes, cliente, produto, vendedor, etc.

## Metrica por agrupamento
- "por mes": SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia no SELECT e GROUP BY.
- "por cliente": agrupe por SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
- "por vendedor": agrupe por SA3.A3_COD, SA3.A3_NOME.
- "por produto": agrupe por SB1.B1_COD, SB1.B1_DESC.
`;
}

function devolucoes() {
  return `
## Devolucoes de Vendas
- Nao inclua devolucoes de vendas nas metricas de faturamento por padrao.
- Somente considere devolucoes quando o usuario pedir explicitamente: devolucao, devolucoes, retorno, estorno, abatendo devolucoes, considerar devolucoes, faturamento liquido.
- "considerando devolucoes", "com devolucoes", "abatendo devolucoes" ou "faturamento liquido" significa faturamento bruto menos devolucoes de vendas.
- So retorne apenas devolucoes quando o usuario disser claramente "somente devolucoes", "apenas devolucoes", "total de devolucoes" ou equivalente.
- No Protheus, devolucao de venda e nota de entrada do SIGACOM: use obrigatoriamente SF1/SD1, com SF1.F1_TIPO = 'D'. Nao use SF4/TES nem CASE em SD2 para identificar devolucao de venda.
- Quando o usuario pedir para considerar devolucoes, faturamento liquido ou abatendo devolucoes, monte obrigatoriamente uma consulta externa sobre subqueries unificadas por UNION ALL:
  1. Subquery de faturamento: origem SD2/SF2. Filtre SF2.F2_TIPO IN ('N','C','I') quando o campo existir no SX3. Projete COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_faturamento e 0 AS valor_devolucao.
  2. Subquery de devolucoes de vendas: origem SD1/SF1. Filtre SF1.F1_TIPO = 'D'. Projete 0 AS valor_faturamento e COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_devolucao.
- A query externa deve selecionar SUM(valor_faturamento) AS total_faturamento, SUM(valor_devolucao) AS total_devolucoes e (SUM(valor_faturamento) - SUM(valor_devolucao)) AS faturamento_liquido.
- REGRA ABSOLUTA — cada subquery do UNION ALL deve ser ESCALAR (sem GROUP BY, retornando 1 linha com o total já agregado por SUM). PROIBIDO agrupar a subquery por chave de documento (filial+doc+serie+cliente/loja) — isso gera 1 linha por nota fiscal em vez de 1 linha com o total, tornando o UNION ALL inutilmente grande e fragil (funciona apenas porque o SUM externo soma todas as linhas, mas qualquer alteração futura na query externa quebra o resultado).
- Aplique o mesmo periodo e os mesmos filtros cadastrais nas duas subqueries quando fizer sentido. Para faturamento use SF2.F2_EMISSAO. Para devolucoes use SF1.F1_DTDIGIT ou SF1.F1_EMISSAO conforme campos disponiveis.
- Nota Protheus: na devolucao de vendas (SF1 tipo D), o codigo do cliente e gravado em SF1.F1_FORNECE/SD1.D1_FORNECE e loja em SF1.F1_LOJA/SD1.D1_LOJA. Se houver filtro de cliente resolvido, filtre faturamento por SF2.F2_CLIENTE/F2_LOJA e devolucoes por SF1.F1_FORNECE/F1_LOJA.
- Resposta planejada com devolucoes: "Faturamento Bruto: {total_faturamento} | Devolucoes: {total_devolucoes} | Liquido: {faturamento_liquido}"

### EXEMPLO CORRETO — faturamento liquido (subqueries escalares, sem GROUP BY por documento)
SELECT SUM(valor_faturamento) AS total_faturamento, SUM(valor_devolucao) AS total_devolucoes,
       (SUM(valor_faturamento) - SUM(valor_devolucao)) AS faturamento_liquido
FROM (
  SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS valor_faturamento, 0 AS valor_devolucao
  FROM SD2xxx SD2
  JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20260601' AND '20260630' AND SF2.F2_TIPO IN ('N','C','I')
  UNION ALL
  SELECT 0 AS valor_faturamento, COALESCE(SUM(SD1.D1_TOTAL), 0) AS valor_devolucao
  FROM SD1xxx SD1
  JOIN SF1xxx SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
  WHERE SF1.D_E_L_E_T_ = ' ' AND SD1.D_E_L_E_T_ = ' ' AND SF1.F1_DTDIGIT BETWEEN '20260601' AND '20260630' AND SF1.F1_TIPO = 'D'
) AS subquery;
`;
}

function metricaValorTotal() {
  return `
## DIRETRIZ DE SELECAO DE TABELAS: Cabecalho (SF2) vs Itens (SD2)
Avalie a METRICA e a granularidade da pergunta para determinar a estrutura do FROM/JOIN. O uso incorreto gera duplicidade matematica ou metricas zeradas.

### Consultas por VALOR Financeiro Total (sem produto/item)
- Quando o usuario pedir "Total de faturamento", "Faturamento do ano", "Faturamento do mes" ou "Faturamento de um periodo" — metricas puramente monetarias, sem especificar produto, grupo de produto ou QUANTIDADE de itens — use OBRIGATORIAMENTE APENAS a tabela de cabecalho SF2.
- Metrica escalar obrigatoria: COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento.
- FILTRO OBRIGATORIO: inclua SEMPRE SF2.F2_TIPO = 'N' no WHERE junto com D_E_L_E_T_ = ' '. Isso exclui devolucoes de compras (tipo 'D'), complementos e outros tipos que nao representam receita de venda. Exemplo: WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N' AND SF2.F2_EMISSAO BETWEEN '...' AND '...'.
- Agrupamentos por cliente, vendedor ou natureza sao compativeis com SF2 sozinha: faca JOIN com SA1 (via Joins padrao SF2->SA1), SA3 ou SED conforme o agrupamento pedido. SD2 nao entra neste caminho.
- EXPRESSAMENTE PROIBIDO fazer JOIN com SD2 nesses casos de valor total: o relacionamento 1-para-muitos multiplica F2_VALBRUT pela quantidade de itens da nota, gerando valores duplicados errados.
`;
}

function metricaQuantidadeItem() {
  return `
### Consultas por QUANTIDADE ou filtros de Produto/Item
- Quando o usuario pedir "Quantidade faturada", "Volume de vendas", "Total de pecas vendidas" (mesmo que seja total escalar de uma unica linha), ou quando citar produtos e grupos de produtos, use OBRIGATORIAMENTE a tabela de itens SD2 fazendo JOIN com SF2 (para validar periodo de emissao e F2_TIPO = 'N').
- Metrica de quantidade escalar obrigatoria: COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada.
- NUNCA use SF2 sozinha quando a pergunta contiver "Quantidade": o cabecalho nao armazena volume de itens vendidos.
- Quando o agrupamento ou filtro for por produto, grupo de produto, TES ou centro de custo: use SD2 JOIN SF2 e adote SUM(SD2.D2_TOTAL) como metrica de valor.
- REGRA DE EXCLUSIVIDADE DE METRICA: SD2 e F2_VALBRUT sao mutuamente exclusivos. Quando SD2 estiver no FROM ou em qualquer JOIN, use OBRIGATORIAMENTE SUM(SD2.D2_TOTAL) para valor e SUM(SD2.D2_QUANT) para quantidade. Nunca use SUM(SF2.F2_VALBRUT) quando SD2 estiver presente — a multiplicidade da relacao 1-para-N inflaria todos os valores.
- Quando o usuario pedir SIMULTANEAMENTE "por valor" e "por quantidade" com agrupamento por produto/grupo/mes/cliente: ambas as metricas devem vir de SD2. Exemplo: SELECT ..., COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_total, COALESCE(SUM(SD2.D2_QUANT),0) AS quantidade_faturada FROM SD2... JOIN SF2...
`;
}

function cfopTesCentroCusto() {
  return `
## Codigo Fiscal (CF/CFOP), TES e modos fiscais de quantidade — Faturamento
- Sinonimos para nota fiscal de saida/faturamento: nota de saida, nota fiscal de saida, NF de saida, faturamento, venda.
- CF, CFOP, codigo fiscal e codigo fiscal de operacao sao sinonimos — referem-se ao campo SD2.D2_CF.
- Por padrao, em consultas de receita de vendas, faturamento financeiro ou quantidade faturada, excluir simples remessa e transferencia:
  SD2.D2_CF NOT LIKE '59%' AND SD2.D2_CF NOT LIKE '60%'
  Razao: CFs iniciados com 59 ou 60 sao simples remessa/transferencia — nao representam venda que gerou financeiro.
- Modos fiscais de quantidade:
  - Quantidade faturada: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF NOT LIKE '59%' AND SD2.D2_CF NOT LIKE '60%'.
  - Quantidade carregada: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF <> '5117'.
  - Entrega futura, venda para entrega futura ou nota mae: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF = '5117'.
  - Movimentacao total, todas as saidas, volume total, sem filtro fiscal ou incluindo remessa/transferencia: SUM(SD2.D2_QUANT) sem filtro em SD2.D2_CF.
- TES pode ser chamado de TES ou Tipos de Saida. Refere-se ao campo SD2.D2_TES / tabela SF4 (F4_CODIGO, F4_TEXTO).
- SF4.F4_ESTOQUE: 'S' = TES gera movimentacao de estoque; 'N' = nao gera.
  Quando o usuario perguntar sobre notas que geraram estoque ou movimentaram estoque, filtre SF4.F4_ESTOQUE = 'S' via JOIN SD2 -> SF4.
- SF4.F4_DUPLIC: 'S' = TES gera lancamento financeiro (duplicata/receber); 'N' = nao gera financeiro.
  Quando o usuario perguntar sobre notas que geraram financeiro, contas a receber ou duplicatas, filtre SF4.F4_DUPLIC = 'S' via JOIN SD2 -> SF4.
  Este filtro e mais preciso que filtrar por CF para identificar notas de receita real.
`;
}

function frequenciaCliente() {
  return `
## Frequencia de faturamento por cliente
- Para queries de frequencia por cliente (ex: "clientes com faturamento em todos os meses"):
  FROM SF2990 SF2
  JOIN SA1990 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '
  WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
  GROUP BY SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME
  HAVING COUNT(DISTINCT SUBSTRING(SF2.F2_EMISSAO, 5, 2)) = CAST(SUBSTRING(data_atual, 5, 2) AS INT)  -- ou = 12 para ano encerrado
`;
}

const TRUNC_POR_GRANULARIDADE = {
  diaria: { tam: 8, alias: 'dia' },
  mensal: { tam: 6, alias: 'competencia' },
  anual: { tam: 4, alias: 'ano' },
};

function media({ granularidade = 'mensal' } = {}) {
  const { tam, alias } = TRUNC_POR_GRANULARIDADE[granularidade] || TRUNC_POR_GRANULARIDADE.mensal;
  return `
## Media de faturamento — granularidade ${granularidade}
- Subquery/CTE interna agrupa por SUBSTRING(SF2.F2_EMISSAO,1,${tam}) AS ${alias}, exportando COALESCE(SUM(SF2.F2_VALBRUT),0) AS faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}.
- Media mensal por ano (subquery agrupada por nivel maior): Subquery interna OBRIGATORIAMENTE exporta DOIS aliases de data: o nivel de detalhe (ex: SUBSTRING(SF2.F2_EMISSAO,1,6) AS competencia) E o nivel de agrupamento externo (ex: SUBSTRING(SF2.F2_EMISSAO,1,4) AS ano). Nunca exporte so o nivel de detalhe — sem o alias do nivel externo, a query externa nao consegue agrupar (GROUP BY h.ano).
- REGRA DE DECISAO — agrupar ou nao na query externa: SO agrupe a query externa (GROUP BY h.<nivel_externo>) quando o usuario pedir explicitamente a media "POR" o nivel externo (ex: "media mensal POR ano" = uma media para cada ano, GROUP BY h.ano). Quando o usuario pedir a media de UM CONJUNTO de periodos especificos sem dizer "por" (ex: "media anual considerando 2025 e 2026", "media anual dos ultimos 2 anos", "media mensal de 2026") — mesmo citando varios periodos — o resultado e ESCALAR (1 linha, sem GROUP BY na query externa): a subquery interna filtra os periodos pedidos no WHERE, e a query externa faz AVG(h.faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}) sem GROUP BY, calculando a media UNICA entre todos os periodos filtrados. PROIBIDO agrupar por h.ano/h.competencia/h.dia quando o usuario apenas cita os periodos a incluir na media, sem pedir "por ano/mes/dia".
- Query externa (quando agrupada, ex: "media mensal por ano"): SELECT h.<nivel_externo>, AVG(h.faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}) AS media FROM (...) AS h GROUP BY h.<nivel_externo>.
- Media mensal escalar (1 ano especifico, caso mais comum — usuario nao pediu "por" nivel externo): Query externa: SELECT AVG(h.faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}) AS media FROM (...) AS h. Sem GROUP BY. HAVING SUM > 0 na subquery interna se o usuario pedir so periodos com faturamento.
- Media anual escalar: subquery interna SUM por ano (filtrando no WHERE os anos pedidos, ex: SUBSTRING(SF2.F2_EMISSAO,1,4) IN ('2025','2026')) → query externa AVG dos totais anuais SEM GROUP BY. Camada externa usa SOMENTE h.faturamento_ano — nunca SF2.*. Retorna 1 linha.
- Camada externa usa SOMENTE os aliases exportados pela subquery (h.<...>) — NUNCA referencie SF2.* fora da subquery/CTE.
- Media mensal por produto: quando o usuario pedir "faturamento medio por produto" ou equivalente, a SQL da IA ja deve calcular a media correta; o backend nao recalcula nem corrige a metrica. Use obrigatoriamente duas camadas: (1) subquery interna agrupada por SB1.B1_COD, SB1.B1_DESC e ${alias} (SUBSTRING(SF2.F2_EMISSAO,1,${tam})), com SUM(SD2.D2_TOTAL) AS faturamento_${alias}; (2) query externa agrupada somente por h.cod_produto, h.produto, com AVG(h.faturamento_${alias}) AS faturamento_medio. Aplique periodo, F2_TIPO e D_E_L_E_T_ dentro da subquery interna, nos aliases reais SD2/SF2/SB1. A query externa deve referenciar apenas aliases exportados por h; nunca referencie SD2, SF2 ou SB1 fora da subquery.
- NUNCA use AVG(SF2.F2_VALBRUT) diretamente sobre a tabela fato: isso calcula ticket medio por nota fiscal, nao media de periodo.
- NUNCA use AVG(SD2.D2_TOTAL) ou AVG(SD2.D2_VALBRUT) diretamente sobre a tabela fato: isso calcula media de linha/item, nao media de periodo.
`;
}

function crescimento({ granularidade = 'mensal' } = {}) {
  const { tam, alias } = TRUNC_POR_GRANULARIDADE[granularidade] || TRUNC_POR_GRANULARIDADE.mensal;
  return `
## Crescimento mensal / variacao mensal / evolucao mes a mes (granularidade ${granularidade})
- Quando o usuario pedir faturamento por ${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'} demonstrando crescimento, variacao, aumento, queda ou evolucao, a SQL deve calcular a comparacao contra o periodo anterior (LAG). Nao retorne apenas ${alias} + faturamento.
- Use duas camadas: (1) subquery/CTE com SUBSTRING(SF2.F2_EMISSAO,1,${tam}) AS ${alias} e COALESCE(SUM(SF2.F2_VALBRUT),0) AS faturamento; (2) query externa com h.${alias}, h.faturamento, LAG(h.faturamento) OVER (ORDER BY h.${alias}) AS faturamento_anterior, (h.faturamento - LAG(h.faturamento) OVER (ORDER BY h.${alias})) AS crescimento_valor e CASE WHEN LAG(h.faturamento) OVER (ORDER BY h.${alias}) IS NULL OR LAG(h.faturamento) OVER (ORDER BY h.${alias}) = 0 THEN NULL ELSE ((h.faturamento - LAG(h.faturamento) OVER (ORDER BY h.${alias})) * 100.0 / LAG(h.faturamento) OVER (ORDER BY h.${alias})) END AS crescimento_percentual.
- Na query externa use SOMENTE aliases exportados pela camada interna (h.${alias}, h.faturamento). NUNCA referencie SF2.* fora da subquery/CTE.
- Se o usuario pedir "crescimento" sem especificar valor ou percentual, inclua ambos: crescimento_valor e crescimento_percentual. O primeiro periodo deve ficar com crescimento_percentual NULL por nao haver periodo anterior.
`;
}

function comparativoPeriodos() {
  return `
## Comparativo entre periodos especificos (nao necessariamente adjacentes)
- Diferente de crescimento (que compara cada periodo com o IMEDIATAMENTE anterior via LAG), comparativo trata de periodos ESPECIFICOS escolhidos pelo usuario, que podem nao ser adjacentes (ex: "junho de 2025 vs junho de 2026", "este ano comparado a 2 anos atras", "marco e setembro").
- Para comparar UM periodo de referencia contra OUTROS periodos (ex: "junho/2026 comparado com junhos anteriores, trazendo os menores"): o periodo de REFERENCIA vai em subquery escalar SEM GROUP BY (retorna 1 valor); os periodos COMPARADOS ficam na query principal com GROUP BY.
- PROIBIDO: subquery com GROUP BY dentro de uma comparacao escalar (=, <, >, <=, >=, HAVING). GROUP BY na subquery retorna N linhas, causando erro do SQL Server ("Subquery returned more than 1 value").
- CORRETO: HAVING SUM(SF2.F2_VALBRUT) < (SELECT SUM(F2_VALBRUT) FROM SF2... WHERE <periodo_referencia>) — subquery sem GROUP BY, retorna 1 linha escalar.
- Para comparar MULTIPLOS periodos especificos lado a lado (ex: "2024 vs 2025 vs 2026", "marco e setembro de 2024 e 2025"): use GROUP BY pela mesma dimensao em todos, com filtro WHERE restringindo exatamente aos periodos pedidos (ex: SUBSTRING(SF2.F2_EMISSAO,1,4) IN ('2024','2026') quando o usuario pular anos intermediarios).
- Granularidade do comparativo (dia/mes/ano) e definida pela pergunta do usuario — use SUBSTRING(SF2.F2_EMISSAO,1,8) para dia, 1,6 para mes, 1,4 para ano, sempre consistente entre os periodos comparados.
- REGRA ABSOLUTA — calculo de competencia "mesmo mes, ano diferente": ao montar o valor de competencia (formato AAAAMM) para "mesmo mes do ano anterior/seguinte", o MES permanece IDENTICO e SOMENTE o ANO muda. Erro comum a evitar: ao comparar "junho de 2026 com junho de 2025", o periodo comparado e competencia = '202506' (ano 2025, mes 06) — NUNCA mude o mes ao trocar o ano (ex: gerar '202505' seria errado, pois mudou o mes de 06 para 05 junto com o ano). Construa cada competencia explicitamente como CONCAT(ano, mes) ou string literal com os 4 digitos do ano + 2 digitos do mes do periodo de referencia, nunca subtraindo do valor numerico da competencia inteira.
- EXEMPLO CORRETO — junho/2026 vs junho/2025: SUBSTRING(SF2.F2_EMISSAO,1,6) IN ('202606', '202506') — mesmo mes "06" nos dois anos.
`;
}

const FRAGMENTOS = {
  devolucoes: {
    texto: devolucoes,
    keywords: [/\bdevolu\w*/i, /\bestorno\b/i, /\bretorno\b/i, /\bl[ií]quido\b/i, /\babatendo\b/i],
  },
  metrica_valor_total: {
    texto: metricaValorTotal,
    keywords: [/\bfaturamento\s+(do|de|no)\s+(mes|ano|periodo)\b/i, /\btotal\s+de\s+faturamento\b/i],
    excluiSe: [/\bquantidade\b/i, /\bvolume\b/i, /\bpeças?\b|\bpecas?\b/i, /\bproduto\w*\b/i, /\bgrupo\b/i],
  },
  metrica_quantidade_item: {
    texto: metricaQuantidadeItem,
    keywords: [/\bquantidade\b/i, /\bvolume\b/i, /\bpe[çc]as?\b/i, /\bproduto\w*\b/i, /\bgrupo\s+de\s+produto\w*\b/i],
  },
  cfop_tes_centro_custo: {
    texto: cfopTesCentroCusto,
    keywords: [/\bCFOP\b/i, /\bCF\b/, /\bTES\b/, /\bcarregad[ao]\b/i, /\bentrega\s+futura\b/i, /\bnota\s+mae\b/i, /\bestoque\b/i, /\bcentro\s+de\s+custo\b/i],
  },
  frequencia_cliente: {
    texto: frequenciaCliente,
    keywords: [/\btodos\s+os\s+meses\b/i, /\bfrequ[eê]ncia\b/i, /\brecorr[eê]ncia\b/i, /\btodo\s+mes\b/i],
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
  'cfop_tes_centro_custo',
  'frequencia_cliente',
  'media_diaria',
  'media_mensal',
  'media_anual',
  'crescimento_diario',
  'crescimento_mensal',
  'crescimento_anual',
  'comparativo_periodos',
];

module.exports = { base, FRAGMENTOS, ORDEM_FALLBACK };
