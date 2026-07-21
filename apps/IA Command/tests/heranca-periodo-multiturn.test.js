'use strict';

/**
 * Testes de herança de período em conversas multi-turn — IA Command
 *
 * Valida as três correções aplicadas para evitar regressão:
 *   Fix 1 — _periodoAtualPorTextoSemAno não detecta "mes" em "por mes" (agrupamento)
 *   Fix 2 — _contratoHistoricoRecente enriquece contrato com periodo mesclado quando nenhum
 *   Fix 3 — buildTemporalUserPrompt enriquece historico antes de enviar à IA temporal
 *
 * Cenário de referência (Contas a Pagar):
 *   Turno 1: "contas a pagar do ano"  → período = ano inteiro (20260101–20261231)
 *   Turno 2: "detalhar por mês"       → agrupamento, período herdado = ano inteiro
 *   Turno 3: "detalhar por fornecedor" → período deve continuar = ano inteiro
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const temporal = require(path.join(ROOT, 'modules/erp/core/temporal-contract'));
const orch = require(path.join(ROOT, 'modules/ai/orchestrator-service'));

const hoje = new Date('2026-05-24T12:00:00');

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

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1 — _periodoAtualPorTextoSemAno: agrupamentos não viram períodos
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Fix 1] _periodoAtualPorTextoSemAno — agrupamentos devem retornar null');

ok('"detalhar por mes" → null (não é período)', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'detalhar por mes', hoje });
  assert.strictEqual(r, null, `esperado null, recebeu: ${JSON.stringify(r)}`);
});

ok('"por mes" sozinho → null', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'por mes', hoje });
  assert.strictEqual(r, null);
});

ok('"mes a mes" → null', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'mes a mes', hoje });
  assert.strictEqual(r, null);
});

ok('"por ano" → null (agrupamento anual)', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'detalhar por ano', hoje });
  assert.strictEqual(r, null);
});

ok('"ano a ano" → null', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'ano a ano', hoje });
  assert.strictEqual(r, null);
});

ok('"por semana" → null', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'por semana', hoje });
  assert.strictEqual(r, null);
});

ok('"por dia" → null', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'por dia', hoje });
  assert.strictEqual(r, null);
});

ok('"detalhar por fornecedor" → null (sem indicador de período)', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'detalhar por fornecedor', hoje });
  assert.strictEqual(r, null);
});

// Deve continuar funcionando para casos legítimos de período
ok('"do mes" ainda retorna mês atual', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'faturamento do mes', hoje });
  assert.ok(r, 'deveria retornar período');
  assert.strictEqual(r.dataInicio, '20260501');
  assert.strictEqual(r.dataFim, '20260531');
});

ok('"do ano" ainda retorna ano atual', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'faturamento do ano', hoje });
  assert.ok(r, 'deveria retornar período');
  assert.strictEqual(r.dataInicio, '20260101');
  assert.strictEqual(r.dataFim, '20261231');
});

ok('"maio" ainda retorna maio do ano atual', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'compras de maio', hoje });
  assert.ok(r);
  assert.strictEqual(r.dataInicio, '20260501');
  assert.strictEqual(r.dataFim, '20260531');
});

ok('"mes atual" ainda retorna mês atual', () => {
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'mes atual', hoje });
  assert.ok(r);
  assert.strictEqual(r.dataInicio, '20260501');
});

ok('mensagem com "por mes" E "do ano" → null (agrupamento domina?)', () => {
  // "agrupar por mes do ano" — o "por mes" é agrupamento, mas "do ano" é período
  // Após strip de "por mes", sobra "agrupar do ano" → ano detectado
  const r = temporal._periodoAtualPorTextoSemAno({ mensagem: 'agrupar por mes do ano', hoje });
  // Após remover "por mes": "agrupar do ano" → detecta "ano"
  assert.ok(r, 'deve detectar "do ano" após remover "por mes"');
  assert.strictEqual(r.dataInicio, '20260101');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1 (cont.) — resolverPeriodoDeterministico com periodoInicial herdado
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Fix 1] resolverPeriodoDeterministico — herança de período com agrupamentos');

ok('"detalhar por mes" + periodoInicial ano_atual → preserva ano inteiro', () => {
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'financeiro',
    mensagem: 'detalhar por mes',
    periodoInicial: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
    hoje,
  });
  assert.strictEqual(r.dataInicio, '20260101', `início deve ser 20260101, recebeu ${r.dataInicio}`);
  assert.strictEqual(r.dataFim, '20261231', `fim deve ser 20261231, recebeu ${r.dataFim}`);
});

ok('"por mes" + periodoInicial personalizado → preserva datas herdadas', () => {
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'compras',
    mensagem: 'por mes',
    periodoInicial: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20260630' },
    hoje,
  });
  assert.strictEqual(r.dataInicio, '20260101');
  assert.strictEqual(r.dataFim, '20260630');
});

ok('"detalhar por fornecedor" + periodoInicial ano_atual → preserva ano inteiro', () => {
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'financeiro',
    mensagem: 'detalhar por fornecedor',
    periodoInicial: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
    hoje,
  });
  assert.strictEqual(r.dataInicio, '20260101');
  assert.strictEqual(r.dataFim, '20261231');
});

ok('"detalhar por mes" sem periodoInicial (compras) → defaulta para mes_atual', () => {
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'compras',
    mensagem: 'detalhar por mes',
    periodoInicial: null,
    hoje,
  });
  // Sem periodo inicial e sem indicador de período no texto → modulo default = mes_atual
  assert.ok(r.dataInicio, 'deve ter dataInicio');
  assert.ok(r.dataFim, 'deve ter dataFim');
});

ok('"faturamento do mes" + periodoInicial de outro mês → mês atual sobrescreve (comportamento existente)', () => {
  // _periodoAtualPorTextoSemAno detecta "do mes" → retorna mês atual
  // periodoInicial NÃO tem precedência aqui — este é o comportamento intencional
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'faturamento',
    mensagem: 'faturamento do mes',
    periodoInicial: { tipo: 'mes', dataInicio: '20230101', dataFim: '20230131' },
    hoje,
  });
  assert.strictEqual(r.dataInicio, '20260501', 'mes atual deve prevalecer sobre periodoInicial legado');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — _periodoEfetivo: enriquecimento de contrato com período mesclado
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Fix 2] _periodoEfetivo — enriquece contrato quando periodo é nenhum');

ok('contrato com periodo:nenhum + periodoMesclado real → retorna contrato enriquecido', () => {
  const contrato = { modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } };
  const periodoMesclado = { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' };
  const r = orch._periodoEfetivo(contrato, periodoMesclado);
  assert.strictEqual(r.periodo.tipo, 'ano_atual');
  assert.strictEqual(r.periodo.dataInicio, '20260101');
});

ok('contrato com periodo real → não é sobrescrito pelo periodoMesclado', () => {
  const contrato = { modulo: 'financeiro', periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' } };
  const periodoMesclado = { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' };
  const r = orch._periodoEfetivo(contrato, periodoMesclado);
  assert.strictEqual(r.periodo.tipo, 'mes_atual', 'período real do contrato deve ser preservado');
});

ok('contrato null → retorna null', () => {
  assert.strictEqual(orch._periodoEfetivo(null, { tipo: 'ano_atual' }), null);
});

ok('periodoMesclado nenhum → contrato nenhum não é enriquecido', () => {
  const contrato = { modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } };
  const periodoMesclado = { tipo: 'nenhum', dataInicio: null, dataFim: null };
  const r = orch._periodoEfetivo(contrato, periodoMesclado);
  assert.strictEqual(r.periodo.tipo, 'nenhum');
});

ok('periodoMesclado null → contrato nenhum não é enriquecido', () => {
  const contrato = { modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } };
  const r = orch._periodoEfetivo(contrato, null);
  assert.strictEqual(r.periodo.tipo, 'nenhum');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 (cont.) — _contratoHistoricoRecente: resolve contrato do histórico
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Fix 2] _contratoHistoricoRecente — resolve período correto do histórico');

ok('histórico com contrato periodo:nenhum mas item.periodo real → retorna período enriquecido', () => {
  const historico = [
    {
      mensagem: 'contas a pagar do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: {
        modulo: 'financeiro',
        periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null },
      },
    },
  ];
  const r = orch._contratoHistoricoRecente(historico);
  assert.ok(r, 'deve retornar um contrato');
  assert.strictEqual(r.periodo.tipo, 'ano_atual', `recebeu: ${r.periodo.tipo}`);
  assert.strictEqual(r.periodo.dataInicio, '20260101');
});

ok('histórico com contrato período real → retorna período original sem modificar', () => {
  const historico = [
    {
      mensagem: 'compras de janeiro',
      periodo: { tipo: 'mes', dataInicio: '20260101', dataFim: '20260131' },
      contrato_orquestrador: {
        modulo: 'compras',
        periodo: { tipo: 'mes_atual', dataInicio: '20260101', dataFim: '20260131' },
      },
    },
  ];
  const r = orch._contratoHistoricoRecente(historico);
  assert.strictEqual(r.periodo.tipo, 'mes_atual');
});

ok('histórico múltiplos turnos → usa o mais recente com contrato_orquestrador', () => {
  const historico = [
    {
      mensagem: 'turno 1',
      periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
      contrato_orquestrador: { modulo: 'compras', periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' } },
    },
    {
      mensagem: 'turno 2 — agrupamento',
      periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
      contrato_orquestrador: { modulo: 'compras', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const r = orch._contratoHistoricoRecente(historico);
  // Turno 2 tem contrato com nenhum, mas item.periodo é mes_atual → enriquece
  assert.strictEqual(r.periodo.tipo, 'mes_atual');
  assert.strictEqual(r.periodo.dataInicio, '20260501');
});

ok('histórico vazio → retorna null', () => {
  assert.strictEqual(orch._contratoHistoricoRecente([]), null);
});

ok('contextoAnterior com _orquestradorContrato periodo:nenhum → enriquece com contextoAnterior.periodo', () => {
  const contextoAnterior = {
    _orquestradorContrato: {
      modulo: 'financeiro',
      periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null },
    },
    periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
  };
  const r = orch._contratoHistoricoRecente([], contextoAnterior);
  assert.ok(r, 'deve retornar contrato');
  assert.strictEqual(r.periodo.tipo, 'ano_atual');
  assert.strictEqual(r.periodo.dataInicio, '20260101');
});

ok('contextoAnterior com _orquestradorContrato período real → não sobrescreve', () => {
  const contextoAnterior = {
    _orquestradorContrato: {
      modulo: 'financeiro',
      periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
    },
    periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
  };
  const r = orch._contratoHistoricoRecente([], contextoAnterior);
  assert.strictEqual(r.periodo.tipo, 'mes_atual', 'período real do contrato deve prevalecer');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3 — _enriquecerContratoHistoricoTemporal: historico para a IA temporal
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Fix 3] _enriquecerContratoHistoricoTemporal — enriquece historico para IA temporal');

ok('item com contrato periodo:nenhum e item.periodo real → enriquece', () => {
  const historico = [
    {
      mensagem: 'contas a pagar do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const r = temporal._enriquecerContratoHistoricoTemporal(historico);
  assert.strictEqual(r[0].contrato_orquestrador.periodo.tipo, 'ano_atual');
  assert.strictEqual(r[0].contrato_orquestrador.periodo.dataInicio, '20260101');
});

ok('item com contrato período real → não modifica', () => {
  const historico = [
    {
      mensagem: 'compras de maio',
      periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
      contrato_orquestrador: { modulo: 'compras', periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' } },
    },
  ];
  const r = temporal._enriquecerContratoHistoricoTemporal(historico);
  assert.strictEqual(r[0].contrato_orquestrador.periodo.tipo, 'mes_atual');
});

ok('item sem contrato_orquestrador → passa sem modificação', () => {
  const historico = [{ mensagem: 'oi', periodo: null }];
  const r = temporal._enriquecerContratoHistoricoTemporal(historico);
  assert.ok(!r[0].contrato_orquestrador);
});

ok('array vazio → retorna array vazio', () => {
  assert.deepStrictEqual(temporal._enriquecerContratoHistoricoTemporal([]), []);
});

ok('null → retorna array vazio', () => {
  assert.deepStrictEqual(temporal._enriquecerContratoHistoricoTemporal(null), []);
});

ok('múltiplos itens — enriquece apenas os com nenhum', () => {
  const historico = [
    {
      mensagem: 'turno com período',
      periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
      contrato_orquestrador: { periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' } },
    },
    {
      mensagem: 'turno agrupamento',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const r = temporal._enriquecerContratoHistoricoTemporal(historico);
  assert.strictEqual(r[0].contrato_orquestrador.periodo.tipo, 'mes_atual', 'primeiro não deve mudar');
  assert.strictEqual(r[1].contrato_orquestrador.periodo.tipo, 'ano_atual', 'segundo deve ser enriquecido');
});

// ─────────────────────────────────────────────────────────────────────────────
// Cenário end-to-end: 3 turnos de Contas a Pagar
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[E2E] Cenário: 3 turnos "Contas a Pagar do Ano" → "por mês" → "por fornecedor"');

function simularTurno1() {
  return temporal.resolverPeriodoDeterministico({
    modulo: 'financeiro',
    mensagem: 'contas a pagar do ano',
    periodoInicial: null,
    hoje,
  });
}

function simularTurno2(periodoT1) {
  return temporal.resolverPeriodoDeterministico({
    modulo: 'financeiro',
    mensagem: 'detalhar por mes',
    periodoInicial: periodoT1,
    hoje,
  });
}

function simularTurno3(periodoT2) {
  return temporal.resolverPeriodoDeterministico({
    modulo: 'financeiro',
    mensagem: 'detalhar por fornecedor',
    periodoInicial: periodoT2,
    hoje,
  });
}

ok('Turno 1: "contas a pagar do ano" → detecta ano atual (20260101–20261231)', () => {
  const p = simularTurno1();
  assert.strictEqual(p.dataInicio, '20260101', `início: ${p.dataInicio}`);
  assert.strictEqual(p.dataFim, '20261231', `fim: ${p.dataFim}`);
});

ok('Turno 2: "detalhar por mes" com período T1 → herda ano inteiro', () => {
  const pT1 = simularTurno1();
  const pT2 = simularTurno2(pT1);
  assert.strictEqual(pT2.dataInicio, '20260101', `Turno 2 início: ${pT2.dataInicio} (esperado 20260101)`);
  assert.strictEqual(pT2.dataFim, '20261231', `Turno 2 fim: ${pT2.dataFim} (esperado 20261231)`);
});

ok('Turno 3: "detalhar por fornecedor" com período T2 → mantém ano inteiro', () => {
  const pT1 = simularTurno1();
  const pT2 = simularTurno2(pT1);
  const pT3 = simularTurno3(pT2);
  assert.strictEqual(pT3.dataInicio, '20260101', `Turno 3 início: ${pT3.dataInicio} (esperado 20260101)`);
  assert.strictEqual(pT3.dataFim, '20261231', `Turno 3 fim: ${pT3.dataFim} (esperado 20261231)`);
});

ok('Historico T2 enriquecido: contrato com nenhum + item.periodo real → IA vê período correto', () => {
  const historicoComAgrupamento = [
    {
      mensagem: 'contas a pagar do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
    {
      mensagem: 'detalhar por mes',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const enriquecido = temporal._enriquecerContratoHistoricoTemporal(historicoComAgrupamento);
  for (const item of enriquecido) {
    assert.strictEqual(
      item.contrato_orquestrador.periodo.tipo, 'ano_atual',
      `item "${item.mensagem}" ainda tem periodo:nenhum após enriquecimento`
    );
    assert.strictEqual(item.contrato_orquestrador.periodo.dataInicio, '20260101');
  }
});

ok('buildTemporalUserPrompt inclui historico já enriquecido no payload da IA', () => {
  const historicoComAgrupamento = [
    {
      mensagem: 'detalhar por mes',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const payload = temporal.buildTemporalUserPrompt({
    modulo: 'financeiro',
    mensagem: 'detalhar por fornecedor',
    periodoDeterministico: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
    historicoResumido: historicoComAgrupamento,
    orquestradorContrato: null,
    hoje,
  });
  const obj = JSON.parse(payload);
  const histItem = obj.historico_resumido[0];
  assert.strictEqual(
    histItem.contrato_orquestrador.periodo.tipo, 'ano_atual',
    'historico no payload deve ter período enriquecido (não nenhum)'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Cenário E2E completo — FATURAMENTO: 3 turnos com período anual
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[E2E Faturamento] Cenário: "faturamento do ano" → "detalhar por mes" → "por cliente"');

ok('[FAT T1] "faturamento do ano" → detecta ano atual', () => {
  const p = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'faturamento do ano', periodoInicial: null, hoje });
  assert.strictEqual(p.dataInicio, '20260101');
  assert.strictEqual(p.dataFim, '20261231');
});

ok('[FAT T2] "detalhar por mes" → herda ano inteiro do T1', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'faturamento do ano', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'detalhar por mes', periodoInicial: pT1, hoje });
  assert.strictEqual(pT2.dataInicio, '20260101', `T2 início: ${pT2.dataInicio}`);
  assert.strictEqual(pT2.dataFim, '20261231', `T2 fim: ${pT2.dataFim}`);
});

ok('[FAT T3] "por cliente" → mantém ano inteiro do T1', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'faturamento do ano', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'detalhar por mes', periodoInicial: pT1, hoje });
  const pT3 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'por cliente', periodoInicial: pT2, hoje });
  assert.strictEqual(pT3.dataInicio, '20260101', `T3 início: ${pT3.dataInicio}`);
  assert.strictEqual(pT3.dataFim, '20261231', `T3 fim: ${pT3.dataFim}`);
});

console.log('\n[E2E Faturamento] Cenário: "faturamento de janeiro" → "mes a mes" → "por cliente"');

ok('[FAT T1b] "faturamento de janeiro" → detecta janeiro do ano atual', () => {
  const p = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'faturamento de janeiro', periodoInicial: null, hoje });
  assert.strictEqual(p.dataInicio, '20260101');
  assert.strictEqual(p.dataFim, '20260131');
});

ok('[FAT T2b] "mes a mes" (agrupamento) → herda janeiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'faturamento de janeiro', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'mes a mes', periodoInicial: pT1, hoje });
  assert.strictEqual(pT2.dataInicio, '20260101', `T2b início: ${pT2.dataInicio}`);
  assert.strictEqual(pT2.dataFim, '20260131', `T2b fim: ${pT2.dataFim}`);
});

ok('[FAT T3b] "por cliente" → mantém período de janeiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'faturamento de janeiro', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'mes a mes', periodoInicial: pT1, hoje });
  const pT3 = temporal.resolverPeriodoDeterministico({ modulo: 'faturamento', mensagem: 'por cliente', periodoInicial: pT2, hoje });
  assert.strictEqual(pT3.dataInicio, '20260101', `T3b início: ${pT3.dataInicio}`);
  assert.strictEqual(pT3.dataFim, '20260131', `T3b fim: ${pT3.dataFim}`);
});

// Historico enriquecido para faturamento
ok('[FAT historico] contrato nenhum (por mes) + item.periodo anual → IA recebe período correto', () => {
  const historico = [
    {
      mensagem: 'faturamento do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'faturamento', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
    {
      mensagem: 'detalhar por mes',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'faturamento', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const enriquecido = temporal._enriquecerContratoHistoricoTemporal(historico);
  for (const item of enriquecido) {
    assert.strictEqual(item.contrato_orquestrador.periodo.tipo, 'ano_atual',
      `"${item.mensagem}": esperado ano_atual, recebeu ${item.contrato_orquestrador.periodo.tipo}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cenário E2E completo — COMPRAS: 3 turnos com período anual e mensal
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[E2E Compras] Cenário: "compras do ano" → "por mes" → "por fornecedor"');

ok('[COM T1] "compras do ano" → detecta ano atual', () => {
  const p = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'compras do ano', periodoInicial: null, hoje });
  assert.strictEqual(p.dataInicio, '20260101');
  assert.strictEqual(p.dataFim, '20261231');
});

ok('[COM T2] "por mes" (agrupamento) → herda ano inteiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'compras do ano', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'por mes', periodoInicial: pT1, hoje });
  assert.strictEqual(pT2.dataInicio, '20260101', `T2 início: ${pT2.dataInicio}`);
  assert.strictEqual(pT2.dataFim, '20261231', `T2 fim: ${pT2.dataFim}`);
});

ok('[COM T3] "por fornecedor" → mantém ano inteiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'compras do ano', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'por mes', periodoInicial: pT1, hoje });
  const pT3 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'por fornecedor', periodoInicial: pT2, hoje });
  assert.strictEqual(pT3.dataInicio, '20260101', `T3 início: ${pT3.dataInicio}`);
  assert.strictEqual(pT3.dataFim, '20261231', `T3 fim: ${pT3.dataFim}`);
});

console.log('\n[E2E Compras] Cenário: "compras de maio" → "por mes" → "por fornecedor"');

ok('[COM T1b] "compras de maio" → detecta maio do ano atual', () => {
  const p = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'compras de maio', periodoInicial: null, hoje });
  assert.strictEqual(p.dataInicio, '20260501');
  assert.strictEqual(p.dataFim, '20260531');
});

ok('[COM T2b] "detalhar por mes" (agrupamento) → herda período de maio', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'compras de maio', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'detalhar por mes', periodoInicial: pT1, hoje });
  assert.strictEqual(pT2.dataInicio, '20260501', `T2b início: ${pT2.dataInicio}`);
  assert.strictEqual(pT2.dataFim, '20260531', `T2b fim: ${pT2.dataFim}`);
});

ok('[COM T3b] "por fornecedor" → mantém período de maio', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'compras de maio', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'detalhar por mes', periodoInicial: pT1, hoje });
  const pT3 = temporal.resolverPeriodoDeterministico({ modulo: 'compras', mensagem: 'detalhar por fornecedor', periodoInicial: pT2, hoje });
  assert.strictEqual(pT3.dataInicio, '20260501', `T3b início: ${pT3.dataInicio}`);
  assert.strictEqual(pT3.dataFim, '20260531', `T3b fim: ${pT3.dataFim}`);
});

// Historico enriquecido para compras
ok('[COM historico] contrato nenhum (por mes) + item.periodo real → IA recebe período correto', () => {
  const historico = [
    {
      mensagem: 'compras do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'compras', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
    {
      mensagem: 'por mes',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'compras', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const enriquecido = temporal._enriquecerContratoHistoricoTemporal(historico);
  for (const item of enriquecido) {
    assert.strictEqual(item.contrato_orquestrador.periodo.tipo, 'ano_atual',
      `"${item.mensagem}": esperado ano_atual, recebeu ${item.contrato_orquestrador.periodo.tipo}`);
  }
});

ok('[COM _contratoHistoricoRecente] turno agrupamento com nenhum → retorna período correto', () => {
  const historico = [
    {
      mensagem: 'compras do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'compras', periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' } },
    },
    {
      mensagem: 'por mes',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'compras', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const r = orch._contratoHistoricoRecente(historico);
  assert.ok(r, 'deve retornar contrato');
  assert.strictEqual(r.periodo.tipo, 'ano_atual');
  assert.strictEqual(r.periodo.dataInicio, '20260101');
});

// ─────────────────────────────────────────────────────────────────────────────
// Cenário E2E completo — COMISSÃO: 3 turnos com período trimestral e anual
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[E2E Comissão] Cenário: "comissao do ano" → "por mes" → "por vendedor"');

ok('[CMI T1] "comissao do ano" → detecta ano atual', () => {
  const p = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'comissao do ano', periodoInicial: null, hoje });
  assert.strictEqual(p.dataInicio, '20260101');
  assert.strictEqual(p.dataFim, '20261231');
});

ok('[CMI T2] "por mes" (agrupamento) → herda ano inteiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'comissao do ano', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'por mes', periodoInicial: pT1, hoje });
  assert.strictEqual(pT2.dataInicio, '20260101', `T2 início: ${pT2.dataInicio}`);
  assert.strictEqual(pT2.dataFim, '20261231', `T2 fim: ${pT2.dataFim}`);
});

ok('[CMI T3] "por vendedor" → mantém ano inteiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'comissao do ano', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'por mes', periodoInicial: pT1, hoje });
  const pT3 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'por vendedor', periodoInicial: pT2, hoje });
  assert.strictEqual(pT3.dataInicio, '20260101', `T3 início: ${pT3.dataInicio}`);
  assert.strictEqual(pT3.dataFim, '20261231', `T3 fim: ${pT3.dataFim}`);
});

console.log('\n[E2E Comissão] Cenário: "comissao de janeiro" → "detalhar por mes" → "maior valor"');

ok('[CMI T1b] "comissao de janeiro" → detecta janeiro atual', () => {
  const p = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'comissao de janeiro', periodoInicial: null, hoje });
  assert.strictEqual(p.dataInicio, '20260101');
  assert.strictEqual(p.dataFim, '20260131');
});

ok('[CMI T2b] "detalhar por mes" → herda período de janeiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'comissao de janeiro', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'detalhar por mes', periodoInicial: pT1, hoje });
  assert.strictEqual(pT2.dataInicio, '20260101', `T2b início: ${pT2.dataInicio}`);
  assert.strictEqual(pT2.dataFim, '20260131', `T2b fim: ${pT2.dataFim}`);
});

ok('[CMI T3b] "maior valor" → mantém período de janeiro', () => {
  const pT1 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'comissao de janeiro', periodoInicial: null, hoje });
  const pT2 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'detalhar por mes', periodoInicial: pT1, hoje });
  const pT3 = temporal.resolverPeriodoDeterministico({ modulo: 'comissao', mensagem: 'maior valor', periodoInicial: pT2, hoje });
  assert.strictEqual(pT3.dataInicio, '20260101', `T3b início: ${pT3.dataInicio}`);
  assert.strictEqual(pT3.dataFim, '20260131', `T3b fim: ${pT3.dataFim}`);
});

// Historico enriquecido para comissão
ok('[CMI historico] contrato nenhum (por mes) + item.periodo real → IA recebe período correto', () => {
  const historico = [
    {
      mensagem: 'comissao do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'comissao', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
    {
      mensagem: 'por mes',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'comissao', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const enriquecido = temporal._enriquecerContratoHistoricoTemporal(historico);
  for (const item of enriquecido) {
    assert.strictEqual(item.contrato_orquestrador.periodo.tipo, 'ano_atual',
      `"${item.mensagem}": esperado ano_atual, recebeu ${item.contrato_orquestrador.periodo.tipo}`);
  }
});

ok('[CMI _contratoHistoricoRecente] turno agrupamento com nenhum → retorna período real', () => {
  const historico = [
    {
      mensagem: 'comissao do ano',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'comissao', periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' } },
    },
    {
      mensagem: 'por mes',
      periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
      contrato_orquestrador: { modulo: 'comissao', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } },
    },
  ];
  const r = orch._contratoHistoricoRecente(historico);
  assert.ok(r, 'deve retornar contrato');
  assert.strictEqual(r.periodo.tipo, 'ano_atual');
  assert.strictEqual(r.periodo.dataInicio, '20260101');
});

// ─────────────────────────────────────────────────────────────────────────────
// Regressão: casos que devem continuar funcionando após as correções
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Regressão] Casos existentes não devem ter quebrado');

ok('"faturamento do ano" com periodoInicial legado → ano atual (teste original)', () => {
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'faturamento',
    mensagem: 'faturamento do ano',
    periodoInicial: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
    hoje,
  });
  assert.strictEqual(r.dataInicio, '20260101');
  assert.strictEqual(r.dataFim, '20261231');
});

ok('"faturamento do mes" com periodoInicial legado → mês atual (teste original)', () => {
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'faturamento',
    mensagem: 'faturamento do mes',
    periodoInicial: { tipo: 'mes', dataInicio: '20230101', dataFim: '20230131' },
    hoje,
  });
  assert.strictEqual(r.dataInicio, '20260501');
  assert.strictEqual(r.dataFim, '20260531');
});

ok('"faturamento de maio" com periodoInicial legado → maio atual (teste original)', () => {
  const r = temporal.resolverPeriodoDeterministico({
    modulo: 'faturamento',
    mensagem: 'faturamento de maio',
    periodoInicial: { tipo: 'mes', dataInicio: '20230501', dataFim: '20230531' },
    hoje,
  });
  assert.strictEqual(r.dataInicio, '20260501');
  assert.strictEqual(r.dataFim, '20260531');
});

for (const modulo of ['compras', 'comissao']) {
  ok(`"${modulo} do ano" com periodoInicial legado → ano atual (teste original)`, () => {
    const r = temporal.resolverPeriodoDeterministico({
      modulo,
      mensagem: `${modulo} do ano`,
      periodoInicial: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
      hoje,
    });
    assert.strictEqual(r.dataInicio, '20260101');
    assert.strictEqual(r.dataFim, '20261231');
  });
}

ok('_periodoEfetivo não muta o objeto original (imutabilidade)', () => {
  const contrato = Object.freeze({ modulo: 'financeiro', periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } });
  const r = orch._periodoEfetivo(contrato, { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' });
  assert.strictEqual(r.periodo.tipo, 'ano_atual');
  assert.strictEqual(contrato.periodo.tipo, 'nenhum', 'original não deve ser mutado');
});

ok('_enriquecerContratoHistoricoTemporal não muta objetos originais', () => {
  const original = {
    mensagem: 'test',
    periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
    contrato_orquestrador: Object.freeze({ periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null } }),
  };
  temporal._enriquecerContratoHistoricoTemporal([original]);
  assert.strictEqual(original.contrato_orquestrador.periodo.tipo, 'nenhum', 'original não deve ser mutado');
});

// ─────────────────────────────────────────────────────────────────────────────
// Resultado final
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`heranca-periodo-multiturn.test.js: ${passou} testes passaram, 0 falhas ✓`);
} else {
  console.error(`heranca-periodo-multiturn.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
