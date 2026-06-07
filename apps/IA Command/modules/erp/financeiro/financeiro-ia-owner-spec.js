'use strict';

const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const { removerFiltrosEmpresaComoEntidade } = require('../empresa-scope-sql-guard');

const TABELAS = ['SE1', 'SE2', 'SE5', 'SE8', 'SA1', 'SA2', 'SA3', 'SA6', 'SED', 'FK1', 'FK2', 'FK5', 'FK6', 'FK7', 'FKA', 'FKB'];

const CAMPOS_SX3_ESSENCIAIS = {
  SE1: ['E1_FILIAL', 'E1_PREFIXO', 'E1_NUM', 'E1_PARCELA', 'E1_TIPO', 'E1_CLIENTE', 'E1_LOJA', 'E1_EMISSAO', 'E1_VENCTO', 'E1_VENCREA', 'E1_VALOR', 'E1_SALDO', 'E1_BAIXA', 'E1_NATUREZ', 'E1_VEND1', 'E1_VALCOM1', 'D_E_L_E_T_'],
  SE2: ['E2_FILIAL', 'E2_PREFIXO', 'E2_NUM', 'E2_PARCELA', 'E2_TIPO', 'E2_FORNECE', 'E2_LOJA', 'E2_EMISSAO', 'E2_VENCTO', 'E2_VENCREA', 'E2_VALOR', 'E2_SALDO', 'E2_BAIXA', 'E2_NATUREZ', 'D_E_L_E_T_'],
  SE5: ['E5_FILIAL', 'E5_DATA', 'E5_NUMERO', 'E5_PARCELA', 'E5_TIPO', 'E5_CLIFOR', 'E5_LOJA', 'E5_PREFIXO', 'E5_VALOR', 'E5_RECPAG', 'E5_NATUREZ', 'D_E_L_E_T_'],
  SE8: ['E8_FILIAL', 'E8_BANCO', 'E8_AGENCIA', 'E8_CONTA', 'E8_DTSALAT', 'E8_SALATUA', 'D_E_L_E_T_'],
  SA1: ['A1_FILIAL', 'A1_COD', 'A1_LOJA', 'A1_NOME', 'A1_NREDUZ', 'A1_CGC', 'D_E_L_E_T_'],
  SA2: ['A2_FILIAL', 'A2_COD', 'A2_LOJA', 'A2_NOME', 'A2_NREDUZ', 'A2_CGC', 'D_E_L_E_T_'],
  SA3: ['A3_FILIAL', 'A3_COD', 'A3_NOME', 'D_E_L_E_T_'],
  SA6: ['A6_FILIAL', 'A6_COD', 'A6_AGENCIA', 'A6_NUMCON', 'A6_NOME', 'A6_NREDUZ', 'D_E_L_E_T_'],
  SED: ['ED_FILIAL', 'ED_CODIGO', 'ED_DESCRIC', 'D_E_L_E_T_'],
  FK1: ['FK1_FILIAL', 'FK1_IDDOC', 'FK1_DATA', 'FK1_VALOR', 'D_E_L_E_T_'],
  FK2: ['FK2_FILIAL', 'FK2_IDDOC', 'FK2_DATA', 'FK2_VALOR', 'D_E_L_E_T_'],
  FK5: ['FK5_FILIAL', 'FK5_DATA', 'FK5_VALOR', 'D_E_L_E_T_'],
  FK6: ['FK6_FILIAL', 'FK6_DATA', 'FK6_VALOR', 'D_E_L_E_T_'],
  FK7: ['FK7_FILIAL', 'FK7_IDDOC', 'D_E_L_E_T_'],
  FKA: ['FKA_FILIAL', 'FKA_IDDOC', 'D_E_L_E_T_'],
  FKB: ['FKB_FILIAL', 'FKB_IDDOC', 'D_E_L_E_T_'],
};

function garantirIntencao(empresaId) {
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    const existe = db.prepare("SELECT id FROM intentions WHERE empresa_id = ? AND nome = 'financeiro_dinamico' LIMIT 1").get(empresaId);
    if (existe) return;
    crud.criar('intentions', {
      empresa_id: empresaId,
      nome: 'financeiro_dinamico',
      descricao: 'Consultas dinamicas do financeiro via IA-OWNER',
      modulo: 'financeiro',
      acao: 'ai_text_to_sql',
      dataset_id: null,
      frases_exemplo: [
        'saldo a receber do mes',
        'contas a pagar por fornecedor',
        'total recebido no periodo',
        'total pago por natureza',
        'fluxo de caixa projetado',
        'saldo bancario atual por banco',
      ].join('\n'),
      ativo: 1,
    });
    require('../../ai/intent-service').invalidateCache(empresaId);
  } catch (e) {
    console.warn(`[FinanceiroIAOwner] Falha ao garantir intencao para empresa #${empresaId}:`, e.message);
  }
}

function normalizarTexto(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function tokensBuscaTexto(texto) {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);
}

function exprTextoAi(alias, campo) {
  return `UPPER(${alias}.${campo}) COLLATE Latin1_General_CI_AI`;
}

function likeAi(valor, helpers) {
  return `'%${helpers.escapeSqlLiteral(String(valor || '').toUpperCase())}%' COLLATE Latin1_General_CI_AI`;
}

function montarWhereTextoAi(alias, campos, texto, helpers) {
  const textoOriginal = String(texto || '').trim();
  const textoNormalizado = normalizarTexto(textoOriginal).toUpperCase();
  const termos = [textoOriginal, textoNormalizado].filter(Boolean);
  const likeInteiro = termos.map(termo => `(${campos.map(campo => `${exprTextoAi(alias, campo)} LIKE ${likeAi(termo, helpers)}`).join(' OR ')})`);
  const tokens = tokensBuscaTexto(textoOriginal);
  const likeTokens = tokens.length > 1
    ? `(${tokens.map(token => `(${campos.map(campo => `${exprTextoAi(alias, campo)} LIKE ${likeAi(token, helpers)}`).join(' OR ')})`).join(' AND ')})`
    : null;
  return `(${[...likeInteiro, likeTokens].filter(Boolean).join(' OR ')})`;
}

function gruposBuscaEntidade(entidade = {}, contexto = {}) {
  const tipo = String(entidade.tipo || entidade.tipo_sugerido || '').toLowerCase().replace('natureza_financeira', 'natureza');
  if (['cliente', 'fornecedor', 'vendedor', 'natureza'].includes(tipo)) return [[tipo]];
  const texto = normalizarTexto(entidade.texto);
  const carteira = String(contexto.carteira || contexto.filtros?.carteira || '').toLowerCase();
  if (carteira === 'receber' || /\b(receber|recebido|cliente|clientes|ra)\b/.test(texto)) return [['cliente'], ['vendedor', 'natureza']];
  if (carteira === 'pagar' || /\b(pagar|pago|fornecedor|fornecedores|pa)\b/.test(texto)) return [['fornecedor'], ['natureza']];
  return [['fornecedor', 'cliente'], ['vendedor', 'natureza']];
}

async function buscarEntidade({ empresaId, sx2, tipo, texto, helpers }) {
  const def = entityCatalog.DEFINICOES[tipo];
  if (!def) return [];
  const tabelaCad = helpers.tabelaFisicaSX2(sx2, def.tabelaBase);
  if (!tabelaCad) return [];
  const alias = def.tabelaBase;
  const selectLoja = def.lojaCampo ? `${alias}.${def.lojaCampo} AS loja` : 'NULL AS loja';
  const sql = `SET ROWCOUNT 10;\nSELECT ${alias}.${def.codigoCampo} AS codigo, ${selectLoja}, ${alias}.${def.nomeCampos[0]} AS nome\nFROM ${tabelaCad} ${alias}\nWHERE ${alias}.D_E_L_E_T_ = ' '\n  AND ${montarWhereTextoAi(alias, def.nomeCampos, texto, helpers)}\nORDER BY ${alias}.${def.nomeCampos[0]};`;
  try {
    const conn = helpers.connectionFactory.carregarConexao(empresaId);
    conn._empresa_id = empresaId || '';
    conn._modulo     = 'financeiro';
    conn._operacao   = `lookup_${tipo}`;
    conn._pergunta   = texto     || '';
    conn._sender     = '';
    const rows = await helpers.connectionFactory.executar(conn, sql, {});
    return (rows || []).filter(row => row.codigo).map(row => ({
      tipo: def.tipo,
      rotuloTipo: def.rotuloTipo,
      tabelaBase: def.tabelaBase,
      codigo: String(row.codigo || '').trim(),
      loja: row.loja == null ? null : String(row.loja || '').trim(),
      nome: String(row.nome || '').trim(),
      joinHint: def.joinHint,
    }));
  } catch (e) {
    console.warn(`[FinanceiroIAOwner] Lookup ${tipo} falhou:`, e.message);
    return [];
  }
}

async function resolverEntidades({ pedidos, empresaId, sx2, estadoAnterior, helpers }) {
  const resolvidas = [];
  const contexto = {
    carteira: estadoAnterior?.filtros?.carteira || estadoAnterior?.contrato_orquestrador?.carteira || null,
    filtros: estadoAnterior?.filtros || {},
  };
  for (const pedido of pedidos || []) {
    const texto = String(pedido.texto || '').trim();
    if (!texto) continue;
    let candidatos = [];
    for (const grupo of gruposBuscaEntidade(pedido, contexto)) {
      const resultados = await Promise.all(
        grupo.map(tipo => buscarEntidade({ empresaId, sx2, tipo, texto, helpers }).catch(() => []))
      );
      candidatos = resultados.flat();
      if (candidatos.length) break;
    }
    if (!candidatos.length) return { status: 'nao_encontrado', texto, origem: pedido.origem || null };
    if (candidatos.length > 1) return { status: 'ambigua', texto, candidatos, origem: pedido.origem || null };
    resolvidas.push({ ...candidatos[0], termoBusca: texto });
  }
  return { status: 'resolvido', entidades: resolvidas };
}

function formatarPerguntaAmbiguidade(texto, candidatos = []) {
  const linhas = candidatos.map((c, i) => {
    const tipo = c.rotuloTipo || c.tipo;
    return `${i + 1}. *${c.nome}* (${tipo}: ${c.codigo}${c.loja ? `/${c.loja}` : ''})`;
  });
  linhas.push(`${candidatos.length + 1}. *Todos*`);
  return `Encontrei mais de um registro para *${texto}*:\n\n${linhas.join('\n')}\n\nQual deles voce quer consultar? Responda com o numero.`;
}

function ajustarSqlAposSx2({ sql }) {
  return String(sql || '')
    .replace(/\s+WITH\s*\(\s*NOLOCK\s*\)/gi, '')
    .replace(/\bINNER\s+JOIN\s+SED(\d{3})?\s+SED\b/gi, match => match.replace(/^INNER/i, 'LEFT'));
}

async function validarCorrigirSqlGerado({ sql, contexto }) {
  const limpo = removerFiltrosEmpresaComoEntidade(sql, contexto, {
    campos: [
      'SE1.E1_FILIAL', 'SE2.E2_FILIAL', 'SE5.E5_FILIAL', 'SE8.E8_FILIAL',
      'SA1.A1_COD', 'SA1.A1_LOJA', 'SA1.A1_CGC', 'SA1.A1_NOME', 'SA1.A1_NREDUZ',
      'SE1.E1_CLIENTE', 'SE1.E1_LOJA',
      'SA2.A2_COD', 'SA2.A2_LOJA', 'SA2.A2_CGC', 'SA2.A2_NOME', 'SA2.A2_NREDUZ',
      'SE2.E2_FORNECE', 'SE2.E2_LOJA', 'SE5.E5_CLIFOR', 'SE5.E5_LOJA',
      'SA3.A3_COD', 'SA3.A3_NOME',
      'SED.ED_CODIGO', 'SED.ED_DESCRIC',
      'SA6.A6_COD', 'SA6.A6_NOME', 'SA6.A6_NREDUZ',
    ],
    camposFilialLiteral: ['SE1.E1_FILIAL', 'SE2.E2_FILIAL', 'SE5.E5_FILIAL', 'SE8.E8_FILIAL'],
  });
  return { sql: limpo, respostaSql: JSON.stringify({ sql: limpo, origem: 'guardrails_financeiro_ia_owner' }), sqlIaBruto: sql };
}

const regrasTecnicas = `
## Principio IA-OWNER
Voce decide se a pergunta atual e nova consulta, continuidade ou troca de assunto.
O historico e evidencia. Nao herde periodo, carteira, estado, filtros ou agrupamentos automaticamente.

## Analise Historica Multianual — Consulta de Extremo por Ano (SEM filtro de periodo)
- Quando a pergunta buscar um extremo historico ENTRE ANOS — ex: "qual o ano com maior/menor volume financeiro", "qual o melhor/pior ano", "o ano que mais pagou/recebeu" — a palavra "ano" e DIMENSAO DE ANALISE, nao referencia de periodo.
- PROIBIDO aplicar BETWEEN ou qualquer filtro de data no WHERE nesses casos.
- Gere SQL sem filtro temporal: GROUP BY SUBSTRING([campo_data], 1, 4) AS ano, ORDER BY [metrica] DESC/ASC, OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY.
- Ignore periodo.tipo = "ano_atual" vindo do estado anterior quando a mensagem pedir explicitamente o "maior/menor/melhor/pior ano" historico.
- EXCECAO: se o usuario especificar range ("ultimos 5 anos", "de 2022 a 2024"), aplique o filtro correspondente.

## Consultas de Frequencia Mensal Completa ("todos os meses do ano")
- Quando o usuario pedir "clientes/fornecedores com movimentacao em todos os meses do ano [X]" ou "todos os meses do ano" (sem especificar ano):
  1. Se [X] nao for informado, assuma o ano atual (SUBSTRING(data_atual, 1, 4)).
  2. Se [X] for o ano atual AINDA EM CURSO (ano nao terminou): o threshold do HAVING e o numero de meses JA DECORRIDOS: CAST(SUBSTRING(data_atual, 5, 2) AS INT). Exemplo: data_atual=2026-06-06 → HAVING COUNT(DISTINCT SUBSTRING([campo_data], 5, 2)) = 6.
  3. Se [X] for um ano passado completamente encerrado: use HAVING COUNT(DISTINCT ...) = 12.
- PROIBIDO usar HAVING COUNT(...) = 12 para o ano atual quando o ano ainda nao terminou.
- PROIBIDO declarar frases operacionais como "possuem movimentacao todos os meses" em entidades_necessarias — isso nao e uma entidade cadastral.

## Periodos
- Se o usuario disser "ano" sem ano explicito, use o ano atual completo.
- Se disser "mes" sem mes/ano explicito, use o mes atual completo.
- Se disser "dia" sem data explicita, use o dia atual.
- "por mes", "mensal", "por dia" e "por ano" podem ser agrupamento/granularidade; decida pelo texto completo.
- Em aberto, posicao, saldo a pagar ou saldo a receber sem periodo explicito: nao assuma mes atual; consulte toda a carteira em aberto.
- Datas Protheus sao CHAR(8) YYYYMMDD. Compare com BETWEEN em texto YYYYMMDD.

## Comparacao de um Mes nos Ultimos N Anos (financeiro)
- Quando o usuario pedir "[mes] dos ultimos N anos" (Ex: "Maio dos ultimos 3 anos"), calcule os N anos a partir de data_atual.
- data_atual=2026 + "ultimos 3 anos" = anos 2024, 2025, 2026. Nunca herde anos do estado anterior.
- NUNCA gere BETWEEN cobrindo apenas 1 mes de 1 ano quando o usuario pediu N anos.

## Sintaxe SQL — Padrao ANSI SQL:2008 (SQL Server)
Gere sempre SQL compativel com SQL Server usando construcoes do padrao ANSI. NUNCA use extensoes especificas de MySQL ou PostgreSQL — elas causam erro de sintaxe no SQL Server.

- LIMIT: PROIBIDO. SQL Server nao reconhece LIMIT (sintaxe MySQL). Para limitar linhas use OBRIGATORIAMENTE a sintaxe ANSI SQL:2008, que requer ORDER BY:
    ORDER BY <coluna> OFFSET 0 ROWS FETCH NEXT N ROWS ONLY
  Exemplo correto:  ORDER BY valor DESC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY
  Exemplo errado:   LIMIT 1

- TOP N + OFFSET/FETCH NEXT: PROIBIDO juntos. SQL Server nao permite SELECT TOP N e OFFSET/FETCH NEXT na mesma query (erro 10741). Escolha UM dos dois mecanismos: prefira sempre OFFSET/FETCH NEXT (ANSI). NUNCA escreva SELECT TOP N quando a query ja tiver OFFSET ... FETCH NEXT.

- YEAR() / MONTH() para agrupamento: PROIBIDO. Use SUBSTRING(campo, 1, 6) AS competencia para extrair 'AAAAMM' (ex: '202506'). Garante compatibilidade entre provedores e ordenacao cronologica correta como string.

- Valor nulo: Use COALESCE(expr, 0) (padrao ANSI) em vez de ISNULL(expr, 0) (especifico SQL Server).

- Diferenca: Use <> (padrao ANSI) em vez de !=.

- Conversao: Prefira CAST(x AS tipo) (padrao ANSI) a CONVERT(tipo, x, estilo) para conversoes basicas sem mascara de formato.

## Carteiras
- Contas a pagar usa SE2 e fornecedor SA2.
- Contas a receber usa SE1 e cliente SA1.
- Se o usuario pedir ambas/fluxo de caixa, use as duas carteiras em subqueries separadas com UNION ALL quando necessario.
- Nao misture SA1 como fornecedor nem SA2 como cliente.

## Metricas principais
- Saldo a pagar/em aberto: SE2.E2_SALDO, com SE2.E2_SALDO > 0. Data padrao de vencimento: SE2.E2_VENCREA ou SE2.E2_VENCTO se VENCREA nao existir.
- Valor pago/liquidado/baixado: preferir data de baixa SE2.E2_BAIXA ou movimentos SE5.E5_DATA/FK2 quando a pergunta exigir pagamento real. Valor pago acumulado em SE2 pode ser SE2.E2_VALOR - SE2.E2_SALDO.
- Saldo a receber/em aberto: SE1.E1_SALDO, com SE1.E1_SALDO > 0. Data padrao de vencimento: SE1.E1_VENCREA ou SE1.E1_VENCTO se VENCREA nao existir.
- Valor recebido/liquidado/baixado: preferir data de baixa SE1.E1_BAIXA ou movimentos SE5.E5_DATA/FK1 quando a pergunta exigir recebimento real. Valor recebido acumulado em SE1 pode ser SE1.E1_VALOR - SE1.E1_SALDO.
- Natureza financeira: SE1.E1_NATUREZ ou SE2.E2_NATUREZ -> SED.ED_CODIGO.

## Antecipacoes PA/RA
- PA = pagamento antecipado em contas a pagar, normalmente SE2.E2_TIPO = 'PA'.
- RA = recebimento antecipado em contas a receber, normalmente SE1.E1_TIPO = 'RA'.
- Por padrao, NAO inclua PA nem RA nas metricas. Exclua PA em contas a pagar e RA em contas a receber quando o campo tipo existir.
- So considere/apresente PA ou RA quando o usuario pedir explicitamente: PA, RA, pagamento antecipado, recebimento antecipado, adiantamento, antecipacao.
- Mesmo quando pedido explicitamente, apresente PA/RA somente quando a pergunta estiver por fornecedor ou por cliente, ou quando houver fornecedor/cliente filtrado. Sem fornecedor/cliente, marque precisa_confirmacao=true perguntando qual fornecedor/cliente ou se deseja agrupar por entidade.
- Se considerar PA/RA por entidade, retorne colunas separadas: saldo_a_pagar/saldo_a_receber, pagamento_antecipado/recebimento_antecipado, total_liquido.
- Nao use PA para contas a receber. Nao use RA para contas a pagar.

## Saldo bancario e fluxo de caixa
- Saldo bancario, fluxo de caixa projetado e fluxo de caixa realizado sao operacoes proprias. Nao trate como simples contas a pagar/receber.
- Saldo bancario puro usa SOMENTE SE8 e SA6. Nao inclua SE1/SE2/SE5/FK em saldo bancario puro.
- Saldo bancario atual usa a ultima posicao por banco/agencia/conta: MAX(SE8.E8_DTSALAT) por E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA, limitada a data base quando houver.
- Para saldo por banco, agrupe por SA6.A6_COD, SA6.A6_NOME e some apenas a ultima posicao de cada conta.
- Fluxo de caixa projetado = saldo_bancario_base + saldo_a_receber_projetado - saldo_a_pagar_projetado.
- Fluxo projetado usa titulos em aberto: SE1.E1_SALDO > 0 e SE2.E2_SALDO > 0, por vencimento futuro/periodo solicitado.
- Se o periodo projetado comecar antes da data atual, considere titulos a partir da data atual.
- Fluxo de caixa realizado = saldo_bancario_base + valor_recebido - valor_pago no periodo.
- Fluxo realizado usa baixas/movimentos reais: prefira FK1/FK2 quando disponiveis; use SE5 como fallback; use SE1.E1_BAIXA/SE2.E2_BAIXA ou E1_VALOR-E1_SALDO/E2_VALOR-E2_SALDO apenas se nao houver tabela de movimento melhor.
- Para fluxo realizado, saldo_bancario_base deve ser a ultima posicao SE8 menor ou igual ao inicio do periodo.
- Para fluxo projetado, saldo_bancario_base deve ser a ultima posicao SE8 menor ou igual a data atual ou data inicial projetada, conforme a pergunta.
- SQL de fluxo deve retornar aliases claros: saldo_bancario_base, total_a_receber ou valor_recebido, total_a_pagar ou valor_pago, fluxo_liquido.
- Se SE8/SA6 nao estiverem disponiveis, retorne os componentes disponiveis e use saldo_bancario_base = 0 apenas deixando claro pelo alias que faltou saldo bancario.

## Tabelas padrao do modulo Financeiro
- SE1: contas a receber.
- SE2: contas a pagar.
- SE5: movimentos/baixas financeiras, fallback para pago/recebido.
- SE8: saldos bancarios.
- SA1: clientes.
- SA2: fornecedores.
- SA3: vendedores.
- SA6: bancos/contas.
- SED: natureza financeira.
- FK1/FK2/FK5/FK6/FK7/FKA/FKB: familia moderna de baixas/movimentos, use quando existir e a pergunta exigir baixa/movimento real.

## Joins padrao
- SE1 -> SA1: SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA.
- SE2 -> SA2: SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA.
- SE1 -> SED: SE1.E1_NATUREZ = SED.ED_CODIGO.
- SE2 -> SED: SE2.E2_NATUREZ = SED.ED_CODIGO.
- SE1 -> SA3: SE1.E1_VEND1 = SA3.A3_COD quando a pergunta pedir vendedor.
- SE8 -> SA6: SE8.E8_BANCO = SA6.A6_COD AND SE8.E8_AGENCIA = SA6.A6_AGENCIA AND SE8.E8_CONTA = SA6.A6_NUMCON.

## Regras obrigatorias de SQL
- Retorne apenas SELECT, sempre iniciando com SET ROWCOUNT 50000.
- OBRIGATORIO SEM EXCECAO: toda tabela no FROM ou em qualquer JOIN deve ter D_E_L_E_T_ = ' ' filtrado. Aplique no WHERE para a tabela principal e na condicao ON para cada JOIN. Exemplo correto: FROM SE1990 SE1 JOIN SA1990 SA1 ON ... AND SA1.D_E_L_E_T_ = ' ' JOIN SED990 SED ON ... AND SED.D_E_L_E_T_ = ' ' WHERE SE1.D_E_L_E_T_ = ' '. Isso vale inclusive para SA1, SA2, SA3, SA6, SED, FK1, FK2, FK5, FK6, FK7, FKA, FKB — todas as tabelas sem excecao.
- REGRA DE INTEGRIDADE DE JOINS: E terminantemente PROIBIDO usar qualificadores de tabelas cadastrais (ex: SA1.A1_NOME, SA2.A2_NOME, SA6.A6_NOME, SED.ED_DESCRIC) em qualquer parte do SQL (SELECT, WHERE, GROUP BY, ORDER BY) sem declarar o JOIN correspondente no FROM. Sempre que o usuario pedir agrupamento ou exibicao por entidade ("por cliente", "por fornecedor", "por banco", "por natureza"), voce deve: (1) identificar o nome fisico da tabela no sx2 do tenant ativo; (2) adicionar o JOIN com as chaves padrao e com D_E_L_E_T_ = ' ' na condicao ON. SQL com qualificadores sem JOIN declarado e INVALIDO — revise antes de retornar.
- Use aliases explicitos iguais a base da tabela: SE1, SE2, SE5, SE8, SA1, SA2, SA3, SA6, SED, FK1, FK2, FK5, FK6, FK7, FKA, FKB.
- Se o contexto tecnico trouxer nomes fisicos SX2, use exatamente esses nomes em FROM/JOIN com alias base. Exemplo: FROM SE2990 SE2, JOIN SA2990 SA2.
- Qualifique campos sempre pelo alias base, nunca pela tabela fisica. Use SE2.E2_SALDO, nao SE2990.E2_SALDO.
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.
- Nao use WITH (NOLOCK).
- Nao use FORMAT() nem TRY_CONVERT().

## Exibicao de entidades
Sempre retorne nome/descricao para o usuario. Codigo sozinho nao serve.
- fornecedor: SA2.A2_NOME AS fornecedor. Codigo/loja podem vir como cod_fornecedor e loja_fornecedor.
- cliente: SA1.A1_NOME AS cliente. Codigo/loja podem vir como cod_cliente e loja_cliente.
- natureza: SED.ED_DESCRIC AS natureza.
- vendedor: SA3.A3_NOME AS vendedor.
- banco: SA6.A6_NOME AS banco.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.

## Regra Critica — entidades_necessarias Somente para Nomes Proprios Cadastrais
- PROIBIDO declarar em entidades_necessarias qualquer texto que seja uma condicao de filtro, criterio operacional ou frase descritiva — ex: "possuem movimentacao todos os meses", "maior saldo", "todos os clientes em aberto".
- entidades_necessarias e EXCLUSIVAMENTE para nomes proprios de entidades cadastrais: nome de cliente, nome de fornecedor, nome de natureza financeira, etc.
- Se a pergunta nao citar um nome proprio de entidade cadastral, deixe entidades_necessarias vazio ([]).
- Teste interno: o texto declarado seria resultado valido de LIKE '%...%' em SA1.A1_NOME ou SA2.A2_NOME? Se nao for um nome proprio real, nao declare.

## Entidades cadastrais
Quando precisar filtrar cliente, fornecedor, vendedor ou natureza por nome citado pelo usuario, retorne em entidades_necessarias.
Depois que o sistema devolver entidades_resolvidas, filtre por codigo interno, nao por LIKE de nome.
- Se a mensagem mencionar "empresa(s) J2A/C3I/todas as empresas" ou o estado tecnico trouxer empresas_iahub_mencionadas, trate esses nomes como escopo de tenant IAHub, nunca como cliente ou fornecedor. Nao gere filtro em SA1.A1_NOME, SA2.A2_NOME ou subquery em SA1/SA2 por esses termos.
- REGRA CRITICA — palavra "empresa" como escopo de tenant: Quando a mensagem usa "empresa(s) [NOME1] e/ou [NOME2]" e esses nomes estao em empresas_iahub_mencionadas, a palavra "empresa" indica APENAS o escopo de execucao multiempresa. Ela NAO e um agrupamento SQL nem um filtro cadastral. Nao adicione GROUP BY, nao agrupe por empresa/cliente/fornecedor baseado nesses nomes.
- REGRA CRITICA — agrupamentos: ["empresa"] no estado anterior: Quando contrato_orquestrador ou estado anterior trouxer agrupamentos: ["empresa"], isso e metadata do backend, NAO e instrucao para GROUP BY SQL. Ignore-o. So adicione GROUP BY SQL quando o usuario pedir explicitamente agrupamento por mes, cliente, fornecedor, natureza, etc.

## Agregacoes
- "total/saldo a pagar" sem agrupamento: COALESCE(SUM(SE2.E2_SALDO),0) AS saldo_a_pagar.
- "total/saldo a receber" sem agrupamento: COALESCE(SUM(SE1.E1_SALDO),0) AS saldo_a_receber.
- Quando o usuario pedir SIMULTANEAMENTE saldo a pagar e saldo a receber, retorne ambas as metricas. Avalie se o contexto permite um SELECT combinado (UNION ou subqueries) ou se sao consultas separadas por tabela (SE2 para pagar, SE1 para receber).
- "valor pago": COALESCE(SUM(SE2.E2_VALOR - SE2.E2_SALDO),0) AS valor_pago quando usar SE2, ou SUM(SE5.E5_VALOR) quando usar baixa/movimento.
- "valor recebido": COALESCE(SUM(SE1.E1_VALOR - SE1.E1_SALDO),0) AS valor_recebido quando usar SE1, ou SUM(SE5.E5_VALOR) quando usar baixa/movimento.
- "por fornecedor": agrupe por SA2.A2_COD, SA2.A2_LOJA, SA2.A2_NOME.
- "por cliente": agrupe por SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
- "por natureza": agrupe por SED.ED_CODIGO, SED.ED_DESCRIC.
- "por mes": use OBRIGATORIAMENTE SUBSTRING(campo_data, 1, 6) AS competencia no SELECT e GROUP BY, onde campo_data e o campo de data relevante para a consulta. Resultado: '202506', '202507' etc. NUNCA use YEAR() ou MONTH() isolados — a coluna competencia AAAAMM garante agrupamento correto em qualquer ano e e compativel com todos os provedores de conexao.
- REGRA CRITICA — sintaxe SQL Server/ANSI: NUNCA use LIMIT (sintaxe MySQL — causa erro no SQL Server). Para limitar linhas use OBRIGATORIAMENTE: ORDER BY <coluna> OFFSET 0 ROWS FETCH NEXT N ROWS ONLY. Exemplo: "ORDER BY valor DESC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY".
- Media anual historica (ex: "media anual de recebimentos/pagamentos", "media por ano"): PROIBIDO AVG direto sobre linhas da tabela fato e PROIBIDO filtro de periodo. Use subquery de duas camadas sem BETWEEN. Alias da camada externa OBRIGATORIO: AS saldo (para a carteira consultada):
  Camada interna: GROUP BY SUBSTRING([campo_data], 1, 4) AS ano, SUM([metrica]) AS valor_ano.
  Camada externa: SELECT COALESCE(AVG(h.valor_ano), 0) AS saldo FROM (...) h.
  Retorna UMA linha → habilita resposta_planejada no WhatsApp.
- Media mensal de periodo (ex: "media mensal dos ultimos 12 meses"): PROIBIDO dividir SUM por COUNT(DISTINCT competencia) no SELECT com GROUP BY — COUNT e sempre 1 dentro do grupo. Use subquery em duas camadas com filtro de periodo no WHERE:
  Camada interna: GROUP BY SUBSTRING([campo_data], 1, 6), SUM([metrica]) AS valor_mes.
  Camada externa: SELECT COALESCE(AVG(h.valor_mes), 0) AS media_mensal FROM (...) h.
  Retorna UMA linha → habilita resposta_planejada no WhatsApp.
- Media sazonal por mes do ano (ex: "media de cada mes do ano", "sazonalidade de recebimentos/pagamentos"): subquery sem filtro de ano, agrupando por (ano, mes) na camada interna e apenas por mes na externa.
  Camada interna: GROUP BY SUBSTRING([campo_data], 1, 4), SUBSTRING([campo_data], 5, 2), SUM([metrica]).
  Camada externa: SELECT mes, AVG(valor_mes) GROUP BY mes ORDER BY mes — retorna 12 linhas, resposta_planejada = null.
  PROIBIDO aplicar BETWEEN de ano unico no CASO sazonal.
`.trim();

module.exports = {
  nome: 'financeiro',
  handlerName: 'financeiro-ia-owner',
  logPrefix: 'FinanceiroIAOwner',
  defaultMessage: 'consulta financeira',
  tabelas: TABELAS,
  entityCatalog,
  resolverEntidadesAntesDaIa: true,
  camposSx3Essenciais: CAMPOS_SX3_ESSENCIAIS,
  sqlMiddleware,
  regrasTecnicas,
  sx3PromptLimit: 90,
  maxTokens: 5200,
  dimensionLeftJoinBases: ['SA1', 'SA2', 'SA3', 'SA6', 'SED'],
  sanitizarFiltrosFilialSX2: true,
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta financeira no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta financeira. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei registros financeiros para essa consulta.',
    erro_erp: 'Nao consegui buscar os dados financeiros no ERP. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao: 'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  },
  garantirIntencao,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  ajustarSqlAposSx2,
  validarCorrigirSqlGerado,
  _test: {
    gruposBuscaEntidade,
    buscarEntidade,
    resolverEntidades,
    removerFiltrosEmpresaComoEntidade,
  },
};
