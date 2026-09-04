'use strict';

const crud = require('../../../database/crud');
const sqlMiddleware = require('./sql-middleware');
const entityCatalog = require('./entity-catalog');
const { removerFiltrosEmpresaComoEntidade } = require('../guards/empresa-scope-sql-guard');
const fragmentosSpec = require('./financeiro-fragmentos-spec');
const { classificarFragmentos } = require('./financeiro-spec-classifier');
const { resolverVendedorFixoPorEmpresa } = require('../guards/vendedor-seguranca');
const { resolverClienteFixoPorEmpresa } = require('../guards/cliente-seguranca');

// SE1 (contas a receber) permite rateio entre ate 5 vendedores (E1_VEND1..E1_VEND5).
const CAMPOS_VENDEDOR_SEGURANCA = ['E1_VEND1', 'E1_VEND2', 'E1_VEND3', 'E1_VEND4', 'E1_VEND5'];
// SE1 nao tem rateio de cliente — um titulo pertence a um unico cliente.
const CAMPOS_CLIENTE_SEGURANCA = ['E1_CLIENTE'];

const TABELAS = ['SE1', 'SE2', 'SE5', 'SE8', 'SA1', 'SA2', 'SA3', 'SA6', 'SED', 'FK1', 'FK2', 'FK7'];

const CAMPOS_SX3_ESSENCIAIS = {
  SE1: ['E1_FILIAL', 'E1_PREFIXO', 'E1_NUM', 'E1_PARCELA', 'E1_TIPO', 'E1_CLIENTE', 'E1_LOJA', 'E1_EMISSAO', 'E1_VENCTO', 'E1_VENCREA', 'E1_VALOR', 'E1_SALDO', 'E1_NATUREZ', 'E1_SITUACA', 'E1_VEND1', 'E1_VEND2', 'E1_VEND3', 'E1_VEND4', 'E1_VEND5', 'E1_VALCOM1', 'D_E_L_E_T_'],
  SE2: ['E2_FILIAL', 'E2_PREFIXO', 'E2_NUM', 'E2_PARCELA', 'E2_TIPO', 'E2_FORNECE', 'E2_LOJA', 'E2_EMISSAO', 'E2_VENCTO', 'E2_VENCREA', 'E2_VALOR', 'E2_SALDO', 'E2_NATUREZ', 'E2_SITUACA', 'D_E_L_E_T_'],
  SE5: ['E5_FILIAL', 'E5_PREFIXO', 'E5_NUM', 'E5_PARCELA', 'E5_TIPO', 'E5_DATA', 'E5_VALOR', 'E5_CLIFOR', 'E5_LOJA', 'E5_SITUACA', 'E5_TIPODOC', 'E5_NATUREZ', 'D_E_L_E_T_'],
  SE8: ['E8_FILIAL', 'E8_BANCO', 'E8_AGENCIA', 'E8_CONTA', 'E8_DTSALAT', 'E8_SALATUA', 'D_E_L_E_T_'],
  SA1: ['A1_FILIAL', 'A1_COD', 'A1_LOJA', 'A1_NOME', 'A1_NREDUZ', 'A1_CGC', 'D_E_L_E_T_'],
  SA2: ['A2_FILIAL', 'A2_COD', 'A2_LOJA', 'A2_NOME', 'A2_NREDUZ', 'A2_CGC', 'D_E_L_E_T_'],
  SA3: ['A3_FILIAL', 'A3_COD', 'A3_NOME', 'D_E_L_E_T_'],
  SA6: ['A6_FILIAL', 'A6_COD', 'A6_AGENCIA', 'A6_NUMCON', 'A6_NOME', 'A6_NREDUZ', 'A6_BLOCKED', 'D_E_L_E_T_'],
  SED: ['ED_FILIAL', 'ED_CODIGO', 'ED_DESCRIC', 'D_E_L_E_T_'],
  FK1: ['FK1_FILIAL', 'FK1_PREFIXO', 'FK1_NUM', 'FK1_PARCELA', 'FK1_TIPO', 'FK1_DATA', 'FK1_VALOR', 'FK1_IDDOC', 'D_E_L_E_T_'],
  FK2: ['FK2_FILIAL', 'FK2_PREFIXO', 'FK2_NUM', 'FK2_PARCELA', 'FK2_TIPO', 'FK2_DATA', 'FK2_VALOR', 'FK2_IDDOC', 'D_E_L_E_T_'],
  FK7: ['FK7_FILIAL', 'FK7_PREFIX', 'FK7_NUM', 'FK7_PARCEL', 'FK7_TIPO', 'FK7_CLIFOR', 'FK7_LOJA', 'FK7_IDDOC', 'D_E_L_E_T_'],
};

function garantirIntencao(empresaId) {
  try {
    const { getDB } = require('../../../database');
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
    require('../../../ai/intent-service').invalidateCache(empresaId);
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

function formatarPerguntaAmbiguidade(texto, candidatos = [], contexto = {}) {
  // Vendedor (nao gestor): nunca revela nomes/codigos de outros vendedores nem oferece
  // "Todos" — pede apenas para refinar com nome e sobrenome, sem expor o cadastro.
  if (contexto?.ehVendedorRestrito) {
    return `Encontrei mais de um registro para *${texto}*. Por favor, informe o nome completo (nome e sobrenome) para eu localizar o registro correto.`;
  }
  const linhas = candidatos.map((c, i) => {
    const tipo = c.rotuloTipo || c.tipo;
    return `${i + 1}. *${c.nome}* (${tipo}: ${c.codigo}${c.loja ? `/${c.loja}` : ''})`;
  });
  linhas.push(`${candidatos.length + 1}. *Todos*`);
  return `Encontrei mais de um registro para *${texto}*:\n\n${linhas.join('\n')}\n\nQual deles voce quer consultar? Responda com o numero.`;
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
        resposta_direta: 'Seu número não está cadastrado como usuário ou gestor no IA Command. Para acessar dados financeiros, solicite ao gestor do IA Command que configure seu perfil ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em whatsapp_allowed_numbers para empresa_id=${empresaId}`,
      },
    };
  }

  // Nota: 'sem_codigo_vendedor' (erp_tipo='usuario' sem erp_id) NAO bloqueia aqui —
  // o numero pode ser um usuario que so tem codigo de cliente/aprovador. O fluxo cai
  // direto para a checagem de cliente logo abaixo.

  if (resolucao.estado === 'vendedor') {
    // Injeta vendedorFixo no contexto da IA (para o prompt) E como entidade de segurança.
    // SE1 (contas a receber) permite rateio ate 5 vendedores. SE2 (contas a pagar) nao tem
    // campo de vendedor — fica bloqueado integralmente (ver tabelasBloqueadasParaVendedor).
    return {
      contextoTecnicoExtra: {
        vendedorFixo: { codigo: resolucao.codigo, nome: resolucao.nome },
        regraVendedorFixo: 'Aplique OBRIGATORIAMENTE o filtro do vendedorFixo cobrindo TODAS as 5 posicoes de rateio, sempre, em toda query de SE1, mesmo que o titulo pareca ter um so vendedor: AND (SE1.E1_VEND1 = \'<codigo>\' OR SE1.E1_VEND2 = \'<codigo>\' OR SE1.E1_VEND3 = \'<codigo>\' OR SE1.E1_VEND4 = \'<codigo>\' OR SE1.E1_VEND5 = \'<codigo>\'). Nunca filtre apenas E1_VEND1 sozinho — titulos rateados podem ter o vendedor autorizado em qualquer uma das 5 posicoes, e omitir as demais esconde titulos legitimos do proprio vendedor. Nunca use SE2 (contas a pagar) para este perfil — SE2 nao possui campo de vendedor e e proibido para vendedor. Nao retorne dados de outros vendedores.',
      },
      entidadeSeguranca: {
        tipo: 'vendedor_fixo_seguranca',
        codigo: resolucao.codigo,
        nome: resolucao.nome,
      },
    };
  }

  if (resolucao.estado === 'gestor') return {}; // gestor: acesso total, sem checar cliente

  // sem_restricao (numero cadastrado sem erp_tipo/erp_id): pode ainda assim ser um cliente
  // com cod_cliente_erp cadastrado — campo independente de erp_tipo, mesmo padrao do
  // aprovador em compras. Diferente de aprovador, o filtro de cliente e sempre obrigatorio
  // quando presente (nunca condicional a intencao), por tratar de dado financeiro sensivel.
  const resolucaoCliente = resolverClienteFixoPorEmpresa(remetente, empresaId);
  if (resolucaoCliente.estado === 'cliente') {
    return {
      contextoTecnicoExtra: {
        clienteFixo: { codigo: resolucaoCliente.codigo, nome: resolucaoCliente.nome },
        regraClienteFixo: 'Aplique OBRIGATORIAMENTE AND SE1.E1_CLIENTE = \'<codigo>\' em toda query de SE1. Nunca use SE2 (contas a pagar) para este perfil — cliente so acessa contas a receber, nunca contas a pagar de fornecedor. Nao retorne dados de outros clientes.',
      },
      entidadeSeguranca: {
        tipo: 'cliente_fixo_seguranca',
        codigo: resolucaoCliente.codigo,
        nome: resolucaoCliente.nome,
      },
    };
  }

  // sem vendedor nem cliente cadastrado: acesso total, sem filtro (comportamento historico)
  return {};
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
  const usaFK7Receber = modeloBaixasReceber === 'FK7_FK1';
  const usaFK7Pagar  = modeloBaixasPagar  === 'FK7_FK2';
  const usaFK1 = usaFK7Receber || modeloBaixasReceber === 'FK1';
  const usaFK2 = usaFK7Pagar  || modeloBaixasPagar  === 'FK2';
  const usaFK7 = usaFK7Receber || usaFK7Pagar;
  const ctx = { usaFK1, usaFK2, usaFK7, usaFK7Receber, usaFK7Pagar };

  const chavesAcionadas = classificarFragmentos(mensagem);
  // null = pergunta nao classificada em nenhuma sub-operacao -> injeta TODOS os
  // fragmentos (fallback idempotente ao comportamento anterior a fragmentacao).
  const chaves = chavesAcionadas || fragmentosSpec.ORDEM_FALLBACK;

  const partes = [
    [
      '## Continuidade e Periodo no Financeiro',
      '- Em perguntas de continuidade, o periodo herdado pelo contrato/query_plan e autoritativo. Preserve exatamente dataInicio/dataFim no SQL.',
      '- "Agora detalhe por cliente", "por fornecedor", "por titulo" ou "somente vencidos" sao refinamentos da consulta anterior; nao removem o periodo anterior.',
      '- "Vencido" em continuidade significa adicionar a condicao de vencimento/estado dentro do mesmo periodo herdado, nao consultar tudo que venceu ate hoje.',
      "- Faixa de atraso em dias deve ser calculada com DATEDIFF(DAY, CONVERT(DATE, SE1.E1_VENCREA, 112), data_atual) para receber, ou SE2.E2_VENCREA para pagar. PROIBIDO comparar E1_VENCREA/E2_VENCREA diretamente com numero de dias, como E1_VENCREA > '60'.",
      '- Se o contrato trouxer periodo 20250601 a 20250630, o SQL deve conter esse intervalo ou competencia 202506. PROIBIDO trocar para 202607, para data_atual ou para intervalo aberto.',
      '- Nao mantenha filtros temporais antigos ou inferidos junto do periodo do contrato. Exemplo proibido: SUBSTRING(campo,1,6)=202307 e BETWEEN 20250701..20250731 no mesmo campo.',
      '- Para contas a receber vencidas por cliente dentro de um periodo, use SE1 + SA1, preserve o filtro temporal do periodo em E1_VENCREA e aplique o criterio de vencido/saldo conforme a pergunta.',
    ].join('\n'),
    fragmentosSpec.base(ctx),
  ];
  for (const chave of chaves) {
    const fragmento = fragmentosSpec.FRAGMENTOS[chave];
    if (fragmento) partes.push(fragmento.texto(ctx));
  }
  return partes.join('\n').trim();
}

const sqlPatternsProibidos = [
  {
    regex: /\bFULL\s+(?:OUTER\s+)?JOIN\b/i,
    mensagem: 'FULL OUTER JOIN nao e suportado neste ambiente. Para combinar datas de receber e pagar que podem nao coincidir, use uma CTE "datas" com UNION das datas distintas de cada lado, e LEFT JOIN dessa CTE para as subqueries de receber e pagar — nunca JOIN direto entre as duas subqueries.',
  },
  {
    regex: /\bSE8\b(?=[\s\S]*?\bJOIN\s+\w+\s+SA6\b)(?![\s\S]*?\bE8_AGENCIA\s*=\s*SA6\.A6_AGENCIA\b)/i,
    mensagem: 'JOIN SE8→SA6 incompleto: falta E8_AGENCIA = SA6.A6_AGENCIA AND SE8.E8_CONTA = SA6.A6_NUMCON na condicao ON. Sem esses campos, o banco retorna zero linhas ou duplicidade por agencia.',
  },
  {
    // Bug real confirmado em producao: a IA gera JOIN SE1<->SE5 ou SE2<->SE5 sem a
    // condicao E5_NUMERO = E1_NUM (ou E2_NUM) no ON. Sem essa chave, a baixa (SE5)
    // casa com QUALQUER titulo do mesmo cliente/prefixo/tipo/parcela — nao apenas o
    // titulo correto — inflando o valor somado por ordens de grandeza quando o
    // cliente/fornecedor tem multiplos titulos com o mesmo prefixo/tipo.
    validar(sql) {
      const erros = [];
      const usaSE1SE5 = /\bJOIN\s+\w*SE5\w*\s+SE5\b/i.test(sql) && /\bSE5\s*\.\s*E5_CLIFOR\s*=\s*SE1\s*\.\s*E1_CLIENTE\b/i.test(sql);
      if (usaSE1SE5 && !/\bSE5\s*\.\s*E5_NUMERO\s*=\s*SE1\s*\.\s*E1_NUM\b/i.test(sql)) {
        erros.push(
          'JOIN SE1->SE5 incompleto: falta SE5.E5_NUMERO = SE1.E1_NUM na condicao ON. ' +
          'Sem esse campo, a baixa (SE5) casa com QUALQUER titulo do mesmo cliente/prefixo/tipo/parcela, nao apenas o titulo correto, inflando o valor somado. ' +
          'O ON do JOIN SE5 DEVE conter: E5_FILIAL=E1_FILIAL, E5_PREFIXO=E1_PREFIXO, E5_NUMERO=E1_NUM, E5_PARCELA=E1_PARCELA, E5_TIPO=E1_TIPO, E5_CLIFOR=E1_CLIENTE, E5_LOJA=E1_LOJA, E5_RECPAG=\'R\', D_E_L_E_T_=\' \'.'
        );
      }
      const usaSE2SE5 = /\bJOIN\s+\w*SE5\w*\s+SE5\b/i.test(sql) && /\bSE5\s*\.\s*E5_CLIFOR\s*=\s*SE2\s*\.\s*E2_FORNECE\b/i.test(sql);
      if (usaSE2SE5 && !/\bSE5\s*\.\s*E5_NUMERO\s*=\s*SE2\s*\.\s*E2_NUM\b/i.test(sql)) {
        erros.push(
          'JOIN SE2->SE5 incompleto: falta SE5.E5_NUMERO = SE2.E2_NUM na condicao ON. ' +
          'Sem esse campo, a baixa (SE5) casa com QUALQUER titulo do mesmo fornecedor/prefixo/tipo/parcela, nao apenas o titulo correto, inflando o valor somado. ' +
          'O ON do JOIN SE5 DEVE conter: E5_FILIAL=E2_FILIAL, E5_PREFIXO=E2_PREFIXO, E5_NUMERO=E2_NUM, E5_PARCELA=E2_PARCELA, E5_TIPO=E2_TIPO, E5_CLIFOR=E2_FORNECE, E5_LOJA=E2_LOJA, E5_RECPAG=\'P\', D_E_L_E_T_=\' \'.'
        );
      }
      return erros.length ? erros.join(' ') : null;
    },
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
  {
    // Bug confirmado em producao: IA gera JOIN FK2/FK1 incompleto (sem campos de chave ou sem FK7).
    // Detecta o modelo pelo que esta presente no SQL e valida a estrutura correta para cada caso.
    validar(sql) {
      const temFK7  = /\bJOIN\s+FK7/i.test(sql);
      const temFK2  = /\bJOIN\s+FK2/i.test(sql);
      const temFK1  = /\bJOIN\s+FK1/i.test(sql);

      // Modelo FK7 (cadeia tripla): SE2->FK7->FK2 ou SE1->FK7->FK1
      if (temFK7) {
        // FK7 deve ter os campos de chave do titulo
        const camposFK7 = ['FK7_PREFIX', 'FK7_NUM', 'FK7_PARCEL', 'FK7_TIPO', 'FK7_CLIFOR', 'FK7_LOJA'];
        const faltandoFK7 = camposFK7.filter(c => !new RegExp(`\\b${c}\\b`, 'i').test(sql));
        if (faltandoFK7.length) {
          return (
            `JOIN FK7 incompleto: faltam os campos de chave ${faltandoFK7.join(', ')} no ON. ` +
            `FK7 liga o titulo (SE1/SE2) ao documento de baixa via FK7_IDDOC. ` +
            `O ON do JOIN FK7 DEVE conter: FK7_FILIAL, FK7_PREFIX, FK7_NUM, FK7_PARCEL, FK7_TIPO, FK7_CLIFOR, FK7_LOJA, D_E_L_E_T_. ` +
            `Corrija e regere o SQL.`
          );
        }
        // FK2/FK1 deve ligar via IDDOC, nao por campos diretos do titulo
        for (const tab of ['FK2', 'FK1']) {
          if (!new RegExp(`\\bJOIN\\s+${tab}`, 'i').test(sql)) continue;
          if (!/\bFK[12]_IDDOC\b/i.test(sql)) {
            return (
              `Modelo FK7 detectado mas JOIN ${tab} nao usa ${tab}_IDDOC = FK7.FK7_IDDOC. ` +
              `Neste tenant a ligacao entre FK7 e ${tab} e feita por ${tab}.${tab}_IDDOC = FK7.FK7_IDDOC — nao pelos campos de titulo. ` +
              `Corrija o ON do JOIN ${tab} e regere o SQL.`
            );
          }
        }
        return null;
      }

      // Modelo FK direto (sem FK7): SE2->FK2 ou SE1->FK1 com campos de chave completos
      for (const { tab, prefixo } of [
        { tab: 'FK2', prefixo: 'E2' },
        { tab: 'FK1', prefixo: 'E1' },
      ]) {
        if (!new RegExp(`\\bJOIN\\s+${tab}`, 'i').test(sql)) continue;
        const campos = [`${tab}_PREFIXO`, `${tab}_NUM`, `${tab}_PARCELA`, `${tab}_TIPO`];
        const faltando = campos.filter(c => !new RegExp(`\\b${c}\\b`, 'i').test(sql));
        if (faltando.length) {
          const se = tab === 'FK2' ? 'SE2' : 'SE1';
          return (
            `JOIN ${tab} incompleto: faltam os campos de chave ${faltando.join(', ')} no ON. ` +
            `JOIN com apenas ${tab}_FILIAL gera produto cartesiano — cada titulo ${se} cruza com TODOS os registros de ${tab} da filial, somando valores incorretos. ` +
            `O ON DEVE conter: ${tab}.${tab}_FILIAL=${se}.${prefixo}_FILIAL, ${tab}.${tab}_PREFIXO=${se}.${prefixo}_PREFIXO, ` +
            `${tab}.${tab}_NUM=${se}.${prefixo}_NUM, ${tab}.${tab}_PARCELA=${se}.${prefixo}_PARCELA, ` +
            `${tab}.${tab}_TIPO=${se}.${prefixo}_TIPO, ${tab}.D_E_L_E_T_=' '. Corrija e regere o SQL.`
          );
        }
      }
      return null;
    },
  },
  {
    validar(sql) {
      const comparacaoDataComDias = /\bSE[12]\s*\.\s*E[12]_VENCREA\s*(?:=|<>|!=|<|>|<=|>=)\s*'?\d{1,3}'?\b/i;
      const betweenDias = /\bSE[12]\s*\.\s*E[12]_VENCREA\s+BETWEEN\s+'?\d{1,3}'?\s+AND\s+'?\d{1,3}'?\b/i;
      if (!comparacaoDataComDias.test(sql) && !betweenDias.test(sql)) return null;
      return (
        'Campo de vencimento real foi comparado com quantidade de dias. ' +
        'E1_VENCREA/E2_VENCREA sao datas YYYYMMDD, nao numero de dias. ' +
        'Para faixa de atraso, calcule dias_atraso com DATEDIFF(DAY, CONVERT(DATE, SE1.E1_VENCREA, 112), data_atual) ' +
        'ou DATEDIFF(DAY, CONVERT(DATE, SE2.E2_VENCREA, 112), data_atual), e filtre o resultado calculado.'
      );
    },
  },
  {
    // Bug real confirmado em producao (2026-08-09): pergunta pede "pagamentos antecipados"
    // (PA) ou "recebimentos antecipados" (RA) explicitamente, mas a IA mantem o operador
    // padrao de exclusao (E2_TIPO <> 'PA' / E1_TIPO <> 'RA') em vez de inverter para '='
    // e ISOLAR os antecipados — resposta fica o oposto exato do que foi pedido.
    validar(sql, mensagem) {
      const texto = String(mensagem || '');
      const pedeAntecipadoPagar = /\b(pagamentos?\s+antecipados?|adiantament\w*\s+(a\s+)?fornece\w*)\b/i.test(texto) || (/\bPA\b/.test(texto) && /\bpagar\b|\bpagament\w*/i.test(texto));
      const pedeAntecipadoReceber = /\b(recebimentos?\s+antecipados?|adiantament\w*\s+(de\s+)?client\w*)\b/i.test(texto) || (/\bRA\b/.test(texto) && /\breceber\b|\brecebiment\w*/i.test(texto));

      const excluiPagar = /E2_TIPO\s*<>\s*'PA'/i.test(sql) || /E2_TIPO\s+NOT\s+IN\s*\(\s*'PA'\s*\)/i.test(sql);
      if (pedeAntecipadoPagar && /\bFROM\s+SE2/i.test(sql) && excluiPagar) {
        return (
          'A pergunta pede pagamentos antecipados (PA), mas o SQL usa SE2.E2_TIPO <> \'PA\' ou NOT IN (\'PA\'), que EXCLUI os antecipados — o oposto do pedido. ' +
          'Troque para SE2.E2_TIPO = \'PA\' para ISOLAR apenas os titulos antecipados. Corrija e regere o SQL.'
        );
      }
      const excluiReceber = /E1_TIPO\s*<>\s*'RA'/i.test(sql) || /E1_TIPO\s+NOT\s+IN\s*\(\s*'RA'\s*\)/i.test(sql);
      if (pedeAntecipadoReceber && /\bFROM\s+SE1/i.test(sql) && excluiReceber) {
        return (
          'A pergunta pede recebimentos antecipados (RA), mas o SQL usa SE1.E1_TIPO <> \'RA\' ou NOT IN (\'RA\'), que EXCLUI os antecipados — o oposto do pedido. ' +
          'Troque para SE1.E1_TIPO = \'RA\' para ISOLAR apenas os titulos antecipados. Corrija e regere o SQL.'
        );
      }
      return null;
    },
  },
  {
    // Bug real confirmado em producao: consulta de titulos em ABERTO (filtra E2_SALDO > 0
    // ou E1_SALDO > 0) mas exibe/soma E2_VALOR/E1_VALOR (valor ORIGINAL do titulo na
    // emissao) em vez de E2_SALDO/E1_SALDO (o que efetivamente resta pagar/receber apos
    // baixas parciais). Em titulo com baixa parcial isso mostra um valor maior do que o
    // saldo real — informacao financeira incorreta entregue ao usuario.
    validar(sql) {
      const usaSaldoAbertoPagar = /\bSE2\s*\.\s*E2_SALDO\s*>\s*0\b/i.test(sql);
      const usaValorOriginalPagar = /\bSE2\s*\.\s*E2_VALOR\b/i.test(sql);
      if (usaSaldoAbertoPagar && usaValorOriginalPagar) {
        return (
          'Consulta filtra titulos em aberto por SE2.E2_SALDO > 0, mas usa SE2.E2_VALOR (valor ORIGINAL do titulo na emissao) no SELECT/SUM. ' +
          'Titulos com baixa parcial tem E2_VALOR maior que o saldo real. Troque toda referencia a SE2.E2_VALOR por SE2.E2_SALDO — o valor do titulo em aberto e sempre o saldo, nunca o valor original.'
        );
      }
      const usaSaldoAbertoReceber = /\bSE1\s*\.\s*E1_SALDO\s*>\s*0\b/i.test(sql);
      const usaValorOriginalReceber = /\bSE1\s*\.\s*E1_VALOR\b/i.test(sql);
      if (usaSaldoAbertoReceber && usaValorOriginalReceber) {
        return (
          'Consulta filtra titulos em aberto por SE1.E1_SALDO > 0, mas usa SE1.E1_VALOR (valor ORIGINAL do titulo na emissao) no SELECT/SUM. ' +
          'Titulos com baixa parcial tem E1_VALOR maior que o saldo real. Troque toda referencia a SE1.E1_VALOR por SE1.E1_SALDO — o valor do titulo em aberto e sempre o saldo, nunca o valor original.'
        );
      }
      return null;
    },
  },
  {
    // Bug real confirmado em producao (mesma familia do bug de PA/RA acima): consulta de
    // titulos em ABERTO (E2_SALDO > 0 / E1_SALDO > 0) sem excluir NDF/NCC, que sao
    // movimentos de compensacao e distorcem o saldo real quando misturados — mesma logica
    // ja aplicada a PA/RA. So nao exige a exclusao quando o usuario pediu NDF/NCC/nota de
    // debito/nota de credito explicitamente (nesse caso o SQL deve ISOLAR, nao excluir).
    validar(sql, mensagem) {
      const texto = String(mensagem || '');
      const pedeNdfExplicito = /\bNDF\b/i.test(texto) || /\bnotas?\s+de\s+d[ée]bito\b/i.test(texto);
      const pedeNccExplicito = /\bNCC\b/i.test(texto) || /\bnotas?\s+de\s+cr[ée]dito\b/i.test(texto);

      // Bug real confirmado em producao: a IA, ao tentar corrigir o erro de "falta filtro
      // de E1_TIPO/E2_TIPO" (guard abaixo), confundiu com o campo textualmente parecido
      // E1_NATUREZ/E2_NATUREZ (natureza financeira/categoria contabil — campo totalmente
      // diferente, sem os valores 'RA'/'NCC'/'PA'/'NDF'). Detecta esse erro especifico
      // ANTES do guard generico de ausencia, para dar um erro que aponte exatamente a
      // troca de campo em vez de repetir a mensagem generica (que a IA ja violou uma vez).
      const usaNaturezComoTipoPagar = /\bSE2\s*\.\s*E2_NATUREZ\s*(?:NOT\s+IN|IN|=|<>)\s*\(?\s*'(?:PA|NDF)'/i.test(sql);
      if (usaNaturezComoTipoPagar) {
        return (
          'SQL usa SE2.E2_NATUREZ com os valores \'PA\'/\'NDF\' — campo ERRADO. ' +
          'SE2.E2_NATUREZ e a natureza financeira/categoria contabil do titulo (ex.: "compras", "servicos"), NAO tem os valores PA ou NDF. ' +
          'O filtro de exclusao de PA/NDF e SEMPRE no campo SE2.E2_TIPO (tipo de movimento do titulo), NUNCA em SE2.E2_NATUREZ. ' +
          'Troque para: AND SE2.E2_TIPO NOT IN (\'PA\', \'NDF\').'
        );
      }
      const usaNaturezComoTipoReceber = /\bSE1\s*\.\s*E1_NATUREZ\s*(?:NOT\s+IN|IN|=|<>)\s*\(?\s*'(?:RA|NCC)'/i.test(sql);
      if (usaNaturezComoTipoReceber) {
        return (
          'SQL usa SE1.E1_NATUREZ com os valores \'RA\'/\'NCC\' — campo ERRADO. ' +
          'SE1.E1_NATUREZ e a natureza financeira/categoria contabil do titulo (ex.: "vendas", "servicos"), NAO tem os valores RA ou NCC. ' +
          'O filtro de exclusao de RA/NCC e SEMPRE no campo SE1.E1_TIPO (tipo de movimento do titulo), NUNCA em SE1.E1_NATUREZ. ' +
          'Troque para: AND SE1.E1_TIPO NOT IN (\'RA\', \'NCC\').'
        );
      }

      const usaSaldoAbertoPagar = /\bSE2\s*\.\s*E2_SALDO\s*>\s*0\b/i.test(sql);
      if (usaSaldoAbertoPagar && !pedeNdfExplicito && !/\bE2_TIPO\b/i.test(sql)) {
        return (
          'Consulta de titulos a pagar em aberto (SE2.E2_SALDO > 0) sem filtro de SE2.E2_TIPO. ' +
          'NDF (nota de debito fornecedor) e PA (pagamento antecipado) sao movimentos de compensacao que distorcem o saldo real a pagar quando misturados. ' +
          'Adicione AND SE2.E2_TIPO NOT IN (\'PA\', \'NDF\') ao WHERE, a menos que o usuario tenha pedido PA/NDF explicitamente.'
        );
      }
      const usaSaldoAbertoReceber = /\bSE1\s*\.\s*E1_SALDO\s*>\s*0\b/i.test(sql);
      if (usaSaldoAbertoReceber && !pedeNccExplicito && !/\bE1_TIPO\b/i.test(sql)) {
        return (
          'Consulta de titulos a receber em aberto (SE1.E1_SALDO > 0) sem filtro de SE1.E1_TIPO. ' +
          'NCC (nota de credito cliente) e RA (recebimento antecipado) sao movimentos de compensacao que distorcem o saldo real a receber quando misturados. ' +
          'Adicione AND SE1.E1_TIPO NOT IN (\'RA\', \'NCC\') ao WHERE, a menos que o usuario tenha pedido RA/NCC explicitamente.'
        );
      }
      return null;
    },
  },
  {
    // Pergunta pede explicitamente o CALCULO LIQUIDO (contas a pagar/receber "considerando"
    // ou "descontando" PA/NDF/RA/NCC) — o valor desses tipos e credito do usuario/cliente e
    // deve ser SUBTRAIDO do total normal, nunca somado como categoria isolada nem ignorado.
    // Exige a estrutura de 2 componentes (bruto excluindo o tipo, credito isolando o tipo)
    // subtraidos no SELECT final — sem isso nao ha como o resultado representar o liquido.
    validar(sql, mensagem) {
      const texto = String(mensagem || '');
      const pedeLiquidoPagar = /\b(considerando|descontando|abatendo|liquido)\b/i.test(texto)
        && /\b(PA|NDF|pagamentos?\s+antecipados?|notas?\s+de\s+d[ée]bito)\b/i.test(texto)
        && /\bpagar\b|\bpagament\w*/i.test(texto);
      const pedeLiquidoReceber = /\b(considerando|descontando|abatendo|liquido)\b/i.test(texto)
        && /\b(RA|NCC|recebimentos?\s+antecipados?|notas?\s+de\s+cr[ée]dito)\b/i.test(texto)
        && /\breceber\b|\brecebiment\w*/i.test(texto);

      if (pedeLiquidoPagar && /\bFROM\s+\w*SE2\w*\s+SE2\b/i.test(sql)) {
        const temBruto = /\bSE2\s*\.\s*E2_TIPO\s+NOT\s+IN\s*\(\s*'PA'\s*,\s*'NDF'\s*\)/i.test(sql) || /\bSE2\s*\.\s*E2_TIPO\s+NOT\s+IN\s*\(\s*'NDF'\s*,\s*'PA'\s*\)/i.test(sql);
        const temCredito = /\bSE2\s*\.\s*E2_TIPO\s+IN\s*\(\s*'PA'\s*,\s*'NDF'\s*\)/i.test(sql) || /\bSE2\s*\.\s*E2_TIPO\s+IN\s*\(\s*'NDF'\s*,\s*'PA'\s*\)/i.test(sql);
        const temSubtracao = /-\s*(?:\w+\s*\.\s*)?credito_pa_ndf\b/i.test(sql) || /\bdebito_liquido\b/i.test(sql);
        if (!temBruto || !temCredito || !temSubtracao) {
          return (
            'A pergunta pede contas a pagar CONSIDERANDO/DESCONTANDO PA/NDF — PA e NDF sao creditos do usuario com o fornecedor e devem ser SUBTRAIDOS do total normal, nunca somados ou ignorados. ' +
            'O SQL deve calcular em subqueries/CTEs escalares SEPARADAS: debito_bruto (SE2.E2_TIPO NOT IN (\'PA\',\'NDF\')), credito_pa_ndf (SE2.E2_TIPO IN (\'PA\',\'NDF\')), e debito_liquido = debito_bruto - credito_pa_ndf. Corrija e regere o SQL com essa estrutura.'
          );
        }
      }
      if (pedeLiquidoReceber && /\bFROM\s+\w*SE1\w*\s+SE1\b/i.test(sql)) {
        const temBruto = /\bSE1\s*\.\s*E1_TIPO\s+NOT\s+IN\s*\(\s*'RA'\s*,\s*'NCC'\s*\)/i.test(sql) || /\bSE1\s*\.\s*E1_TIPO\s+NOT\s+IN\s*\(\s*'NCC'\s*,\s*'RA'\s*\)/i.test(sql);
        const temCredito = /\bSE1\s*\.\s*E1_TIPO\s+IN\s*\(\s*'RA'\s*,\s*'NCC'\s*\)/i.test(sql) || /\bSE1\s*\.\s*E1_TIPO\s+IN\s*\(\s*'NCC'\s*,\s*'RA'\s*\)/i.test(sql);
        const temSubtracao = /-\s*(?:\w+\s*\.\s*)?credito_ra_ncc\b/i.test(sql) || /\bcredito_liquido\b/i.test(sql);
        if (!temBruto || !temCredito || !temSubtracao) {
          return (
            'A pergunta pede contas a receber CONSIDERANDO/DESCONTANDO RA/NCC — RA e NCC sao creditos do cliente com o usuario e devem ser SUBTRAIDOS do total normal, nunca somados ou ignorados. ' +
            'O SQL deve calcular em subqueries/CTEs escalares SEPARADAS: credito_bruto (SE1.E1_TIPO NOT IN (\'RA\',\'NCC\')), credito_ra_ncc (SE1.E1_TIPO IN (\'RA\',\'NCC\')), e credito_liquido = credito_bruto - credito_ra_ncc. Corrija e regere o SQL com essa estrutura.'
          );
        }
      }
      return null;
    },
  },
  {
    // Bug real confirmado em teste (2026-08-28): no calculo de liquido PA/NDF ou RA/NCC com
    // LISTAGEM de titulos individuais, as CTEs bruto/credito filtram corretamente o
    // fornecedor/cliente pedido, mas a IA por vezes esquece de repetir esse MESMO filtro no
    // WHERE do SELECT externo que lista os titulos (so mantem D_E_L_E_T_/SALDO > 0). Resultado:
    // a listagem traz titulos de TODOS os fornecedores/clientes da empresa, nao so o pedido —
    // vazamento de dados entre entidades, alem de contaminar o CROSS JOIN com bruto/credito de
    // uma entidade em linhas de outras. So se aplica quando ha CTE (WITH) e o SELECT externo
    // referencia a tabela diretamente (listagem); escalar puro via subquery no FROM nao lista
    // linhas de SE2/SE1, entao nao precisa repetir o filtro fora da subquery.
    validar(sql) {
      const texto = String(sql || '');
      if (!/\bWITH\b/i.test(texto)) return null;

      function extrairSelectExterno(str) {
        const mWith = str.match(/\bWITH\b/i);
        if (!mWith) return str;
        let i = mWith.index + mWith[0].length;
        let depth = 0;
        let fechamento = -1;
        for (; i < str.length; i++) {
          const c = str[i];
          if (c === '(') depth++;
          else if (c === ')') {
            depth--;
            if (depth === 0) {
              fechamento = i;
              if (/^\s*,/.test(str.slice(i + 1))) continue;
              break;
            }
          }
        }
        return fechamento === -1 ? str : str.slice(fechamento + 1);
      }

      const externo = extrairSelectExterno(texto);

      const mFornece = texto.match(/\bSE2\s*\.\s*E2_FORNECE\s*=\s*'([^']+)'/i);
      const listaSE2Externo = /\bFROM\s+\w*SE2\w*\s+SE2\b/i.test(externo);
      if (mFornece && listaSE2Externo) {
        const codigo = mFornece[1];
        const filtroRepetido = new RegExp(`SE2\\s*\\.\\s*E2_FORNECE\\s*=\\s*'${codigo}'`, 'i').test(externo);
        if (!filtroRepetido) {
          return (
            `O calculo de liquido PA/NDF filtra o fornecedor '${codigo}' dentro das CTEs (bruto/credito), mas a listagem de titulos no SELECT externo nao repete esse filtro. ` +
            `Isso traz titulos de TODOS os fornecedores, nao so o pedido. Adicione AND SE2.E2_FORNECE = '${codigo}' (e o filtro de loja correspondente) tambem no WHERE do SELECT externo.`
          );
        }
      }

      const mCliente = texto.match(/\bSE1\s*\.\s*E1_CLIENTE\s*=\s*'([^']+)'/i);
      const listaSE1Externo = /\bFROM\s+\w*SE1\w*\s+SE1\b/i.test(externo);
      if (mCliente && listaSE1Externo) {
        const codigo = mCliente[1];
        const filtroRepetido = new RegExp(`SE1\\s*\\.\\s*E1_CLIENTE\\s*=\\s*'${codigo}'`, 'i').test(externo);
        if (!filtroRepetido) {
          return (
            `O calculo de liquido RA/NCC filtra o cliente '${codigo}' dentro das CTEs (bruto/credito), mas a listagem de titulos no SELECT externo nao repete esse filtro. ` +
            `Isso traz titulos de TODOS os clientes, nao so o pedido. Adicione AND SE1.E1_CLIENTE = '${codigo}' (e o filtro de loja correspondente) tambem no WHERE do SELECT externo.`
          );
        }
      }
      return null;
    },
  },
  {
    // Bug real confirmado em teste (2026-08-28): pergunta pede "total de pagamentos
    // antecipados" (PA/RA isolado) e a IA confunde o nome do tipo com uma baixa ja
    // realizada, fazendo JOIN com SE5/FK1/FK2/FK7 (tabelas de baixa). PA/RA/NDF/NCC com
    // SALDO > 0 sao titulos EM ABERTO (creditos nao utilizados) — nunca tabela de baixa.
    // Baseado na PERGUNTA (nao no filtro de tipo do SQL): a IA pode escapar de um guard
    // baseado em E2_TIPO='PA' simplesmente omitindo o filtro de tipo ou usando NOT IN,
    // mas ainda assim errar ao usar JOIN de baixa quando a pergunta pede PA/RA isolado.
    validar(sql, mensagem) {
      const texto = String(mensagem || '');
      const pedePagarAntecipadoIsolado = /\b(pagamentos?\s+antecipados?|nota\s+de\s+d[ée]bito|\bNDF\b)\b/i.test(texto)
        && !/\bconsiderando\b|\bdescontando\b|\bl[ií]quido\b/i.test(texto);
      const pedeReceberAntecipadoIsolado = /\b(recebimentos?\s+antecipados?|nota\s+de\s+cr[ée]dito|\bNCC\b)\b/i.test(texto)
        && !/\bconsiderando\b|\bdescontando\b|\bl[ií]quido\b/i.test(texto);

      const usaBaixaPagar = /\bJOIN\s+\w*(?:SE5|FK1|FK2|FK7)\w*\s+(?:SE5|FK1|FK2|FK7)\b/i.test(sql);
      if (pedePagarAntecipadoIsolado && /\bFROM\s+\w*SE2\w*\s+SE2\b/i.test(sql) && usaBaixaPagar) {
        return (
          'A pergunta pede pagamentos antecipados/PA/NDF isolado, que e SEMPRE consulta de titulo EM ABERTO (credito nao utilizado), mas o SQL faz JOIN com tabela de baixa (SE5/FK1/FK2/FK7). ' +
          'Remova o JOIN de baixa. Use SELECT SUM(SE2.E2_SALDO) FROM SE2<sufixo> SE2 WHERE SE2.E2_TIPO = \'PA\' AND SE2.E2_SALDO > 0 (mais filtros de fornecedor/periodo se pedidos) — sem nenhuma tabela de baixa.'
        );
      }
      const usaBaixaReceber = /\bJOIN\s+\w*(?:SE5|FK1|FK7)\w*\s+(?:SE5|FK1|FK7)\b/i.test(sql);
      if (pedeReceberAntecipadoIsolado && /\bFROM\s+\w*SE1\w*\s+SE1\b/i.test(sql) && usaBaixaReceber) {
        return (
          'A pergunta pede recebimentos antecipados/RA/NCC isolado, que e SEMPRE consulta de titulo EM ABERTO (credito nao utilizado), mas o SQL faz JOIN com tabela de baixa (SE5/FK1/FK7). ' +
          'Remova o JOIN de baixa. Use SELECT SUM(SE1.E1_SALDO) FROM SE1<sufixo> SE1 WHERE SE1.E1_TIPO = \'RA\' AND SE1.E1_SALDO > 0 (mais filtros de cliente/periodo se pedidos) — sem nenhuma tabela de baixa.'
        );
      }
      return null;
    },
  },
  {
    // Bug confirmado em producao: a IA por vezes esquece o filtro de exclusao de banco
    // mesmo com a regra textual no spec (mais provavel em continuidade de conversa). Extrai
    // os codigos de banco que o usuario pediu para excluir/desconsiderar e exige que apareçam
    // no NOT IN do SQL final — forca retry em vez de devolver resultado incompleto ao usuario.
    validar(sql, mensagem) {
      const texto = String(mensagem || '');
      const usaSE8 = /\b(?:FROM|JOIN)\s+SE8/i.test(sql);
      if (!usaSE8) return null;
      const m = texto.match(/\b(?:desconsiderando|desconsidere|exclu(?:indo|a|ir)|removendo|remova|remover|tirando|tire|sem)\s+(?:os?\s+)?bancos?\s+([A-Za-z0-9, ]+?)(?:\s+e\s+([A-Za-z0-9]+))?\b/i);
      if (!m) return null;
      const codigos = [m[1], m[2]]
        .filter(Boolean)
        .flatMap(grupo => grupo.split(/[,e]+/i))
        .map(c => c.trim().toUpperCase())
        .filter(c => c && /^[A-Z0-9]+$/.test(c));
      if (!codigos.length) return null;
      const faltando = codigos.filter(cod => !new RegExp(`['"]${cod}['"]`, 'i').test(sql));
      if (faltando.length) {
        return (
          `A pergunta pede para desconsiderar o(s) banco(s) ${faltando.join(', ')}, mas o SQL nao contem filtro de exclusao para ele(s). ` +
          `Adicione (ou complete) a clausula SE8.E8_BANCO NOT IN (${codigos.map(c => `'${c}'`).join(', ')}) no WHERE/subquery de SE8.`
        );
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
  camposPeriodoObrigatorios: ['E1_VENCREA', 'E1_VENCTO', 'E1_EMISSAO', 'E1_BAIXA', 'E2_VENCREA', 'E2_VENCTO', 'E2_EMISSAO', 'E2_BAIXA', 'E5_DATA', 'E8_DTSALAT'],
  sqlMiddleware,
  regrasTecnicas,
  sx3PromptLimit: 90,
  maxTokens: 5200,
  dimensionLeftJoinBases: ['SA1', 'SA2', 'SA3', 'SA6', 'SED'],
  sanitizarFiltrosFilialSX2: true,
  camposVendedorSeguranca: CAMPOS_VENDEDOR_SEGURANCA,
  camposRateioVendedor: CAMPOS_VENDEDOR_SEGURANCA,
  tabelasBloqueadasParaVendedor: ['SE2'],
  camposClienteSeguranca: CAMPOS_CLIENTE_SEGURANCA,
  tabelasBloqueadasParaCliente: ['SE2'],
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta financeira no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta financeira. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei registros financeiros para essa consulta.',
    erro_erp: 'Nao consegui buscar os dados financeiros no ERP. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao: 'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  },
  garantirIntencao,
  prepararIntent,
  resolverVendedorFixoPorEmpresa,
  resolverEntidades,
  formatarPerguntaAmbiguidade,
  ajustarSqlAposSx2,
  validarCorrigirSqlGerado,
  _test: {
    prepararIntent,
    gruposBuscaEntidade,
    buscarEntidade,
    resolverEntidades,
    removerFiltrosEmpresaComoEntidade,
  },
};
