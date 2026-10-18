'use strict';

const ESTILOS = Object.freeze(['ORIGINAL', 'NATURAL', 'DIRETO', 'DESCONTRAIDO']);

function normalizarEstilo(valor) {
  return ESTILOS.includes(valor) ? valor : 'ORIGINAL';
}

function validarEstilo(valor) {
  if (!ESTILOS.includes(valor)) {
    const erro = new Error('Estilo da resposta inválido.');
    erro.status = 400;
    throw erro;
  }
  return valor;
}

module.exports = { ESTILOS, normalizarEstilo, validarEstilo };
