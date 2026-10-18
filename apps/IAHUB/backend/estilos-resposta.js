'use strict';

// Estilos disponíveis: ORIGINAL ("Técnica", sem humanização) e NATURAL
// ("Objetiva"). DIRETO e DESCONTRAIDO foram descontinuados em 2026-10:
// preferências já salvas com esses valores passam a valer como NATURAL.
const ESTILOS = Object.freeze(['ORIGINAL', 'NATURAL']);
const ESTILOS_DESCONTINUADOS = Object.freeze({ DIRETO: 'NATURAL', DESCONTRAIDO: 'NATURAL' });

function normalizarEstilo(valor) {
  if (ESTILOS.includes(valor)) return valor;
  return ESTILOS_DESCONTINUADOS[valor] || 'ORIGINAL';
}

function validarEstilo(valor) {
  if (ESTILOS.includes(valor)) return valor;
  if (ESTILOS_DESCONTINUADOS[valor]) return ESTILOS_DESCONTINUADOS[valor];
  const erro = new Error('Estilo da resposta inválido.');
  erro.status = 400;
  throw erro;
}

module.exports = { ESTILOS, normalizarEstilo, validarEstilo };
