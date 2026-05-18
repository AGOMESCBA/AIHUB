const https = require('https');

const CLAUDE_MODEL = 'claude-3-5-haiku-latest';

function _extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch (_) {}
  const ini = raw.indexOf('{');
  const fim = raw.lastIndexOf('}');
  if (ini >= 0 && fim > ini) return JSON.parse(raw.slice(ini, fim + 1));
  throw new Error('Claude nao retornou JSON valido.');
}

async function classificarIntencao(mensagem, apiKey, intencoes, sinonimos = []) {
  const prompt = require('../prompts/intent-classifier').buildPrompt(mensagem, intencoes, sinonimos);
  const body = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
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
          if (parsed.error) return reject(new Error(parsed.error.message || 'Claude error'));
          const text = (parsed.content || [])
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n');
          resolve(_extractJson(text));
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Claude: tempo limite de 20s excedido.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { classificarIntencao };
