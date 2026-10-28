// A tela de rotinas do painel de Administração (usuários) é o ESPELHO do menu
// de cada sistema (pedido do usuário, 2026-10-28: "não existe rotina fora de
// um menu"). Este teste falha quando um menu muda e a lista de rotinas em
// apps/IA Administracao/frontend/administracao.html fica para trás: mesmas
// seções, na mesma ordem, com as mesmas rotinas na mesma ordem.
// Executar: node tests/rotinas-espelho-menu.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const SISTEMAS = {
  'ia-recruit': 'apps/IA Recruit/frontend/js/sidebar.js',
  'ia-command': 'apps/IA Command/frontend/js/sidebar.js',
  'ia-service': 'apps/IA Service/frontend/js/sidebar.js',
  'master-crypto': 'apps/Master Crypto/frontend/js/sidebar.js',
};

// Avalia só o literal do array (variáveis citadas nele, ex. radarHref, viram null).
function literal(fonte, marcador) {
  const inicio = fonte.indexOf('[', fonte.indexOf(marcador));
  let nivel = 0;
  let fim = inicio;
  for (; fim < fonte.length; fim++) {
    if (fonte[fim] === '[') nivel++;
    else if (fonte[fim] === ']' && --nivel === 0) break;
  }
  const qualquer = new Proxy({}, { has: () => true, get: (_t, k) => (k === Symbol.unscopables ? undefined : null) });
  // JSON: objetos de outro contexto do vm não passam no deepStrictEqual.
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + fonte.slice(inicio, fim + 1) + ')', qualquer)));
}

// Seções do menu com as rotinas em ordem (subgrupos achatados na seção).
function secoesDoMenu(arquivo) {
  const menu = literal(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'), 'const MENU');
  const rotinas = (itens) => itens.flatMap(i => (i.items ? rotinas(i.items) : [i.rotina || i.id]));
  return menu.map(sec => rotinas(sec.items || []));
}

const adm = fs.readFileSync(path.join(RAIZ, 'apps/IA Administracao/frontend/administracao.html'), 'utf8');
const base = literal(adm, 'const _USU_ROTINAS_BASE');

assert.deepStrictEqual(base.map(g => g.id), Object.keys(SISTEMAS), 'um grupo por sistema com menu');
for (const grupo of base) {
  const menu = secoesDoMenu(SISTEMAS[grupo.id]);
  const tela = grupo.secoes.map(sec => sec.itens.map(i => i.id));
  assert.deepStrictEqual(tela, menu, `${grupo.label}: rotinas da tela de permissões diferentes do menu`);
}

console.log('rotinas-espelho-menu.test.js: OK');
