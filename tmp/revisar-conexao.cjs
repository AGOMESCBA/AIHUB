const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const frontend = 'apps/IA Service/frontend';
const fontes = cp.execFileSync('git', ['diff', '--', frontend], { encoding: 'utf8' });
const blocos = fontes.split(/(?=^diff --git )/m).filter(Boolean);
let inclusoes = 0;
for (const bloco of blocos) {
  const alteracoes = bloco.split('\n').filter(linha => /^[+-]/.test(linha) && !/^\+\+\+|^---/.test(linha));
  const novas = alteracoes.filter(linha => linha.includes('conexao-servidor'));
  if (novas.length !== 2) throw new Error('Integração incompleta: ' + bloco.split('\n')[0]);
  inclusoes++;
  if (!/historico-acessos\.html|monitor-acessos\.html/.test(bloco.split('\n')[0]) && alteracoes.length !== 2) throw new Error('Alteração fora do escopo: ' + bloco.split('\n')[0]);
}
if (inclusoes !== 16) throw new Error('Total inesperado de páginas: ' + inclusoes);
for (const nome of ['conexao-servidor.js', 'conexao-servidor.css']) {
  const p = path.join(frontend, 'j2a/assets', nome);
  if (!fs.statSync(p).size) throw new Error('Asset vazio: ' + p);
}
console.log('Revisão OK: 16 integrações; demais alterações prévias de Monitor/Histórico preservadas.');
