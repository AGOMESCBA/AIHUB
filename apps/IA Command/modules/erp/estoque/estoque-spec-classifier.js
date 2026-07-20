'use strict';

const { FRAGMENTOS, ORDEM_FALLBACK } = require('./estoque-fragmentos-spec');

/**
 * Decide quais fragmentos de regrasTecnicas injetar no prompt, a partir da
 * mensagem do usuario. Retorna null (fallback total) quando nenhum fragmento
 * foi identificado.
 */
function classificarFragmentos(mensagem) {
  const texto = String(mensagem || '');
  if (!texto.trim()) return null;

  const acionados = new Set();

  for (const [chave, fragmento] of Object.entries(FRAGMENTOS)) {
    const bateuKeyword = (fragmento.keywords || []).some(regex => regex.test(texto));
    if (!bateuKeyword) continue;
    const bateuExclusao = (fragmento.excluiSe || []).some(regex => regex.test(texto));
    if (bateuExclusao) continue;
    acionados.add(chave);
  }

  if (acionados.size === 0) return null;

  for (const chave of Array.from(acionados)) {
    const fragmento = FRAGMENTOS[chave];
    for (const dependencia of fragmento.requerJunto || []) {
      acionados.add(dependencia);
    }
  }

  return ORDEM_FALLBACK.filter(chave => acionados.has(chave));
}

module.exports = { classificarFragmentos };
