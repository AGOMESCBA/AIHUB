'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _montarQuadroInvestigativo } = require('../backend/services/context-engine');

function quadro(conteudo) {
  const abertura = { id: 'abertura', papel: 'customer', conteudo: 'Falha ao baixar requisição de almoxarifado.' };
  const mensagem = { id: 'analista', papel: 'user', conteudo };
  return _montarQuadroInvestigativo({
    atendimento: { conteudoBruto: abertura.conteudo },
    chamado: { produto: 'Protheus', modulo: 'Estoque' },
    mensagens: [abertura, mensagem], mensagemAtual: '',
    selecionadosEfetivos: [abertura, mensagem].map(m => ({ tipo: 'mensagem', id: m.id, texto: m.conteudo, ref: m })),
  });
}

test('solicitação de compras com validação de campos não inventa teste solicitado', () => {
  const q = quadro('Erro nas baixas de almoxarifado e inclusão de solicitação de compras. Favor olhar nos chamados anteriores, parece ter a ver com a validação de campos conta contábil e centro de custo, mesmo erro do pedido de compras.');
  assert.equal(q.estadoOperacional, 'triagem_investigativa');
});

for (const texto of [
  'Solicitei o teste em homologação.',
  'Foi solicitada a validação em homologação.',
  'Solicitamos validar a baixa em homologação.',
  'Aguardando confirmação da validação da baixa.',
]) {
  test('preserva validação efetivamente pedida: ' + texto, () => {
    assert.equal(quadro(texto).estadoOperacional, 'validacao_solicitada_ou_aguardando_confirmacao');
  });
}
