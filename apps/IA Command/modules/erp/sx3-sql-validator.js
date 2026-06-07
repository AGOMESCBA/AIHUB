'use strict';

const sx2SqlNormalizer = require('./sx2-sql-normalizer');

const CAMPOS_SISTEMA_PERMITIDOS = new Set([
  'D_E_L_E_T_',
  'R_E_C_N_O_',
  'R_E_C_D_E_L_',
]);

function _baseTabela(nome) {
  return sx2SqlNormalizer.baseTabelaSX2(nome);
}

function _normalizarIdentificador(valor) {
  return String(valor || '').replace(/^\[|\]$/g, '').trim().toUpperCase();
}

function _removerComentarios(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function _mascararStrings(sql) {
  return String(sql || '').replace(/'(?:''|[^'])*'/g, "''");
}

function _camposPorTabelaSX3(sx3 = {}) {
  const mapa = new Map();
  for (const [tabelaRaw, campos] of Object.entries(sx3 || {})) {
    const tabela = _normalizarIdentificador(tabelaRaw);
    const base = _baseTabela(tabela);
    const set = new Set((campos || []).map(c => _normalizarIdentificador(c.campo)).filter(Boolean));
    for (const campo of CAMPOS_SISTEMA_PERMITIDOS) set.add(campo);
    if (set.size) {
      mapa.set(tabela, set);
      mapa.set(base, set);
    }
  }
  return mapa;
}

function _mapearAliases(sql) {
  const aliases = new Map();
  const texto = _mascararStrings(_removerComentarios(sql));
  const re = /\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?/gi;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const tabela = _normalizarIdentificador(m[1]);
    const alias = _normalizarIdentificador(m[2] || m[1]);
    if (['ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN'].includes(alias)) {
      aliases.set(tabela, tabela);
    } else {
      aliases.set(alias, tabela);
      aliases.set(tabela, tabela);
    }
  }
  return aliases;
}

function _escaparRegex(valor) {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _mapearTabelasComAlias(sql) {
  const aliases = [];
  const texto = _mascararStrings(_removerComentarios(sql));
  const palavrasReservadas = new Set(['ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN']);
  const re = /\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?/gi;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const tabela = _normalizarIdentificador(m[1]);
    const alias = _normalizarIdentificador(m[2] || '');
    if (!alias || alias === tabela || palavrasReservadas.has(alias)) continue;
    aliases.push({ tabela, alias });
  }
  return aliases;
}

function normalizarReferenciasAliasSql(sql) {
  let normalizado = String(sql || '');
  for (const { tabela, alias } of _mapearTabelasComAlias(sql)) {
    const re = new RegExp(`\\b${_escaparRegex(tabela)}\\s*\\.`, 'gi');
    normalizado = normalizado.replace(re, `${alias}.`);
  }
  return normalizado;
}

function normalizarDatasProtheus(sql) {
  return String(sql || '');
}

function validarReferenciasAliasSql(sql) {
  const erros = [];
  const texto = _mascararStrings(_removerComentarios(sql));
  for (const { tabela, alias } of _mapearTabelasComAlias(sql)) {
    const re = new RegExp(`\\b${_escaparRegex(tabela)}\\s*\\.`, 'i');
    if (re.test(texto)) {
      erros.push(`Tabela ${tabela} foi declarada com alias ${alias}; referencias de campos devem usar ${alias}.`);
    }
  }
  return { ok: erros.length === 0, erros };
}

function _referenciasCampos(sql) {
  const refs = [];
  const texto = _mascararStrings(_removerComentarios(sql));
  const re = /\b([A-Z_][A-Z0-9_]*)\s*\.\s*([A-Z_][A-Z0-9_]*)\b/gi;
  let m;
  while ((m = re.exec(texto)) !== null) {
    refs.push({
      alias: _normalizarIdentificador(m[1]),
      campo: _normalizarIdentificador(m[2]),
    });
  }
  return refs;
}

function _camposSemAlias(sql, camposPorTabela) {
  const camposPermitidos = new Set();
  const prefixosSX3 = new Set();
  for (const campos of camposPorTabela.values()) {
    for (const campo of campos) {
      camposPermitidos.add(campo);
      const prefixo = campo.split('_')[0];
      if (prefixo && /^[A-Z0-9]{2,4}$/.test(prefixo)) prefixosSX3.add(prefixo);
    }
  }

  const texto = _mascararStrings(_removerComentarios(sql));
  const refs = [];
  const re = /\b([A-Z][A-Z0-9]{0,3}_[A-Z0-9_]+)\b/gi;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const anterior = texto.slice(Math.max(0, m.index - 2), m.index);
    if (/\.\s*$/.test(anterior)) continue;
    const campo = _normalizarIdentificador(m[1]);
    if (CAMPOS_SISTEMA_PERMITIDOS.has(campo)) continue;
    const prefixo = campo.split('_')[0];
    if (prefixosSX3.has(prefixo) && !camposPermitidos.has(campo)) refs.push(campo);
  }
  return [...new Set(refs)];
}

function validarCamposSqlContraSX3(sql, sx3 = {}) {
  const validacaoAliases = validarReferenciasAliasSql(sql);
  if (!validacaoAliases.ok) return validacaoAliases;

  if (!sx3 || !Object.keys(sx3).length) return { ok: true, erros: [] };

  const camposPorTabela = _camposPorTabelaSX3(sx3);
  if (!camposPorTabela.size) return { ok: true, erros: [] };

  const aliases = _mapearAliases(sql);
  const refs = _referenciasCampos(sql);
  const erros = [];
  const vistos = new Set();

  for (const ref of refs) {
    const tabela = aliases.get(ref.alias);
    if (!tabela) continue;

    const campos = camposPorTabela.get(tabela) || camposPorTabela.get(_baseTabela(tabela));
    if (!campos) continue;

    if (!campos.has(ref.campo)) {
      const chave = `${tabela}.${ref.campo}`;
      if (!vistos.has(chave)) {
        vistos.add(chave);
        erros.push(`Campo ${ref.alias}.${ref.campo} nao consta no SX3 cadastrado para ${tabela}.`);
      }
    }
  }

  for (const campo of _camposSemAlias(sql, camposPorTabela)) {
    const chave = `SEM_ALIAS.${campo}`;
    if (!vistos.has(chave)) {
      vistos.add(chave);
      erros.push(`Campo ${campo} nao consta no SX3 cadastrado.`);
    }
  }

  return { ok: erros.length === 0, erros };
}

function limitarCamposSX3ParaPrompt(sx3 = {}, limitePorTabela = 80) {
  if (!sx3 || !Object.keys(sx3).length) return sx3;
  const limite = Number(limitePorTabela);
  if (!Number.isFinite(limite) || limite <= 0) return sx3;
  const saida = {};
  for (const [tabela, campos] of Object.entries(sx3)) {
    saida[tabela] = (campos || []).slice(0, limite);
  }
  return saida;
}

module.exports = {
  validarCamposSqlContraSX3,
  limitarCamposSX3ParaPrompt,
  normalizarReferenciasAliasSql,
  normalizarDatasProtheus,
  validarReferenciasAliasSql,
  _baseTabela,
  _mapearAliases,
  _mapearTabelasComAlias,
  _referenciasCampos,
  _camposSemAlias,
};
