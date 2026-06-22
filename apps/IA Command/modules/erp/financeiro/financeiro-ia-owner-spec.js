'use strict';

const crud = require('../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const { removerFiltrosEmpresaComoEntidade } = require('../empresa-scope-sql-guard');
const fragmentosSpec = require('./financeiro-fragmentos-spec');
const { classificarFragmentos } = require('./financeiro-spec-classifier');

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

function regrasTecnicas({ modeloBaixasReceber, modeloBaixasPagar, mensagem } = {}) {
  const usaFK1 = modeloBaixasReceber === 'FK1';
  const usaFK2 = modeloBaixasPagar === 'FK2';
  const ctx = { usaFK1, usaFK2 };

  const chavesAcionadas = classificarFragmentos(mensagem);
  // null = pergunta nao classificada em nenhuma sub-operacao -> injeta TODOS os
  // fragmentos (fallback idempotente ao comportamento anterior a fragmentacao).
  const chaves = chavesAcionadas || fragmentosSpec.ORDEM_FALLBACK;

  const partes = [fragmentosSpec.base(ctx)];
  for (const chave of chaves) {
    const fragmento = fragmentosSpec.FRAGMENTOS[chave];
    if (fragmento) partes.push(fragmento.texto(ctx));
  }
  return partes.join('\n').trim();
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
