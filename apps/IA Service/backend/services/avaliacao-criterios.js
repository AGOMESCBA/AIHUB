// Definicao compartilhada dos 5 criterios de avaliacao humana (0-5) e sua
// validacao -- usado tanto pela gravacao real (avaliacao-investigacao-service.js)
// quanto pela pre-avaliacao sugerida por IA (pre-avaliacao-ia-service.js), para
// as duas nunca divergirem sobre o que e uma nota valida.

const NOTA_MIN = 0;
const NOTA_MAX = 5;

const CAMPOS_NOTA = ['compreensaoProblema', 'aproveitamentoEvidencias', 'profundidadeTecnica', 'orientacaoPratica', 'confiabilidadeTecnica'];

const ROTULOS_CRITERIO = {
  compreensaoProblema: 'Compreensão do problema',
  aproveitamentoEvidencias: 'Aproveitamento das evidências',
  profundidadeTecnica: 'Profundidade técnica',
  orientacaoPratica: 'Orientação prática',
  confiabilidadeTecnica: 'Confiabilidade técnica',
};

/**
 * Retorna true/false -- nunca lança. Usado pela pré-avaliação por IA, que
 * trata nota inválida como falha silenciosa (sem sugestão), nunca como erro
 * a propagar ao consultor.
 */
function notasValidas(notas) {
  if (!notas || typeof notas !== 'object') return false;
  return CAMPOS_NOTA.every(campo => {
    const valor = notas[campo];
    return Number.isInteger(valor) && valor >= NOTA_MIN && valor <= NOTA_MAX;
  });
}

module.exports = { NOTA_MIN, NOTA_MAX, CAMPOS_NOTA, ROTULOS_CRITERIO, notasValidas };
