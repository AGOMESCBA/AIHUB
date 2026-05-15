const { createStub } = require('../NotImplementedBuilder');

// Stubs MXM Sistemas — substitua cada entrada pela implementação real quando necessário.
module.exports = {
  faturamento:    createStub('mxm', 'faturamento'),
  financeiro:     createStub('mxm', 'financeiro'),
  clientes:       createStub('mxm', 'clientes'),
  produtos:       createStub('mxm', 'produtos'),
  pedidos:        createStub('mxm', 'pedidos'),
  pedidos_compra: createStub('mxm', 'pedidos_compra'),
  compras:        createStub('mxm', 'compras'),
};
