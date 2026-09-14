'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const connectionFactoryPath = require.resolve(path.join(ROOT, 'modules/erp/providers/connection-factory'));
const originalConnectionFactory = require.cache[connectionFactoryPath];
require.cache[connectionFactoryPath] = {
  id: connectionFactoryPath,
  filename: connectionFactoryPath,
  loaded: true,
  exports: {
    carregarConexao() {
      return { id: 123 };
    },
  },
};

const filialResolver = require(path.join(ROOT, 'modules/erp/totvs_protheus/SX/lobo-guara-filial-resolver'));

function dbTradicionalComArvoreValidada() {
  return {
    prepare(sql) {
      return {
        get() {
          if (/FROM protheus_company_profile/i.test(sql)) return { validated: 1 };
          if (/FROM protheus_company_tree/i.test(sql)) return { ok: 1 };
          if (/FROM erp_config/i.test(sql)) {
            return { config: JSON.stringify({ modelo_dados: 'TRADICIONAL', empresa_codigo: '01' }) };
          }
          return null;
        },
      };
    },
  };
}

try {
  const ctx = filialResolver.contextoLoboGuara(dbTradicionalComArvoreValidada(), 3);
  assert.deepStrictEqual(
    ctx,
    { connectionId: 123, empresaCodigoPadrao: '01' },
    'empresa TRADICIONAL com arvore validada tambem deve permitir selecao de filial',
  );
} finally {
  if (originalConnectionFactory) {
    require.cache[connectionFactoryPath] = originalConnectionFactory;
  } else {
    delete require.cache[connectionFactoryPath];
  }
}

console.log('lobo-guara-filial-resolver-tree.test.js: ok');
