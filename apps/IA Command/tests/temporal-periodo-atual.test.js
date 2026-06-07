'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const temporal = require(path.join(ROOT, 'modules/erp/temporal-contract'));

const hoje = new Date('2026-05-24T12:00:00');

const ano = temporal.resolverPeriodoDeterministico({
  modulo: 'faturamento',
  mensagem: 'faturamento do ano',
  periodoInicial: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
  hoje,
});

assert.strictEqual(ano.dataInicio, '20260101', 'ano sem ano explicito deve virar ano atual');
assert.strictEqual(ano.dataFim, '20261231', 'fim do ano deve virar ano atual');

const mes = temporal.resolverPeriodoDeterministico({
  modulo: 'faturamento',
  mensagem: 'faturamento do mes',
  periodoInicial: { tipo: 'mes', dataInicio: '20230101', dataFim: '20230131' },
  hoje,
});

assert.strictEqual(mes.dataInicio, '20260501', 'mes sem mes/ano explicito deve virar mes atual');
assert.strictEqual(mes.dataFim, '20260531', 'fim do mes atual deve ser preservado');

const maio = temporal.resolverPeriodoDeterministico({
  modulo: 'faturamento',
  mensagem: 'faturamento de maio',
  periodoInicial: { tipo: 'mes', dataInicio: '20230501', dataFim: '20230531' },
  hoje,
});

assert.strictEqual(maio.dataInicio, '20260501', 'mes nomeado sem ano explicito deve usar ano atual');
assert.strictEqual(maio.dataFim, '20260531', 'fim do mes nomeado deve usar ano atual');

const maioDesteAno = temporal.resolverPeriodoDeterministico({
  modulo: 'faturamento',
  mensagem: 'faturamento somente de maio deste ano',
  periodoInicial: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
  hoje,
});

assert.strictEqual(maioDesteAno.dataInicio, '20260501', 'mes nomeado com "deste ano" deve usar o mes citado no ano atual');
assert.strictEqual(maioDesteAno.dataFim, '20260531', 'fim do mes nomeado com "deste ano" deve usar ano atual');

const dia = temporal.resolverPeriodoDeterministico({
  modulo: 'faturamento',
  mensagem: 'faturamento do dia',
  periodoInicial: { tipo: 'dia', dataInicio: '20230101', dataFim: '20230101' },
  hoje,
});

assert.strictEqual(dia.dataInicio, '20260524', 'dia sem data explicita deve virar data atual');
assert.strictEqual(dia.dataFim, '20260524', 'fim do dia deve ser data atual');

for (const modulo of ['compras', 'comissao']) {
  const periodo = temporal.resolverPeriodoDeterministico({
    modulo,
    mensagem: `${modulo} do ano`,
    periodoInicial: { tipo: 'ano', dataInicio: '20230101', dataFim: '20231231' },
    hoje,
  });

  assert.strictEqual(periodo.dataInicio, '20260101', `${modulo}: ano sem ano explicito deve virar ano atual`);
  assert.strictEqual(periodo.dataFim, '20261231', `${modulo}: fim do ano deve virar ano atual`);
}

console.log('temporal-periodo-atual.test.js: ok');
