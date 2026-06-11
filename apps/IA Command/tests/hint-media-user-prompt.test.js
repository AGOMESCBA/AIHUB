'use strict';

/**
 * Testes da injeção de hint de média no user prompt (runner.js + prompt-builder.js)
 *
 * Verifica que:
 * 1. buildHintMedia gera o template correto com os campos do spec
 * 2. A detecção de operação de média funciona para palavras-chave comuns
 * 3. "ticket médio" NÃO dispara o hint de média de período
 * 4. O user prompt inclui o hint quando media é detectada
 * 5. O user prompt NÃO inclui o hint para consultas normais
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const SPECS = {
  faturamento: require(path.join(ROOT, 'modules/erp/faturamento/faturamento-ia-owner-spec')),
  compras:     require(path.join(ROOT, 'modules/erp/compras/compras-ia-owner-spec')),
  financeiro:  require(path.join(ROOT, 'modules/erp/financeiro/financeiro-ia-owner-spec')),
  comissao:    require(path.join(ROOT, 'modules/erp/comissao/comissao-ia-owner-spec')),
};

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

// ─── 1. buildHintMedia gera template correto por módulo ──────────────────────
console.log('\n[1] buildHintMedia — template correto por módulo');

ok('faturamento: hint inclui SF2.F2_EMISSAO', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.faturamento);
  assert.ok(hint.includes('SF2.F2_EMISSAO'), 'deve incluir campo de data do módulo');
});

ok('faturamento: hint inclui alias "faturamento"', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.faturamento);
  assert.ok(hint.includes('faturamento'), 'deve incluir alias de métrica do módulo');
});

ok('compras: hint inclui SF1.F1_DTDIGIT', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.compras);
  assert.ok(hint.includes('SF1.F1_DTDIGIT'), 'deve incluir campo de data do módulo compras');
});

ok('comissao: hint inclui SE3.E3_VENCTO', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.comissao);
  assert.ok(hint.includes('SE3.E3_VENCTO'), 'deve incluir campo de data do módulo comissao');
});

ok('financeiro: hint inclui SE1.E1_VENCTO', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.financeiro);
  assert.ok(hint.includes('SE1.E1_VENCTO'), 'deve incluir campo de data do módulo financeiro');
});

ok('hint menciona todos os 3 CASOS (A, B, C)', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.faturamento);
  assert.ok(hint.includes('CASO A'), 'deve ter CASO A');
  assert.ok(hint.includes('CASO B'), 'deve ter CASO B');
  assert.ok(hint.includes('CASO C'), 'deve ter CASO C');
});

ok('hint proíbe AVG direto sobre tabela fato', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.faturamento);
  assert.ok(hint.toLowerCase().includes('proibido'), 'deve ter proibição');
  assert.ok(hint.toLowerCase().includes('avg'), 'deve mencionar AVG');
});

ok('hint proíbe referenciar alias tabela na camada externa', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.faturamento);
  assert.ok(
    hint.includes('EXCLUSIVAMENTE h.') || hint.includes('NUNCA'),
    'deve proibir referência à tabela fato na camada externa'
  );
});

// ─── 2. buildHintMedia com spec sem campos (fallback genérico) ────────────────
console.log('\n[2] buildHintMedia — fallback quando spec não tem campos');

ok('spec sem campoDataPrincipal usa placeholder genérico', () => {
  const hint = promptBuilder.buildHintMedia({});
  assert.ok(hint.includes('<alias>.<campo_data>'), 'deve usar placeholder genérico');
});

ok('spec null/undefined não lança exceção', () => {
  assert.doesNotThrow(() => promptBuilder.buildHintMedia(null));
  assert.doesNotThrow(() => promptBuilder.buildHintMedia(undefined));
});

// ─── 3. buildUserPrompt inclui hint quando fornecido ─────────────────────────
console.log('\n[3] buildUserPrompt — injeção do hint');

ok('user prompt inclui hint quando hintOperacao fornecido', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.faturamento);
  const prompt = promptBuilder.buildUserPrompt({
    mensagem: 'faturamento médio do ano de 2026',
    historico: [],
    hintOperacao: hint,
  });
  assert.ok(prompt.includes('OPERACAO DE MEDIA'), 'deve incluir o hint no user prompt');
  assert.ok(prompt.includes('CASO A'), 'deve incluir CASO A');
  assert.ok(prompt.includes('CASO B'), 'deve incluir CASO B');
});

ok('user prompt NÃO inclui hint quando hintOperacao é null', () => {
  const prompt = promptBuilder.buildUserPrompt({
    mensagem: 'faturamento do mês de junho',
    historico: [],
    hintOperacao: null,
  });
  assert.ok(!prompt.includes('OPERACAO DE MEDIA'), 'não deve incluir hint desnecessariamente');
  assert.ok(!prompt.includes('CASO A'), 'não deve incluir CASO A');
});

ok('hint aparece antes da instrução de retornar JSON', () => {
  const hint = promptBuilder.buildHintMedia(SPECS.faturamento);
  const prompt = promptBuilder.buildUserPrompt({
    mensagem: 'média mensal',
    historico: [],
    hintOperacao: hint,
  });
  const posHint = prompt.indexOf('OPERACAO DE MEDIA');
  const posRetorne = prompt.indexOf('Retorne apenas o JSON');
  assert.ok(posHint > 0 && posHint < posRetorne, 'hint deve aparecer antes da instrução final');
});

// ─── 4. Detecção de operação de média (simulação da lógica do runner) ─────────
console.log('\n[4] Detecção de operação de média (regex)');

function detectaMedia(mensagem) {
  const texto = String(mensagem || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const temMedia = /\b(media|medio|medios|medias)\b/.test(texto);
  const ehTicketMedio = /\bticket\s+(medio|medios|media)\b/.test(texto);
  return temMedia && !ehTicketMedio;
}

const casosPositivos = [
  'faturamento médio do ano de 2026',
  'Faturamento médio mensal de 2025 e 2026',
  'qual a média de faturamento',
  'media anual de faturamento dos últimos 2 anos',
  'compras médias por mês',
  'comissão média do vendedor',
];

for (const msg of casosPositivos) {
  ok(`detecta média em: "${msg}"`, () => {
    assert.ok(detectaMedia(msg), `deve detectar operação de média em "${msg}"`);
  });
}

const casosNegativos = [
  'faturamento do mês de junho',
  'total de faturamento de 2026',
  'ticket médio por nota fiscal',
  'faturamento por cliente',
  'compras do fornecedor',
];

for (const msg of casosNegativos) {
  ok(`NÃO detecta média em: "${msg}"`, () => {
    assert.ok(!detectaMedia(msg), `não deve detectar média em "${msg}"`);
  });
}

ok('ticket médio NÃO aciona hint de média de período', () => {
  assert.ok(!detectaMedia('qual o ticket médio por NF'), '"ticket médio" não deve ser média de período');
  assert.ok(!detectaMedia('ticket medio mensal'), '"ticket medio" não deve ser média de período');
});

// ─── 5. Campos nos specs estão preenchidos ────────────────────────────────────
console.log('\n[5] Specs têm campoDataPrincipal e aliasMetricaPrincipal');

for (const [nome, spec] of Object.entries(SPECS)) {
  ok(`${nome}: tem campoDataPrincipal string não vazia`, () => {
    assert.strictEqual(typeof spec.campoDataPrincipal, 'string', 'deve ser string');
    assert.ok(spec.campoDataPrincipal.length > 0, 'não deve ser vazia');
  });

  ok(`${nome}: tem aliasMetricaPrincipal string não vazia`, () => {
    assert.strictEqual(typeof spec.aliasMetricaPrincipal, 'string', 'deve ser string');
    assert.ok(spec.aliasMetricaPrincipal.length > 0, 'não deve ser vazia');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`hint-media-user-prompt.test.js: ${passou} testes passaram, 0 falhas ✓`);
} else {
  console.error(`hint-media-user-prompt.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
