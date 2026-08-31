'use strict';

const crud = require('../../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const fragmentosSpec = require('./estoque-fragmentos-spec');
const { classificarFragmentos } = require('./estoque-spec-classifier');
const { resolverVendedorFixoPorEmpresa } = require('../guards/vendedor-seguranca');

const TABELAS = ['SB2', 'SB1', 'SBM', 'SD3'];

const CAMPOS_SX3_ESSENCIAIS = {
  SB2: ['B2_FILIAL', 'B2_COD', 'B2_LOCAL', 'B2_QATU', 'B2_VATU1', 'B2_CM1', 'B2_QEMP', 'B2_RESERVA', 'D_E_L_E_T_'],
  SB1: ['B1_FILIAL', 'B1_COD', 'B1_DESC', 'B1_GRUPO', 'B1_UM', 'B1_TIPO', 'D_E_L_E_T_'],
  SBM: ['BM_FILIAL', 'BM_GRUPO', 'BM_DESC', 'D_E_L_E_T_'],
  SD3: ['D3_FILIAL', 'D3_COD', 'D3_TM', 'D3_QUANT', 'D3_LOCAL', 'D3_DOC', 'D3_EMISSAO', 'D3_CF', 'D3_CUSTO1', 'D3_OP', 'D3_CC', 'D3_ESTORNO', 'D3_LOTECTL', 'D3_NUMSERI', 'D_E_L_E_T_'],
};

function validarDeleteFiltros(sql = '') {
  const texto = String(sql || '');
  const aliases = ['SB2', 'SB1', 'SBM', 'SD3'];
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
    const existe = db.prepare("SELECT id FROM intentions WHERE empresa_id = ? AND nome = 'estoque_dinamico' LIMIT 1").get(empresaId);
    if (existe) return;
    crud.criar('intentions', {
      empresa_id: empresaId,
      nome: 'estoque_dinamico',
      descricao: 'Consultas dinamicas de estoque via IA-OWNER',
      modulo: 'estoque',
      acao: 'ai_text_to_sql',
      dataset_id: null,
      frases_exemplo: [
        'saldo em estoque do produto X',
        'posicao de estoque por armazem',
        'quanto foi requisitado do produto Y',
        'transferencias de estoque do mes',
        'giro de estoque por grupo de produto',
        'curva ABC de produtos',
      ].join('\n'),
      ativo: 1,
    });
    require('../../../ai/intent-service').invalidateCache(empresaId);
  } catch (e) {
    console.warn(`[EstoqueIAOwner] Falha ao garantir intencao para empresa #${empresaId}:`, e.message);
  }
}

function regrasTecnicas({ mensagem } = {}) {
  const chavesAcionadas = classificarFragmentos(mensagem);
  const chaves = chavesAcionadas || fragmentosSpec.ORDEM_FALLBACK;

  const partes = [fragmentosSpec.base()];
  for (const chave of chaves) {
    const fragmento = fragmentosSpec.FRAGMENTOS[chave];
    if (!fragmento) continue;
    partes.push(fragmento.texto());
  }
  return partes.join('\n').trim();
}

// Estoque nao possui campo de vendedor/comprador em nenhuma tabela (SB2, SB1, SD3) — sem
// forma de restringir por escopo, entao o modulo fica bloqueado integralmente para vendedor.
// Gestor e numeros sem erp_tipo continuam com acesso total, sem qualquer alteracao.
function prepararIntent({ intent, empresaId, mensagem }) {
  const remetente = intent._remetente || null;
  if (!remetente) return {};

  const resolucao = resolverVendedorFixoPorEmpresa(remetente, empresaId);

  if (resolucao.estado === 'nao_cadastrado') {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu número não está cadastrado como usuário ou gestor no IA Command. Para acessar dados de estoque, solicite ao gestor do IA Command que configure seu perfil ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em whatsapp_allowed_numbers para empresa_id=${empresaId}`,
      },
    };
  }

  // Bloqueia apenas vendedor DE FATO (codigo preenchido) — 'sem_codigo_vendedor' (usuario
  // sem erp_id, sem outro papel aplicavel a estoque) cai para acesso total, igual sem_restricao.
  if (resolucao.estado === 'vendedor') {
    return {
      retorno: {
        tipo: 'erro',
        subtipo: 'acesso_negado_vendedor',
        resposta_direta: 'O módulo de estoque não está disponível para o perfil de vendedor. Para consultar estoque, peça para um gestor consultar.',
        sql_gerado: `-- bloqueado: modulo estoque nao possui campo de vendedor/comprador\n-- mensagem: ${mensagem}`,
      },
    };
  }

  // gestor ou sem_restricao: acesso total, sem filtro
  return {};
}

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

function erroLookupTransitorio(err) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  return /socket hang up|ECONNRESET|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ECONNABORTED|ECONNREFUSED/i.test(`${msg} ${code}`);
}

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function termoGenericoEstoqueNaoEntidade(texto) {
  const s = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!s) return true;
  if (/^\d+$/.test(s)) return false;
  if (s.length <= 2) return true;
  return /\b(maior(?:es)?|menor(?:es)?|saldo|estoque|posicao|produto(?:s)?|grupo(?:s)?|curva|abc|giro|requisitado|transferencia(?:s)?|armazem|almoxarifado|local)\b/.test(s)
    && !/[a-z0-9]{3,}[-_][a-z0-9]/i.test(s)
    && !/\b(cod(?:igo)?|sku|referencia|ref)\b/i.test(s);
}

async function buscarEntidade({ empresaId, sx2, tipo, termoTexto, filial, helpers }) {
  const def = entityCatalog.DEFINICOES[tipo];
  if (!def) return [];

  const tabelaCad = helpers.tabelaFisicaSX2(sx2, def.tabelaBase);
  const tabelaSB1 = helpers.tabelaFisicaSX2(sx2, 'SB1');
  const tabelaSBM = helpers.tabelaFisicaSX2(sx2, 'SBM');
  if (!tabelaCad) return [];

  let sql = null;
  if (tipo === 'produto') {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SB1.B1_COD AS codigo, NULL AS loja, SB1.B1_DESC AS nome\nFROM ${tabelaCad} SB1\nWHERE SB1.D_E_L_E_T_ = ' '\n  AND (${camposLike(def, termoTexto, 'SB1', helpers)})\nORDER BY SB1.B1_DESC;`;
  } else if (tipo === 'grupo_produto' && tabelaSB1 && tabelaSBM) {
    sql = `SET ROWCOUNT 10;\nSELECT DISTINCT SBM.BM_GRUPO AS codigo, NULL AS loja, SBM.BM_DESC AS nome\nFROM ${tabelaSBM} SBM\nWHERE SBM.D_E_L_E_T_ = ' '\n  AND (${camposLike(def, termoTexto, 'SBM', helpers)})\nORDER BY SBM.BM_DESC;`;
  }

  if (!sql) return [];
  const maxTentativas = 3;
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    let conn = null;
    try {
      conn = helpers.connectionFactory.carregarConexao(empresaId);
      conn._empresa_id = empresaId || '';
      conn._modulo     = 'estoque';
      conn._operacao   = `lookup_${tipo}`;
      conn._pergunta   = termoTexto || '';
      conn._sender     = '';
      const rows = await helpers.connectionFactory.executar(conn, sql, {});
      const candidatos = (rows || []).map(row => normalizarCandidato(def, row)).filter(c => c.codigo);
      if (!candidatos.length) {
        console.warn(`[EstoqueIAOwner] lookup_${tipo}_sem_resultado empresa=${empresaId} termo="${termoTexto || ''}" tentativa=${tentativa}`);
      }
      return candidatos;
    } catch (e) {
      const transitorio = erroLookupTransitorio(e);
      if (transitorio && tentativa < maxTentativas) {
        console.warn(`[EstoqueIAOwner] lookup_${tipo}_socket_retry tentativa=${tentativa}/${maxTentativas} empresa=${empresaId} termo="${termoTexto || ''}" erro=${e.message}`);
        await aguardar(300 * tentativa);
        continue;
      }
      console.warn(`[EstoqueIAOwner] lookup_${tipo}_falha_final tentativa=${tentativa}/${maxTentativas} empresa=${empresaId} termo="${termoTexto || ''}" transitorio=${transitorio ? 'sim' : 'nao'} erro=${e.message}`);
      return [];
    }
  }
  return [];
}

async function resolverEntidades({ pedidos, empresaId, sx2, periodo, filial, helpers }) {
  const resolvidas = [];
  for (const pedido of pedidos || []) {
    const texto = String(pedido.texto || '').trim();
    if (!texto) continue;
    if (termoGenericoEstoqueNaoEntidade(texto)) {
      console.warn(`[EstoqueIAOwner] lookup_ignorado_termo_generico termo="${texto}" origem=${pedido.origem || ''}`);
      continue;
    }
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
  nome: 'estoque',
  handlerName: 'estoque-ia-owner',
  logPrefix: 'EstoqueIAOwner',
  defaultMessage: 'consulta de estoque',
  tabelas: TABELAS,
  entityCatalog,
  resolverEntidadesAntesDaIa: true,
  camposSx3Essenciais: CAMPOS_SX3_ESSENCIAIS,
  sqlMiddleware,
  regrasTecnicas,
  sx3PromptLimit: 70,
  maxTokens: 3500,
  dimensionLeftJoinBases: ['SBM'],
  sanitizarFiltrosFilialSX2: true,
  sqlPatternsProibidos: [
    {
      // SB1 pode ser tabela compartilhada entre filiais (B1_FILIAL sempre em branco) enquanto
      // SB2 (saldo) e sempre por filial. Casar SB2.B2_FILIAL = SB1.B1_FILIAL zera o JOIN nesse
      // cenario. Defesa em profundidade: rejeita mesmo se a IA ignorar a instrucao do prompt.
      regex: /\bSB2\s*\.\s*B2_FILIAL\s*=\s*SB1\s*\.\s*B1_FILIAL\b|\bSB1\s*\.\s*B1_FILIAL\s*=\s*SB2\s*\.\s*B2_FILIAL\b/i,
      mensagem: "JOIN SB2->SB1 nao deve casar por filial (SB2.B2_FILIAL = SB1.B1_FILIAL). SB1 pode ser tabela compartilhada entre filiais nesta empresa, com B1_FILIAL sempre em branco — esse casamento zeraria o resultado. Use apenas: JOIN SB1<sufixo> SB1 ON SB2.B2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '.",
    },
    {
      validar(sql, mensagem) {
        const texto = String(mensagem || '').toLowerCase();
        const pedeSaldo = /\bsaldo\b|\bposi[cç][aã]o\b/.test(texto);
        if (!pedeSaldo) return null;
        const usaSD2 = /\b(?:FROM|JOIN)\s+\w*SD2\w*\s+SD2\b/i.test(sql);
        const usaSD1 = /\b(?:FROM|JOIN)\s+\w*SD1\w*\s+SD1\b/i.test(sql);
        if (!usaSD2 && !usaSD1) return null;
        return 'A pergunta pede saldo/posicao de estoque, mas o SQL usa SD1 ou SD2 (tabelas de movimentacao de nota fiscal). Saldo/posicao atual e SEMPRE SB2.B2_QATU — nunca derive de SD1 (entrada) ou SD2 (saida).';
      },
    },
    {
      validar(sql, mensagem) {
        const texto = String(mensagem || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
        const perguntaPedeSaldoEstoque = /\bsaldo\b|\bposicao\b|\bestoque\b/.test(texto);
        const pedeFisico = /\bfisic[ao]s?\b|\bquantidade\b|\bqtd\b|\bqtde\b/.test(texto);
        const pedeFinanceiro = /\bfinanceir[ao]s?\b|\bvalor\b|\bvalorizad[ao]s?\b/.test(texto);
        if (!perguntaPedeSaldoEstoque || !pedeFisico || !pedeFinanceiro) return null;

        const sqlTexto = String(sql || '');
        const temSaldoFisico = /\bSB2\s*\.\s*B2_QATU\b/i.test(sqlTexto) || /\bAS\s+saldo_fisico\b/i.test(sqlTexto);
        const temSaldoFinanceiro = /\bSB2\s*\.\s*B2_VATU1\b/i.test(sqlTexto) || /\bSB2\s*\.\s*B2_CM1\b/i.test(sqlTexto) || /\bAS\s+saldo_financeiro\b/i.test(sqlTexto);
        if (temSaldoFisico && temSaldoFinanceiro) return null;

        return 'A pergunta pede saldo fisico E financeiro de estoque, mas o SQL nao retornou as duas metricas separadas. Use SUM(SB2.B2_QATU) AS saldo_fisico e SUM(SB2.B2_VATU1) AS saldo_financeiro (ou B2_QATU * B2_CM1 apenas se B2_VATU1 nao existir no SX3). Nunca apresente B2_QATU como valor financeiro.';
      },
    },
    {
      validar: validarDeleteFiltros,
    },
  ],
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta de estoque no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta de estoque. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei dados de estoque para essa consulta.',
    erro_erp: 'Nao consegui buscar os dados de estoque no ERP. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao: 'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  },
  garantirIntencao,
  prepararIntent,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  _test: {
    prepararIntent,
    buscarEntidade,
    resolverEntidades,
    erroLookupTransitorio,
    termoGenericoEstoqueNaoEntidade,
  },
};
