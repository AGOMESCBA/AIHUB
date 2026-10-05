const fs = require('fs');
const html = fs.readFileSync('apps/IA Service/frontend/radar.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);

if (!scripts.length) {
  throw new Error('Nenhum bloco <script> encontrado em radar.html.');
}

for (const [i, script] of scripts.entries()) {
  new Function(script);
  console.log(`script ${i + 1}: ok`);
}
