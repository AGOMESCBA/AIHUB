const factory             = require('../providers/connection-factory');
const { resolverPeriodo } = require('../../ai/period-resolver');

// Executa uma consulta usando o sql_base do dataset como subquery.
// O wrapper resolve aliases de forma case-insensitive para que o usuario possa
// cadastrar DATA, data, Quantidade etc. sem depender da caixa usada no SELECT.
async function executar(intent, dataset, empresaId) {
  if (!dataset.sql_base?.trim()) {
    throw new Error(`Dataset "${dataset.nome}" nao tem sql_base configurado.`);
  }

  intent.periodo = { ...intent.periodo, ...resolverPeriodo(intent.periodo) };

  const conn = factory.carregarConexao(empresaId);
  if (!conn) throw new Error('Nenhuma conexao ERP ativa para esta empresa.');
  conn._empresa_id = empresaId              || '';
  conn._pergunta   = intent._mensagemOriginal || '';
  conn._sender     = intent._remetente       || '';
  conn._modulo     = dataset.nome            || '';
  conn._operacao   = intent.intencao         || '';

  const { sql, params } = _buildWrapper(intent, dataset);
  const rows = await factory.executar(conn, sql, params);

  return { intencao: intent.intencao, acao: intent.acao, periodo: intent.periodo, rows, _agente_url: conn._agente_url || null };
}

function _buildWrapper(intent, dataset) {
  let n = 0;
  const params = {};
  const aliases = _mapAliases(dataset.sql_base);

  function p(val) {
    const name = `p${n++}`;
    params[name] = val;
    return `@${name}`;
  }

  const campoData = _resolverAlias(dataset.campo_data || 'data', aliases);
  const limit = Math.min(intent.limite || dataset.limite_max || 1000, 10000);
  const conditions = [];

  if (intent.periodo?.dataInicio && campoData) {
    conditions.push(`${_q(campoData)} >= ${p(intent.periodo.dataInicio)}`);
    conditions.push(`${_q(campoData)} <= ${p(intent.periodo.dataFim)}`);
  }

  if (intent.filtros && typeof intent.filtros === 'object') {
    for (const [key, value] of Object.entries(intent.filtros)) {
      if (!value || typeof value !== 'string' || !value.trim()) continue;
      const col = _resolverAlias(key, aliases);
      if (!col) continue;
      conditions.push(`${_q(col)} LIKE ${p('%' + value.trim() + '%')}`);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const groupBy = Array.isArray(intent.group_by) && intent.group_by.length
    ? intent.group_by
    : Array.isArray(intent.agrupar_por_composto) && intent.agrupar_por_composto.length
      ? intent.agrupar_por_composto
      : intent.agrupar_por ? [intent.agrupar_por] : [];

  if (groupBy.length >= 2) {
    const sql = `SELECT *\nFROM (\n${dataset.sql_base}\n) AS _base\n${where}`.trimEnd();
    return { sql, params };
  }

  if (groupBy.length === 1) {
    const agruparPor = groupBy[0];
    const agrupamentoTemporal = ['mes', 'ano', 'dia'].includes(String(agruparPor || '').toLowerCase());
    if (agrupamentoTemporal) {
      const sql = `SELECT *\nFROM (\n${dataset.sql_base}\n) AS _base\n${where}`.trimEnd();
      return { sql, params };
    }

    const dimCol = _resolverAlias(agruparPor, aliases);

    if (dataset.colunas_metrica?.trim()) {
      const metricas = dataset.colunas_metrica
        .split(',')
        .map(c => _resolverAlias(c, aliases))
        .filter(Boolean);

      const selectMetricas = metricas.map(m => `SUM(${_q(m)}) AS ${_q(m)}`).join(', ');

      let orderCol = metricas[0] || dimCol;
      let orderDir = 'DESC';
      if (intent.ordenar_por && typeof intent.ordenar_por === 'string') {
        const parts = intent.ordenar_por.split(':');
        const c = _resolverAlias(parts[0] || '', aliases);
        if (c) orderCol = c;
        orderDir = (parts[1] || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      }

      const sql = [
        `SELECT ${_q(dimCol)}, ${selectMetricas}`,
        `FROM (`,
        dataset.sql_base,
        `) AS _base`,
        where,
        `GROUP BY ${_q(dimCol)}`,
        `ORDER BY ${_q(orderCol)} ${orderDir}`,
      ].join('\n');

      return { sql, params };
    }

    const sql = `SELECT *\nFROM (\n${dataset.sql_base}\n) AS _base\n${where}`.trimEnd();
    return { sql, params };
  }

  let orderBy = '';
  if (intent.ordenar_por && typeof intent.ordenar_por === 'string') {
    const parts = intent.ordenar_por.split(':');
    const colOrd = _resolverAlias(parts[0] || '', aliases);
    const dirOrd = (parts[1] || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    if (colOrd) orderBy = `ORDER BY ${_q(colOrd)} ${dirOrd}`;
  }

  const sql = `SELECT TOP ${limit} *\nFROM (\n${dataset.sql_base}\n) AS _base\n${where}${orderBy ? '\n' + orderBy : ''}`.trimEnd();
  return { sql, params };
}

function _resolverAlias(nome, aliases) {
  const limpo = _limparIdentificador(nome);
  if (!limpo) return '';
  return aliases.get(_aliasKey(limpo)) || limpo;
}

function _limparIdentificador(valor) {
  return String(valor || '')
    .trim()
    .replace(/^[\[`"]|[\]`"]$/g, '')
    .replace(/[^\w]/g, '');
}

function _aliasKey(valor) {
  return _limparIdentificador(valor).toLowerCase();
}

function _q(identificador) {
  const nome = _limparIdentificador(identificador);
  if (!nome) return '';
  return `[${nome.replace(/]/g, ']]')}]`;
}

function _mapAliases(sqlBase) {
  const map = new Map();
  const selectPart = _selectList(sqlBase);
  for (const expr of _splitTopLevel(selectPart)) {
    const alias = _extrairAlias(expr);
    if (!alias) continue;
    const limpo = _limparIdentificador(alias);
    if (limpo) map.set(_aliasKey(limpo), limpo);
  }
  return map;
}

function _selectList(sqlBase) {
  const sql = String(sqlBase || '');
  const selectMatch = sql.match(/\bselect\b/i);
  if (!selectMatch) return '';
  const start = selectMatch.index + selectMatch[0].length;
  const end = _findTopLevelFrom(sql, start);
  if (end < 0) return '';
  return sql
    .slice(start, end)
    .replace(/^\s*(distinct\s+)?(top\s+\(?\d+\)?\s+)?/i, '')
    .trim();
}

function _findTopLevelFrom(sql, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '[') {
      quote = ']';
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(sql[i - 1] || ' ') && /^from\b/i.test(sql.slice(i))) return i;
  }
  return -1;
}

function _splitTopLevel(texto) {
  const partes = [];
  let atual = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (quote) {
      atual += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      atual += ch;
      continue;
    }
    if (ch === '[') {
      quote = ']';
      atual += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      partes.push(atual.trim());
      atual = '';
      continue;
    }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

function _extrairAlias(expr) {
  const texto = String(expr || '').trim();
  if (!texto) return '';

  const withAs = texto.match(/\bas\s+(\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w]+)\s*$/i);
  if (withAs) return withAs[1];

  const trailing = texto.match(/\s+(\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w]+)\s*$/);
  if (trailing) return trailing[1];

  const simple = texto.match(/(?:^|\.)(\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w]+)\s*$/);
  return simple ? simple[1] : '';
}

module.exports = { executar, _buildWrapper, _mapAliases };
