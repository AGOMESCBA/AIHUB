// Conectores que indicam que a mensagem é uma continuação da anterior
const CONECTORES_CONTINUACAO = [
  'e ', 'e o ', 'e a ', 'e os ', 'e as ', 'mas ', 'agora ',
  'também ', 'tambem ', 'detalhe ', 'detalha ', 'detalhes ',
  'quebra ', 'quebre ', 'filtra ', 'filtre ', 'mostra ', 'mostre ',
  'e por ', 'e do ', 'e da ', 'e de ', 'e no ', 'e na ',
  'só por ', 'so por ', 'só de ', 'so de ',
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
  ['empresa', /\bpor\s+empresas?\b|\bpor\s+filiais?\b|\bpor\s+unidades?\b|\bpor\s+lojas?\b/i],
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
    .toLowerCase();
}

/**
 * Verifica se a mensagem começa com conector de continuação.
 * Indicativo auxiliar — a decisão definitiva fica no mesclar().
 */
function detectarContinuacao(mensagem) {
  const m = String(mensagem || '').trim().toLowerCase();
  return CONECTORES_CONTINUACAO.some(c => m.startsWith(c) || m === c.trim());
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
  const granularidade = _granularidadeDaMensagem(mensagem);
  const dimensao = _dimensaoDaMensagem(mensagem);
  if (!granularidade || !dimensao) return null;
  return [granularidade, dimensao];
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
function mesclar(novoIntent, ultimoIntent, ultimoIntentTs = 0, mensagem = '') {
  if (!ultimoIntent) return novoIntent;

  // Contexto expirado por inatividade
  if (ultimoIntentTs && Date.now() - ultimoIntentTs > CONTEXT_TTL_MS) {
    return novoIntent;
  }

  // Novo intent com alta confiança e intenção diferente → nova conversa, ignora contexto
  if (
    !_eVazio(novoIntent.intencao) &&
    novoIntent.intencao !== ultimoIntent.intencao &&
    novoIntent.confianca >= 0.80
  ) {
    return novoIntent;
  }

  const merged = _clonar(novoIntent);

  // 1. Herança de intenção
  if (_eVazio(merged.intencao)) {
    merged.intencao  = ultimoIntent.intencao;
    merged.confianca = Math.max(merged.confianca || 0, (ultimoIntent.confianca || 0) * 0.85);
    merged._herdouIntencao = true;
  }

  // 2. Resolução de período
  const tipoPeriodo = merged.periodo?.tipo;
  const periodoMesMensagem = mensagem ? _periodoMesMensagem(mensagem, ultimoIntent.periodo) : null;
  if (_eVazio(tipoPeriodo)) {
    if (periodoMesMensagem) {
      merged.periodo = periodoMesMensagem;
      merged._periodoMesDoContexto = true;
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
  if (mensagem && !merged.agrupar_por_composto) {
    const compostoMensagem = _agrupamentoCompostoDaMensagem(mensagem);
    if (compostoMensagem) {
      const [, dimensaoMensagem] = compostoMensagem;
      merged.agrupar_por = dimensaoMensagem;
      merged.agrupar_por_composto = compostoMensagem;
      merged._dimensaoDetectada = dimensaoMensagem;
      merged._granularidadeDetectada = compostoMensagem[0];
      merged._agrupamentoCompostoDetectado = true;
    }
  }

  if (mensagem && !merged.agrupar_por_composto) {
    const dimensao = _dimensaoDaMensagem(mensagem);
    const agrupamentoAnterior = String(ultimoIntent.agrupar_por || '').toLowerCase();
    if (
      dimensao &&
      AGRUPAMENTOS_TEMPORAIS.has(agrupamentoAnterior) &&
      !AGRUPAMENTOS_TEMPORAIS.has(dimensao)
    ) {
      merged.agrupar_por = dimensao;
      merged.agrupar_por_composto = [agrupamentoAnterior, dimensao];
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
  const filtrosHerdados = {};
  for (const [k, v] of Object.entries(ultimoIntent.filtros || {})) {
    if (v && !merged.filtros?.[k]) filtrosHerdados[k] = v;
  }
  if (Object.keys(filtrosHerdados).length) {
    merged.filtros = { ...filtrosHerdados, ...(merged.filtros || {}) };
    merged._herdouFiltros = true;
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
  return merged;
}

module.exports = { mesclar, detectarContinuacao, CONTEXT_TTL_MS };
