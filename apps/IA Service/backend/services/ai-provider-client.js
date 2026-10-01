'use strict';

// Motor de IA multi-provider do IA Service — inspirado no PADRÃO do
// apps/IA Command/modules/erp/core/ai-provider-client.js (mesma abstração de
// fallback entre providers, mesma chamada HTTPS crua), mas desacoplado de
// Protheus/usage-db do IA Command e com suporte a anexos de imagem (visão),
// necessário para os cenários A/B do prompt (screenshot + fonte + log).
//
// Corrige deliberadamente o `rejectUnauthorized: false` encontrado no IA
// Command (Etapa 0, seção 9.2 do relatório de análise) — aqui a validação de
// certificado TLS fica ligada (comportamento padrão do Node).

const https = require('https');

const PROVIDER_CONFIGS = {
  groq: { hostname: 'api.groq.com', path: '/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', tipo: 'openai_compat', suportaImagem: false },
  openai: { hostname: 'api.openai.com', path: '/v1/chat/completions', model: 'gpt-4o-mini', tipo: 'openai_compat', suportaImagem: true },
  deepseek: { hostname: 'api.deepseek.com', path: '/chat/completions', model: 'deepseek-chat', tipo: 'openai_compat', suportaImagem: false },
  claude: { hostname: 'api.anthropic.com', path: '/v1/messages', model: 'claude-haiku-4-5-20251001', tipo: 'anthropic', suportaImagem: true },
  gemini: { hostname: 'generativelanguage.googleapis.com', path: null, model: 'gemini-3.5-flash', tipo: 'gemini', suportaImagem: true },
};

const DEFAULT_ORDER = ['groq', 'deepseek', 'openai', 'claude', 'gemini'];

function _httpPost(hostname, path, headers, body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
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
          return reject(new Error(`Resposta inválida do provider: ${raw.slice(0, 200)}`));
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

function _normalizarTexto(data, providerName) {
  const texto = String(data || '').trim();
  if (!texto) throw new Error(`Resposta vazia do ${providerName}.`);
  return texto;
}

// `imagens` é uma lista de { mimeType, base64 } — vazia na maioria das
// chamadas (texto puro), preenchida quando o atendimento tem anexos de imagem.

async function _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const model = opts.model || cfg.model;
  const conteudoUser = imagens.length
    ? [
        { type: 'text', text: userPrompt },
        ...imagens.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
      ]
    : userPrompt;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: conteudoUser },
    ],
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens || 3000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const parsed = await _httpPost(cfg.hostname, cfg.path, { Authorization: `Bearer ${apiKey}` }, body, opts.timeoutMs);
  const content = parsed.choices?.[0]?.message?.content;
  return { texto: _normalizarTexto(content, 'OpenAI-compat'), usage: parsed.usage || {}, truncado: parsed.choices?.[0]?.finish_reason === 'length' };
}

async function _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const model = opts.model || cfg.model;
  const conteudoUser = imagens.length
    ? [
        { type: 'text', text: userPrompt },
        ...imagens.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })),
      ]
    : userPrompt;

  const parsed = await _httpPost(
    cfg.hostname,
    cfg.path,
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: conteudoUser }],
      max_tokens: opts.maxTokens || 3000,
      temperature: opts.temperature ?? 0,
    },
    opts.timeoutMs
  );
  const content = Array.isArray(parsed.content) ? parsed.content.map(c => c.text || '').join('\n') : parsed.content?.[0]?.text;
  return { texto: _normalizarTexto(content, 'Anthropic'), usage: parsed.usage || {}, truncado: parsed.stop_reason === 'max_tokens' };
}

async function _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const model = opts.model || cfg.model;
  const path = `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [{ text: userPrompt }, ...imagens.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } }))];

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: opts.temperature ?? 0, maxOutputTokens: opts.maxTokens || 3000 },
  };

  const parsed = await _httpPost(cfg.hostname, path, {}, body, opts.timeoutMs);
  const content = parsed.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n');
  return { texto: _normalizarTexto(content, 'Gemini'), usage: parsed.usageMetadata || {}, truncado: parsed.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

async function chamarProvedor(provedor, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const cfg = PROVIDER_CONFIGS[provedor];
  if (!cfg || !apiKey) throw new Error(`Provider ${provedor} sem chave/configuração.`);
  if (imagens.length && !cfg.suportaImagem) throw new Error(`Provider ${provedor} não suporta análise de imagem.`);

  if (cfg.tipo === 'openai_compat') return _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, imagens, opts);
  if (cfg.tipo === 'anthropic') return _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, imagens, opts);
  if (cfg.tipo === 'gemini') return _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, imagens, opts);
  throw new Error(`Tipo de provider não suportado: ${cfg.tipo}`);
}

function _normalizarOrdem({ provedorPrimario, fallbackOrdem } = {}) {
  const fallback = String(fallbackOrdem || '').split(',').map(s => s.trim()).filter(Boolean);
  const ordem = [provedorPrimario, ...fallback, ...DEFAULT_ORDER].filter(Boolean);
  return [...new Set(ordem)].filter(p => PROVIDER_CONFIGS[p]);
}

function _erroCotaOuCredito(msg) {
  return /quota|rate.?limit|free_tier|exceeded|429|credit balance|insufficient.{0,20}(credit|balance|funds)|purchase credits|billing/i.test(msg || '');
}

/**
 * Chama o motor de IA com fallback entre providers, na ordem configurada pela
 * empresa (ai_config). `imagens` (pode ser []) restringe a ordem aos
 * providers com suporte a visão quando não vazia — Groq é pulado nesse caso.
 *
 * Modelo por provedor (2026-09): `cfg.modelos` (vindo de
 * ai-config-service.resolverKeysEOrdem) tem prioridade sobre `opts.model` —
 * cada provedor tem seu próprio nome de modelo, então um `opts.model` único
 * aplicado ao vencedor do fallback estaria errado na maioria dos casos
 * (ex.: "gpt-4o-mini" não existe na API do Groq). `opts.model` continua
 * funcionando como override GLOBAL para quem não tiver `cfg.modelos` (ex.:
 * chamadas de teste avulsas, ver rota /config/ia/testar).
 */
async function chamarIA(keys, cfg, systemPrompt, userPrompt, imagens = [], opts = {}) {
  const ordem = _normalizarOrdem(cfg);
  const erros = [];

  for (const provedor of ordem) {
    if (!keys?.[provedor]) continue;
    if (imagens.length && !PROVIDER_CONFIGS[provedor].suportaImagem) continue;

    const modeloDoProvedor = cfg?.modelos?.[provedor] || opts.model || PROVIDER_CONFIGS[provedor].model;
    try {
      const resultado = await chamarProvedor(provedor, keys[provedor], systemPrompt, userPrompt, imagens, { ...opts, model: modeloDoProvedor });
      return { ...resultado, provider: provedor, model: modeloDoProvedor };
    } catch (erro) {
      erros.push({ provedor, msg: erro.message });
    }
  }

  const semChave = !ordem.some(p => keys?.[p]);
  const cotaEsgotada = erros.length > 0 && erros.every(e => _erroCotaOuCredito(e.msg));
  const erroFinal = new Error(
    semChave
      ? 'Nenhum provider de IA configurado para esta empresa.'
      : `Todos os providers falharam: ${erros.map(e => `${e.provedor}: ${e.msg}`).join(' | ')}`
  );
  erroFinal._semChave = semChave;
  erroFinal._cotaEsgotada = cotaEsgotada;
  throw erroFinal;
}

module.exports = { chamarIA, chamarProvedor, PROVIDER_CONFIGS };
