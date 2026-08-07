// Motor temporal deterministico do IA Command.
// Mantem a saida em YYYYMMDD para filtros do ERP e evita depender da IA para datas.
const { normalizarTexto } = require('./text-normalizer');

const MONTHS = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
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

function resolverPeriodo(periodo, opts = {}) {
  const hoje = _startOfDay(opts.hoje || new Date());
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const tipo = periodo?.tipo || 'nenhum';

  let inicio;
  let fim;

  switch (tipo) {
    case 'hoje':
      inicio = hoje;
      fim = hoje;
      break;

    case 'ontem':
      inicio = _addDays(hoje, -1);
      fim = inicio;
      break;

    case 'esta_semana':
      inicio = _startOfWeek(hoje);
      fim = hoje;
      break;

    case 'semana_anterior':
      fim = _addDays(_startOfWeek(hoje), -1);
      inicio = _startOfWeek(fim);
      break;

    case 'proxima_semana':
      inicio = _addDays(_startOfWeek(hoje), 7);
      fim = _addDays(inicio, 6);
      break;

    case 'ultimos_N_dias': {
      const n = _clampInt(periodo.dias, 7, 1, 365);
      inicio = _addDays(hoje, -(n - 1));
      fim = hoje;
      break;
    }

    case 'primeiro_trimestre':
      [inicio, fim] = _quarterRange(_anoRef(periodo, ano), 1);
      break;
    case 'segundo_trimestre':
      [inicio, fim] = _quarterRange(_anoRef(periodo, ano), 2);
      break;
    case 'terceiro_trimestre':
      [inicio, fim] = _quarterRange(_anoRef(periodo, ano), 3);
      break;
    case 'quarto_trimestre':
      [inicio, fim] = _quarterRange(_anoRef(periodo, ano), 4);
      break;

    case 'primeiro_semestre':
      inicio = new Date(_anoRef(periodo, ano), 0, 1);
      fim = new Date(_anoRef(periodo, ano), 5, 30);
      break;

    case 'segundo_semestre':
      inicio = new Date(_anoRef(periodo, ano), 6, 1);
      fim = new Date(_anoRef(periodo, ano), 11, 31);
      break;

    case 'mes_atual':
      inicio = _startOfMonth(ano, mes);
      fim = _endOfMonth(ano, mes);
      break;

    case 'mes_anterior':
      inicio = _startOfMonth(ano, mes - 1);
      fim = _endOfMonth(ano, mes - 1);
      break;

    case 'ano_atual':
      inicio = new Date(ano, 0, 1);
      fim = new Date(ano, 11, 31);
      break;

    case 'ano_anterior':
      inicio = new Date(ano - 1, 0, 1);
      fim = new Date(ano - 1, 11, 31);
      break;

    case 'comparacao_anual': {
      const anoBase = _clampInt(periodo.ano_base, ano - 1, 1900, 2099);
      const anoComparacao = _clampInt(periodo.ano_comparacao, ano, 1900, 2099);
      inicio = new Date(Math.min(anoBase, anoComparacao), 0, 1);
      fim = new Date(Math.max(anoBase, anoComparacao), 11, 31);
      break;
    }

    case 'comparacao_mensal':
      inicio = _startOfMonth(ano, mes - 1);
      fim = _endOfMonth(ano, mes);
      break;

    case 'comparacao_mensal_entre_anos': {
      const anoBase = _clampInt(periodo.ano_base, ano - 1, 1900, 2099);
      const anoComparacao = _clampInt(periodo.ano_comparacao, ano, 1900, 2099);
      const menorAno = Math.min(anoBase, anoComparacao);
      const maiorAno = Math.max(anoBase, anoComparacao);
      inicio = new Date(menorAno, 0, 1);
      fim = new Date(maiorAno, 11, 31);
      break;
    }

    case 'comparacao_mesmo_mes': {
      const m = _clampInt(periodo.mes, mes + 1, 1, 12) - 1;
      inicio = _startOfMonth(ano - 1, m);
      fim = _endOfMonth(ano, m);
      break;
    }

    case 'comparacao_acumulado_mes': {
      const m = _clampInt(periodo.mes, mes + 1, 1, 12) - 1;
      const anoBase = _clampInt(periodo.ano_base, ano - 1, 1900, 2099);
      const anoComparacao = _clampInt(periodo.ano_comparacao, ano, 1900, 2099);
      inicio = new Date(Math.min(anoBase, anoComparacao), 0, 1);
      fim = _endOfMonth(Math.max(anoBase, anoComparacao), m);
      break;
    }

    case 'ultimo_trimestre':
      [inicio, fim] = _lastClosedQuarter(hoje);
      break;

    case 'personalizado':
      return _resolverPersonalizado(periodo, hoje);

    default:
      return { dataInicio: null, dataFim: null };
  }

  return _range(inicio, fim);
}

function identificarPeriodoTexto(mensagem, opts = {}) {
  const texto = normalizarTexto(mensagem, opts.normalizacoes || opts.regrasNormalizacao || []);
  const hoje = _startOfDay(opts.hoje || new Date());
  if (!texto) return { tipo: 'nenhum' };

  const rangeDatas = _explicitDateRange(texto, hoje);
  if (rangeDatas) return { tipo: 'personalizado', data_inicio: rangeDatas.data_inicio, data_fim: rangeDatas.data_fim };

  const comparacao = _hasComparison(texto);
  const mesTexto = _monthFromText(texto);

  if (comparacao) {
    if (_referenciaComparativoHistorico(texto) && !_temMesOuAnoExplicito(texto)) {
      return { tipo: 'nenhum', referencia_contexto: true };
    }
    const anosComparacao = _yearsFromTextExpandido(texto);
    if (_containsTerm(texto, 'ano') && _containsAny(texto, ['ano anterior', 'ano passado']) && _containsAny(texto, ['ano atual', 'este ano', 'esse ano', 'atual'])) {
      return {
        tipo: 'comparacao_anual',
        ano_base: hoje.getFullYear() - 1,
        ano_comparacao: hoje.getFullYear(),
      };
    }
    if (anosComparacao.length >= 2 && _isMonthlyComparison(texto) && !mesTexto) {
      return {
        tipo: 'comparacao_mensal_entre_anos',
        ano_base: anosComparacao[0],
        ano_comparacao: anosComparacao[1],
      };
    }
    if (_containsTerm(texto, 'mes a mes')) return { tipo: 'comparacao_mensal' };
    if (anosComparacao.length >= 3) {
      // 3+ anos citados: os tipos de comparacao acumulada/range abaixo so guardam
      // ano_base/ano_comparacao (2 anos), perderiam os anos intermediarios. Delega para
      // range explicito (personalizado) cobrindo todos os anos citados; o filtro fino de
      // mes/ano fica a cargo do SQL (SUBSTRING), a partir da pergunta original.
      const primeiro = Math.min(...anosComparacao);
      const ultimo = Math.max(...anosComparacao);
      return { tipo: 'personalizado', data_inicio: `${primeiro}0101`, data_fim: `${ultimo}1231` };
    }
    if (_containsAny(texto, ['acumulado', 'ytd', 'ate', 'jan a', 'janeiro a'])) {
      const meses = _monthsFromText(texto);
      const mesFinal = meses.length >= 2 ? Math.max(...meses) : (meses[0] || hoje.getMonth() + 1);
      return { tipo: 'comparacao_acumulado_mes', mes: mesFinal, ano_base: anosComparacao[0] || hoje.getFullYear() - 1, ano_comparacao: anosComparacao[1] || hoje.getFullYear() };
    }
    // range de meses explícito ("de janeiro a maio", "janeiro a maio") com dois anos = acumulado
    const mesesRange = _monthsFromText(texto);
    if (mesesRange.length >= 2 && anosComparacao.length >= 2) {
      return { tipo: 'comparacao_acumulado_mes', mes: Math.max(...mesesRange), ano_base: anosComparacao[0], ano_comparacao: anosComparacao[1] };
    }
    const mesesMesmoAno = _comparacaoMesesMesmoAno(texto, hoje);
    if (mesesMesmoAno) return mesesMesmoAno;
    if (
      mesTexto
      && _containsAny(texto, ['ano passado', 'ano anterior'])
      && !_containsAny(texto, ['ano atual', 'este ano', 'esse ano', 'atual'])
    ) {
      const anoRef = hoje.getFullYear() - 1;
      const mm = String(mesTexto).padStart(2, '0');
      return {
        tipo: 'personalizado',
        data_inicio: `${anoRef}${mm}01`,
        data_fim: _fmt(_endOfMonth(anoRef, mesTexto - 1)),
      };
    }
    if (mesTexto) return { tipo: 'comparacao_mesmo_mes', mes: mesTexto };
    if (anosComparacao.length >= 2) {
      return {
        tipo: 'comparacao_anual',
        ano_base: anosComparacao[0],
        ano_comparacao: anosComparacao[1],
      };
    }
    if (_containsTerm(texto, 'mesmo periodo') && _containsAny(texto, ['mes', 'mensal'])) return { tipo: 'comparacao_mensal' };
    if (_containsAny(texto, ['mes', 'mensal'])) return { tipo: 'comparacao_mensal' };
    if (_containsAny(texto, ['ano a ano', 'anual'])) return { tipo: 'comparacao_anual' };
    if (_containsTerm(texto, 'ano')) return { tipo: 'comparacao_acumulado_mes', mes: hoje.getMonth() + 1 };
    return { tipo: 'comparacao_anual' };
  }

  const rangeAnoAteMes = _yearToNamedMonthRange(texto);
  if (rangeAnoAteMes) return { tipo: 'personalizado', data_inicio: rangeAnoAteMes.data_inicio, data_fim: rangeAnoAteMes.data_fim };

  const mesesRecorrentesVariosAnos = _recurringMonthsMultiYearRange(texto);
  if (mesesRecorrentesVariosAnos) return { tipo: 'personalizado', data_inicio: mesesRecorrentesVariosAnos.data_inicio, data_fim: mesesRecorrentesVariosAnos.data_fim };

  const acumulado = _accumulatedRange(texto, hoje);
  if (acumulado) return { tipo: 'personalizado', data_inicio: acumulado.data_inicio, data_fim: acumulado.data_fim };

  const mesNomeado = _namedMonthRange(texto, hoje);
  if (mesNomeado) return { tipo: 'personalizado', data_inicio: mesNomeado.data_inicio, data_fim: mesNomeado.data_fim };

  const rangeAnos = _multiYearRange(texto);
  if (rangeAnos) return { tipo: 'personalizado', data_inicio: rangeAnos.data_inicio, data_fim: rangeAnos.data_fim };

  const anoExplicito = texto.match(/\b(?:ano\s+de\s+|ano\s+)?(20\d{2}|19\d{2})\b/);
  if (anoExplicito && _containsTerm(texto, 'ano')) {
    const ano = parseInt(anoExplicito[1], 10);
    return { tipo: 'personalizado', data_inicio: `${ano}0101`, data_fim: `${ano}1231` };
  }

  const anoSolto = texto.match(/\b(?:em|de|do|da|no|na)\s+(20\d{2}|19\d{2})\b/);
  if (anoSolto) {
    const ano = parseInt(anoSolto[1], 10);
    return { tipo: 'personalizado', data_inicio: `${ano}0101`, data_fim: `${ano}1231` };
  }

  const anoNumericoSolto = texto.match(/\b(20\d{2}|19\d{2})\b/);
  if (anoNumericoSolto && !_temIndicadorDataParcial(texto, anoNumericoSolto[1])) {
    const ano = parseInt(anoNumericoSolto[1], 10);
    return { tipo: 'personalizado', data_inicio: `${ano}0101`, data_fim: `${ano}1231` };
  }

  if (_containsAny(texto, ['hoje', 'hj'])) return { tipo: 'hoje' };
  if (_containsTerm(texto, 'ontem')) return { tipo: 'ontem' };

  const ultimosDias = texto.match(/\bultim[oa]s?\s+(\d{1,3})\s+dias?\b/);
  if (ultimosDias) return { tipo: 'ultimos_N_dias', dias: parseInt(ultimosDias[1], 10) };

  const ultimasSemanas = texto.match(/\bultim[oa]s?\s+(\d{1,2})\s+semanas?\b/);
  if (ultimasSemanas) return { tipo: 'ultimos_N_dias', dias: parseInt(ultimasSemanas[1], 10) * 7 };

  const ultimosAnos = _matchUltimosQuantidade(texto, 'anos?');
  if (ultimosAnos) return _ultimosMeses(hoje, ultimosAnos * 12);

  const ultimosMeses = _matchUltimosQuantidade(texto, 'mes(?:es)?');
  if (ultimosMeses) return _ultimosMeses(hoje, ultimosMeses);

  if (_containsAny(texto, ['semana passada', 'semana anterior'])) return { tipo: 'semana_anterior' };
  if (_containsAny(texto, ['semana que vem', 'proxima semana', 'semana seguinte', 'semana que vira'])) return { tipo: 'proxima_semana' };
  if (_containsAny(texto, ['esta semana', 'essa semana', 'semana atual', 'da semana'])) return { tipo: 'esta_semana' };

  if (_containsAny(texto, ['q1', 'primeiro trimestre'])) return { tipo: 'primeiro_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['q2', 'segundo trimestre'])) return { tipo: 'segundo_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['q3', 'terceiro trimestre'])) return { tipo: 'terceiro_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['q4', 'quarto trimestre'])) return { tipo: 'quarto_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['ultimo trimestre', 'ult trimestre'])) return { tipo: 'ultimo_trimestre' };

  if (_containsAny(texto, ['primeiro semestre', 'h1'])) return { tipo: 'primeiro_semestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['segundo semestre', 'h2'])) return { tipo: 'segundo_semestre', ano_ref: _anoRefTexto(texto) };

  const textoPeriodo = _removerAgrupamentosTemporais(texto);

  if (_containsAny(textoPeriodo, ['mes passado', 'mes anterior', 'ultimo mes'])) return { tipo: 'mes_anterior' };
  if (_containsAny(textoPeriodo, ['este mes', 'esse mes', 'mes atual', 'do mes', 'no mes', 'mes'])) return { tipo: 'mes_atual' };

  if (_containsAny(textoPeriodo, ['ano passado', 'ano anterior', 'ultimo ano'])) return { tipo: 'ano_anterior' };
  if (_containsAny(textoPeriodo, ['este ano', 'esse ano', 'ano atual', 'do ano', 'no ano', 'ano'])) return { tipo: 'ano_atual' };

  return { tipo: 'nenhum' };
}

function _removerAgrupamentosTemporais(texto) {
  return String(texto || '')
    .replace(/\bmes(?:es)?\s+(?:com|de)\s+(?:maior|menor|melhor|pior)\b/g, ' ')
    .replace(/\b(?:maior|menor|melhor|pior)\s+mes(?:es)?\b/g, ' ')
    .replace(/\bpor\s+dias?\b/g, ' ')
    .replace(/\be\s+dias?\b/g, ' ')
    .replace(/\bdias?\s+e\b/g, ' ')
    .replace(/\bdias?\s+a\s+dias?\b/g, ' ')
    .replace(/\bpor\s+mes(?:es)?\b/g, ' ')
    .replace(/\be\s+mes(?:es)?\b/g, ' ')
    .replace(/\bmes(?:es)?\s+e\b/g, ' ')
    .replace(/\bmes\s+a\s+mes\b/g, ' ')
    .replace(/\bpor\s+ano\b/g, ' ')
    .replace(/\be\s+ano\b/g, ' ')
    .replace(/\bano\s+a\s+ano\b/g, ' ');
}

function _resolverPersonalizado(periodo, hoje) {
  const ini = _coerceYmd(periodo.data_inicio, hoje);
  const fim = _coerceYmd(periodo.data_fim, hoje) || ini;
  if (ini) {
    const extras = {};
    if (Array.isArray(periodo.meses)) extras.meses = periodo.meses;
    if (Array.isArray(periodo.anos)) extras.anos = periodo.anos;
    if (Array.isArray(periodo.periodos_comparativos)) extras.periodos_comparativos = periodo.periodos_comparativos;
    return { dataInicio: ini, dataFim: fim, ...extras };
  }

  const n = _clampInt(periodo.meses_atras, 1, 1, 60);
  return _range(_startOfMonth(hoje.getFullYear(), hoje.getMonth() - n), _endOfMonth(hoje.getFullYear(), hoje.getMonth() - 1));
}

function _temIndicadorDataParcial(texto, ano) {
  const idx = String(texto || '').indexOf(String(ano));
  const janela = idx >= 0 ? String(texto || '').slice(Math.max(0, idx - 8), idx + 12) : String(texto || '');
  return /(\d{1,2}[/-]\d{1,2})|(\b(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|janeiro|fevereiro|marco|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b)/i.test(janela);
}

function _explicitDateRange(texto, hoje) {
  const matches = [...texto.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g)];
  if (!matches.length) return null;

  const first = _parseDateParts(matches[0], hoje);
  const last = matches[1] ? _parseDateParts(matches[1], hoje) : first;
  if (!first || !last) return null;

  return { data_inicio: _fmt(first <= last ? first : last), data_fim: _fmt(first <= last ? last : first) };
}

function _accumulatedRange(texto, hoje) {
  if (!_containsAny(texto, ['acumulado', 'ytd', 'ate', 'jan a', 'janeiro a'])) return null;
  const meses = _monthsFromText(texto);
  if (!meses.length) return null;
  const mes = meses[meses.length - 1];
  const ano = _yearFromText(texto, hoje);
  return { data_inicio: _fmt(new Date(ano, 0, 1)), data_fim: _fmt(_endOfMonth(ano, mes - 1)) };
}

function _namedMonthRange(texto, hoje) {
  const meses = _monthsFromText(texto);
  if (!meses.length) return null;
  const ano = _yearFromText(texto, hoje);
  const first = meses[0];
  const last = meses[1] || first;
  return {
    data_inicio: _fmt(_startOfMonth(ano, Math.min(first, last) - 1)),
    data_fim: _fmt(_endOfMonth(ano, Math.max(first, last) - 1)),
  };
}

function _comparacaoMesesMesmoAno(texto, hoje) {
  if (!_hasComparison(texto)) return null;
  const meses = _monthsFromText(texto);
  const distintos = [...new Set(meses)];
  if (distintos.length < 2) return null;

  const anosExplicitos = _yearsFromTextExpandido(texto);
  if (anosExplicitos.length > 1) return null;

  const ano = anosExplicitos[0] || _yearFromText(texto, hoje);
  const mesesOrdenados = [...distintos].sort((a, b) => a - b);
  const inicioMes = mesesOrdenados[0];
  const fimMes = mesesOrdenados[mesesOrdenados.length - 1];
  const periodoMes = mes => {
    const mm = String(mes).padStart(2, '0');
    return {
      label: `${ano}${mm}`,
      dataInicio: _fmt(_startOfMonth(ano, mes - 1)),
      dataFim: _fmt(_endOfMonth(ano, mes - 1)),
    };
  };

  return {
    tipo: 'personalizado',
    data_inicio: _fmt(_startOfMonth(ano, inicioMes - 1)),
    data_fim: _fmt(_endOfMonth(ano, fimMes - 1)),
    meses: mesesOrdenados,
    anos: [ano],
    periodos_comparativos: mesesOrdenados.map(periodoMes),
  };
}

function _recurringMonthsMultiYearRange(texto) {
  const meses = _monthsFromText(texto);
  const anos = _yearsFromTextExpandido(texto);
  if (meses.length < 1 || anos.length < 2 || !_containsAny(texto, ['ano', 'anos'])) return null;
  const primeiro = Math.min(...anos);
  const ultimo = Math.max(...anos);
  return {
    data_inicio: `${primeiro}0101`,
    data_fim: `${ultimo}1231`,
  };
}

function _yearToNamedMonthRange(texto) {
  const monthPattern = Object.keys(MONTHS)
    .sort((a, b) => b.length - a.length)
    .join('|');

  const patterns = [
    new RegExp(`\\b(?:ano\\s+de\\s+|ano\\s+)?(20\\d{2}|19\\d{2})\\s+(?:ate|a)\\s+(${monthPattern})\\s+(?:de\\s+)?(20\\d{2}|19\\d{2})\\b`),
    new RegExp(`\\b(?:de\\s+)?(20\\d{2}|19\\d{2})\\s+(?:ate|a)\\s+(${monthPattern})\\s+(?:de\\s+)?(20\\d{2}|19\\d{2})\\b`),
  ];

  for (const pattern of patterns) {
    const m = texto.match(pattern);
    if (!m) continue;
    const anoInicio = parseInt(m[1], 10);
    const mesFim = MONTHS[m[2]];
    const anoFim = parseInt(m[3], 10);
    if (!anoInicio || !mesFim || !anoFim) continue;
    return {
      data_inicio: _fmt(new Date(anoInicio, 0, 1)),
      data_fim: _fmt(_endOfMonth(anoFim, mesFim - 1)),
    };
  }

  return null;
}

function _multiYearRange(texto) {
  if (!_containsAny(texto, ['ano', 'anos'])) return null;
  const anos = _yearsFromText(texto);
  if (anos.length < 2) return null;
  const primeiro = Math.min(...anos);
  const ultimo = Math.max(...anos);
  return {
    data_inicio: `${primeiro}0101`,
    data_fim: `${ultimo}1231`,
  };
}

function _ultimosMeses(hoje, meses) {
  const n = _clampInt(meses, 1, 1, 120);
  const inicio = _startOfMonth(hoje.getFullYear(), hoje.getMonth() - n + 1);
  const fim = _endOfMonth(hoje.getFullYear(), hoje.getMonth());
  return { tipo: 'personalizado', data_inicio: _fmt(inicio), data_fim: _fmt(fim) };
}

function _matchUltimosQuantidade(texto, unidadeRegex) {
  const m = texto.match(new RegExp(`\\bultim[oa]s?\\s+([\\w]+)\\s+${unidadeRegex}\\b`));
  if (!m) return null;
  return _numeroNatural(m[1]);
}

function _numeroNatural(valor) {
  if (/^\d+$/.test(String(valor))) return parseInt(valor, 10);
  const mapa = {
    um: 1, uma: 1,
    dois: 2, duas: 2,
    tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, vintequatro: 24,
  };
  return mapa[normalizarTexto(valor).replace(/\s+/g, '')] || null;
}

function _monthsFromText(texto) {
  const out = [];
  for (const [nome, numero] of Object.entries(MONTHS)) {
    if (nome === 'dez' && _dezEhQuantidadeRanking(texto)) continue;
    if (_containsTerm(texto, nome) && !out.includes(numero)) out.push(numero);
  }
  return out.sort((a, b) => texto.indexOf(_monthName(a)) - texto.indexOf(_monthName(b)));
}

function _dezEhQuantidadeRanking(texto) {
  const t = String(texto || '');
  return /\bdez\s+(?:maior(?:es)?|menor(?:es)?|melhor(?:es)?|pior(?:es)?|clientes?|produtos?|fornecedores?|vendedores?|itens?)\b/i.test(t)
    || /\b(?:top|ranking|rank)\s+dez\b/i.test(t);
}

function _monthName(numero) {
  return Object.keys(MONTHS).find(k => MONTHS[k] === numero) || '';
}

function _monthFromText(texto) {
  return _monthsFromText(texto)[0] || null;
}

function _yearFromText(texto, hoje) {
  const explicit = texto.match(/\b(20\d{2}|19\d{2})\b/);
  if (explicit) return parseInt(explicit[1], 10);
  if (_containsAny(texto, ['ano passado', 'ano anterior', 'passado'])) return hoje.getFullYear() - 1;
  return hoje.getFullYear();
}

function _yearsFromText(texto) {
  const years = [];
  for (const match of texto.matchAll(/\b(20\d{2}|19\d{2})\b/g)) {
    const ano = parseInt(match[1], 10);
    if (!years.includes(ano)) years.push(ano);
  }
  return years;
}

function _yearsFromTextExpandido(texto) {
  // "anos de 2024 a 2026" / "de 2024 ate 2026": o ano do meio (2025) e implicito pelo
  // range, nao aparece como numero literal no texto. _yearsFromText sozinho retornaria
  // so [2024, 2026], levando o resolvedor a tratar como comparacao de 2 anos e perder 2025.
  const rangeMatch = texto.match(/\b(20\d{2}|19\d{2})\s+(?:a|ate)\s+(20\d{2}|19\d{2})\b/);
  if (rangeMatch) {
    const inicio = parseInt(rangeMatch[1], 10);
    const fim = parseInt(rangeMatch[2], 10);
    if (fim >= inicio && fim - inicio <= 20) {
      const anos = [];
      for (let a = inicio; a <= fim; a++) anos.push(a);
      return anos;
    }
  }
  return _yearsFromText(texto);
}

function _isMonthlyComparison(texto) {
  return _containsAny(texto, ['mes a mes', 'mensal', 'por mes', 'cada mes']);
}

function _anoRefTexto(texto) {
  return _containsAny(texto, ['passado', 'anterior']) ? 'anterior' : 'atual';
}

function _hasComparison(texto) {
  return _containsAny(texto, ['vs', 'versus', 'contra', 'comparar', 'comparando', 'comparativo', 'comparado', 'crescimento', 'mesmo periodo', 'ano a ano', 'mes a mes']);
}

function _containsAny(texto, termos) {
  return termos.some(t => _containsTerm(texto, normalizarTexto(t)));
}

function _containsTerm(texto, termo) {
  if (!termo) return false;
  const escaped = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(texto);
}

function _parseDateParts(match, hoje) {
  const dia = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  let ano = match[3] ? parseInt(match[3], 10) : hoje.getFullYear();
  if (ano < 100) ano += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

function _coerceYmd(value, hoje) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const br = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (br) {
    const d = _parseDateParts(br, hoje);
    return d ? _fmt(d) : null;
  }
  return null;
}

function _anoRef(periodo, anoAtual) {
  return periodo?.ano_ref === 'anterior' ? anoAtual - 1 : anoAtual;
}

function _quarterRange(ano, quarter) {
  const startMonth = (quarter - 1) * 3;
  return [_startOfMonth(ano, startMonth), _endOfMonth(ano, startMonth + 2)];
}

function _lastClosedQuarter(hoje) {
  const currentQuarter = Math.floor(hoje.getMonth() / 3) + 1;
  const quarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
  const ano = currentQuarter === 1 ? hoje.getFullYear() - 1 : hoje.getFullYear();
  return _quarterRange(ano, quarter);
}

function _startOfWeek(d) {
  const day = d.getDay();
  return _addDays(d, -(day === 0 ? 6 : day - 1));
}

function _startOfMonth(ano, mes) {
  return new Date(ano, mes, 1);
}

function _endOfMonth(ano, mes) {
  return new Date(ano, mes + 1, 0);
}

function _addDays(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function _referenciaComparativoHistorico(texto) {
  return /\b(?:desses|destes|esses|estes)\s+(?:dois\s+)?(?:meses|periodos)\b/.test(texto)
    || /\b(?:dos|os)\s+dois\s+(?:meses|periodos)\b/.test(texto);
}

function _temMesOuAnoExplicito(texto) {
  return !!_monthFromText(texto) || /\b(?:19|20)\d{2}\b/.test(texto) || /\b(?:ano passado|ano anterior|ano atual|este ano|esse ano)\b/.test(texto);
}

function _startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _range(inicio, fim) {
  return { dataInicio: _fmt(inicio), dataFim: _fmt(fim) };
}

function _fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function _clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

module.exports = { resolverPeriodo, identificarPeriodoTexto, normalizarTexto, MONTHS, _yearsFromTextExpandido };
