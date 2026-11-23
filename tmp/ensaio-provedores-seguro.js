'use strict';
require('dotenv').config({ quiet: true });
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const platform = new Database(path.join('apps', 'IAHUB', 'data', 'iahub-platform.db'), { readonly: true, fileMustExist: true });
const row = platform.prepare('SELECT * FROM platform_ai_configs WHERE empresa_id = ? AND COALESCE(ativo, 1) = 1').get(1); platform.close();
function dec(valor) {
  if (!valor || !String(valor).startsWith('iahub-aes-gcm:')) return valor;
  const dados = Buffer.from(String(valor).slice('iahub-aes-gcm:'.length), 'base64');
  const chave = crypto.createHash('sha256').update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key').digest();
  const d = crypto.createDecipheriv('aes-256-gcm', chave, dados.subarray(0, 12)); d.setAuthTag(dados.subarray(12, 28));
  return Buffer.concat([d.update(dados.subarray(28)), d.final()]).toString('utf8');
}
async function main() {
  const client = require('../apps/IA Service/backend/services/ai-provider-client');
  for (const provider of ['openai', 'groq', 'deepseek', 'claude', 'gemini']) {
    const key = dec(row?.[`${provider}_api_key_enc`]);
    if (!key) { console.log(JSON.stringify({ provider, estado: 'sem_chave' })); continue; }
    const inicio = Date.now();
    try {
      await client.chamarProvedor(provider, key, 'Responda brevemente.', 'Diga OK.', [], { timeoutMs: 15000, maxTokens: 30, model: row[`${provider}_modelo`] || undefined });
      console.log(JSON.stringify({ provider, estado: 'respondeu', duracaoMs: Date.now() - inicio }));
    } catch (erro) {
      const msg = String(erro.message || '');
      const indicadores = ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'socket hang up', 'model', 'modelo', 'quota', 'credit', 'fetch failed', 'Resposta vazia', 'JSON', 'not found', 'invalid api key', 'invalid key', 'api key not valid', 'invalid argument', 'invalid value', 'unexpected', 'getaddrinfo', 'permission denied', 'not available', 'not supported', 'billing', 'resource exhausted', 'API key expired', 'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED'].filter(s => msg.toLowerCase().includes(s.toLowerCase()));
      console.log(JSON.stringify({ provider, estado: 'falhou', tipo: /timeout|abort/i.test(msg) ? 'timeout' : /cert|tls|ssl/i.test(msg) ? 'tls' : /\b401\b|\b403\b/i.test(msg) ? 'autenticacao' : /\b429\b/i.test(msg) ? 'limite' : /model|modelo/i.test(msg) ? 'modelo' : 'outro', http: msg.match(/\b[45]\d\d\b/)?.[0] || null, indicadores, duracaoMs: Date.now() - inicio }));
    }
  }
}
main().catch(() => { console.error('Falha no ensaio.'); process.exitCode = 1; });
