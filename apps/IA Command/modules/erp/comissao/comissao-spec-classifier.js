'use strict';

const { FRAGMENTOS, ORDEM_FALLBACK } = require('./comissao-fragmentos-spec');

/**
 * Decide quais fragmentos de regrasTecnicas injetar no prompt, a partir da
 * mensagem do usuario. Retorna null (fallback total) quando nenhum fragmento
 * de ASSUNTO foi identificado — fragmentos marcados como `sempre: true`
 * (ex: identidade_vendedor, seguranca) sao incluidos em toda chamada,
 * independente do classificador.
 */
function classificarFragmentos(mensagem) {
  const texto = String(mensagem || '');
  const acionados = new Set();

  for (const [chave, fragmento] of Object.entries(FRAGMENTOS)) {
    if (fragmento.sempre) acionados.add(chave);
  }

  if (texto.trim()) {
    for (const [chave, fragmento] of Object.entries(FRAGMENTOS)) {
      if (fragmento.sempre) continue;
      const bateuKeyword = (fragmento.keywords || []).some(regex => regex.test(texto));
      if (!bateuKeyword) continue;
      const bateuExclusao = (fragmento.excluiSe || []).some(regex => regex.test(texto));
      if (bateuExclusao) continue;
      acionados.add(chave);
    }
  }

  // Se nada alem dos fragmentos "sempre" foi acionado, sinaliza fallback total
  // (mesma semantica dos outros modulos: null = injeta tudo).
  const apenasSempre = [...acionados].every(chave => FRAGMENTOS[chave]?.sempre);
  if (apenasSempre) return null;

  for (const chave of Array.from(acionados)) {
    const fragmento = FRAGMENTOS[chave];
    for (const dependencia of fragmento.requerJunto || []) {
      acionados.add(dependencia);
    }
  }

  return ORDEM_FALLBACK.filter(chave => acionados.has(chave));
}

module.exports = { classificarFragmentos };
