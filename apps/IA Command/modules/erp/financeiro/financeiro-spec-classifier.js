'use strict';

const { FRAGMENTOS, ORDEM_FALLBACK } = require('./financeiro-fragmentos-spec');

/**
 * Decide quais fragmentos de regrasTecnicas injetar no prompt, a partir da
 * mensagem do usuario.
 *
 * Retorna null quando nenhum fragmento foi identificado — sinal para o
 * chamador injetar TODOS os fragmentos (fallback = comportamento anterior
 * a fragmentacao, sem regressao).
 *
 * @returns {string[] | null} chaves de FRAGMENTOS a injetar, ou null para fallback total.
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

  // Resolve requerJunto (ex: fluxo_caixa_projetado exige saldo_bancario + receber_posicao + pagar_posicao)
  for (const chave of Array.from(acionados)) {
    const fragmento = FRAGMENTOS[chave];
    for (const dependencia of fragmento.requerJunto || []) {
      acionados.add(dependencia);
    }
  }

  // Preserva ordem estavel (mesma ordem de ORDEM_FALLBACK) para prompt deterministico
  return ORDEM_FALLBACK.filter(chave => acionados.has(chave));
}

module.exports = { classificarFragmentos };
