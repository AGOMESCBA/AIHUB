'use strict';

const TABELAS_SCHEMA_FATURAMENTO = new Set(['SF2', 'SD2', 'SF1', 'SD1', 'SA1', 'SA3', 'SB1', 'SBM', 'SF4', 'CTT']);

const BANNED_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE',
  'EXEC', 'EXECUTE', 'XP_', 'SP_EXECUTESQL', 'OPENROWSET', 'OPENDATASOURCE',
  'BULK', 'DBCC', 'SHUTDOWN', 'RECONFIGURE', 'MERGE', 'DECLARE', 'CALL',
  'USE', 'GRANT', 'REVOKE', 'DENY', 'BACKUP', 'RESTORE', 'WAITFOR',
];

function _extrairTabelas(sql) {
  const tabelas = new Set();
  const re = /\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) tabelas.add(m[1].toUpperCase().replace(/\d{3}$/, ''));
  return tabelas;
}

function _parseLista(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor.filter(Boolean);
  if (typeof valor === 'string') {
    try {
      const p = JSON.parse(valor);
      return Array.isArray(p) ? p.filter(Boolean) : [];
    } catch (_) {
      return valor.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function _garantirRowcount(sql, limite) {
  // LIMIT N é sintaxe MySQL — converte para OFFSET/FETCH NEXT (SQL Server / ANSI SQL:2008).
  sql = sql.replace(/\bLIMIT\s+(\d+)\s*;?\s*$/im, (_, n) => `OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY`);
  // TOP N e OFFSET/FETCH NEXT são mutuamente exclusivos no SQL Server (erro 10741).
  // SET ROWCOUNT também conflita com OFFSET/FETCH NEXT (retorna 0 linhas).
  if (/\bOFFSET\b[\s\S]*?\bFETCH\s+NEXT\b/i.test(sql)) {
    sql = sql.replace(/SET\s+ROWCOUNT\s+\d+;\s*/gi, '').trimStart();
    sql = sql.replace(/\bSELECT\s+TOP\s+\d+\b/gi, 'SELECT');
    return sql;
  }
  const max = Math.min(Math.max(parseInt(limite) || 10000, 100), 50000);
  const match = sql.match(/SET\s+ROWCOUNT\s+(\d+)/i);
  if (match) return parseInt(match[1]) !== max ? sql.replace(/SET\s+ROWCOUNT\s+\d+/i, `SET ROWCOUNT ${max}`) : sql;
  return `SET ROWCOUNT ${max};\n${sql}`;
}

function _aplicarTopRanking(sql, limiteRanking) {
  const n = _normalizarLimiteRanking(limiteRanking);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return sql;
  if (/\bOFFSET\b[\s\S]*?\bFETCH\s+NEXT\b/i.test(sql)) return sql;

  const texto = String(sql || '');
  const semSet = texto.replace(/^\s*SET\s+ROWCOUNT\s+\d+\s*;\s*/i, '');
  const prefixo = texto.slice(0, texto.length - semSet.length);
  if (/^\s*WITH\b/i.test(semSet)) return texto;
  if (/^\s*SELECT\s+DISTINCT\s+TOP\s+\(?\d+\)?\b/i.test(semSet)) {
    return prefixo + semSet.replace(/^\s*SELECT\s+DISTINCT\s+TOP\s+\(?\d+\)?\b/i, `SELECT DISTINCT TOP ${n}`);
  }
  if (/^\s*SELECT\s+TOP\s+\(?\d+\)?\b/i.test(semSet)) {
    return prefixo + semSet.replace(/^\s*SELECT\s+TOP\s+\(?\d+\)?\b/i, `SELECT TOP ${n}`);
  }
  if (/^\s*SELECT\s+DISTINCT\b/i.test(semSet)) {
    return prefixo + semSet.replace(/^\s*SELECT\s+DISTINCT\b/i, `SELECT DISTINCT TOP ${n}`);
  }
  return prefixo + semSet.replace(/^\s*SELECT\b/i, `SELECT TOP ${n}`);
}

function _normalizarLimiteRanking(valor) {
  if (Number.isFinite(Number(valor))) return parseInt(valor, 10);
  const texto = String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mapa = {
    um: 1, uma: 1,
    dois: 2, duas: 2,
    tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20,
  };
  return mapa[texto.replace(/\s+/g, '')] || null;
}

function _limiteRankingDaMensagem(mensagem) {
  const texto = String(mensagem || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const quantidade = '(\\d{1,4}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte)';
  const m = texto.match(new RegExp(`\\b(?:top\\s*|maior(?:es)?\\s+|menor(?:es)?\\s+|primeir[oa]s?\\s+|ultim[oa]s?\\s+)${quantidade}\\b`, 'i'))
    || texto.match(new RegExp(`\\b${quantidade}\\s+(?:maior(?:es)?|menor(?:es)?|primeir[oa]s?|ultim[oa]s?|clientes?|produtos?|fornecedores?|vendedores?)\\b`, 'i'));
  return m ? _normalizarLimiteRanking(m[1]) : null;
}

function _injetarFiltroTenant(sql, cfg) {
  const campo = (cfg.campo_empresa || 'FILIAL').trim();
  const tenant = String(cfg.tenant_id || '').replace(/'/g, "''");
  const filtro = `${campo} = '${tenant}'`;
  if (/\bWHERE\b/i.test(sql)) return sql.replace(/\bWHERE\b/i, `WHERE ${filtro}\n  AND `);
  const pos = sql.search(/\b(?:GROUP\s+BY|ORDER\s+BY|HAVING)\b/i);
  if (pos !== -1) return sql.slice(0, pos) + `WHERE ${filtro}\n` + sql.slice(pos);
  return sql.trimEnd() + `\nWHERE ${filtro}`;
}

function _validarSomenteLeitura(sqlSemComentarios) {
  const texto = String(sqlSemComentarios || '');
  const upper = texto.toUpperCase();
  const banned = BANNED_KEYWORDS.filter(k => new RegExp(`\\b${k}\\b`).test(upper));
  if (banned.length > 0) return `Operacoes nao permitidas detectadas: ${banned.join(', ')}`;
  if (/\bSELECT\b[\s\S]*?\bINTO\b/i.test(texto)) return 'SELECT INTO nao e permitido.';
  if (/\b(?:[A-Z_][A-Z0-9_]*\.){1,2}[A-Z_][A-Z0-9_]*\s*\(/i.test(texto)) {
    return 'Execucao de procedures ou functions qualificadas nao e permitida.';
  }
  return null;
}

function processar(sql, cfg = {}) {
  const resultado = { sql_original: sql, sql_processado: sql, alertas: [], bloqueado: false, motivo_bloqueio: null };
  if (!sql || !sql.trim()) {
    resultado.bloqueado = true;
    resultado.motivo_bloqueio = 'SQL vazio.';
    return resultado;
  }

  const sqlSemComentarios = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const upper = sqlSemComentarios.toUpperCase();
  const bloqueioLeitura = _validarSomenteLeitura(sqlSemComentarios);
  if (bloqueioLeitura) {
    resultado.bloqueado = true;
    resultado.motivo_bloqueio = bloqueioLeitura;
    return resultado;
  }
  if (!/SELECT\s/i.test(upper)) {
    resultado.bloqueado = true;
    resultado.motivo_bloqueio = 'SQL nao contem SELECT.';
    return resultado;
  }

  const tabelasBloqueadas = _parseLista(cfg.tabelas_bloqueadas).map(t => t.toUpperCase());
  if (tabelasBloqueadas.length) {
    const usadas = _extrairTabelas(sql);
    const bloqueadas = [...usadas].filter(t => tabelasBloqueadas.some(b => t === b || t.startsWith(b)));
    if (bloqueadas.length) {
      resultado.bloqueado = true;
      resultado.motivo_bloqueio = `Acesso bloqueado as tabelas: ${bloqueadas.join(', ')}`;
      return resultado;
    }
  }

  const foraSchema = [..._extrairTabelas(sql)].filter(t => !TABELAS_SCHEMA_FATURAMENTO.has(t));
  if (foraSchema.length) resultado.alertas.push(`Tabelas fora do schema faturamento: ${foraSchema.join(', ')}`);

  const camposSensiveis = _parseLista(cfg.campos_sensiveis);
  const encontrados = camposSensiveis.filter(c => upper.includes(c.toUpperCase()));
  if (encontrados.length) resultado.alertas.push(`Campos sensiveis referenciados: ${encontrados.join(', ')}`);

  let sqlProcessado = sql;
  if (cfg.modelo_dados === 'LOBO_GUARA' && cfg.tenant_id) {
    sqlProcessado = _injetarFiltroTenant(sqlProcessado, cfg);
    resultado.alertas.push('Filtro de isolamento de empresa (tenant) injetado automaticamente.');
  }
  const limiteRanking = cfg.limite_ranking
    || cfg.limiteRanking
    || _limiteRankingDaMensagem(cfg.mensagem_original || cfg.mensagem || cfg.pergunta);
  resultado.sql_processado = _aplicarTopRanking(
    _garantirRowcount(sqlProcessado, cfg.limite_registros),
    limiteRanking
  );
  return resultado;
}

function carregarConfig(empresaId) {
  try {
    const { getDB } = require('../../database');
    const row = getDB().prepare(
      "SELECT config FROM erp_config WHERE empresa_id = ? AND erp = 'protheus' AND connection_id IS NULL ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1"
    ).get(empresaId);
    return row?.config ? JSON.parse(row.config) : {};
  } catch (_) {
    return {};
  }
}

module.exports = { processar, carregarConfig, _extrairTabelas, TABELAS_SCHEMA_FATURAMENTO, _aplicarTopRanking, _limiteRankingDaMensagem };
