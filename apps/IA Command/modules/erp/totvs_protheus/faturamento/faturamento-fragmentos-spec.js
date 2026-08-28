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
- SF2: cabecalho de NF de saida. Sempre em JOIN com SD2 para consultas de faturamento (ver DIRETRIZ DE SELECAO DE TABELAS abaixo) — nao use F2_VALBRUT como metrica de valor.
- SD2: itens de NF de saida. Metrica de valor padrao para TODA consulta de faturamento: SD2.D2_TOTAL (ou SD2.D2_TOTAL - SD2.D2_VALDEV para liquido). Quantidade: SD2.D2_QUANT.
- Tipos de nota fiscal de saida no Protheus (SF2.F2_TIPO): N=Normal (venda real), D=Devolucao de cliente, B=Beneficiamento (envio para conserto/industrializacao por terceiro), I=Complementar de impostos (correcao de ICMS/IPI), P=Complementar alternativo. Apenas tipo 'N' representa receita de venda de produtos.
- REGRA OBRIGATORIA — SF2.F2_TIPO = 'N': toda consulta de faturamento/receita que use SF2 deve filtrar SF2.F2_TIPO = 'N' no WHERE, sem excecao. Notas tipo 'D' (devolucao), 'B' (beneficiamento), 'I'/'P' (complementar) nao representam receita real de venda e distorceriam o resultado. Nunca use SF2.F2_TIPO = '1'.
- SF1: cabecalho de NF de entrada; para devolucao de venda use SF1.F1_TIPO = 'D'.
- SD1: itens de NF de entrada; para valor de devolucao use SD1.D1_TOTAL.
- SA1: clientes.
- ACY: grupo de cliente. Vinculado a SA1 via SA1.A1_GRPVEN = ACY.ACY_GRPVEN. Use LEFT JOIN (cliente pode nao ter grupo).
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
- SA1 -> ACY (grupo de cliente): LEFT JOIN ACY<sufixo> ACY ON ACY.ACY_GRPVEN = SA1.A1_GRPVEN AND ACY.D_E_L_E_T_ = ' '. OBRIGATORIO: LEFT JOIN porque cliente pode nao ter grupo cadastrado. Requer JOIN SA1 antes.
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
- Use aliases explicitos iguais a base da tabela: SF2, SD2, SF1, SD1, SA1, SA3, SB1, SBM, SF4, CTT, ACY.
- Qualifique campos sempre pelo alias base (SD2.D2_TOTAL, nunca SD2990.D2_TOTAL).
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.

## Exibicao de entidades
Sempre retorne nome/descricao para o usuario. Codigo sozinho nao serve.
- cliente: SA1.A1_NOME AS cliente. Codigo/loja podem vir como cod_cliente e loja_cliente.
- grupo_cliente: ACY.ACY_DESCRI AS grupo_cliente. Codigo pode vir como cod_grupo_cliente (ACY.ACY_GRPVEN).
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
- "por grupo de cliente": faca LEFT JOIN ACY<sufixo> ACY ON ACY.ACY_GRPVEN = SA1.A1_GRPVEN AND ACY.D_E_L_E_T_ = ' ' e agrupe por ACY.ACY_GRPVEN, ACY.ACY_DESCRI. Exiba ACY.ACY_DESCRI AS grupo_cliente no SELECT.
- "por vendedor": agrupe por SA3.A3_COD, SA3.A3_NOME.
- "por vendedor": use somente o vendedor principal da nota: JOIN SA3<sufixo> SA3 ON SF2.F2_VEND1 = SA3.A3_COD AND SA3.D_E_L_E_T_ = ' '. PROIBIDO usar OR com SF2.F2_VEND2..F2_VEND5, pois duplica o valor quando a nota possui mais de um vendedor.
- "por produto": agrupe por SB1.B1_COD, SB1.B1_DESC.
- "por grupo de produto": faca JOIN SB1 e JOIN SBM, exiba SBM.BM_DESC AS grupo_produto e agrupe SOMENTE por SBM.BM_GRUPO, SBM.BM_DESC. NAO inclua SB1.B1_COD/produto no SELECT/GROUP BY salvo se o usuario pedir tambem "por produto".
- REGRA CRITICA SQL Server — GROUP BY com SA1: Sempre que SA1 estiver no JOIN e qualquer campo de SA1 aparecer no SELECT ou GROUP BY, inclua SA1.A1_COD e SA1.A1_LOJA obrigatoriamente no GROUP BY. O SQL Server nao aceita referenciar SA1.A1_COD ou SA1.A1_LOJA em subqueries correlacionadas se eles nao estiverem no GROUP BY da query externa (erro 8120).
- REGRA CRITICA — subquery correlacionada com SA1: NUNCA use SA1.A1_COD ou SA1.A1_LOJA como correlacao em subquery se SA1 esta na query externa com GROUP BY. Use UNION ALL com subqueries escalares conforme o padrao de devolucoes.
`;
}

function devolucoes() {
  return `
## Devolucoes de Vendas
- Nao inclua devolucoes de vendas nas metricas de faturamento por padrao.
- Somente considere devolucoes quando o usuario pedir explicitamente: devolucao, devolucoes, retorno, estorno, abatendo devolucoes, considerar devolucoes, faturamento liquido.
- "considerando devolucoes", "com devolucoes", "abatendo devolucoes" ou "faturamento liquido" significa faturamento bruto menos devolucoes de vendas.
- "considerando devolucoes"/"com devolucoes" SEMPRE significa liquido (bruto - devolvido), nunca soma separada.
- REGRA CRITICA — 2 casos de devolucao, NUNCA misture os padroes: (1) pergunta envolve faturamento/quantidade/carregada JUNTO com devolucao (ex: "faturamento do mes considerando devolucoes", "quantidade carregada com devolucoes") → SEMPRE use os campos de devolucao ja vinculados ao item na propria SD2: SD2.D2_VALDEV (valor devolvido) e SD2.D2_QTDEDEV (quantidade devolvida). Formula: SUM(SD2.D2_TOTAL - SD2.D2_VALDEV) para valor liquido, SUM(SD2.D2_QUANT - SD2.D2_QTDEDEV) para quantidade liquida. NUNCA use UNION ALL nem SD1/SF1 neste caso — SD2 ja tem o dado da devolucao por item, sem precisar de outra tabela. Ver EXEMPLO 1 e EXEMPLO 2 abaixo.
- (2) pergunta e EXCLUSIVAMENTE sobre devolucao, sem pedir faturamento/quantidade/carregada junto (ex: "total de devolucoes do mes", "quantas devolucoes tivemos") → consulta simples em SD1/SF1 (nota de entrada, SF1.F1_TIPO = 'D'), SEM UNION ALL (nao ha o que unificar, e a unica fonte de dado). Ver EXEMPLO 3 abaixo.
- So retorne apenas devolucoes (caso 2) quando o usuario disser claramente "somente devolucoes", "apenas devolucoes", "total de devolucoes" ou equivalente.
- LISTAGEM de devolucoes (ex: "mostre as devolucoes de vendas do periodo", "liste as devolucoes"): tambem e caso (2), SD1/SF1 sozinha, SEM UNION ALL — SD1 ja guarda a referencia completa a nota de venda original: D1_NFORI (numero da NF de venda original), D1_SERIORI (serie original) e D1_ITEMORI (item da nota original). Quando o usuario pedir para ver de qual venda veio a devolucao, inclua esses 3 campos no SELECT (ex: SD1.D1_NFORI AS nf_venda_original, SD1.D1_SERIORI AS serie_venda_original, SD1.D1_ITEMORI AS item_venda_original) — NAO faca JOIN/UNION com SD2/SF2 para isso, os dados ja estao em SD1.

### EXEMPLO 1 — faturamento + quantidade + devolucoes JUNTOS (caso 1 da REGRA CRITICA — usa D2_VALDEV/D2_QTDEDEV, SEM UNION ALL, SEM SD1/SF1):
SELECT COALESCE(SUM(SD2.D2_TOTAL - SD2.D2_VALDEV), 0) AS valor_liquido,
       COALESCE(SUM(SD2.D2_QUANT - SD2.D2_QTDEDEV), 0) AS quantidade_liquida
FROM SD2xxx SD2
JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20260601' AND '20260630' AND SF2.F2_TIPO = 'N';

### EXEMPLO 2 — faturamento + devolucao por produto (caso 1, agrupado — ainda D2_VALDEV/D2_QTDEDEV, sem UNION ALL):
SELECT SB1.B1_DESC AS produto,
       COALESCE(SUM(SD2.D2_TOTAL - SD2.D2_VALDEV), 0) AS valor_liquido,
       COALESCE(SUM(SD2.D2_QUANT - SD2.D2_QTDEDEV), 0) AS quantidade_liquida
FROM SD2xxx SD2
JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
JOIN SB1xxx SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20260601' AND '20260630' AND SF2.F2_TIPO = 'N'
GROUP BY SB1.B1_DESC
ORDER BY valor_liquido DESC;

### EXEMPLO 3 — SOMENTE devolucao, sem faturamento/quantidade junto (caso 2 da REGRA CRITICA — usa SD1/SF1, sem UNION ALL pois nao ha o que unificar):
SELECT COALESCE(SUM(SD1.D1_TOTAL), 0) AS total_devolucoes
FROM SD1xxx SD1
JOIN SF1xxx SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
WHERE SF1.D_E_L_E_T_ = ' ' AND SD1.D_E_L_E_T_ = ' ' AND SF1.F1_DTDIGIT BETWEEN '20260601' AND '20260630' AND SF1.F1_TIPO = 'D';
`;
}

function metricaValorTotal() {
  return `
## DIRETRIZ DE SELECAO DE TABELAS: Cabecalho (SF2) vs Itens (SD2)
Avalie a METRICA e a granularidade da pergunta para determinar a estrutura do FROM/JOIN. O uso incorreto gera duplicidade matematica ou metricas zeradas.

### Consultas por VALOR Financeiro Total (sem produto/item)
- Quando o usuario pedir "Total de faturamento", "Faturamento do ano", "Faturamento do mes" ou "Faturamento de um periodo" — SEMPRE use SD2 JOIN SF2, mesmo sem produto/grupo/quantidade na pergunta.
- Metrica escalar obrigatoria: COALESCE(SUM(SD2.D2_TOTAL), 0) AS faturamento. NUNCA use SUM(SF2.F2_VALBRUT) — SD2.D2_TOTAL e a metrica de item, correta para agregacao por nota (SF2.F2_VALBRUT somado com JOIN em SD2 duplicaria o valor pela quantidade de itens da nota).
- EXCECAO — pergunta pede "faturamento considerando devolucoes", "com devolucoes", "abatendo devolucoes" ou "liquido": use COALESCE(SUM(SD2.D2_TOTAL - SD2.D2_VALDEV), 0) AS faturamento_liquido — SD2.D2_VALDEV e o valor de devolucao ja vinculado ao item, dispensando UNION ALL com SD1/SF1.
- FILTRO OBRIGATORIO: inclua SEMPRE SF2.F2_TIPO = 'N' no WHERE junto com D_E_L_E_T_ = ' ' (em SD2 e SF2). Isso exclui devolucoes de compras (tipo 'D'), complementos e outros tipos que nao representam receita de venda. Exemplo: WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N' AND SF2.F2_EMISSAO BETWEEN '...' AND '...'.
- REGRA FISCAL BRASILEIRA DE CFOP PARA RECEITA: venda/faturamento/receita significa somente operacoes que geram receita. CFOP de remessa ou transferencia nao representa receita no entendimento fiscal nacional, independentemente do ERP. No Protheus, aplique isso pelo campo SD2.D2_CF: AND NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') AND SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156'). Esta regra tambem vale para faturamento liquido, medias, rankings, comparativos e agrupamentos por cliente/produto/vendedor.
- Excecao ao padrao de receita: se o usuario pedir explicitamente "todas as saidas", "movimentacao total", "venda + remessa + transferencia", "incluindo remessas e transferencias" ou equivalente, nao aplique a exclusao de CFOP.
- Agrupamentos por cliente, vendedor ou natureza: faca JOIN adicional com SA1 (via Joins padrao SF2->SA1), SA3 ou SED conforme o agrupamento pedido.
- Exemplo completo de "faturamento do mes": SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS faturamento FROM SD2... JOIN SF2... WHERE SF2.F2_TIPO = 'N' AND NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') AND SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156') AND [demais filtros D_E_L_E_T_/periodo].
- Quando o usuario pedir a DESCRICAO do CFOP (ex: "trazendo a descricao do CFOP", "com o nome do CFOP"): o Protheus nao guarda a descricao textual do CFOP diretamente em SD2; ela vem da tabela de TES (SF4), via F4_TEXTO. Adicione JOIN SF4<sufixo> SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' e inclua SF4.F4_TEXTO AS descricao_cfop no SELECT (e no GROUP BY, se houver agregacao). Isso nao substitui SD2.D2_CF no SELECT/GROUP BY — mostre ambos.
`;
}

function metricaQuantidadeItem() {
  return `
### Consultas por QUANTIDADE ou filtros de Produto/Item
- Quando o usuario pedir "Quantidade faturada", "Volume de vendas", "Total de pecas vendidas" (mesmo que seja total escalar de uma unica linha), ou quando citar produtos e grupos de produtos, use OBRIGATORIAMENTE a tabela de itens SD2 fazendo JOIN com SF2 (para validar periodo de emissao e F2_TIPO = 'N').
- Metrica de quantidade escalar obrigatoria: COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada.
- NUNCA use SF2 sozinha quando a pergunta contiver "Quantidade": o cabecalho nao armazena volume de itens vendidos.
- Citar produto/grupo de produto define a GRANULARIDADE e a base SD2; isso NAO significa que a metrica principal seja quantidade. Se a pergunta falar "faturamento", "total faturado", "valor" ou "vendas" por produto/cliente/nota, inclua obrigatoriamente COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_total. Inclua quantidade_faturada somente quando o usuario pedir quantidade/volume/itens junto.
- Quando o agrupamento ou filtro for por produto, grupo de produto, TES ou centro de custo: use SD2 JOIN SF2 e adote SUM(SD2.D2_TOTAL) como metrica de valor.
- REGRA DE EXCLUSIVIDADE DE METRICA: SD2 e F2_VALBRUT sao mutuamente exclusivos. Quando SD2 estiver no FROM ou em qualquer JOIN, use OBRIGATORIAMENTE SUM(SD2.D2_TOTAL) para valor e SUM(SD2.D2_QUANT) para quantidade. Nunca use SUM(SF2.F2_VALBRUT) quando SD2 estiver presente — a multiplicidade da relacao 1-para-N inflaria todos os valores.
- Quando o usuario pedir SIMULTANEAMENTE "por valor" e "por quantidade" com agrupamento por produto/grupo/mes/cliente: ambas as metricas devem vir de SD2. Exemplo: SELECT ..., COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_total, COALESCE(SUM(SD2.D2_QUANT),0) AS quantidade_faturada FROM SD2... JOIN SF2...
- REGRA CRITICA — duas metricas com regras fiscais DIFERENTES na mesma pergunta (ex: "quantidade carregada e valor faturado", "faturamento e carregamento do mes", com ou sem devolucao): cada metrica tem seu proprio JOIN/filtro. "Carregada"/"carregamento" exige JOIN SF4/F4_ESTOQUE='S' e NAO usa filtro de D2_CF. "Faturada"/"faturamento"/valor usa a regra nacional de receita: excluir remessas e transferencias por CFOP, salvo pedido explicito de todas as saidas. NUNCA junte as duas metricas em um UNICO SELECT com um UNICO FROM/WHERE — isso aplicaria o JOIN SF4 (exclusivo de carregada) tambem sobre faturada, contaminando o resultado mesmo que cada COALESCE(SUM(...)) pareca correto isoladamente. ESTE ERRO E FACIL DE COMETER: nao gera erro de sintaxe, so um numero errado. SEMPRE use DUAS subqueries/CTEs 100% independentes (cada uma com seu proprio FROM/JOIN/WHERE completo, sem compartilhar nada), combinadas via CROSS JOIN no SELECT externo. Quando a pergunta tambem pedir devolucao (ex: "faturamento e carregamento do mes considerando devolucao"), aplique a formula de devolucao (D2_VALDEV/D2_QTDEDEV) DENTRO DE CADA subquery — nunca esqueca de aplicar em AMBAS.

EXEMPLO OBRIGATORIO — "faturamento e carregamento do mes considerando devolucao" (copie esta estrutura, so trocando o periodo):
WITH faturamento AS (
  SELECT COALESCE(SUM(SD2.D2_TOTAL - SD2.D2_VALDEV), 0) AS valor_liquido
  FROM SD2xxx SD2
  JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20260701' AND '20260731' AND SF2.F2_TIPO = 'N' AND NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') AND SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156')
),
carregamento AS (
  SELECT COALESCE(SUM(SD2.D2_QUANT - SD2.D2_QTDEDEV), 0) AS quantidade_carregada_liquida
  FROM SD2xxx SD2
  JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  JOIN SF4xxx SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S'
  WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20260701' AND '20260731' AND SF2.F2_TIPO = 'N'
)
SELECT f.valor_liquido, c.quantidade_carregada_liquida FROM faturamento f CROSS JOIN carregamento c;

EXEMPLO OBRIGATORIO — "quantidade faturada e carregada no mes" (SEM devolucao — repare que "faturada" NAO tem JOIN SF4, mas exclui remessa/transferencia por CFOP):
WITH faturamento AS (
  SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada
  FROM SD2xxx SD2
  JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20260701' AND '20260731' AND SF2.F2_TIPO = 'N' AND NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') AND SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156')
),
carregamento AS (
  SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_carregada
  FROM SD2xxx SD2
  JOIN SF2xxx SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  JOIN SF4xxx SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S'
  WHERE SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20260701' AND '20260731' AND SF2.F2_TIPO = 'N'
)
SELECT f.quantidade_faturada, c.quantidade_carregada FROM faturamento f CROSS JOIN carregamento c;
- 3 GRUPOS FISCAIS DE SD2.D2_CF (mutuamente exclusivos, nunca misture, NUNCA omita quando a pergunta cair em um destes casos):
  REMESSA = (LIKE '59%' OR LIKE '69%') | TRANSFERENCIA = IN ('5151','6151','5152','6152','5155','6155','5156','6156') | ENTREGA_FUTURA/NOTA_MAE = IN ('5117','6117')
- REMESSA tem 2 condicoes com OR: SEMPRE escreva entre parenteses no WHERE — (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') — nunca solto, senao o AND seguinte quebra a precedencia logica do filtro.
- "faturada"/"faturado"/"faturamento"/"vendas"/"receita" SEM mencionar carregada/carga/entrega futura/nota mae/remessa/transferencia/todas as saidas: aplique a regra nacional de receita e exclua remessa/transferencia: AND NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') AND SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156').
- pergunta pede remessa especificamente: use SOMENTE o filtro REMESSA, entre parenteses: (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%').
- pergunta pede transferencia especificamente: use SOMENTE o filtro TRANSFERENCIA (IN de 8 codigos acima). Nunca troque por REMESSA.
- pergunta pede remessa E transferencia especificamente, sem pedir venda/receita junto: use filtro combinado com OR entre os dois grupos fiscais: ((SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') OR SD2.D2_CF IN ('5151','6151','5152','6152','5155','6155','5156','6156')).
- pergunta pede venda/faturamento/receita JUNTO com remessa e/ou transferencia: use subqueries/CTEs separadas por modo fiscal e retorne colunas separadas (ex: receita, remessa, transferencia) ou totalize no SELECT externo quando o usuario pedir total combinado.
- pergunta usa "carregada"/"carregado"/"carga"/"carregamento" (sinonimos, mesmo conceito — ex: "carregamento do dia" = "quantidade carregada do dia"): NAO use filtro de D2_CF (nenhum dos 3 grupos fiscais acima). Em vez disso, faca OBRIGATORIAMENTE JOIN adicional com SF4 (TES) exigindo F4_ESTOQUE = 'S' — isso identifica exatamente as saidas que geraram movimentacao fisica de estoque (o que "carregada" significa de fato), sem depender de decorar codigos fiscais. JOIN: SD2 -> SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S'. Exemplo completo de "quantidade carregada no mes": SELECT COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_carregada FROM SD2... JOIN SF2... JOIN SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S' WHERE SF2.F2_TIPO = 'N' AND [demais filtros D_E_L_E_T_/periodo]. OBRIGATORIO, nunca omita o JOIN com SF4/F4_ESTOQUE='S' nesse caso.
- pergunta pede entrega futura/nota mae: use SOMENTE SD2.D2_CF IN ('5117', '6117').
- DEVOLUCAO — quando SD2 ja estiver no FROM (quantidade faturada, quantidade carregada, valor por item) e a pergunta pedir "considerando devolucoes", "com devolucoes", "abatendo devolucoes" ou "liquido": NAO use o padrao UNION ALL com SD1/SF1 (esse padrao e exclusivo para consultas SOMENTE de devolucao, sem SD2 no FROM — ver bloco DEVOLUCOES abaixo). Em vez disso, use os campos de devolucao ja disponiveis na propria SD2, por item da nota: quantidade liquida = SUM(SD2.D2_QUANT - SD2.D2_QTDEDEV), valor liquido = SUM(SD2.D2_TOTAL - SD2.D2_VALDEV). Exemplo: "quantidade carregada no mes considerando devolucoes" = SELECT COALESCE(SUM(SD2.D2_QUANT - SD2.D2_QTDEDEV), 0) AS quantidade_carregada_liquida FROM SD2... JOIN SF2... JOIN SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S' WHERE SF2.F2_TIPO = 'N' AND [demais filtros].
- REGRA DE PREFIXO CFOP: no CFOP do Protheus, prefixo 5 = operacao estadual, prefixo 6 = a MESMA operacao interestadual (ex: 5117/6117 sao a mesma operacao). Os 3 grupos acima ja tem essa equivalencia aplicada (REMESSA via LIKE cobre ambos os prefixos; TRANSFERENCIA e ENTREGA_FUTURA ja listam os pares 5xxx/6xxx explicitamente) — nao precisa de ajuste adicional.

`;
}

function cfopTesCentroCusto() {
  return `
## Codigo Fiscal (CF/CFOP), TES e modos fiscais de quantidade — Faturamento
- Sinonimos para nota fiscal de saida/faturamento: nota de saida, nota fiscal de saida, NF de saida, faturamento, venda.
- CF, CFOP, codigo fiscal e codigo fiscal de operacao sao sinonimos — referem-se ao campo SD2.D2_CF.
- Quantidade/valor faturado segue a regra nacional de receita por padrao: exclua CFOPs de remessa e transferencia. Filtros especificos de remessa/transferencia/todas as saidas (quando a pergunta pedir explicitamente): ver regras no bloco de QUANTIDADE/PRODUTO acima — aplicam-se igualmente aqui sempre que SD2 estiver envolvido.
- Modos fiscais de quantidade adicionais (5117 = entrega futura/nota mae estadual, 6117 = a mesma operacao interestadual — ver REGRA DE PREFIXO CFOP no bloco de QUANTIDADE/PRODUTO):
  - Quantidade carregada: SUM(SD2.D2_QUANT), com JOIN adicional SD2 -> SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S' (NAO filtra por D2_CF — ver regra completa no bloco de QUANTIDADE/PRODUTO acima).
  - Entrega futura, venda para entrega futura ou nota mae: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF IN ('5117', '6117').
  - Movimentacao total, todas as saidas, volume total, sem filtro fiscal ou incluindo remessa/transferencia: SUM(SD2.D2_QUANT) sem filtro em SD2.D2_CF.
- TES pode ser chamado de TES ou Tipos de Saida. Refere-se ao campo SD2.D2_TES / tabela SF4 (F4_CODIGO, F4_TEXTO).
- SF4.F4_ESTOQUE: 'S' = TES gera movimentacao de estoque; 'N' = nao gera.
  Quando o usuario perguntar sobre notas que geraram estoque ou movimentaram estoque, filtre SF4.F4_ESTOQUE = 'S' via JOIN SD2 -> SF4.
- SF4.F4_DUPLIC: 'S' = TES gera lancamento financeiro (duplicata/receber); 'N' = nao gera financeiro.
  Quando o usuario perguntar sobre notas que geraram financeiro, contas a receber ou duplicatas, filtre SF4.F4_DUPLIC = 'S' via JOIN SD2 -> SF4.
  Este filtro e mais preciso que filtrar por CF para identificar notas de receita real.
`;
}

function grupoProduto() {
  return `
## Agrupamento por Grupo de Produto — REGRA CRITICA
Quando a pergunta pedir "por grupo de produto", "por grupo", "por linha de produto" ou equivalente:
- E OBRIGATORIO montar a cadeia completa SD2 -> SB1 -> SBM no FROM/JOIN.
- PROIBIDO usar SBM.BM_DESC no SELECT ou GROUP BY sem JOIN SBM declarado.
- Template obrigatorio de JOIN:
  JOIN SB1<sufixo> SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
  JOIN SBM<sufixo> SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = ' '
- SELECT obrigatorio: SBM.BM_DESC AS grupo_produto
- GROUP BY obrigatorio: SBM.BM_GRUPO, SBM.BM_DESC
- Metrica de valor: SUM(SD2.D2_TOTAL). Metrica de quantidade: SUM(SD2.D2_QUANT).
- Nao agrupe por produto (SB1.B1_DESC) nem por cliente quando o pedido for apenas por grupo de produto.
`;
}

function grupoCliente() {
  return `
## Agrupamento por Grupo de Cliente — REGRA CRITICA
Quando a pergunta pedir "por grupo de cliente", "por segmento de cliente" ou equivalente:
- PROIBIDO usar SF2 sozinha como base. ACY depende de SA1, que depende de SD2 como ancora da cadeia.
- E OBRIGATORIO montar a cadeia completa: FROM SD2 JOIN SF2 JOIN SA1 LEFT JOIN ACY.
- PROIBIDO usar ACY.ACY_DESCRI no SELECT ou GROUP BY sem LEFT JOIN ACY declarado.
- ATENCAO: ACY.ACY_GRPVEN liga com SA1.A1_GRPVEN — NAO com SA1.A1_COD. Erro comum: ON ACY.ACY_GRPVEN = SA1.A1_COD esta ERRADO.
- Colunas disponiveis para SELECT (inclua conforme o que o usuario pedir):
    ACY.ACY_GRPVEN AS cod_grupo_cliente
    ACY.ACY_DESCRI AS grupo_cliente        -- obrigatorio quando agrupando por grupo
    SA1.A1_COD AS cod_cliente
    SA1.A1_NOME AS cliente
    SB1.B1_COD AS cod_produto              -- requer JOIN SB1
    SB1.B1_DESC AS produto                 -- requer JOIN SB1
    COALESCE(SUM(SD2.D2_TOTAL), 0) AS valor_total
    COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada
- GROUP BY minimo quando agrupando por grupo de cliente: ACY.ACY_GRPVEN, ACY.ACY_DESCRI.
  Adicione SA1.A1_COD, SA1.A1_NOME se detalhar por cliente; SB1.B1_COD, SB1.B1_DESC se detalhar por produto.

-- MODELO DE SQL (exemplo estrutural — NAO copie literalmente; adapte sufixos, periodo e colunas conforme a pergunta):
/*
SET ROWCOUNT 50000;
SELECT
    ACY.ACY_DESCRI AS grupo_cliente,
    SA1.A1_NOME AS cliente,           -- incluir se usuario pedir detalhe por cliente
    SB1.B1_DESC AS produto,           -- incluir se usuario pedir detalhe por produto
    COALESCE(SUM(SD2.D2_TOTAL), 0) AS valor_total,
    COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada
FROM SD2<sufixo> SD2
JOIN SF2<sufixo> SF2
    ON SD2.D2_FILIAL = SF2.F2_FILIAL
    AND SD2.D2_DOC = SF2.F2_DOC
    AND SD2.D2_SERIE = SF2.F2_SERIE
    AND SD2.D2_CLIENTE = SF2.F2_CLIENTE
    AND SD2.D2_LOJA = SF2.F2_LOJA
    AND SF2.D_E_L_E_T_ = ' '
JOIN SA1<sufixo> SA1
    ON SF2.F2_CLIENTE = SA1.A1_COD
    AND SF2.F2_LOJA = SA1.A1_LOJA
    AND SA1.D_E_L_E_T_ = ' '
LEFT JOIN ACY<sufixo> ACY
    ON ACY.ACY_GRPVEN = SA1.A1_GRPVEN   -- ATENCAO: A1_GRPVEN, nao A1_COD
    AND ACY.D_E_L_E_T_ = ' '
JOIN SB1<sufixo> SB1                    -- incluir somente se detalhar por produto
    ON SD2.D2_COD = SB1.B1_COD
    AND SB1.D_E_L_E_T_ = ' '
WHERE SF2.F2_TIPO = 'N'
    AND SD2.D_E_L_E_T_ = ' '
    AND <filtro_periodo_em_SF2.F2_EMISSAO>
GROUP BY ACY.ACY_GRPVEN, ACY.ACY_DESCRI
    -- adicionar SA1.A1_COD, SA1.A1_NOME se detalhar por cliente
    -- adicionar SB1.B1_COD, SB1.B1_DESC se detalhar por produto
ORDER BY ACY.ACY_DESCRI;
*/
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
- Subquery/CTE interna usa SD2 JOIN SF2, agrupa por SUBSTRING(SF2.F2_EMISSAO,1,${tam}) AS ${alias}, exportando COALESCE(SUM(SD2.D2_TOTAL),0) AS faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}. NUNCA use SUM(SF2.F2_VALBRUT).
- Media mensal por ano (subquery agrupada por nivel maior): Subquery interna OBRIGATORIAMENTE exporta DOIS aliases de data: o nivel de detalhe (ex: SUBSTRING(SF2.F2_EMISSAO,1,6) AS competencia) E o nivel de agrupamento externo (ex: SUBSTRING(SF2.F2_EMISSAO,1,4) AS ano). Nunca exporte so o nivel de detalhe — sem o alias do nivel externo, a query externa nao consegue agrupar (GROUP BY h.ano).
- REGRA DE DECISAO — agrupar ou nao na query externa: SO agrupe a query externa (GROUP BY h.<nivel_externo>) quando o usuario pedir explicitamente a media "POR" o nivel externo (ex: "media mensal POR ano" = uma media para cada ano, GROUP BY h.ano). Quando o usuario pedir a media de UM CONJUNTO de periodos especificos sem dizer "por" (ex: "media anual considerando 2025 e 2026", "media anual dos ultimos 2 anos", "media mensal de 2026") — mesmo citando varios periodos — o resultado e ESCALAR (1 linha, sem GROUP BY na query externa): a subquery interna filtra os periodos pedidos no WHERE, e a query externa faz AVG(h.faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}) sem GROUP BY, calculando a media UNICA entre todos os periodos filtrados. PROIBIDO agrupar por h.ano/h.competencia/h.dia quando o usuario apenas cita os periodos a incluir na media, sem pedir "por ano/mes/dia".
- Query externa (quando agrupada, ex: "media mensal por ano"): SELECT h.<nivel_externo>, AVG(h.faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}) AS media FROM (...) AS h GROUP BY h.<nivel_externo>.
- Media mensal escalar (1 ano especifico, caso mais comum — usuario nao pediu "por" nivel externo): Query externa: SELECT AVG(h.faturamento_${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'}) AS media FROM (...) AS h. Sem GROUP BY. HAVING SUM > 0 na subquery interna se o usuario pedir so periodos com faturamento.
- Media anual escalar: subquery interna (SD2 JOIN SF2) SUM(SD2.D2_TOTAL) por ano (filtrando no WHERE os anos pedidos, ex: SUBSTRING(SF2.F2_EMISSAO,1,4) IN ('2025','2026')) → query externa AVG dos totais anuais SEM GROUP BY. Camada externa usa SOMENTE h.faturamento_ano — nunca SD2.*/SF2.*. Retorna 1 linha.
- Camada externa usa SOMENTE os aliases exportados pela subquery (h.<...>) — NUNCA referencie SD2.*/SF2.* fora da subquery/CTE.
- Media mensal por produto: quando o usuario pedir "faturamento medio por produto" ou equivalente, a SQL da IA ja deve calcular a media correta; o backend nao recalcula nem corrige a metrica. Use obrigatoriamente duas camadas: (1) subquery interna agrupada por SB1.B1_COD, SB1.B1_DESC e ${alias} (SUBSTRING(SF2.F2_EMISSAO,1,${tam})), com SUM(SD2.D2_TOTAL) AS faturamento_${alias}; (2) query externa agrupada somente por h.cod_produto, h.produto, com AVG(h.faturamento_${alias}) AS faturamento_medio. Aplique periodo, F2_TIPO e D_E_L_E_T_ dentro da subquery interna, nos aliases reais SD2/SF2/SB1. A query externa deve referenciar apenas aliases exportados por h; nunca referencie SD2, SF2 ou SB1 fora da subquery.
- NUNCA use AVG(SF2.F2_VALBRUT) diretamente sobre a tabela fato: isso calcula ticket medio por nota fiscal, nao media de periodo.
- NUNCA use AVG(SD2.D2_TOTAL) ou AVG(SD2.D2_VALBRUT) diretamente sobre a tabela fato: isso calcula media de linha/item, nao media de periodo.
`;
}

function precoMedioVenda() {
  return `
## Preco medio de venda (por unidade) — nao confundir com faturamento medio de periodo
- "preco medio vendido", "preco medio de venda", "valor medio por unidade/kg/saco/tonelada" = preco medio PONDERADO pela quantidade, nunca AVG(SD2.D2_PRCVEN) e nunca AVG de faturamento por periodo.
- FORMULA OBRIGATORIA: SUM(SD2.D2_TOTAL) / NULLIF(SUM(SD2.D2_QUANT), 0). AVG(SD2.D2_PRCVEN) da a media aritmetica simples do preco por linha/item, ignorando o volume de cada venda — distorce o resultado quando as quantidades variam entre notas.
- Por mes: SELECT SUBSTRING(SF2.F2_EMISSAO,1,6) AS competencia, SUM(SD2.D2_TOTAL) / NULLIF(SUM(SD2.D2_QUANT),0) AS preco_medio FROM SD2 SD2 JOIN SF2 SF2 ON ... GROUP BY SUBSTRING(SF2.F2_EMISSAO,1,6).
- Por produto: agrupe tambem por SB1.B1_COD, SB1.B1_DESC alem da competencia, se pedido.
- NUNCA use AVG(SD2.D2_PRCVEN) para responder "preco medio de venda" — isso e ticket medio de preco por linha, nao preco medio ponderado real.
`;
}

function crescimento({ granularidade = 'mensal' } = {}) {
  const { tam, alias } = TRUNC_POR_GRANULARIDADE[granularidade] || TRUNC_POR_GRANULARIDADE.mensal;
  return `
## Crescimento mensal / variacao mensal / evolucao mes a mes (granularidade ${granularidade})
- Quando o usuario pedir faturamento por ${granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes'} demonstrando crescimento, variacao, aumento, queda ou evolucao, a SQL deve calcular a comparacao contra o periodo anterior (LAG). Nao retorne apenas ${alias} + faturamento.
- Use duas camadas: (1) subquery/CTE com SD2 JOIN SF2, agrupada por SUBSTRING(SF2.F2_EMISSAO,1,${tam}) AS ${alias} e COALESCE(SUM(SD2.D2_TOTAL),0) AS faturamento (NUNCA SUM(SF2.F2_VALBRUT)); (2) query externa com h.${alias}, h.faturamento, LAG(h.faturamento) OVER (ORDER BY h.${alias}) AS faturamento_anterior, (h.faturamento - LAG(h.faturamento) OVER (ORDER BY h.${alias})) AS crescimento_valor e CASE WHEN LAG(h.faturamento) OVER (ORDER BY h.${alias}) IS NULL OR LAG(h.faturamento) OVER (ORDER BY h.${alias}) = 0 THEN NULL ELSE ((h.faturamento - LAG(h.faturamento) OVER (ORDER BY h.${alias})) * 100.0 / LAG(h.faturamento) OVER (ORDER BY h.${alias})) END AS crescimento_percentual.
- Na query externa use SOMENTE aliases exportados pela camada interna (h.${alias}, h.faturamento). NUNCA referencie SD2.*/SF2.* fora da subquery/CTE.
- Se o usuario pedir "crescimento" sem especificar valor ou percentual, inclua ambos: crescimento_valor e crescimento_percentual. O primeiro periodo deve ficar com crescimento_percentual NULL por nao haver periodo anterior.
`;
}

function identidadeVendedor() {
  return `
## Identidade do vendedor — REGRA DE SEGURANCA OBRIGATORIA
- Se o contexto tecnico trouxer vendedorFixo, aplique OBRIGATORIAMENTE o filtro desse vendedor em TODA query usando somente o vendedor principal: AND SF2.F2_VEND1 = '<codigo>'.
- PROIBIDO usar SF2.F2_VEND2, SF2.F2_VEND3, SF2.F2_VEND4 ou SF2.F2_VEND5 para filtro ou agrupamento de vendedor no modulo faturamento.
- Nunca retorne dados de outros vendedores quando vendedorFixo estiver presente, mesmo que o usuario nao cite vendedor (agregados gerais tambem devem ser filtrados pelo vendedorFixo).
- REGRA ABSOLUTA: se entidades_resolvidas contiver um vendedor com codigo DIFERENTE do vendedorFixo, NAO gere SQL algum. Retorne precisa_confirmacao=true com pergunta_confirmacao recusando o pedido.
- Quando vendedorFixo NAO estiver presente (quem pergunta e gestor), a consulta pode abranger todos os vendedores normalmente, sem filtro de vendedor.
`;
}

function comparativoPeriodos() {
  return `
## Comparativo entre periodos especificos (nao necessariamente adjacentes)
- Diferente de crescimento (que compara cada periodo com o IMEDIATAMENTE anterior via LAG), comparativo trata de periodos ESPECIFICOS escolhidos pelo usuario, que podem nao ser adjacentes (ex: "junho de 2025 vs junho de 2026", "este ano comparado a 2 anos atras", "marco e setembro").
- Para comparar UM periodo de referencia contra OUTROS periodos (ex: "junho/2026 comparado com junhos anteriores, trazendo os menores"): o periodo de REFERENCIA vai em subquery escalar SEM GROUP BY (retorna 1 valor); os periodos COMPARADOS ficam na query principal com GROUP BY.
- PROIBIDO: subquery com GROUP BY dentro de uma comparacao escalar (=, <, >, <=, >=, HAVING). GROUP BY na subquery retorna N linhas, causando erro do SQL Server ("Subquery returned more than 1 value").
- CORRETO: HAVING SUM(SD2.D2_TOTAL) < (SELECT SUM(SD2.D2_TOTAL) FROM SD2... JOIN SF2... WHERE <periodo_referencia>) — subquery sem GROUP BY, retorna 1 linha escalar. NUNCA use SF2.F2_VALBRUT.
- Para comparar MULTIPLOS periodos especificos lado a lado (ex: "2024 vs 2025 vs 2026", "marco e setembro de 2024 e 2025"): use GROUP BY pela mesma dimensao em todos, com filtro WHERE restringindo exatamente aos periodos pedidos (ex: SUBSTRING(SF2.F2_EMISSAO,1,4) IN ('2024','2026') quando o usuario pular anos intermediarios).
- Granularidade do comparativo (dia/mes/ano) e definida pela pergunta do usuario — use SUBSTRING(SF2.F2_EMISSAO,1,8) para dia, 1,6 para mes, 1,4 para ano, sempre consistente entre os periodos comparados.
- REGRA ABSOLUTA — calculo de competencia "mesmo mes, ano diferente": ao montar o valor de competencia (formato AAAAMM) para "mesmo mes do ano anterior/seguinte", o MES permanece IDENTICO e SOMENTE o ANO muda. Erro comum a evitar: ao comparar "junho de 2026 com junho de 2025", o periodo comparado e competencia = '202506' (ano 2025, mes 06) — NUNCA mude o mes ao trocar o ano (ex: gerar '202505' seria errado, pois mudou o mes de 06 para 05 junto com o ano). Construa cada competencia explicitamente como CONCAT(ano, mes) ou string literal com os 4 digitos do ano + 2 digitos do mes do periodo de referencia, nunca subtraindo do valor numerico da competencia inteira.
- EXEMPLO CORRETO — junho/2026 vs junho/2025: SUBSTRING(SF2.F2_EMISSAO,1,6) IN ('202606', '202506') — mesmo mes "06" nos dois anos.
`;
}

const FRAGMENTOS = {
  // identidade_vendedor nao tem keywords: e sempre injetado pelo classificador,
  // independente do texto da pergunta (regra de seguranca, nao de assunto).
  identidade_vendedor: {
    texto: identidadeVendedor,
    sempre: true,
  },
  devolucoes: {
    texto: devolucoes,
    keywords: [/\bdevolu\w*/i, /\bestorno\b/i, /\bretorno\b/i, /\bl[ií]quido\b/i, /\babatendo\b/i],
  },
  metrica_valor_total: {
    texto: metricaValorTotal,
    keywords: [/\b(faturamento|vendas?|receita)\s+(do|de|no)\s+(dia|mes|ano|periodo)\b/i, /\btotal\s+(?:de\s+)?(?:faturad[oa]|vendid[oa]|vendas?)\b/i, /\btotal\s+de\s+(faturamento|vendas?|receita)\b/i, /\bquanto\s+vendemos\b/i],
  },
  metrica_quantidade_item: {
    texto: metricaQuantidadeItem,
    keywords: [/\bquantidade\b/i, /\bvolume\b/i, /\bpe[çc]as?\b/i, /\bproduto\w*\b/i, /\bgrupo\s+de\s+produto\w*\b/i, /\bfaturad[ao]\b/i, /\bremessa\b/i, /\btransfer[eê]ncia\b/i, /\btoneladas?\b/i, /\bcarregad[ao]s?\b/i, /\bcarregamentos?\b/i, /\bcarga\b/i],
  },
  cfop_tes_centro_custo: {
    texto: cfopTesCentroCusto,
    keywords: [/\bCFOP\b/i, /\bCF\b/, /\bTES\b/, /\bremessa\b/i, /\btransfer[eÃª]ncia\b/i, /\bcarregad[ao]s?\b/i, /\bcarregamentos?\b/i, /\bentrega\s+futura\b/i, /\bnota\s+mae\b/i, /\bestoque\b/i, /\bcentro\s+de\s+custo\b/i],
  },
  grupo_produto: {
    texto: grupoProduto,
    keywords: [/\bgrupo\s+de\s+produto\w*\b/i, /\bgrupo\s+de\s+produtos\b/i, /\blinha\s+de\s+produto\w*\b/i],
  },
  grupo_cliente: {
    texto: grupoCliente,
    keywords: [/\bgrupo\s+de\s+cliente\w*\b/i, /\bgrupo\s+de\s+clientes\b/i, /\bsegmento\s+de\s+cliente\w*\b/i],
  },
  frequencia_cliente: {
    texto: frequenciaCliente,
    keywords: [/\btodos\s+os\s+meses\b/i, /\bfrequ[eê]ncia\b/i, /\brecorr[eê]ncia\b/i, /\btodo\s+mes\b/i],
  },
  media_diaria: {
    texto: () => media({ granularidade: 'diaria' }),
    keywords: [/\bm[eé]di[ao]\b.*\bdi[aá]ri[ao]\b|\bdi[aá]ri[ao]\b.*\bm[eé]di[ao]\b/i, /\bm[eé]di[ao]\s+por\s+dia\b/i],
    excluiSe: [/\bpre[cç]o\s+m[eé]di[ao]\b/i],
  },
  media_anual: {
    texto: () => media({ granularidade: 'anual' }),
    keywords: [/\bm[eé]di[ao]\b.*\banual\b|\banual\b.*\bm[eé]di[ao]\b/i, /\bm[eé]di[ao]\s+por\s+ano\b/i, /\bm[eé]dia\s+anual\b/i],
    excluiSe: [/\bpre[cç]o\s+m[eé]di[ao]\b/i],
  },
  media_mensal: {
    texto: () => media({ granularidade: 'mensal' }),
    keywords: [/\bm[eé]di[ao]\b/i],
    excluiSe: [
      /\bm[eé]di[ao]\b.*\b(di[aá]ri[ao]|anual)\b|\b(di[aá]ri[ao]|anual)\b.*\bm[eé]di[ao]\b/i,
      /\bm[eé]di[ao]\s+por\s+dia\b/i,
      /\bm[eé]di[ao]\s+por\s+ano\b/i,
      /\bpre[cç]o\s+m[eé]di[ao]\b/i,
    ],
  },
  preco_medio_venda: {
    texto: precoMedioVenda,
    keywords: [/\bpre[cç]o\s+m[eé]di[ao]\b/i, /\bvalor\s+m[eé]di[ao]\s+(por|de)\s+(unidade|kg|saco|tonelada|item)\b/i],
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
  'identidade_vendedor',
  'devolucoes',
  'metrica_valor_total',
  'metrica_quantidade_item',
  'grupo_produto',
  'grupo_cliente',
  'cfop_tes_centro_custo',
  'frequencia_cliente',
  'media_diaria',
  'media_mensal',
  'media_anual',
  'preco_medio_venda',
  'crescimento_diario',
  'crescimento_mensal',
  'crescimento_anual',
  'comparativo_periodos',
];

module.exports = { base, FRAGMENTOS, ORDEM_FALLBACK };
