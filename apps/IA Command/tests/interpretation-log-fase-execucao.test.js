'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { faseExecucao } = require(path.join(ROOT, 'modules/ai/interpretation-log'));

assert.strictEqual(
  faseExecucao({ resultado: { tipo: 'sucesso_ai_sql', sql_gerado: 'SELECT 1' } }),
  'execucao_normal',
  'sucesso com SQL deve ser classificado como execucao normal',
);

assert.strictEqual(
  faseExecucao({
    resultado: {
      tipo: 'erro',
      subtipo: 'resultado_invalido_roteador',
      _diagnostico_tecnico: { codigo: 'resultado_invalido_roteador' },
    },
  }),
  'pre_execucao_tecnica',
  'erro com diagnostico tecnico antes do SQL deve ser pre-execucao tecnica',
);

assert.strictEqual(
  faseExecucao({ resultado: { tipo: 'pergunta_entidade' } }),
  'sem_execucao',
  'fluxos sem SQL e sem anomalia tecnica devem ficar como sem execucao',
);

assert.strictEqual(
  faseExecucao({ fase_execucao: 'pre_execucao_tecnica', resultado: { tipo: 'sucesso_ai_sql' } }),
  'pre_execucao_tecnica',
  'valor explicito do payload deve prevalecer',
);

console.log('interpretation-log-fase-execucao.test.js: ok');
