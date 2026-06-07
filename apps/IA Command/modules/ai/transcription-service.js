const https = require('https');
const tls   = require('tls');
const fs    = require('fs');
const path  = require('path');
const FormData = require('form-data');

const WHISPER_MODEL = 'whisper-large-v3';
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
  const cfg = { apiKey: null, model: WHISPER_MODEL, language: 'pt' };

  try {
    const { getDB } = require('../database');
    const db = getDB();
    const row = db.prepare(`
      SELECT groq_api_key, whisper_model, audio_idioma
      FROM ai_config
      WHERE empresa_id = ?
      LIMIT 1
    `).get(empresaId);
    if (row?.groq_api_key) cfg.apiKey = row.groq_api_key;
    if (row?.whisper_model) cfg.model = row.whisper_model;
    if (row?.audio_idioma) cfg.language = row.audio_idioma;
  } catch (_) {}

  if (!cfg.apiKey) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      const key = await getApiKey('groq_api_key', empresaId);
      if (key) cfg.apiKey = key;
    } catch (_) {}
  }

  if (!cfg.apiKey) cfg.apiKey = process.env.GROQ_API_KEY || null;
  return cfg;
}

async function transcrever(audioPath, empresaId) {
  const { apiKey, model, language } = await _resolveTranscriptionConfig(empresaId);
  if (!apiKey) throw new Error('Chave Groq nao configurada para transcricao de audio.');

  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), {
    filename:    path.basename(audioPath),
    contentType: 'audio/ogg',
  });
  form.append('model',    model || WHISPER_MODEL);
  form.append('language', language || 'pt');

  return new Promise((resolve, reject) => {
    const formHeaders = form.getHeaders();
    const opts = {
      hostname: 'api.groq.com',
      path:     '/openai/v1/audio/transcriptions',
      method:   'POST',
      agent:    _getHttpsAgent(),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formHeaders,
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Whisper error'));
          resolve(parsed.text || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

module.exports = { transcrever, _resolveTranscriptionConfig };
