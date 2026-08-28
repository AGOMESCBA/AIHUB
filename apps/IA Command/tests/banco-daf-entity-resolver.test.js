'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const entityResolver = require(path.join(ROOT, 'modules/ai/entity-resolver'));

let ok = 0;
let falhou = 0;

function teste(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

// ── extrairExplicitos ──────────────────────────────────────────────────────────
console.log('\n[extrairExplicitos]');

teste('"banco DAF" não deve gerar nenhum termo explícito', () => {
  const r = entityResolver.extrairExplicitos('saldos bancários excluindo o banco DAF');
  assert.strictEqual(r.length, 0, `Esperado 0 termos, obteve ${JSON.stringify(r)}`);
});

teste('"banco Bradesco" não deve gerar nenhum termo explícito', () => {
  const r = entityResolver.extrairExplicitos('saldo bancário do banco Bradesco');
  assert.strictEqual(r.length, 0, `Esperado 0 termos, obteve ${JSON.stringify(r)}`);
});

teste('"excluindo o banco DAF e banco ITAU" não deve gerar termos', () => {
  const r = entityResolver.extrairExplicitos('me mostre o saldo excluindo o banco DAF e banco ITAU');
  assert.strictEqual(r.length, 0, `Esperado 0 termos, obteve ${JSON.stringify(r)}`);
});

teste('"fornecedor ACME" ainda deve funcionar normalmente', () => {
  const r = entityResolver.extrairExplicitos('compras do fornecedor ACME');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tipo_sugerido, 'fornecedor');
  assert.strictEqual(r[0].texto, 'ACME');
});

teste('"por nome do fornecedor" e dimensao, nao entidade cadastral', () => {
  const r = entityResolver.normalizarEntidadesIA({
    entidades: [{ texto: 'nome do fornecedor', tipo_sugerido: 'fornecedor', confianca: 0.8 }],
  });
  assert.strictEqual(r.length, 0, `Esperado 0 termos, obteve ${JSON.stringify(r)}`);
});

teste('"cliente SESI AM" ainda deve funcionar normalmente', () => {
  const r = entityResolver.extrairExplicitos('contas a receber do SESI AM');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tipo_sugerido, 'cliente');
});

// ── normalizarEntidadesIA ─────────────────────────────────────────────────────
console.log('\n[normalizarEntidadesIA — filtragem de bancos]');

teste('IA retornando "DAF" como fornecedor deve ser ignorado por _pareceSomenteAgrupamentoOuMetrica não — mas o system prompt deve instruir a IA corretamente', () => {
  // O token "DAF" não está em TERMOS_AGRUPAMENTO_OU_METRICA, então chegaria.
  // O que deve bloquear é o system prompt instruir a IA a não extrair banco como entidade.
  // Aqui testamos apenas que se a IA devolver {"texto":"banco DAF","tipo_sugerido":"fornecedor"},
  // o normalizarEntidadesIA limpa o texto para "banco DAF" (não filtra — isso é responsabilidade do system prompt).
  const r = entityResolver.normalizarEntidadesIA({ entidades: [{ texto: 'DAF', tipo_sugerido: 'fornecedor', confianca: 0.8 }] });
  // "DAF" tem 3 chars e não está em TERMOS_AGRUPAMENTO_OU_METRICA → passa pelo normalizador
  // O bloqueio real é no system prompt + deduplication no runner
  assert.strictEqual(r.length, 1, 'normalizarEntidadesIA não filtra "DAF" — responsabilidade está no system prompt');
});

teste('system prompt de extração contém instrução sobre banco', () => {
  const prompt = entityResolver.buildExtractionSystemPrompt();
  assert.ok(
    /banco/i.test(prompt) && /SE8/i.test(prompt),
    `System prompt deve mencionar "banco" e "SE8". Obteve: ${prompt}`,
  );
});

// ── _pareceSomenteAgrupamentoOuMetrica ────────────────────────────────────────
console.log('\n[_pareceSomenteAgrupamentoOuMetrica — banco/conta/agencia]');

teste('"banco" isolado reconhecido como metrica/dimensao', () => {
  assert.ok(entityResolver._pareceSomenteAgrupamentoOuMetrica('banco'));
});

teste('"bancos" isolado reconhecido como metrica/dimensao', () => {
  assert.ok(entityResolver._pareceSomenteAgrupamentoOuMetrica('bancos'));
});

teste('"conta" isolado reconhecido como metrica/dimensao', () => {
  assert.ok(entityResolver._pareceSomenteAgrupamentoOuMetrica('conta'));
});

teste('"DAF" isolado NÃO é reconhecido como metrica (nome próprio)', () => {
  assert.ok(!entityResolver._pareceSomenteAgrupamentoOuMetrica('DAF'), '"DAF" não deve ser filtrado como metrica');
});

teste('"ACME" isolado NÃO é reconhecido como metrica (nome próprio)', () => {
  assert.ok(!entityResolver._pareceSomenteAgrupamentoOuMetrica('ACME'));
});

// ── Cenários de mensagens reais ───────────────────────────────────────────────
console.log('\n[Cenários de mensagens reais]');

teste('comparativo faturamento e compras — sem entidades explícitas', () => {
  const r = entityResolver.extrairExplicitos('Comparativo do faturamento e compras do mês de maio de 2026, incluindo o crescimento entre os meses');
  assert.strictEqual(r.length, 0, `Esperado 0 termos, obteve ${JSON.stringify(r)}`);
});

teste('saldo bancário sem exclusão — sem entidades', () => {
  const r = entityResolver.extrairExplicitos('Me passe os saldos bancários, por favor');
  assert.strictEqual(r.length, 0);
});

teste('saldo bancário excluindo banco — sem entidades', () => {
  const r = entityResolver.extrairExplicitos('saldos bancários excluindo o banco DAF');
  assert.strictEqual(r.length, 0);
});

teste('contas a pagar da Softexpert — retorna fornecedor corretamente', () => {
  const r = entityResolver.extrairExplicitos('contas a pagar da Softexpert');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tipo_sugerido, 'fornecedor');
  assert.strictEqual(r[0].texto, 'Softexpert');
});

teste('faturamento por cliente SESI — retorna cliente', () => {
  const r = entityResolver.extrairExplicitos('faturamento do cliente SESI AM');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tipo_sugerido, 'cliente');
});

// ── Resultado ─────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════════════════════════════════════`);
if (falhou > 0) {
  console.error(`  banco-daf-entity-resolver.test.js: ${falhou} FALHA(S) de ${ok + falhou}`);
  process.exit(1);
} else {
  console.log(`  banco-daf-entity-resolver.test.js: ok (${ok} assertivas)`);
}
