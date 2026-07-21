'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const estoque = require(path.join(ROOT, 'modules/erp/totvs_protheus/estoque/ai-sql-handler-v2'));
const estoqueSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/estoque/estoque-ia-owner-spec'));
const catalog = require(path.join(ROOT, 'modules/erp/totvs_protheus/estoque/entity-catalog'));
const guard   = require(path.join(ROOT, 'modules/erp/totvs_protheus/guards/entity-sql-guard'));

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

(async () => {
  let chamadas = 0;
  const candidatos = await estoqueSpec._test.buscarEntidade({
    empresaId: 1,
    sx2: { SB1990: 'C' },
    tipo: 'produto',
    termoTexto: '000001',
    helpers: {
      escapeSqlLiteral: v => String(v || '').replace(/'/g, "''"),
      tabelaFisicaSX2: (_sx2, base) => (base === 'SB1' ? 'SB1990' : null),
      connectionFactory: {
        carregarConexao: () => ({}),
        executar: async () => {
          chamadas += 1;
          if (chamadas === 1) throw new Error('Falha ao conectar ao agente: socket hang up');
          return [{ codigo: '000001', loja: null, nome: 'PRODUTO TESTE' }];
        },
      },
    },
  });

  assert.strictEqual(chamadas, 2, 'estoque lookup: retry curto recupera socket hang up');
  assert.deepStrictEqual(candidatos.map(c => c.codigo), ['000001'], 'estoque lookup: retorna candidato apos retry');
  assert.strictEqual(estoqueSpec._test.erroLookupTransitorio(new Error('Falha ao conectar ao agente: socket hang up')), true, 'estoque lookup: classifica socket hang up como transitorio');
  assert.strictEqual(estoqueSpec._test.termoGenericoEstoqueNaoEntidade('tem maior saldo em estoque'), true, 'estoque lookup: ignora termo generico de ranking/saldo');
  assert.strictEqual(estoqueSpec._test.termoGenericoEstoqueNaoEntidade('000001'), false, 'estoque lookup: preserva codigo de produto');

  let chamadasGenerico = 0;
  const resolucaoGenerica = await estoqueSpec._test.resolverEntidades({
    empresaId: 1,
    sx2: { SB1990: 'C' },
    pedidos: [{ texto: 'tem maior saldo em estoque', tipo_sugerido: 'produto', origem: 'ia' }],
    helpers: {
      escapeSqlLiteral: v => String(v || '').replace(/'/g, "''"),
      tabelaFisicaSX2: (_sx2, base) => (base === 'SB1' ? 'SB1990' : null),
      connectionFactory: {
        carregarConexao: () => ({}),
        executar: async () => {
          chamadasGenerico += 1;
          return [];
        },
      },
    },
  });
  assert.strictEqual(chamadasGenerico, 0, 'estoque lookup: termo generico nao chama agente');
  assert.deepStrictEqual(resolucaoGenerica, { status: 'resolvido', entidades: [] }, 'estoque lookup: termo generico nao bloqueia consulta');

  console.log('estoque-entidades-prioridade.test.js: ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
