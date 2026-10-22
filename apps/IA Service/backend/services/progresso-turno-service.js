'use strict';

// Andamento do turno de investigação, EM MEMÓRIA, por atendimento (chave
// empresaId+atendimentoId), para o chat mostrar as etapas enquanto a IA
// trabalha (pedido do usuário, 2026-10-21). Mesmo padrão do turno-lock-service:
// não precisa sobreviver a restart — sem registro, o chat só mostra o texto
// genérico de "pesquisando". Guarda apenas textos curtos de etapa (sem
// conteúdo do chamado além dos termos de busca) e expira sozinho.
const TTL_MS = 10 * 60 * 1000;
const MAX_ETAPAS = 12;
const progresso = new Map();

function _chave(empresaId, atendimentoId) {
  return `${empresaId}:${atendimentoId}`;
}

function _limparExpirados(agora = Date.now()) {
  for (const [chave, p] of progresso) if (agora - p.atualizadoEm > TTL_MS) progresso.delete(chave);
}

function iniciar(empresaId, atendimentoId) {
  _limparExpirados();
  progresso.set(_chave(empresaId, atendimentoId), { etapas: [], atualizadoEm: Date.now() });
}

// Conclui a etapa em andamento e abre a próxima (concluida=false = em andamento).
function registrar(empresaId, atendimentoId, texto, { concluida = false } = {}) {
  const p = progresso.get(_chave(empresaId, atendimentoId));
  if (!p || !texto) return;
  for (const e of p.etapas) e.concluida = true;
  p.etapas.push({ texto: String(texto).slice(0, 160), concluida });
  if (p.etapas.length > MAX_ETAPAS) p.etapas.splice(0, p.etapas.length - MAX_ETAPAS);
  p.atualizadoEm = Date.now();
}

function finalizar(empresaId, atendimentoId) {
  progresso.delete(_chave(empresaId, atendimentoId));
}

function obter(empresaId, atendimentoId) {
  const p = progresso.get(_chave(empresaId, atendimentoId));
  if (!p || Date.now() - p.atualizadoEm > TTL_MS) return { etapas: [] };
  return { etapas: p.etapas.map(e => ({ ...e })) };
}

// Callback curto para os serviços (pesquisa etc.) sem conhecerem a chave.
function reporter(empresaId, atendimentoId) {
  return (texto, opts) => registrar(empresaId, atendimentoId, texto, opts);
}

module.exports = { iniciar, registrar, finalizar, obter, reporter };
