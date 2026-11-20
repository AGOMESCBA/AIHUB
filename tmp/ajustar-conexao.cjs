const fs = require('node:fs');
const p = 'apps/IA Service/frontend/j2a/assets/conexao-servidor.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace("document.querySelector('.page-content, #app, .main, main') || document.body", "document.querySelector('.page-content') || document.querySelector('#app') || document.querySelector('.main') || document.querySelector('main') || document.body");
const inicio = s.indexOf('    const ctrl = new AbortController();');
const fim = s.indexOf('\n  }', inicio);
s = s.slice(0, inicio) + `    // Mantém o sinal original durante o consumo de corpos e streams.
    if (!leitura || sinal) return originalFetch(input, options);
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(new DOMException('Tempo limite de 15 s', 'TimeoutError')), 15000);
    try { return await originalFetch(input, { ...options, signal: ctrl.signal }); }
    finally { clearTimeout(prazo); }` + s.slice(fim);
s = s.replace("    if (falha && !options?.signal && !(input instanceof Request) && pendentes.has(chave))", "    const compartilhar = !options?.signal && !(input instanceof Request);\n    if (falha && compartilhar && pendentes.has(chave))");
s = s.replace('    pendentes.set(chave, promessa);', '    if (compartilhar) pendentes.set(chave, promessa);');
s = s.replace('    return promessa.finally(() => {', '    let confirmou = false;\n    return promessa.then(r => { confirmou = r.ok; return r; }).finally(() => {');
s = s.replace('      recuperar();\n    });', '      if (confirmou) recuperar();\n    });');
fs.writeFileSync(p, s);
