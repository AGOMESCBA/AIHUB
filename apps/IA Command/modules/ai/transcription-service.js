const https    = require('https');
const tls      = require('tls');
const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');

const WHISPER_MODEL_GROQ   = 'whisper-large-v3';
const WHISPER_MODEL_OPENAI = 'whisper-1';
const GEMINI_MODEL         = 'gemini-2.0-flash';

// Ordem de fallback de transcrição: mesma filosofia do fallback de texto em
// ai-provider-client.js — tenta na ordem, qualquer erro cai para o próximo.
// Groq e OpenAI usam ASR dedicado (transcrição literal garantida). Gemini
// transcreve via prompt num LLM generativo — fica por último por não ter a
// mesma garantia de fidelidade literal do áudio.
const ORDEM_TRANSCRICAO = ['groq', 'openai', 'gemini'];

let _httpsAgent = null;

function _getHttpsAgent() {
  if (_httpsAgent) return _httpsAgent;
  const ca = [
    ...tls.getCACertificates('default'),
    ...tls.getCACertificates('system'),
  ];
  _httpsAgent = new https.Agent({ ca });
  return _httpsAgent;
}

async function _resolveTranscriptionConfig(empresaId) {
  const cfg = {
    keys: { groq: null, openai: null, gemini: null },
    model: { groq: WHISPER_MODEL_GROQ, openai: WHISPER_MODEL_OPENAI, gemini: GEMINI_MODEL },
    language: 'pt',
  };

  try {
    const { getDB } = require('../database');
    const db = getDB();
    const row = db.prepare(`
      SELECT groq_api_key, openai_api_key, gemini_api_key, whisper_model, audio_idioma
      FROM ai_config
      WHERE empresa_id = ?
      LIMIT 1
    `).get(empresaId);
    if (row?.groq_api_key)   cfg.keys.groq   = row.groq_api_key;
    if (row?.openai_api_key) cfg.keys.openai = row.openai_api_key;
    if (row?.gemini_api_key) cfg.keys.gemini = row.gemini_api_key;
    if (row?.whisper_model)  cfg.model.groq  = row.whisper_model;
    if (row?.audio_idioma)   cfg.language    = row.audio_idioma;
  } catch (_) {}

  // Fallback: chaves gerais do IAHub (mesmo padrão usado para os providers de texto)
  for (const provedor of ['groq', 'openai', 'gemini']) {
    if (cfg.keys[provedor]) continue;
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      const key = await getApiKey(`${provedor}_api_key`, empresaId);
      if (key) cfg.keys[provedor] = key;
    } catch (_) {}
  }

  if (!cfg.keys.groq)   cfg.keys.groq   = process.env.GROQ_API_KEY   || null;
  if (!cfg.keys.openai) cfg.keys.openai = process.env.OPENAI_API_KEY || null;
  if (!cfg.keys.gemini) cfg.keys.gemini = process.env.GEMINI_API_KEY || null;

  return cfg;
}

function _mimeParaExt(audioPath) {
  return path.extname(audioPath).replace('.', '') || 'ogg';
}

// ── Groq e OpenAI: mesmo formato de endpoint (multipart/form-data, resposta { text }) ──

function _transcreverViaWhisperCompat(hostname, endpointPath, apiKey, audioPath, model, language) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), {
    filename:    path.basename(audioPath),
    contentType: `audio/${_mimeParaExt(audioPath)}`,
  });
  form.append('model', model);
  if (language) form.append('language', language);

  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      path:   endpointPath,
      method: 'POST',
      agent:  _getHttpsAgent(),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || parsed.error || 'Erro na transcricao'));
          resolve(String(parsed.text || '').trim());
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

function _transcreverGroq(audioPath, cfg) {
  if (!cfg.keys.groq) throw Object.assign(new Error('Chave Groq nao configurada.'), { _semChave: true });
  return _transcreverViaWhisperCompat(
    'api.groq.com', '/openai/v1/audio/transcriptions',
    cfg.keys.groq, audioPath, cfg.model.groq, cfg.language
  );
}

function _transcreverOpenAI(audioPath, cfg) {
  if (!cfg.keys.openai) throw Object.assign(new Error('Chave OpenAI nao configurada.'), { _semChave: true });
  return _transcreverViaWhisperCompat(
    'api.openai.com', '/v1/audio/transcriptions',
    cfg.keys.openai, audioPath, cfg.model.openai, cfg.language
  );
}

// ── Gemini: sem endpoint dedicado de transcrição — envia áudio inline (base64)
// dentro de generateContent, com prompt de instrução para transcrever literalmente.

function _transcreverGemini(audioPath, cfg) {
  if (!cfg.keys.gemini) throw Object.assign(new Error('Chave Gemini nao configurada.'), { _semChave: true });

  const base64Audio = fs.readFileSync(audioPath).toString('base64');
  const mimeType     = `audio/${_mimeParaExt(audioPath)}`;
  const idiomaTexto  = cfg.language === 'pt' ? 'portugues do Brasil' : cfg.language;

  const body = {
    contents: [{
      parts: [
        { text: `Transcreva literalmente o audio a seguir em ${idiomaTexto}. Responda APENAS com o texto transcrito, sem comentarios, sem resumir, sem corrigir ou parafrasear o que foi dito.` },
        { inline_data: { mime_type: mimeType, data: base64Audio } },
      ],
    }],
    generationConfig: { temperature: 0 },
  };
  const bodyStr = JSON.stringify(body);
  const reqPath = `/v1beta/models/${cfg.model.gemini}:generateContent?key=${encodeURIComponent(cfg.keys.gemini)}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path:     reqPath,
      method:   'POST',
      agent:    _getHttpsAgent(),
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Erro na transcricao (Gemini)'));
          const texto = parsed.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim();
          if (!texto) return reject(new Error('Resposta vazia do Gemini.'));
          resolve(texto);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

const _TRANSCRITORES = {
  groq:   _transcreverGroq,
  openai: _transcreverOpenAI,
  gemini: _transcreverGemini,
};

// Transcreve tentando cada provider configurado na ordem ORDEM_TRANSCRICAO.
// Mesmo critério do fallback de texto (ai-provider-client.js): qualquer erro
// (chave ausente, cota, rede, timeout) faz cair para o próximo provider.
async function transcrever(audioPath, empresaId) {
  const cfg = await _resolveTranscriptionConfig(empresaId);
  const erros = [];

  for (const provedor of ORDEM_TRANSCRICAO) {
    if (!cfg.keys[provedor]) continue;
    try {
      return await _TRANSCRITORES[provedor](audioPath, cfg);
    } catch (e) {
      erros.push(`${provedor}: ${e.message || e}`);
    }
  }

  if (erros.length === 0) {
    throw new Error('Nenhuma chave de IA (Groq, OpenAI ou Gemini) configurada para transcricao de audio.');
  }
  throw new Error(`Falha na transcricao em todos os providers disponiveis — ${erros.join(' | ')}`);
}

module.exports = { transcrever, _resolveTranscriptionConfig, ORDEM_TRANSCRICAO };
