'use strict';

const PLACEHOLDERS = {
  periodStart: '{{iac:period:start}}',
  periodEnd: '{{iac:period:end}}',
};

function escapeRegexLiteral(valor) {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeSqlLiteral(valor) {
  return String(valor ?? '').replace(/'/g, "''");
}

function normalizarData(valor) {
  const v = String(valor || '').trim();
  if (!v) return null;
  const compacto = v.replace(/\D/g, '');
  if (/^\d{8}$/.test(compacto)) return compacto;
  return null;
}

function variantesData(valor) {
  const compacto = normalizarData(valor);
  if (!compacto) return [];
  const iso = `${compacto.slice(0, 4)}-${compacto.slice(4, 6)}-${compacto.slice(6, 8)}`;
  return [...new Set([compacto, iso])];
}

function substituirLiteralSql(sql, valor, placeholder) {
  if (valor === null || valor === undefined || valor === '') return sql;
  const literal = escapeSqlLiteral(valor);
  const re = new RegExp(`'${escapeRegexLiteral(literal)}'`, 'g');
  return String(sql || '').replace(re, `'${placeholder}'`);
}

function parametrizarPeriodo(sql, period = {}) {
  let out = String(sql || '');
  const parametros = [];
  const starts = variantesData(period.start);
  const ends = variantesData(period.end);
  for (const valor of starts) {
    const antes = out;
    out = substituirLiteralSql(out, valor, PLACEHOLDERS.periodStart);
    if (out !== antes) parametros.push({ tipo: 'period', campo: 'start', valor_original: valor, placeholder: PLACEHOLDERS.periodStart });
  }
  for (const valor of ends) {
    const antes = out;
    out = substituirLiteralSql(out, valor, PLACEHOLDERS.periodEnd);
    if (out !== antes) parametros.push({ tipo: 'period', campo: 'end', valor_original: valor, placeholder: PLACEHOLDERS.periodEnd });
  }
  return { sql: out, parametros };
}

function placeholderFiltro(chave) {
  return `{{iac:filter:${String(chave || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}}}`;
}

function valoresFiltroParametrizaveis(filters = {}) {
  const out = [];
  for (const [chave, valor] of Object.entries(filters || {})) {
    if (valor === null || valor === undefined || valor === '') continue;
    if (String(chave).toLowerCase() === 'filial' && /^(todas?|todos?|all)$/i.test(String(valor))) continue;
    const valores = Array.isArray(valor) ? valor : [valor];
    for (const item of valores) {
      if (item === null || item === undefined || item === '') continue;
      if (typeof item === 'object') continue;
      out.push({ chave, valor: String(item), placeholder: placeholderFiltro(chave) });
    }
  }
  return out;
}

function parametrizarFiltros(sql, filters = {}) {
  let out = String(sql || '');
  const parametros = [];
  for (const filtro of valoresFiltroParametrizaveis(filters)) {
    const antes = out;
    out = substituirLiteralSql(out, filtro.valor, filtro.placeholder);
    if (out !== antes) {
      parametros.push({
        tipo: 'filter',
        campo: String(filtro.chave),
        valor_original: filtro.valor,
        placeholder: filtro.placeholder,
      });
    }
  }
  return { sql: out, parametros };
}

function parametrizarSqlTemplate(sql, intentCanonico = {}) {
  const original = String(sql || '');
  let out = original;
  const parametros = [];

  const periodo = parametrizarPeriodo(out, intentCanonico.period || {});
  out = periodo.sql;
  parametros.push(...periodo.parametros);

  const filtros = parametrizarFiltros(out, intentCanonico.filters || {});
  out = filtros.sql;
  parametros.push(...filtros.parametros);

  return {
    sql_template: out,
    parametros,
    alterou: out !== original,
    placeholders_pendentes: listarPlaceholders(out),
  };
}

function aplicarSqlTemplate(sqlTemplate, intentCanonico = {}) {
  let out = String(sqlTemplate || '');
  const aplicados = [];
  const start = normalizarData(intentCanonico.period?.start);
  const end = normalizarData(intentCanonico.period?.end);
  if (start && out.includes(PLACEHOLDERS.periodStart)) {
    out = out.split(PLACEHOLDERS.periodStart).join(escapeSqlLiteral(start));
    aplicados.push({ tipo: 'period', campo: 'start', valor: start });
  }
  if (end && out.includes(PLACEHOLDERS.periodEnd)) {
    out = out.split(PLACEHOLDERS.periodEnd).join(escapeSqlLiteral(end));
    aplicados.push({ tipo: 'period', campo: 'end', valor: end });
  }
  for (const filtro of valoresFiltroParametrizaveis(intentCanonico.filters || {})) {
    if (!out.includes(filtro.placeholder)) continue;
    out = out.split(filtro.placeholder).join(escapeSqlLiteral(filtro.valor));
    aplicados.push({ tipo: 'filter', campo: String(filtro.chave), valor: filtro.valor });
  }
  const pendentes = listarPlaceholders(out);
  const pendentesTemplate = pendentes.filter(p => p.tipo === 'period' || p.tipo === 'filter');
  return { sql: out, aplicados, pendentes, pendentes_template: pendentesTemplate, ok: pendentesTemplate.length === 0 };
}

function listarPlaceholders(sql) {
  return [...String(sql || '').matchAll(/\{\{iac:([a-z0-9_]+):([a-z0-9_]+)(?::([a-z0-9_]+))?\}\}/gi)]
    .map(m => ({ tipo: m[1], campo: m[2], detalhe: m[3] || null, placeholder: m[0] }));
}

module.exports = {
  PLACEHOLDERS,
  parametrizarSqlTemplate,
  aplicarSqlTemplate,
  listarPlaceholders,
  _test: {
    normalizarData,
    variantesData,
    parametrizarPeriodo,
    parametrizarFiltros,
    valoresFiltroParametrizaveis,
  },
};
