const https = require('https');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL   = 'gpt-4o-mini';

async function classificarIntencao(mensagem, apiKey, intencoes, sinonimos = [], contextoAnterior = null, modelo = null) {
  const prompt = require('../prompts/intent-classifier').buildPrompt(mensagem, intencoes, sinonimos, contextoAnterior);
  const body = JSON.stringify({
    model: modelo || OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });

  return new Promise((resolve, reject) => {
    const url  = new URL(OPENAI_API_URL);
    const opts = {
      hostname:             url.hostname,
      path:                 url.pathname,
      method:               'POST',
      rejectUnauthorized:   false,
      headers: {
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(`[HTTP ${res.statusCode}] ${parsed.error.message || 'OpenAI error'}`));
          const content = parsed.choices?.[0]?.message?.content;
          if (!content) return reject(new Error(`[HTTP ${res.statusCode}] OpenAI nao retornou conteudo.`));
          resolve(JSON.parse(content));
        } catch (e) { reject(new Error(`[HTTP ${res.statusCode}] ${e.message} | raw: ${raw.slice(0, 200)}`)); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('OpenAI: tempo limite de 20s excedido.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { classificarIntencao };
