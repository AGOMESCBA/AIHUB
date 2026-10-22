'use strict';

// Limpeza automática e conservadora da resposta Técnica (sem IA) — pedido do
// usuário, 2026-10-22: tirar só o que comprovadamente não tem conteúdo
// técnico novo, "com muito cuidado para não perdermos a qualidade técnica".
//
//  1. Lista final "Próximos passos"/"Resumo" que só REPETE o corpo: sai apenas
//     se TODOS os itens já estão no corpo (todas as referências técnicas do
//     item aparecem no corpo e quase todas as palavras relevantes também).
//     Um único item com algo novo mantém a seção inteira.
//  2. Fecho genérico no fim ("estou à disposição", "essas ações devem
//     ajudar"): mesma rotina da Objetiva (validacao-preservacao-service).
//
// Não atua em resposta com bloco de código ou proposta de alteração de fonte.
// O que for removido volta para a auditoria da mensagem.

const { referencias, limparConclusaoGenerica } = require('./validacao-preservacao-service');

const TITULO_RESUMO = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:pr[oó]ximos\s+passos|resumo(?:\s+dos\s+pr[oó]ximos\s+passos)?|em\s+resumo)\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/i;
const ITEM_LISTA = /^\s*(?:[-*•]|\d+[.)])\s+/;
const GENERICAS = new Set(['para', 'pelo', 'pela', 'com', 'sem', 'que', 'dos', 'das', 'nos', 'nas', 'uma', 'uns', 'umas', 'mais', 'se', 'ou', 'e', 'de', 'do', 'da', 'em', 'no', 'na', 'os', 'as', 'ao', 'aos', 'sistema', 'necessario', 'corretamente', 'correto', 'corretos', 'correta', 'verifique', 'verificar', 'confirme', 'confirmar', 'certifique', 'revise', 'revisar', 'ajuste', 'ajustar', 'possiveis', 'possivel', 'adicionais', 'adicional', 'garantir', 'todos', 'todas', 'estao', 'esta']);

function _normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function _palavras(texto) {
  return [...new Set((_normalizar(texto).replace(/\*\*/g, '').match(/[a-z][a-z0-9_]{3,}/g) || [])
    .filter(p => !GENERICAS.has(p))
    .map(p => p.slice(0, 6)))];
}

// Item já contido no corpo: todas as referências técnicas presentes e ao menos
// 80% das palavras relevantes (radical de 6 letras) presentes.
function _itemRedundante(item, corpo) {
  const refsCorpo = referencias(corpo);
  for (const r of referencias(item)) if (!refsCorpo.has(r)) return false;
  const palavrasItem = _palavras(item);
  if (!palavrasItem.length) return true;
  const corpoNorm = _normalizar(corpo);
  const presentes = palavrasItem.filter(p => corpoNorm.includes(p)).length;
  return presentes / palavrasItem.length >= 0.8;
}

function _removerResumoRepetido(texto) {
  const linhas = texto.split('\n');
  let titulo = -1;
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (TITULO_RESUMO.test(linhas[i])) { titulo = i; break; }
  }
  if (titulo <= 0) return null;
  const secao = linhas.slice(titulo + 1);
  const itens = secao.filter(l => l.trim());
  // Só lista pura (sem parágrafo, sem outro título depois).
  if (!itens.length || !itens.every(l => ITEM_LISTA.test(l))) return null;
  const corpo = linhas.slice(0, titulo).join('\n');
  if (!corpo.trim() || !itens.every(item => _itemRedundante(item.replace(ITEM_LISTA, ''), corpo))) return null;
  return { texto: corpo.replace(/\s+$/, ''), removido: linhas.slice(titulo).join('\n').trim() };
}

function limparTecnica(texto) {
  const original = String(texto || '');
  if (!original.trim() || /```|\[\[ORIGINAL\]\]|\[\[ALTERADO\]\]/.test(original)) return { texto: original, removidos: [] };
  const removidos = [];
  let atual = original.replace(/\s+$/, '');
  // Fecho genérico antes e depois da lista final (pode estar em qualquer lado).
  const fecho1 = limparConclusaoGenerica(atual);
  if (fecho1.removidas.length) { removidos.push(...fecho1.removidas.map(t => ({ tipo: 'conclusao_generica', texto: t }))); atual = fecho1.texto; }
  const resumo = _removerResumoRepetido(atual);
  if (resumo) { removidos.push({ tipo: 'resumo_repetido', texto: resumo.removido }); atual = resumo.texto; }
  const fecho2 = limparConclusaoGenerica(atual);
  if (fecho2.removidas.length) { removidos.push(...fecho2.removidas.map(t => ({ tipo: 'conclusao_generica', texto: t }))); atual = fecho2.texto; }
  return removidos.length ? { texto: atual, removidos } : { texto: original, removidos: [] };
}

module.exports = { limparTecnica, _itemRedundante };
