'use strict';

function _escapeRegexLiteral(valor) {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _normalizarTipo(tipo) {
  return String(tipo || '').trim().toLowerCase();
}

const CAMPOS_CODIGO_EQUIVALENTES = {
  cliente: ['A1_COD', 'E1_CLIENTE', 'F2_CLIENTE', 'D2_CLIENTE', 'E3_CLIENT'],
  fornecedor: ['A2_COD', 'E2_FORNECE', 'F1_FORNECE', 'D1_FORNECE'],
  vendedor: ['A3_COD', 'E3_VEND', 'E3_VENDED', 'F2_VEND1', 'F2_VEND2', 'F2_VEND3', 'F2_VEND4', 'F2_VEND5'],
  // Tipo exclusivo de segurança: código ERP do remetente por empresa, resolvido pelo sistema
  // (não pelo usuário). Usa os mesmos campos do vendedor para parametrização do SQL canônico.
  // Nunca deve ser confundido com entidade de negócio pedida pelo usuário.
  vendedor_fixo_seguranca: ['E3_VEND', 'E3_VENDED'],
  produto: ['B1_COD', 'D1_COD', 'D2_COD'],
  grupo_produto: ['BM_GRUPO', 'B1_GRUPO'],
  centro_custo: ['CTT_CUSTO', 'D1_CC', 'D2_CCUSTO'],
  natureza: ['ED_CODIGO', 'E1_NATUREZ', 'E2_NATUREZ', 'D1_NATUREZ'],
  tes: ['F4_CODIGO', 'D1_TES'],
};

const CAMPOS_LOJA_EQUIVALENTES = {
  cliente: ['A1_LOJA', 'E1_LOJA', 'F2_LOJA', 'D2_LOJA', 'E3_LOJA'],
  fornecedor: ['A2_LOJA', 'E2_LOJA', 'F1_LOJA', 'D1_LOJA'],
};

function _sqlSemComentarios(sql) {
  return String(sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function _whereSql(sql) {
  const texto = _sqlSemComentarios(sql);
  const m = texto.match(/\bWHERE\b([\s\S]*)/i);
  if (!m) return '';
  return m[1].split(/\bGROUP\s+BY\b|\bORDER\s+BY\b|\bHAVING\b/i)[0] || '';
}

function sqlTemCampoValor(sql, campo, valor) {
  if (!valor) return true;
  const re = new RegExp(`\\b(?:[A-Z0-9_]+\\.)?${_escapeRegexLiteral(campo)}\\s*=\\s*'${_escapeRegexLiteral(valor)}'`, 'i');
  return re.test(_sqlSemComentarios(sql));
}

function _whereTemFiltroNome(sql, campos = []) {
  const where = _whereSql(sql);
  return (campos || []).some(campo => {
    const re = new RegExp(`\\b(?:[A-Z0-9_]+\\.)?${_escapeRegexLiteral(campo)}\\s*(?:=|LIKE)\\s*'`, 'i');
    return re.test(where);
  });
}

function _camposCodigo(def = {}, tipo) {
  return [...new Set([
    def.codigoCampo,
    ...(CAMPOS_CODIGO_EQUIVALENTES[_normalizarTipo(tipo)] || []),
  ].filter(Boolean))];
}

function _camposLoja(def = {}, tipo) {
  return [...new Set([
    def.lojaCampo,
    ...(CAMPOS_LOJA_EQUIVALENTES[_normalizarTipo(tipo)] || []),
  ].filter(Boolean))];
}

function validarSqlEntidadesResolvidas(sql, contexto = {}, definicoes = {}) {
  const entidades = Array.isArray(contexto.entidades) ? contexto.entidades : [];
  const erros = [];
  if (!entidades.length) return { ok: true, erros };

  for (const entidade of entidades) {
    const tipo = _normalizarTipo(entidade?.tipo);
    const def = definicoes[tipo] || {};
    if (!tipo || !entidade?.codigo) continue;

    const camposCodigo = _camposCodigo(def, tipo);
    const temCodigo = camposCodigo.length && camposCodigo.some(campo => sqlTemCampoValor(sql, campo, entidade.codigo));

    if (_whereTemFiltroNome(sql, def.nomeCampos || []) && !temCodigo) {
      erros.push(`SQL filtrou ${tipo} por nome/descricao; use codigo interno${def.lojaCampo ? ' e loja' : ''} da entidade resolvida.`);
    }

    if (camposCodigo.length && !temCodigo) {
      erros.push(`SQL nao aplicou filtro de codigo do ${tipo} ${entidade.codigo}.`);
    }

    const camposLoja = _camposLoja(def, tipo);
    if (entidade.loja && !entidade._todos && camposLoja.length && !camposLoja.some(campo => sqlTemCampoValor(sql, campo, entidade.loja))) {
      erros.push(`SQL nao aplicou filtro da loja ${entidade.loja} do ${tipo}.`);
    }
  }

  return { ok: erros.length === 0, erros };
}

function termosDeFiltrosEstruturados(filtros = {}, mapa = {}) {
  const termos = [];
  const add = (tipo, valor) => {
    const texto = String(valor || '').trim();
    if (texto) termos.push({ texto, tipo_sugerido: tipo, confianca: 1, origem: 'filtro_estruturado' });
  };
  for (const [campoFiltro, tipo] of Object.entries(mapa || {})) {
    if (filtros[campoFiltro]) add(tipo, filtros[campoFiltro]);
  }
  return termos;
}

function removerHintsNoLock(sql) {
  return String(sql || '').replace(/\s+WITH\s*\(\s*NOLOCK\s*\)/gi, '');
}

function _placeholder(tipo, campo) {
  return `{{iac:${_normalizarTipo(tipo)}:${campo}}}`;
}

function _replaceValorCampo(sql, campos = [], valor, replacement) {
  if (!valor) return sql;
  let out = String(sql || '');
  for (const campo of campos || []) {
    if (!campo) continue;
    const re = new RegExp(`(\\b(?:[A-Z0-9_]+\\.)?${_escapeRegexLiteral(campo)}\\s*=\\s*)'${_escapeRegexLiteral(valor)}'`, 'gi');
    out = out.replace(re, `$1'${replacement}'`);
  }
  return out;
}

function parametrizarSqlEntidadesResolvidas(sql, entidades = [], definicoes = {}) {
  let out = String(sql || '');
  const parametros = [];
  for (const entidade of entidades || []) {
    const tipo = _normalizarTipo(entidade?.tipo);
    const def = definicoes[tipo] || {};
    if (!tipo || !entidade?.codigo) continue;

    const codigoPh = _placeholder(tipo, 'codigo');
    const antesCodigo = out;
    out = _replaceValorCampo(out, _camposCodigo(def, tipo), entidade.codigo, codigoPh);
    if (out !== antesCodigo) parametros.push({ tipo, campo: 'codigo', valor_original: entidade.codigo, placeholder: codigoPh });

    if (entidade.loja) {
      const lojaPh = _placeholder(tipo, 'loja');
      const antesLoja = out;
      out = _replaceValorCampo(out, _camposLoja(def, tipo), entidade.loja, lojaPh);
      if (out !== antesLoja) parametros.push({ tipo, campo: 'loja', valor_original: entidade.loja, placeholder: lojaPh });
    }
  }
  return { sql: out, parametros, alterou: out !== String(sql || '') };
}

function aplicarParametrosEntidadesSql(sql, entidades = []) {
  let out = String(sql || '');
  const aplicados = [];
  for (const entidade of entidades || []) {
    const tipo = _normalizarTipo(entidade?.tipo);
    if (!tipo || !entidade?.codigo) continue;

    const codigoPh = _placeholder(tipo, 'codigo');
    if (out.includes(codigoPh)) {
      out = out.split(codigoPh).join(String(entidade.codigo).replace(/'/g, "''"));
      aplicados.push({ tipo, campo: 'codigo', valor: entidade.codigo });
    }

    const lojaPh = _placeholder(tipo, 'loja');
    if (entidade.loja && out.includes(lojaPh)) {
      out = out.split(lojaPh).join(String(entidade.loja).replace(/'/g, "''"));
      aplicados.push({ tipo, campo: 'loja', valor: entidade.loja });
    }
  }
  const pendentes = [...out.matchAll(/\{\{iac:([a-z0-9_]+):([a-z0-9_]+)\}\}/gi)]
    .map(m => ({ tipo: m[1], campo: m[2], placeholder: m[0] }));
  return { sql: out, aplicados, pendentes, ok: pendentes.length === 0 };
}

// Verifica se a entidade resolvida (código + loja) está presente em algum campo equivalente do SQL.
// Aceita tanto o valor literal quanto o placeholder parametrizado {{iac:tipo:campo}} como prova
// de presença — necessário para canonicals já parametrizados por _sqlCanonicoParametrizado.
function sqlTemFiltroEntidade(sql, entidade) {
  if (!entidade?.codigo) return false;
  const tipo = _normalizarTipo(entidade.tipo);

  // SQL canônico parametrizado: placeholder já representa o filtro desta entidade.
  const codigoPh = _placeholder(tipo, 'codigo');
  if (String(sql || '').includes(codigoPh)) {
    if (!entidade.loja) return true;
    const lojaPh = _placeholder(tipo, 'loja');
    if (String(sql || '').includes(lojaPh)) return true;
  }

  const camposCodigo = [...new Set([
    ...(CAMPOS_CODIGO_EQUIVALENTES[tipo] || []),
  ])];
  const temCodigo = camposCodigo.some(campo => sqlTemCampoValor(sql, campo, entidade.codigo));
  if (!temCodigo) return false;
  if (entidade.loja) {
    const camposLoja = [...new Set([...(CAMPOS_LOJA_EQUIVALENTES[tipo] || [])])];
    if (camposLoja.length && !camposLoja.some(campo => sqlTemCampoValor(sql, campo, entidade.loja))) return false;
  }
  return true;
}

// Converte INNER JOIN → LEFT JOIN para tabelas dimensionais opcionais.
// Campos como D2_CCUSTO, D2_TES, B1_GRUPO podem estar vazios em registros do Protheus;
// INNER JOIN nessas tabelas exclui essas linhas, retornando resultado vazio ou incompleto.
// tabelasBase: array de prefixos sem sufixo numérico, ex: ['CTT', 'SF4', 'SBM', 'SA3'].
function converterInnerParaLeftJoinDimensionais(sql, tabelasBase) {
  if (!sql || !tabelasBase || !tabelasBase.length) return sql;
  let out = String(sql);
  for (const base of tabelasBase) {
    const re = new RegExp(`\\bINNER\\s+JOIN\\s+(${base}\\d*)\\b`, 'gi');
    out = out.replace(re, 'LEFT JOIN $1');
  }
  return out;
}

// Remove filtros de valor fixo em campos de loja para entidades com _todos=true.
// Ex.: AND SF2.F2_LOJA = '01' é removido; AND SF2.F2_LOJA = SA1.A1_LOJA é mantido (join condition).
function removerFiltrosLojaEntidadesTodas(sql, entidades) {
  if (!sql || !entidades?.length) return sql;
  let out = String(sql);
  for (const entidade of entidades) {
    if (!entidade?._todos) continue;
    const tipo = _normalizarTipo(entidade.tipo);
    const camposLoja = CAMPOS_LOJA_EQUIVALENTES[tipo] || [];
    for (const campo of camposLoja) {
      // Remove campo = 'literalValor' (não remove campo = outroAlias.outroCampo)
      const re = new RegExp(
        `(?:[A-Z0-9_]+\\.)?${_escapeRegexLiteral(campo)}\\s*=\\s*'[^']*'`,
        'gi'
      );
      out = out.replace(re, '1=1');
    }
  }
  return out;
}

// Garante que, quando ha entidade de seguranca de vendedor (vendedor_fixo_seguranca),
// NENHUM outro codigo de vendedor apareca nos campos de filtro de SE3 — nem mesmo via
// OR, subquery ou JOIN adicional que a IA tente usar para contornar o filtro principal.
// Defesa em profundidade: roda DEPOIS do SQL gerado, mesmo que o bloqueio antecipado
// (antes da chamada a IA) ja tenha tentado impedir o caso comum.
function validarExclusividadeVendedorSeguranca(sql, entidadeSeguranca) {
  if (!entidadeSeguranca?.codigo) return { ok: true, erros: [] };
  const campos = CAMPOS_CODIGO_EQUIVALENTES.vendedor_fixo_seguranca || [];
  const codigoEsperado = String(entidadeSeguranca.codigo);
  const where = _sqlSemComentarios(sql);
  const erros = [];
  for (const campo of campos) {
    const re = new RegExp(`\\b(?:[A-Z0-9_]+\\.)?${_escapeRegexLiteral(campo)}\\s*=\\s*'([^']*)'`, 'gi');
    let m;
    while ((m = re.exec(where))) {
      if (m[1] !== codigoEsperado) {
        erros.push(`SQL filtra ${campo} pelo codigo '${m[1]}', diferente do vendedor autorizado '${codigoEsperado}'. Acesso negado: nunca filtre comissao de outro vendedor.`);
      }
    }
  }
  return { ok: erros.length === 0, erros };
}

module.exports = {
  validarSqlEntidadesResolvidas,
  termosDeFiltrosEstruturados,
  sqlTemCampoValor,
  sqlTemFiltroEntidade,
  removerHintsNoLock,
  converterInnerParaLeftJoinDimensionais,
  parametrizarSqlEntidadesResolvidas,
  aplicarParametrosEntidadesSql,
  removerFiltrosLojaEntidadesTodas,
  validarExclusividadeVendedorSeguranca,
};
