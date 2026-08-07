'use strict';

const crud = require('../../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const fragmentosSpec = require('./compras-fragmentos-spec');
const { classificarFragmentos } = require('./compras-spec-classifier');
const { resolverVendedorFixoPorEmpresa } = require('../guards/vendedor-seguranca');
const { resolverAprovadorFixoPorEmpresa } = require('../guards/aprovador-seguranca');

const TABELAS = ['SF1', 'SD1', 'SF2', 'SD2', 'SB1', 'SBM', 'SA2', 'SC7', 'CTT', 'SED', 'SF4', 'SCR', 'SAK'];

const CAMPOS_SX3_ESSENCIAIS = {
  SD1: ['D1_FILIAL', 'D1_DOC', 'D1_SERIE', 'D1_FORNECE', 'D1_LOJA', 'D1_COD', 'D1_DESCRI', 'D1_QUANT', 'D1_VUNIT', 'D1_TOTAL', 'D1_DTDIGIT', 'D1_TES', 'D1_NATUREZ', 'D1_PEDIDO', 'D1_ITEMPC', 'D1_CC', 'D1_CF', 'D_E_L_E_T_'],
  SF1: ['F1_FILIAL', 'F1_DOC', 'F1_SERIE', 'F1_FORNECE', 'F1_LOJA', 'F1_EMISSAO', 'F1_DTDIGIT', 'F1_TIPO', 'F1_VALBRUT', 'F1_VALMERC', 'F1_TOTALNF', 'D_E_L_E_T_'],
  SD2: ['D2_FILIAL', 'D2_DOC', 'D2_SERIE', 'D2_CLIENTE', 'D2_LOJA', 'D2_COD', 'D2_TOTAL', 'D2_VALDEV', 'D2_QTDEDEV', 'D2_EMISSAO', 'D2_NFORI', 'D2_SERIORI', 'D2_ITEMORI', 'D_E_L_E_T_'],
  SF2: ['F2_FILIAL', 'F2_DOC', 'F2_SERIE', 'F2_CLIENTE', 'F2_LOJA', 'F2_EMISSAO', 'F2_TIPO', 'F2_VALBRUT', 'F2_VALMERC', 'D_E_L_E_T_'],
  SA2: ['A2_FILIAL', 'A2_COD', 'A2_LOJA', 'A2_NOME', 'A2_NREDUZ', 'A2_CGC', 'D_E_L_E_T_'],
  SB1: ['B1_FILIAL', 'B1_COD', 'B1_DESC', 'B1_GRUPO', 'B1_UM', 'D_E_L_E_T_'],
  SBM: ['BM_FILIAL', 'BM_GRUPO', 'BM_DESC', 'D_E_L_E_T_'],
  SC7: ['C7_FILIAL', 'C7_NUM', 'C7_ITEM', 'C7_FORNECE', 'C7_LOJA', 'C7_PRODUTO', 'C7_QUANT', 'C7_QUJE', 'C7_PRECO', 'C7_TOTAL', 'C7_EMISSAO', 'C7_DATPRF', 'C7_RESIDUO', 'C7_OK', 'C7_APROV', 'D_E_L_E_T_'],
  CTT: ['CTT_FILIAL', 'CTT_CUSTO', 'CTT_DESC01', 'D_E_L_E_T_'],
  SED: ['ED_FILIAL', 'ED_CODIGO', 'ED_DESCRIC', 'D_E_L_E_T_'],
  SF4: ['F4_FILIAL', 'F4_CODIGO', 'F4_TEXTO', 'F4_TIPO', 'F4_DUPLIC', 'F4_ESTOQUE', 'F4_CF', 'D_E_L_E_T_'],
  SCR: ['CR_FILIAL', 'CR_NUM', 'CR_TIPO', 'CR_STATUS', 'CR_APROV', 'CR_NIVEL', 'CR_USER', 'CR_USERLIB', 'CR_EMISSAO', 'CR_DATALIB', 'D_E_L_E_T_'],
  SAK: ['AK_FILIAL', 'AK_COD', 'AK_NOME', 'D_E_L_E_T_'],
};

function validarDeleteFiltros(sql = '') {
  const texto = String(sql || '');
  const aliases = ['SF1', 'SD1', 'SF2', 'SD2', 'SA2', 'SB1', 'SBM', 'SC7', 'CTT', 'SED', 'SF4', 'SCR', 'SAK'];
  const faltando = [];
  for (const alias of aliases) {
    const reDeclarado = new RegExp(`\\b(?:FROM|JOIN)\\s+\\w+\\s+${alias}\\b`, 'i');
    if (!reDeclarado.test(texto)) continue;
    const reDelete = new RegExp(`\\b${alias}\\s*\\.\\s*D_E_L_E_T_\\s*=\\s*'\\s*'`, 'i');
    if (!reDelete.test(texto)) faltando.push(alias);
  }
  if (!faltando.length) return null;
  return `FROM/JOIN sem filtro D_E_L_E_T_: ${faltando.join(', ')}. REGRA ABSOLUTA: toda tabela no FROM ou JOIN deve ter alias.D_E_L_E_T_ = ' ' — tabela no FROM: WHERE alias.D_E_L_E_T_ = ' '; tabela em JOIN: AND alias.D_E_L_E_T_ = ' ' dentro do ON. Adicione os filtros faltantes.`;
}

function garantirIntencao(empresaId) {
  try {
    const { getDB } = require('../../../database');
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
    require('../../../ai/intent-service').invalidateCache(empresaId);
  } catch (e) {
    console.warn(`[ComprasIAOwner] Falha ao garantir intencao para empresa #${empresaId}:`, e.message);
  }
}

// temSaldoAlcadaAprovador (tabela DBM) ainda nao e usado por nenhum fragmento — reservado
// ate a sincronizacao do SX3 real da DBM confirmar os campos. Aceito aqui so por paridade
// com o restante do contexto tecnico, sem efeito no prompt.
function regrasTecnicas({ mensagem, temAprovacaoPedidoCompra, temNomeAprovador, temSaldoAlcadaAprovador } = {}) {
  const chavesAcionadas = classificarFragmentos(mensagem);
  const chaves = chavesAcionadas || fragmentosSpec.ORDEM_FALLBACK;

  const partes = [
    [
      '## Continuidade e Periodo em Compras',
      '- Em perguntas de continuidade, o periodo herdado pelo contrato/query_plan e autoritativo. Preserve exatamente dataInicio/dataFim no SQL.',
      '- "Agora detalhe por fornecedor", "por produto", "por centro de custo" ou "compare esse resultado" sao refinamentos da consulta anterior; nao removem o periodo nem inventam outro ano.',
      '- Se o contrato trouxer periodo 20250701 a 20250731, o SQL deve conter esse intervalo ou competencia 202507 em SD1.D1_DTDIGIT para notas de entrada, ou SC7.C7_EMISSAO para pedidos de compra. PROIBIDO trocar para 202307, para data_atual ou para outro ano inferido.',
      '- Nao mantenha filtros temporais antigos ou inferidos junto do periodo do contrato. Exemplo proibido: SD1.D1_DTDIGIT BETWEEN 20230701..20230731 quando o contrato manda 20250701..20250731.',
      '- Quando o contrato trouxer periodo_base e periodo_comparacao, gere SQL com os dois periodos. PROIBIDO retornar apenas o periodo_comparacao.',
      "- Para comparativo de meses, prefira UNION ALL com coluna periodo/competencia, ou filtre competencia explicitamente com IN ('AAAAMM','AAAAMM') e agrupe por SUBSTRING(SD1.D1_DTDIGIT,1,6).",
      "- Se usar UNION ALL e cada SELECT filtrar um unico mes, retorne a competencia como literal fixo (ex: SELECT '202506' AS competencia, SUM(...)). Se retornar SUBSTRING(SD1.D1_DTDIGIT,1,6) junto com SUM(), o SELECT precisa ter GROUP BY da mesma expressao.",
      '- Para compras normais de NF de entrada, use SF1 + SD1 e preserve SD1.D1_DTDIGIT como campo temporal padrao.',
    ].join('\n'),
    fragmentosSpec.base(),
  ];
  for (const chave of chaves) {
    const fragmento = fragmentosSpec.FRAGMENTOS[chave];
    if (!fragmento) continue;
    // aprovacao_pedido_compra depende de SCR existir no SX2 do tenant (contexto tecnico).
    // Sem essa tabela cadastrada, o fragmento e omitido silenciosamente — nunca gera erro.
    if (chave === 'aprovacao_pedido_compra' && !temAprovacaoPedidoCompra) continue;
    partes.push(fragmento.texto({ temNomeAprovador, temSaldoAlcadaAprovador }));
  }
  return partes.join('\n').trim();
}

// Compras nao possui campo de vendedor/comprador em nenhuma tabela (SC7, SD1, SA2) — sem
// forma de restringir por escopo, entao o modulo fica bloqueado integralmente para
// vendedor DE FATO (codigo preenchido). Um usuario sem codigo de vendedor mas com codigo
// de aprovador continua acessando normalmente (checagem abaixo). Gestor e numeros sem
// erp_tipo continuam com acesso total, sem qualquer alteracao.
function prepararIntent({ intent, empresaId, mensagem }) {
  const remetente = intent._remetente || null;
  if (!remetente) return {};

  const resolucao = resolverVendedorFixoPorEmpresa(remetente, empresaId);

  if (resolucao.estado === 'nao_cadastrado') {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu número não está cadastrado como usuário ou gestor no IA Command. Para acessar dados de compras, solicite ao gestor do IA Command que configure seu perfil ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em whatsapp_allowed_numbers para empresa_id=${empresaId}`,
      },
    };
  }

  // Bloqueia apenas vendedor DE FATO (codigo preenchido) — 'sem_codigo_vendedor' (usuario
  // sem erp_id) pode ainda assim ser aprovador, entao cai para a checagem abaixo em vez
  // de ser bloqueado como se fosse vendedor.
  if (resolucao.estado === 'vendedor') {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'acesso_negado_vendedor',
        resposta_direta: 'O módulo de compras não está disponível para o perfil de vendedor. Para consultar compras, peça para um gestor consultar.',
        sql_gerado: `-- bloqueado: modulo compras nao possui campo de vendedor/comprador\n-- mensagem: ${mensagem}`,
      },
    };
  }

  // gestor, sem_restricao ou sem_codigo_vendedor: acesso total por padrao, exceto se
  // cod_aprov_erp cadastrado, disponibiliza o codigo no contexto tecnico para a IA aplicar
  // SOMENTE quando a pergunta usar linguagem de posse ("meus pedidos", "para eu aprovar").
  // Diferente do vendedorFixo (sempre restrito), aqui o filtro e condicional a intencao —
  // um gestor com codigo de aprovador cadastrado ainda pode consultar todos os aprovadores.
  const resolucaoAprovador = resolverAprovadorFixoPorEmpresa(remetente, empresaId);
  if (resolucaoAprovador.estado === 'aprovador') {
    const contextoTecnicoExtra = {
      aprovadorFixo: { codigo: resolucaoAprovador.codigo, nome: resolucaoAprovador.nome },
      regraAprovadorFixo: `O numero que enviou esta pergunta tem o codigo de aprovador ERP "${resolucaoAprovador.codigo}" cadastrado (SCR.CR_APROV/SAK.AK_COD). Use SCR.CR_APROV = '${resolucaoAprovador.codigo}' SOMENTE quando a pergunta usar linguagem de posse referente ao proprio remetente — ex: "meus pedidos pendentes", "pedidos para eu aprovar", "pedidos bloqueados para eu aprovar", "minha alcada", "o que eu preciso liberar", "o que eu ja aprovei", "aprovei hoje/no mes". Quando a pergunta for generica sobre aprovadores (ex: "pedidos pendentes por aprovador", "pedidos do aprovador X"), NAO aplique esse filtro — retorne todos os aprovadores normalmente.`,
    };
    // Diferente de vendedorFixo/clienteFixo (sempre restritos), o filtro de aprovador so e
    // obrigatorio quando a MENSAGEM usa linguagem de posse — por isso a entidadeSeguranca
    // (que aciona o guard estrutural em validarExclusividadeVendedorSeguranca/runner.js) so
    // e injetada nesse caso. Pergunta generica sobre aprovadores nao gera entidadeSeguranca:
    // fica so o contextoTecnicoExtra acima, sem guard, permitindo consultar todos livremente.
    if (fragmentosSpec.mensagemUsaLinguagemPosseAprovador(mensagem)) {
      return {
        contextoTecnicoExtra,
        entidadeSeguranca: {
          tipo: 'aprovador_fixo_seguranca',
          codigo: resolucaoAprovador.codigo,
          nome: resolucaoAprovador.nome,
        },
      };
    }
    return { contextoTecnicoExtra };
  }

  return {};
}

const contratosTecnicosPrioritarios = `
- SD1 -> SF1:
  SD1.D1_FILIAL = SF1.F1_FILIAL
  AND SD1.D1_DOC = SF1.F1_DOC
  AND SD1.D1_SERIE = SF1.F1_SERIE
  AND SD1.D1_FORNECE = SF1.F1_FORNECE
  AND SD1.D1_LOJA = SF1.F1_LOJA
- SD2 -> SF2:
  SD2.D2_FILIAL = SF2.F2_FILIAL
  AND SD2.D2_DOC = SF2.F2_DOC
  AND SD2.D2_SERIE = SF2.F2_SERIE
  AND SD2.D2_CLIENTE = SF2.F2_CLIENTE
  AND SD2.D2_LOJA = SF2.F2_LOJA
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
  contratosTecnicosPrioritarios,
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
      validar(sql) {
        const texto = String(sql || '');
        if (!/\b(?:FROM|JOIN)\s+SF1\w*\s+SF1\b/i.test(texto)) return null;
        if (/\bSF1\s*\.\s*F1_TIPO\b/i.test(texto)) return null;
        return "SF1 usada sem filtro SF1.F1_TIPO. REGRA OBRIGATORIA: toda query fiscal que use SF1 deve informar o tipo da NF de entrada. Use SF1.F1_TIPO = 'N' para compra normal/custo real, ou SF1.F1_TIPO = 'D' quando a pergunta for devolucao de venda. Nunca use SF1 sem F1_TIPO.";
      },
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
    {
      regex: /^(?![\s\S]*\bJOIN\s+\w+\s+SA2\b)[\s\S]*\bSA2\s*\.\s*A2_\w+/i,
      mensagem: 'Campo SA2.A2_* usado sem JOIN SA2 declarado no FROM. Adicione JOIN SA2<sufixo> SA2 ON SF1.F1_FORNECE = SA2.A2_COD AND SF1.F1_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = \' \' antes de usar campos de fornecedor.',
    },
    {
      regex: /^(?![\s\S]*\bJOIN\s+\w+\s+SB1\b)[\s\S]*\bSB1\s*\.\s*B1_\w+/i,
      mensagem: 'Campo SB1.B1_* usado sem JOIN SB1 declarado no FROM. Adicione JOIN SB1<sufixo> SB1 ON SD1.D1_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = \' \' antes de usar campos de produto.',
    },
    {
      validar: validarDeleteFiltros,
    },
    {
      validar(sql, mensagem) {
        const usaSF4 = /\bJOIN\s+\w+\s+SF4\b/i.test(sql);
        if (!usaSF4) return null;
        const temEstoque = /\bSF4\s*\.\s*F4_ESTOQUE\s*=/i.test(sql);
        const temDuplic = /\bSF4\s*\.\s*F4_DUPLIC\s*=/i.test(sql);
        if (temEstoque || temDuplic) return null;
        const texto = String(mensagem || '').toLowerCase();
        const pedeEstoque = /estoque/.test(texto);
        const pedeFinanceiro = /financeiro|duplicata|contas?\s+a\s+pagar/.test(texto);
        if (!pedeEstoque && !pedeFinanceiro) return null;
        if (pedeEstoque) {
          return (
            'A pergunta menciona estoque/movimentacao de estoque, mas o JOIN com SF4 (TES) nao tem o filtro AND SF4.F4_ESTOQUE = \'S\' no WHERE. ' +
            'O JOIN sozinho apenas associa o TES, sem filtrar nada — sem esse filtro a query soma TODAS as compras com qualquer TES vinculado, nao apenas as que geraram estoque. Adicione o filtro.'
          );
        }
        return (
          'A pergunta menciona financeiro/duplicata/contas a pagar, mas o JOIN com SF4 (TES) nao tem o filtro AND SF4.F4_DUPLIC = \'S\' no WHERE. ' +
          'O JOIN sozinho apenas associa o TES, sem filtrar nada — sem esse filtro a query soma TODAS as compras com qualquer TES vinculado, nao apenas as que geraram obrigacao financeira. Adicione o filtro.'
        );
      },
    },
    {
      validar(sql, mensagem) {
        const texto = String(mensagem || '').toLowerCase();
        const pedeMedia = /\bm[eé]di[ao]\b/.test(texto);
        if (!pedeMedia) return null;
        const temAvg = /\bAVG\s*\(/i.test(sql);
        if (temAvg) return null;
        return (
          'A pergunta pede uma media, mas o SQL nao contem nenhuma funcao AVG() — isso retorna o total POR periodo (uma listagem), nao a media entre os periodos. ' +
          'Monte a estrutura de duas camadas: subquery interna agrupada por periodo com SUM(), e query externa com SELECT AVG(h.<coluna_soma>) FROM (<subquery interna>) AS h.'
        );
      },
    },
    {
      validar(sql) {
        const temAvgDireto = /\bAVG\s*\(\s*SD1\s*\.\s*D1_TOTAL\s*\)|\bAVG\s*\(\s*SF1\s*\.\s*F1_VALBRUT\s*\)/i.test(sql);
        if (!temAvgDireto) return null;
        const temGroupBy = /\bGROUP\s+BY\b/i.test(sql);
        if (!temGroupBy) return null;
        return (
          'AVG(SD1.D1_TOTAL) ou AVG(SF1.F1_VALBRUT) com GROUP BY na mesma camada calcula o ticket medio por nota dentro de cada periodo, NAO a media do total comprado entre os periodos. ' +
          'Monte a estrutura de duas camadas: subquery interna agrupada por periodo com SUM() (nao AVG), e query externa com AVG(h.<coluna_soma>) sobre os totais da subquery.'
        );
      },
    },
    {
      validar(sql, mensagem) {
        const texto = String(mensagem || '').toLowerCase();
        const pedeAprovador = /\baprovador(?:es)?\b/.test(texto) || /\bpor\s+aprovador\b/.test(texto);
        if (!pedeAprovador) return null;
        const usaSCR = /\b(?:FROM|JOIN)\s+\w*SCR\w*\s+SCR\b/i.test(sql);
        if (!usaSCR) return null;
        const temCrAprov = /\bSCR\s*\.\s*CR_APROV\b/i.test(sql);
        const temJoinSak = /\bJOIN\s+\w*SAK\w*\s+SAK\b/i.test(sql);
        if (temCrAprov || temJoinSak) return null;
        return (
          'A pergunta pede "por aprovador", mas o SQL usa SCR sem projetar/agrupar SCR.CR_APROV nem fazer JOIN com SAK. ' +
          'Adicione SCR.CR_APROV (ou LEFT JOIN SAK ON SCR.CR_APROV = SAK.AK_COD para exibir o nome) no SELECT e no GROUP BY — sem essa coluna a consulta nao identifica QUEM precisa aprovar, apenas lista os pedidos.'
        );
      },
    },
    {
      validar(sql, mensagem) {
        const texto = String(mensagem || '').toLowerCase();
        const linguagemPosse = /\bmeus?\s+pedidos?\b/.test(texto)
          || /\bpara\s+eu\s+aprovar\b/.test(texto)
          || /\bminha\s+al[cç]ada\b/.test(texto)
          || /\bpendentes?\s+de\s+aprova[cç][aã]o\s+(?:pra|para)\s+mim\b/.test(texto)
          || /\bo\s+que\s+eu\s+preciso\s+liberar\b/.test(texto);
        if (!linguagemPosse) return null;
        const usaSCR = /\b(?:FROM|JOIN)\s+\w*SCR\w*\s+SCR\b/i.test(sql);
        if (!usaSCR) return null;
        // Exige comparacao com literal (SCR.CR_APROV = '000001') — projecao em COALESCE/SELECT
        // (ex: COALESCE(SAK.AK_NOME, SCR.CR_APROV)) nao filtra nada, so exibe o codigo.
        const temFiltroCrAprov = /\bSCR\s*\.\s*CR_APROV\s*=\s*'/i.test(sql);
        if (temFiltroCrAprov) return null;
        return (
          'A pergunta usa linguagem de posse ("meus pedidos", "para eu aprovar", "minha alcada") indicando que o remetente quer ver APENAS os pedidos pendentes para o proprio codigo de aprovador. ' +
          'Verifique se o contexto tecnico trouxe aprovadorFixo.codigo e regraAprovadorFixo — se sim, adicione AND SCR.CR_APROV = \'<codigo do aprovadorFixo>\' no WHERE. Sem esse filtro a consulta retorna pedidos de TODOS os aprovadores, nao apenas os do remetente.'
        );
      },
    },
  ],
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta de compras no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta de compras. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei compras para essa consulta.',
    erro_erp: 'Nao consegui buscar as compras no ERP. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao: 'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  },
  camposPeriodoObrigatorios: ['D1_DTDIGIT', 'F1_DTDIGIT', 'F1_EMISSAO', 'C7_EMISSAO', 'CR_EMISSAO', 'CR_DATALIB'],
  camposAprovadorSeguranca: ['CR_APROV'],
  garantirIntencao,
  prepararIntent,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  _test: {
    prepararIntent,
    buscarEntidade,
    resolverEntidades,
  },
};
