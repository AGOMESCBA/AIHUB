const QueryBuilder = require('../base/QueryBuilder');

/**
 * Stub base para ERPs ainda não implementados.
 * createStub(erp, modulo) gera uma classe que lança erro descritivo ao ser usada.
 */
function createStub(erp, modulo) {
  return class extends QueryBuilder {
    constructor(conexao) {
      super(conexao);
    }

    build() {
      throw new Error(
        `O módulo "${modulo}" para o ERP "${erp}" ainda não está implementado. ` +
        `Crie a classe em query-builders/erp/${erp}/index.js e registre-a no erp-registry.js.`
      );
    }
  };
}

module.exports = { createStub };
