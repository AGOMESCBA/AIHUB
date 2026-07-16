'use strict';

const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const fragmentosSpec = require('./faturamento-fragmentos-spec');
const { classificarFragmentos } = require('./faturamento-spec-classifier');
const { resolverVendedorFixoPorEmpresa } = require('../vendedor-seguranca');

// Vendas em SF2 podem ser rateadas entre ate 5 vendedores (F2_VEND1..F2_VEND5).
// O filtro de seguranca deve aceitar o vendedor em QUALQUER uma dessas posicoes.
const CAMPOS_VENDEDOR_SEGURANCA = ['F2_VEND1', 'F2_VEND2', 'F2_VEND3', 'F2_VEND4', 'F2_VEND5'];

const TABELAS = ['SF2', 'SD2', 'SF1', 'SD1', 'SA1', 'SA3', 'SB1', 'SBM', 'SF4', 'CTT', 'ACY'];

const CAMPOS_SX3_ESSENCIAIS = {
  SF2: ['F2_FILIAL', 'F2_DOC', 'F2_SERIE', 'F2_CLIENTE', 'F2_LOJA', 'F2_EMISSAO', 'F2_TIPO', 'F2_VALBRUT', 'F2_VALMERC', 'F2_VALFAT', 'F2_VEND1', 'F2_VEND2', 'F2_VEND3', 'F2_VEND4', 'F2_VEND5', 'D_E_L_E_T_'],
  SD2: ['D2_FILIAL', 'D2_DOC', 'D2_SERIE', 'D2_CLIENTE', 'D2_LOJA', 'D2_COD', 'D2_QUANT', 'D2_TOTAL', 'D2_VALBRUT', 'D2_PRCVEN', 'D2_TES', 'D2_CF', 'D2_CCUSTO', 'D_E_L_E_T_'],
  SF1: ['F1_FILIAL', 'F1_DOC', 'F1_SERIE', 'F1_FORNECE', 'F1_LOJA', 'F1_EMISSAO', 'F1_DTDIGIT', 'F1_TIPO', 'F1_VALBRUT', 'F1_VALMERC', 'F1_TOTALNF', 'D_E_L_E_T_'],
  SD1: ['D1_FILIAL', 'D1_DOC', 'D1_SERIE', 'D1_FORNECE', 'D1_LOJA', 'D1_COD', 'D1_QUANT', 'D1_TOTAL', 'D1_DTDIGIT', 'D1_TES', 'D1_CF', 'D_E_L_E_T_'],
  SA1: ['A1_FILIAL', 'A1_COD', 'A1_LOJA', 'A1_NOME', 'A1_NREDUZ', 'A1_CGC', 'A1_MUN', 'A1_EST', 'A1_GRPVEN', 'D_E_L_E_T_'],
  SA3: ['A3_FILIAL', 'A3_COD', 'A3_NOME', 'D_E_L_E_T_'],
  SB1: ['B1_FILIAL', 'B1_COD', 'B1_DESC', 'B1_GRUPO', 'B1_UM', 'B1_TIPO', 'D_E_L_E_T_'],
  SBM: ['BM_FILIAL', 'BM_GRUPO', 'BM_DESC', 'D_E_L_E_T_'],
  SF4: ['F4_FILIAL', 'F4_CODIGO', 'F4_TEXTO', 'F4_DUPLIC', 'F4_ESTOQUE', 'F4_TIPO', 'F4_CF', 'D_E_L_E_T_'],
  CTT: ['CTT_FILIAL', 'CTT_CUSTO', 'CTT_DESC01', 'D_E_L_E_T_'],
  ACY: ['ACY_FILIAL', 'ACY_GRPVEN', 'ACY_DESCRI', 'ACY_GRPSUP', 'D_E_L_E_T_'],
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
        'quantidade carregada no dia',
        'quantidade de nota mae para entrega futura',
        'movimentacao total de saida',
        'faturamento considerando devolucoes',
      ].join('\n'),
      ativo: 1,
    });
    require('../../ai/intent-service').invalidateCache(empresaId);
  } catch (e) {
    console.warn(`[FaturamentoIAOwner] Falha ao garantir intencao para empresa #${empresaId}:`, e.message);
  }
}

function regrasTecnicas({ mensagem } = {}) {
  const chavesAcionadas = classificarFragmentos(mensagem);
  // null = pergunta nao classificada em nenhuma sub-operacao -> injeta TODOS os
  // fragmentos (fallback idempotente ao comportamento anterior a fragmentacao).
  const chaves = chavesAcionadas || fragmentosSpec.ORDEM_FALLBACK;

  const partes = [fragmentosSpec.base()];
  for (const chave of chaves) {
    const fragmento = fragmentosSpec.FRAGMENTOS[chave];
    if (fragmento) partes.push(fragmento.texto());
  }
  return partes.join('\n').trim();
}

function prepararIntent({ intent, empresaId, mensagem }) {
  const remetente = intent._remetente || null;
  if (!remetente) return {};

  const resolucao = resolverVendedorFixoPorEmpresa(remetente, empresaId);

  if (resolucao.estado === 'nao_cadastrado') {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu número não está cadastrado como vendedor ou gestor no IA Command. Para acessar dados de faturamento, solicite ao gestor do IA Command que configure seu perfil ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em whatsapp_allowed_numbers para empresa_id=${empresaId}`,
      },
    };
  }

  if (resolucao.estado === 'vendedor_sem_codigo') {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'erp_id_nao_configurado',
        resposta_direta: 'Seu cadastro não possui um código de vendedor ERP configurado. Solicite ao gestor do IA Command que preencha o campo *Código ERP* nas suas configurações de acesso.',
        sql_gerado: `-- erro: erp_id vazio para vendedor\n-- mensagem: ${mensagem}`,
      },
    };
  }

  if (resolucao.estado === 'vendedor') {
    // Injeta vendedorFixo no contexto da IA (para o prompt) E como entidade de segurança
    // (para parametrização/validação do SQL gerado). SF2 permite rateio ate 5 vendedores.
    return {
      contextoTecnicoExtra: {
        vendedorFixo: { codigo: resolucao.codigo, nome: resolucao.nome },
        regraVendedorFixo: 'Aplique OBRIGATORIAMENTE o filtro do vendedorFixo cobrindo TODAS as 5 posicoes de rateio, sempre, em toda query, mesmo que a venda pareca ter um so vendedor: AND (SF2.F2_VEND1 = \'<codigo>\' OR SF2.F2_VEND2 = \'<codigo>\' OR SF2.F2_VEND3 = \'<codigo>\' OR SF2.F2_VEND4 = \'<codigo>\' OR SF2.F2_VEND5 = \'<codigo>\'). Nunca filtre apenas F2_VEND1 sozinho — vendas rateadas podem ter o vendedor autorizado em qualquer uma das 5 posicoes, e omitir as demais esconde vendas legitimas do proprio vendedor. Nao retorne dados de outros vendedores.',
      },
      entidadeSeguranca: {
        tipo: 'vendedor_fixo_seguranca',
        codigo: resolucao.codigo,
        nome: resolucao.nome,
      },
    };
  }

  // gestor ou sem_restricao: acesso total, sem filtro
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

function validarMediaMensalProduto(sql = '') {
  const texto = String(sql || '');
  if (!/\bAVG\s*\(\s*h\s*\.\s*faturamento_mes\s*\)/i.test(texto)) return null;
  const pareceProduto = /\bproduto\b|\bcod_produto\b|\bD2_COD\b|\bB1_DESC\b/i.test(texto);
  if (!pareceProduto) return null;
  const exportaCompetencia = /\bSUBSTRING\s*\(\s*SF2\s*\.\s*F2_EMISSAO\s*,\s*1\s*,\s*6\s*\)\s+AS\s+competencia\b/i.test(texto);
  const agrupaCompetencia = /\bGROUP\s+BY\b[\s\S]*\bSUBSTRING\s*\(\s*SF2\s*\.\s*F2_EMISSAO\s*,\s*1\s*,\s*6\s*\)/i.test(texto);
  const exportaProduto = /\bB1_COD\s+AS\s+cod_produto\b/i.test(texto) && /\bB1_DESC\s+AS\s+produto\b/i.test(texto);
  const externoUsaAliases = /\bSELECT\b[\s\S]*\bh\s*\.\s*cod_produto\b[\s\S]*\bh\s*\.\s*produto\b/i.test(texto)
    && /\bGROUP\s+BY\b[\s\S]*\bh\s*\.\s*cod_produto\b[\s\S]*\bh\s*\.\s*produto\b/i.test(texto);
  if (exportaCompetencia && agrupaCompetencia && exportaProduto && externoUsaAliases) return null;
  return [
    'Faturamento medio por produto exige media dos totais mensais.',
    'Refaca usando este template estrutural: SELECT h.cod_produto, h.produto, COALESCE(AVG(h.faturamento_mes),0) AS faturamento_medio FROM (SELECT SB1.B1_COD AS cod_produto, SB1.B1_DESC AS produto, SUBSTRING(SF2.F2_EMISSAO,1,6) AS competencia, COALESCE(SUM(SD2.D2_TOTAL),0) AS faturamento_mes FROM SD2 SD2 INNER JOIN SF2 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = \' \' INNER JOIN SB1 SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = \' \' WHERE SD2.D_E_L_E_T_ = \' \' AND SF2.F2_TIPO = \'N\' AND <filtro_periodo_em_SF2.F2_EMISSAO> GROUP BY SB1.B1_COD, SB1.B1_DESC, SUBSTRING(SF2.F2_EMISSAO,1,6)) AS h GROUP BY h.cod_produto, h.produto.',
    'Nunca use SB1.* na query externa; use somente h.cod_produto, h.produto e h.faturamento_mes.',
  ].join(' ');
}

function validarFiltroTipoSF2(sql = '') {
  const texto = String(sql || '');
  // Detecta SF2 como alias declarado: "FROM SF2<qualquer> SF2" ou "JOIN SF2<qualquer> SF2"
  if (!/\b(?:FROM|JOIN)\s+SF2\w*\s+SF2\b/i.test(texto)) return null;
  // Verifica se há filtro em F2_TIPO (qualquer valor)
  if (/\bSF2\s*\.\s*F2_TIPO\b/i.test(texto)) return null;
  return "SF2 usada sem filtro SF2.F2_TIPO. REGRA OBRIGATORIA: toda query de faturamento que use SF2 deve filtrar SF2.F2_TIPO = 'N' no WHERE. Isso exclui devolucoes de compras (tipo 'D'), complementos e outros tipos que nao representam receita de venda. Adicione AND SF2.F2_TIPO = 'N' ao WHERE.";
}

function validarGrupoCliente(sql = '', mensagem = '') {
  // Detecta quando a pergunta pede agrupamento por grupo de cliente
  // mas o SQL não contém JOIN ACY — a IA ignorou a dimensão e gerou escalar ou agrupou por outro campo.
  const pedidoGrupoCliente = /\bgrupo\s+de\s+cliente\w*\b/i.test(String(mensagem || ''));
  if (!pedidoGrupoCliente) return null;
  const texto = String(sql || '');
  const temACY = /\bJOIN\s+\w+\s+ACY\b/i.test(texto);
  if (temACY) return null;
  return [
    'A pergunta pede agrupamento por grupo de cliente, mas o SQL nao contem JOIN ACY.',
    'OBRIGATORIO montar a cadeia completa: SD2 -> SF2 -> SA1 -> ACY.',
    'Template de JOIN obrigatorio:',
    "  JOIN SA1<sufixo> SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '",
    "  LEFT JOIN ACY<sufixo> ACY ON ACY.ACY_GRPVEN = SA1.A1_GRPVEN AND ACY.D_E_L_E_T_ = ' '  -- ATENCAO: ACY_GRPVEN liga com SA1.A1_GRPVEN, NAO com SA1.A1_COD",
    'SELECT obrigatorio: ACY.ACY_DESCRI AS grupo_cliente',
    'GROUP BY obrigatorio: ACY.ACY_GRPVEN, ACY.ACY_DESCRI',
    'ATENCAO: use LEFT JOIN para ACY — cliente pode nao ter grupo cadastrado.',
  ].join(' ');
}

function validarGrupoProduto(sql = '', mensagem = '') {
  // Detecta quando a pergunta pede agrupamento por grupo de produto
  // mas o SQL não contém JOIN SBM — a IA agrupou por produto ou gerou escalar.
  const pedidoGrupoProduto = /\bgrupo\s+de\s+produto\w*\b|\blinha\s+de\s+produto\w*\b/i.test(String(mensagem || ''));
  if (!pedidoGrupoProduto) return null;
  const texto = String(sql || '');
  const temSBM = /\bJOIN\s+\w+\s+SBM\b/i.test(texto);
  if (temSBM) return null;
  return [
    'A pergunta pede agrupamento por grupo de produto, mas o SQL nao contem JOIN SBM.',
    'OBRIGATORIO montar a cadeia completa: SD2 -> SB1 -> SBM.',
    'Template de JOIN obrigatorio:',
    "  JOIN SB1<sufixo> SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '",
    "  JOIN SBM<sufixo> SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = ' '",
    'SELECT obrigatorio: SBM.BM_DESC AS grupo_produto',
    'GROUP BY obrigatorio: SBM.BM_GRUPO, SBM.BM_DESC',
  ].join(' ');
}

function validarFiltroProdutoAusente(sql = '', mensagem = '') {
  // Detecta quando a pergunta cita um produto especifico (nome entre parenteses/aspas,
  // ou termo apos "produto"/"item") mas o SQL final nao filtra por SB1.B1_COD ou SB1.B1_DESC.
  // Cobre tanto o caminho por entidade resolvida (B1_COD = codigo) quanto LIKE direto em B1_DESC.
  const texto = String(mensagem || '');
  const citaProdutoEspecifico = /\bproduto\s+["'“”(]|\bitem\s+["'“”(]|\bdo\s+produto\s+\S/i.test(texto)
    || /["'“”]\s*[\wÀ-ÿ0-9 .\-]{2,40}\s*["'”]/i.test(texto)
    || /\([\wÀ-ÿ0-9 .\-]{2,40}\)/i.test(texto);
  if (!citaProdutoEspecifico) return null;
  const sqlTexto = String(sql || '');
  const temJoinSB1 = /\b(?:FROM|JOIN)\s+\w*SB1\w*\s+SB1\b/i.test(sqlTexto);
  const filtraViaSB1 = /\bSB1\s*\.\s*B1_COD\s*(?:=|IN\b)/i.test(sqlTexto)
    || /\bSB1\s*\.\s*B1_DESC\b[\s\S]{0,40}\bLIKE\b/i.test(sqlTexto)
    || /\bUPPER\s*\(\s*SB1\s*\.\s*B1_DESC\s*\)/i.test(sqlTexto);
  // Entidade resolvida tambem pode filtrar direto em SD2.D2_COD, sem precisar de JOIN SB1
  // (o codigo interno ja foi resolvido pelo sistema; JOIN SB1 so e necessario para exibir a descricao).
  const filtraViaSD2Cod = /\bSD2\s*\.\s*D2_COD\s*(?:=|IN\b)/i.test(sqlTexto);
  if ((temJoinSB1 && filtraViaSB1) || filtraViaSD2Cod) return null;
  return [
    'A pergunta parece citar um produto especifico, mas o SQL nao filtra por SB1.B1_COD, SB1.B1_DESC nem SD2.D2_COD.',
    'Se o texto do produto e um nome proprio cadastral, declare-o em entidades_necessarias (tipo "produto") para o sistema resolver o codigo interno e filtrar por SB1.B1_COD.',
    'Nunca gere o SQL final ignorando o produto citado pelo usuario.',
  ].join(' ');
}

function validarAliasSemJoin(sql = '') {
  // Detecta aliases de tabelas dimensionais usados no SELECT ou GROUP BY
  // sem correspondente FROM/JOIN declarado — erro que causa "Invalid object name" ou
  // "column could not be bound" no SQL Server.
  const texto = String(sql || '');
  // Tabelas dimensionais que requerem JOIN explícito para ser usadas
  const dimensionais = [
    { alias: 'SBM', campos: /\bSBM\s*\.\s*BM_\w+/i, joinTemplate: 'JOIN SBM<sufixo> SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = \' \' (requer JOIN SB1 antes)' },
    { alias: 'ACY', campos: /\bACY\s*\.\s*ACY_\w+/i, joinTemplate: 'LEFT JOIN ACY<sufixo> ACY ON ACY.ACY_GRPVEN = SA1.A1_GRPVEN AND ACY.D_E_L_E_T_ = \' \' (requer JOIN SA1 antes)' },
    { alias: 'SA3', campos: /\bSA3\s*\.\s*A3_\w+/i, joinTemplate: 'JOIN SA3<sufixo> SA3 ON SF2.F2_VEND1 = SA3.A3_COD AND SA3.D_E_L_E_T_ = \' \'' },
    { alias: 'CTT', campos: /\bCTT\s*\.\s*CTT_\w+/i, joinTemplate: 'JOIN CTT<sufixo> CTT ON SD2.D2_CCUSTO = CTT.CTT_CUSTO AND CTT.D_E_L_E_T_ = \' \'' },
    { alias: 'SF4', campos: /\bSF4\s*\.\s*F4_\w+/i, joinTemplate: 'JOIN SF4<sufixo> SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = \' \'' },
  ];
  const erros = [];
  for (const { alias, campos, joinTemplate } of dimensionais) {
    if (!campos.test(texto)) continue;
    const reJoin = new RegExp(`\\b(?:FROM|JOIN)\\s+\\w+\\s+${alias}\\b`, 'i');
    if (!reJoin.test(texto)) {
      erros.push(`${alias} usado sem JOIN declarado. Adicione: ${joinTemplate}`);
    }
  }
  if (!erros.length) return null;
  return `Alias de tabela usado sem JOIN correspondente no FROM:\n${erros.join('\n')}`;
}

function validarDeleteFiltros(sql = '') {
  // Verifica tabelas do FROM/JOIN que estejam sem D_E_L_E_T_ filtrado.
  // Aceita o filtro tanto no ON quanto no WHERE — ambos são válidos no SQL Server.
  const texto = String(sql || '');
  const aliases = ['SF2', 'SD2', 'SF1', 'SD1', 'SA1', 'SA3', 'SB1', 'SBM', 'SF4', 'CTT'];
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

function formatarPerguntaAmbiguidade(texto, candidatos = [], contexto = {}) {
  // Vendedor (nao gestor): nunca revela nomes/codigos de outros vendedores nem oferece
  // "Todos" — pede apenas para refinar com nome e sobrenome, sem expor o cadastro.
  if (contexto?.ehVendedorRestrito) {
    return `Encontrei mais de um registro para *${texto}*. Por favor, informe o nome completo (nome e sobrenome) para eu localizar o registro correto.`;
  }
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
    // Sem DISTINCT: mesmo problema de agente-local retornando vazio para DISTINCT+LIKE
    // observado em SA1 (comentario acima). Deduplicamos no Node via deduplicarCandidatos().
    sql = `SET ROWCOUNT 200;\nSELECT SA3.A3_COD AS codigo, NULL AS loja, SA3.A3_NOME AS nome\nFROM ${tabelaSF2} SF2\nINNER JOIN ${tabelaCad} SA3 ON SF2.F2_VEND1 = SA3.A3_COD AND SA3.D_E_L_E_T_ = ' '\nWHERE SF2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SA3', helpers)})\nORDER BY SA3.A3_NOME;`;
  } else if (tipo === 'produto' && tabelaSD2 && tabelaSF2 && tabelaSB1) {
    sql = `SET ROWCOUNT 200;\nSELECT SB1.B1_COD AS codigo, NULL AS loja, SB1.B1_DESC AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaCad} SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SB1', helpers)})\nORDER BY SB1.B1_DESC;`;
  } else if (tipo === 'grupo_produto' && tabelaSD2 && tabelaSF2 && tabelaSB1 && tabelaSBM) {
    sql = `SET ROWCOUNT 200;\nSELECT SBM.BM_GRUPO AS codigo, NULL AS loja, SBM.BM_DESC AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSB1} SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSBM} SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SBM', helpers)})\nORDER BY SBM.BM_DESC;`;
  } else if (tipo === 'centro_custo' && tabelaSD2 && tabelaSF2 && tabelaCTT) {
    sql = `SET ROWCOUNT 200;\nSELECT CTT.CTT_CUSTO AS codigo, NULL AS loja, CTT.CTT_DESC01 AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaCTT} CTT ON SD2.D2_CCUSTO = CTT.CTT_CUSTO AND CTT.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'CTT', helpers)})\nORDER BY CTT.CTT_DESC01;`;
  } else if (tipo === 'tes' && tabelaSD2 && tabelaSF2 && tabelaSF4) {
    sql = `SET ROWCOUNT 200;\nSELECT SF4.F4_CODIGO AS codigo, NULL AS loja, SF4.F4_TEXTO AS nome\nFROM ${tabelaSD2} SD2\nINNER JOIN ${tabelaSF2} SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '\nINNER JOIN ${tabelaSF4} SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' '\nWHERE SD2.D_E_L_E_T_ = ' '\n${periodoWhere}${filialWhere}  AND (${camposLike(def, termoTexto, 'SF4', helpers)})\nORDER BY SF4.F4_TEXTO;`;
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
  contratosTecnicosPrioritarios,
  regrasTecnicas,
  camposPeriodoObrigatorios: ['F2_EMISSAO', 'F1_DTDIGIT', 'F1_EMISSAO'],
  sx3PromptLimit: 90,
  maxTokens: 4600,
  dimensionLeftJoinBases: ['CTT', 'SF4', 'SBM', 'SA3', 'ACY'],
  sanitizarFiltrosFilialSX2: true,
  camposVendedorSeguranca: CAMPOS_VENDEDOR_SEGURANCA,
  camposRateioVendedor: CAMPOS_VENDEDOR_SEGURANCA,
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
      regex: /^(?![\s\S]*\bJOIN\s+\w+\s+SA1\b)[\s\S]*\bSA1\s*\.\s*A1_\w+/i,
      mensagem: 'Campo SA1.A1_* usado sem JOIN SA1 declarado no FROM. Adicione JOIN SA1<sufixo> SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = \' \' antes de usar campos de cliente.',
    },
    {
      regex: /^(?![\s\S]*\bJOIN\s+\w+\s+SB1\b)[\s\S]*\bSB1\s*\.\s*B1_\w+/i,
      mensagem: 'Campo SB1.B1_* usado sem JOIN SB1 declarado no FROM. Adicione JOIN SB1<sufixo> SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = \' \' antes de usar campos de produto.',
    },
    {
      regex: /\bAVG\s*\(\s*SF2\s*\.\s*F2_VALBRUT\s*\)/i,
      mensagem: 'AVG(SF2.F2_VALBRUT) calcula ticket medio por nota fiscal, nao faturamento medio anual. Use subquery de 2 camadas: interna SUM por ano (faturamento_ano), externa AVG dos totais — SELECT COALESCE(AVG(h.faturamento_ano),0) AS faturamento FROM (SELECT SUBSTRING(SF2.F2_EMISSAO,1,4) AS ano, SUM(SF2.F2_VALBRUT) AS faturamento_ano FROM SF2... GROUP BY SUBSTRING(SF2.F2_EMISSAO,1,4)) AS h.',
    },
    {
      regex: /\bAVG\s*\(\s*SD2\s*\.\s*D2_(?:TOTAL|VALBRUT)\s*\)/i,
      mensagem: 'AVG(SD2.D2_TOTAL) calcula media por item/linha, nao faturamento medio por produto. Para faturamento medio por produto, use subquery de 2 camadas: interna SUM(SD2.D2_TOTAL) por produto e competencia; externa AVG(h.faturamento_mes) agrupada por h.cod_produto, h.produto.',
    },
    {
      regex: /\bAVG\s*\(\s*SD2\s*\.\s*D2_PRCVEN\s*\)/i,
      mensagem: "AVG(SD2.D2_PRCVEN) calcula a media aritmetica simples do preco unitario por linha/item, ignorando o volume de cada venda — distorce o resultado quando as quantidades variam entre notas. Preco medio de venda real e o preco medio PONDERADO pela quantidade: SUM(SD2.D2_TOTAL) / NULLIF(SUM(SD2.D2_QUANT), 0). Substitua AVG(SD2.D2_PRCVEN) por essa razao, mantendo o mesmo agrupamento (ex: por mes).",
    },
    {
      validar: validarMediaMensalProduto,
    },
    {
      validar: validarFiltroTipoSF2,
    },
    {
      validar: validarFiltroProdutoAusente,
    },
    {
      validar: validarGrupoCliente,
    },
    {
      // JOIN ACY usando SA1.A1_COD é errado — o campo correto é SA1.A1_GRPVEN
      regex: /\bACY\s*\.\s*ACY_GRPVEN\s*=\s*SA1\s*\.\s*A1_COD\b/i,
      mensagem: "JOIN ACY com campo errado: ACY.ACY_GRPVEN deve ligar com SA1.A1_GRPVEN, nao com SA1.A1_COD. Corrija para: LEFT JOIN ACY<sufixo> ACY ON ACY.ACY_GRPVEN = SA1.A1_GRPVEN AND ACY.D_E_L_E_T_ = ' '",
    },
    {
      validar: validarGrupoProduto,
    },
    {
      validar: validarAliasSemJoin,
    },
    {
      validar: validarDeleteFiltros,
    },
    {
      // Detecta LEFT JOIN SD1 ou LEFT JOIN SF1 fora de subquery UNION ALL (padrão proibido para devoluções).
      // A IA deve usar subquery UNION ALL escalar, nunca LEFT JOIN SD1/SF1 na query principal.
      validar(sql) {
        const semSubqueries = sql.replace(/\(\s*SELECT[\s\S]*?\)\s*(?:AS\s+\w+)?/gi, '(SUBQ)');
        if (/\bLEFT\s+JOIN\s+\w*\s*SD1\b|\bLEFT\s+JOIN\s+\w*\s*SF1\b/i.test(semSubqueries)) {
          return 'PROIBIDO LEFT JOIN SD1 ou SF1 na query principal. Para devolucoes de vendas, use subquery UNION ALL escalar: a query externa agrega SUM(valor_faturamento) e SUM(valor_devolucao) de duas subqueries (SD2/SF2 para faturamento e SD1/SF1 para devolucoes), cada uma sem GROUP BY. Exemplo: SELECT SUM(valor_faturamento) AS total_faturamento, SUM(valor_devolucao) AS total_devolucoes FROM (SELECT COALESCE(SUM(SD2.D2_TOTAL),0) AS valor_faturamento, 0 AS valor_devolucao FROM SD2xxx SD2 JOIN SF2xxx SF2 ON ... WHERE ... AND SF2.F2_TIPO IN (\'N\',\'C\',\'I\') UNION ALL SELECT 0 AS valor_faturamento, COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_devolucao FROM SD1xxx SD1 JOIN SF1xxx SF1 ON ... WHERE ... AND SF1.F1_TIPO = \'D\') AS s;';
        }
        return null;
      },
    },
    {
      // Detecta referência a SD2./SD1./SF2./SF1. na SELECT list da query externa quando há UNION ALL.
      // Erro clássico: SELECT ..., SUM(SD2.D2_QUANT) AS ..., SUM(valor_faturamento) ... FROM (...UNION ALL...) AS s
      // SD2 não existe no escopo externo — só existem os aliases exportados pelo UNION ALL.
      validar(sql) {
        const sqlUpper = sql.toUpperCase();
        if (!sqlUpper.includes('UNION ALL')) return null;
        // Extrai a SELECT list externa (antes do primeiro FROM ... (SELECT...UNION ALL...))
        const matchOuter = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s*\(/i);
        if (!matchOuter) return null;
        const selectList = matchOuter[1];
        if (/\bSD[12]\s*\.\s*D[12]_|\bSF[12]\s*\.\s*F[12]_/i.test(selectList)) {
          return 'ERRO DE ESCOPO: a SELECT list externa referencia SD2.D2_QUANT ou campos de SD2/SD1/SF2/SF1 que nao existem fora da subquery UNION ALL. A query externa so pode referenciar os aliases definidos dentro do UNION ALL (ex: valor_faturamento, quantidade_faturada, valor_devolucao). Corrija projetando COALESCE(SUM(SD2.D2_QUANT),0) AS quantidade_faturada DENTRO da subquery de faturamento e 0 AS quantidade_faturada dentro da subquery de devolucoes. A query externa usa apenas SUM(quantidade_faturada).';
        }
        return null;
      },
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
  prepararIntent,
  resolverVendedorFixoPorEmpresa,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  _test: {
    prepararIntent,
    buscarEntidade,
    resolverEntidades,
  },
};
