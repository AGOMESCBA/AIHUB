const { createStub } = require('../NotImplementedBuilder');

// Stubs Senior Sistemas — substitua cada entrada pela implementação real quando necessário.
module.exports = {
  faturamento:    createStub('senior', 'faturamento'),
  financeiro:     createStub('senior', 'financeiro'),
  clientes:       createStub('senior', 'clientes'),
  produtos:       createStub('senior', 'produtos'),
  pedidos:        createStub('senior', 'pedidos'),
  pedidos_compra: createStub('senior', 'pedidos_compra'),
  compras:        createStub('senior', 'compras'),
};
