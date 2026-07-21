'use strict';

function _temChaveIA(keys = {}) {
  return Object.values(keys || {}).some(Boolean);
}

function _erroTipoIA(erro = {}) {
  return erro?._cotaEsgotada ? 'cota_esgotada' : 'ia_indisponivel';
}

async function gerarSqlComIaPrimaria({
  keys,
  cfg,
  chamarIA,
  systemPrompt,
  userPrompt,
  extrairSQL,
  maxTokens = 2500,
  fallbackMonitorado = null,
} = {}) {
  if (!_temChaveIA(keys)) {
    return {
      ok: false,
      subtipo: 'sem_chave',
      erro: new Error('Nenhuma chave de IA configurada para gerar SQL.'),
      userSql: userPrompt || null,
      respostaSql: null,
      sql: null,
      iaTentada: false,
    };
  }

  let respostaSql = null;
  try {
    respostaSql = await chamarIA(keys, cfg, systemPrompt, userPrompt, { json: true, maxTokens });
    const sql = extrairSQL(respostaSql);
    if (sql) {
      return { ok: true, sql, userSql: userPrompt, respostaSql, origem: 'ia', iaTentada: true };
    }

    const fallbackSql = typeof fallbackMonitorado === 'function'
      ? fallbackMonitorado({ motivo: 'sql_nao_extraido', userSql: userPrompt, respostaSql })
      : null;
    if (fallbackSql) {
      return {
        ok: true,
        sql: fallbackSql,
        userSql: userPrompt,
        respostaSql: JSON.stringify({ sql: fallbackSql, origem: 'fallback_monitorado', motivo: 'sql_nao_extraido', resposta_ia: respostaSql }),
        origem: 'fallback_monitorado',
        iaTentada: true,
      };
    }

    return { ok: false, subtipo: 'sql_nao_extraido', userSql: userPrompt, respostaSql, sql: null, iaTentada: true };
  } catch (erro) {
    const fallbackSql = typeof fallbackMonitorado === 'function'
      ? fallbackMonitorado({ motivo: 'erro_ia', erro, userSql: userPrompt, respostaSql })
      : null;
    if (fallbackSql) {
      return {
        ok: true,
        sql: fallbackSql,
        userSql: userPrompt,
        respostaSql: JSON.stringify({ sql: fallbackSql, origem: 'fallback_monitorado', motivo: 'erro_ia', erro_ia: erro.message }),
        origem: 'fallback_monitorado',
        iaTentada: true,
      };
    }

    return { ok: false, subtipo: _erroTipoIA(erro), erro, userSql: userPrompt, respostaSql, sql: null, iaTentada: true };
  }
}

function repararSqlRejeitadoComFallbackMonitorado({
  sql,
  userSql,
  respostaSql,
  erros = [],
  fallbackMonitorado = null,
  validarFallback = null,
} = {}) {
  if (typeof fallbackMonitorado !== 'function') return null;
  const sqlFallback = fallbackMonitorado({ motivo: 'sql_rejeitado', sql, userSql, respostaSql, erros });
  if (!sqlFallback) return null;
  if (typeof validarFallback === 'function' && !validarFallback(sqlFallback)) return null;
  return {
    sql: sqlFallback,
    respostaSql: JSON.stringify({
      sql_original_rejeitado: sql,
      sql: sqlFallback,
      origem: 'fallback_monitorado',
      motivo: 'sql_rejeitado',
      erros_sql_original: erros,
    }),
    origem: 'fallback_monitorado',
  };
}

module.exports = {
  gerarSqlComIaPrimaria,
  repararSqlRejeitadoComFallbackMonitorado,
  _temChaveIA,
};
