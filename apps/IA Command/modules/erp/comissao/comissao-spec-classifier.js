'use strict';

const { FRAGMENTOS, ORDEM_FALLBACK } = require('./comissao-fragmentos-spec');

/**
 * Decide quais fragmentos de regrasTecnicas injetar no prompt, a partir da
 * mensagem do usuario. Retorna null (fallback total, injeta TODOS os
 * fragmentos) somente quando a mensagem esta vazia/sem texto util — sinal de
 * que o sistema nao tem nenhuma pista sobre a pergunta e deve dar a IA o
 * maximo de contexto possivel.
 *
 * Quando a mensagem tem texto mas nao aciona nenhum fragmento de ASSUNTO
 * (ex: "qual minha comissao do mes?" — pergunta generica, sem qualificador de
 * status/pagamento/media/crescimento/comparativo), retorna array só com os
 * fragmentos `sempre: true` (ex: identidade_vendedor) — a base() do spec
 * principal ja cobre consulta simples de carteira, sem precisar dos 9
 * fragmentos opcionais.
 *
 * Fragmentos marcados como `sempre: true` (ex: identidade_vendedor, seguranca)
 * sao incluidos em toda chamada, independente do classificador.
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

  // Mensagem com texto mas nenhum fragmento de assunto bateu: usa so a base()
  // (via array contendo apenas os fragmentos "sempre"), nao o fallback total.
  const apenasSempre = [...acionados].every(chave => FRAGMENTOS[chave]?.sempre);
  if (apenasSempre) return ORDEM_FALLBACK.filter(chave => acionados.has(chave));

  for (const chave of Array.from(acionados)) {
    const fragmento = FRAGMENTOS[chave];
    for (const dependencia of fragmento.requerJunto || []) {
      acionados.add(dependencia);
    }
  }

  return ORDEM_FALLBACK.filter(chave => acionados.has(chave));
}

module.exports = { classificarFragmentos };
