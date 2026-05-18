// Motor temporal deterministico do IA Command.
// Mantem a saida em YYYYMMDD para filtros do ERP e evita depender da IA para datas.

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

    case 'comparacao_anual':
      inicio = new Date(ano - 1, 0, 1);
      fim = new Date(ano, 11, 31);
      break;

    case 'comparacao_mensal':
      inicio = _startOfMonth(ano, mes - 1);
      fim = _endOfMonth(ano, mes);
      break;

    case 'comparacao_mesmo_mes': {
      const m = _clampInt(periodo.mes, mes + 1, 1, 12) - 1;
      inicio = _startOfMonth(ano - 1, m);
      fim = _endOfMonth(ano, m);
      break;
    }

    case 'comparacao_acumulado_mes': {
      const m = _clampInt(periodo.mes, mes + 1, 1, 12) - 1;
      inicio = new Date(ano - 1, 0, 1);
      fim = _endOfMonth(ano, m);
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
  const texto = normalizarTexto(mensagem);
  const hoje = _startOfDay(opts.hoje || new Date());
  if (!texto) return { tipo: 'nenhum' };

  const rangeDatas = _explicitDateRange(texto, hoje);
  if (rangeDatas) return { tipo: 'personalizado', data_inicio: rangeDatas.data_inicio, data_fim: rangeDatas.data_fim };

  const comparacao = _hasComparison(texto);
  const mesTexto = _monthFromText(texto);

  if (comparacao) {
    if (_containsTerm(texto, 'mes a mes')) return { tipo: 'comparacao_mensal' };
    if (_containsAny(texto, ['acumulado', 'ytd', 'ate'])) {
      return { tipo: 'comparacao_acumulado_mes', mes: mesTexto || hoje.getMonth() + 1 };
    }
    if (mesTexto) return { tipo: 'comparacao_mesmo_mes', mes: mesTexto };
    if (_containsTerm(texto, 'mesmo periodo') && _containsAny(texto, ['mes', 'mensal'])) return { tipo: 'comparacao_mensal' };
    if (_containsAny(texto, ['mes', 'mensal'])) return { tipo: 'comparacao_mensal' };
    if (_containsAny(texto, ['ano a ano', 'anual'])) return { tipo: 'comparacao_anual' };
    if (_containsTerm(texto, 'ano')) return { tipo: 'comparacao_acumulado_mes', mes: hoje.getMonth() + 1 };
    return { tipo: 'comparacao_anual' };
  }

  const acumulado = _accumulatedRange(texto, hoje);
  if (acumulado) return { tipo: 'personalizado', data_inicio: acumulado.data_inicio, data_fim: acumulado.data_fim };

  const mesNomeado = _namedMonthRange(texto, hoje);
  if (mesNomeado) return { tipo: 'personalizado', data_inicio: mesNomeado.data_inicio, data_fim: mesNomeado.data_fim };

  if (_containsAny(texto, ['hoje', 'hj'])) return { tipo: 'hoje' };
  if (_containsTerm(texto, 'ontem')) return { tipo: 'ontem' };

  const ultimosDias = texto.match(/\bultim[oa]s?\s+(\d{1,3})\s+dias?\b/);
  if (ultimosDias) return { tipo: 'ultimos_N_dias', dias: parseInt(ultimosDias[1], 10) };

  const ultimasSemanas = texto.match(/\bultim[oa]s?\s+(\d{1,2})\s+semanas?\b/);
  if (ultimasSemanas) return { tipo: 'ultimos_N_dias', dias: parseInt(ultimasSemanas[1], 10) * 7 };

  if (_containsAny(texto, ['semana passada', 'semana anterior'])) return { tipo: 'semana_anterior' };
  if (_containsAny(texto, ['esta semana', 'essa semana', 'semana atual', 'da semana'])) return { tipo: 'esta_semana' };

  if (_containsAny(texto, ['q1', 'primeiro trimestre'])) return { tipo: 'primeiro_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['q2', 'segundo trimestre'])) return { tipo: 'segundo_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['q3', 'terceiro trimestre'])) return { tipo: 'terceiro_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['q4', 'quarto trimestre'])) return { tipo: 'quarto_trimestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['ultimo trimestre', 'ult trimestre'])) return { tipo: 'ultimo_trimestre' };

  if (_containsAny(texto, ['primeiro semestre', 'h1'])) return { tipo: 'primeiro_semestre', ano_ref: _anoRefTexto(texto) };
  if (_containsAny(texto, ['segundo semestre', 'h2'])) return { tipo: 'segundo_semestre', ano_ref: _anoRefTexto(texto) };

  if (_containsAny(texto, ['mes passado', 'mes anterior', 'ultimo mes'])) return { tipo: 'mes_anterior' };
  if (_containsAny(texto, ['este mes', 'esse mes', 'mes atual', 'do mes', 'no mes', 'mes'])) return { tipo: 'mes_atual' };

  if (_containsAny(texto, ['ano passado', 'ano anterior', 'ultimo ano'])) return { tipo: 'ano_anterior' };
  if (_containsAny(texto, ['este ano', 'esse ano', 'ano atual', 'do ano', 'no ano', 'ano'])) return { tipo: 'ano_atual' };

  return { tipo: 'nenhum' };
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _resolverPersonalizado(periodo, hoje) {
  const ini = _coerceYmd(periodo.data_inicio, hoje);
  const fim = _coerceYmd(periodo.data_fim, hoje) || ini;
  if (ini) return { dataInicio: ini, dataFim: fim };

  const n = _clampInt(periodo.meses_atras, 1, 1, 60);
  return _range(_startOfMonth(hoje.getFullYear(), hoje.getMonth() - n), _endOfMonth(hoje.getFullYear(), hoje.getMonth() - 1));
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

function _monthsFromText(texto) {
  const out = [];
  for (const [nome, numero] of Object.entries(MONTHS)) {
    if (_containsTerm(texto, nome) && !out.includes(numero)) out.push(numero);
  }
  return out.sort((a, b) => texto.indexOf(_monthName(a)) - texto.indexOf(_monthName(b)));
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

function _anoRefTexto(texto) {
  return _containsAny(texto, ['passado', 'anterior']) ? 'anterior' : 'atual';
}

function _hasComparison(texto) {
  return _containsAny(texto, ['vs', 'versus', 'contra', 'comparar', 'comparativo', 'comparado', 'mesmo periodo', 'ano a ano', 'mes a mes']);
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

module.exports = { resolverPeriodo, identificarPeriodoTexto, normalizarTexto, MONTHS };
