'use strict';

// Paginação por cursor, igual em todas as listas:
//   pedido:   ?limite=50&cursor=<texto opaco>
//   resposta: { "itens": [...], "proximo_cursor": "<texto>" | null, "total"?: n }
// O cursor é opaco para o cliente: só se repassa o que veio em proximo_cursor.

const { erro } = require('./erros');

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

function codificarCursor(valor) {
  return Buffer.from(JSON.stringify(valor), 'utf8').toString('base64url');
}

function decodificarCursor(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(Buffer.from(String(texto), 'base64url').toString('utf8'));
  } catch (_) {
    throw erro('requisicao_invalida', 'O cursor de paginação é inválido. Recarregue a lista.', { campos: { cursor: 'inválido' } });
  }
}

function lerPaginacao(query = {}) {
  let limite = LIMITE_PADRAO;
  if (query.limite !== undefined && query.limite !== '') {
    limite = Number(query.limite);
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      throw erro('requisicao_invalida', `O limite deve ser um número de 1 a ${LIMITE_MAXIMO}.`, { campos: { limite: 'fora da faixa' } });
    }
  }
  return { limite, cursor: decodificarCursor(query.cursor) };
}

// Recebe até limite+1 itens (o item extra só indica que há próxima página).
function montarPagina(itens, { limite, cursorDoUltimo, total } = {}) {
  const temMais = itens.length > limite;
  const pagina = temMais ? itens.slice(0, limite) : itens;
  const resposta = {
    itens: pagina,
    proximo_cursor: temMais && pagina.length ? codificarCursor(cursorDoUltimo(pagina[pagina.length - 1])) : null,
  };
  if (total !== undefined) resposta.total = total;
  return resposta;
}

module.exports = { LIMITE_PADRAO, LIMITE_MAXIMO, codificarCursor, decodificarCursor, lerPaginacao, montarPagina };
