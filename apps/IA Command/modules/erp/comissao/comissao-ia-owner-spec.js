'use strict';

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

function resolverIdentidadeVendedor(remetente, empresaId) {
  try {
    const { getDB } = require('../../database');
    const channelStore = require('../../whatsapp/channel-store');
    const db = getDB();

    const variantes = channelStore.variantesNumeroBrasil(remetente);
    const lid = channelStore.extrairLid(remetente);
    const placeholders = variantes.map(() => '?').join(',');

    const row = db.prepare(
      `SELECT nome, erp_tipo, erp_id FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1`
    ).get(empresaId, ...variantes, lid);

    if (!row) return null;
    return {
      nome:     row.nome,
      erp_tipo: String(row.erp_tipo || '').trim().toLowerCase(),
      erp_id:   String(row.erp_id  || '').trim().toUpperCase(),
    };
  } catch (e) {
    console.warn('[ComissaoIAOwner] Falha ao resolver identidade do vendedor:', e.message);
    return null;
  }
}

function prepararIntent({ intent, empresaId, mensagem }) {
  const remetente = intent._remetente || null;
  const identidade = remetente ? resolverIdentidadeVendedor(remetente, empresaId) : null;

  if (identidade && identidade.erp_tipo === 'vendedor' && !identidade.erp_id) {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'erp_id_nao_configurado',
        resposta_direta: 'Seu cadastro não possui um código de vendedor ERP configurado. Solicite ao gestor do IA Command que preencha o campo *Código ERP* nas suas configurações de acesso.',
        sql_gerado: `-- erro: erp_id vazio para vendedor\n-- mensagem: ${mensagem}`,
      },
    };
  }
  if (remetente && !identidade) {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu número não está cadastrado como vendedor ou gestor no IA Command. Para acessar dados de comissão, solicite ao gestor do IA Command que configure seu perfil ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em whatsapp_allowed_numbers`,
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
## Campos de data padrao
- Comissao provisionada: SE3.E3_VENCTO (CHAR(8) YYYYMMDD).
- Comissao paga/preparada: SE3.E3_DATA quando existir no SX3.
- Baixa/pagamento financeiro real: SE5.E5_DATA quando SE2/SE5 forem usados.
- Em aberto/pendente sem periodo explicito: consulte toda a carteira em aberto (sem BETWEEN).

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
- Media mensal por ano (subquery 2 camadas, agrupado por ano):
  Subquery interna exporta DOIS aliases: SUBSTRING(SE3.E3_VENCTO,1,4) AS ano E SUBSTRING(SE3.E3_VENCTO,1,6) AS competencia. Query externa: SELECT h.ano, AVG(h.valor_comissao) AS media_mensal FROM (...) AS h GROUP BY h.ano. Camada externa usa SOMENTE h.ano e h.valor_comissao — NUNCA SE3.*.
- Media mensal escalar (1 ano): subquery interna SUM por mes. Query externa AVG(h.valor_comissao) sem GROUP BY.
- Media anual escalar: subquery interna SUM por ano → externa AVG dos totais. Alias externo: AS valor_comissao.
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
