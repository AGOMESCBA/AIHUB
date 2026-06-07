'use strict';

const fs = require('fs');
const path = require('path');
const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');

const TABELAS = ['SE3', 'SA3', 'SA1', 'SE2', 'SE5'];

const CAMPOS_SX3_ESSENCIAIS = {
  SE3: ['E3_FILIAL', 'E3_VEND', 'E3_VENDED', 'E3_CLIENT', 'E3_LOJA', 'E3_NUM', 'E3_PARCELA', 'E3_SERIE', 'E3_VENCTO', 'E3_DATA', 'E3_STATUS', 'E3_COMIS', 'E3_VALOR', 'E3_BASE', 'E3_PERCCOM', 'D_E_L_E_T_'],
  SA3: ['A3_FILIAL', 'A3_COD', 'A3_NOME', 'D_E_L_E_T_'],
  SA1: ['A1_FILIAL', 'A1_COD', 'A1_LOJA', 'A1_NOME', 'A1_NREDUZ', 'A1_CGC', 'D_E_L_E_T_'],
  SE2: ['E2_FILIAL', 'E2_FORNECE', 'E2_LOJA', 'E2_NUM', 'E2_PARCELA', 'E2_TIPO', 'E2_PREFIXO', 'E2_VENCTO', 'E2_SALDO', 'E2_VALOR', 'D_E_L_E_T_'],
  SE5: ['E5_FILIAL', 'E5_DATA', 'E5_NUMERO', 'E5_PARCELA', 'E5_TIPO', 'E5_CLIFOR', 'E5_LOJA', 'E5_PREFIXO', 'E5_VALOR', 'D_E_L_E_T_'],
};

function garantirIntencao(empresaId) {
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    const existe = db.prepare("SELECT id FROM intentions WHERE empresa_id = ? AND nome = 'comissao_dinamico' LIMIT 1").get(empresaId);
    if (existe) return;
    crud.criar('intentions', {
      empresa_id: empresaId,
      nome: 'comissao_dinamico',
      descricao: 'Consultas dinamicas de comissoes via IA-OWNER',
      modulo: 'comissao',
      acao: 'ai_text_to_sql',
      dataset_id: null,
      frases_exemplo: [
        'qual minha comissao do mes',
        'comissoes a receber',
        'comissoes pagas',
        'comissao por cliente',
        'comissao por vendedor',
      ].join('\n'),
      ativo: 1,
    });
    require('../../ai/intent-service').invalidateCache(empresaId);
  } catch (e) {
    console.warn(`[ComissaoIAOwner] Falha ao garantir intencao para empresa #${empresaId}:`, e.message);
  }
}

function normalizarTelefone(tel) {
  return String(tel || '').replace(/\D/g, '');
}

function variantesTelefone(tel) {
  const t = normalizarTelefone(tel);
  const variantes = new Set([t]);
  if (t.length === 13 && t.startsWith('55')) variantes.add(t.slice(0, 4) + t.slice(5));
  if (t.length === 12 && t.startsWith('55')) variantes.add(t.slice(0, 4) + '9' + t.slice(4));
  return variantes;
}

function resolverIdentidadeVendedor(remetente) {
  try {
    const usuariosPath = path.resolve(__dirname, '../../../../IAHUB/data/usuarios.json');
    if (!fs.existsSync(usuariosPath)) return null;
    const usuarios = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
    const variantesRemetente = variantesTelefone(remetente);
    const usuario = usuarios.find(u => variantesRemetente.has(normalizarTelefone(u.erp_telefone)));
    if (!usuario) return null;
    return {
      usuario_id: usuario.id,
      nome: usuario.nome,
      erp_id: String(usuario.erp_id || '').trim().toUpperCase(),
      erp_tipo: usuario.erp_tipo || '',
    };
  } catch (e) {
    console.warn('[ComissaoIAOwner] Falha ao resolver identidade do vendedor:', e.message);
    return null;
  }
}

function prepararIntent({ intent, mensagem }) {
  const remetente = intent._remetente || null;
  const identidade = remetente ? resolverIdentidadeVendedor(remetente) : null;
  if (identidade && identidade.erp_tipo === 'vendedor' && !identidade.erp_id) {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'erp_id_nao_configurado',
        resposta_direta: 'Seu cadastro nao possui um codigo de vendedor ERP configurado. Solicite ao administrador que preencha o campo "ID ERP" no seu perfil.',
        sql_gerado: `-- erro: erp_id vazio para vendedor\n-- mensagem: ${mensagem}`,
      },
    };
  }
  if (remetente && !identidade) {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu numero nao esta cadastrado no sistema. Solicite ao administrador que configure seu acesso ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em usuarios.json`,
      },
    };
  }
  if (identidade?.erp_tipo === 'vendedor' && identidade.erp_id) {
    return {
      contextoTecnicoExtra: {
        vendedorFixo: { codigo: identidade.erp_id, nome: identidade.nome },
        regraVendedorFixo: 'Aplique obrigatoriamente filtro do vendedorFixo em SE3.E3_VEND ou SE3.E3_VENDED quando existir. Nao retorne dados de outros vendedores.',
      },
    };
  }
  return {};
}

const regrasTecnicas = `
## Principio IA-OWNER
Voce decide se a pergunta atual e uma nova consulta, continuidade ou troca de assunto.
O historico e evidencia. Nao herde periodo, filtros ou agrupamentos automaticamente: herde apenas quando fizer sentido pela conversa.

## Analise Historica Multianual — Consulta de Extremo por Ano (SEM filtro de periodo)
- Quando a pergunta buscar um extremo historico ENTRE ANOS — ex: "qual o ano com maior/menor comissao", "qual o melhor/pior ano", "o ano que mais comissionou" — a palavra "ano" e DIMENSAO DE ANALISE, nao referencia de periodo.
- PROIBIDO aplicar BETWEEN ou qualquer filtro de data no WHERE nesses casos.
- Gere SQL sem filtro temporal: GROUP BY SUBSTRING([campo_data], 1, 4) AS ano, ORDER BY [metrica] DESC/ASC, OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY.
- Ignore periodo.tipo = "ano_atual" vindo do estado anterior quando a mensagem pedir explicitamente o "maior/menor/melhor/pior ano" historico.
- EXCECAO: se o usuario especificar range ("ultimos 5 anos", "de 2022 a 2024"), aplique o filtro correspondente.

## Consultas de Frequencia Mensal Completa ("todos os meses do ano")
- Quando o usuario pedir "vendedores/clientes com comissao em todos os meses do ano [X]" ou "todos os meses do ano" (sem especificar ano):
  1. Se [X] nao for informado, assuma o ano atual (SUBSTRING(data_atual, 1, 4)).
  2. Se [X] for o ano atual AINDA EM CURSO (ano nao terminou): o threshold do HAVING e o numero de meses JA DECORRIDOS: CAST(SUBSTRING(data_atual, 5, 2) AS INT). Exemplo: data_atual=2026-06-06 → HAVING COUNT(DISTINCT SUBSTRING(SE3.E3_VENCTO, 5, 2)) = 6.
  3. Se [X] for um ano passado completamente encerrado: use HAVING COUNT(DISTINCT ...) = 12.
- PROIBIDO usar HAVING COUNT(...) = 12 para o ano atual quando o ano ainda nao terminou.
- PROIBIDO declarar frases operacionais como "com comissao todos os meses" em entidades_necessarias — isso nao e uma entidade cadastral.

## Periodos
- Se o usuario disser "ano" sem ano explicito, use o ano atual completo.
- Se disser "mes" sem mes/ano explicito, use o mes atual completo.
- Se disser "dia" sem data explicita, use o dia atual.
- "por mes", "mensal", "mes a mes" podem ser granularidade/agrupamento. Decida pelo texto completo e pelo historico.
- Para "em aberto", "a receber" ou "pendente" sem periodo explicito, nao assuma mes atual; use todos os registros em aberto.
- Datas Protheus sao CHAR(8) YYYYMMDD. Compare com BETWEEN em texto YYYYMMDD.
- Campo de data padrao de comissao provisionada: SE3.E3_VENCTO.

## Comparacao de um Mes nos Ultimos N Anos (comissao)
- Quando o usuario pedir "[mes] dos ultimos N anos" (Ex: "Maio dos ultimos 3 anos"), calcule os N anos a partir de data_atual.
- data_atual=2026 + "ultimos 3 anos" = anos 2024, 2025, 2026. Nunca herde anos do estado anterior.
- NUNCA gere BETWEEN cobrindo apenas 1 mes de 1 ano quando o usuario pediu N anos.
- Campo de data de comissao paga/preparada: SE3.E3_DATA quando existir.
- Campo de data real de baixa/pagamento financeiro: SE5.E5_DATA quando SE2/SE5 forem usados.

## Sintaxe SQL — Padrao ANSI SQL:2008 (SQL Server)
Gere sempre SQL compativel com SQL Server usando construcoes do padrao ANSI. NUNCA use extensoes especificas de MySQL ou PostgreSQL — elas causam erro de sintaxe no SQL Server.

- LIMIT: PROIBIDO. SQL Server nao reconhece LIMIT (sintaxe MySQL). Para limitar linhas use OBRIGATORIAMENTE a sintaxe ANSI SQL:2008, que requer ORDER BY:
    ORDER BY <coluna> OFFSET 0 ROWS FETCH NEXT N ROWS ONLY
  Exemplo correto:  ORDER BY valor_comissao DESC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY
  Exemplo errado:   LIMIT 1

- TOP N + OFFSET/FETCH NEXT: PROIBIDO juntos. SQL Server nao permite SELECT TOP N e OFFSET/FETCH NEXT na mesma query (erro 10741). Escolha UM dos dois mecanismos: prefira sempre OFFSET/FETCH NEXT (ANSI). NUNCA escreva SELECT TOP N quando a query ja tiver OFFSET ... FETCH NEXT.

- YEAR() / MONTH() para agrupamento: PROIBIDO. Use SUBSTRING(campo, 1, 6) AS competencia para extrair 'AAAAMM' (ex: '202506'). Garante compatibilidade entre provedores e ordenacao cronologica correta como string.

- Valor nulo: Use COALESCE(expr, 0) (padrao ANSI) em vez de ISNULL(expr, 0) (especifico SQL Server).

- Diferenca: Use <> (padrao ANSI) em vez de !=.

- Conversao: Prefira CAST(x AS tipo) (padrao ANSI) a CONVERT(tipo, x, estilo) para conversoes basicas sem mascara de formato.

## Identidade do vendedor
- Se o contexto tecnico trouxer vendedorFixo, aplique obrigatoriamente filtro desse vendedor em SE3.E3_VEND ou SE3.E3_VENDED conforme campos disponiveis.
- Nunca retorne dados de outros vendedores quando vendedorFixo estiver presente, mesmo que o usuario nao cite vendedor.

## Carteira / status
- Comissao em aberto/a receber/pendente: filtre LTRIM(RTRIM(SE3.E3_DATA)) = '' quando E3_DATA existir no SX3.
- Comissao paga/realizada: filtre LTRIM(RTRIM(SE3.E3_DATA)) <> '' quando usar SE3.
- Quando a pergunta pedir comissao paga/realizada por data de pagamento e SE2/SE5 estiverem disponiveis, use SE3 -> SE2 -> SE5 e filtre SE5.E5_DATA.
- SE3.E3_STATUS nao significa pagamento realizado; nao use E3_STATUS como pago/em aberto.

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
  SE3.E3_CLIENT = SA1.A1_COD
  AND SE3.E3_LOJA = SA1.A1_LOJA
- SE3 -> SE2, apenas quando necessario e campos existirem:
  SE2.E2_FILIAL = SE3.E3_FILIAL
  AND SE2.E2_FORNECE = SE3.E3_VENDED ou SE3.E3_VEND conforme campo disponivel
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
- Retorne apenas SELECT, sempre iniciando com SET ROWCOUNT 50000.
- OBRIGATORIO SEM EXCECAO: toda tabela no FROM ou em qualquer JOIN deve ter D_E_L_E_T_ = ' ' filtrado. Aplique no WHERE para a tabela principal e na condicao ON para cada JOIN. Exemplo correto: FROM SE3990 SE3 JOIN SA3990 SA3 ON ... AND SA3.D_E_L_E_T_ = ' ' JOIN SA1990 SA1 ON ... AND SA1.D_E_L_E_T_ = ' ' WHERE SE3.D_E_L_E_T_ = ' '. Isso vale inclusive para SA1, SA3, SE2, SE5 — todas as tabelas sem excecao.
- REGRA DE INTEGRIDADE DE JOINS: E terminantemente PROIBIDO usar qualificadores de tabelas cadastrais (ex: SA3.A3_NOME, SA1.A1_NOME, SE2.E2_SALDO) em qualquer parte do SQL (SELECT, WHERE, GROUP BY, ORDER BY) sem declarar o JOIN correspondente no FROM. Sempre que o usuario pedir agrupamento ou exibicao por entidade ("por vendedor", "por cliente"), voce deve: (1) identificar o nome fisico da tabela no sx2 do tenant ativo; (2) adicionar o JOIN com as chaves padrao e com D_E_L_E_T_ = ' ' na condicao ON. SQL com qualificadores sem JOIN declarado e INVALIDO — revise antes de retornar.
- Use aliases explicitos iguais a base da tabela: SE3, SA3, SA1, SE2, SE5.
- Se o contexto tecnico trouxer nomes fisicos SX2, use exatamente esses nomes em FROM/JOIN com alias base. Exemplo: FROM SE3990 SE3, JOIN SA3990 SA3.
- Qualifique campos sempre pelo alias base, nunca pela tabela fisica. Use SE3.E3_COMIS, nao SE3990.E3_COMIS.
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.
- Nao use WITH (NOLOCK).
- Nao use FORMAT() nem TRY_CONVERT().

## Exibicao de entidades
Sempre retorne nome/descricao para o usuario. Codigo sozinho nao serve.
- vendedor: SA3.A3_NOME AS vendedor. Codigo pode vir como cod_vendedor.
- cliente: SA1.A1_NOME AS cliente. Codigo/loja podem vir como cod_cliente e loja_cliente.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.

## Regra Critica — entidades_necessarias Somente para Nomes Proprios Cadastrais
- PROIBIDO declarar em entidades_necessarias qualquer texto que seja uma condicao de filtro, criterio operacional ou frase descritiva — ex: "com comissao todos os meses", "maior comissao", "todos os vendedores ativos".
- entidades_necessarias e EXCLUSIVAMENTE para nomes proprios de entidades cadastrais: nome de vendedor, nome de cliente, etc.
- Se a pergunta nao citar um nome proprio de entidade cadastral, deixe entidades_necessarias vazio ([]).
- Teste interno: o texto declarado seria resultado valido de LIKE '%...%' em SA3.A3_NOME ou SA1.A1_NOME? Se nao for um nome proprio real, nao declare.

## Entidades cadastrais
Quando precisar filtrar vendedor ou cliente por nome citado pelo usuario, retorne em entidades_necessarias.
Depois que o sistema devolver entidades_resolvidas, filtre por codigo interno, nao por LIKE de nome.
- Se a mensagem mencionar "empresa(s) J2A/C3I/todas as empresas" ou o estado tecnico trouxer empresas_iahub_mencionadas, trate esses nomes como escopo de tenant IAHub, nunca como cliente ou vendedor. Nao gere filtro em SA1.A1_NOME, SA3.A3_NOME ou subquery em SA1/SA3 por esses termos.
- REGRA CRITICA — palavra "empresa" como escopo de tenant: Quando a mensagem usa "empresa(s) [NOME1] e/ou [NOME2]" e esses nomes estao em empresas_iahub_mencionadas, a palavra "empresa" indica APENAS o escopo de execucao multiempresa. Ela NAO e um agrupamento SQL nem um filtro cadastral. Nao adicione GROUP BY por empresa/cliente/vendedor baseado nesses nomes.
- REGRA CRITICA — agrupamentos: ["empresa"] no estado anterior: Quando contrato_orquestrador ou estado anterior trouxer agrupamentos: ["empresa"], isso e metadata do backend, NAO e instrucao para GROUP BY SQL. Ignore-o. So adicione GROUP BY SQL quando o usuario pedir explicitamente agrupamento por mes, vendedor, cliente, etc.

## Agregacoes
- "total de comissao" sem agrupamento: retorne uma linha com COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao.
- Inclua COALESCE(SUM(SE3.E3_BASE),0) AS valor_venda quando ajudar a explicar a comissao ou quando o usuario pedir base/vendas.
- Quando o usuario pedir SIMULTANEAMENTE valor de comissao e base/venda, inclua ambas as metricas no mesmo SELECT: COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao, COALESCE(SUM(SE3.E3_BASE),0) AS valor_venda.
- "por vendedor": agrupe por SA3.A3_COD, SA3.A3_NOME.
- "por cliente": agrupe por SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
- "por mes": use OBRIGATORIAMENTE SUBSTRING(SE3.E3_VENCTO, 1, 6) AS competencia no SELECT e GROUP BY. Resultado: '202506', '202507' etc. NUNCA use YEAR() ou MONTH() isolados — a coluna competencia AAAAMM garante agrupamento correto em qualquer ano e e compativel com todos os provedores de conexao.
- REGRA CRITICA — sintaxe SQL Server/ANSI: NUNCA use LIMIT (sintaxe MySQL — causa erro no SQL Server). Para limitar linhas use OBRIGATORIAMENTE: ORDER BY <coluna> OFFSET 0 ROWS FETCH NEXT N ROWS ONLY. Exemplo: "ORDER BY valor_comissao DESC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY".
- Media mensal de periodo (ex: "media mensal dos ultimos 12 meses"): PROIBIDO dividir SUM por COUNT(DISTINCT competencia) no SELECT com GROUP BY — COUNT e sempre 1 dentro do grupo. Use subquery em duas camadas com filtro de periodo no WHERE:
  Camada interna: GROUP BY SUBSTRING(SE3.E3_VENCTO, 1, 6), SUM(SE3.E3_COMIS) AS comissao_mes.
  Camada externa: SELECT COALESCE(AVG(h.comissao_mes), 0) AS media_comissao_mensal FROM (...) h.
  Retorna UMA linha → habilita resposta_planejada no WhatsApp.
- Media sazonal por mes do ano (ex: "media de cada mes do ano", "sazonalidade de comissoes"): subquery sem filtro de ano, agrupando por (ano, mes) na camada interna e apenas por mes na externa.
  Camada interna: GROUP BY SUBSTRING(SE3.E3_VENCTO, 1, 4), SUBSTRING(SE3.E3_VENCTO, 5, 2), SUM(SE3.E3_COMIS).
  Camada externa: SELECT mes, AVG(comissao_mes) GROUP BY mes ORDER BY mes — retorna 12 linhas, resposta_planejada = null.
  PROIBIDO aplicar BETWEEN de ano unico no CASO sazonal.
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

async function buscarEntidade({ empresaId, sx2, tipo, termoTexto, helpers }) {
  const def = entityCatalog.DEFINICOES[tipo];
  if (!def) return [];
  const tabelaCad = helpers.tabelaFisicaSX2(sx2, def.tabelaBase);
  if (!tabelaCad) return [];
  const alias = def.tabelaBase;
  const selectLoja = def.lojaCampo ? `${alias}.${def.lojaCampo} AS loja` : 'NULL AS loja';
  const sql = `SET ROWCOUNT 10;\nSELECT ${alias}.${def.codigoCampo} AS codigo, ${selectLoja}, ${alias}.${def.nomeCampos[0]} AS nome\nFROM ${tabelaCad} ${alias}\nWHERE ${alias}.D_E_L_E_T_ = ' '\n  AND (${camposLike(def, termoTexto, alias, helpers)})\nORDER BY ${alias}.${def.nomeCampos[0]};`;
  try {
    const conn = helpers.connectionFactory.carregarConexao(empresaId);
    conn._empresa_id = empresaId  || '';
    conn._modulo     = 'comissao';
    conn._operacao   = `lookup_${tipo}`;
    conn._pergunta   = termoTexto || '';
    conn._sender     = '';
    const rows = await helpers.connectionFactory.executar(conn, sql, {});
    return (rows || []).filter(r => r.codigo).map(r => ({
      tipo: def.tipo,
      rotuloTipo: def.rotuloTipo,
      tabelaBase: def.tabelaBase,
      codigo: String(r.codigo || '').trim(),
      loja: r.loja == null ? null : String(r.loja || '').trim(),
      nome: String(r.nome || '').trim(),
      joinHint: def.joinHint,
    }));
  } catch (e) {
    console.warn(`[ComissaoIAOwner] Lookup ${tipo} falhou:`, e.message);
    return [];
  }
}

async function resolverEntidades({ pedidos, empresaId, sx2, helpers }) {
  const resolvidas = [];
  for (const pedido of pedidos || []) {
    const texto = String(pedido.texto || '').trim();
    if (!texto) continue;
    let candidatos = [];
    for (const tipo of entityCatalog.tiposParaTermo(pedido)) {
      candidatos = await buscarEntidade({ empresaId, sx2, tipo, termoTexto: texto, helpers });
      if (candidatos.length) break;
    }
    if (!candidatos.length) return { status: 'nao_encontrado', texto, origem: pedido.origem || null };
    if (candidatos.length > 1) return { status: 'ambigua', texto, candidatos, origem: pedido.origem || null };
    resolvidas.push({ ...candidatos[0], termoBusca: texto });
  }
  return { status: 'resolvido', entidades: resolvidas };
}

module.exports = {
  nome: 'comissao',
  handlerName: 'comissao-ia-owner',
  logPrefix: 'ComissaoIAOwner',
  defaultMessage: 'consulta de comissoes',
  tabelas: TABELAS,
  entityCatalog,
  resolverEntidadesAntesDaIa: true,
  camposSx3Essenciais: CAMPOS_SX3_ESSENCIAIS,
  sqlMiddleware,
  regrasTecnicas,
  sx3PromptLimit: 90,
  maxTokens: 4200,
  dimensionLeftJoinBases: ['SA3', 'SA1'],
  sanitizarFiltrosFilialSX2: true,
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta de comissoes no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta de comissoes. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei comissoes para essa consulta.',
    erro_erp: 'Nao consegui buscar as comissoes no ERP. Tente novamente.',
    sem_conexao: 'Nao consegui conectar ao ERP para consultar as comissoes.',
  },
  garantirIntencao,
  prepararIntent,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  _test: {
    resolverIdentidadeVendedor,
    buscarEntidade,
    resolverEntidades,
  },
};
