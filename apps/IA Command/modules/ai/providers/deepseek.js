const https = require('https');

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL   = 'deepseek-chat';

async function classificarIntencao(mensagem, apiKey, intencoes, sinonimos = []) {
  const prompt = require('../prompts/intent-classifier').buildPrompt(mensagem, intencoes, sinonimos);
  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(DEEPSEEK_API_URL);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error.message || 'DeepSeek error'));
          const content = parsed.choices?.[0]?.message?.content;
          resolve(JSON.parse(content));
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('DeepSeek: tempo limite de 20s excedido.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { classificarIntencao };
