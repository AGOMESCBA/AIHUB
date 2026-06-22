'use strict';

const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const { removerFiltrosEmpresaComoEntidade } = require('../empresa-scope-sql-guard');

const TABELAS = ['SE1', 'SE2', 'SE5', 'SE8', 'SA1', 'SA2', 'SA3', 'SA6', 'SED', 'FK1', 'FK2', 'FK5', 'FK6', 'FK7', 'FKA', 'FKB'];

const CAMPOS_SX3_ESSENCIAIS = {
  SE1: ['E1_FILIAL', 'E1_PREFIXO', 'E1_NUM', 'E1_PARCELA', 'E1_TIPO', 'E1_CLIENTE', 'E1_LOJA', 'E1_EMISSAO', 'E1_VENCTO', 'E1_VENCREA', 'E1_VALOR', 'E1_SALDO', 'E1_NATUREZ', 'E1_SITUACAO', 'E1_VEND1', 'E1_VALCOM1', 'D_E_L_E_T_'],
  SE2: ['E2_FILIAL', 'E2_PREFIXO', 'E2_NUM', 'E2_PARCELA', 'E2_TIPO', 'E2_FORNECE', 'E2_LOJA', 'E2_EMISSAO', 'E2_VENCTO', 'E2_VENCREA', 'E2_VALOR', 'E2_SALDO', 'E2_NATUREZ', 'E2_SITUACAO', 'D_E_L_E_T_'],
  SE5: ['E5_FILIAL', 'E5_PREFIXO', 'E5_NUM', 'E5_PARCELA', 'E5_TIPO', 'E5_DATA', 'E5_VALOR', 'E5_CLIFOR', 'E5_LOJA', 'E5_SITUACAO', 'E5_TIPODOC', 'E5_NATUREZ', 'D_E_L_E_T_'],
  SE8: ['E8_FILIAL', 'E8_BANCO', 'E8_AGENCIA', 'E8_CONTA', 'E8_DTSALAT', 'E8_SALATUA', 'D_E_L_E_T_'],
  SA1: ['A1_FILIAL', 'A1_COD', 'A1_LOJA', 'A1_NOME', 'A1_NREDUZ', 'A1_CGC', 'D_E_L_E_T_'],
  SA2: ['A2_FILIAL', 'A2_COD', 'A2_LOJA', 'A2_NOME', 'A2_NREDUZ', 'A2_CGC', 'D_E_L_E_T_'],
  SA3: ['A3_FILIAL', 'A3_COD', 'A3_NOME', 'D_E_L_E_T_'],
  SA6: ['A6_FILIAL', 'A6_COD', 'A6_AGENCIA', 'A6_NUMCON', 'A6_NOME', 'A6_NREDUZ', 'A6_BLOCKED', 'D_E_L_E_T_'],
  SED: ['ED_FILIAL', 'ED_CODIGO', 'ED_DESCRIC', 'D_E_L_E_T_'],
  FK1: ['FK1_FILIAL', 'FK1_PREFIXO', 'FK1_NUM', 'FK1_PARCELA', 'FK1_TIPO', 'FK1_DATA', 'FK1_VALOR', 'D_E_L_E_T_'],
  FK2: ['FK2_FILIAL', 'FK2_PREFIXO', 'FK2_NUM', 'FK2_PARCELA', 'FK2_TIPO', 'FK2_DATA', 'FK2_VALOR', 'D_E_L_E_T_'],
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

function regrasTecnicas({ modeloBaixasReceber, modeloBaixasPagar } = {}) {
  const usaFK1 = modeloBaixasReceber === 'FK1';
  const usaFK2 = modeloBaixasPagar === 'FK2';
  return `
## Campos de data padrao
- Vencimento a pagar: SE2.E2_VENCREA (ou SE2.E2_VENCTO se VENCREA nao existir).
- Vencimento a receber: SE1.E1_VENCREA (ou SE1.E1_VENCTO se VENCREA nao existir).
- Baixa/recebimento real: use o JOIN definido em "Joins padrao" (SE1->${usaFK1 ? 'FK1' : 'SE5'}), modelo deste tenant: ${modeloBaixasReceber || 'SE5'}. NUNCA use SE1.E1_BAIXA.
- Baixa/pagamento real: use o JOIN definido em "Joins padrao" (SE2->${usaFK2 ? 'FK2' : 'SE5'}), modelo deste tenant: ${modeloBaixasPagar || 'SE5'}. NUNCA use SE2.E2_BAIXA.
- Em aberto sem periodo explicito: consulte toda a carteira em aberto (sem BETWEEN).

## Carteiras
- Contas a pagar usa SE2 e fornecedor SA2.
- Contas a receber usa SE1 e cliente SA1.
- REGRA ABSOLUTA — SE1 e SE2 sao carteiras independentes, nunca relacionadas entre si: PROIBIDO fazer JOIN (INNER, LEFT, RIGHT, CROSS ou qualquer tipo) entre SE1 e SE2, mesmo que as chaves parecam existir. Nao existe titulo a pagar que "corresponda" a um titulo a receber — qualquer JOIN entre elas produz produto cartesiano multiplicando os valores e gerando resultado incorreto.
- EXEMPLO ERRADO — nunca faca isso: SELECT SUM(SE2.E2_SALDO), SUM(SE1.E1_SALDO) FROM SE2xxx SE2 LEFT JOIN SE1xxx SE1 ON SE1.D_E_L_E_T_ = ' ' — mesmo com condicao no ON, o JOIN cruza todas as linhas de SE2 com todas as de SE1, inflando os valores.
- EXEMPLO CORRETO para total de ambas em posicao/em_aberto: use UNION ALL com dois SELECTs independentes — SELECT 'pagar' AS carteira, COALESCE(SUM(SE2.E2_SALDO),0) AS saldo FROM SE2xxx SE2 WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 UNION ALL SELECT 'receber', COALESCE(SUM(SE1.E1_SALDO),0) FROM SE1xxx SE1 WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0.
- Se o usuario pedir ambas realizadas (recebidas e pagas): gere UM UNICO SELECT com duas subqueries escalares — valor_recebido via SE1+SE5/${usaFK1 ? 'FK1' : 'SE5'} e valor_pago via SE2+SE5/${usaFK2 ? 'FK2' : 'SE5'}. PROIBIDO UNION ALL para realizados. Siga o plano estruturado query_plan_texto.
- Nao misture SA1 como fornecedor nem SA2 como cliente.

## Metricas principais
- Saldo a pagar/em aberto: SE2.E2_SALDO, com SE2.E2_SALDO > 0. Titulos com E2_SALDO = 0 ja foram pagos — nunca os inclua em consultas de aberto. Data padrao de vencimento: SE2.E2_VENCREA ou SE2.E2_VENCTO se VENCREA nao existir.
- Valor pago/liquidado/baixado: use JOIN de "Joins padrao" (SE2->FK2 ou SE2->SE5) conforme modelo_baixas_pagar. NUNCA filtre por E2_BAIXA, E2_EMISSAO, E2_VENCREA ou E2_VENCTO.
- Saldo a receber/em aberto: SE1.E1_SALDO, com SE1.E1_SALDO > 0. Titulos com E1_SALDO = 0 ja foram recebidos — nunca os inclua em consultas de aberto. Data padrao de vencimento: SE1.E1_VENCREA ou SE1.E1_VENCTO se VENCREA nao existir.
- Valor recebido/liquidado/baixado: use JOIN de "Joins padrao" (SE1->FK1 ou SE1->SE5) conforme modelo_baixas_receber. NUNCA filtre por E1_BAIXA, E1_EMISSAO, E1_VENCREA ou E1_VENCTO. NAO filtre SE1.E1_SITUACAO.
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
- Fluxo de caixa projetado = saldo_bancario_base + saldo_a_receber_projetado - saldo_a_pagar_projetado. Fluxo projetado usa titulos em aberto: SE1.E1_SALDO > 0 e SE2.E2_SALDO > 0, por vencimento futuro/periodo solicitado. NUNCA use SE5/FK no fluxo projetado — SE5/FK sao baixas ja realizadas, nao projecao. Se o periodo projetado comecar antes da data atual, considere titulos a partir da data atual.
- Fluxo de caixa realizado = saldo_bancario_base + valor_recebido - valor_pago no periodo. Fluxo realizado usa baixas/movimentos reais: use os JOINs definidos em "Joins padrao" (SE1->FK1/SE5 para recebimentos, SE2->FK2/SE5 para pagamentos), conforme modelo_baixas_receber e modelo_baixas_pagar do contextoTecnico.
- O periodo (dia, mes, ano, ou intervalo arbitrario) e definido pela pergunta do usuario e deve ser aplicado de forma CONSISTENTE as fontes envolvidas — nunca calcule saldo bancario em uma data e receber/pagar em outra data diferente.
- Para fluxo realizado, saldo_bancario_base deve ser a ultima posicao SE8 menor ou igual ao inicio do periodo. Para fluxo projetado, saldo_bancario_base deve ser a ultima posicao SE8 menor ou igual a data atual ou data inicial projetada, conforme a pergunta.
- SQL de fluxo deve retornar aliases claros: saldo_bancario_base, total_a_receber ou valor_recebido, total_a_pagar ou valor_pago, fluxo_liquido.
- Se SE8/SA6 nao estiverem disponiveis, retorne os componentes disponiveis e use saldo_bancario_base = 0 apenas deixando claro pelo alias que faltou saldo bancario.
- Granularidade da resposta (decidida pela pergunta do usuario, nao fixada aqui): sintetico = 1 linha com os componentes; por dia/mes = GROUP BY data de vencimento/baixa com saldo acumulado quando fizer sentido (SUM() OVER (ORDER BY data)); por fornecedor/cliente = decompoe o lado a pagar OU a receber por entidade, mantendo saldo bancario como referencia unica; por titulo = lista linha a linha sem agregacao.

## Dicionario SE8 (saldos bancarios)
- E8_BANCO: codigo do banco (equivalente a SA6.A6_COD).
- E8_AGENCIA: agencia bancaria.
- E8_CONTA: numero da conta.
- E8_SALATUA: saldo atual da conta naquela data de posicao.
- E8_DTSALAT: data da posicao do saldo (formato YYYYMMDD). Cada conta pode ter multiplas linhas — uma por data de atualizacao.

## Regras tecnicas obrigatorias — SE8
- REGRA ABSOLUTA — posicao mais recente por conta: SE8 registra o saldo de cada conta por data — pode haver multiplas linhas por conta. E OBRIGATORIO filtrar sempre pela posicao mais recente usando ROW_NUMBER():
  data_referencia = data pedida pelo usuario (se informada) OU data_atual (se nao informada).
  Padrao obrigatorio:
    WITH saldo_recente AS (
      SELECT E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA, E8_SALATUA, E8_DTSALAT,
             ROW_NUMBER() OVER (PARTITION BY E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC) AS rn
      FROM SE8xxx SE8
      WHERE SE8.D_E_L_E_T_ = ' ' AND SE8.E8_DTSALAT <= 'data_referencia_YYYYMMDD'
    )
    SELECT ... FROM saldo_recente SE8 JOIN SA6xxx SA6 ... WHERE SE8.rn = 1
  Tambem e aceito subquery com MAX(E8_DTSALAT) GROUP BY (E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA).
  PROIBIDO retornar todas as linhas de SE8 sem esse filtro — gera saldo inflado por duplicidade de datas.
- REGRA CRITICA — filtro de banco: codigos de banco informados pelo usuario sao valores de SE8.E8_BANCO (e de SA6.A6_COD). NUNCA filtre por SA6.A6_NOME — o nome e descricao para exibicao, nao identificador. Aplique inclusao/exclusao sempre por codigo: SE8.E8_BANCO NOT IN (...).
- REGRA ABSOLUTA — bancos bloqueados: SEMPRE inclua AND SA6.A6_BLOCKED <> '1' no JOIN ou WHERE da SA6. Bancos bloqueados NUNCA devem aparecer em nenhuma consulta, independente do que o usuario pedir.
- PROIBIDO usar SE5/FK em saldo bancario puro ou fluxo de caixa projetado.

## Tabelas padrao do modulo Financeiro
- SE1: contas a receber.
- SE2: contas a pagar.
- SE5: movimentos/baixas financeiras (modelo_baixas deste tenant).${usaFK1 || usaFK2 ? '\n- FK1/FK2: familia moderna de baixas/movimentos deste tenant.' : ''}
- SE8: saldos bancarios.
- SA1: clientes.
- SA2: fornecedores.
- SA3: vendedores.
- SA6: bancos/contas.
- SED: natureza financeira.

## Joins padrao
- SE1 -> SA1: SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA.
- SE2 -> SA2: SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA.
- SE1 -> SED: SE1.E1_NATUREZ = SED.ED_CODIGO.
- SE2 -> SED: SE2.E2_NATUREZ = SED.ED_CODIGO.
- SE1 -> SA3: SE1.E1_VEND1 = SA3.A3_COD quando a pergunta pedir vendedor.
- SE8 -> SA6: SE8.E8_BANCO = SA6.A6_COD AND SE8.E8_AGENCIA = SA6.A6_AGENCIA AND SE8.E8_CONTA = SA6.A6_NUMCON.${usaFK1 ? '\n- SE1 -> FK1 (recebimentos realizados, modelo FK moderno): JOIN FK1xxx FK1 ON FK1.FK1_FILIAL = SE1.E1_FILIAL AND FK1.FK1_PREFIXO = SE1.E1_PREFIXO AND FK1.FK1_NUM = SE1.E1_NUM AND FK1.FK1_PARCELA = SE1.E1_PARCELA AND FK1.FK1_TIPO = SE1.E1_TIPO AND FK1.D_E_L_E_T_ = \' \'; filtre FK1.FK1_DATA no periodo; some FK1.FK1_VALOR. OBRIGATORIO: WHERE da subquery deve incluir SE1.D_E_L_E_T_ = \' \'.' : '\n- SE1 -> SE5 (recebimentos realizados): JOIN SE5xxx SE5 ON SE5.E5_FILIAL = SE1.E1_FILIAL AND SE5.E5_PREFIXO = SE1.E1_PREFIXO AND SE5.E5_NUMERO = SE1.E1_NUM AND SE5.E5_PARCELA = SE1.E1_PARCELA AND SE5.E5_TIPO = SE1.E1_TIPO AND SE5.E5_CLIFOR = SE1.E1_CLIENTE AND SE5.E5_LOJA = SE1.E1_LOJA AND SE5.E5_RECPAG = \'R\' AND SE5.E5_SITUACAO <> \'C\' AND SE5.E5_TIPO NOT IN (\'EST\', \'ED\') AND SE5.D_E_L_E_T_ = \' \'; filtre SE5.E5_DATA no periodo; some SE5.E5_VALOR. NAO filtre SE1.E1_SITUACAO (titulo pode ter baixa parcial). OBRIGATORIO: WHERE da subquery deve incluir SE1.D_E_L_E_T_ = \' \'.'}${usaFK2 ? '\n- SE2 -> FK2 (pagamentos realizados, modelo FK moderno): JOIN FK2xxx FK2 ON FK2.FK2_FILIAL = SE2.E2_FILIAL AND FK2.FK2_PREFIXO = SE2.E2_PREFIXO AND FK2.FK2_NUM = SE2.E2_NUM AND FK2.FK2_PARCELA = SE2.E2_PARCELA AND FK2.FK2_TIPO = SE2.E2_TIPO AND FK2.D_E_L_E_T_ = \' \'; filtre FK2.FK2_DATA no periodo; some FK2.FK2_VALOR. OBRIGATORIO: WHERE da subquery deve incluir SE2.D_E_L_E_T_ = \' \'.' : '\n- SE2 -> SE5 (pagamentos realizados): JOIN SE5xxx SE5 ON SE5.E5_FILIAL = SE2.E2_FILIAL AND SE5.E5_PREFIXO = SE2.E2_PREFIXO AND SE5.E5_NUMERO = SE2.E2_NUM AND SE5.E5_PARCELA = SE2.E2_PARCELA AND SE5.E5_TIPO = SE2.E2_TIPO AND SE5.E5_CLIFOR = SE2.E2_FORNECE AND SE5.E5_LOJA = SE2.E2_LOJA AND SE5.E5_RECPAG = \'P\' AND SE5.E5_SITUACAO <> \'C\' AND SE5.E5_TIPO NOT IN (\'EST\', \'ED\') AND SE5.D_E_L_E_T_ = \' \'; filtre SE5.E5_DATA no periodo; some SE5.E5_VALOR. NAO filtre SE2.E2_SITUACAO (titulo pode ter baixa parcial). OBRIGATORIO: WHERE da subquery deve incluir SE2.D_E_L_E_T_ = \' \'.'}

## Regras obrigatorias de SQL
- Inicie sempre com SET ROWCOUNT 50000.
- Use aliases explicitos iguais a base da tabela: SE1, SE2, SE5, SE8, SA1, SA2, SA3, SA6, SED${usaFK1 || usaFK2 ? ', FK1, FK2' : ''}. Vale em toda query, inclusive dentro de subqueries escalares — o alias no FROM e o qualificador dos campos devem ser identicos.
- Qualifique campos sempre pelo alias base (SE2.E2_SALDO, nunca SE2990.E2_SALDO).
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.

## Exibicao de entidades
- fornecedor: SA2.A2_NOME AS fornecedor. Codigo/loja como cod_fornecedor e loja_fornecedor.
- cliente: SA1.A1_NOME AS cliente. Codigo/loja como cod_cliente e loja_cliente.
- natureza: SED.ED_DESCRIC AS natureza.
- vendedor: SA3.A3_NOME AS vendedor.
- banco: SA6.A6_NOME AS banco.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.

## Metrica por agrupamento
- saldo_a_pagar: COALESCE(SUM(SE2.E2_SALDO),0) AS saldo_a_pagar.
- saldo_a_receber: COALESCE(SUM(SE1.E1_SALDO),0) AS saldo_a_receber.
- valor_pago: COALESCE(SUM(${usaFK2 ? 'FK2.FK2_VALOR' : 'SE5.E5_VALOR'}),0) AS valor_pago via JOIN "${usaFK2 ? 'SE2 -> FK2' : 'SE2 -> SE5'}" de "Joins padrao".
- valor_recebido: COALESCE(SUM(${usaFK1 ? 'FK1.FK1_VALOR' : 'SE5.E5_VALOR'}),0) AS valor_recebido via JOIN "${usaFK1 ? 'SE1 -> FK1' : 'SE1 -> SE5'}" de "Joins padrao".
- "por fornecedor": agrupe por SA2.A2_COD, SA2.A2_LOJA, SA2.A2_NOME.
- "por cliente": agrupe por SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
- "por cliente E fornecedor" simultaneamente (ex: "detalhe por cliente e fornecedor", "por entidade"): PROIBIDO combinar SE1 e SE2 em uma unica query. Gere UNION ALL com dois blocos independentes — bloco 1: SE1 agrupado por SA1.A1_NOME (carteira receber); bloco 2: SE2 agrupado por SA2.A2_NOME (carteira pagar). Inclua coluna carteira para distinguir os blocos. Herde o periodo do contexto anterior.
- "por natureza": agrupe por SED.ED_CODIGO, SED.ED_DESCRIC.
- "por mes": SUBSTRING(campo_data, 1, 6) AS competencia no SELECT e GROUP BY.
- Media mensal por ano (subquery 2 camadas, agrupado por ano):
  Subquery interna exporta DOIS aliases: SUBSTRING(campo_data,1,4) AS ano E SUBSTRING(campo_data,1,6) AS competencia. Query externa: SELECT h.ano, AVG(h.saldo) AS media_mensal FROM (...) AS h GROUP BY h.ano. Camada externa usa SOMENTE h.ano e h.saldo — NUNCA SE1.* ou SE2.*.
- Media mensal escalar (1 ano): subquery interna SUM por mes. Query externa AVG(h.saldo) sem GROUP BY.
- Media anual escalar: subquery interna SUM por ano → externa AVG dos totais. Alias externo: AS saldo.

## Titulos especiais — NDF, NCC
- NDF = nota de debito fornecedor em SE2.E2_TIPO. NCC = nota de credito cliente em SE1.E1_TIPO.
- Sao movimentos de compensacao, nao obrigacoes reais futuras. Seguem a mesma regra de opt-in de "## Antecipacoes PA/RA": so considere/apresente quando o usuario pedir explicitamente NDF ou NCC.
`.trim();
}

const sqlPatternsProibidos = [
  {
    regex: /\bSE8\b(?=[\s\S]*?\bJOIN\s+\w+\s+SA6\b)(?![\s\S]*?\bE8_AGENCIA\s*=\s*SA6\.A6_AGENCIA\b)/i,
    mensagem: 'JOIN SE8→SA6 incompleto: falta E8_AGENCIA = SA6.A6_AGENCIA AND SE8.E8_CONTA = SA6.A6_NUMCON na condicao ON. Sem esses campos, o banco retorna zero linhas ou duplicidade por agencia.',
  },
  {
    validar(sql) {
      const usaSE8 = /\b(?:FROM|JOIN)\s+SE8/i.test(sql);
      const usaSE5 = /\b(?:FROM|JOIN)\s+SE5/i.test(sql);
      const usaSE1ouSE2 = /\b(?:FROM|JOIN)\s+SE[12]/i.test(sql);
      if (usaSE8 && usaSE5 && !usaSE1ouSE2) {
        return (
          'Saldo bancario puro (SE8) nao pode incluir SE5. ' +
          'SE5 e tabela de baixas/movimentos — so deve ser usada com SE1 (receber) ou SE2 (pagar). ' +
          'Para saldo bancario use SOMENTE SE8 e SA6. Remova o JOIN SE5.'
        );
      }
      return null;
    },
  },
  {
    validar(sql) {
      const usaSE8 = /\b(?:FROM|JOIN)\s+SE8/i.test(sql);
      const temRowNumber = /\bROW_NUMBER\s*\(/i.test(sql);
      // MAX(E8_DTSALAT) em subquery com GROUP BY é padrão igualmente correto para posição mais recente
      const temMaxDtsalat = /MAX\s*\(\s*E8_DTSALAT\s*\)/i.test(sql);
      if (usaSE8 && !temRowNumber && !temMaxDtsalat) {
        return (
          'Consulta SE8 sem filtro de posicao mais recente por conta. Use ROW_NUMBER() OVER (PARTITION BY E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC) AS rn ' +
          'ou subquery com MAX(E8_DTSALAT) GROUP BY (E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA). ' +
          'PROIBIDO retornar todas as linhas de SE8 sem esse filtro — gera saldo inflado por duplicidade de datas por conta.'
        );
      }
      // CTE com ROW_NUMBER definido, mas a query externa ainda aponta para a tabela física SE8
      // em vez do CTE — o campo rn não existe na tabela física, causando erro no SX3.
      if (temRowNumber) {
        const cteMatch = sql.match(/\bWITH\s+(\w+)\s+AS\s*\(/i);
        if (cteMatch) {
          const cteNome = cteMatch[1];
          const posWithInicio = sql.search(/\bWITH\s+\w+\s+AS\s*\(/i);
          const parenInicio = sql.indexOf('(', posWithInicio);
          let nivel = 0;
          let parenFim = -1;
          for (let i = parenInicio; i < sql.length; i++) {
            if (sql[i] === '(') nivel++;
            else if (sql[i] === ')') { nivel--; if (nivel === 0) { parenFim = i; break; } }
          }
          if (parenFim >= 0) {
            const outerSql = sql.slice(parenFim + 1);
            if (/\bFROM\s+SE8\d*\s+SE8\b/i.test(outerSql)) {
              return (
                `CTE "${cteNome}" calcula ROW_NUMBER() AS rn, mas a query externa usa "FROM SE8... SE8" ` +
                `em vez de "FROM ${cteNome} SE8". ` +
                `Corrija: substitua "FROM SE8... SE8" por "FROM ${cteNome} SE8" na query externa. ` +
                `A tabela fisica SE8 nao possui o campo rn — ele existe apenas no CTE.`
              );
            }
          }
        }
      }
      return null;
    },
  },
];

module.exports = {
  nome: 'financeiro',
  handlerName: 'financeiro-ia-owner',
  logPrefix: 'FinanceiroIAOwner',
  defaultMessage: 'consulta financeira',
  tabelas: TABELAS,
  sqlPatternsProibidos,
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
