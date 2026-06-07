'use strict';

const TERMOS_NOVO_ASSUNTO = [
  'nova consulta', 'nova pesquisa', 'nova pergunta',
  'novo assunto', 'outro assunto', 'outra consulta',
  'esquece', 'esquece isso', 'esquece tudo',
  'ignora', 'ignora anterior',
  'cancelar', 'cancelar consulta',
  'comecar do zero', 'reiniciar',
  'nova conversa', 'recomecar',
  'reset', 'resetar',
];

const _INTENCOES_DOMINIO = /\b(faturamento|vendas|compras|estoque|financeiro|comiss[aã]o|inadimpl[eê]ncia|receber|pagar)\b/i;

function _normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const _TERMOS_NORMALIZADOS = TERMOS_NOVO_ASSUNTO.map(_normalizar);

/**
 * Retorna true quando a mensagem indica claramente que o usuario quer
 * descartar o contexto anterior e iniciar uma nova consulta do zero.
 * So casa no inicio da mensagem ou como match exato, evitando falsos
 * positivos em queries como "pedidos que podem cancelar automaticamente".
 */
function isNewSubject(mensagem) {
  const m = _normalizar(mensagem);
  if (!m) return false;
  return _TERMOS_NORMALIZADOS.some(tn => m === tn || m.startsWith(tn + ' '));
}

/**
 * Retorna true quando a mensagem e um refinamento da consulta anterior.
 * Usa conectores e dimensoes exportados do intent-merger (sem duplicacao).
 */
function isContextualQuestion(mensagem) {
  if (!mensagem) return false;

  const { detectarContinuacao, DIMENSOES } = require('./intent-merger');

  if (detectarContinuacao(mensagem)) return true;

  const m = _normalizar(mensagem);
  const palavras = m.split(/\s+/).filter(Boolean);
  if (
    palavras.length < 6 &&
    !_INTENCOES_DOMINIO.test(mensagem) &&
    DIMENSOES.some(([, regex]) => regex.test(mensagem))
  ) {
    return true;
  }

  return false;
}

module.exports = { isNewSubject, isContextualQuestion };