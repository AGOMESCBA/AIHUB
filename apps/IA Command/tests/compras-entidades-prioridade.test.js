'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const compras = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/ai-sql-handler-v2'));
const catalog = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/entity-catalog'));
const guard   = require(path.join(ROOT, 'modules/erp/totvs_protheus/guards/entity-sql-guard'));

// ── Contrato de API do handler v2 ─────────────────────────────────────────────

assert.strictEqual(typeof compras.executar, 'function', 'compras v2: expoe executar');
assert.strictEqual(typeof compras.garantirIntencao, 'function', 'compras v2: expoe garantirIntencao');

// Handler v2 não deve expor busca direta por cadastro; entidade precisa validar movimento no período.
assert.strictEqual(compras._sqlBuscaCadastroDiretoCompras, undefined, 'compras v2 nao expoe busca direta por cadastro');

// ── Catálogo de entidades ─────────────────────────────────────────────────────

assert(catalog.DEFINICOES.natureza, 'compras deve conhecer natureza');
assert(catalog.DEFINICOES.tes, 'compras deve conhecer TES');
assert(catalog.DEFINICOES.fornecedor, 'compras deve conhecer fornecedor');
assert(catalog.DEFINICOES.produto, 'compras deve conhecer produto');
assert(catalog.DEFINICOES.grupo_produto, 'compras deve conhecer grupo_produto');
assert(catalog.DEFINICOES.centro_custo, 'compras deve conhecer centro_custo');

// ── entity-sql-guard: natureza e TES ─────────────────────────────────────────

assert.strictEqual(
  guard.validarSqlEntidadesResolvidas(
    "SELECT SUM(SD1.D1_TOTAL) FROM SD1990 SD1 INNER JOIN SED990 SED ON SD1.D1_NATUREZ = SED.ED_CODIGO WHERE SED.ED_CODIGO = '001'",
    { entidades: [{ tipo: 'natureza', codigo: '001' }] },
    catalog.DEFINICOES,
  ).ok,
  true,
  'natureza resolvida deve aceitar filtro por SED/SD1',
);

assert.strictEqual(
  guard.validarSqlEntidadesResolvidas(
    "SELECT SUM(SD1.D1_TOTAL) FROM SD1990 SD1 INNER JOIN SF4990 SF4 ON SD1.D1_TES = SF4.F4_CODIGO WHERE SF4.F4_CODIGO = '101'",
    { entidades: [{ tipo: 'tes', codigo: '101' }] },
    catalog.DEFINICOES,
  ).ok,
  true,
  'TES resolvida deve aceitar filtro por SF4/SD1',
);

assert.strictEqual(
  guard.validarSqlEntidadesResolvidas(
    "SELECT SUM(SD1.D1_TOTAL) FROM SD1990 SD1 INNER JOIN SB1990 SB1 ON SD1.D1_COD = SB1.B1_COD WHERE SB1.B1_DESC = 'Produto X'",
    { entidades: [{ tipo: 'produto', codigo: 'PX001' }] },
    catalog.DEFINICOES,
  ).ok,
  false,
  'produto resolvido nao pode ser filtrado por descricao',
);

console.log('compras-entidades-prioridade.test.js: ok');
