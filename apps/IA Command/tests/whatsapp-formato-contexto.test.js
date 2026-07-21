'use strict';

const assert = require('assert');
const path   = require('path');
const ROOT   = path.resolve(__dirname, '..');

const fmt    = require(path.join(ROOT, 'modules/erp/core/whatsapp-format-prompt'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const { _extrairLabelIntencao, _buildContextoConsulta } = runner._test;

let passaram = 0, falharam = 0;

function ok(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passaram++;
  } catch (e) {
    console.error(`  ✗ ${descricao}\n    ${e.message}`);
    falharam++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FRENTE 1 — _extrairLabelIntencao
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── _extrairLabelIntencao ──');

ok('superlativo: maior cliente', () =>
  assert.strictEqual(_extrairLabelIntencao('qual o maior cliente de faturamento'), 'Maior cliente'));

ok('superlativo: menor fornecedor', () =>
  assert.strictEqual(_extrairLabelIntencao('qual o menor fornecedor em valor'), 'Menor fornecedor'));

ok('superlativo: maior e menor mês', () =>
  assert.strictEqual(_extrairLabelIntencao('qual o maior e menor mês'), 'Maior e menor'));

ok('top N', () =>
  assert.strictEqual(_extrairLabelIntencao('top 5 vendedores de janeiro'), 'Top 5'));

ok('evolução', () =>
  assert.strictEqual(_extrairLabelIntencao('evolução do faturamento'), 'Evolução'));

ok('histórico', () =>
  assert.strictEqual(_extrairLabelIntencao('histórico de compras'), 'Evolução'));

ok('mensal (por mês)', () =>
  assert.strictEqual(_extrairLabelIntencao('faturamento por mês'), 'Mensal'));

ok('anual (por ano)', () =>
  assert.strictEqual(_extrairLabelIntencao('compras por ano'), 'Anual'));

ok('comparativo', () =>
  assert.strictEqual(_extrairLabelIntencao('comparar 2025 com 2026'), 'Comparativo'));

ok('média', () =>
  assert.strictEqual(_extrairLabelIntencao('qual o ticket médio por cliente'), 'Média'));

ok('total', () =>
  assert.strictEqual(_extrairLabelIntencao('quanto faturamos no mês'), 'Total'));

ok('listagem', () =>
  assert.strictEqual(_extrairLabelIntencao('listar fornecedores do mês'), 'Listagem'));

ok('pergunta genérica sem intenção → null', () =>
  assert.strictEqual(_extrairLabelIntencao('faturamento de abril de 2026'), null));

ok('mensagem vazia → null', () =>
  assert.strictEqual(_extrairLabelIntencao(''), null));

ok('null → null', () =>
  assert.strictEqual(_extrairLabelIntencao(null), null));

// ─────────────────────────────────────────────────────────────────────────────
// FRENTE 1 — _buildContextoConsulta com mensagem
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── _buildContextoConsulta com mensagem ──');

const periodo = { dataInicio: '20260101', dataFim: '20260630' };
const intentBase = { _entidadesResolvidas: [], filtros: {}, _orquestradorContrato: null, periodo };

ok('cabeçalho inclui label + período', () => {
  const ctx = _buildContextoConsulta(intentBase, null, 'qual o maior cliente');
  assert.ok(ctx.includes('Maior cliente'), `esperado "Maior cliente" em: "${ctx}"`);
  assert.ok(ctx.includes('Jan a Jun/2026'), `esperado período em: "${ctx}"`);
});

ok('label fica antes do período (separado por |)', () => {
  const ctx = _buildContextoConsulta(intentBase, null, 'top 3 vendedores');
  assert.ok(ctx.startsWith('Top 3'), `label deve ser primeiro: "${ctx}"`);
});

ok('sem label quando mensagem genérica — só período', () => {
  const ctx = _buildContextoConsulta(intentBase, null, 'faturamento de abril');
  assert.ok(!ctx.includes('null'), `não deve conter null: "${ctx}"`);
  assert.ok(ctx.includes('Jan a Jun/2026'), `deve conter período: "${ctx}"`);
});

ok('intent null retorna null', () =>
  assert.strictEqual(_buildContextoConsulta(null), null));

ok('sem período nem entidade e sem label → null', () => {
  const ctx = _buildContextoConsulta({ _entidadesResolvidas: [], filtros: {} }, null, 'faturamento de abril');
  assert.strictEqual(ctx, null);
});

ok('com entidade resolvida inclui nome', () => {
  const intentComEnt = {
    ...intentBase,
    _entidadesResolvidas: [{ tipo: 'cliente', nome: 'ACME LTDA', codigo: '000001', loja: '01' }],
  };
  const ctx = _buildContextoConsulta(intentComEnt, null, 'qual o maior cliente');
  assert.ok(ctx.includes('Cliente: ACME LTDA'), `esperado entidade em: "${ctx}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// FRENTE 2 — buildFormatCompetenciaEntidade (novo formatter)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── buildFormatCompetenciaEntidade ──');

const rowsAnoUnico = [
  { empresa: 'ALPHA LTDA', competencia: '202601', faturamento: 150000 },
  { empresa: 'ALPHA LTDA', competencia: '202602', faturamento: 175000 },
  { empresa: 'BETA SA',    competencia: '202601', faturamento: 90000  },
  { empresa: 'BETA SA',    competencia: '202602', faturamento: 110000 },
];

ok('ativa para competencia AAAAMM + empresa', () => {
  const r = fmt.buildFormatCompetenciaEntidade(rowsAnoUnico, { nomeModulo: 'Faturamento' });
  assert.ok(r !== null, 'deve retornar string não-nula');
});

ok('cabeçalho contém nome do módulo', () => {
  const r = fmt.buildFormatCompetenciaEntidade(rowsAnoUnico, { nomeModulo: 'Faturamento' });
  assert.ok(r.includes('Faturamento'), `esperado "Faturamento" em: "${r.slice(0,80)}"`);
});

ok('bloco Janeiro/2026 presente', () => {
  const r = fmt.buildFormatCompetenciaEntidade(rowsAnoUnico, { nomeModulo: 'Faturamento' });
  assert.ok(r.includes('Janeiro/2026'), `esperado bloco Janeiro/2026`);
});

ok('empresas listadas como itens dentro do bloco', () => {
  const r = fmt.buildFormatCompetenciaEntidade(rowsAnoUnico, { nomeModulo: 'Faturamento' });
  assert.ok(r.includes('ALPHA LTDA'), 'deve conter ALPHA LTDA');
  assert.ok(r.includes('BETA SA'), 'deve conter BETA SA');
});

ok('subtotal por bloco presente', () => {
  const r = fmt.buildFormatCompetenciaEntidade(rowsAnoUnico, { nomeModulo: 'Faturamento' });
  assert.ok(r.includes('Subtotal'), 'deve conter linha de Subtotal');
});

ok('total geral presente', () => {
  const r = fmt.buildFormatCompetenciaEntidade(rowsAnoUnico, { nomeModulo: 'Faturamento' });
  assert.ok(r.includes('Total Geral'), 'deve conter Total Geral');
});

ok('total geral correto: R$ 525.000,00', () => {
  const r = fmt.buildFormatCompetenciaEntidade(rowsAnoUnico, { nomeModulo: 'Faturamento' });
  assert.ok(r.includes('525.000,00'), `esperado 525.000,00 em Total Geral`);
});

ok('multi-ano: dois blocos distintos (Jan/2025 e Jan/2026)', () => {
  const rowsMultiAno = [
    { empresa: 'ALPHA', competencia: '202501', faturamento: 120000 },
    { empresa: 'ALPHA', competencia: '202601', faturamento: 150000 },
    { empresa: 'BETA',  competencia: '202501', faturamento: 80000  },
    { empresa: 'BETA',  competencia: '202601', faturamento: 90000  },
  ];
  const r = fmt.buildFormatCompetenciaEntidade(rowsMultiAno, { nomeModulo: 'Faturamento' });
  assert.ok(r.includes('Janeiro/2025'), 'deve conter Janeiro/2025');
  assert.ok(r.includes('Janeiro/2026'), 'deve conter Janeiro/2026');
});

ok('retorna null para rows sem coluna temporal AAAAMM', () => {
  const rowsSemTemporal = [{ empresa: 'X', faturamento: 1000 }];
  assert.strictEqual(fmt.buildFormatCompetenciaEntidade(rowsSemTemporal), null);
});

ok('retorna null para rows vazias', () =>
  assert.strictEqual(fmt.buildFormatCompetenciaEntidade([]), null));

ok('retorna null quando não há entidade (só temporal + métricas)', () => {
  const rowsSemEntidade = [{ competencia: '202601', faturamento: 1000 }];
  assert.strictEqual(fmt.buildFormatCompetenciaEntidade(rowsSemEntidade), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// FRENTE 2 — empresa reconhecida como colEntidade pelo _detectarColunas
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── empresa como colEntidade em _detectarColunas ──');

ok('"empresa" detectada como entidade junto com coluna temporal', () => {
  const { prepararDadosComTotais } = fmt;
  const rows = [
    { empresa: 'ALPHA', competencia: '202601', faturamento: 100 },
    { empresa: 'BETA',  competencia: '202601', faturamento: 200 },
  ];
  const { dados, subtotais } = prepararDadosComTotais(rows);
  assert.ok(dados && dados.length > 0, 'dados não vazios');
  // Os subtotais devem ter a chave de agrupamento temporal
  assert.ok(subtotais && Object.keys(subtotais).length > 0, 'subtotais gerados');
});

ok('empresa não interfere em rows sem coluna temporal (lista simples)', () => {
  const rows = [
    { empresa: 'ALPHA', faturamento: 100 },
    { empresa: 'BETA',  faturamento: 200 },
  ];
  const { dados, subtotais } = fmt.prepararDadosComTotais(rows);
  assert.ok(dados && dados.length > 0, 'dados não vazios');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────────────────────────');
if (falharam === 0) {
  console.log(`whatsapp-formato-contexto.test.js: ${passaram} testes passaram, 0 falhas ✓`);
} else {
  console.log(`whatsapp-formato-contexto.test.js: ${passaram} passaram, ${falharam} FALHARAM ✗`);
  process.exitCode = 1;
}
