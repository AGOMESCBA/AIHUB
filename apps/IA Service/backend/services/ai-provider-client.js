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
  groq: { hostname: 'api.groq.com', path: '/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', tipo: 'openai_compat', suportaImagem: false, usaRaciocinio: true },
  openai: { hostname: 'api.openai.com', path: '/v1/chat/completions', model: 'gpt-4o-mini', tipo: 'openai_compat', suportaImagem: true },
  deepseek: { hostname: 'api.deepseek.com', path: '/chat/completions', model: 'deepseek-chat', tipo: 'openai_compat', suportaImagem: false },
  claude: { hostname: 'api.anthropic.com', path: '/v1/messages', model: 'claude-haiku-4-5-20251001', tipo: 'anthropic', suportaImagem: true },
  gemini: { hostname: 'generativelanguage.googleapis.com', path: null, model: 'gemini-3.5-flash', tipo: 'gemini', suportaImagem: true },
};

// Modelos de raciocínio (ex.: GPT-OSS na Groq) gastam parte do max_tokens
// "pensando" (campo completion_tokens_details.reasoning_tokens) antes de
// escrever a resposta final — com max_tokens baixo, o resultado vem com
// message.content vazio e finish_reason="length" mesmo com a chamada tendo
// sido bem-sucedida (HTTP 200, chave válida, uso contabilizado). Piso alto o
// bastante para sobrar espaço para o texto depois do raciocínio em prompts
// curtos (ex.: teste de conexão, que antes pedia maxTokens: 10 e sempre
// falhava com "Resposta vazia do OpenAI-compat", bug real reportado pelo
// usuário, 2026-10).
const MIN_TOKENS_RACIOCINIO = 300;
const DEFAULT_MAX_PROVIDER_ROUNDS = 3;

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

async function _chamarOpenAICompatUmaVez(cfg, apiKey, systemPrompt, userPrompt, imagens, opts, maxTokens) {
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
    max_tokens: maxTokens,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const parsed = await _httpPost(cfg.hostname, cfg.path, { Authorization: `Bearer ${apiKey}` }, body, opts.timeoutMs);
  const content = parsed.choices?.[0]?.message?.content;
  const finishReason = parsed.choices?.[0]?.finish_reason;
  return { content, usage: parsed.usage || {}, truncado: finishReason === 'length' };
}

async function _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const maxTokensPedido = opts.maxTokens || 3000;
  const maxTokensInicial = cfg.usaRaciocinio ? Math.max(maxTokensPedido, MIN_TOKENS_RACIOCINIO) : maxTokensPedido;

  let resultado = await _chamarOpenAICompatUmaVez(cfg, apiKey, systemPrompt, userPrompt, imagens, opts, maxTokensInicial);

  // Modelo de raciocínio pode consumir todo o orçamento "pensando" e deixar
  // message.content vazio mesmo com HTTP 200 — não é falha de credencial/cota,
  // é orçamento de tokens insuficiente para concluir a resposta. Uma única
  // retentativa com o dobro do orçamento resolve o caso real (teste de
  // conexão com maxTokens: 10) sem mascarar erro genuíno de outro provider.
  if (cfg.usaRaciocinio && !String(resultado.content || '').trim() && resultado.truncado) {
    resultado = await _chamarOpenAICompatUmaVez(cfg, apiKey, systemPrompt, userPrompt, imagens, opts, maxTokensInicial * 2);
  }

  return { texto: _normalizarTexto(resultado.content, 'OpenAI-compat'), usage: resultado.usage, truncado: resultado.truncado };
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
  return /quota|free_tier|exceeded|credit balance|insufficient.{0,20}(credit|balance|funds)|purchase credits|billing/i.test(msg || '');
}

function _erroPermanenteProvider(msg) {
  return /api key not valid|invalid api key|incorrect api key|unauthorized|forbidden|401|403|credit balance|insufficient.{0,20}(credit|balance|funds)|purchase credits|billing|model .*not found|does not exist/i.test(msg || '');
}

function _erroTransitorioProvider(msg) {
  return /econnreset|etimedout|eai_again|socket hang up|network|timeout|timed out|rate.?limit|429|temporar|try again|503|502|504|500|overloaded|capacity/i.test(msg || '');
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const tentativas = [];
  let tentados = 0;
  const inicioGeral = Date.now();
  const maxRodadas = Math.max(1, Math.min(Number(opts.maxProviderRounds) || DEFAULT_MAX_PROVIDER_ROUNDS, 5));
  const retryDelayMs = Math.max(0, Number(opts.providerRetryDelayMs) || 1200);
  const providersPermanentes = new Set();
  const candidatos = ordem.filter(provedor => keys?.[provedor] && (!imagens.length || PROVIDER_CONFIGS[provedor].suportaImagem));

  for (let rodada = 1; rodada <= maxRodadas; rodada++) {
    let houveTransitorioNaRodada = false;

    for (const provedor of candidatos) {
      if (providersPermanentes.has(provedor)) continue;

      tentados += 1;
      const modeloDoProvedor = cfg?.modelos?.[provedor] || opts.model || PROVIDER_CONFIGS[provedor].model;
      const inicioTentativa = Date.now();
      try {
        const resultado = await chamarProvedor(provedor, keys[provedor], systemPrompt, userPrompt, imagens, { ...opts, model: modeloDoProvedor });
        tentativas.push({ provider: provedor, model: modeloDoProvedor, status: 'ok', rodada, latenciaMs: Date.now() - inicioTentativa });
        return { ...resultado, provider: provedor, model: modeloDoProvedor, tentativas, latenciaMs: Date.now() - inicioGeral };
      } catch (erro) {
        const msg = erro.message;
        const permanente = _erroPermanenteProvider(msg);
        const transitorio = !permanente && _erroTransitorioProvider(msg);
        erros.push({ provedor, msg, rodada, transitorio, permanente });
        tentativas.push({ provider: provedor, model: modeloDoProvedor, status: 'erro', erro: msg, rodada, transitorio, permanente, latenciaMs: Date.now() - inicioTentativa });
        if (permanente) providersPermanentes.add(provedor);
        if (transitorio) houveTransitorioNaRodada = true;
      }
    }

    if (!houveTransitorioNaRodada || rodada >= maxRodadas) break;
    if (retryDelayMs > 0) {
      await _sleep(retryDelayMs * rodada);
    }
  }

  const semChave = !ordem.some(p => keys?.[p]);
  // Distingue "ninguém foi sequer tentado por falta de suporte a imagem" de
  // "todos tentaram e falharam" — são causas diferentes e exigem ação
  // diferente do analista (configurar um provedor com visão vs. investigar
  // erro de API). Sem essa distinção, o erro genérico "todos falharam"
  // escondia que, na prática, zero chamadas tinham sido feitas (bug real:
  // turno com imagens e só Groq/DeepSeek configurados nunca tentava
  // nenhum provedor, usuário via erro sem entender a causa, 2026-10).
  const semProvedorComImagem = imagens.length > 0 && !semChave && tentados === 0;
  const cotaEsgotada = erros.length > 0 && erros.every(e => _erroCotaOuCredito(e.msg));
  const erroFinal = new Error(
    semChave
      ? 'Nenhum provider de IA configurado para esta empresa.'
      : semProvedorComImagem
        ? `Nenhum provider configurado com chave suporta análise de imagem (necessário para ${imagens.length} anexo(s) deste turno). Configure uma chave para OpenAI, Claude ou Gemini em Configurações do IA Service.`
        : `Todos os providers falharam: ${erros.map(e => `${e.provedor}: ${e.msg}`).join(' | ')}`
  );
  erroFinal._semChave = semChave;
  erroFinal._semProvedorComImagem = semProvedorComImagem;
  erroFinal._cotaEsgotada = cotaEsgotada;
  erroFinal._tentativas = tentativas;
  erroFinal._latenciaMs = Date.now() - inicioGeral;
  throw erroFinal;
}

module.exports = { chamarIA, chamarProvedor, PROVIDER_CONFIGS, _erroTransitorioProvider, _erroPermanenteProvider };
