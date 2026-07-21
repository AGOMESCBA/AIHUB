'use strict';

const iaOwner = require('../../ia-owner/runner');
const spec = require('./compras-ia-owner-spec');

async function executar(intent, empresaId) {
  return iaOwner.executar(spec, intent, empresaId);
}

async function executarSqlDireto(sqlCanonico, intent, empresaId) {
  return iaOwner.executarSqlDireto(spec, sqlCanonico, intent, empresaId);
}

function garantirIntencao(empresaId) {
  return spec.garantirIntencao(empresaId);
}

module.exports = {
  executar,
  executarSqlDireto,
  garantirIntencao,
};
