'use strict';

const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');

const TABELAS = ['SF1', 'SD1', 'SF2', 'SD2', 'SB1', 'SBM', 'SA2', 'SC7', 'CTT', 'SED', 'SF4'];

const CAMPOS_SX3_ESSENCIAIS = {
  SD1: ['D1_FILIAL', 'D1_DOC', 'D1_SERIE', 'D1_FORNECE', 'D1_LOJA', 'D1_COD', 'D1_DESCRI', 'D1_QUANT', 'D1_VUNIT', 'D1_TOTAL', 'D1_DTDIGIT', 'D1_TES', 'D1_NATUREZ', 'D1_PEDIDO', 'D1_ITEMPC', 'D1_CC', 'D1_CF', 'D_E_L_E_T_'],
  SF1: ['F1_FILIAL', 'F1_DOC', 'F1_SERIE', 'F1_FORNECE', 'F1_LOJA', 'F1_EMISSAO', 'F1_DTDIGIT', 'F1_TIPO', 'F1_VALBRUT', 'F1_VALMERC', 'F1_TOTALNF', 'D_E_L_E_T_'],
  SD2: ['D2_FILIAL', 'D2_DOC', 'D2_SERIE', 'D2_CLIENTE', 'D2_LOJA', 'D2_COD', 'D2_TOTAL', 'D2_EMISSAO', 'D2_NFORI', 'D2_SERIORI', 'D2_ITEMORI', 'D_E_L_E_T_'],
  SF2: ['F2_FILIAL', 'F2_DOC', 'F2_SERIE', 'F2_CLIENTE', 'F2_LOJA', 'F2_EMISSAO', 'F2_TIPO', 'F2_VALBRUT', 'F2_VALMERC', 'D_E_L_E_T_'],
  SA2: ['A2_FILIAL', 'A2_COD', 'A2_LOJA', 'A2_NOME', 'A2_NREDUZ', 'A2_CGC', 'D_E_L_E_T_'],
  SB1: ['B1_FILIAL', 'B1_COD', 'B1_DESC', 'B1_GRUPO', 'B1_UM', 'D_E_L_E_T_'],
  SBM: ['BM_FILIAL', 'BM_GRUPO', 'BM_DESC', 'D_E_L_E_T_'],
  SC7: ['C7_FILIAL', 'C7_NUM', 'C7_ITEM', 'C7_FORNECE', 'C7_LOJA', 'C7_PRODUTO', 'C7_QUANT', 'C7_PRECO', 'C7_TOTAL', 'C7_EMISSAO', 'C7_DATPRF', 'C7_RESIDUO', 'C7_OK', 'D_E_L_E_T_'],
  CTT: ['CTT_FILIAL', 'CTT_CUSTO', 'CTT_DESC01', 'D_E_L_E_T_'],
  SED: ['ED_FILIAL', 'ED_CODIGO', 'ED_DESCRIC', 'D_E_L_E_T_'],
  SF4: ['F4_FILIAL', 'F4_CODIGO', 'F4_TEXTO', 'F4_TIPO', 'F4_DUPLIC', 'F4_ESTOQUE', 'F4_CF', 'D_E_L_E_T_'],
};

function garantirIntencao(empresaId) {
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    const existe = db.prepare("SELECT id FROM intentions WHERE empresa_id = ? AND nome = 'compras_dinamico' LIMIT 1").get(empresaId);
    if (existe) return;
    crud.criar('intentions', {
      empresa_id: empresaId,
      nome: 'compras_dinamico',
      descricao: 'Consultas dinamicas de compras via IA-OWNER',
      modulo: 'compras',
      acao: 'ai_text_to_sql',
      dataset_id: null,
      frases_exemplo: [
        'quanto comprei no mes',
        'compras por fornecedor',
        'compras por produto',
        'notas fiscais de entrada',
        'pedidos de compra',
        'media mensal de compras',
      ].join('\n'),
      ativo: 1,
    });
    require('../../ai/intent-service').invalidateCache(empresaId);
  } catch (e) {
    console.warn(`[ComprasIAOwner] Falha ao garantir intencao para empresa #${empresaId}:`, e.message);
  }
}

const regrasTecnicas = `
## Campos de data padrao
- Notas de entrada (compras): SD1.D1_DTDIGIT (CHAR(8) YYYYMMDD).
- Pedidos de compra: SC7.C7_EMISSAO.

## Devolucoes
- Nao inclua devolucoes nas metricas de compras por padrao.
- Somente considere devolucoes quando o usuario pedir explicitamente: devolucao, devolucoes, retorno, estorno, abatendo devolucoes, considerar devolucoes.
- "considerando devolucao", "com devolucao", "abatendo devolucao" ou "liquido de devolucao" significa compras liquidas: compras normais positivas menos devolucoes/retornos quando for possivel identificar ambos.
- So retorne apenas devolucoes quando o usuario disser claramente "somente devolucoes", "apenas devolucoes", "total de devolucoes" ou equivalente.
- No Protheus, devolucao de compra e nota de saida do SIGAFAT: use obrigatoriamente SF2/SD2, com SF2.F2_TIPO = 'D'. Nao use SF4/TES nem CASE em SD1 para identificar devolucao de compra.
- Quando o usuario pedir para considerar devolucoes, compras liquidas ou abatendo devolucoes, monte obrigatoriamente uma consulta externa sobre subqueries unificadas por UNION ALL:
  1. Subquery de compras: origem SD1/SF1. Projete SD1.D1_TOTAL AS valor_compra e 0 AS valor_devolucao.
  2. Subquery de devolucoes: origem SD2/SF2. Filtre SF2.F2_TIPO = 'D'. Projete 0 AS valor_compra e SD2.D2_TOTAL AS valor_devolucao.
- A query externa deve selecionar SUM(valor_compra) AS total_compras, SUM(valor_devolucao) AS total_devolucoes e (SUM(valor_compra) - SUM(valor_devolucao)) AS total_liquido.
- Aplique o mesmo periodo e os mesmos filtros cadastrais nas duas subqueries quando fizer sentido. Para compras use SD1.D1_DTDIGIT ou SF1.F1_DTDIGIT. Para devolucoes use SF2.F2_EMISSAO ou SD2.D2_EMISSAO conforme campos disponiveis.
- Nota Protheus: na devolucao de compras (SF2 tipo D), o codigo do fornecedor e gravado em F2_CLIENTE/SD2.D2_CLIENTE e loja em F2_LOJA/SD2.D2_LOJA. Se houver filtro de fornecedor resolvido, filtre compras por SF1.F1_FORNECE/F1_LOJA e devolucoes por SF2.F2_CLIENTE/F2_LOJA.
- Quando houver necessidade de associar devolucao a uma nota de compra original, use os campos de origem da SD2, como D2_NFORI e D2_SERIORI, junto da nota/serie da compra quando esses campos estiverem disponiveis.

## Tabelas padrao do modulo Compras
- SF1: cabecalho de NF de entrada. F1_VALBRUT e o valor bruto total da nota (nivel cabecalho).
- SD1: itens de NF de entrada. Metrica principal: SD1.D1_TOTAL. Quantidade: SD1.D1_QUANT.
- Para compras normais por nota fiscal de entrada, quando filtrar tipo, use SF1.F1_TIPO = 'N'. Nunca use SF1.F1_TIPO = '1'.
- DIRETRIZ DE SELECAO DE TABELAS: Cabecalho (SF1) vs Itens (SD1)
  Avalie a METRICA e a granularidade da pergunta para determinar a estrutura do FROM/JOIN. O uso incorreto gera duplicidade matematica ou metricas zeradas.
  1. Consultas por VALOR Financeiro Total (sem produto/item):
     Quando o usuario pedir "Total de compras", "Compras do ano", "Compras do mes" ou "Compras de um periodo" — metricas puramente monetarias, sem especificar produto, grupo de produto ou QUANTIDADE — use FROM SD1 JOIN SF1 com metrica COALESCE(SUM(SD1.D1_TOTAL), 0) AS valor_compra.
     Se usar SF1 sozinha (sem SD1) a metrica pode ser COALESCE(SUM(SF1.F1_VALBRUT), 0) AS valor_compra. Porem EXPRESSAMENTE PROIBIDO usar SUM(SF1.F1_VALBRUT) quando SD1 estiver no FROM/JOIN: o relacionamento 1-para-muitos entre SF1 e SD1 multiplica F1_VALBRUT pela quantidade de itens da nota, gerando valores duplicados errados.
  2. Consultas por QUANTIDADE ou filtros de Produto/Item:
     Quando o usuario pedir "Quantidade comprada", "Volume de compras", "Total de pecas compradas" (mesmo total escalar de uma unica linha), ou quando citar produtos e grupos de produtos, use OBRIGATORIAMENTE FROM SD1 JOIN SF1.
     Metrica de quantidade escalar obrigatoria: COALESCE(SUM(SD1.D1_QUANT), 0) AS quantidade_comprada.
     NUNCA use SF1 sozinha quando a pergunta contiver "Quantidade": o cabecalho nao armazena volume de itens.
     Quando o usuario pedir SIMULTANEAMENTE "por valor" e "por quantidade" com agrupamento por produto/grupo: ambas as metricas devem vir de SD1. Exemplo: SELECT ..., COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_compra, COALESCE(SUM(SD1.D1_QUANT),0) AS quantidade_comprada FROM SD1... JOIN SF1...
- SF2: cabecalho de NF de saida do faturamento; para devolucao de compra use SF2.F2_TIPO = 'D'.
- SD2: itens de NF de saida do faturamento; para valor de devolucao use SD2.D2_TOTAL.
- SA2: fornecedores.
- SB1: produtos.
- SBM: grupo de produtos.
- SC7: pedidos de compra.
- CTT: centro de custo.
- SED: natureza.
- SF4: TES.

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
  Quando o usuario perguntar sobre notas que geraram estoque ou movimentaram estoque, filtre SF4.F4_ESTOQUE = 'S' via JOIN SD1 -> SF4.
- SF4.F4_DUPLIC: 'S' = TES gera lancamento financeiro (duplicata/pagar); 'N' = nao gera financeiro.
  Quando o usuario perguntar sobre notas que geraram financeiro, contas a pagar ou duplicatas, filtre SF4.F4_DUPLIC = 'S' via JOIN SD1 -> SF4.
  Este filtro e mais preciso que filtrar por CF para identificar compras que geraram obrigacao financeira real.

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

## Metrica por agrupamento
- "por mes": SUBSTRING(SD1.D1_DTDIGIT, 1, 6) AS competencia no SELECT e GROUP BY.
- "por fornecedor": agrupe por SA2.A2_COD, SA2.A2_LOJA, SA2.A2_NOME.
- "por produto": agrupe por SB1.B1_COD, SB1.B1_DESC.
- Media mensal por ano (subquery 2 camadas, agrupado por ano):
  Subquery interna exporta DOIS aliases: SUBSTRING(SD1.D1_DTDIGIT,1,4) AS ano E SUBSTRING(SD1.D1_DTDIGIT,1,6) AS competencia. Query externa: SELECT h.ano, AVG(h.valor_compra) AS media_mensal FROM (...) AS h GROUP BY h.ano. Camada externa usa SOMENTE h.ano e h.valor_compra — NUNCA SD1.* ou SF1.*.
- Media mensal escalar (1 ano): subquery interna SUM por mes. Query externa AVG(h.valor_compra) sem GROUP BY.
- Media anual escalar: subquery interna SUM por ano → externa AVG dos totais. Alias externo: AS valor_compra.
- Resposta planejada com devolucoes: template com {total_compras}, {total_devolucoes}, {total_liquido}.
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

async function buscarEntidade({ empresaId, sx2, tipo, termoTexto, periodo, filial, helpers }) {
  const def = entityCatalog.DEFINICOES[tipo];
  if (!def) return [];

  const tabelaCad = helpers.tabelaFisicaSX2(sx2, def.tabelaBase);
  const tabelaSF1 = helpers.tabelaFisicaSX2(sx2, 'SF1');
  const tabelaSD1 = helpers.tabelaFisicaSX2(sx2, 'SD1');
  const tabelaSB1 = helpers.tabelaFisicaSX2(sx2, 'SB1');
  const tabelaSBM = helpers.tabelaFisicaSX2(sx2, 'SBM');
  const tabelaCTT = helpers.tabelaFisicaSX2(sx2, 'CTT');
  const tabelaSED = helpers.tabelaFisicaSX2(sx2, 'SED');
  const tabelaSF4 = helpers.tabelaFisicaSX2(sx2, 'SF4');
  if (!tabelaCad) return [];

  const ini = periodo?.dataInicio || periodo?.data_inicio;
  const fim = periodo?.dataFim || periodo?.data_fim;
  const periodoWhere = ini && fim && tabelaSF1 ? `  AND SF1.F1_DTDIGIT BETWEEN '${helpers.escapeSqlLiteral(ini)}' AND '${helpers.escapeSqlLiteral(fim)}'\n` : '';
  const filialWhere = filial && filial !== 'TODAS' && tabelaSF1 ? `  AND SF1.F1_FILIAL = '${helpers.escapeSqlLiteral(filial)}'\n` : '';

  let sql = null;
  if (tipo === 'fornecedor' && tabelaSF1) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SA2.A2_COD AS codigo, SA2.A2_LOJA AS loja, SA2.A2_NOME AS nome\nFROM ${tabelaSF1} SF1\nINNER JOIN ${tabelaCad} SA2 ON SF1.F1_FORNECE = SA2.A2_COD AND SF1.F1_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '\nWHERE SF1.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SA2', helpers)})\nORDER BY SA2.A2_NOME;`;
  } else if (tipo === 'produto' && tabelaSD1 && tabelaSF1 && tabelaSB1) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SB1.B1_COD AS codigo, NULL AS loja, SB1.B1_DESC AS nome\nFROM ${tabelaSD1} SD1\nINNER JOIN ${tabelaSF1} SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaCad} SB1 ON SD1.D1_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '\nWHERE SD1.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SB1', helpers)})\nORDER BY SB1.B1_DESC;`;
  } else if (tipo === 'grupo_produto' && tabelaSD1 && tabelaSF1 && tabelaSB1 && tabelaSBM) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SBM.BM_GRUPO AS codigo, NULL AS loja, SBM.BM_DESC AS nome\nFROM ${tabelaSD1} SD1\nINNER JOIN ${tabelaSF1} SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSB1} SB1 ON SD1.D1_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSBM} SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = ' '\nWHERE SD1.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SBM', helpers)})\nORDER BY SBM.BM_DESC;`;
  } else if (tipo === 'centro_custo' && tabelaSD1 && tabelaSF1 && tabelaCTT) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT CTT.CTT_CUSTO AS codigo, NULL AS loja, CTT.CTT_DESC01 AS nome\nFROM ${tabelaSD1} SD1\nINNER JOIN ${tabelaSF1} SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaCTT} CTT ON SD1.D1_CC = CTT.CTT_CUSTO AND CTT.D_E_L_E_T_ = ' '\nWHERE SD1.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'CTT', helpers)})\nORDER BY CTT.CTT_DESC01;`;
  } else if (tipo === 'natureza' && tabelaSD1 && tabelaSF1 && tabelaSED) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SED.ED_CODIGO AS codigo, NULL AS loja, SED.ED_DESCRIC AS nome\nFROM ${tabelaSD1} SD1\nINNER JOIN ${tabelaSF1} SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSED} SED ON SD1.D1_NATUREZ = SED.ED_CODIGO AND SED.D_E_L_E_T_ = ' '\nWHERE SD1.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SED', helpers)})\nORDER BY SED.ED_DESCRIC;`;
  } else if (tipo === 'tes' && tabelaSD1 && tabelaSF1 && tabelaSF4) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SF4.F4_CODIGO AS codigo, NULL AS loja, SF4.F4_TEXTO AS nome\nFROM ${tabelaSD1} SD1\nINNER JOIN ${tabelaSF1} SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSF4} SF4 ON SD1.D1_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' '\nWHERE SD1.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SF4', helpers)})\nORDER BY SF4.F4_TEXTO;`;
  }

  if (!sql) return [];
  try {
    const conn = helpers.connectionFactory.carregarConexao(empresaId);
    conn._empresa_id = empresaId  || '';
    conn._modulo     = 'compras';
    conn._operacao   = `lookup_${tipo}`;
    conn._pergunta   = termoTexto || '';
    conn._sender     = '';
    const rows = await helpers.connectionFactory.executar(conn, sql, {});
    return (rows || []).map(row => normalizarCandidato(def, row)).filter(c => c.codigo);
  } catch (e) {
    console.warn(`[ComprasIAOwner] Lookup ${tipo} falhou:`, e.message);
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
  nome: 'compras',
  handlerName: 'compras-ia-owner',
  logPrefix: 'ComprasIAOwner',
  defaultMessage: 'consulta de compras',
  tabelas: TABELAS,
  entityCatalog,
  resolverEntidadesAntesDaIa: true,
  camposSx3Essenciais: CAMPOS_SX3_ESSENCIAIS,
  sqlMiddleware,
  regrasTecnicas,
  sx3PromptLimit: 90,
  maxTokens: 4200,
  dimensionLeftJoinBases: ['CTT', 'SF4', 'SBM'],
  sanitizarFiltrosFilialSX2: true,
  sqlPatternsProibidos: [
    {
      regex: /\bSF1\s*\.\s*F1_TIPO\s*=\s*'1'/i,
      mensagem: "Compras normais de NF de entrada nao usam SF1.F1_TIPO = '1'; quando precisar filtrar tipo, use SF1.F1_TIPO = 'N'.",
    },
    {
      regex: /\bA2_NOME\s+(?:IN\s*\(|=|LIKE\b)/i,
      mensagem: 'Nao filtre fornecedor por SA2.A2_NOME no SQL final. Para fornecedor real, solicite entidade e filtre por codigo/loja; para nomes de empresas IAHub, nao crie filtro cadastral.',
    },
    {
      regex: /\bF1_FILIAL\s+IN\s*\(\s*SELECT\s+A2_FILIAL\s+FROM\s+SA2/i,
      mensagem: 'Empresa IAHub nao deve virar filtro de filial/fornecedor em SA2. Execute por tenant e SX2, sem subquery em SA2.',
    },
    {
      regex: /\bSUM\s*\(\s*SF1\s*\.\s*F1_VALBRUT\b[\s\S]{0,4000}\bJOIN\s+\w+\s+SD1\b|\bJOIN\s+\w+\s+SD1\b[\s\S]{0,4000}\bSUM\s*\(\s*SF1\s*\.\s*F1_VALBRUT\b/i,
      mensagem: 'JOIN com SD1 invalido quando a metrica e SUM(SF1.F1_VALBRUT). SD1 e tabela de itens: cada NF tem N linhas em SD1, o que multiplica F1_VALBRUT por N ao somar. Quando SD1 estiver no FROM/JOIN, use SUM(SD1.D1_TOTAL) como metrica de valor e SUM(SD1.D1_QUANT) para quantidade.',
    },
  ],
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta de compras no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta de compras. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei compras para essa consulta.',
    erro_erp: 'Nao consegui buscar as compras no ERP. Tente um periodo menor ou filtros mais especificos.',
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
