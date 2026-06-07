'use strict';

const runner = require('./module-runner');

module.exports = {
  executar: runner.executar,
  executarSqlDireto: runner.executarSqlDireto,
  _test: runner._test,
};
