'use strict';

// Regras do canal (um ponto só para tela, API, fila, recebimento e linha de comando):
//   envio_modo:       desligado | teste (só a lista de teste) | qualquer
//   recebimento_modo: teste (só a lista grava; das demais, só a contagem) | todos
// Separadas de propósito: dá para enviar para qualquer número sem gravar as
// conversas de outros sistemas que usam o mesmo número (ex.: IA Command no …1752).

const telefone = require('../seguranca/telefone');

const ENVIO_MODOS = Object.freeze(['desligado', 'teste', 'qualquer']);
const RECEBIMENTO_MODOS = Object.freeze(['teste', 'todos']);

const listaDeTeste = (canal) => JSON.parse(canal.numeros_teste || '[]');
const naListaDeTeste = (canal, numero) => listaDeTeste(canal).some(n => telefone.mesmoNumero(n, numero));

// Destino aceito pela regra de envio (não olha se o envio está ligado).
const podeEnviarPara = (canal, numero) => canal.envio_modo === 'qualquer' || naListaDeTeste(canal, numero);
const aceitaRecebidaDe = (canal, numero) => canal.recebimento_modo === 'todos' || naListaDeTeste(canal, numero);

// Campos antigos (envio_habilitado, modo_teste) ainda aceitos na entrada, traduzidos.
function traduzirLegado(atual, { envio_habilitado: envio, modo_teste: modo } = {}) {
  let envioModo = atual.envio_modo;
  let recebimentoModo = atual.recebimento_modo;
  if (modo !== undefined) {
    recebimentoModo = modo ? 'teste' : 'todos';
    if (envioModo !== 'desligado') envioModo = modo ? 'teste' : 'qualquer';
  }
  if (envio !== undefined) envioModo = envio ? (envioModo === 'desligado' ? (recebimentoModo === 'todos' ? 'qualquer' : 'teste') : envioModo) : 'desligado';
  return { envio_modo: envioModo, recebimento_modo: recebimentoModo };
}

const TEXTOS = Object.freeze({
  envio: { desligado: 'desligado', teste: 'só números de teste', qualquer: 'qualquer número' },
  recebimento: { teste: 'só números de teste', todos: 'todos os números' },
});

module.exports = { ENVIO_MODOS, RECEBIMENTO_MODOS, listaDeTeste, naListaDeTeste, podeEnviarPara, aceitaRecebidaDe, traduzirLegado, TEXTOS };
