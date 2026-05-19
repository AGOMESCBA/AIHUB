const { identificarPeriodoTexto } = require('./period-resolver');
const { normalizarTexto, normalizarBasico, extrairRegrasNormalizacao } = require('./text-normalizer');

const PERIOD_TYPES = new Set([
  'nenhum',
  'hoje',
  'ontem',
  'esta_semana',
  'semana_anterior',
  'mes_atual',
  'mes_anterior',
  'ano_atual',
  'ano_anterior',
  'ultimo_trimestre',
  'primeiro_trimestre',
  'segundo_trimestre',
  'terceiro_trimestre',
  'quarto_trimestre',
  'primeiro_semestre',
  'segundo_semestre',
  'ultimos_N_dias',
  'comparacao_anual',
  'comparacao_mensal',
  'comparacao_mensal_entre_anos',
  'comparacao_mesmo_mes',
  'comparacao_acumulado_mes',
  'personalizado',
]);

const DIMENSIONS = {
  produto: ['por produto', 'produtos', 'produto', 'item', 'itens', 'referencia', 'negocio'],
  cliente: ['por cliente', 'clientes', 'cliente', 'quem comprou'],
  vendedor: ['por vendedor', 'vendedores', 'vendedor', 'representante', 'rep', 'quem vendeu'],
  fornecedor: ['por fornecedor', 'fornecedores', 'fornecedor', 'forn'],
  empresa: ['por empresa', 'por empresas', 'empresa', 'empresas'],
  filial: ['por filial', 'por filiais', 'filial', 'filiais', 'loja', 'lojas'],
  unidade: ['por unidade', 'por unidades', 'unidade', 'unidades', 'unidade de negocio', 'unidades de negocio'],
  mes: ['por mes', 'por meses', 'todos os meses', 'cada mes', 'mes a mes', 'mensal', 'mes com maior', 'mes de maior', 'mes com menor', 'mes de menor', 'mes maior', 'melhor mes', 'pior mes', 'qual o mes'],
  ano: ['por ano', 'ano a ano', 'anual', 'ano com maior', 'ano maior', 'melhor ano', 'pior ano', 'qual o ano'],
  dia: ['por dia', 'dia a dia', 'diario', 'diaria', 'diariamente', 'cada dia', 'detalhe dia', 'detalhado por dia'],
};

const STOPWORDS_INTENCAO = new Set([
  'consultar', 'consulta', 'listar', 'lista', 'relatorio', 'periodo', 'por',
  'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'ano', 'mes',
  'atual', 'anterior', 'passado', 'semana', 'dia',
]);

const METRIC_ALIASES = {
  faturamento: [
    'faturamento', 'valor', 'valor financeiro', 'valor faturado',
    'valor total', 'vlr', 'vlr total', 'receita', 'receita bruta', 'receita total',
  ],
  quantidade: [
    'quantidade', 'qtd', 'qtde', 'qte', 'volume', 'unidades', 'itens',
    'pecas', 'tonelada', 'toneladas', 'ton', 'tn', 'kg', 'quilos', 'kilos',
  ],
};

const TERMOS_TODAS_METRICAS = [
  'os dois', 'as duas', 'ambos', 'ambas', 'tudo', 'todos',
  'valor e quantidade', 'quantidade e valor', 'faturamento e quantidade',
  'quantidade e faturamento',
];

const AGRUPAMENTOS_TEMPORAIS = new Set(['dia', 'mes', 'ano']);

function resolverLocal(mensagem, intencoes = [], sinonimos = [], opts = {}) {
  const normalizacoes = opts.normalizacoes || extrairRegrasNormalizacao(sinonimos);
  const texto = normalizarTexto(mensagem, normalizacoes);
  if (!texto || !intencoes.length) return null;

  const matches = _matchSinonimos(texto, sinonimos);
  const periodo = identificarPeriodoTexto(mensagem, { normalizacoes });
  const groupBy = _resolverGroupBy(texto);
  const agruparPorComposto = groupBy.length >= 2 ? groupBy : null;
  const agruparPor = groupBy[0] || _resolverAgrupamento(texto, matches.coluna);
  const intencaoInfo = _resolverIntencao(texto, intencoes, matches.intencao, { periodo, agruparPor });
  if (!intencaoInfo) return null;
  const intencao = intencaoInfo.intent;
  const filtros = _resolverFiltros(texto, matches.filtro);
  const limite = _resolverLimite(texto);
  const metricasDataset = _metricasDataset(intencao, opts.datasets || []);
  const metricasTexto = _resolverMetricas(texto, matches.coluna, metricasDataset, mensagem);
  const operacaoAnalitica = _resolverOperacaoAnalitica(texto, metricasTexto, metricasDataset);
  const ordenarPor = limite || agruparPor ? _resolverOrdenacao(metricasTexto, metricasDataset, texto) : null;

  const confianca = _calcularConfianca({ matches, periodo, agruparPor, filtros, limite, intencaoInfo, metricasTexto, operacaoAnalitica });
  if (confianca < 0.85) return null;

  return {
    intencao: intencao.nome,
    periodo,
    filtros,
    group_by: groupBy.length ? groupBy : null,
    agrupar_por: agruparPor,
    agrupar_por_composto: agruparPorComposto,
    operacao_analitica: operacaoAnalitica,
    ordenar_por: ordenarPor,
    limite,
    confianca,
    precisa_confirmacao: false,
    origem: 'texto',
    _provedor: 'deterministico',
    _resolvidoLocalmente: true,
    _scoreLocal: intencaoInfo.score,
    _metricasDetectadas: metricasTexto,
    _sinonimosAplicados: [...matches.intencao, ...matches.coluna, ...matches.filtro].map(s => ({
      termo: s.termo,
      camada: s.camada,
      equivalencia: s.equivalencia,
      contexto: s.contexto || null,
      origem: s.origem || null,
    })),
  };
}

function _matchSinonimos(texto, sinonimos) {
  const out = { intencao: [], coluna: [], filtro: [] };
  for (const s of sinonimos || []) {
    if (!s?.termo || !s?.equivalencia || s.ativo === 0) continue;
    const camada = String(s.camada || '').toLowerCase();
    if (!out[camada]) continue;
    const termo = normalizarBasico(s.termo);
    if (!termo || !_containsTerm(texto, termo)) continue;
    out[camada].push({ ...s, termo_normalizado: termo });
  }
  for (const camada of Object.keys(out)) {
    out[camada].sort((a, b) => b.termo_normalizado.length - a.termo_normalizado.length);
  }
  return out;
}

function _resolverIntencao(texto, intencoes, sinonimosIntencao, contexto = {}) {
  const candidatos = [];
  const tokensTexto = new Set(texto.split(/\s+/).filter(Boolean));

  for (const s of sinonimosIntencao) {
    const eq = normalizarTexto(s.equivalencia);
    for (const intent of intencoes) {
      if (_intentMatches(intent, eq)) {
        candidatos.push({ intent, score: 0.62, motivo: 'sinonimo_intencao' });
      }
    }
  }

  for (const intent of intencoes) {
    const nome = normalizarTexto(intent.nome);
    const descricao = normalizarTexto(intent.descricao || '');
    const exemplos = normalizarTexto(intent.frases_exemplo || '');
    let score = 0;

    if (nome && _containsTerm(texto, nome.replace(/_/g, ' '))) score += 0.8;
    const tokensNome = nome
      .split(/[_\s]+/)
      .filter(t => t.length >= 3 && !STOPWORDS_INTENCAO.has(t));
    const matchesNome = tokensNome.filter(t => tokensTexto.has(t) || _containsTerm(texto, t));
    if (matchesNome.length) score += Math.min(0.55, matchesNome.length * 0.18);

    for (const s of sinonimosIntencao) {
      const eq = normalizarTexto(s.equivalencia);
      if (!eq) continue;
      if (nome.includes(eq) || descricao.includes(eq) || exemplos.includes(eq)) score += 0.36;
    }

    if (contexto.agruparPor && nome.includes(contexto.agruparPor)) score += 0.18;
    if (!contexto.agruparPor && !_nomeTemDimensao(nome)) score += 0.12;
    if (!contexto.agruparPor && _nomeTemDimensao(nome)) score -= 0.12;
    if (contexto.periodo?.tipo && contexto.periodo.tipo !== 'nenhum' && (nome.includes('periodo') || descricao.includes('periodo'))) score += 0.08;
    if (score > 0) candidatos.push({ intent, score, motivo: 'nome_descricao' });
  }

  if (!candidatos.length) return null;

  const agrupados = new Map();
  for (const c of candidatos) {
    const prev = agrupados.get(c.intent.nome);
    if (!prev) {
      agrupados.set(c.intent.nome, { ...c });
    } else {
      prev.score = Math.min(1, Math.max(prev.score, c.score) + Math.min(prev.score, c.score) * 0.35);
      prev.motivo = `${prev.motivo}+${c.motivo}`;
    }
  }
  const ordenados = [...agrupados.values()].sort((a, b) => b.score - a.score);
  const top = ordenados[0];
  const segundo = ordenados[1];
  if (!segundo || top.score - segundo.score >= 0.08 || top.score >= 0.72) return top;
  return null;
}

function _intentMatches(intent, equivalencia) {
  const nome = normalizarTexto(intent.nome).replace(/_/g, ' ');
  const descricao = normalizarTexto(intent.descricao || '');
  return nome === equivalencia || nome.includes(equivalencia) || descricao.includes(equivalencia);
}

function _nomeTemDimensao(nomeNormalizado) {
  return Object.keys(DIMENSIONS).some(dim => nomeNormalizado.split(/[_\s]+/).includes(dim));
}

function _resolverAgrupamento(texto) {
  for (const [dim, termos] of Object.entries(DIMENSIONS)) {
    if (termos.some(t => _containsTerm(texto, normalizarTexto(t)))) return dim;
  }
  return null;
}

function _dimensionMatch(texto, dim, termos) {
  let best = null;
  const candidatos = [...termos];
  if (dim === 'dia') candidatos.push('dia', 'dias');
  if (dim === 'mes') candidatos.push('mes', 'meses');
  if (dim === 'ano') candidatos.push('ano');

  for (const termo of candidatos) {
    const t = normalizarTexto(termo);
    if (!t) continue;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
    const m = re.exec(texto);
    if (!m) continue;
    const idx = m.index + (m[1] ? m[1].length : 0);

    if (dim === 'produto' && t === 'negocio') {
      const antes = texto.slice(Math.max(0, idx - 12), idx).trim();
      if (/\bunidade\s+de$/.test(antes)) continue;
    }

    if (AGRUPAMENTOS_TEMPORAIS.has(dim) && ['dia', 'dias', 'mes', 'ano'].includes(t)) {
      const antes = texto.slice(Math.max(0, idx - 4), idx).trim();
      const depois = texto.slice(idx + t.length, idx + t.length + 4).trim();
      if (!/\b(por|e)$/.test(antes) && !/^e\b/.test(depois)) continue;
    }

    if (!best || idx < best.index || (idx === best.index && t.length > best.termo.length)) {
      best = { dim, index: idx, termo: t };
    }
  }
  return best;
}

function _resolverGroupBy(texto) {
  return Object.entries(DIMENSIONS)
    .map(([dim, termos]) => _dimensionMatch(texto, dim, termos))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map(x => x.dim)
    .filter((dim, idx, arr) => arr.indexOf(dim) === idx);
}

function _resolverAgrupamentoComposto(texto) {
  const encontrados = [];
  for (const [dim, termos] of Object.entries(DIMENSIONS)) {
    if (termos.some(t => _containsTerm(texto, normalizarTexto(t)))) encontrados.push(dim);
  }

  const negocio = encontrados.filter(dim => !AGRUPAMENTOS_TEMPORAIS.has(dim));
  if (negocio.length) {
    if (!encontrados.includes('dia') && /\b(e|por)\s+dias?\b|\bdias?\s+e\b/.test(texto)) encontrados.push('dia');
    if (!encontrados.includes('mes') && /\b(e|por)\s+m[eê]s\b|\bm[eê]s\s+e\b/.test(texto)) encontrados.push('mes');
    if (!encontrados.includes('ano') && /\b(e|por)\s+ano\b|\bano\s+e\b/.test(texto)) encontrados.push('ano');
  }

  const temporais = encontrados.filter(dim => AGRUPAMENTOS_TEMPORAIS.has(dim));
  if (!temporais.length || !negocio.length) return null;

  return [temporais[0], negocio[0]];
}

function _resolverAgrupamentoPrincipal(composto) {
  if (!Array.isArray(composto) || composto.length < 2) return null;
  return composto.find(dim => !AGRUPAMENTOS_TEMPORAIS.has(dim)) || composto[0] || null;
}

function _resolverFiltros(texto, sinonimosFiltro) {
  const filtros = {};
  for (const s of sinonimosFiltro) {
    const ctx = normalizarTexto(s.contexto);
    if (!ctx || !['cliente', 'produto', 'vendedor', 'fornecedor', 'filial', 'status'].includes(ctx)) continue;
    filtros[ctx] = s.equivalencia;
  }
  return filtros;
}

function _resolverLimite(texto) {
  const m = texto.match(/\b(?:top|maiores|maior|ranking|rank)\s+(\d{1,3})\b/) || texto.match(/\b(\d{1,3})\s+(?:maiores|mais vendidos|clientes|produtos|fornecedores)\b/);
  if (!m) return _containsAny(texto, ['maior', 'melhor', 'menor', 'pior']) ? 1 : null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : null;
}

function _resolverMetricas(texto, sinonimosColuna, metricasDataset, mensagemOriginal = '') {
  const out = [];
  const textoOriginal = normalizarBasico(mensagemOriginal);
  const add = (metrica) => {
    const found = _resolverMetricaDataset(metrica, metricasDataset);
    if (found && !out.includes(found)) out.push(found);
  };

  if (TERMOS_TODAS_METRICAS.some(t => _containsTerm(texto, normalizarTexto(t)))) {
    metricasDataset.forEach(add);
    return out;
  }

  for (const s of sinonimosColuna) {
    const eq = _normalizarColuna(s.equivalencia);
    add(eq);
  }
  for (const [metrica, aliases] of Object.entries(METRIC_ALIASES)) {
    if (aliases.some(t => _containsTerm(texto, normalizarTexto(t)))) {
      add(metrica);
    }
  }
  for (const metrica of metricasDataset) {
    if (_containsTerm(texto, normalizarTexto(metrica)) && !out.includes(metrica)) out.push(metrica);
  }

  const pediuQuantidade = out.includes(_resolverMetricaDataset('quantidade', metricasDataset));
  const pediuTudo = TERMOS_TODAS_METRICAS.some(t => _containsTerm(textoOriginal, normalizarBasico(t)));
  const pediuValorExplicitamente = [
    'faturamento', 'valor', 'valor financeiro', 'valor faturado',
    'valor total', 'vlr', 'receita',
  ].some(t => _containsTerm(textoOriginal, normalizarBasico(t)));

  if (pediuQuantidade && !pediuTudo && !pediuValorExplicitamente) {
    const metricaFaturamento = _resolverMetricaDataset('faturamento', metricasDataset);
    return out.filter(m => m !== metricaFaturamento);
  }

  return out;
}

function _resolverOrdenacao(metricasTexto, metricasDataset, texto = '') {
  const metric = metricasTexto[0] || metricasDataset[0];
  if (!metric) return null;
  const coluna = _normalizarColuna(metric);
  const dir = _containsAny(texto, ['menor', 'pior']) ? 'asc' : 'desc';
  return coluna ? `${coluna}:${dir}` : null;
}

function _resolverOperacaoAnalitica(texto, metricasTexto, metricasDataset) {
  if (!_containsAny(texto, ['media', 'medio', 'promedio'])) return null;

  let granularidade = null;
  if (_containsAny(texto, ['mensal', 'por mes', 'ao mes', 'mes a mes'])) granularidade = 'mes';
  if (_containsAny(texto, ['anual', 'por ano', 'ao ano', 'ano a ano'])) granularidade = 'ano';
  if (_containsAny(texto, ['diaria', 'diario', 'por dia', 'ao dia'])) granularidade = 'dia';
  if (!granularidade) granularidade = 'mes';

  const metrica = metricasTexto[0] || metricasDataset.find(m => _normalizarColuna(m).includes('faturamento')) || metricasDataset[0] || null;
  return {
    operacao: 'media',
    granularidade,
    metrica,
  };
}

function _containsAny(texto, termos) {
  return termos.some(t => _containsTerm(texto, normalizarTexto(t)));
}

function _calcularConfianca({ matches, periodo, agruparPor, filtros, limite, intencaoInfo, metricasTexto, operacaoAnalitica }) {
  let score = 0.66;
  if (intencaoInfo?.score) score += Math.min(0.18, intencaoInfo.score * 0.16);
  if (matches.intencao.length) score += 0.12;
  if (periodo?.tipo && periodo.tipo !== 'nenhum') score += 0.08;
  if (agruparPor) score += 0.03;
  if (Object.keys(filtros || {}).length) score += 0.03;
  if (limite) score += 0.02;
  if (metricasTexto?.length) score += 0.02;
  if (operacaoAnalitica) score += 0.03;
  return Math.min(0.97, Number(score.toFixed(2)));
}

function _containsTerm(texto, termo) {
  if (!termo) return false;
  const escaped = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(texto);
}

function normalizarIntent(intent) {
  if (!intent || typeof intent !== 'object') return intent;
  const periodo = intent.periodo && typeof intent.periodo === 'object' ? intent.periodo : { tipo: 'nenhum' };
  if (!PERIOD_TYPES.has(periodo.tipo)) periodo.tipo = 'nenhum';
  if (periodo.dias != null) periodo.dias = Math.min(Math.max(parseInt(periodo.dias, 10) || 7, 1), 365);
  if (periodo.mes != null) periodo.mes = Math.min(Math.max(parseInt(periodo.mes, 10) || 1, 1), 12);
  if (periodo.ano_base != null) periodo.ano_base = Math.min(Math.max(parseInt(periodo.ano_base, 10) || 0, 1900), 2099);
  if (periodo.ano_comparacao != null) periodo.ano_comparacao = Math.min(Math.max(parseInt(periodo.ano_comparacao, 10) || 0, 1900), 2099);
  intent.periodo = periodo;
  return intent;
}

function _metricasDataset(intencao, datasets) {
  const dataset = (datasets || []).find(d => String(d.id) === String(intencao.dataset_id)) || null;
  return String(dataset?.colunas_metrica || '')
    .split(',')
    .map(_normalizarColuna)
    .filter(Boolean);
}

function _resolverMetricaDataset(nome, metricasDataset) {
  const key = _normalizarColuna(nome);
  if (!key) return '';
  return metricasDataset.find(m => _normalizarColuna(m) === key) || key;
}

function _normalizarColuna(valor) {
  return String(valor || '').replace(/[^\w]/g, '').toLowerCase();
}

module.exports = { resolverLocal, normalizarTexto, normalizarIntent, PERIOD_TYPES };
