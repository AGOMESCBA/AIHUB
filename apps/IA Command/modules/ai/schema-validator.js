const { PERIOD_TYPES, normalizarIntent } = require('./local-intent-resolver');

const FILTROS_PERMITIDOS = new Set(['cliente', 'vendedor', 'fornecedor', 'produto', 'filial', 'unidade', 'status', 'natureza', 'grupo_produto', 'centro_custo', 'tes', 'banco', 'conta']);
const AGRUPAMENTOS_PERMITIDOS = new Set(['cliente', 'produto', 'vendedor', 'fornecedor', 'documento', 'empresa', 'filial', 'unidade', 'mes', 'ano', 'dia', 'natureza', 'grupo_produto', 'centro_custo', 'tes', 'banco', 'conta']);
const OPERACOES_PERMITIDAS = new Set(['soma', 'media']);
const GRANULARIDADES_PERMITIDAS = new Set(['dia', 'mes', 'ano']);

function _normalizarIntencaoDinamica(nome, nomesPermitidos = []) {
  const valor = String(nome || '').trim().toLowerCase();
  if (!valor || nomesPermitidos.includes(nome)) return nome;
  const mapa = [
    {
      alvo: 'financeiro_dinamico',
      re: /^(financeiro|contas?_?a?_?pagar|contas?_?pagar|pagar|pagamentos?|contas?_?a?_?receber|contas?_?receber|receber|recebimentos?|fluxo_?caixa|fluxo_?caixa_?realizado|fluxo_?caixa_?projetado|caixa|saldo|saldo_?bancario|saldos?_?bancarios?|bancos?|titulos?|duplicatas?)$/,
    },
    {
      alvo: 'compras_dinamico',
      re: /^(compras?|pedido_?compra|ordem_?compra|nf_?entrada|nota_?entrada|fornecedores?)$/,
    },
    {
      alvo: 'faturamento_dinamico',
      re: /^(faturamento|vendas?|receita|notas?_?saida|nf_?saida|nfe?)$/,
    },
    {
      alvo: 'comissao_dinamico',
      re: /^(comissao|comissoes|comissões|vendedores?)$/,
    },
  ];
  const achado = mapa.find(item => item.re.test(valor));
  return achado && nomesPermitidos.includes(achado.alvo) ? achado.alvo : nome;
}

// Valida e normaliza o JSON retornado pela IA de classificacao.
// nomesPermitidos: array de nomes validos, carregado do banco + "desconhecido".
function validar(intent, nomesPermitidos) {
  const erros = [];

  if (!intent || typeof intent !== 'object') {
    return { valido: false, erros: ['Resposta da IA nao e um objeto JSON valido'] };
  }

  intent.intencao = typeof intent.intencao === 'string' ? intent.intencao.trim() : '';
  intent.intencao = _normalizarIntencaoDinamica(intent.intencao, nomesPermitidos);
  if (!nomesPermitidos.includes(intent.intencao)) {
    erros.push(`Intencao invalida: "${intent.intencao}". Esperado: ${nomesPermitidos.join(', ')}`);
  }

  if (typeof intent.confianca !== 'number' || intent.confianca < 0 || intent.confianca > 1) {
    erros.push('Campo "confianca" deve ser numero entre 0 e 1');
  }

  normalizarIntent(intent);

  if (!PERIOD_TYPES.has(intent.periodo.tipo)) {
    erros.push(`Periodo invalido: "${intent.periodo.tipo}"`);
  }

  if (intent.periodo.tipo === 'ultimos_N_dias' && !intent.periodo.dias) {
    erros.push('Periodo ultimos_N_dias exige campo "dias"');
  }
  if (['comparacao_mesmo_mes', 'comparacao_acumulado_mes'].includes(intent.periodo.tipo) && !intent.periodo.mes) {
    erros.push(`Periodo ${intent.periodo.tipo} exige campo "mes"`);
  }
  if (intent.periodo.tipo === 'comparacao_mensal_entre_anos' && (!intent.periodo.ano_base || !intent.periodo.ano_comparacao)) {
    erros.push('Periodo comparacao_mensal_entre_anos exige campos "ano_base" e "ano_comparacao"');
  }
  if (intent.periodo.tipo === 'personalizado') {
    const ini = intent.periodo.data_inicio;
    const fim = intent.periodo.data_fim || ini;
    if ((ini && !/^\d{8}$/.test(String(ini))) || (fim && !/^\d{8}$/.test(String(fim)))) {
      erros.push('Periodo personalizado exige data_inicio/data_fim no formato YYYYMMDD');
    }
  }

  intent.filtros = intent.filtros && typeof intent.filtros === 'object' ? intent.filtros : {};
  for (const key of Object.keys(intent.filtros)) {
    if (!FILTROS_PERMITIDOS.has(key) || intent.filtros[key] == null || intent.filtros[key] === '') {
      delete intent.filtros[key];
      continue;
    }
    intent.filtros[key] = String(intent.filtros[key]).trim();
  }

  intent.limite = intent.limite == null ? null : Math.min(Math.max(parseInt(intent.limite, 10) || 0, 1), 100);
  if (intent.limite === 0) intent.limite = null;

  if (Array.isArray(intent.group_by)) {
    intent.group_by = intent.group_by
      .map(v => String(v || '').trim().toLowerCase())
      .filter(v => AGRUPAMENTOS_PERMITIDOS.has(v))
      .filter((v, idx, arr) => arr.indexOf(v) === idx);
    if (!intent.group_by.length) intent.group_by = null;
  } else {
    intent.group_by = null;
  }

  intent.agrupar_por = intent.agrupar_por || intent.group_by?.[0] || null;
  if (intent.agrupar_por && !AGRUPAMENTOS_PERMITIDOS.has(intent.agrupar_por)) {
    erros.push(`Agrupamento invalido: "${intent.agrupar_por}"`);
    intent.agrupar_por = null;
  }

  if (Array.isArray(intent.agrupar_por_composto)) {
    intent.agrupar_por_composto = intent.agrupar_por_composto
      .map(v => String(v || '').trim().toLowerCase())
      .filter(v => AGRUPAMENTOS_PERMITIDOS.has(v));
    if (intent.agrupar_por_composto.length < 2) {
      intent.agrupar_por_composto = null;
    } else {
      intent.agrupar_por_composto = intent.agrupar_por_composto;
    }
  } else {
    intent.agrupar_por_composto = intent.group_by && intent.group_by.length >= 2 ? intent.group_by : null;
  }

  if (!intent.group_by && intent.agrupar_por_composto) intent.group_by = intent.agrupar_por_composto;
  if (!intent.group_by && intent.agrupar_por) intent.group_by = [intent.agrupar_por];

  if (intent.operacao_analitica && typeof intent.operacao_analitica === 'object') {
    const op = String(intent.operacao_analitica.operacao || '').toLowerCase();
    const granularidade = String(intent.operacao_analitica.granularidade || '').toLowerCase();
    if (!OPERACOES_PERMITIDAS.has(op)) {
      erros.push(`Operacao analitica invalida: "${intent.operacao_analitica.operacao}"`);
      intent.operacao_analitica = null;
    } else if (op === 'media' && !GRANULARIDADES_PERMITIDAS.has(granularidade)) {
      erros.push(`Granularidade analitica invalida: "${intent.operacao_analitica.granularidade}"`);
      intent.operacao_analitica = null;
    } else {
      intent.operacao_analitica = {
        operacao: op,
        granularidade: GRANULARIDADES_PERMITIDAS.has(granularidade) ? granularidade : null,
        metrica: intent.operacao_analitica.metrica ? String(intent.operacao_analitica.metrica).replace(/[^\w]/g, '').toLowerCase() : null,
      };
    }
  } else {
    intent.operacao_analitica = null;
  }

  intent.ordenar_por = intent.ordenar_por || null;
  if (intent.ordenar_por && !/^[\w]+:(asc|desc)$/i.test(String(intent.ordenar_por))) {
    erros.push('Campo "ordenar_por" deve seguir o formato coluna:asc ou coluna:desc');
    intent.ordenar_por = null;
  }

  intent.precisa_confirmacao = !!intent.precisa_confirmacao;
  intent.origem = intent.origem || 'texto';

  return { valido: erros.length === 0, erros, intent };
}

module.exports = { validar };
