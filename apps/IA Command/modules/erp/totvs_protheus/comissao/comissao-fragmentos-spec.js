'use strict';

/**
 * Fragmentos de regrasTecnicas da comissao, organizados por sub-operacao
 * (identidade do vendedor/seguranca, carteira/status, pagamento real,
 * media/crescimento em 3 granularidades, comparativo entre periodos) em vez
 * de um unico bloco monolitico. Mesma arquitetura aplicada ao financeiro,
 * faturamento e compras.
 *
 * A concatenacao de TODOS os fragmentos (fallback, quando a pergunta nao
 * classifica em nenhuma sub-operacao especifica) reproduz o regrasTecnicas
 * anterior, preservando os testes existentes.
 */

function base() {
  return `
## Campos de data padrao
- Comissao provisionada: SE3.E3_VENCTO (CHAR(8) YYYYMMDD).
- Comissao paga/preparada: SE3.E3_DATA quando existir no SX3.
- Baixa/pagamento financeiro real: SE5.E5_DATA quando SE2/SE5 forem usados.
- Em aberto/pendente sem periodo explicito: consulte toda a carteira em aberto (sem BETWEEN).

## Tabelas padrao do modulo Comissao
- SE3: comissoes. Metrica principal: SE3.E3_COMIS. Valor base/venda: SE3.E3_BASE.
- SA3: vendedores.
- SA1: clientes.
- SE2: titulos financeiros de provisao de comissao, use apenas quando a pergunta exigir financeiro/pagamento ou quando precisar conectar com SE5.
- SE5: movimentos/baixas financeiras, use para pagamento/baixa real quando disponivel.

## Joins padrao
- SE3 -> SA3:
  SE3.E3_VEND = SA3.A3_COD
- SE3 -> SA1:
  SE3.E3_CODCLI = SA1.A1_COD
  AND SE3.E3_LOJA = SA1.A1_LOJA
- SE3 -> SE2, apenas quando necessario e campos existirem:
  SE2.E2_FILIAL = SE3.E3_FILIAL
  AND SE2.E2_FORNECE = SE3.E3_VEND
  AND SE2.E2_NUM = SE3.E3_NUM
  AND SE2.E2_PARCELA = SE3.E3_PARCELA quando ambos existirem
  AND SE2.E2_TIPO IN ('COM','TX') quando E2_TIPO existir
- SE2 -> SE5, apenas quando necessario e campos existirem:
  SE5.E5_FILIAL = SE2.E2_FILIAL
  AND SE5.E5_CLIFOR = SE2.E2_FORNECE
  AND SE5.E5_LOJA = SE2.E2_LOJA
  AND SE5.E5_NUMERO = SE2.E2_NUM
  AND SE5.E5_PARCELA = SE2.E2_PARCELA quando ambos existirem
  AND SE5.E5_TIPO = SE2.E2_TIPO quando ambos existirem
  AND SE5.E5_PREFIXO = SE2.E2_PREFIXO quando ambos existirem

## Regras obrigatorias de SQL
- Inicie sempre com SET ROWCOUNT 50000.
- Use aliases explicitos iguais a base da tabela: SE3, SA3, SA1, SE2, SE5.
- Qualifique campos sempre pelo alias base (SE3.E3_COMIS, nunca SE3990.E3_COMIS).
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.

## Exibicao de entidades
- vendedor: SA3.A3_NOME AS vendedor. Codigo como cod_vendedor.
- cliente: SA1.A1_NOME AS cliente. Codigo/loja como cod_cliente e loja_cliente.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.

## Metrica por agrupamento
- Metrica principal: COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao.
- Base/venda: COALESCE(SUM(SE3.E3_BASE),0) AS valor_venda (inclua quando pedido ou para contextualizar).
- "por vendedor": agrupe por SA3.A3_COD, SA3.A3_NOME.
- "por cliente": agrupe por SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
- "por mes": SUBSTRING(SE3.E3_VENCTO, 1, 6) AS competencia no SELECT e GROUP BY.
`;
}

function identidadeVendedor() {
  return `
## Identidade do vendedor — REGRA DE SEGURANCA OBRIGATORIA
- Se o contexto tecnico trouxer vendedorFixo, aplique obrigatoriamente filtro desse vendedor em SE3.E3_VEND.
- Nunca retorne dados de outros vendedores quando vendedorFixo estiver presente, mesmo que o usuario nao cite vendedor (agregados gerais tambem devem ser filtrados pelo vendedorFixo).
- REGRA ABSOLUTA: se entidades_resolvidas contiver um vendedor com codigo DIFERENTE do vendedorFixo, NAO gere SQL algum. Retorne precisa_confirmacao=true com pergunta_confirmacao recusando o pedido — o sistema ja bloqueia esse caso antes desta etapa, mas a IA nunca deve tentar conciliar dois codigos de vendedor distintos (ex: via OR, UNION ou subquery) em uma mesma consulta.
- Quando vendedorFixo NAO estiver presente (quem pergunta e gestor), a consulta pode abranger todos os vendedores normalmente.
`;
}

function carteiraStatus() {
  return `
## Carteira / status
- Comissao em aberto/a receber/pendente: filtre LTRIM(RTRIM(SE3.E3_DATA)) = '' quando E3_DATA existir no SX3.
- Comissao paga/realizada: filtre LTRIM(RTRIM(SE3.E3_DATA)) <> '' quando usar SE3.
- SE3.E3_STATUS nao significa pagamento realizado; nao use E3_STATUS como pago/em aberto.
`;
}

function pagamentoReal() {
  return `
## Pagamento real (baixa financeira)
- Quando a pergunta pedir comissao paga/realizada por data de pagamento e SE2/SE5 estiverem disponiveis, use SE3 -> SE2 -> SE5 e filtre SE5.E5_DATA.
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
## Media de comissao — granularidade ${granularidade}
- ATENCAO — NAO CONFUNDA COM CRESCIMENTO: "media" e "crescimento/variacao" sao operacoes DIFERENTES, mesmo usando a mesma subquery de SUM por periodo como base. Media usa AVG() na camada externa (retorna 1 numero: a media entre os periodos). Crescimento usa LAG() OVER (...) na camada externa (retorna 1 linha por periodo, comparando cada um com o anterior). Se o usuario pedir "media", a resposta final e um numero (ou uma linha por nivel externo se pedir "por ano/mes"), NUNCA uma lista de linhas com LAG/crescimento_valor/crescimento_percentual.
- PROIBIDO ABSOLUTO — NUNCA use AVG(SE3.E3_COMIS) com GROUP BY na mesma camada. Isso calcula o valor medio de CADA LANCAMENTO dentro de cada periodo (ticket medio por comissao), NAO a media do TOTAL DE COMISSAO entre os periodos — sao numeros completamente diferentes.
- REGRA ESTRUTURAL OBRIGATORIA — SEMPRE DUAS CAMADAS, SEM EXCECAO: (1) subquery/CTE interna agrupa por SUBSTRING(SE3.E3_VENCTO,1,${tam}) AS ${alias} (sempre a partir da posicao 1, contando ${tam} caracteres da data completa YYYYMMDD — NUNCA SUBSTRING(campo,7,2), que extrai apenas o dia do mes isolado e mistura periodos diferentes), exportando COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao_${aliasMetrica}; (2) query externa faz SELECT ... AVG(h.valor_comissao_${aliasMetrica}) ... FROM (<subquery interna>) AS h. PROIBIDO retornar apenas a subquery interna (listagem por periodo) como resultado final — isso nao e uma media. O resultado final OBRIGATORIAMENTE passa por uma camada externa com AVG(), mesmo quando o resultado e 1 linha escalar.
- Media mensal por ano (subquery agrupada por nivel maior): subquery interna OBRIGATORIAMENTE exporta DOIS aliases de data: o nivel de detalhe (ex: SUBSTRING(SE3.E3_VENCTO,1,6) AS competencia) E o nivel de agrupamento externo (ex: SUBSTRING(SE3.E3_VENCTO,1,4) AS ano). Nunca exporte so o nivel de detalhe.
- REGRA DE DECISAO — agrupar ou nao na query externa: SO agrupe (GROUP BY h.<nivel_externo>) quando o usuario pedir explicitamente a media "POR" o nivel externo (ex: "media mensal POR ano"). Media mensal escalar (1 ano especifico, sem agrupamento por nivel externo, sem GROUP BY na query externa): quando o usuario pedir a media de UM CONJUNTO de periodos especificos sem dizer "por" (ex: "media anual considerando 2025 e 2026") o resultado e ESCALAR — a subquery interna filtra os periodos pedidos no WHERE e precisa de GROUP BY SUBSTRING(...) pelo nivel de detalhe mesmo assim, para retornar uma linha por periodo antes do AVG externo.
- Media anual escalar: subquery interna SUM por ano → query externa AVG dos totais anuais. Camada externa usa SOMENTE h.valor_comissao_ano — nunca SE3.*.
- NUNCA use AVG(SE3.E3_BASE) diretamente sobre a tabela fato para "media de venda": mesmo problema de ticket medio.
- PROIBIDO ABSOLUTO — NUNCA escreva AVG(SUM(...)) na mesma camada: agregar uma funcao de agregacao dentro de outra (sem subquery entre elas) e SINTAXE INVALIDA no SQL Server, a query falha na execucao. SUM() e AVG() devem SEMPRE estar em camadas (FROM) diferentes: SUM() dentro da subquery interna, AVG() na query externa que faz FROM (subquery) AS h.
- EXCECAO A REGRA GERAL DE FORMATACAO DE DIA: a regra universal de converter campo "dia" para DD/MM/YYYY na projecao NAO se aplica na query externa de uma consulta de media — a query externa de media so projeta AVG(h.<coluna>) (e opcionalmente h.<nivel_externo> sem formatacao, quando agrupada por "POR ano/mes"). PROIBIDO referenciar SE3.* ou qualquer campo da tabela fato (incluindo SUBSTRING/CONVERT sobre SE3.E3_VENCTO) na query externa — a query externa so conhece os aliases exportados por "h" (a subquery interna), nunca a tabela fisica SE3 diretamente.

### EXEMPLO CORRETO — media diaria escalar (1 numero, sem GROUP BY na query externa)
SELECT AVG(h.valor_comissao_dia) AS media_comissao
FROM (
  SELECT SUBSTRING(SE3.E3_VENCTO, 1, 8) AS dia, COALESCE(SUM(SE3.E3_COMIS), 0) AS valor_comissao_dia
  FROM SE3xxx SE3
  WHERE SE3.D_E_L_E_T_ = ' ' AND SUBSTRING(SE3.E3_VENCTO, 1, 6) = '202605'
  GROUP BY SUBSTRING(SE3.E3_VENCTO, 1, 8)
) AS h;

### EXEMPLO CORRETO — media anual escalar entre periodos especificos (ex: 2025 e 2026)
SELECT AVG(h.valor_comissao_ano) AS media_comissao
FROM (
  SELECT SUBSTRING(SE3.E3_VENCTO, 1, 4) AS ano, COALESCE(SUM(SE3.E3_COMIS), 0) AS valor_comissao_ano
  FROM SE3xxx SE3
  WHERE SE3.D_E_L_E_T_ = ' ' AND SUBSTRING(SE3.E3_VENCTO, 1, 4) IN ('2025', '2026')
  GROUP BY SUBSTRING(SE3.E3_VENCTO, 1, 4)
) AS h;
`;
}

function crescimento({ granularidade = 'mensal' } = {}) {
  const { tam, alias } = TRUNC_POR_GRANULARIDADE[granularidade] || TRUNC_POR_GRANULARIDADE.mensal;
  const periodoLabel = granularidade === 'anual' ? 'ano' : granularidade === 'diaria' ? 'dia' : 'mes';
  return `
## Crescimento mensal / variacao mensal / evolucao mes a mes de comissao (granularidade ${granularidade})
- Quando o usuario pedir comissao por ${periodoLabel} demonstrando crescimento, variacao, aumento, queda ou evolucao, a SQL deve calcular a comparacao contra o periodo anterior (LAG). Nao retorne apenas ${alias} + valor_comissao.
- Use duas camadas: (1) subquery/CTE com SUBSTRING(SE3.E3_VENCTO,1,${tam}) AS ${alias} e COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao; (2) query externa com h.${alias}, h.valor_comissao, LAG(h.valor_comissao) OVER (ORDER BY h.${alias}) AS valor_comissao_anterior, (h.valor_comissao - LAG(h.valor_comissao) OVER (ORDER BY h.${alias})) AS crescimento_valor e CASE WHEN LAG(h.valor_comissao) OVER (ORDER BY h.${alias}) IS NULL OR LAG(h.valor_comissao) OVER (ORDER BY h.${alias}) = 0 THEN NULL ELSE ((h.valor_comissao - LAG(h.valor_comissao) OVER (ORDER BY h.${alias})) * 100.0 / LAG(h.valor_comissao) OVER (ORDER BY h.${alias})) END AS crescimento_percentual.
- Na query externa use SOMENTE aliases exportados pela camada interna (h.${alias}, h.valor_comissao). NUNCA referencie SE3.* fora da subquery/CTE.
- Se o usuario pedir "crescimento" sem especificar valor ou percentual, inclua ambos: crescimento_valor e crescimento_percentual. O primeiro periodo deve ficar com crescimento_percentual NULL por nao haver periodo anterior.
`;
}

function comparativoPeriodos() {
  return `
## Comparativo entre periodos especificos (nao necessariamente adjacentes)
- Diferente de crescimento (que compara cada periodo com o IMEDIATAMENTE anterior via LAG), comparativo trata de periodos ESPECIFICOS escolhidos pelo usuario, que podem nao ser adjacentes (ex: "comissao de junho de 2025 vs junho de 2026", "este ano comparado a 2 anos atras").
- Para comparar UM periodo de referencia contra OUTROS periodos: o periodo de REFERENCIA vai em subquery escalar SEM GROUP BY (retorna 1 valor); os periodos COMPARADOS ficam na query principal com GROUP BY.
- PROIBIDO: subquery com GROUP BY dentro de uma comparacao escalar (=, <, >, <=, >=, HAVING). GROUP BY na subquery retorna N linhas, causando erro do SQL Server ("Subquery returned more than 1 value").
- Para comparar MULTIPLOS periodos especificos lado a lado (ex: "2024 vs 2025 vs 2026"): use GROUP BY pela mesma dimensao em todos, com filtro WHERE restringindo exatamente aos periodos pedidos.
- Granularidade do comparativo (dia/mes/ano) e definida pela pergunta do usuario — use SUBSTRING(SE3.E3_VENCTO,1,8) para dia, 1,6 para mes, 1,4 para ano, sempre consistente entre os periodos comparados.
- REGRA ABSOLUTA — calculo de competencia "mesmo mes, ano diferente": ao montar o valor de competencia (formato AAAAMM) para "mesmo mes do ano anterior/seguinte", o MES permanece IDENTICO e SOMENTE o ANO muda. Erro comum a evitar: ao comparar "junho de 2026 com junho de 2025", o periodo comparado e competencia = '202506' (ano 2025, mes 06) — NUNCA mude o mes ao trocar o ano.
- EXEMPLO CORRETO — junho/2026 vs junho/2025: SUBSTRING(SE3.E3_VENCTO,1,6) IN ('202606', '202506') — mesmo mes "06" nos dois anos.
`;
}

const FRAGMENTOS = {
  // identidade_vendedor nao tem keywords: e sempre injetado pelo classificador,
  // independente do texto da pergunta (regra de seguranca, nao de assunto).
  identidade_vendedor: {
    texto: identidadeVendedor,
    sempre: true,
  },
  carteira_status: {
    texto: carteiraStatus,
    keywords: [/\bem\s+aberto\b/i, /\ba\s+receber\b/i, /\bpendente\b/i, /\bpaga?s?\b/i, /\brealizad[ao]s?\b/i, /\bstatus\b/i],
  },
  pagamento_real: {
    texto: pagamentoReal,
    keywords: [/\bdata\s+de\s+pagamento\b/i, /\bpagamento\s+real\b/i, /\bbaixa\b/i, /\bquando\s+foi\s+pag[ao]\b/i],
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
  'identidade_vendedor',
  'carteira_status',
  'pagamento_real',
  'media_diaria',
  'media_mensal',
  'media_anual',
  'crescimento_diario',
  'crescimento_mensal',
  'crescimento_anual',
  'comparativo_periodos',
];

module.exports = { base, FRAGMENTOS, ORDEM_FALLBACK };
