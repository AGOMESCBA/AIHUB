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

async function capturarSql(opcoes) {
  const originalSelect = agenteLocalService.executarSelectNaFonte;
  const originalCfg = config.leituraAnexosHabilitada;
  let sql = '';
  agenteLocalService.executarSelectNaFonte = async (_e, _f, req) => { sql = req.sql; return []; };
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
  assert.equal((sql.match(/NULL AS FLDATA/g) || []).length, 4);
  assert.equal((sql.match(/B\.NRSIZE/g) || []).length, 4, 'nome, extensão e tamanho continuam vindo');
});

test('download/sincronização (padrão) continuam trazendo o conteúdo', async () => {
  const sql = await capturarSql(undefined);
  assert.equal((sql.match(/B\.FLDATA/g) || []).length, 4);
  assert.doesNotMatch(sql, /NULL AS FLDATA/);
});
