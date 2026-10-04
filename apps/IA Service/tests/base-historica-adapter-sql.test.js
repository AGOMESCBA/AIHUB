// Valida a SQL real enviada pelo adapter SoftExpert para a importação.
// Este teste não conecta no SQL Server; ele captura o payload que seria
// enviado ao Agente Local para impedir regressão de paginação.
//
// Executar: node "apps/IA Service/tests/base-historica-adapter-sql.test.js"

const assert = require('assert');

const agenteLocalService = require('../backend/services/agente-local-service');
const adapter = require('../backend/services/import/softexpert-sqlserver-adapter');

async function main() {
  const original = agenteLocalService.executarSelectNaFonte;
  let capturado = null;

  agenteLocalService.executarSelectNaFonte = async (empresaId, fonteId, payload) => {
    capturado = { empresaId, fonteId, payload };
    return [
      {
        OID: 'OID-TESTE',
        IDPROCESS: '036596',
        __rn: 501,
      },
    ];
  };

  try {
    const rows = await adapter.listarChamadosPeriodo(
      9701,
      { id: 42 },
      { inicio: '20250101', fim: '20261231' },
      { offset: 500, limit: 250 }
    );

    assert.ok(capturado, 'adapter deve chamar o Agente Local');
    assert.strictEqual(capturado.empresaId, 9701);
    assert.strictEqual(capturado.fonteId, 42);
    assert.match(capturado.payload.sql, /ROW_NUMBER\(\)\s+OVER\s+\(ORDER BY D\.OID\)\s+AS __rn/i);
    assert.match(capturado.payload.sql, /WHERE __rn > 500 AND __rn <= 750/i);
    assert.doesNotMatch(capturado.payload.sql, /OFFSET\s+@offset|FETCH\s+NEXT\s+@limit/i);
    assert.deepStrictEqual(capturado.payload.params, { inicio: '20250101', fim: '20261231' });
    assert.strictEqual(capturado.payload.limit, 250);
    assert.deepStrictEqual(rows, [{ OID: 'OID-TESTE', IDPROCESS: '036596' }], 'coluna interna de paginação não deve contaminar o RAW importado');
  } finally {
    agenteLocalService.executarSelectNaFonte = original;
  }

  console.log('base-historica-adapter-sql.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
