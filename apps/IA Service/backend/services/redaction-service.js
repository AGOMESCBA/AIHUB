'use strict';

const SENSITIVE_QUERY_KEYS = new Set([
  'token', 'access_token', 'api_key', 'apikey', 'key', 'senha', 'password',
  'secret', 'session', 'sessionid', 'sid', 'auth', 'authorization', 'cookie',
]);

function redigirTexto(texto) {
  return String(texto || '')
    .replace(/\b(Authorization\s*:\s*Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{4,}/gi, '$1 [REDACTED]')
    .replace(/\b(api[_-]?key|token|senha|password|secret|session(?:[_-]?(?:id|token))?|sid)(\s*[:=]\s*)["']?[^"'\s&;]{4,}/gi, '$1$2[REDACTED]')
    .replace(/\b(cookie\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]');
}

function redigirUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.username) u.username = '[REDACTED]';
    if (u.password) u.password = '[REDACTED]';
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) u.searchParams.set(key, '[REDACTED]');
    }
    return u.toString();
  } catch (_) {
    return redigirTexto(url);
  }
}

function redigirValor(valor) {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'string') {
    const looksUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(valor);
    return looksUrl ? redigirUrl(valor) : redigirTexto(valor);
  }
  if (Array.isArray(valor)) return valor.map(redigirValor);
  if (typeof valor === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      const key = k.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.has(key) || /authorization|cookie|password|senha|secret|token|api[_-]?key/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redigirValor(v);
      }
    }
    return out;
  }
  return valor;
}

module.exports = { redigirTexto, redigirUrl, redigirValor };
