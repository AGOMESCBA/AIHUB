const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../backend/services/retorno-softexpert-config');
const calls = [];
let rows = [];
let reconstruction = { reconstruido: true };
function mock(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mock('../backend/services/agente-local-service', { async executarSelectNaFonte(empresa, fonte, request) { calls.push({ empresa, fonte, ...request }); return rows; } });
mock('../backend/services/import/historical-import-service', { async atualizarChamadosPorIds() { return { erros: [], naoEncontrados: [] }; } });
mock('../backend/services/radar-service', { reconstruirHistoricoDoChamado() { return reconstruction; } });
mock('../backend/repositories/chamado-repository', { getChamado() { return { id: 'chamado-local' }; } });
const source = require('../backend/services/retorno-softexpert-source');
const adapter = require('../backend/services/import/softexpert-sqlserver-adapter');
const chamado = { empresaId: 99001, fonteId: 'fonte-teste', id: 'chamado-local', numero: '000123', oidOrigem: 'oid-pai' };
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retorno-source-test-'));
const previous = process.env.SVC_SOFTEXPERT_RETORNO_CONFIG;
after(() => {
  if (previous === undefined) delete process.env.SVC_SOFTEXPERT_RETORNO_CONFIG;
  else process.env.SVC_SOFTEXPERT_RETORNO_CONFIG = previous;
  fs.rmSync(directory, { recursive: true });
});

test('RecordKey só é aceito como OID após SELECT vinculado ao chamado correto', async () => {
  rows = [];
  assert.equal(await source.resolverOid({ chamado, recordKey: 'chave-api' }), null);
  rows = [{ OID: 'chave-api' }];
  assert.equal(await source.resolverOid({ chamado, recordKey: 'chave-api' }), 'chave-api');
  const query = calls.at(-1);
  assert.match(query.sql, /^SELECT .*OIDABCA7HP6S55J0LV = @oidChamado/);
  assert.deepEqual(query.params, { recordKey: 'chave-api', oidChamado: 'oid-pai' });
  assert.equal(query.empresa, chamado.empresaId);
  const before = calls.length;
  assert.equal(await source.resolverOid({ chamado, recordKey: "x'; INSERT" }), null);
  assert.equal(calls.length, before);
  rows = [];
});

test('chat ocupado mantém sincronização pendente; ausência de atendimento permite atualização da base', async () => {
  reconstruction = { reconstruido: false, motivo: 'turno_em_andamento' };
  await assert.rejects(source.sincronizar(chamado), /pendente/);
  reconstruction = { reconstruido: false, motivo: 'sem_atendimento' };
  await source.sincronizar(chamado);
});

test('nova grid de anexos só entra nos SELECTs após validação de armazenamento por empresa e fonte', async () => {
  delete process.env.SVC_SOFTEXPERT_RETORNO_CONFIG;
  await adapter.listarAnexosDoChamado(chamado.empresaId, { id: chamado.fonteId }, chamado.numero);
  assert.doesNotMatch(calls.at(-1).sql, /DYNITSMGRIDANEXOAP/);
  const file = path.join(directory, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ versao: 1, empresas: [{ empresaId: chamado.empresaId, fonteId: chamado.fonteId, anexos: { armazenamentoValidado: true } }] }));
  process.env.SVC_SOFTEXPERT_RETORNO_CONFIG = file;
  assert.equal(config.leituraAnexosHabilitada(99002, chamado.fonteId), false);
  await adapter.listarAnexosDoChamado(chamado.empresaId, { id: chamado.fonteId }, chamado.numero);
  assert.match(calls.at(-1).sql, /A.OIDABCCMV6IBMOTU70 = P.OID/);
  assert.match(calls.at(-1).sql, /B.OID = A.OIDARQUIVO1/);
  await adapter.listarSnapshotAbertos(chamado.empresaId, { id: chamado.fonteId });
  assert.match(calls.at(-1).sql, /MAX\(COALESCE\(AP.BNUPDATED, AP.BNCREATED\)\)/);
  assert.ok(calls.every((c) => !/\b(INSERT|UPDATE|ALTER|DELETE|EXEC)\b/i.test(c.sql)));
});
