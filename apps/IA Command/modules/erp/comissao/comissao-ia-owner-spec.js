'use strict';

const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const fragmentosSpec = require('./comissao-fragmentos-spec');
const { classificarFragmentos } = require('./comissao-spec-classifier');
const { resolverIdentidadeVendedor, resolverVendedorFixoPorEmpresa } = require('../vendedor-seguranca');

// SX3 real confirmado (protheus_sx3): a tabela SE3 desta base so possui E3_VEND.
// E3_VENDED nao existe no dicionario de dados e foi removido para nao mascarar
// silenciosamente uma referencia a campo inexistente nos guards de seguranca.
const CAMPOS_VENDEDOR_SEGURANCA = ['E3_VEND'];

const TABELAS = ['SE3', 'SA3', 'SA1', 'SE2', 'SE5'];

const CAMPOS_SX3_ESSENCIAIS = {
  SE3: ['E3_FILIAL', 'E3_VEND', 'E3_CODCLI', 'E3_LOJA', 'E3_NUM', 'E3_PARCELA', 'E3_SERIE', 'E3_VENCTO', 'E3_DATA', 'E3_STATUS', 'E3_COMIS', 'E3_VALOR', 'E3_BASE', 'E3_PERCCOM', 'D_E_L_E_T_'],
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

function prepararIntent({ intent, empresaId, mensagem }) {
  const remetente = intent._remetente || null;
  if (!remetente) return {};

  const resolucao = resolverVendedorFixoPorEmpresa(remetente, empresaId);

  if (resolucao.estado === 'nao_cadastrado') {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu número não está cadastrado como vendedor ou gestor no IA Command. Para acessar dados de comissão, solicite ao gestor do IA Command que configure seu perfil ERP.',
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
    // (para parametrização do SQL canônico — substituída por empresa no reuso multiempresa).
    return {
      contextoTecnicoExtra: {
        vendedorFixo: { codigo: resolucao.codigo, nome: resolucao.nome },
        regraVendedorFixo: 'Aplique obrigatoriamente filtro do vendedorFixo em SE3.E3_VEND. Nao retorne dados de outros vendedores.',
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

function regrasTecnicas({ mensagem } = {}) {
  const chavesAcionadas = classificarFragmentos(mensagem);
  const chaves = chavesAcionadas || fragmentosSpec.ORDEM_FALLBACK;

  const partes = [fragmentosSpec.base()];
  for (const chave of chaves) {
    const fragmento = fragmentosSpec.FRAGMENTOS[chave];
    if (fragmento) partes.push(fragmento.texto());
  }
  return partes.join('\n').trim();
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
  camposVendedorSeguranca: CAMPOS_VENDEDOR_SEGURANCA,
  sqlPatternsProibidos: [
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
        const temAvgDireto = /\bAVG\s*\(\s*SE3\s*\.\s*E3_COMIS\s*\)|\bAVG\s*\(\s*SE3\s*\.\s*E3_BASE\s*\)/i.test(sql);
        if (!temAvgDireto) return null;
        const temGroupBy = /\bGROUP\s+BY\b/i.test(sql);
        if (!temGroupBy) return null;
        return (
          'AVG(SE3.E3_COMIS) ou AVG(SE3.E3_BASE) com GROUP BY na mesma camada calcula o ticket medio por lancamento dentro de cada periodo, NAO a media do total entre os periodos. ' +
          'Monte a estrutura de duas camadas: subquery interna agrupada por periodo com SUM() (nao AVG), e query externa com AVG(h.<coluna_soma>) sobre os totais da subquery.'
        );
      },
    },
    {
      regex: /\bAVG\s*\(\s*SUM\s*\(/i,
      mensagem: 'AVG(SUM(...)) na mesma camada e sintaxe invalida no SQL Server. SUM() deve estar na subquery interna; AVG() deve estar na query externa, em FROM (subquery) AS h.',
    },
  ],
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta de comissoes no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta de comissoes. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei comissoes para essa consulta.',
    erro_erp: 'Nao consegui buscar as comissoes no ERP. Tente novamente.',
    sem_conexao: 'Nao consegui conectar ao ERP para consultar as comissoes.',
  },
  garantirIntencao,
  prepararIntent,
  resolverVendedorFixoPorEmpresa,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  _test: {
    resolverIdentidadeVendedor,
    resolverVendedorFixoPorEmpresa,
    buscarEntidade,
    resolverEntidades,
  },
};
