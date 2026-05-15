const { createStub } = require('../NotImplementedBuilder');

// Stubs SAP Business One — substitua cada entrada pela implementação real quando necessário.
module.exports = {
  faturamento:    createStub('sap', 'faturamento'),
  financeiro:     createStub('sap', 'financeiro'),
  clientes:       createStub('sap', 'clientes'),
  produtos:       createStub('sap', 'produtos'),
  pedidos:        createStub('sap', 'pedidos'),
  pedidos_compra: createStub('sap', 'pedidos_compra'),
  compras:        createStub('sap', 'compras'),
};
