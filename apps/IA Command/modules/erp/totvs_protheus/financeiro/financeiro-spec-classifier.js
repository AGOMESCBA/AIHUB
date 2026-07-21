'use strict';

const { FRAGMENTOS, ORDEM_FALLBACK } = require('./financeiro-fragmentos-spec');

/**
 * Decide quais fragmentos de regrasTecnicas injetar no prompt, a partir da
 * mensagem do usuario.
 *
 * Retorna null quando a mensagem esta vazia — sinal para o chamador injetar
 * TODOS os fragmentos (fallback = comportamento anterior a fragmentacao, sem
 * regressao).
 *
 * Fragmentos marcados como `sempre: true` (ex: identidade_vendedor, regra de
 * seguranca) sao incluidos em toda chamada com mensagem nao vazia,
 * independente de keywords — mesmo mecanismo usado em comissao-spec-classifier.js.
 *
 * @returns {string[] | null} chaves de FRAGMENTOS a injetar, ou null para fallback total.
 */
function classificarFragmentos(mensagem) {
  const texto = String(mensagem || '');
  const acionados = new Set();

  for (const [chave, fragmento] of Object.entries(FRAGMENTOS)) {
    if (fragmento.sempre) acionados.add(chave);
  }

  if (!texto.trim()) return null;

  for (const [chave, fragmento] of Object.entries(FRAGMENTOS)) {
    if (fragmento.sempre) continue;
    const bateuKeyword = (fragmento.keywords || []).some(regex => regex.test(texto));
    if (!bateuKeyword) continue;
    const bateuExclusao = (fragmento.excluiSe || []).some(regex => regex.test(texto));
    if (bateuExclusao) continue;
    acionados.add(chave);
  }

  // Mensagem com texto mas nenhum fragmento de assunto bateu: usa so os
  // fragmentos "sempre" (nao o fallback total de todos os fragmentos).
  const apenasSempre = [...acionados].every(chave => FRAGMENTOS[chave]?.sempre);
  if (apenasSempre) return ORDEM_FALLBACK.filter(chave => acionados.has(chave));

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
