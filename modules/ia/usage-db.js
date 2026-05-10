const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const DEFAULT_LIMITS = {
  groq: 0,
  gemini: 0,
  groq_tokens: 0,
  gemini_tokens: 0,
};

const PRICING_USD_PER_1M = {
  groq: {
    'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  },
  gemini: {
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  },
};

function _arquivo(empresaId) {
  return path.join(DATA_DIR, `ia-usage-${empresaId || 'global'}.json`);
}

function _ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function _monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function _read(empresaId) {
  const arq = _arquivo(empresaId);
  try {
    if (fs.existsSync(arq)) {
      const parsed = JSON.parse(fs.readFileSync(arq, 'utf8'));
      return {
        limits: { ...DEFAULT_LIMITS, ...(parsed.limits || {}) },
        auto_refresh_min: Number(parsed.auto_refresh_min) || 0,
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    }
  } catch (_) {}
  return { limits: { ...DEFAULT_LIMITS }, auto_refresh_min: 0, events: [] };
}

function _write(empresaId, data) {
  _ensureDataDir();
  fs.writeFileSync(_arquivo(empresaId), JSON.stringify(data, null, 2), 'utf8');
}

function _tokensFromUsage(usage = {}) {
  const input =
    Number(usage.prompt_tokens) ||
    Number(usage.promptTokenCount) ||
    Number(usage.input_tokens) ||
    0;
  const output =
    Number(usage.completion_tokens) ||
    Number(usage.candidatesTokenCount) ||
    Number(usage.output_tokens) ||
    0;
  const total =
    Number(usage.total_tokens) ||
    Number(usage.totalTokenCount) ||
    input + output;
  return { input, output, total };
}

function _estimateCost(provider, model, inputTokens, outputTokens) {
  const rates = PRICING_USD_PER_1M[provider]?.[model];
  if (!rates) return null;
  return ((inputTokens * rates.input) + (outputTokens * rates.output)) / 1_000_000;
}

function recordUsage(empresaId, { provider, model, usage, ok = true, error = null } = {}) {
  if (!empresaId || !provider) return;
  const data = _read(empresaId);
  const tokens = _tokensFromUsage(usage);
  data.events.push({
    at: new Date().toISOString(),
    provider,
    model: model || null,
    ok: !!ok,
    error: error ? String(error).slice(0, 240) : null,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    total_tokens: tokens.total,
    estimated_cost_usd: _estimateCost(provider, model, tokens.input, tokens.output),
  });
  if (data.events.length > 5000) data.events = data.events.slice(-5000);
  _write(empresaId, data);
}

function setSettings(empresaId, patch = {}) {
  const data = _read(empresaId);
  if (patch.limits) {
    data.limits = {
      groq: Math.max(0, Number(patch.limits.groq) || 0),
      gemini: Math.max(0, Number(patch.limits.gemini) || 0),
      groq_tokens: Math.max(0, Math.floor(Number(patch.limits.groq_tokens) || 0)),
      gemini_tokens: Math.max(0, Math.floor(Number(patch.limits.gemini_tokens) || 0)),
    };
  }
  if (patch.auto_refresh_min !== undefined) {
    data.auto_refresh_min = Math.max(0, Number(patch.auto_refresh_min) || 0);
  }
  _write(empresaId, data);
  return getDashboard(empresaId);
}

function _emptyProvider(provider, limitUsd, limitTokens) {
  return {
    provider,
    calls: 0,
    errors: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    unknown_cost_calls: 0,
    limit_usd: limitUsd,
    limit_tokens: limitTokens,
    available_usd: limitUsd > 0 ? limitUsd : null,
    available_tokens: limitTokens > 0 ? limitTokens : null,
  };
}

function getDashboard(empresaId) {
  const data = _read(empresaId);
  const month = _monthKey();
  const monthEvents = data.events.filter(e => String(e.at || '').startsWith(month));
  const byProvider = {
    groq: _emptyProvider('groq', data.limits.groq, data.limits.groq_tokens),
    gemini: _emptyProvider('gemini', data.limits.gemini, data.limits.gemini_tokens),
  };

  for (const ev of monthEvents) {
    const item = byProvider[ev.provider];
    if (!item) continue;
    item.calls += 1;
    if (!ev.ok) item.errors += 1;
    item.input_tokens += Number(ev.input_tokens) || 0;
    item.output_tokens += Number(ev.output_tokens) || 0;
    item.total_tokens += Number(ev.total_tokens) || 0;
    if (ev.estimated_cost_usd === null || ev.estimated_cost_usd === undefined) {
      item.unknown_cost_calls += 1;
    } else {
      item.estimated_cost_usd += Number(ev.estimated_cost_usd) || 0;
    }
  }

  for (const item of Object.values(byProvider)) {
    item.estimated_cost_usd = Number(item.estimated_cost_usd.toFixed(6));
    item.available_usd = item.limit_usd > 0
      ? Number(Math.max(0, item.limit_usd - item.estimated_cost_usd).toFixed(6))
      : null;
    item.available_tokens = item.limit_tokens > 0
      ? Math.max(0, item.limit_tokens - item.total_tokens)
      : null;
  }

  return {
    month,
    generated_at: new Date().toISOString(),
    auto_refresh_min: data.auto_refresh_min,
    providers: byProvider,
    pricing_note: 'Tokens e custos estimados a partir do uso registrado localmente; saldos reais continuam nos consoles Groq/Gemini.',
  };
}

module.exports = { recordUsage, getDashboard, setSettings };
