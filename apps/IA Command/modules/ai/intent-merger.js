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
 * Mescla o intent classificado no turno atual com o contexto do turno anterior.
 *
 * Regras:
 *  - Se novo intent tem intenção diferente e confiança >= 0.80 → nova conversa, sem herança.
 *  - Intenção ausente ou "desconhecido" → herda do contexto.
 *  - Período ausente ("nenhum") → herda do contexto.
 *  - Período de refinamento (comparacao_mensal/anual) → vira agrupar_por temporal;
 *    período do contexto é preservado.
 *  - Filtros: mesclagem aditiva (novos somam aos herdados, não substituem).
 *  - Agrupamento: sempre respeita o novo (pode ser null intencionalmente).
 *  - Limite e ordenação: herda do contexto apenas se ausentes no novo intent.
 *
 * @param {object} novoIntent      - Intent classificado neste turno
 * @param {object} ultimoIntent    - Intent do turno anterior (contexto)
 * @param {number} ultimoIntentTs  - Timestamp do último intent salvo
 * @returns {object} - Intent final, potencialmente enriquecido
 */
function mesclar(novoIntent, ultimoIntent, ultimoIntentTs = 0) {
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
