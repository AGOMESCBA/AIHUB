// Conectores que indicam que a mensagem é uma continuação da anterior
const { identificarPeriodoTexto } = require('./period-resolver');
const unsupportedRequest = require('./unsupported-request');

const CONECTORES_CONTINUACAO = [
  'e ', 'e o ', 'e a ', 'e os ', 'e as ', 'mas ', 'agora ',
  'também ', 'tambem ', 'detalhe ', 'detalha ', 'detalhes ',
  'quebra ', 'quebre ', 'filtra ', 'filtre ', 'mostra ', 'mostre ',
  'e por ', 'e do ', 'e da ', 'e de ', 'e no ', 'e na ',
  'só por ', 'so por ', 'só de ', 'so de ',
  // Variantes com pronome de cortesia no início ("me detalhe", "me mostre")
  'me detalhe ', 'me detalha ', 'me detalhes ',
  'me mostre ', 'me mostra ', 'me liste ',
  'me quebre ', 'me quebra ', 'me filtre ', 'me filtra ',
];

// Tipos de período que em contexto de continuação indicam REFINAMENTO (agrupamento
// temporal), não substituição de período. Ex: "mês a mês" após "faturamento do ano"
// → mantém o período do contexto e define agrupar_por temporal.
const PERIODO_REFINAMENTO = {
  comparacao_mensal: 'mes',
  comparacao_anual:  'ano',
};

// Tempo máximo de inatividade para o contexto de intenção permanecer válido
const CONTEXT_TTL_MS = 10 * 60 * 1000;

// Períodos que o LLM tende a retornar como "padrão implícito" quando o usuário
// não especificou período nenhum. Em contexto de continuação, esses períodos devem
// ser sobrescritos pelo contexto anterior SE a mensagem não contiver referência
// temporal explícita.
const PERIODOS_GENERICOS = new Set(['mes_atual', 'ano_atual']);

// Detecta se a mensagem contém alguma referência temporal explícita do usuário.
// Se não contiver → período retornado pelo classificador é um "padrão implícito".
const _TEM_TEMPORAL = /\b(hoje|ontem|semana|m[eê]s|ano|trimestre|semestre|[úu]ltim|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|20\d{2}|19\d{2})\b/i;

// Detecta granularidade temporal explícita ("por mês", "por dia", "por ano") —
// indica agrupamento, não especificação de período novo.
const _AGRUPAR_MES = /\bpor\s+m[eê]s\b|\bm[eê]s\s+a\s+m[eê]s\b/i;
const _AGRUPAR_DIA = /\bpor\s+dia\b|\bdia\s+a\s+dia\b/i;
const _AGRUPAR_ANO = /\bpor\s+ano\b|\bano\s+a\s+ano\b/i;
const _RANKING_MES = /\bmes(?:es)?\s+(?:com|de)\s+(?:maior|menor|melhor|pior)\b|\b(?:maior|menor|melhor|pior)\s+mes(?:es)?\b|\bqual\s+o\s+mes\b/i;
const _METRICA_FATURAMENTO = /\b(faturamento|valor(?:\s+financeiro|\s+faturado|\s+total)?|vlr|receita)\b/i;
const _METRICA_QUANTIDADE = /\b(quantidade|qtd|qtde|qte|volume|unidades?|itens?|toneladas?|ton|tn|kg|quilos?|kilos?)\b/i;
const _TODAS_METRICAS = /\b(os\s+dois|as\s+duas|ambos|ambas|valor\s+e\s+quantidade|quantidade\s+e\s+valor|faturamento\s+e\s+quantidade|quantidade\s+e\s+faturamento)\b/i;
const AGRUPAMENTOS_TEMPORAIS = new Set(['dia', 'mes', 'ano']);

const MESES = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, março: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

const DIMENSOES = [
  ['cliente', /\bpor\s+clientes?\b|\bclientes?\b/i],
  ['produto', /\bpor\s+produtos?\b|\bprodutos?\b|\bitens?\b/i],
  ['vendedor', /\bpor\s+vendedores?\b|\bvendedores?\b|\brepresentantes?\b/i],
  ['fornecedor', /\bpor\s+fornecedores?\b|\bfornecedores?\b/i],
  ['documento', /\bpor\s+(?:documentos?|titulos?|duplicatas?)\b|\b(documentos?|titulos?|duplicatas?)\b/i],
  ['empresa', /\bpor\s+empresas?\b|\bempresas?\b/i],
  ['filial', /\bpor\s+filia(?:l|is)\b|\bfilia(?:l|is)\b|\bpor\s+lojas?\b|\blojas?\b/i],
  ['unidade', /\bpor\s+unidades?(?:\s+de\s+negocio)?\b|\bunidades?(?:\s+de\s+negocio)?\b/i],
];

function _clonar(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function _eVazio(v) {
  return v == null || v === 'nenhum' || v === 'desconhecido';
}

function _normalizar(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const FILTRO_POR_TIPO_ENTIDADE = {
  cliente: 'cliente',
  fornecedor: 'fornecedor',
  vendedor: 'vendedor',
  produto: 'produto',
  grupo_produto: 'grupo_produto',
  centro_custo: 'centro_custo',
  natureza: 'natureza',
  tes: 'tes',
};
const FILTROS_ENTIDADE = new Set(Object.values(FILTRO_POR_TIPO_ENTIDADE));
const TERMOS_NAO_ENTIDADE_CURTA = new Set([
  'ano', 'mes', 'mês', 'dia', 'semana', 'trimestre', 'semestre',
  'periodo', 'período', 'cliente', 'clientes', 'produto', 'produtos',
  'fornecedor', 'fornecedores', 'vendedor', 'vendedores', 'empresa', 'empresas',
  'filial', 'filiais', 'loja', 'lojas', 'todos', 'todas',
]);

function _tipoEntidadeAindaCompativel(tipo, filtrosAtuais = {}, filtrosAnteriores = {}) {
  const chave = FILTRO_POR_TIPO_ENTIDADE[String(tipo || '').toLowerCase()];
  if (!chave) return true;
  const atual = filtrosAtuais?.[chave];
  const anterior = filtrosAnteriores?.[chave];
  if (!atual) return true;
  return !!anterior && _normalizar(atual) === _normalizar(anterior);
}

function _filtrarEntidadesCompativeis(entidades = [], filtrosAtuais = {}, filtrosAnteriores = {}) {
  return (Array.isArray(entidades) ? entidades : [])
    .filter(e => _tipoEntidadeAindaCompativel(e?.tipo, filtrosAtuais, filtrosAnteriores));
}

function _filtrarEntidadesPorEmpresaCompativeis(entidadesPorEmpresa = {}, filtrosAtuais = {}, filtrosAnteriores = {}) {
  const out = {};
  for (const [empresaId, entidades] of Object.entries(entidadesPorEmpresa || {})) {
    const filtradas = _filtrarEntidadesCompativeis(entidades, filtrosAtuais, filtrosAnteriores);
    if (filtradas.length) out[empresaId] = filtradas;
  }
  return out;
}

function _extrairNomeEntidadeCurta(mensagem = '') {
  const texto = String(mensagem || '').trim();
  const m = texto.match(/\b(?:do|da|de|dos|das)\s+([A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ .&'_-]{1,80})\s*[?.!]*$/i);
  if (!m) return null;
  const nome = m[1].trim().replace(/\s+/g, ' ');
  const normalizado = _normalizar(nome);
  if (!nome || TERMOS_NAO_ENTIDADE_CURTA.has(normalizado)) return null;
  return nome;
}

function _chaveEntidadeDoContexto(ultimoIntent = {}) {
  const filtros = Object.entries(ultimoIntent.filtros || {})
    .filter(([k, v]) => FILTROS_ENTIDADE.has(String(k).toLowerCase()) && String(v || '').trim());
  return filtros.length === 1 ? filtros[0][0] : null;
}

/**
 * Verifica se a mensagem começa com conector de continuação.
 * Indicativo auxiliar — a decisão definitiva fica no mesclar().
 */
function detectarContinuacao(mensagem) {
  const m = String(mensagem || '').trim().toLowerCase();
  return CONECTORES_CONTINUACAO.some(c => m.startsWith(c) || m === c.trim());
}

function _moduloDinamicoDoIntent(intent = {}) {
  return String(
    intent._moduloDinamico ||
    String(intent.intencao || '').replace(/_dinamico$/i, '')
  || '').toLowerCase();
}

function _mensagemMencionaDominioExplicito(mensagem = '') {
  const texto = _normalizar(mensagem);
  return /\b(compras?|pedido(?:s)?\s+de\s+compra|fornecedores?|faturamento|vendas?|receita|comissao|comissoes|financeiro|contas?\s+a\s+pagar|contas?\s+a\s+receber|saldo\s+bancario|fluxo\s+de\s+caixa)\b/.test(texto);
}

/**
 * Extrai o ano calendário implicado pelo período de contexto.
 * Retorna null se o período for ambíguo (ex.: comparação entre dois anos).
 */
function _extrairAnoContexto(periodo) {
  if (!periodo) return null;
  const ano = new Date().getFullYear();
  const tipo = periodo.tipo || 'nenhum';

  if (tipo === 'ano_anterior') return ano - 1;
  if (tipo === 'ano_atual') return ano;

  if (tipo === 'personalizado' && periodo.data_inicio) {
    const y = parseInt(String(periodo.data_inicio).slice(0, 4), 10);
    return Number.isFinite(y) && y >= 1900 && y <= 2099 ? y : null;
  }

  if (['mes_anterior', 'mes_atual'].includes(tipo)) return ano;

  if (['primeiro_trimestre', 'segundo_trimestre', 'terceiro_trimestre', 'quarto_trimestre',
       'primeiro_semestre', 'segundo_semestre'].includes(tipo)) {
    return periodo.ano_ref === 'anterior' ? ano - 1 : ano;
  }

  return null;
}

/**
 * Retorna true se o período for um "personalizado" de mês único gerado sem ano explícito
 * na mensagem — ou seja, o period-resolver assumiu o ano corrente por padrão.
 */
function _ehMesSemAno(periodo, mensagem) {
  if (!periodo || periodo.tipo !== 'personalizado') return false;
  if (/\b(20\d{2}|19\d{2})\b/.test(String(mensagem || ''))) return false;

  const ini = String(periodo.data_inicio || '');
  const fim = String(periodo.data_fim   || '');
  if (ini.length !== 8 || fim.length !== 8) return false;

  // Mesma ano e mês no início e fim → bloco de um único mês
  return ini.slice(0, 6) === fim.slice(0, 6);
}

function _metricasDaMensagem(mensagem) {
  const texto = String(mensagem || '');
  if (_TODAS_METRICAS.test(texto)) return ['faturamento', 'quantidade'];

  const metricas = [];
  if (_METRICA_FATURAMENTO.test(texto)) metricas.push('faturamento');
  if (_METRICA_QUANTIDADE.test(texto)) metricas.push('quantidade');
  return metricas;
}

function _dimensaoDaMensagem(mensagem) {
  const texto = _normalizar(mensagem);
  const found = DIMENSOES.find(([, re]) => re.test(texto));
  return found ? found[0] : null;
}

function _matchesDimensoes(mensagem) {
  const texto = _normalizar(mensagem);
  const out = [];
  for (const [dim, re] of DIMENSOES) {
    const match = re.exec(texto);
    if (match) out.push({ dim, index: match.index });
  }

  const temporal = [
    ['dia', /\bpor\s+dias?\b|\bdias?\s+a\s+dias?\b|\bdias?\s+e\b|\be\s+dias?\b/],
    ['mes', /\bpor\s+mes\b|\bmes\s+a\s+mes\b|\bmes\s+e\b|\be\s+mes\b/],
    ['ano', /\bpor\s+ano\b|\bano\s+a\s+ano\b|\bano\s+e\b|\be\s+ano\b/],
    ['documento', /\bpor\s+(?:documentos?|titulos?|duplicatas?)\b/],
  ];
  for (const [dim, re] of temporal) {
    const match = re.exec(texto);
    if (match && !out.some(x => x.dim === dim)) out.push({ dim, index: match.index });
  }

  return out
    .sort((a, b) => a.index - b.index)
    .map(x => x.dim)
    .filter((dim, idx, arr) => arr.indexOf(dim) === idx);
}

function _granularidadeDaMensagem(mensagem) {
  if (_AGRUPAR_MES.test(mensagem)) return 'mes';
  if (_AGRUPAR_DIA.test(mensagem)) return 'dia';
  if (_AGRUPAR_ANO.test(mensagem)) return 'ano';
  const texto = _normalizar(mensagem);
  if (/\b(e|por)\s+dias?\b|\bdias?\s+e\b/.test(texto)) return 'dia';
  if (/\b(e|por)\s+mes\b|\bmes\s+e\b/.test(texto)) return 'mes';
  if (/\b(e|por)\s+ano\b|\bano\s+e\b/.test(texto)) return 'ano';
  return null;
}

function _agrupamentoCompostoDaMensagem(mensagem) {
  const groupBy = _matchesDimensoes(mensagem);
  return groupBy.length >= 2 ? groupBy : null;
}

function _groupByIntent(intent) {
  if (Array.isArray(intent?.group_by) && intent.group_by.length) {
    return intent.group_by.map(d => String(d || '').toLowerCase()).filter(Boolean);
  }
  if (Array.isArray(intent?.agrupar_por_composto) && intent.agrupar_por_composto.length) {
    return intent.agrupar_por_composto.map(d => String(d || '').toLowerCase()).filter(Boolean);
  }
  return intent?.agrupar_por ? [String(intent.agrupar_por).toLowerCase()] : [];
}

function _anosComparacaoContexto(periodo) {
  if (!periodo || !['comparacao_anual', 'comparacao_mensal_entre_anos', 'comparacao_acumulado_mes'].includes(periodo.tipo)) return null;
  const anoBase = parseInt(periodo.ano_base, 10);
  const anoComparacao = parseInt(periodo.ano_comparacao, 10);
  if (!Number.isFinite(anoBase) || !Number.isFinite(anoComparacao)) {
    const ini = String(periodo.data_inicio || periodo.dataInicio || '');
    const fim = String(periodo.data_fim || periodo.dataFim || '');
    const anoIni = parseInt(ini.slice(0, 4), 10);
    const anoFim = parseInt(fim.slice(0, 4), 10);
    if (Number.isFinite(anoIni) && Number.isFinite(anoFim) && anoIni !== anoFim) {
      return { ano_base: anoIni, ano_comparacao: anoFim };
    }
    return null;
  }
  return { ano_base: anoBase, ano_comparacao: anoComparacao };
}

function _mesAcumuladoMensagem(mensagem) {
  const texto = _normalizar(mensagem);
  if (!/\bate\b/.test(texto) || !/\b(mes|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(texto)) {
    return null;
  }
  const mesNome = Object.keys(MESES)
    .sort((a, b) => b.length - a.length)
    .find(nome => new RegExp(`\\b${nome}\\b`, 'i').test(texto));
  return mesNome ? MESES[mesNome] : null;
}

function _periodoMesMensagem(mensagem, periodoContexto) {
  const texto = _normalizar(mensagem);
  const mesNome = Object.keys(MESES)
    .sort((a, b) => b.length - a.length)
    .find(nome => new RegExp(`\\b${nome}\\b`, 'i').test(texto));
  if (!mesNome) return null;

  const anoExplicito = texto.match(/\b(20\d{2}|19\d{2})\b/);
  const anoCtx = _extrairAnoContexto(periodoContexto);
  const ano = anoExplicito ? parseInt(anoExplicito[1], 10) : anoCtx;
  if (!ano) return null;

  const mes = MESES[mesNome];
  const mm = String(mes).padStart(2, '0');
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return {
    tipo: 'personalizado',
    data_inicio: `${ano}${mm}01`,
    data_fim: `${ano}${mm}${String(ultimoDia).padStart(2, '0')}`,
  };
}

/**
 * Mescla o intent classificado no turno atual com o contexto do turno anterior.
 *
 * Regras:
 *  - Se novo intent tem intenção diferente e confiança >= 0.80 → nova conversa, sem herança.
 *  - Intenção ausente ou "desconhecido" → herda do contexto.
 *  - Período ausente ("nenhum") → herda do contexto.
 *  - Período de refinamento (comparacao_mensal/anual) → vira agrupar_por temporal;
 *    período do contexto é preservado.
 *  - Período de mês sem ano explícito + contexto com ano específico → ano herdado do contexto.
 *  - Filtros: mesclagem aditiva (novos somam aos herdados, não substituem).
 *  - Agrupamento: sempre respeita o novo (pode ser null intencionalmente).
 *  - Limite e ordenação: herda do contexto apenas se ausentes no novo intent.
 *
 * @param {object} novoIntent      - Intent classificado neste turno
 * @param {object} ultimoIntent    - Intent do turno anterior (contexto)
 * @param {number} ultimoIntentTs  - Timestamp do último intent salvo
 * @param {string} mensagem        - Texto original da mensagem (usado para detectar ano explícito)
 * @returns {object} - Intent final, potencialmente enriquecido
 */
function mesclar(novoIntent, ultimoIntent, ultimoIntentTs = 0, mensagem = '', opts = {}) {
  if (!ultimoIntent) {
    if (!novoIntent._nivel_contexto) novoIntent._nivel_contexto = 1;
    return novoIntent;
  }

  const ultimoDinamico = String(ultimoIntent.intencao || '').toLowerCase().endsWith('_dinamico')
    || String(ultimoIntent.acao || '').toLowerCase() === 'ai_text_to_sql'
    || ultimoIntent._dynamicAiScope;
  if (!ultimoDinamico) {
    const bloqueado = unsupportedRequest.aplicarBloqueioSeNecessario(novoIntent, mensagem, opts);
    if (bloqueado !== novoIntent) {
      bloqueado._contextoAplicado = true;
      return bloqueado;
    }
  }

  // Contexto expirado por inatividade
  if (ultimoIntentTs && Date.now() - ultimoIntentTs > CONTEXT_TTL_MS) {
    novoIntent._nivel_contexto = 1;
    return novoIntent;
  }

  // Novo intent com alta confiança e intenção diferente → nova conversa, ignora contexto
  // Exceção: se o novo intent não especificou período, herda o do contexto anterior para evitar
  // que trocas de módulo (ex: faturamento → compras) percam a janela temporal estabelecida.
  const refinamentoSemDominioNovo = detectarContinuacao(mensagem)
    && !_mensagemMencionaDominioExplicito(mensagem)
    && _moduloDinamicoDoIntent(novoIntent)
    && _moduloDinamicoDoIntent(ultimoIntent)
    && _moduloDinamicoDoIntent(novoIntent) !== _moduloDinamicoDoIntent(ultimoIntent);

  if (
    !_eVazio(novoIntent.intencao) &&
    novoIntent.intencao !== ultimoIntent.intencao &&
    novoIntent.confianca >= 0.85 &&
    !refinamentoSemDominioNovo
  ) {
    if (_eVazio(novoIntent.periodo?.tipo) && !_eVazio(ultimoIntent.periodo?.tipo)) {
      novoIntent.periodo = _clonar(ultimoIntent.periodo);
      novoIntent._herdouPeriodo = true;
      novoIntent._periodoHerdadoTrocaModulo = true;
    }
    if (ultimoIntent._mensagemOriginal && !novoIntent._mensagemOriginalAnterior) {
      novoIntent._mensagemOriginalAnterior = ultimoIntent._mensagemOriginal;
    }
    novoIntent._nivel_contexto = 1;
    return novoIntent;
  }

  const merged = _clonar(novoIntent);
  if (refinamentoSemDominioNovo) {
    merged.intencao = ultimoIntent.intencao;
    merged._moduloDinamico = ultimoIntent._moduloDinamico || _moduloDinamicoDoIntent(ultimoIntent);
    merged.acao = ultimoIntent.acao || merged.acao;
    merged._dynamicAiScope = ultimoIntent._dynamicAiScope || merged._dynamicAiScope;
    merged._dominioPreservadoPorRefinamento = true;
  }

  // 1. Herança de intenção
  if (_eVazio(merged.intencao)) {
    merged.intencao  = ultimoIntent.intencao;
    merged.confianca = Math.max(merged.confianca || 0, (ultimoIntent.confianca || 0) * 0.85);
    merged._herdouIntencao = true;
  }

  // 2. Resolução de período
  const tipoPeriodo = merged.periodo?.tipo;
  const periodoMesMensagem = mensagem ? _periodoMesMensagem(mensagem, ultimoIntent.periodo) : null;
  const periodoDeterministico = mensagem ? identificarPeriodoTexto(mensagem) : null;
  if (_eVazio(tipoPeriodo)) {
    if (periodoMesMensagem) {
      merged.periodo = periodoMesMensagem;
      merged._periodoMesDoContexto = true;
    } else if (!_eVazio(periodoDeterministico?.tipo)) {
      merged.periodo = periodoDeterministico;
      merged._periodoDetectadoNoTexto = true;
    } else {
      // Sem período detectado → herda do contexto integralmente
      merged.periodo = _clonar(ultimoIntent.periodo);
      merged._herdouPeriodo = true;
    }
  } else if (PERIODO_REFINAMENTO[tipoPeriodo]) {
    // Período de refinamento → vira agrupar_por; contexto preservado
    if (!merged.agrupar_por) {
      merged.agrupar_por = PERIODO_REFINAMENTO[tipoPeriodo];
    }
    merged.periodo = _clonar(ultimoIntent.periodo);
    merged._periodoRefinamento = tipoPeriodo;
    merged._herdouPeriodo = true;
  }

  if (periodoMesMensagem && !merged._periodoMesDoContexto && !merged._periodoRefinamento) {
    merged.periodo = periodoMesMensagem;
    merged._periodoMesDoContexto = true;
    delete merged._herdouPeriodo;
  }

  const anosComparacaoContexto = _anosComparacaoContexto(ultimoIntent.periodo);
  const mesAcumuladoContexto = mensagem && anosComparacaoContexto ? _mesAcumuladoMensagem(mensagem) : null;
  if ((merged.periodo?.tipo === 'comparacao_acumulado_mes' || mesAcumuladoContexto) && anosComparacaoContexto) {
    merged.periodo = {
      tipo: 'comparacao_acumulado_mes',
      mes: mesAcumuladoContexto || merged.periodo?.mes,
      ...anosComparacaoContexto,
    };
    merged.agrupar_por = null;
    merged.group_by = null;
    merged.agrupar_por_composto = null;
    merged.ordenar_por = null;
    merged.limite = null;
    merged._comparacaoAcumuladaDoContexto = true;
  }

  // 2a. Granularidade temporal na mensagem ("por mês", "por dia", "por ano")
  // → define agrupar_por e herda o período do contexto (é agrupamento, não novo período)
  if (!merged.agrupar_por && mensagem) {
    const granularidade = _granularidadeDaMensagem(mensagem);

    if (granularidade) {
      merged.agrupar_por = granularidade;
      if (!merged._herdouPeriodo && _eVazio(merged.periodo?.tipo)) {
        merged.periodo = _clonar(ultimoIntent.periodo);
        merged._herdouPeriodo = true;
      }
      merged._granularidadeDetectada = granularidade;
    }
  }

  if (mensagem && _RANKING_MES.test(_normalizar(mensagem))) {
    merged.agrupar_por = 'mes';
    merged.group_by = ['mes'];
    merged.agrupar_por_composto = null;
    merged.limite = merged.limite || 1;
    if (!merged.ordenar_por) {
      merged.ordenar_por = _normalizar(mensagem).match(/\b(menor|pior)\b/)
        ? 'faturamento:asc'
        : 'faturamento:desc';
    }
    if (PERIODOS_GENERICOS.has(merged.periodo?.tipo)) {
      merged.periodo = _clonar(ultimoIntent.periodo);
      merged._herdouPeriodo = true;
      merged._periodoRankingTemporalSobrescrito = true;
    }
  }

  if (!merged.agrupar_por && mensagem) {
    const dimensao = _dimensaoDaMensagem(mensagem);
    if (dimensao) {
      merged.agrupar_por = dimensao;
      merged._dimensaoDetectada = dimensao;
    }
  }

  // Se a conversa estava detalhada em uma granularidade temporal e o usuario pede
  // uma dimensao de negocio em seguida, preserva as duas dimensoes.
  // Ex: "por dia em dezembro" -> "por cliente" = por dia e cliente em dezembro.
  if (mensagem) {
    const compostoMensagem = _agrupamentoCompostoDaMensagem(mensagem);
    if (compostoMensagem) {
      merged.group_by = compostoMensagem;
      merged.agrupar_por = compostoMensagem[0];
      merged.agrupar_por_composto = compostoMensagem;
      merged._dimensaoDetectada = compostoMensagem.find(d => !AGRUPAMENTOS_TEMPORAIS.has(d)) || null;
      merged._granularidadeDetectada = compostoMensagem.find(d => AGRUPAMENTOS_TEMPORAIS.has(d)) || null;
      merged._agrupamentoCompostoDetectado = true;
    }
  }

  if (mensagem && !merged.agrupar_por_composto) {
    const groupByMensagem = _matchesDimensoes(mensagem);
    const groupByAnterior = _groupByIntent(ultimoIntent);
    const pedidoSubstituicao = /\b(?:so|somente|apenas)\s+por\b/i.test(_normalizar(mensagem));
    const refinouPeriodoMensal = !!merged._periodoMesDoContexto && groupByAnterior.every(d => AGRUPAMENTOS_TEMPORAIS.has(d));
    if (
      groupByMensagem.length === 1 &&
      groupByAnterior.length &&
      !groupByAnterior.includes(groupByMensagem[0]) &&
      groupByAnterior.some(d => !AGRUPAMENTOS_TEMPORAIS.has(d)) &&
      (!AGRUPAMENTOS_TEMPORAIS.has(groupByMensagem[0]) || groupByAnterior.some(d => !AGRUPAMENTOS_TEMPORAIS.has(d))) &&
      !refinouPeriodoMensal &&
      !pedidoSubstituicao
    ) {
      merged.group_by = [...groupByAnterior, groupByMensagem[0]];
      merged.agrupar_por = merged.group_by[0];
      merged.agrupar_por_composto = merged.group_by;
      merged._agrupamentoCompostoDoContexto = true;
    }
  }

  if (mensagem && !merged.agrupar_por_composto) {
    const dimensao = _dimensaoDaMensagem(mensagem);
    const groupByAnterior = _groupByIntent(ultimoIntent);
    const agrupamentoAnterior = groupByAnterior[groupByAnterior.length - 1] || '';
    if (
      dimensao &&
      AGRUPAMENTOS_TEMPORAIS.has(agrupamentoAnterior) &&
      !AGRUPAMENTOS_TEMPORAIS.has(dimensao) &&
      !(merged._periodoMesDoContexto && groupByAnterior.every(d => AGRUPAMENTOS_TEMPORAIS.has(d)))
    ) {
      merged.group_by = [...groupByAnterior, dimensao].filter((d, idx, arr) => arr.indexOf(d) === idx);
      merged.agrupar_por = dimensao;
      merged.agrupar_por_composto = merged.group_by;
      merged._dimensaoDetectada = dimensao;
      merged._agrupamentoCompostoDoContexto = true;
    } else if (
      dimensao &&
      groupByAnterior.length &&
      !groupByAnterior.includes(dimensao) &&
      !(merged._periodoMesDoContexto && groupByAnterior.every(d => AGRUPAMENTOS_TEMPORAIS.has(d)))
    ) {
      merged.group_by = [...groupByAnterior, dimensao];
      merged.agrupar_por = merged.group_by[0];
      merged.agrupar_por_composto = merged.group_by.length >= 2 ? merged.group_by : null;
      merged._dimensaoDetectada = dimensao;
      merged._agrupamentoCompostoDoContexto = true;
    }
  }

  // Período explícito novo (qualquer outro tipo) → substitui, sem herança
  // Regra extra: mês sem ano explícito + contexto com ano específico → ajusta o ano
  if (!merged._herdouPeriodo && mensagem && _ehMesSemAno(merged.periodo, mensagem)) {
    const anoCtx = _extrairAnoContexto(ultimoIntent.periodo);
    if (anoCtx != null) {
      const anoNovo = parseInt(String(merged.periodo.data_inicio).slice(0, 4), 10);
      if (Number.isFinite(anoNovo) && anoNovo !== anoCtx) {
        merged.periodo = {
          ...merged.periodo,
          data_inicio: String(anoCtx) + String(merged.periodo.data_inicio).slice(4),
          data_fim:    String(anoCtx) + String(merged.periodo.data_fim).slice(4),
        };
        merged._anoHerdadoDoContexto = anoCtx;
      }
    }
  }

  // Sobrescreve período "genérico por padrão" (mes_atual / ano_atual) quando a mensagem
  // não tem referência temporal explícita — impede que o LLM assuma um default que
  // apague o contexto estabelecido (ex: "por dia" após "ano anterior" → não é mes_atual).
  if (
    !merged._herdouPeriodo &&
    PERIODOS_GENERICOS.has(merged.periodo?.tipo) &&
    mensagem &&
    !_TEM_TEMPORAL.test(String(mensagem))
  ) {
    merged.periodo = _clonar(ultimoIntent.periodo);
    merged._herdouPeriodo = true;
    merged._periodoGenericoSobrescrito = merged.periodo?.tipo;
  }

  // 3. Filtros: mesclagem aditiva
  const nomeEntidadeCurta = _extrairNomeEntidadeCurta(mensagem);
  const chaveEntidadeCurta = nomeEntidadeCurta ? _chaveEntidadeDoContexto(ultimoIntent) : null;
  if (chaveEntidadeCurta) {
    merged.filtros = { ...(merged.filtros || {}), [chaveEntidadeCurta]: nomeEntidadeCurta };
    merged._filtroEntidadeExplicitaMensagem = { [chaveEntidadeCurta]: nomeEntidadeCurta };
  }

  const filtrosHerdados = {};
  for (const [k, v] of Object.entries(ultimoIntent.filtros || {})) {
    if (v && !merged.filtros?.[k]) filtrosHerdados[k] = v;
  }
  if (Object.keys(filtrosHerdados).length) {
    merged.filtros = { ...filtrosHerdados, ...(merged.filtros || {}) };
    merged._herdouFiltros = true;
  }

  if ((!Array.isArray(merged._entidadesResolvidas) || !merged._entidadesResolvidas.length) && Array.isArray(ultimoIntent._entidadesResolvidas) && ultimoIntent._entidadesResolvidas.length) {
    const entidadesCompativeis = _filtrarEntidadesCompativeis(
      ultimoIntent._entidadesResolvidas,
      merged.filtros || {},
      ultimoIntent.filtros || {}
    );
    if (entidadesCompativeis.length) {
      merged._entidadesResolvidas = _clonar(entidadesCompativeis);
      merged._herdouEntidadesResolvidas = true;
    }
  }
  if (!merged._entidadesResolvidasPorEmpresa && ultimoIntent._entidadesResolvidasPorEmpresa) {
    const entidadesPorEmpresaCompativeis = _filtrarEntidadesPorEmpresaCompativeis(
      ultimoIntent._entidadesResolvidasPorEmpresa,
      merged.filtros || {},
      ultimoIntent.filtros || {}
    );
    if (Object.keys(entidadesPorEmpresaCompativeis).length) {
      merged._entidadesResolvidasPorEmpresa = _clonar(entidadesPorEmpresaCompativeis);
      merged._herdouEntidadesResolvidasPorEmpresa = true;
    }
  }

  if (ultimoIntent._mensagemOriginal && !merged._mensagemOriginalAnterior) {
    merged._mensagemOriginalAnterior = ultimoIntent._mensagemOriginal;
  }

  if (ultimoIntent._contextoIAAnterior && !merged._contextoIAAnterior) {
    merged._contextoIAAnterior = ultimoIntent._contextoIAAnterior;
  }

  // 4. Limite e ordenação: herda apenas se ausentes
  if (merged.limite == null && ultimoIntent.limite != null) {
    merged.limite = ultimoIntent.limite;
  }
  if (!merged.ordenar_por && ultimoIntent.ordenar_por) {
    merged.ordenar_por = ultimoIntent.ordenar_por;
  }

  const metricasMensagem = _metricasDaMensagem(mensagem);
  if (metricasMensagem.length) {
    merged._metricasDetectadas = metricasMensagem;
    if (metricasMensagem.length > 1) merged._metricasMultiplas = true;
  } else if (
    (!merged._metricasDetectadas || !merged._metricasDetectadas.length) &&
    ultimoIntent._metricasDetectadas?.length
  ) {
    merged._metricasDetectadas = _clonar(ultimoIntent._metricasDetectadas);
    merged._herdouMetricas = true;
  }

  merged._contextoAplicado = true;
  merged._nivel_contexto = Math.min((ultimoIntent._nivel_contexto || 1) + 1, opts?.limiteContexto || 5);

  if (!merged._trace) merged._trace = [];
  merged._trace.push({ etapa: 'merger', nivel_contexto: merged._nivel_contexto, herdou: { intencao: !!merged._herdouIntencao, periodo: !!merged._herdouPeriodo, filtros: !!merged._herdouFiltros } });

  if (merged.intencao === ultimoIntent.intencao) {
    merged.precisa_confirmacao = false;
    delete merged._baixaConfianca;
    if (merged._erro && /confianca baixa/i.test(String(merged._erro))) delete merged._erro;
  }
  return merged;
}

module.exports = { mesclar, detectarContinuacao, CONTEXT_TTL_MS, CONECTORES_CONTINUACAO, DIMENSOES };
