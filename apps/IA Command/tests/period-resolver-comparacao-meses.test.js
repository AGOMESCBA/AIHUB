'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { identificarPeriodoTexto, resolverPeriodo } = require(path.join(ROOT, 'modules/ai/period-resolver'));

const hoje = new Date('2026-07-28T09:00:00');

{
  const periodo = identificarPeriodoTexto('Compare o faturamento de junho do ano passado com julho do ano passado', { hoje });
  assert.strictEqual(periodo.tipo, 'personalizado');
  assert.strictEqual(periodo.data_inicio, '20250601');
  assert.strictEqual(periodo.data_fim, '20250731');
  assert.deepStrictEqual(periodo.meses, [6, 7]);
  assert.deepStrictEqual(periodo.anos, [2025]);
  assert.strictEqual(periodo.periodos_comparativos.length, 2);
  assert.strictEqual(periodo.periodos_comparativos[0].dataInicio, '20250601');
  assert.strictEqual(periodo.periodos_comparativos[0].dataFim, '20250630');
  assert.strictEqual(periodo.periodos_comparativos[1].dataInicio, '20250701');
  assert.strictEqual(periodo.periodos_comparativos[1].dataFim, '20250731');
}

{
  const periodo = identificarPeriodoTexto('Compare esse resultado com julho do ano passado', { hoje });
  assert.strictEqual(periodo.tipo, 'personalizado');
  assert.strictEqual(periodo.data_inicio, '20250701');
  assert.strictEqual(periodo.data_fim, '20250731');
}

{
  const identificado = identificarPeriodoTexto('Compare junho de 2025 com julho de 2025', { hoje });
  const resolvido = resolverPeriodo(identificado, { hoje });
  assert.strictEqual(resolvido.dataInicio, '20250601');
  assert.strictEqual(resolvido.dataFim, '20250731');
  assert.deepStrictEqual(resolvido.meses, [6, 7]);
  assert.deepStrictEqual(resolvido.anos, [2025]);
  assert.strictEqual(resolvido.periodos_comparativos.length, 2);
}

{
  const periodo = identificarPeriodoTexto('Compare compras e faturamento desses dois meses', { hoje });
  assert.strictEqual(periodo.tipo, 'nenhum');
  assert.strictEqual(periodo.referencia_contexto, true);
}

console.log('period-resolver-comparacao-meses.test.js: ok');
