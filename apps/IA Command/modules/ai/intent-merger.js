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

function _clonar(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function _eVazio(v) {
  return v == null || v === 'nenhum' || v === 'desconhecido';
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
  if (_eVazio(tipoPeriodo)) {
    // Sem período detectado → herda do contexto integralmente
    merged.periodo = _clonar(ultimoIntent.periodo);
    merged._herdouPeriodo = true;
  } else if (PERIODO_REFINAMENTO[tipoPeriodo]) {
    // Período de refinamento → vira agrupar_por; contexto preservado
    if (!merged.agrupar_por) {
      merged.agrupar_por = PERIODO_REFINAMENTO[tipoPeriodo];
    }
    merged.periodo = _clonar(ultimoIntent.periodo);
    merged._periodoRefinamento = tipoPeriodo;
    merged._herdouPeriodo = true;
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

  merged._contextoAplicado = true;
  return merged;
}

module.exports = { mesclar, detectarContinuacao, CONTEXT_TTL_MS };
