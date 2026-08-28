'use strict';

/**
 * Snapshot estrutural do system prompt do financeiro.
 *
 * Os outros testes do financeiro verificam frases isoladas (includes de string),
 * o que nao detecta a remocao de uma secao inteira se nenhuma das frases testadas
 * estiver dentro dela. Este teste verifica que TODAS as secoes "## Titulo"
 * esperadas continuam presentes no regrasTecnicas — pega regressao de conteudo
 * mesmo quando nenhuma assercao de frase pontual quebra.
 *
 * Se uma secao for removida de proposito (ex: auditoria de duplicacao), atualize
 * SECOES_ESPERADAS junto com a mudanca no spec, no mesmo commit.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const financeiroSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec'));

let passou = 0;
let falhou = 0;

function ok(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passou++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

function resolverRegrasTecnicas(spec, opts) {
  if (typeof spec.regrasTecnicas === 'function') return spec.regrasTecnicas(opts);
  return spec.regrasTecnicas || '';
}

const SECOES_ESPERADAS = [
  '## Campos de data padrao',
  '## Tabelas padrao do modulo Financeiro',
  '## Joins padrao',
  '## Regras obrigatorias de SQL',
  '## Exibicao de entidades',
  '## Contas a receber — posicao/em aberto',
  '## Contas a receber — realizado',
  '## Contas a pagar — posicao/em aberto',
  '## Contas a pagar — realizado',
  '## Comparacao/combinacao pagar x receber',
  '## Saldo bancario',
  '## Dicionario SE8 (saldos bancarios)',
  '## Regras tecnicas obrigatorias — SE8',
  '## Fluxo de caixa projetado',
  '## Fluxo de caixa realizado',
  '## Antecipacoes/creditos — PA, NDF (pagar) e RA, NCC (receber)',
  '## Media por periodo (agrupamento temporal)',
];

console.log('\n[1] Todas as secoes esperadas presentes (modelo SE5, padrao)');

const textoSe5 = resolverRegrasTecnicas(financeiroSpec, { modeloBaixasReceber: 'SE5', modeloBaixasPagar: 'SE5' });

for (const secao of SECOES_ESPERADAS) {
  ok(`secao presente: "${secao}"`, () => {
    assert.ok(textoSe5.includes(secao), `secao "${secao}" nao encontrada no regrasTecnicas`);
  });
}

console.log('\n[2] Todas as secoes esperadas presentes (modelo FK1/FK2)');

const textoFk = resolverRegrasTecnicas(financeiroSpec, { modeloBaixasReceber: 'FK1', modeloBaixasPagar: 'FK2' });

for (const secao of SECOES_ESPERADAS) {
  ok(`secao presente com FK1/FK2: "${secao}"`, () => {
    assert.ok(textoFk.includes(secao), `secao "${secao}" nao encontrada no regrasTecnicas com modelo FK`);
  });
}

console.log('\n[3] Tamanho minimo de conteudo (detecta esvaziamento acidental)');

ok('regrasTecnicas tem pelo menos 4000 caracteres', () => {
  assert.ok(textoSe5.length >= 4000, `regrasTecnicas tem apenas ${textoSe5.length} caracteres — esperado >= 4000`);
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`financeiro-systemprompt-snapshot.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`financeiro-systemprompt-snapshot.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
