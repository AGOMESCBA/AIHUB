'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { prepararEstruturaTabular } = require(path.join(ROOT, 'modules/whatsapp/whatsapp-attachment-builder'));

// 1. Sem agrupamento (0 dimensoes) — apenas total geral
{
  const rows = [
    { cliente: 'A', faturamento: 100 },
    { cliente: 'B', faturamento: 200 },
  ];
  const estrutura = prepararEstruturaTabular(rows, {});
  assert.strictEqual(estrutura.colunasDimensao.length, 0, 'sem agrupar_por nao deve gerar dimensoes');
  assert.strictEqual(estrutura.linhas.length, 2);
  assert.strictEqual(estrutura.totalGeral.faturamento, 300, 'total geral deve somar as 2 linhas');
  assert.strictEqual(estrutura.subtotais.length, 0, 'sem dimensao nao deve gerar subtotais');
  assert.strictEqual(estrutura.multiEmpresa, false);
}

// 2. Agrupamento simples (1 dimensao) — subtotal por grupo bate com soma manual
{
  const rows = [
    { cliente: 'A', faturamento: 100 },
    { cliente: 'A', faturamento: 50 },
    { cliente: 'B', faturamento: 200 },
  ];
  const estrutura = prepararEstruturaTabular(rows, { agrupar_por: 'cliente' });
  assert.strictEqual(estrutura.colunasDimensao.length, 1);
  assert.strictEqual(estrutura.subtotais.length, 2, 'deve gerar 1 subtotal por cliente distinto');
  const subtotalA = estrutura.subtotais.find(s => s.chaveGrupo === 'A');
  assert(subtotalA, 'deve existir subtotal do cliente A');
  assert.strictEqual(subtotalA.valores.faturamento, 150, 'subtotal de A deve ser 100+50=150');
  assert.strictEqual(estrutura.totalGeral.faturamento, 350, 'total geral deve ser 100+50+200=350');
}

// 3. Agrupamento composto (2 dimensoes)
{
  const rows = [
    { mes: '202601', cliente: 'A', faturamento: 100 },
    { mes: '202601', cliente: 'B', faturamento: 50 },
    { mes: '202602', cliente: 'A', faturamento: 30 },
  ];
  const estrutura = prepararEstruturaTabular(rows, { group_by: ['mes', 'cliente'] });
  assert.strictEqual(estrutura.colunasDimensao.length, 2, 'deve reconhecer as 2 dimensoes de agrupamento');
  assert.strictEqual(estrutura.subtotais.length, 3, 'deve gerar 1 subtotal por combinacao (mes,cliente) distinta');
  assert.strictEqual(estrutura.totalGeral.faturamento, 180);
}

// 4. Multiempresa — coluna "empresa" com mais de 1 valor distinto
{
  const rows = [
    { empresa: 'Empresa A', cliente: 'X', faturamento: 100 },
    { empresa: 'Empresa B', cliente: 'Y', faturamento: 200 },
    { empresa: 'Empresa A', cliente: 'Z', faturamento: 50 },
  ];
  const estrutura = prepararEstruturaTabular(rows, {});
  assert.strictEqual(estrutura.multiEmpresa, true, 'deve detectar multiempresa quando ha >1 valor distinto de empresa');
  assert(estrutura.resumoPorEmpresa, 'deve preencher resumoPorEmpresa quando multiEmpresa');
  assert.strictEqual(estrutura.resumoPorEmpresa.length, 2);
  const resumoA = estrutura.resumoPorEmpresa.find(e => e.empresaNome === 'Empresa A');
  assert.strictEqual(resumoA.valores.faturamento, 150, 'resumo da Empresa A deve somar 100+50=150');
  assert.strictEqual(resumoA.registros, 2);
  assert.strictEqual(estrutura.linhas[0].empresaNome, 'Empresa A', 'cada linha deve carregar o nome da empresa');
}

// 5. Empresa unica — NAO deve marcar multiEmpresa
{
  const rows = [
    { empresa: 'Empresa A', cliente: 'X', faturamento: 100 },
    { empresa: 'Empresa A', cliente: 'Y', faturamento: 200 },
  ];
  const estrutura = prepararEstruturaTabular(rows, {});
  assert.strictEqual(estrutura.multiEmpresa, false, 'uma unica empresa nao deve marcar multiEmpresa');
  assert.strictEqual(estrutura.resumoPorEmpresa, null);
}

// 6. rows vazio nao deve quebrar
{
  const estrutura = prepararEstruturaTabular([], {});
  assert.strictEqual(estrutura.linhas.length, 0);
  assert.deepStrictEqual(estrutura.totalGeral, {});
}

console.log('whatsapp-attachment-builder.test.js: ok');
