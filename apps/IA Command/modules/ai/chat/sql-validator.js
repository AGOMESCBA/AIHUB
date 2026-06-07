'use strict';

// Mesmas keywords bloqueadas pelos sql-middleware de cada módulo + extras
const KEYWORDS_PROIBIDAS = [
  'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MERGE',
  'DROP', 'CREATE', 'ALTER', 'RENAME',
  'EXEC', 'EXECUTE', 'CALL',
  'XP_', 'SP_EXECUTESQL', 'OPENROWSET', 'OPENDATASOURCE',
  'BULK', 'DBCC', 'SHUTDOWN', 'RECONFIGURE',
  'GRANT', 'REVOKE', 'DENY',
  'BACKUP', 'RESTORE', 'WAITFOR',
  'DECLARE', 'USE',
  'PROCEDURE', 'FUNCTION', 'TRIGGER',
];

/**
 * Extrai o bloco SQL do retorno da IA.
 * Aceita: bloco ```sql ... ``` , bloco ``` ... ``` ou SQL puro começando com SELECT/WITH.
 * Retorna null se não encontrar SQL reconhecível.
 */
function extrairSql(texto) {
  const t = String(texto || '').trim();

  // Bloco markdown com ou sem linguagem
  const fenced = t.match(/```(?:sql)?\s*([\s\S]+?)```/i);
  if (fenced) return fenced[1].trim();

  // SQL direto (SELECT ou WITH ... SELECT)
  if (/^\s*(?:WITH\b[\s\S]{0,200}?\bSELECT\b|SET\s+ROWCOUNT\b|SELECT\b)/i.test(t)) return t;

  return null;
}

function _normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function _ehPerguntaYoY(mensagem = '') {
  const t = _normalizarTexto(mensagem);
  return (
    /\byoy\b/.test(t) ||
    /ano\s+contra\s+ano/.test(t) ||
    /mesmo\s+mes\s+do\s+ano\s+anterior/.test(t) ||
    /crescimento[\s\S]{0,100}ano\s+anterior/.test(t) ||
    /comparad[oa][\s\S]{0,100}ano\s+anterior/.test(t)
  );
}

function _validarContratoYoY(sql, mensagem = '') {
  if (!_ehPerguntaYoY(mensagem)) return null;
  const s = String(sql || '');
  const erros = [];
  if (/BETWEEN\s+'20\d{2}0101'\s+AND\s+'20\d{2}05(?:30|31)'/i.test(s)) {
    erros.push('usa BETWEEN continuo entre anos incluindo meses nao solicitados');
  }
  if (/\bHAVING\b[\s\S]{0,500}SUBSTRING\s*\([^)]*F2_EMISSAO[^)]*,\s*5\s*,\s*2\s*\)/i.test(s)) {
    erros.push('filtra mes no HAVING em vez de WHERE');
  }
  if (/PARTITION\s+BY\s+(?:SUBSTRING\s*\([^)]*F2_EMISSAO[^)]*,\s*1\s*,\s*6\s*\)|ano_mes\b)/i.test(s)) {
    erros.push('particiona LAG por ano_mes em vez de mes');
  }
  if (/AS\s+ano_mes\b/i.test(s) && !/AS\s+mes\b/i.test(s)) {
    erros.push('projeta ano_mes sem projetar mes separado');
  }
  if (/\bLAG\s*\(/i.test(s) && !/PARTITION\s+BY[\s\S]{0,120}(?:\bmes\b|SUBSTRING\s*\([^)]*F2_EMISSAO[^)]*,\s*5\s*,\s*2\s*\))/i.test(s)) {
    erros.push('LAG nao esta particionado pelo mes separado');
  }
  return erros.length ? erros.join('; ') : null;
}

function _validarPlaceholders(sql) {
  const s = String(sql || '');
  const placeholders = [];

  if (/<\s*FILIAL\s*>/i.test(s)) placeholders.push('<FILIAL>');
  if (/<\s*(?:CLIENTE|FORNECEDOR|PRODUTO|VENDEDOR|GRUPO_PRODUTO|CENTRO_CUSTO|TES)(?:_[A-Z]+)?\s*>/i.test(s)) {
    placeholders.push('placeholder_entidade');
  }
  if (/\{\{\s*[^}]+\s*\}\}/.test(s)) placeholders.push('{{...}}');
  if (/:[A-Z_][A-Z0-9_]*/i.test(s)) placeholders.push(':PARAM');

  return placeholders.length
    ? `SQL contem placeholder nao resolvido: ${[...new Set(placeholders)].join(', ')}`
    : null;
}

/**
 * Valida se o SQL é seguro (somente leitura, sem operações perigosas).
 *
 * @returns {{ ok: boolean, sql?: string, erro?: string }}
 */
function validar(texto, contexto = {}) {
  const sql = extrairSql(texto);
  if (!sql) return { ok: false, erro: 'Resposta da IA não contém SQL reconhecível.' };

  // Remove comentários antes de validar
  const sqlSemComentarios = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const upper = sqlSemComentarios.toUpperCase();

  // Deve iniciar com SELECT, WITH ou SET ROWCOUNT (padrão Protheus)
  if (!/^\s*(WITH\b|SELECT\b|SET\s+ROWCOUNT\b)/i.test(sqlSemComentarios)) {
    return { ok: false, erro: 'SQL não é uma consulta SELECT válida.' };
  }

  // Bloqueia SELECT INTO (cria tabela)
  if (/\bSELECT\b[\s\S]*?\bINTO\b/i.test(sqlSemComentarios)) {
    return { ok: false, erro: 'SELECT INTO não é permitido.' };
  }

  // Bloqueia keywords perigosas como palavras completas
  for (const kw of KEYWORDS_PROIBIDAS) {
    const pattern = kw.includes('_')
      ? new RegExp(`\\b${kw.replace(/_/g, '[_]')}`, 'i')
      : new RegExp(`\\b${kw}\\b`, 'i');
    if (pattern.test(upper)) {
      return { ok: false, erro: `SQL contém operação não permitida: ${kw}` };
    }
  }

  // Bloqueia múltiplos statements (mais de um ponto-e-vírgula fora de strings)
  const semStrings = sqlSemComentarios.replace(/'[^']*'/g, "''");
  const semicolons = (semStrings.match(/;/g) || []).length;
  // SET ROWCOUNT X; SELECT ... é o padrão Protheus — permitir exatamente 1 ponto-e-vírgula
  if (semicolons > 1) {
    return { ok: false, erro: 'SQL contém múltiplos statements não permitidos.' };
  }

  const erroYoY = _validarContratoYoY(sqlSemComentarios, contexto.mensagem || contexto.pergunta || '');
  if (erroYoY) {
    return { ok: false, erro: `SQL YoY invalido: ${erroYoY}`, sql };
  }

  const erroPlaceholder = _validarPlaceholders(sqlSemComentarios);
  if (erroPlaceholder) {
    return { ok: false, erro: erroPlaceholder, sql };
  }

  return { ok: true, sql };
}

module.exports = { validar, extrairSql, _validarContratoYoY, _ehPerguntaYoY, _validarPlaceholders };
