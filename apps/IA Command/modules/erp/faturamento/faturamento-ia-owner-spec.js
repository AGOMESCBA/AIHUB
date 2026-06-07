'use strict';

const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');

const TABELAS = ['SF2', 'SD2', 'SF1', 'SD1', 'SA1', 'SA3', 'SB1', 'SBM', 'SF4', 'CTT'];

const CAMPOS_SX3_ESSENCIAIS = {
  SF2: ['F2_FILIAL', 'F2_DOC', 'F2_SERIE', 'F2_CLIENTE', 'F2_LOJA', 'F2_EMISSAO', 'F2_TIPO', 'F2_VALBRUT', 'F2_VALMERC', 'F2_VALFAT', 'F2_VEND1', 'D_E_L_E_T_'],
  SD2: ['D2_FILIAL', 'D2_DOC', 'D2_SERIE', 'D2_CLIENTE', 'D2_LOJA', 'D2_COD', 'D2_QUANT', 'D2_TOTAL', 'D2_VALBRUT', 'D2_PRCVEN', 'D2_TES', 'D2_CF', 'D2_CCUSTO', 'D_E_L_E_T_'],
  SF1: ['F1_FILIAL', 'F1_DOC', 'F1_SERIE', 'F1_FORNECE', 'F1_LOJA', 'F1_EMISSAO', 'F1_DTDIGIT', 'F1_TIPO', 'F1_VALBRUT', 'F1_VALMERC', 'F1_TOTALNF', 'D_E_L_E_T_'],
  SD1: ['D1_FILIAL', 'D1_DOC', 'D1_SERIE', 'D1_FORNECE', 'D1_LOJA', 'D1_COD', 'D1_QUANT', 'D1_TOTAL', 'D1_DTDIGIT', 'D1_TES', 'D1_CF', 'D_E_L_E_T_'],
  SA1: ['A1_FILIAL', 'A1_COD', 'A1_LOJA', 'A1_NOME', 'A1_NREDUZ', 'A1_CGC', 'A1_MUN', 'A1_EST', 'D_E_L_E_T_'],
  SA3: ['A3_FILIAL', 'A3_COD', 'A3_NOME', 'D_E_L_E_T_'],
  SB1: ['B1_FILIAL', 'B1_COD', 'B1_DESC', 'B1_GRUPO', 'B1_UM', 'B1_TIPO', 'D_E_L_E_T_'],
  SBM: ['BM_FILIAL', 'BM_GRUPO', 'BM_DESC', 'D_E_L_E_T_'],
  SF4: ['F4_FILIAL', 'F4_CODIGO', 'F4_TEXTO', 'F4_DUPLIC', 'F4_ESTOQUE', 'F4_TIPO', 'F4_CF', 'D_E_L_E_T_'],
  CTT: ['CTT_FILIAL', 'CTT_CUSTO', 'CTT_DESC01', 'D_E_L_E_T_'],
};

function garantirIntencao(empresaId) {
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    const existe = db.prepare("SELECT id FROM intentions WHERE empresa_id = ? AND nome = 'faturamento_dinamico' LIMIT 1").get(empresaId);
    if (existe) return;
    crud.criar('intentions', {
      empresa_id: empresaId,
      nome: 'faturamento_dinamico',
      descricao: 'Consultas dinamicas de faturamento via IA-OWNER',
      modulo: 'faturamento',
      acao: 'ai_text_to_sql',
      dataset_id: null,
      frases_exemplo: [
        'faturamento do mes',
        'vendas por cliente',
        'faturamento por produto',
        'faturamento por vendedor',
        'notas fiscais de saida',
        'faturamento considerando devolucoes',
      ].join('\n'),
      ativo: 1,
    });
    require('../../ai/intent-service').invalidateCache(empresaId);
  } catch (e) {
    console.warn(`[FaturamentoIAOwner] Falha ao garantir intencao para empresa #${empresaId}:`, e.message);
  }
}

const regrasTecnicas = `
## Principio IA-OWNER
Voce decide se a pergunta atual e uma nova consulta, continuidade ou troca de assunto.
O historico e evidencia. Nao herde periodo, filtros ou agrupamentos automaticamente: herde apenas quando fizer sentido pela conversa.

## Analise Historica Multianual — Consulta de Extremo por Ano (SEM filtro de periodo)
- Quando a pergunta buscar um extremo historico ENTRE ANOS — ex: "qual o ano com maior/menor faturamento", "qual o melhor/pior ano", "o ano que mais vendeu" — a palavra "ano" e DIMENSAO DE ANALISE, nao referencia de periodo.
- PROIBIDO aplicar BETWEEN ou qualquer filtro de data no WHERE nesses casos.
- Gere SQL sem filtro temporal: GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 4) AS ano, ORDER BY faturamento DESC/ASC, OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY.
- Ignore periodo.tipo = "ano_atual" vindo do estado anterior quando a mensagem pedir explicitamente o "maior/menor/melhor/pior ano" historico.
- EXCECAO: se o usuario especificar range ("ultimos 5 anos", "de 2022 a 2024"), aplique o filtro correspondente.

## Consultas de Frequencia Mensal Completa ("todos os meses do ano")
- Quando o usuario pedir "clientes/produtos com faturamento em todos os meses do ano [X]" ou "todos os meses do ano" (sem especificar ano):
  1. Se [X] nao for informado, assuma o ano atual (SUBSTRING(data_atual, 1, 4)).
  2. Se [X] for o ano atual AINDA EM CURSO (ano nao terminou): o threshold do HAVING e o numero de meses JA DECORRIDOS: CAST(SUBSTRING(data_atual, 5, 2) AS INT). Exemplo: data_atual=2026-06-06 → HAVING COUNT(DISTINCT SUBSTRING(SF2.F2_EMISSAO, 5, 2)) = 6.
  3. Se [X] for um ano passado completamente encerrado: use HAVING COUNT(DISTINCT ...) = 12.
- PROIBIDO usar HAVING COUNT(...) = 12 para o ano atual quando o ano ainda nao terminou.
- PROIBIDO declarar frases como "possuem faturamento todos os meses" ou "todos os meses" em entidades_necessarias — isso nao e uma entidade cadastral.
- Para essas queries de frequencia, use FROM SF2 JOIN SA1 (nunca SD2 como base). Declare o JOIN SA1 com as chaves SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '.
- SELECT e GROUP BY devem incluir SA1.A1_NOME AS cliente — nunca retornar apenas codigo.

## Periodos
- Se o usuario disser "ano" sem ano explicito, use o ano atual completo.
- Se disser "mes" sem mes/ano explicito, use o mes atual completo.
- Se disser "dia" sem data explicita, use o dia atual.
- "por mes", "mensal", "mes a mes" podem ser granularidade/agrupamento. Decida pelo texto completo e pelo historico.
- Datas Protheus sao CHAR(8) YYYYMMDD. Compare com BETWEEN em texto YYYYMMDD.
- Campo de data padrao de faturamento: SF2.F2_EMISSAO.

## Comparacao de um Mes nos Ultimos N Anos (faturamento)
- Quando o usuario pedir "[mes] dos ultimos N anos" (Ex: "Maio dos ultimos 3 anos"), calcule os N anos a partir de data_atual.
- data_atual=2026 + "ultimos 3 anos" = anos 2024, 2025, 2026. Nunca herde anos do estado anterior.
- SQL obrigatorio: filtre por mes via SUBSTRING(SF2.F2_EMISSAO, 5, 2) e range de anos:
  WHERE SF2.D_E_L_E_T_ = ' ' AND SUBSTRING(SF2.F2_EMISSAO, 5, 2) = '05' AND SF2.F2_EMISSAO >= '20240501' AND SF2.F2_EMISSAO <= '20260531'
  GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 4) ORDER BY ano
- NUNCA gere BETWEEN cobrindo apenas 1 mes de 1 ano quando o usuario pediu N anos.
- Campo de data padrao de devolucoes de vendas: SF1.F1_DTDIGIT ou SF1.F1_EMISSAO conforme campos disponiveis; prefira SF1.F1_DTDIGIT para entrada digitada no periodo.

## Sintaxe SQL — Padrao ANSI SQL:2008 (SQL Server)
Gere sempre SQL compativel com SQL Server usando construcoes do padrao ANSI. NUNCA use extensoes especificas de MySQL ou PostgreSQL — elas causam erro de sintaxe no SQL Server.

- LIMIT: PROIBIDO. SQL Server nao reconhece LIMIT (sintaxe MySQL). Para limitar linhas use OBRIGATORIAMENTE a sintaxe ANSI SQL:2008, que requer ORDER BY:
    ORDER BY <coluna> OFFSET 0 ROWS FETCH NEXT N ROWS ONLY
  Exemplo correto:  ORDER BY faturamento DESC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY
  Exemplo errado:   LIMIT 1

- TOP N + OFFSET/FETCH NEXT: PROIBIDO juntos. SQL Server nao permite SELECT TOP N e OFFSET/FETCH NEXT na mesma query (erro 10741). Escolha UM dos dois mecanismos: prefira sempre OFFSET/FETCH NEXT (ANSI). NUNCA escreva SELECT TOP N quando a query ja tiver OFFSET ... FETCH NEXT.

- YEAR() / MONTH() para agrupamento: PROIBIDO. Use SUBSTRING(campo, 1, 6) AS competencia para extrair 'AAAAMM' (ex: '202506'). Garante compatibilidade entre provedores e ordenacao cronologica correta como string.

- Valor nulo: Use COALESCE(expr, 0) (padrao ANSI) em vez de ISNULL(expr, 0) (especifico SQL Server).

- Diferenca: Use <> (padrao ANSI) em vez de !=.

- Conversao: Prefira CAST(x AS tipo) (padrao ANSI) a CONVERT(tipo, x, estilo) para conversoes basicas sem mascara de formato.

## Devolucoes de Vendas
- Nao inclua devolucoes de vendas nas metricas de faturamento por padrao.
- Somente considere devolucoes quando o usuario pedir explicitamente: devolucao, devolucoes, retorno, estorno, abatendo devolucoes, considerar devolucoes, faturamento liquido.
- "considerando devolucoes", "com devolucoes", "abatendo devolucoes" ou "faturamento liquido" significa faturamento bruto menos devolucoes de vendas.
- So retorne apenas devolucoes quando o usuario disser claramente "somente devolucoes", "apenas devolucoes", "total de devolucoes" ou equivalente.
- No Protheus, devolucao de venda e nota de entrada do SIGACOM: use obrigatoriamente SF1/SD1, com SF1.F1_TIPO = 'D'. Nao use SF4/TES nem CASE em SD2 para identificar devolucao de venda.
- Quando o usuario pedir para considerar devolucoes, faturamento liquido ou abatendo devolucoes, monte obrigatoriamente uma consulta externa sobre subqueries unificadas por UNION ALL:
  1. Subquery de faturamento: origem SD2/SF2. Filtre SF2.F2_TIPO IN ('N','C','I') quando o campo existir no SX3. Projete SD2.D2_TOTAL AS valor_faturamento e 0 AS valor_devolucao.
  2. Subquery de devolucoes de vendas: origem SD1/SF1. Filtre SF1.F1_TIPO = 'D'. Projete 0 AS valor_faturamento e SD1.D1_TOTAL AS valor_devolucao.
- A query externa deve selecionar SUM(valor_faturamento) AS total_faturamento, SUM(valor_devolucao) AS total_devolucoes e (SUM(valor_faturamento) - SUM(valor_devolucao)) AS faturamento_liquido.
- Aplique o mesmo periodo e os mesmos filtros cadastrais nas duas subqueries quando fizer sentido. Para faturamento use SF2.F2_EMISSAO. Para devolucoes use SF1.F1_DTDIGIT ou SF1.F1_EMISSAO conforme campos disponiveis.
- Nota Protheus: na devolucao de vendas (SF1 tipo D), o codigo do cliente e gravado em SF1.F1_FORNECE/SD1.D1_FORNECE e loja em SF1.F1_LOJA/SD1.D1_LOJA. Se houver filtro de cliente resolvido, filtre faturamento por SF2.F2_CLIENTE/F2_LOJA e devolucoes por SF1.F1_FORNECE/F1_LOJA.

## Tabelas padrao do modulo Faturamento
- SF2: cabecalho de NF de saida. Metrica geral preferencial: SF2.F2_VALBRUT quando nao precisar de item.
- SD2: itens de NF de saida. Use para produto, grupo, quantidade, valor medio, TES, centro de custo e faturamento liquido com devolucoes. Metrica de item: SD2.D2_TOTAL. Quantidade: SD2.D2_QUANT.
- Para faturamento bruto/normal de nota fiscal de saida, quando filtrar tipo, use SF2.F2_TIPO = 'N'. Nunca use SF2.F2_TIPO = '1'.
- DIRETRIZ DE SELECAO DE TABELAS: Cabecalho (SF2) vs Itens (SD2)
  Avalie a METRICA e a granularidade da pergunta para determinar a estrutura do FROM/JOIN. O uso incorreto gera duplicidade matematica ou metricas zeradas.
  1. Consultas por VALOR Financeiro Total (sem produto/item):
     Quando o usuario pedir "Total de faturamento", "Faturamento do ano", "Faturamento do mes" ou "Faturamento de um periodo" — metricas puramente monetarias, sem especificar produto, grupo de produto ou QUANTIDADE de itens — use OBRIGATORIAMENTE APENAS a tabela de cabecalho SF2.
     Metrica escalar obrigatoria: COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento.
     EXPRESSAMENTE PROIBIDO fazer JOIN com SD2 nesses casos de valor total: o relacionamento 1-para-muitos multiplica F2_VALBRUT pela quantidade de itens da nota, gerando valores duplicados errados.
  2. Consultas por QUANTIDADE ou filtros de Produto/Item:
     Quando o usuario pedir "Quantidade faturada", "Volume de vendas", "Total de pecas vendidas" (mesmo que seja total escalar de uma unica linha), ou quando citar produtos e grupos de produtos, use OBRIGATORIAMENTE a tabela de itens SD2 fazendo JOIN com SF2 (para validar periodo de emissao e F2_TIPO = 'N').
     Metrica de quantidade escalar obrigatoria: COALESCE(SUM(SD2.D2_QUANT), 0) AS quantidade_faturada.
     NUNCA use SF2 sozinha quando a pergunta contiver "Quantidade": o cabecalho nao armazena volume de itens vendidos.
     Quando o agrupamento ou filtro for por produto, grupo de produto, TES ou centro de custo: use SD2 JOIN SF2 e adote SUM(SD2.D2_TOTAL) como metrica de valor.
     REGRA DE EXCLUSIVIDADE DE METRICA: SD2 e F2_VALBRUT sao mutuamente exclusivos. Quando SD2 estiver no FROM ou em qualquer JOIN, use OBRIGATORIAMENTE SUM(SD2.D2_TOTAL) para valor e SUM(SD2.D2_QUANT) para quantidade. Nunca use SUM(SF2.F2_VALBRUT) quando SD2 estiver presente — a multiplicidade da relacao 1-para-N inflaria todos os valores.
     Quando o usuario pedir SIMULTANEAMENTE "por valor" e "por quantidade" com agrupamento por produto/grupo/mes/cliente: ambas as metricas devem vir de SD2. Exemplo: SELECT ..., COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_total, COALESCE(SUM(SD2.D2_QUANT),0) AS quantidade_faturada FROM SD2... JOIN SF2...
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
- SF1 -> SA1 para devolucao de venda:
  SF1.F1_FORNECE = SA1.A1_COD
  AND SF1.F1_LOJA = SA1.A1_LOJA
- Para queries de frequencia por cliente (ex: "clientes com faturamento em todos os meses"):
  FROM SF2990 SF2
  JOIN SA1990 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '
  WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
  GROUP BY SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME
  HAVING COUNT(DISTINCT SUBSTRING(SF2.F2_EMISSAO, 5, 2)) = CAST(SUBSTRING(data_atual, 5, 2) AS INT)  -- ou = 12 para ano encerrado

## Regras obrigatorias de SQL
- Retorne apenas SELECT, sempre iniciando com SET ROWCOUNT 50000.
- OBRIGATORIO SEM EXCECAO: toda tabela no FROM ou em qualquer JOIN deve ter D_E_L_E_T_ = ' ' filtrado. Aplique no WHERE para a tabela principal e na condicao ON para cada JOIN. Exemplo correto: FROM SD2990 SD2 JOIN SF2990 SF2 ON ... AND SF2.D_E_L_E_T_ = ' ' JOIN SB1990 SB1 ON ... AND SB1.D_E_L_E_T_ = ' ' WHERE SD2.D_E_L_E_T_ = ' '. Isso vale inclusive para SA1, SA3, SBM, SF4, CTT — todas as tabelas sem excecao.
- REGRA DE INTEGRIDADE DE JOINS: E terminantemente PROIBIDO usar qualificadores de tabelas cadastrais (ex: SB1.B1_DESC, SA1.A1_NOME, SA3.A3_NOME, CTT.CTT_DESC01) em qualquer parte do SQL (SELECT, WHERE, GROUP BY, ORDER BY) sem declarar o JOIN correspondente no FROM. Sempre que o usuario pedir agrupamento ou exibicao por entidade ("por produto", "por cliente", "por vendedor"), voce deve: (1) identificar o nome fisico da tabela no sx2 do tenant ativo; (2) adicionar o JOIN com as chaves padrao e com D_E_L_E_T_ = ' ' na condicao ON. SQL com qualificadores sem JOIN declarado e INVALIDO — revise antes de retornar.
- Use aliases explicitos iguais a base da tabela: SF2, SD2, SF1, SD1, SA1, SA3, SB1, SBM, SF4, CTT.
- Se o contexto tecnico trouxer nomes fisicos SX2, use exatamente esses nomes em FROM/JOIN com alias base. Exemplo: FROM SD2990 SD2, JOIN SF2990 SF2.
- Qualifique campos sempre pelo alias base, nunca pela tabela fisica. Use SD2.D2_TOTAL, nao SD2990.D2_TOTAL.
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL). Junte cadastros apenas quando precisar exibir descricao ou filtrar entidade resolvida.
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.
- Nao use WITH (NOLOCK).
- Nao use FORMAT() nem TRY_CONVERT().

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

## Agregacoes
- "total de faturamento" sem agrupamento, sem produto e sem devolucao: retorne uma linha com COALESCE(SUM(SF2.F2_VALBRUT),0) AS faturamento. INVALIDO quando SD2 estiver no FROM/JOIN.
- Consultas por produto/grupo/quantidade/valor medio devem usar SD2 JOIN SF2 e adotar COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_total e, quando solicitado, COALESCE(SUM(SD2.D2_QUANT),0) AS quantidade_faturada. Nunca use F2_VALBRUT nessas consultas.
- "por cliente": agrupe por SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
- "por vendedor": agrupe por SA3.A3_COD, SA3.A3_NOME.
- "por produto": agrupe por SB1.B1_COD, SB1.B1_DESC.
- "por mes": use OBRIGATORIAMENTE SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia no SELECT e GROUP BY. Resultado: '202506', '202507' etc. NUNCA use YEAR() ou MONTH() isolados — a coluna competencia AAAAMM garante agrupamento correto em qualquer ano e e compativel com todos os provedores de conexao.
- Excecao YoY/crescimento contra anos anteriores: quando o usuario pedir "crescimento", "comparado ao mesmo mes do ano anterior", "YoY" ou comparacao ano contra ano por mes, NAO use competencia AAAAMM como unica granularidade. O comparativo pode envolver dois ou mais anos; gere uma consulta em duas camadas: a subquery interna agrupa por ano (SUBSTRING(SF2.F2_EMISSAO, 1, 4)) e mes (SUBSTRING(SF2.F2_EMISSAO, 5, 2)) e calcula SUM(SF2.F2_VALBRUT); a query externa aplica LAG(faturamento) OVER (PARTITION BY mes ORDER BY ano) ou calcula colunas/percentuais condicionais quando o usuario pedir anos lado a lado. No mesmo nivel de uma query com GROUP BY, nunca use em PARTITION BY/ORDER BY do OVER uma expressao que nao esteja agrupada nessa mesma camada.
- Para YoY limitado a meses especificos (ex: Janeiro a Junho), filtre o mes no WHERE com SUBSTRING(SF2.F2_EMISSAO, 5, 2) IN ('01','02','03','04','05','06') e filtre os anos explicitamente com SUBSTRING(SF2.F2_EMISSAO, 1, 4) IN (...), evitando BETWEEN continuo quando isso puder incluir meses fora do escopo.
- REGRA CRITICA — sintaxe SQL Server/ANSI: NUNCA use LIMIT (sintaxe MySQL — causa erro no SQL Server). Para limitar linhas use OBRIGATORIAMENTE: ORDER BY <coluna> OFFSET 0 ROWS FETCH NEXT N ROWS ONLY. Exemplo: "ORDER BY faturamento DESC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY".
- Inclua no SELECT somente as granularidades solicitadas. Se o usuario pedir "por mes", nao inclua dia/data no SELECT. Toda expressao nao agregada presente no SELECT deve estar representada corretamente no GROUP BY.
- Media mensal de periodo (ex: "media mensal dos ultimos 12 meses", "media mensal de 2025"): PROIBIDO dividir SUM por COUNT(DISTINCT competencia) no SELECT principal com GROUP BY — COUNT e sempre 1 dentro do grupo, nao produz media real. Use OBRIGATORIAMENTE subquery em duas camadas:
  Camada interna: GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6), SUM(SF2.F2_VALBRUT) AS faturamento_mes — com filtro de periodo no WHERE.
  Camada externa: SELECT COALESCE(AVG(h.faturamento_mes), 0) AS media_faturamento_mensal FROM (...) h.
  Retorna UMA linha → habilita resposta_planejada no WhatsApp.
  Exemplo correto:
  SELECT COALESCE(AVG(h.faturamento_mes), 0) AS media_faturamento_mensal
  FROM (
    SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia, SUM(SF2.F2_VALBRUT) AS faturamento_mes
    FROM SF2990 SF2
    WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
      AND SF2.F2_EMISSAO >= '20250601' AND SF2.F2_EMISSAO < '20260601'
    GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)
  ) AS h;
- Media sazonal por mes do ano (ex: "media de cada mes do ano", "media historica de cada mes", "media de todos os janeiros", "sazonalidade mensal"): objetivo e descobrir a media de todos os Janeiros, todos os Fevereiros, etc., acumulados em todo o historico. Use subquery de duas camadas SEM filtro de ano no WHERE:
  Camada interna: GROUP BY ano (SUBSTRING(SF2.F2_EMISSAO, 1, 4)) E mes (SUBSTRING(SF2.F2_EMISSAO, 5, 2)), SUM(SF2.F2_VALBRUT) AS faturamento_mes — varre todo o historico.
  Camada externa: SELECT mes, COALESCE(AVG(faturamento_mes), 0) AS media_faturamento GROUP BY mes ORDER BY mes.
  Retorna 12 linhas (uma por mes) → resposta_planejada = null.
  Exemplo correto:
  SELECT h.mes, COALESCE(AVG(h.faturamento_mes), 0) AS media_faturamento
  FROM (
    SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 4) AS ano, SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS mes,
           SUM(SF2.F2_VALBRUT) AS faturamento_mes
    FROM SF2990 SF2
    WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
    GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 4), SUBSTRING(SF2.F2_EMISSAO, 5, 2)
  ) AS h
  GROUP BY h.mes ORDER BY h.mes;
  PROIBIDO aplicar BETWEEN de um unico ano no WHERE do CASO sazonal — destruiria a media historica.

## Resposta Planejada WhatsApp
- REGRA: preencha resposta_planejada SOMENTE quando o SQL retornar UMA UNICA LINHA (total geral sem agrupamento). Consultas com GROUP BY (por mes, produto, cliente, etc.) devem ter resposta_planejada vazio — o sistema formatara automaticamente.
- Para total sem agrupamento com devolucoes: "Aqui esta o resumo do faturamento para o periodo solicitado:\n\n*Faturamento Bruto:* {total_faturamento}\n*Devolucoes de Vendas:* {total_devolucoes}\n*Faturamento Liquido:* {faturamento_liquido}"
- Para total sem agrupamento sem devolucoes: "Aqui esta o resumo do faturamento para o periodo solicitado:\n\n📊 *Faturamento Bruto:* {faturamento}"
`.trim();

function formatarPerguntaAmbiguidade(texto, candidatos = []) {
  const linhas = candidatos.map((c, i) => `${i + 1}. *${c.nome}* (${c.rotuloTipo || c.tipo}: ${c.codigo}${c.loja ? `/${c.loja}` : ''})`);
  linhas.push(`${candidatos.length + 1}. *Todos*`);
  return `Encontrei mais de um registro para *${texto}*:\n\n${linhas.join('\n')}\n\nQual deles voce quer consultar? Responda com o numero.`;
}

function camposLike(def, termo, alias, helpers) {
  const like = `%${helpers.escapeSqlLiteral(termo).toUpperCase()}%`;
  return def.nomeCampos.map(campo => `UPPER(${alias}.${campo}) LIKE '${like}'`).join(' OR ');
}

function normalizarCandidato(def, row) {
  return {
    tipo: def.tipo,
    rotuloTipo: def.rotuloTipo,
    tabelaBase: def.tabelaBase,
    codigo: String(row.codigo || '').trim(),
    loja: row.loja == null ? null : String(row.loja || '').trim(),
    nome: String(row.nome || '').trim(),
    joinHint: def.joinHint,
  };
}

function deduplicarCandidatos(candidatos = []) {
  const vistos = new Set();
  return candidatos.filter(candidato => {
    const chave = `${candidato.tipo}|${candidato.codigo}|${candidato.loja || ''}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

async function buscarEntidade({ empresaId, sx2, tipo, termoTexto, periodo, filial, helpers }) {
  const def = entityCatalog.DEFINICOES[tipo];
  if (!def) return [];
  const tabelaCad = helpers.tabelaFisicaSX2(sx2, def.tabelaBase);
  const tabelaSF2 = helpers.tabelaFisicaSX2(sx2, 'SF2');
  const tabelaSD2 = helpers.tabelaFisicaSX2(sx2, 'SD2');
  const tabelaSA1 = helpers.tabelaFisicaSX2(sx2, 'SA1');
  const tabelaSA3 = helpers.tabelaFisicaSX2(sx2, 'SA3');
  const tabelaSB1 = helpers.tabelaFisicaSX2(sx2, 'SB1');
  const tabelaSBM = helpers.tabelaFisicaSX2(sx2, 'SBM');
  const tabelaCTT = helpers.tabelaFisicaSX2(sx2, 'CTT');
  const tabelaSF4 = helpers.tabelaFisicaSX2(sx2, 'SF4');
  if (!tabelaCad) return [];

  const ini = periodo?.dataInicio || periodo?.data_inicio;
  const fim = periodo?.dataFim || periodo?.data_fim;
  const periodoWhere = ini && fim && tabelaSF2 ? `  AND SF2.F2_EMISSAO BETWEEN '${helpers.escapeSqlLiteral(ini)}' AND '${helpers.escapeSqlLiteral(fim)}'\n` : '';
  const filialWhere = filial && filial !== 'TODAS' && tabelaSF2 ? `  AND SF2.F2_FILIAL = '${helpers.escapeSqlLiteral(filial)}'\n` : '';

  let sql = null;
  if (tipo === 'cliente' && tabelaSA1) {
    // Alguns agentes locais retornam vazio para DISTINCT combinado com OR/LIKE
    // em campos CHAR do Protheus. SA1 e consulta direta; deduplicamos no Node.
    sql = `SET ROWCOUNT 10;\nSELECT SA1.A1_COD AS codigo, SA1.A1_LOJA AS loja, SA1.A1_NOME AS nome\nFROM ${tabelaCad} SA1\nWHERE SA1.D_E_L_E_T_ = ' '\n  AND (${camposLike(def, termoTexto, 'SA1', helpers)})\nORDER BY SA1.A1_NOME;`;
  } else if (tipo === 'vendedor' && tabelaSF2 && tabelaSA3) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SA3.A3_COD AS codigo, NULL AS loja, SA3.A3_NOME AS nome\nFROM ${tabelaSF2} SF2\nINNER JOIN ${tabelaCad} SA3 ON SF2.F2_VEND1 = SA3.A3_COD AND SA3.D_E_L_E_T_ = ' '\nWHERE SF2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SA3', helpers)})\nORDER BY SA3.A3_NOME;`;
  } else if (tipo === 'produto' && tabelaSD2 && tabelaSF2 && tabelaSB1) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SB1.B1_COD AS codigo, NULL AS loja, SB1.B1_DESC AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaCad} SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SB1', helpers)})\nORDER BY SB1.B1_DESC;`;
  } else if (tipo === 'grupo_produto' && tabelaSD2 && tabelaSF2 && tabelaSB1 && tabelaSBM) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SBM.BM_GRUPO AS codigo, NULL AS loja, SBM.BM_DESC AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSB1} SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSBM} SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SBM', helpers)})\nORDER BY SBM.BM_DESC;`;
  } else if (tipo === 'centro_custo' && tabelaSD2 && tabelaSF2 && tabelaCTT) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT CTT.CTT_CUSTO AS codigo, NULL AS loja, CTT.CTT_DESC01 AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaCTT} CTT ON SD2.D2_CCUSTO = CTT.CTT_CUSTO AND CTT.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'CTT', helpers)})\nORDER BY CTT.CTT_DESC01;`;
  } else if (tipo === 'tes' && tabelaSD2 && tabelaSF2 && tabelaSF4) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SF4.F4_CODIGO AS codigo, NULL AS loja, SF4.F4_TEXTO AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSF4} SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SF4', helpers)})\nORDER BY SF4.F4_TEXTO;`;
  }

  if (!sql) return [];
  try {
    const conn = helpers.connectionFactory.carregarConexao(empresaId);
    conn._empresa_id = empresaId  || '';
    conn._modulo     = 'faturamento';
    conn._operacao   = `lookup_${tipo}`;
    conn._pergunta   = termoTexto || '';
    conn._sender     = '';
    const rows = await helpers.connectionFactory.executar(conn, sql, {});
    return deduplicarCandidatos((rows || []).map(row => normalizarCandidato(def, row)).filter(c => c.codigo));
  } catch (e) {
    console.warn(`[FaturamentoIAOwner] Lookup ${tipo} falhou:`, e.message);
    return [];
  }
}

async function resolverEntidades({ pedidos, empresaId, sx2, periodo, filial, helpers }) {
  const resolvidas = [];
  for (const pedido of pedidos || []) {
    const texto = String(pedido.texto || '').trim();
    if (!texto) continue;
    let candidatos = [];
    for (const tipo of entityCatalog.tiposParaTermo(pedido)) {
      candidatos = await buscarEntidade({ empresaId, sx2, tipo, termoTexto: texto, periodo, filial, helpers });
      if (candidatos.length) break;
    }
    if (!candidatos.length) return { status: 'nao_encontrado', texto, origem: pedido.origem || null };
    if (candidatos.length > 1) return { status: 'ambigua', texto, candidatos, origem: pedido.origem || null };
    resolvidas.push({ ...candidatos[0], termoBusca: texto });
  }
  return { status: 'resolvido', entidades: resolvidas };
}

module.exports = {
  nome: 'faturamento',
  handlerName: 'faturamento-ia-owner',
  logPrefix: 'FaturamentoIAOwner',
  defaultMessage: 'consulta de faturamento',
  tabelas: TABELAS,
  entityCatalog,
  resolverEntidadesAntesDaIa: true,
  camposSx3Essenciais: CAMPOS_SX3_ESSENCIAIS,
  sqlMiddleware,
  regrasTecnicas,
  sx3PromptLimit: 90,
  maxTokens: 4600,
  dimensionLeftJoinBases: ['CTT', 'SF4', 'SBM', 'SA3'],
  sanitizarFiltrosFilialSX2: true,
  sqlPatternsProibidos: [
    {
      regex: /\bSF2\s*\.\s*F2_TIPO\s*=\s*'1'/i,
      mensagem: "Faturamento normal de NF de saida nao usa SF2.F2_TIPO = '1'; quando precisar filtrar tipo, use SF2.F2_TIPO = 'N'.",
    },
    {
      regex: /\bA1_NOME\s+(?:IN\s*\(|=|LIKE\b)/i,
      mensagem: 'Nao filtre cliente por SA1.A1_NOME no SQL final. Para cliente real, solicite entidade e filtre por codigo/loja; para nomes de empresas IAHub, nao crie filtro cadastral.',
    },
    {
      regex: /\bF2_FILIAL\s+IN\s*\(\s*SELECT\s+A1_FILIAL\s+FROM\s+SA1/i,
      mensagem: 'Empresa IAHub nao deve virar filtro de filial/cliente em SA1. Execute por tenant e SX2, sem subquery em SA1.',
    },
    {
      regex: /\bCASE\s+WHEN\s+SF4\s*\.\s*F4_CODIGO\s+IS\s+NOT\s+NULL\s+THEN\s+-\s*SD2\s*\.\s*D2_TOTAL/i,
      mensagem: 'Devolucao de venda nao deve ser identificada por SF4.F4_CODIGO em SD2; use SF1/SD1 com SF1.F1_TIPO = D e UNION ALL.',
    },
    {
      regex: /\bCASE\s+WHEN\s+SF4\s*\.\s*F4_TIPO\b[\s\S]{0,80}\bTHEN\s+-\s*SD2\s*\.\s*D2_TOTAL/i,
      mensagem: 'Devolucao de venda nao deve ser identificada por TES/SF4 em SD2; use SF1/SD1 com SF1.F1_TIPO = D e UNION ALL.',
    },
    {
      regex: /\bSUM\s*\(\s*SF2\s*\.\s*F2_VALBRUT\b[\s\S]{0,4000}\bJOIN\s+\w+\s+SD2\b|\bJOIN\s+\w+\s+SD2\b[\s\S]{0,4000}\bSUM\s*\(\s*SF2\s*\.\s*F2_VALBRUT\b/i,
      mensagem: 'JOIN com SD2 invalido quando a metrica e SUM(SF2.F2_VALBRUT). SD2 e tabela de itens: cada NF tem N linhas em SD2, o que multiplica F2_VALBRUT por N ao somar. Use apenas FROM SF2 quando a metrica for F2_VALBRUT. Inclua SD2 somente quando o SELECT ou GROUP BY precisar de campo D2_* (produto, quantidade, D2_TOTAL, TES, centro de custo).',
    },
    {
      regex: /^(?![\s\S]*\bJOIN\s+\w+\s+SB1\b)[\s\S]*\bSB1\s*\.\s*B1_\w+/i,
      mensagem: 'Campo SB1.B1_* usado sem JOIN SB1 declarado no FROM. Adicione JOIN SB1<sufixo> SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = " " antes de usar campos de produto.',
    },
  ],
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta de faturamento no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta de faturamento. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei faturamento para essa consulta.',
    erro_erp: 'Nao consegui buscar o faturamento no ERP. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao: 'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  },
  garantirIntencao,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  _test: {
    buscarEntidade,
    resolverEntidades,
  },
};
