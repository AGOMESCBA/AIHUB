'use strict';

const https = require('https');
const intentService = require('./intent-service');

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
    model: 'claude-3-5-haiku-latest',
    tipo: 'anthropic',
  },
  gemini: {
    hostname: 'generativelanguage.googleapis.com',
    path: null,
    model: 'gemini-2.0-flash',
    tipo: 'gemini',
  },
};

function _buildDialogPrompt(mensagem) {
  const agora = new Date();
  const hora = agora.getHours();
  const periodo = hora < 12 ? 'manha' : hora < 18 ? 'tarde' : 'noite';
  const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dataStr = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  return [
    'Voce e o IA Command, assistente de consultas ao ERP via WhatsApp.',
    'Responda em portugues do Brasil, com tom profissional, cordial e direto.',
    `Data e hora atuais: ${dataStr}, ${horaStr} (periodo: ${periodo}).`,
    '',
    'REGRAS DE COMPORTAMENTO:',
    '- Use sempre o cumprimento correto para o periodo do dia atual (bom dia / boa tarde / boa noite), independente do que o usuario escreveu.',
    '- Nunca repita a mesma resposta de uma mensagem anterior. Varie o texto naturalmente.',
    '- Nao peca para escolher empresa em conversas gerais. Isso e feito automaticamente quando o usuario fizer uma consulta de dados.',
    '- Nao invente dados do ERP. Para consultas concretas, oriente a pessoa a perguntar naturalmente.',
    '',
    'QUANDO O USUARIO PERGUNTAR O QUE VOCE FAZ OU QUAIS INFORMACOES VOCE ACESSA, responda com esta lista detalhada (adapte o texto para soar natural):',
    '• *Faturamento e vendas* — total faturado, ranking de clientes, vendas por periodo, por produto ou por vendedor',
    '• *Compras* — pedidos de compra, fornecedores, volumes por periodo',
    '• *Financeiro* — contas a pagar, contas a receber, titulos em aberto, vencidos ou a vencer',
    '• *Fluxo de caixa* — entradas e saidas por periodo',
    '• *Estoque* — posicao atual, movimentacoes, itens criticos',
    '• *Comissoes* — apuracoes por vendedor ou por periodo',
    'Encerre convidando o usuario a fazer uma pergunta, por exemplo: "E so perguntar naturalmente, como: faturamento de hoje ou contas a pagar desta semana."',
    '',
    'QUANDO FOR APENAS UMA SAUDACAO, responda com boas-vindas curtas e convide a perguntar. Nao liste tudo.',
    '',
    `Mensagem do usuario: ${mensagem}`,
  ].join('\n');
}

function _requestOpenAICompat(cfg, apiKey, prompt) {
  const body = JSON.stringify({
    model: cfg.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 450,
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: cfg.hostname,
      path: cfg.path,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Erro no provider.'));
          const content = parsed.choices?.[0]?.message?.content;
          if (!content) return reject(new Error('Provider nao retornou texto.'));
          resolve(String(content).trim());
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Tempo limite de 20s excedido.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _requestGemini(cfg, apiKey, prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 450 },
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: cfg.hostname,
      path: `/v1beta/models/${cfg.model}:generateContent?key=${apiKey}`,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Gemini error'));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) return reject(new Error('Gemini nao retornou texto.'));
          resolve(String(text).trim());
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Gemini: tempo limite de 20s excedido.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _requestClaude(cfg, apiKey, prompt) {
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: 450,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: cfg.hostname,
      path: cfg.path,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Claude error'));
          const text = (parsed.content || [])
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n')
            .trim();
          if (!text) return reject(new Error('Claude nao retornou texto.'));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Claude: tempo limite de 20s excedido.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function responder(mensagem, empresaId) {
  const { keys, cfg } = await intentService._resolveKeys(empresaId);
  const ordem = intentService._normalizarOrdem(cfg);
  const prompt = _buildDialogPrompt(mensagem);
  const erros = [];

  for (const provedor of ordem) {
    if (!keys[provedor] || !PROVIDER_CONFIGS[provedor]) continue;
    try {
      const pcfg = PROVIDER_CONFIGS[provedor];
      const resposta = pcfg.tipo === 'gemini'
        ? await _requestGemini(pcfg, keys[provedor], prompt)
        : pcfg.tipo === 'anthropic'
          ? await _requestClaude(pcfg, keys[provedor], prompt)
          : await _requestOpenAICompat(pcfg, keys[provedor], prompt);
      return { ok: true, resposta, provedor, erros };
    } catch (e) {
      erros.push({ provedor, erro: e.message });
    }
  }

  return { ok: false, resposta: null, provedor: null, erros };
}

function _buildRouterSystem() {
  const agora = new Date();
  const hora = agora.getHours();
  const periodo = hora < 12 ? 'manha' : hora < 18 ? 'tarde' : 'noite';
  const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dataStr = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  return [
    `Voce e o IA Command — assistente que consulta dados do ERP via WhatsApp em linguagem natural.`,
    `Data e hora: ${dataStr}, ${horaStr} (periodo: ${periodo}).`,
    '',
    'Voce esta em modo de conversa. Responda de forma natural e humana, como um assistente inteligente.',
    'Nao use templates fixos. Responda exatamente o que foi perguntado.',
    '',
    'REGRAS:',
    '- Cumprimento correto para o periodo do dia atual, independente do que o usuario escreveu.',
    '- Nao peca para escolher empresa — isso e feito automaticamente quando houver consulta de dados.',
    '- Nao invente dados do ERP.',
    '- Respostas curtas e adequadas para WhatsApp.',
    '',
    'QUANDO DETECTAR PEDIDO DE DADOS DO ERP (vendas, faturamento, compras, financeiro, estoque, titulos, comissoes, etc.):',
    'Responda SOMENTE com este JSON, sem mais nada:',
    '{"tipo":"data_request","consulta":"[a consulta em linguagem natural, limpa e clara]"}',
  ].join('\n');
}

function _toGeminiRole(role) {
  return role === 'assistant' ? 'model' : 'user';
}

async function _requestOpenAICompatChat(cfg, apiKey, systemPrompt, messages) {
  const body = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    temperature: 0.4,
    max_tokens: 450,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: cfg.hostname, path: cfg.path, method: 'POST',
      rejectUnauthorized: false,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const p = JSON.parse(raw);
          if (p.error) return reject(new Error(p.error.message || 'Erro no provider.'));
          const content = p.choices?.[0]?.message?.content;
          if (!content) return reject(new Error('Provider nao retornou texto.'));
          resolve(String(content).trim());
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Timeout 20s.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function _requestAnthropicChat(cfg, apiKey, systemPrompt, messages) {
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: 450,
    temperature: 0.4,
    system: systemPrompt,
    messages,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: cfg.hostname, path: cfg.path, method: 'POST',
      rejectUnauthorized: false,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const p = JSON.parse(raw);
          if (p.error) return reject(new Error(p.error.message || 'Claude error'));
          const text = (p.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
          if (!text) return reject(new Error('Claude nao retornou texto.'));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Claude timeout 20s.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function _requestGeminiChat(cfg, apiKey, systemPrompt, messages) {
  const contents = messages.map(m => ({
    role: _toGeminiRole(m.role),
    parts: [{ text: m.content }],
  }));
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 450 },
  });

  return new Promise((resolve, reject) => {
    const path = `/v1beta/models/${cfg.model}:generateContent?key=${apiKey}`;
    const req = https.request({
      hostname: cfg.hostname, path, method: 'POST',
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const p = JSON.parse(raw);
          if (p.error) return reject(new Error(p.error.message || 'Gemini error'));
          const text = p.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('\n');
          if (!text) return reject(new Error('Gemini nao retornou texto.'));
          resolve(String(text).trim());
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Gemini timeout 20s.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const _MAX_HISTORICO = 20;

// ── Cache do roteador conversacional ────────────────────────────────────────
const _cacheRoteamento = new Map();
const _ROTEAR_TTL_MS   = 2 * 60 * 1000;  // 2 minutos
const _MAX_ROTEAR      = 200;

function _rotearCacheKey(empresaId, mensagem) {
  return `${empresaId}:${mensagem.trim().toLowerCase()}`;
}

function _rotearCacheGet(key) {
  const item = _cacheRoteamento.get(key);
  if (!item || item.expiraEm < Date.now()) {
    if (item) _cacheRoteamento.delete(key);
    return null;
  }
  return item.valor;
}

function _rotearCacheSet(key, valor) {
  _cacheRoteamento.set(key, { valor, expiraEm: Date.now() + _ROTEAR_TTL_MS });
  if (_cacheRoteamento.size > _MAX_ROTEAR) {
    const firstKey = _cacheRoteamento.keys().next().value;
    if (firstKey) _cacheRoteamento.delete(firstKey);
  }
  return valor;
}

// ── Bypass determinístico: padrões ERP claros → pula chamada de IA ──────────
const _PADROES_ERP = [
  /\b(faturamento|vendas?|receita)\b/i,
  /\b(compras?|fornecedor|pedido)\b/i,
  /\b(financeiro|contas?\s+a\s+pagar|contas?\s+a\s+receber|t[ií]tulos?|baixas?)\b/i,
  /\b(comiss[ãa]o|comissoes|vendedor)\b/i,
  /\b(ontem|hoje|essa\s+semana|esse\s+m[eê]s|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i,
  /\b(quanto|total|valor|saldo|resumo|relat[oó]rio)\b/i,
];

function _ehPadraoErp(mensagem) {
  return _PADROES_ERP.some(p => p.test(mensagem));
}

async function rotear(mensagem, empresaId, historico = []) {
  const cacheKey = _rotearCacheKey(empresaId, mensagem);

  const cached = _rotearCacheGet(cacheKey);
  if (cached) return cached;

  // Bypass: mensagem com padrão ERP inequívoco → pula chamada de IA
  if (historico.length === 0 && _ehPadraoErp(mensagem)) {
    const resultado = { tipo: 'data_request', consulta: mensagem, provedor: 'bypass_local' };
    _rotearCacheSet(cacheKey, resultado);
    return resultado;
  }

  const { keys, cfg } = await intentService._resolveKeys(empresaId);
  const ordem = intentService._normalizarOrdem(cfg);
  const systemPrompt = _buildRouterSystem();
  const messages = [...historico.slice(-_MAX_HISTORICO), { role: 'user', content: mensagem }];

  for (const provedor of ordem) {
    if (!keys[provedor] || !PROVIDER_CONFIGS[provedor]) continue;
    try {
      const pcfg = PROVIDER_CONFIGS[provedor];
      const raw = pcfg.tipo === 'gemini'
        ? await _requestGeminiChat(pcfg, keys[provedor], systemPrompt, messages)
        : pcfg.tipo === 'anthropic'
          ? await _requestAnthropicChat(pcfg, keys[provedor], systemPrompt, messages)
          : await _requestOpenAICompatChat(pcfg, keys[provedor], systemPrompt, messages);

      const texto = String(raw || '').trim();

      // Tenta parse direto (resposta pura JSON ou com code fence)
      try {
        const semFence = texto.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(semFence);
        if (parsed?.tipo === 'data_request' && parsed?.consulta) {
          const resultado = { tipo: 'data_request', consulta: String(parsed.consulta), provedor };
          _rotearCacheSet(cacheKey, resultado);
          return resultado;
        }
      } catch (_) {}

      // Fallback: LLM misturou texto + JSON (ex: "Boa tarde!\n{...}") — extrai o bloco JSON
      const jsonMatch = texto.match(/\{[^{}]*"tipo"\s*:\s*"data_request"[^{}]*\}/s);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed?.tipo === 'data_request' && parsed?.consulta) {
            const resultado = { tipo: 'data_request', consulta: String(parsed.consulta), provedor };
            _rotearCacheSet(cacheKey, resultado);
            return resultado;
          }
        } catch (_) {}
      }

      // Respostas conversacionais não são cacheadas: variam com histórico e hora do dia
      return { tipo: 'conversacional', resposta: texto, provedor };
    } catch (e) {
      console.warn(`[ConversationRouter] ${provedor} falhou: ${e.message}`);
    }
  }

  return { tipo: 'data_request', consulta: mensagem, provedor: null };
}

module.exports = {
  responder,
  rotear,
  _buildDialogPrompt,
  _buildRouterSystem,
};
