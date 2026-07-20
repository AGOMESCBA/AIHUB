'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const estoque = require(path.join(ROOT, 'modules/erp/estoque/ai-sql-handler-v2'));
const catalog = require(path.join(ROOT, 'modules/erp/estoque/entity-catalog'));
const guard   = require(path.join(ROOT, 'modules/erp/entity-sql-guard'));

// ── Contrato de API do handler v2 ─────────────────────────────────────────────

assert.strictEqual(typeof estoque.executar, 'function', 'estoque v2: expoe executar');
assert.strictEqual(typeof estoque.garantirIntencao, 'function', 'estoque v2: expoe garantirIntencao');

// ── Catálogo de entidades ─────────────────────────────────────────────────────

assert(catalog.DEFINICOES.produto, 'estoque deve conhecer produto');
assert(catalog.DEFINICOES.grupo_produto, 'estoque deve conhecer grupo_produto');

// ── entity-sql-guard: produto e grupo_produto ────────────────────────────────

assert.strictEqual(
  guard.validarSqlEntidadesResolvidas(
    "SELECT SUM(SB2.B2_QATU) FROM SB2990 SB2 INNER JOIN SB1990 SB1 ON SB2.B2_COD = SB1.B1_COD WHERE SB1.B1_COD = 'PX001'",
    { entidades: [{ tipo: 'produto', codigo: 'PX001' }] },
    catalog.DEFINICOES,
  ).ok,
  true,
  'produto resolvido deve aceitar filtro por codigo',
);

assert.strictEqual(
  guard.validarSqlEntidadesResolvidas(
    "SELECT SUM(SB2.B2_QATU) FROM SB2990 SB2 INNER JOIN SB1990 SB1 ON SB2.B2_COD = SB1.B1_COD WHERE SB1.B1_DESC = 'Produto X'",
    { entidades: [{ tipo: 'produto', codigo: 'PX001' }] },
    catalog.DEFINICOES,
  ).ok,
  false,
  'produto resolvido nao pode ser filtrado por descricao',
);

console.log('estoque-entidades-prioridade.test.js: ok');
