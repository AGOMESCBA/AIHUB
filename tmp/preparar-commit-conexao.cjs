const fs = require('node:fs');
const cp = require('node:child_process');
const base = 'apps/IA Service/frontend/';
const parciais = ['monitor-acessos.html', 'historico-acessos.html'];
let patch = '';
for (const nome of parciais) {
  const arquivo = base + nome;
  const original = cp.execFileSync('git', ['show', 'HEAD:' + arquivo], { encoding: 'utf8' });
  const linhas = original.split('\n');
  const numero = linhas.findIndex(l => l.replace(/\r$/, '') === '</head>') + 1;
  if (!numero) throw new Error('Cabeçalho não localizado: ' + arquivo);
  const extras = '  <link rel="stylesheet" href="/iaservice/assets/conexao-servidor.css">\n  <script src="/iaservice/assets/conexao-servidor.js"' + (nome === 'monitor-acessos.html' ? ' data-conexao-nativa' : '') + '></script>';
  patch += 'diff --git ' + JSON.stringify('a/' + arquivo) + ' ' + JSON.stringify('b/' + arquivo) + '\n--- ' + JSON.stringify('a/' + arquivo) + '\n+++ ' + JSON.stringify('b/' + arquivo) + '\n@@ -' + numero + ',1 +' + numero + ',3 @@\n' + extras.split('\n').map(l => '+' + l).join('\n') + '\n </head>\n';
}
fs.writeFileSync('tmp/conexao-stage-parcial.patch', patch);
cp.execFileSync('git', ['apply', '--cached', '--check', 'tmp/conexao-stage-parcial.patch'], { stdio: 'inherit' });
cp.execFileSync('git', ['apply', '--cached', 'tmp/conexao-stage-parcial.patch'], { stdio: 'inherit' });
const completos = ['atendimento.html', 'atendimentos.html', 'base-historica.html', 'config-ia.html', 'consultores.html', 'entrar.html', 'guia/index.html', 'home.html', 'homologacao.html', 'j2a/index.html', 'limpeza-anexos.html', 'numeros-autorizados.html', 'radar.html', 'shell.html', 'j2a/assets/conexao-servidor.js', 'j2a/assets/conexao-servidor.css'];
cp.execFileSync('git', ['add', '--', ...completos.map(n => base + n), 'apps/IA Service/tests/conexao-servidor-ui.test.js'], { stdio: 'inherit' });
console.log('Índice preparado somente com o recurso de comunicação.');
