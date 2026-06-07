'use strict';

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escaparRegex(valor) {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termosEmpresa(contexto = {}) {
  const termos = Array.isArray(contexto.empresasMencionadasTextos) && contexto.empresasMencionadasTextos.length
    ? contexto.empresasMencionadasTextos
    : [contexto.empresaMencionadaTexto];
  return [...new Set(termos.map(t => normalizarTexto(t || '')).filter(Boolean))];
}

function campoParaRegex(campo) {
  return String(campo || '')
    .trim()
    .replace('.', '\\s*\\.\\s*');
}

function removerPredicadoSql(sql, pred) {
  let out = String(sql || '');
  out = out.replace(new RegExp(`\\s+AND\\s+${pred}`, 'gi'), '');
  out = out.replace(new RegExp(`\\s+WHERE\\s+${pred}\\s+AND\\s+`, 'gi'), ' WHERE ');
  out = out.replace(new RegExp(`\\s+WHERE\\s+${pred}(\\s*(?:GROUP\\s+BY|ORDER\\s+BY|HAVING|;|$))`, 'gi'), '$1');
  return out;
}

function removerItemGroupBy(sql, campos = []) {
  let out = String(sql || '');
  for (const campo of campos) {
    const campoRe = campoParaRegex(campo);
    out = out.replace(new RegExp(`\\s+GROUP\\s+BY\\s+${campoRe}\\s*(?=ORDER\\s+BY|HAVING|;|$)`, 'gi'), '');
    out = out.replace(new RegExp(`(GROUP\\s+BY[\\s\\S]{0,500}?),\\s*${campoRe}\\b`, 'gi'), '$1');
    out = out.replace(new RegExp(`(GROUP\\s+BY\\s*)${campoRe}\\s*,\\s*`, 'gi'), '$1');
  }
  return out;
}

function removerFiltrosEmpresaComoEntidade(sql = '', contexto = {}, opts = {}) {
  let out = String(sql || '');
  const termos = termosEmpresa(contexto);
  if (!termos.length) return out;

  const campos = Array.isArray(opts.campos) ? opts.campos : [];
  const camposGroupBy = Array.isArray(opts.camposGroupBy) ? opts.camposGroupBy : campos;
  const camposFilialLiteral = Array.isArray(opts.camposFilialLiteral)
    ? opts.camposFilialLiteral
    : campos.filter(campo => /_FILIAL$/i.test(String(campo || '').trim()));

  for (const termo of termos) {
    const valorRe = escaparRegex(termo.replace(/'/g, "''"));
    for (const campo of campos) {
      const campoRe = campoParaRegex(campo);
      out = removerPredicadoSql(out, `${campoRe}\\s*=\\s*'${valorRe}'`);
      out = removerPredicadoSql(out, `${campoRe}\\s+IN\\s*\\([\\s\\S]{0,300}'${valorRe}'[\\s\\S]{0,300}?\\)`);
      out = removerPredicadoSql(out, `${campoRe}\\s+LIKE\\s*'[^']*${valorRe}[^']*'`);
    }
  }

  for (const campo of camposFilialLiteral) {
    const campoRe = campoParaRegex(campo);
    out = removerPredicadoSql(out, `${campoRe}\\s*=\\s*'[^']+'`);
    out = removerPredicadoSql(out, `${campoRe}\\s+IN\\s*\\([^)]*\\)`);
  }

  return removerItemGroupBy(out, camposGroupBy);
}

module.exports = {
  removerFiltrosEmpresaComoEntidade,
  termosEmpresa,
  _test: {
    normalizarTexto,
    removerPredicadoSql,
    removerItemGroupBy,
  },
};
