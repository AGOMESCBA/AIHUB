'use strict';

function _normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Padroes de reconhecimento por modulo
const PADROES_MODULO = {
  faturamento: /\b(faturamento|vendas?)\b/,
  compras:     /\b(compras?)\b/,
  financeiro:  /\b(financeiro|contas?\s+a\s+pagar|contas?\s+a\s+receber)\b/,
  comissao:    /\b(comissao|comissoes)\b/,
};

/**
 * Retorna lista de modulos mencionados na mensagem.
 */
function detectarModulos(mensagem) {
  const texto = _normalizar(mensagem);
  return Object.entries(PADROES_MODULO)
    .filter(([, re]) => re.test(texto))
    .map(([modulo]) => modulo);
}

/**
 * Retorna { ehCross: boolean, modulos: string[] }.
 * ehCross e true sempre que a mensagem menciona palavras de 2+ modulos.
 * A IA recebe o contexto tecnico combinado e decide o que fazer — sem restricao de intencao.
 */
function ehCrossModule(mensagem) {
  const modulos = detectarModulos(mensagem);
  return { ehCross: modulos.length >= 2, modulos };
}

module.exports = { ehCrossModule, detectarModulos };
