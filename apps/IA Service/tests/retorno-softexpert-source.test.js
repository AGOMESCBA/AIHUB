const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../backend/services/retorno-softexpert-config');
const calls = [];
let rows = [];
let reconstruction = { reconstruido: true };
let tecnicoLocal = { idOrigem: '124', sistemaOrigem: 'softexpert' };
function mock(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mock('../backend/services/agente-local-service', { async executarSelectNaFonte(empresa, fonte, request) { calls.push({ empresa, fonte, ...request }); return rows; } });
mock('../backend/services/import/historical-import-service', { async atualizarChamadosPorIds() { return { erros: [], naoEncontrados: [] }; } });
mock('../backend/services/radar-service', { reconstruirHistoricoDoChamado() { return reconstruction; } });
mock('../backend/repositories/chamado-repository', { getChamado() { return { id: 'chamado-local', tecnicoResponsavelId: 'tecnico-local' }; } });
mock('../backend/repositories/cliente-repository', { getTecnicoPorId() { return tecnicoLocal; } });
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

test('cabeçalho prevalece e nome é confirmado no cadastro nativo', async () => {
  rows = [{ CDUSERANA: '124', STATUS_PROCESSO: '1', CODIGO_CABECALHO: '124', NOME_CABECALHO: 'Edson Assis', CABECALHO_HABILITADO: '1', CODIGO_ATIVIDADE: '35', NOME_ATIVIDADE: 'se Config', ATIVIDADE_HABILITADO: '1' }];
  assert.deepEqual(await source.resolverResponsavel({ chamado }), { codigo: '124', nome: 'Edson Assis', origem: 'cabecalho' });
  assert.deepEqual(calls.at(-1).params, { oidChamado: 'oid-pai', numeroChamado: '000123' });
  assert.equal(calls.at(-1).empresa, chamado.empresaId);
  rows = [];
});

test('formulário ainda sem código salvo usa o responsável da única atividade ativa', async () => {
  rows = [{ CDUSERANA: null, STATUS_PROCESSO: '1', IDSTRUCT: 'ATV-02', CODIGO_ATIVIDADE: '124', NOME_ATIVIDADE: 'Edson Assis', ATIVIDADE_HABILITADO: '1' }];
  assert.deepEqual(await source.resolverResponsavel({ chamado }), { codigo: '124', nome: 'Edson Assis', origem: 'atividade_atual', atividadeId: 'ATV-02' });
  rows = [];
});

test('responsável inválido, ausente, desabilitado ou ambíguo nunca vira a conta da API', async () => {
  for (const candidatos of [[], [{ STATUS_PROCESSO: '1', CDUSERANA: '124' }], [{ STATUS_PROCESSO: '1', CDUSERANA: null }], [{ STATUS_PROCESSO: '1', CDUSERANA: null, CODIGO_ATIVIDADE: '124', NOME_ATIVIDADE: 'Edson', ATIVIDADE_HABILITADO: '0' }], [{ STATUS_PROCESSO: '1' }, { STATUS_PROCESSO: '1' }], [{ STATUS_PROCESSO: '4' }]]) {
    rows = candidatos;
    await assert.rejects(source.resolverResponsavel({ chamado }), { status: 409 });
  }
  rows = [];
});

test('chat ocupado mantém sincronização pendente; ausência de atendimento permite atualização da base', async () => {
  rows = [{ CDUSERANA: '124', STATUS_PROCESSO: '1', CODIGO_CABECALHO: '124', NOME_CABECALHO: 'Edson Assis', CABECALHO_HABILITADO: '1' }];
  reconstruction = { reconstruido: false, motivo: 'turno_em_andamento' };
  await assert.rejects(source.sincronizar(chamado), /pendente/);
  reconstruction = { reconstruido: false, motivo: 'sem_atendimento' };
  await source.sincronizar(chamado);
  rows = [];
});

test('sincronização não confirma atualização com responsável ausente ou divergente na fila local', async () => {
  rows = [{ CDUSERANA: null, STATUS_PROCESSO: '1', IDSTRUCT: 'ATV-02', CODIGO_ATIVIDADE: '124', NOME_ATIVIDADE: 'Edson Assis', ATIVIDADE_HABILITADO: '1' }];
  await assert.rejects(source.sincronizar(chamado), /responsável do cabeçalho/);
  rows = [{ CDUSERANA: '124', STATUS_PROCESSO: '1', CODIGO_CABECALHO: '124', NOME_CABECALHO: 'Edson Assis', CABECALHO_HABILITADO: '1' }];
  for (const candidato of [null, { idOrigem: '35', sistemaOrigem: 'softexpert' }, { idOrigem: '124', sistemaOrigem: 'outro' }]) {
    tecnicoLocal = candidato;
    await assert.rejects(source.sincronizar(chamado), /responsável do cabeçalho/);
  }
  tecnicoLocal = { idOrigem: '124', sistemaOrigem: 'softexpert' };
  await source.sincronizar(chamado);
  rows = [];
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
