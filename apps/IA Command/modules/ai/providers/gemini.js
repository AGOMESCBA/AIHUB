const https = require('https');

const GEMINI_MODEL = 'gemini-3.5-flash';
const MAX_TENTATIVAS_SOBRECARGA = 3;
const DELAY_RETRY_MS = 1500;

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _isSobrecarga(msg = '') {
  const m = msg.toLowerCase();
  return m.includes('high demand') || m.includes('overloaded') || m.includes('unavailable');
}

function _requestOnce(prompt, apiKey, modelo) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  });

  const path = `/v1beta/models/${modelo || GEMINI_MODEL}:generateContent?key=${apiKey}`;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (!raw) return reject(new Error('Gemini: resposta vazia (conexão interrompida antes de completar).'));

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          return reject(new Error(`Gemini: resposta não é JSON válido (${e.message}).`));
        }

        if (parsed.error) return reject(new Error(parsed.error.message || 'Gemini error'));

        const candidato = parsed.candidates?.[0];
        const text = candidato?.content?.parts?.[0]?.text;
        if (!text) {
          const motivo = candidato?.finishReason || 'sem_candidato';
          return reject(new Error(`Gemini: sem texto na resposta (finishReason=${motivo}). Aumente maxOutputTokens se for MAX_TOKENS.`));
        }

        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error(`Gemini: texto retornado não é JSON válido (${e.message}).`));
        }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Gemini: tempo limite de 20s excedido.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function classificarIntencao(mensagem, apiKey, intencoes, sinonimos = [], contextoAnterior = null, modelo = null) {
  const prompt = require('../prompts/intent-classifier').buildPrompt(mensagem, intencoes, sinonimos, contextoAnterior);

  let ultimoErro;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_SOBRECARGA; tentativa++) {
    try {
      return await _requestOnce(prompt, apiKey, modelo);
    } catch (e) {
      ultimoErro = e;
      if (!_isSobrecarga(e.message) || tentativa === MAX_TENTATIVAS_SOBRECARGA) throw e;
      await _sleep(DELAY_RETRY_MS * tentativa);
    }
  }
  throw ultimoErro;
}

module.exports = { classificarIntencao };
