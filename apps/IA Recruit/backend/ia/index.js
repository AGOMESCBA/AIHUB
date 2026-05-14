const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const configDb = require('../configuracoes/database');
const usageDb = require('./usage-db');

function _getGroq(empresaId) {
  const key = configDb.getApiKey('groq_api_key', empresaId) || process.env.GROQ_API_KEY;
  if (!key) throw new Error('Chave Groq não configurada. Acesse Configurações → Chaves de API.');
  return new Groq({ apiKey: key });
}

function _getGemini(empresaId) {
  const key = configDb.getApiKey('gemini_api_key', empresaId) || process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

function _getGeminiModel(empresaId) {
  return configDb.getApiKey('gemini_model', empresaId) || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
}

function isRateLimit(err) {
  return err?.status === 429 || err?.message?.includes('rate_limit') || err?.message?.includes('Rate limit');
}

const noop = () => {};

// ── Chamada base Groq → Gemini ─────────────────────────────────────────────────
async function chamarIA({ systemPrompt, userPrompt, maxTokens = 1000, temperatura = 0.1, modeloGroq = 'llama-3.1-8b-instant', empresaId }, logFn = noop) {
  try {
    const res = await _getGroq(empresaId).chat.completions.create({
      model: modeloGroq, temperature: temperatura, max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
    });
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: modeloGroq,
      usage: res.usage,
      ok: true,
    });
    return res.choices[0].message.content.trim();
  } catch (e) {
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: modeloGroq,
      usage: null,
      ok: false,
      error: e.message,
    });
    if (!isRateLimit(e)) throw e;
    logFn('Groq atingiu limite de tokens. Usando Google Gemini como fallback…', 'warning');
  }

  const gemini = _getGemini(empresaId);
  if (!gemini) throw new Error('Groq atingiu o limite e a chave Gemini não está configurada.');
  const geminiModel = _getGeminiModel(empresaId);
  const model  = gemini.getGenerativeModel({ model: geminiModel });
  try {
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    usageDb.recordUsage(empresaId, {
      provider: 'gemini',
      model: geminiModel,
      usage: result.response?.usageMetadata,
      ok: true,
    });
    return result.response.text().trim();
  } catch (e) {
    usageDb.recordUsage(empresaId, {
      provider: 'gemini',
      model: geminiModel,
      usage: null,
      ok: false,
      error: e.message,
    });
    throw e;
  }
}

// ── Verifica se o documento é um currículo ─────────────────────────────────────
async function verificarSeCurriculo(texto, logFn = noop, empresaId) {
  try {
    const resposta = await chamarIA({
      systemPrompt: 'Você analisa documentos. Responda APENAS com "SIM" se o texto for um currículo/CV profissional, ou "NAO" se for qualquer outro tipo de documento (contrato, nota fiscal, relatório, etc).',
      userPrompt:   `Documento:\n\n${texto.slice(0, 3000)}`,
      maxTokens:    5,
      temperatura:  0,
      empresaId,
    }, logFn);
    return resposta.toUpperCase().startsWith('SIM');
  } catch (e) {
    logFn(`Aviso: falha na verificação de currículo, prosseguindo mesmo assim: ${e.message}`, 'warning');
    return true;
  }
}

// ── Detecta idioma e traduz se necessário ──────────────────────────────────────
async function traduzirSeNecessario(texto, logFn = noop, empresaId) {
  try {
    const idioma = (await chamarIA({
      systemPrompt: 'Identifique o idioma do texto. Responda APENAS com o código ISO 639-1 em minúsculas (ex: pt, en, es, fr, de, it, zh, etc).',
      userPrompt:   texto.slice(0, 500),
      maxTokens:    5,
      temperatura:  0,
      empresaId,
    }, logFn)).toLowerCase().slice(0, 2);

    if (idioma === 'pt') return { texto, idioma };

    logFn(`Idioma detectado: "${idioma}". Traduzindo para português…`, 'info');
    const traduzido = await chamarIA({
      systemPrompt: 'Traduza o texto a seguir para o português do Brasil. Mantenha toda a estrutura, formatação e informações originais. Não resuma nem omita nada.',
      userPrompt:   texto.slice(0, 20000),
      maxTokens:    8000,
      temperatura:  0.1,
      modeloGroq:   'llama-3.3-70b-versatile',
      empresaId,
    }, logFn);
    return { texto: traduzido, idioma };
  } catch (e) {
    logFn(`Aviso: falha na detecção/tradução de idioma, usando texto original: ${e.message}`, 'warning');
    return { texto, idioma: 'pt' };
  }
}

// ── Extrai dados estruturados do currículo (com retry) ─────────────────────────
async function analisarComRetry(texto, logFn = noop, empresaId) {
  const SYSTEM_COMPLETO = `Você é um extrator de currículos. Responda SOMENTE com um objeto JSON válido, sem explicações, sem markdown, sem blocos de código.
IMPORTANTE: NÃO resuma, NÃO omita e NÃO abrevie nenhuma informação. Copie as atividades, descrições e demais campos EXATAMENTE como aparecem no currículo.
Para cada experiência: capture o parágrafo descritivo em "descricao" e TODOS os bullets em "atividades" — prefixe itens de sub-projetos com o nome entre colchetes.
Use esta estrutura:
{"nome":null,"telefone":null,"email":null,"endereco":null,"linkedin":null,"descricao":null,"experiencias":[{"empresa":"","cargo":"","periodo":"","descricao":"","atividades":[]}],"formacao":[{"curso":"","instituicao":"","periodo":""}],"capacitacoes":[],"habilidades":[]}`;

  const SYSTEM_SIMPLES = 'Extraia dados do currículo. NÃO resuma nem omita — copie as atividades exatamente. Responda SOMENTE com JSON válido: {"nome":null,"telefone":null,"email":null,"descricao":null,"experiencias":[],"formacao":[],"capacitacoes":[],"habilidades":[]}';

  const limparJson = (txt) => {
    const m = txt.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\{[\s\S]*\}/);
    if (!m) throw new Error('JSON não encontrado na resposta');
    return JSON.parse(m[0]);
  };

  const groq = _getGroq(empresaId);

  try {
    logFn('Tentativa 1/3: Groq (modelo completo)…', 'info');
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile', temperature: 0.1, max_tokens: 8000,
      messages: [
        { role: 'system', content: SYSTEM_COMPLETO },
        { role: 'user',   content: `Currículo:\n\n${texto.slice(0, 20000)}` },
      ],
    });
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      usage: res.usage,
      ok: true,
    });
    return limparJson(res.choices[0].message.content);
  } catch (e1) {
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      usage: null,
      ok: false,
      error: e1.message,
    });
    logFn(`Tentativa 1 falhou: ${e1.message}.`, 'warning');
  }

  try {
    logFn('Tentativa 2/3: Groq (modelo rápido)…', 'info');
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant', temperature: 0.1, max_tokens: 5000,
      messages: [
        { role: 'system', content: SYSTEM_SIMPLES },
        { role: 'user',   content: `Currículo:\n\n${texto.slice(0, 12000)}` },
      ],
    });
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      usage: res.usage,
      ok: true,
    });
    return limparJson(res.choices[0].message.content);
  } catch (e2) {
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      usage: null,
      ok: false,
      error: e2.message,
    });
    logFn(`Tentativa 2 falhou: ${e2.message}.`, 'warning');
  }

  const gemini = _getGemini(empresaId);
  if (gemini) {
    try {
      logFn('Tentativa 3/3: Google Gemini (fallback)…', 'info');
      const geminiModel = _getGeminiModel(empresaId);
      const model  = gemini.getGenerativeModel({ model: geminiModel });
      const result = await model.generateContent(`${SYSTEM_COMPLETO}\n\nCurrículo:\n\n${texto.slice(0, 20000)}`);
      usageDb.recordUsage(empresaId, {
        provider: 'gemini',
        model: geminiModel,
        usage: result.response?.usageMetadata,
        ok: true,
      });
      return limparJson(result.response.text());
    } catch (e3) {
      usageDb.recordUsage(empresaId, {
        provider: 'gemini',
        model: _getGeminiModel(empresaId),
        usage: null,
        ok: false,
        error: e3.message,
      });
      logFn(`Tentativa 3 (Gemini) falhou: ${e3.message}. Usando texto livre…`, 'warning');
    }
  }

  try {
    logFn('Tentativa 4/4: extração JSON mínima (campos-chave)…', 'warning');
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant', temperature: 0.3, max_tokens: 3000,
      messages: [
        { role: 'system', content: `Extraia os dados do currículo abaixo. O texto pode estar desorganizado (PDF multi-coluna). Identifique e preencha cada campo.\nResponda SOMENTE com JSON válido, sem markdown:\n{"nome":null,"telefone":null,"email":null,"endereco":null,"linkedin":null,"descricao":null,"experiencias":[{"empresa":"","cargo":"","periodo":"","descricao":"","atividades":[]}],"formacao":[{"curso":"","instituicao":"","periodo":""}],"capacitacoes":[],"habilidades":[]}` },
        { role: 'user',   content: `Currículo:\n\n${texto.slice(0, 12000)}` },
      ],
    });
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      usage: res.usage,
      ok: true,
    });
    return limparJson(res.choices[0].message.content);
  } catch (e4) {
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      usage: null,
      ok: false,
      error: e4.message,
    });
    logFn(`Tentativa 4 falhou: ${e4.message}. Usando texto livre como último recurso…`, 'warning');
  }

  logFn('Tentativa 5/5: salvando texto livre como último recurso…', 'warning');
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant', temperature: 0.2, max_tokens: 2000,
    messages: [
      { role: 'system', content: 'Organize as informações do currículo em formato legível em português. Inclua todos os dados: nome, contato, experiências, formação e habilidades.' },
      { role: 'user',   content: `Currículo:\n\n${texto.slice(0, 6000)}` },
    ],
  });
  usageDb.recordUsage(empresaId, {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    usage: res.usage,
    ok: true,
  });
  return { nome: null, descricao: res.choices[0].message.content };
}

module.exports = { chamarIA, verificarSeCurriculo, traduzirSeNecessario, analisarComRetry };
