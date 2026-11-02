'use strict';
// Regressao 2026-10-26: abrir um chamado no J2A ficava lento porque a listagem
// de anexos do SoftExpert trazia o BINARIO de todos os arquivos (SEBLOB.FLDATA)
// pelo Agente Local so para mostrar nomes. A listagem pede so metadados; o
// download e a sincronizacao continuam pedindo o conteudo.
// Sem rede: o Agente Local e simulado e a SQL enviada e inspecionada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const agenteLocalService = require('../backend/services/agente-local-service');
const config = require('../backend/services/retorno-softexpert-config');
const adapter = require('../backend/services/import/softexpert-sqlserver-adapter');

async function capturarSql(opcoes, aoExecutar = () => {}) {
  const originalSelect = agenteLocalService.executarSelectNaFonte;
  const originalCfg = config.leituraAnexosHabilitada;
  let sql = '';
  agenteLocalService.executarSelectNaFonte = async (_e, _f, req) => { sql = req.sql; aoExecutar(req); return []; };
  config.leituraAnexosHabilitada = () => true; // inclui as 4 origens de anexo
  try {
    await adapter.listarAnexosDoChamado(1, { id: 'f1' }, '036596', opcoes);
  } finally {
    agenteLocalService.executarSelectNaFonte = originalSelect;
    config.leituraAnexosHabilitada = originalCfg;
  }
  return sql;
}

test('listagem só de metadados não pede o binário em nenhuma das origens', async () => {
  const sql = await capturarSql({ comConteudo: false });
  assert.doesNotMatch(sql, /B\.FLDATA/);
  assert.equal((sql.match(/NULL AS FLDATA/g) || []).length, 5);
  assert.equal((sql.match(/B\.NRSIZE/g) || []).length, 4, 'nome, extensão e tamanho continuam vindo');
});

test('download/sincronização (padrão) continuam trazendo o conteúdo', async () => {
  const sql = await capturarSql(undefined);
  assert.equal((sql.match(/B\.FLDATA/g) || []).length, 4);
  assert.match(sql, /F\.FLFILE AS FLDATA/);
  assert.doesNotMatch(sql, /NULL AS FLDATA/);
  assert.doesNotMatch(sql, /@oid/);
});

test('a consulta inclui os anexos do workflow e não usa termo bloqueado pelo Agente Local', async () => {
  // Lista de _BLOCKED_KEYWORDS em agente-local/modules/erp_executor.py: comparação
  // por texto, então "DTINSERT AS" seria recusado em produção.
  const bloqueados = ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'TRUNCATE ', 'ALTER ', 'CREATE ', 'EXEC ', 'EXECUTE ', 'SP_', 'XP_', 'OPENROWSET'];
  for (const opcoes of [{ comConteudo: false }, undefined, { oid: 'wf-1' }]) {
    const sql = (await capturarSql(opcoes)).toUpperCase();
    assert.match(sql, /WFPROCATTACHMENT/);
    for (const termo of bloqueados) assert.equal(sql.includes(termo), false, `termo bloqueado: ${termo}`);
  }
});

test('filtro por arquivo também vale para a origem workflow', async () => {
  const sql = await capturarSql({ oid: 'wf-1' });
  assert.match(sql, /'wf-' \+ CAST\(F\.CDFILE AS varchar\(20\)\) = @oid/);
});

test('OID fora do formato é recusado sem consultar a origem', async () => {
  const servico = require('../backend/services/anexos-softexpert-service');
  const originalSelect = agenteLocalService.executarSelectNaFonte;
  let consultas = 0;
  agenteLocalService.executarSelectNaFonte = async () => { consultas += 1; return []; };
  try {
    for (const oid of ["x' OR '1'='1", 'a b', 'a;DROP', '@idProcess', 'a'.repeat(129)]) {
      await assert.rejects(servico.baixarAnexo(1, 'c1', oid), /Anexo não encontrado/);
    }
  } finally {
    agenteLocalService.executarSelectNaFonte = originalSelect;
  }
  assert.equal(consultas, 0);
});

test('download de um anexo pede só aquele arquivo, nas 4 origens e dentro do chamado', async () => {
  let req;
  const sql = await capturarSql({ oid: 'abc' }, (r) => { req = r; });
  assert.equal((sql.match(/AND B\.OID = @oid/g) || []).length, 4);
  assert.equal((sql.match(/= @idProcess AND B\.OID = @oid/g) || []).length, 4);
  assert.deepEqual(req.params, { idProcess: '036596', oid: 'abc' });
  assert.equal(req.limit, 1);
});
