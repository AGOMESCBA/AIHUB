'use strict';

const https = require('https');
const usageDb = require('../ai/usage-db');

const PROVIDER_CONFIGS = {
  groq: {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    tipo: 'openai_compat',
  },
  deepseek: {
    hostname: 'api.deepseek.com',
    path: '/v1/chat/completions',
    model: 'deepseek-chat',
    tipo: 'openai_compat',
  },
  openai: {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    model: 'gpt-4o-mini',
    tipo: 'openai_compat',
  },
  claude: {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    tipo: 'anthropic',
  },
  gemini: {
    hostname: 'generativelanguage.googleapis.com',
    path: null,
    model: 'gemini-3.5-flash',
    tipo: 'gemini',
  },
};

function _httpPost(hostname, path, headers, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          return reject(new Error(`Resposta invalida do provider: ${raw.slice(0, 200)}`));
        }

        if (parsed.error) {
          const msg = parsed.error?.message || parsed.error?.error?.message || JSON.stringify(parsed.error);
          return reject(new Error(msg));
        }
        resolve(parsed);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout de ${Math.round(timeoutMs / 1000)}s excedido.`)));
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function _normalizarTextoProvider(data, providerName) {
  const texto = String(data || '').trim();
  if (!texto) throw new Error(`Resposta vazia do ${providerName}.`);
  return texto;
}

function _recordUsageSafe(provider, model, usage, opts = {}, erro = null) {
  if (!opts.empresaId && !opts.empresa_id) return;
  try {
    usageDb.registrarUso({
      empresaId: opts.empresaId || opts.empresa_id,
      canalId: opts.canalId || opts.canal_id,
      numeroWa: opts.numeroWa || opts.numero_wa || opts.sender,
      provider,
      model,
      operacao: opts.usageOperacao || opts.operacao || opts.logPrefix || null,
      origem: opts.usageOrigem || opts.origem || 'ia-command',
      ok: !erro,
      error: erro ? (erro.message || String(erro)) : null,
      usage: usage || {},
    });
  } catch (e) {
    console.warn('[IACommandAI] Falha ao registrar consumo IA:', e.message);
  }
}

async function _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, opts = {}) {
  const model = opts.model || cfg.model;
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens || 2000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  try {
    const parsed = await _httpPost(
      cfg.hostname,
      cfg.path,
      { Authorization: `Bearer ${apiKey}` },
      body,
      opts.timeoutMs || 30000
    );
    _recordUsageSafe(opts.providerName, model, parsed.usage, opts);
    return _normalizarTextoProvider(parsed.choices?.[0]?.message?.content, 'provider');
  } catch (erro) {
    _recordUsageSafe(opts.providerName, model, null, opts, erro);
    throw erro;
  }
}

async function _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, opts = {}) {
  const model = opts.model || cfg.model;
  try {
    const parsed = await _httpPost(
      cfg.hostname,
      cfg.path,
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: opts.maxTokens || 2000,
        temperature: opts.temperature ?? 0,
      },
      opts.timeoutMs || 30000
    );
    _recordUsageSafe(opts.providerName, model, parsed.usage, opts);
    const content = Array.isArray(parsed.content)
      ? parsed.content.map(c => c.text || '').join('\n')
      : parsed.content?.[0]?.text;
    return _normalizarTextoProvider(content, 'Anthropic');
  } catch (erro) {
    _recordUsageSafe(opts.providerName, model, null, opts, erro);
    throw erro;
  }
}

async function _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, opts = {}) {
  const model = opts.model || cfg.model;
  const path = `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = opts.geminiCombinedPrompt
    ? {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: opts.temperature ?? 0, maxOutputTokens: opts.maxTokens || 2000 },
      }
    : {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: opts.temperature ?? 0, maxOutputTokens: opts.maxTokens || 2000 },
      };

  try {
    const parsed = await _httpPost(cfg.hostname, path, {}, body, opts.timeoutMs || 30000);
    _recordUsageSafe(opts.providerName, model, parsed.usageMetadata, opts);
    const content = parsed.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n');
    return _normalizarTextoProvider(content, 'Gemini');
  } catch (erro) {
    _recordUsageSafe(opts.providerName, model, null, opts, erro);
    throw erro;
  }
}

async function chamarProvedor(provedor, apiKey, systemPrompt, userPrompt, opts = {}) {
  const cfg = PROVIDER_CONFIGS[provedor];
  if (!cfg || !apiKey) throw new Error(`Provider ${provedor} sem chave/configuracao.`);
  const optsComProvider = { ...opts, providerName: provedor };
  if (cfg.tipo === 'openai_compat') return _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, optsComProvider);
  if (cfg.tipo === 'anthropic') return _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, optsComProvider);
  if (cfg.tipo === 'gemini') return _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, optsComProvider);
  throw new Error(`Tipo de provider nao suportado: ${cfg.tipo}`);
}

async function resolverKeysEOrdem(empresaId) {
  return require('../ai/intent-service')._resolveKeys(empresaId);
}

function normalizarOrdem(cfg = {}) {
  return require('../ai/intent-service')._normalizarOrdem(cfg);
}

// Provedores bloqueados por "payload too large" nesta sessão de processo.
// Evita desperdiçar retries num provider que já rejeitou por limite de tokens.
const _provedoresBloqueadosGrande = new Set();

function _erroPayloadGrande(msg) {
  return /too large|payload.{0,20}size|token.{0,30}limit|reduce your message/i.test(msg);
}

async function chamarIA(keys, cfg, systemPrompt, userPrompt, opts = {}) {
  const ordem = normalizarOrdem(cfg);
  const erros = [];
  const logPrefix = opts.logPrefix || 'IACommandAI';
  const skipProvedores = opts.skipProvedores instanceof Set ? opts.skipProvedores : new Set(Array.isArray(opts.skipProvedores) ? opts.skipProvedores : []);

  for (const provedor of ordem) {
    if (!keys?.[provedor]) continue;
    if (skipProvedores.has(provedor) || _provedoresBloqueadosGrande.has(provedor)) continue;
    try {
      // Ler modelo específico do provider salvo no banco de dados (cfg vem do intent-service._resolveKeys)
      const modeloSalvo = cfg?.[`${provedor}_modelo`];
      const optsComModelo = modeloSalvo
        ? { ...opts, model: modeloSalvo }  // modeloSalvo tem precedência
        : opts;
      return await chamarProvedor(provedor, keys[provedor], systemPrompt, userPrompt, optsComModelo);
    } catch (e) {
      const msg = e?.message || String(e);
      erros.push({ provedor, msg });
      if (/quota|rate.?limit|free_tier|exceeded|429/i.test(msg)) e._cotaEsgotada = true;
      if (_erroPayloadGrande(msg)) {
        _provedoresBloqueadosGrande.add(provedor);
        console.warn(`[${logPrefix}] ${provedor} bloqueado (payload too large): proxy direto para proximo provider.`);
      } else {
        console.warn(`[${logPrefix}] ${provedor} falhou:`, msg);
      }
    }
  }

  const cotaEsgotada = erros.length > 0 && erros.every(e => /quota|rate.?limit|free_tier|exceeded|429/i.test(e.msg));
  const semChave = erros.length === 0;
  throw Object.assign(
    new Error(erros.map(e => `${e.provedor}: ${e.msg}`).join(' | ') || 'Nenhum provider disponivel'),
    { _cotaEsgotada: cotaEsgotada, _semChave: semChave }
  );
}

module.exports = {
  PROVIDER_CONFIGS,
  chamarIA,
  chamarProvedor,
  resolverKeysEOrdem,
  normalizarOrdem,
  _httpPost,
};
