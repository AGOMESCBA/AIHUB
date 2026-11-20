'use strict';

const SENSITIVE_QUERY_KEYS = new Set([
  'token', 'access_token', 'api_key', 'apikey', 'key', 'senha', 'password',
  'secret', 'client_secret', 'refresh_token', 'private_key', 'session', 'sessionid', 'sid', 'auth', 'authorization', 'cookie',
]);

// Contagens de uso devolvidas pelo provider de IA: o nome contém "token", mas o
// valor é só um número. Liberadas por lista explícita e somente com valor
// numérico (autorização do usuário, 2026-11-12); qualquer outro campo com
// "token" no nome continua mascarado.
// cached_tokens e os contadores do Claude medem o cache de prompt (2026-11-19).
const CONTAGENS_USO_LIBERADAS = new Set([
  'prompt_tokens', 'completion_tokens', 'total_tokens', 'cached_tokens',
  'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
]);
// Objetos de detalhe do usage: percorridos (cada contagem dentro deles segue a
// regra acima) em vez de mascarados inteiros por terem "token" no nome.
const DETALHES_USO_PERCORRIDOS = new Set(['prompt_tokens_details', 'completion_tokens_details']);

// CPF/CNPJ usam o mesmo padrao de technical-research-service.js:sanitizarConsultaExterna
// (mantido em dois lugares deliberadamente: aqui mascara para [REDACTED] preservando
// o formato da frase; na pesquisa externa remove para nao poluir a query de busca).
function redigirTexto(texto) {
  return String(texto || '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, trecho => {
      try {
        const u = new URL(trecho);
        if (u.username) u.username = '[REDACTED]';
        if (u.password) u.password = '[REDACTED]';
        for (const k of [...u.searchParams.keys()]) if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) u.searchParams.set(k, '[REDACTED]');
        return u.toString();
      } catch (_) { return trecho.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@'); }
    })
    .replace(/\b(Authorization\s*["']?\s*:\s*["']?\s*(?:Basic|Bearer))\s+[^\s"',;\r\n]+/gi, '$1 [REDACTED]')
    .replace(/\b(Authorization\s*:\s*Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{4,}/gi, '$1 [REDACTED]')
    .replace(/\b((?:x[-_])?api[_-]?key|(?:access[_-]|refresh[_-])?token|senha|password|(?:client[_-])?secret|private[_-]?key|authorization|cookie|session(?:[_-]?(?:id|token))?|sid)(["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[REDACTED(?::[A-Z]+)?\]|[^\s&;,}\]]+)/gi, (_m, chave, separador, valor) => `${chave}${separador}${/^["']/.test(valor) ? valor[0] + '[REDACTED]' + valor[0] : '[REDACTED]'}`)
    .replace(/\b(cookie\s*["']\s*:\s*)["'][^\r\n]*?["']/gi, '$1"[REDACTED]"')
    .replace(/\b(cookie\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g, '[REDACTED:CNPJ]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REDACTED:CPF]')
    .replace(/\bcpf\s*[:=]?\s*\d{11}\b/gi, 'cpf: [REDACTED:CPF]');
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
      if (CONTAGENS_USO_LIBERADAS.has(k) && typeof v === 'number' && Number.isFinite(v)) {
        out[k] = v;
      } else if (DETALHES_USO_PERCORRIDOS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = redigirValor(v);
      } else if (SENSITIVE_QUERY_KEYS.has(key) || /authorization|cookie|password|senha|secret|token|api[_-]?key/i.test(k)) {
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
