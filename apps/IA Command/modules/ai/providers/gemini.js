const https = require('https');

const GEMINI_MODEL = 'gemini-2.0-flash';

async function classificarIntencao(mensagem, apiKey) {
  const prompt = require('../prompts/intent-classifier').buildPrompt(mensagem);
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json' },
  });

  const path = `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Gemini error'));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          resolve(JSON.parse(text));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { classificarIntencao };
