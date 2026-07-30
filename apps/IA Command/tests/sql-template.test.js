'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sqlTemplate = require(path.join(ROOT, 'modules/erp/nlsql-cache/sql-template'));

let ok = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  [ok] ${nome}`);
  } catch (err) {
    console.error(`  [falha] ${nome}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

test('parametriza periodo em formato Protheus e reaplica periodo atual', () => {
  const sql = "SELECT SUM(SD2.D2_TOTAL) AS total FROM SD2010 SD2 WHERE SD2.D_E_L_E_T_ = ' ' AND SD2.D2_EMISSAO BETWEEN '20261101' AND '20261130';";
  const intentNovembro = {
    period: { start: '2026-11-01', end: '2026-11-30' },
    filters: {},
  };
  const tpl = sqlTemplate.parametrizarSqlTemplate(sql, intentNovembro);
  assert(tpl.alterou, 'template deve substituir datas literais');
  assert(tpl.sql_template.includes("'{{iac:period:start}}'"));
  assert(tpl.sql_template.includes("'{{iac:period:end}}'"));
  assert(!tpl.sql_template.includes('20261101'));
  assert(!tpl.sql_template.includes('20261130'));

  const aplicado = sqlTemplate.aplicarSqlTemplate(tpl.sql_template, {
    period: { start: '2026-12-01', end: '2026-12-31' },
    filters: {},
  });
  assert.strictEqual(aplicado.ok, true);
  assert(aplicado.sql.includes("'20261201'"));
  assert(aplicado.sql.includes("'20261231'"));
  assert(!aplicado.sql.includes('20261101'));
});

test('parametriza filtros escalares sem parametrizar filial TODAS', () => {
  const sql = "SELECT * FROM SF2010 SF2 WHERE SF2.F2_CLIENTE = '000123' AND SF2.F2_FILIAL = 'TODAS' AND SF2.F2_TIPO = 'N';";
  const tpl = sqlTemplate.parametrizarSqlTemplate(sql, {
    period: {},
    filters: { cliente_id: '000123', filial: 'TODAS' },
  });
  assert(tpl.sql_template.includes("'{{iac:filter:cliente_id}}'"));
  assert(tpl.sql_template.includes("'TODAS'"));

  const aplicado = sqlTemplate.aplicarSqlTemplate(tpl.sql_template, {
    period: {},
    filters: { cliente_id: '000999', filial: 'TODAS' },
  });
  assert.strictEqual(aplicado.ok, true);
  assert(aplicado.sql.includes("'000999'"));
  assert(!aplicado.sql.includes('000123'));
});

test('aplicacao aceita placeholder de entidade para o executor direto resolver depois', () => {
  const sql = "SELECT * FROM SA1010 SA1 WHERE SA1.A1_COD = '{{iac:cliente:codigo}}' AND SA1.A1_EMISSAO BETWEEN '{{iac:period:start}}' AND '{{iac:period:end}}';";
  const aplicado = sqlTemplate.aplicarSqlTemplate(sql, {
    period: { start: '2026-12-01', end: '2026-12-31' },
    filters: {},
  });

  assert.strictEqual(aplicado.ok, true);
  assert(aplicado.sql.includes("'{{iac:cliente:codigo}}'"));
  assert(aplicado.pendentes.some(p => p.tipo === 'cliente' && p.campo === 'codigo'));
  assert.strictEqual(aplicado.pendentes_template.length, 0);
});

if (!process.exitCode) {
  console.log(`sql-template.test.js: ok (${ok} casos)`);
}
