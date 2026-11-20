'use strict';

// Custo estimado de uma chamada de IA a partir do `usage` devolvido pelo
// provider e da tabela de preços em configuração (precos-modelos-ia.json).
// Só lê prompt_tokens/completion_tokens e prompt_tokens_details.cached_tokens
// (formato OpenAI-compat), os campos liberados na auditoria; sem preço ou sem
// contagem, o custo é null com o motivo, nunca um valor inventado.

const fs = require('fs');
const path = require('path');

const ARQUIVO_PRECOS = path.join(__dirname, 'precos-modelos-ia.json');

function carregarTabela(arquivo = ARQUIVO_PRECOS) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

function _precoDoModelo(tabela, provider, model) {
  const doProvider = tabela?.modelos?.[provider] || {};
  if (doProvider[model]) return doProvider[model];
  // Só versão datada do mesmo modelo (gpt-5.4-2026-03-05, claude-...-20251001);
  // gpt-4o-mini não é versão do gpt-4o.
  const base = String(model || '').replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '');
  return base !== model && doProvider[base] ? doProvider[base] : null;
}

function _contagem(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function estimarCusto({ provider, model, usage } = {}, tabela = carregarTabela()) {
  const tokensEntrada = _contagem(usage?.prompt_tokens);
  const tokensSaida = _contagem(usage?.completion_tokens);
  // Parte da entrada que veio do cache de prompt (2026-11-19): já contida em
  // prompt_tokens e cobrada pelo preço `entradaCache`. Ausente = sem cache.
  const tokensEntradaCache = Math.min(_contagem(usage?.prompt_tokens_details?.cached_tokens) ?? 0, tokensEntrada ?? 0);
  const base = { provider: provider || null, model: model || null, tokensEntrada, tokensEntradaCache, tokensSaida, moeda: tabela?.moeda || 'USD', custo: null };
  if (tokensEntrada === null || tokensSaida === null) return { ...base, motivo: 'sem_contagem_de_tokens' };
  const preco = _precoDoModelo(tabela, provider, model);
  if (!preco) return { ...base, motivo: 'modelo_sem_preco' };
  if (_contagem(preco.entrada) === null || _contagem(preco.saida) === null) return { ...base, motivo: 'sem_preco' };
  // Sem preço de cache informado, cobrar o cache pelo preço cheio daria um
  // valor errado: custo null com motivo, como nos demais casos sem preço.
  if (tokensEntradaCache > 0 && _contagem(preco.entradaCache) === null) return { ...base, motivo: 'sem_preco_cache' };
  const custo = ((tokensEntrada - tokensEntradaCache) * preco.entrada
    + tokensEntradaCache * (preco.entradaCache ?? 0)
    + tokensSaida * preco.saida) / 1e6;
  return { ...base, custo, motivo: null };
}

module.exports = { estimarCusto, carregarTabela, ARQUIVO_PRECOS };
