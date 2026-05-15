const { createStub } = require('../NotImplementedBuilder');

// Stubs Sankhya — substitua cada entrada pela implementação real quando necessário.
module.exports = {
  faturamento:    createStub('sankhya', 'faturamento'),
  financeiro:     createStub('sankhya', 'financeiro'),
  clientes:       createStub('sankhya', 'clientes'),
  produtos:       createStub('sankhya', 'produtos'),
  pedidos:        createStub('sankhya', 'pedidos'),
  pedidos_compra: createStub('sankhya', 'pedidos_compra'),
  compras:        createStub('sankhya', 'compras'),
};
