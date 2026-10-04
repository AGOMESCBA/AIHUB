'use strict';

// Lock leve EM MEMÓRIA, por atendimento (chave empresaId+atendimentoId) —
// não por usuário. Existe para resolver duplo-clique/refresh/retry HTTP
// gerando duas investigações reais simultâneas do MESMO atendimento, sem
// bloquear o usuário de processar outros atendimentos ao mesmo tempo
// (achado real, 2026-10: o único bloqueio existente era uma flag `enviando`
// global no frontend — o backend nunca teve nenhum lock, então já suportava
// paralelismo entre atendimentos diferentes; faltava só esta proteção
// pontual de "mesmo atendimento, duas chamadas concorrentes").
//
// Escopo deliberadamente mínimo: um `Set` de chaves em processamento, sem
// fila/retry/timeout automático — se a chave já está presente, a segunda
// chamada é rejeitada imediatamente (HTTP 409), o cliente decide se tenta de
// novo. Não precisa sobreviver a restart do processo (perder o lock após um
// redeploy é seguro: na pior hipótese uma segunda chamada real é aceita,
// nunca o contrário).
const emProcessamento = new Set();

function _chave(empresaId, atendimentoId) {
  return `${empresaId}:${atendimentoId}`;
}

function tentarAdquirir(empresaId, atendimentoId) {
  const chave = _chave(empresaId, atendimentoId);
  if (emProcessamento.has(chave)) return false;
  emProcessamento.add(chave);
  return true;
}

function liberar(empresaId, atendimentoId) {
  emProcessamento.delete(_chave(empresaId, atendimentoId));
}

function estaProcessando(empresaId, atendimentoId) {
  return emProcessamento.has(_chave(empresaId, atendimentoId));
}

module.exports = { tentarAdquirir, liberar, estaProcessando };
