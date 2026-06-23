'use strict';

/**
 * Testes das regras de média nos specs dos 4 módulos (faturamento, compras, financeiro, comissão)
 *
 * Garante que as regras críticas de estrutura de subquery para médias estão
 * presentes no regrasTecnicas de cada módulo e aparecem no system prompt gerado.
 *
 * Cenários cobertos:
 *   1. Cada spec exporta regrasTecnicas como string não vazia
 *   2. Regra: subquery interna exporta DOIS aliases (ano E competencia)
 *   3. Regra: query externa usa h.ano e nao SF2, SE3, etc. (nunca tabela fato)
 *   4. Regra: média mensal escalar (1 ano) sem GROUP BY na camada externa
 *   5. Regra: média anual escalar preservada em todos os módulos
 *   6. buildSystemPrompt inclui as regras no prompt gerado
 *   7. Nenhum template literal com erro de sintaxe (spec carrega sem exceção)
 *   8. prompt-builder: regras de média escalar e subquery de 1 linha presentes
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

// Helper: resolve regrasTecnicas seja string ou função (módulos com FK condicional)
function resolverRegrasTecnicas(spec) {
  if (typeof spec.regrasTecnicas === 'function') return spec.regrasTecnicas();
  return spec.regrasTecnicas || '';
}

// ─── 1. Specs carregam sem erro e exportam regrasTecnicas ────────────────────
console.log('\n[1] Specs carregam corretamente');

for (const [nome, spec] of Object.entries(SPECS)) {
  ok(`${nome}: spec carrega sem exceção`, () => {
    assert.ok(spec, 'spec deve existir');
  });

  ok(`${nome}: regrasTecnicas é string ou função não vazia`, () => {
    const tipo = typeof spec.regrasTecnicas;
    assert.ok(tipo === 'string' || tipo === 'function', 'deve ser string ou function');
    const texto = resolverRegrasTecnicas(spec);
    assert.ok(texto.length > 100, 'deve ter conteúdo substancial');
  });
}

// ─── 2. Regra: subquery interna exporta DOIS aliases ─────────────────────────
console.log('\n[2] Regra: subquery interna exporta ano E competencia');

for (const [nome, spec] of Object.entries(SPECS)) {
  ok(`${nome}: menciona exportação de dois aliases (ano E competencia)`, () => {
    const rt = resolverRegrasTecnicas(spec);
    const r = rt.toLowerCase();
    const temDoisAliases =
      (r.includes('dois aliases') || r.includes('dois alias') || r.includes('dois aliases')) &&
      r.includes('ano') &&
      r.includes('competencia');
    assert.ok(temDoisAliases, `${nome}.regrasTecnicas deve mencionar exportar dois aliases (ano e competencia). Conteúdo atual: ${rt.slice(rt.toLowerCase().indexOf('media'), rt.toLowerCase().indexOf('media') + 400)}`);
  });
}

// ─── 3. Regra: query externa usa h.ano e h.* — nunca tabela fato ─────────────
console.log('\n[3] Regra: camada externa usa apenas aliases exportados pela subquery');

for (const [nome, spec] of Object.entries(SPECS)) {
  ok(`${nome}: menciona que camada externa usa h.ano`, () => {
    const rt = resolverRegrasTecnicas(spec);
    assert.ok(
      rt.includes('h.ano'),
      `${nome}.regrasTecnicas deve mencionar h.ano na camada externa`
    );
  });

  ok(`${nome}: proíbe referência à tabela fato na camada externa`, () => {
    const r = resolverRegrasTecnicas(spec);
    const temProibicao = r.includes('NUNCA') && (
      r.includes('SF2.*') || r.includes('SD1.*') || r.includes('SE1.*') ||
      r.includes('SE2.*') || r.includes('SE3.*') || r.includes('SD1.* ou SF1.*')
    );
    assert.ok(temProibicao, `${nome}.regrasTecnicas deve proibir referência à tabela fato na camada externa`);
  });
}

// ─── 4. Regra: média mensal escalar (1 ano) sem GROUP BY ─────────────────────
console.log('\n[4] Regra: média mensal escalar (1 ano específico)');

for (const [nome, spec] of Object.entries(SPECS)) {
  ok(`${nome}: menciona média mensal escalar sem GROUP BY`, () => {
    const r = resolverRegrasTecnicas(spec).toLowerCase();
    const temEscalar = (r.includes('mensal escalar') || r.includes('1 ano')) && r.includes('sem group by');
    assert.ok(temEscalar, `${nome}.regrasTecnicas deve cobrir média mensal escalar (1 ano) sem GROUP BY`);
  });
}

// ─── 5. Regra: média anual escalar preservada ─────────────────────────────────
console.log('\n[5] Regra: média anual escalar preservada em todos os módulos');

for (const [nome, spec] of Object.entries(SPECS)) {
  ok(`${nome}: média anual escalar (SUM por ano → AVG externo) presente`, () => {
    const r = resolverRegrasTecnicas(spec).toLowerCase();
    const temAnual = r.includes('media anual escalar') || (r.includes('anual') && r.includes('externa avg'));
    assert.ok(temAnual, `${nome}.regrasTecnicas deve cobrir média anual escalar`);
  });
}

// ─── 6. buildSystemPrompt inclui as regras no prompt gerado ──────────────────
console.log('\n[6] buildSystemPrompt inclui regras de média no prompt gerado');

for (const [nome, spec] of Object.entries(SPECS)) {
  ok(`${nome}: system prompt inclui "h.ano"`, () => {
    const prompt = promptBuilder.buildSystemPrompt(spec);
    assert.ok(typeof prompt === 'string' && prompt.length > 0, 'prompt deve ser string não vazia');
    assert.ok(
      prompt.includes('h.ano'),
      `system prompt do ${nome} deve incluir h.ano`
    );
  });

  ok(`${nome}: system prompt inclui "competencia"`, () => {
    const prompt = promptBuilder.buildSystemPrompt(spec);
    assert.ok(
      prompt.toLowerCase().includes('competencia'),
      `system prompt do ${nome} deve incluir competencia`
    );
  });
}

// ─── 7. prompt-builder: regras de AVG sobre subquery de 1 linha ──────────────
console.log('\n[7] prompt-builder: regras complementares de média');

ok('prompt-builder menciona subquery de 1 linha + AVG = valor de si mesmo', () => {
  const prompt = promptBuilder.buildSystemPrompt(SPECS.faturamento);
  const temRegra = prompt.includes('1 linha') && prompt.toLowerCase().includes('avg');
  assert.ok(temRegra, 'deve mencionar que subquery 1 linha + AVG = o próprio valor');
});

ok('prompt-builder menciona média mensal escalar', () => {
  const prompt = promptBuilder.buildSystemPrompt(SPECS.faturamento);
  assert.ok(
    prompt.toLowerCase().includes('mensal escalar') || prompt.toLowerCase().includes('1 ano especifico'),
    'deve cobrir média mensal escalar'
  );
});

ok('prompt-builder menciona proibição de AVG direto sobre tabela fato', () => {
  const prompt = promptBuilder.buildSystemPrompt(SPECS.faturamento);
  assert.ok(
    prompt.toLowerCase().includes('proibido') && prompt.toLowerCase().includes('avg'),
    'deve proibir AVG direto'
  );
});

// ─── 8. Campo de data correto por módulo ─────────────────────────────────────
console.log('\n[8] Campo de data de referência correto por módulo');

ok('faturamento: usa SF2.F2_EMISSAO nas regras de média', () => {
  const rt = resolverRegrasTecnicas(SPECS.faturamento);
  assert.ok(
    rt.includes('SF2.F2_EMISSAO') || rt.includes('F2_EMISSAO'),
    'faturamento deve referenciar F2_EMISSAO'
  );
});

ok('compras: usa SD1.D1_DTDIGIT nas regras de média', () => {
  const rt = resolverRegrasTecnicas(SPECS.compras);
  assert.ok(
    rt.includes('SD1.D1_DTDIGIT') || rt.includes('D1_DTDIGIT'),
    'compras deve referenciar D1_DTDIGIT'
  );
});

ok('comissao: usa SE3.E3_VENCTO nas regras de média', () => {
  assert.ok(
    SPECS.comissao.regrasTecnicas.includes('SE3.E3_VENCTO') ||
    SPECS.comissao.regrasTecnicas.includes('E3_VENCTO'),
    'comissao deve referenciar E3_VENCTO'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`spec-media-regras.test.js: ${passou} testes passaram, 0 falhas ✓`);
} else {
  console.error(`spec-media-regras.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
