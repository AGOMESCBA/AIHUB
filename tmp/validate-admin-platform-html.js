const fs = require('fs');

for (const file of [
  'apps/IA Administracao/frontend/platform-config.html',
  'apps/IA Administracao/frontend/administracao.html',
]) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const script of scripts) new Function(script);
}

console.log('html js ok');
