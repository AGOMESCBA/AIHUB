// Pre-avaliacao por IA da propria resposta investigativa -- sugestao inicial
// para reduzir o esforco manual do consultor no modal de Avaliacao Humana
// (avaliacao-investigacao-service.js). NUNCA persiste nada: so devolve uma
// sugestao de notas/observacao para o consultor confirmar ou corrigir antes
// de salvar. A gravacao real continua exclusivamente via
// avaliacaoInvestigacaoService.avaliarInvestigacao, sempre um clique humano
// explicito.
//
// Isolado de proposito do motor investigativo: prompt proprio, chamada
// propria a chamarIA (funcao generica, ja desacoplada de
// context-engine/plano-resposta-rastreavel/prompt-builder/quality-gate).
// Nunca escreve nem le nada desses quatro arquivos. Falha aberta: qualquer
// erro (provider fora, JSON invalido, mensagem nao encontrada) devolve
// { sucesso: false }, nunca lanca -- o modal de avaliacao abre vazio nesse
// caso, exatamente como hoje, e o consultor avalia manualmente.

const atendimentoRepo = require('../repositories/atendimento-repository');
const mensagemRepo = require('../repositories/mensagem-repository');
const aiConfigService = require('./ai-config-service');
const aiProviderClient = require('./ai-provider-client');
const { ROTULOS_CRITERIO, CAMPOS_NOTA, notasValidas } = require('./avaliacao-criterios');

const TIMEOUT_MS = 20000;
const MAX_TOKENS = 500;

function _montarSystemPrompt() {
  const listaCriterios = CAMPOS_NOTA.map(campo => `- "${campo}": ${ROTULOS_CRITERIO[campo]}`).join('\n');
  return `Você é um avaliador técnico auxiliar. Sua tarefa é sugerir uma nota de 0 (nenhuma) a 5 (excelente) para cada um dos 5 critérios abaixo, avaliando a RESPOSTA DE INVESTIGAÇÃO fornecida em relação ao PROBLEMA ORIGINAL do cliente.

Critérios:
${listaCriterios}

Responda APENAS um JSON válido, sem texto fora do JSON, no formato exato:
{"compreensaoProblema":N,"aproveitamentoEvidencias":N,"profundidadeTecnica":N,"orientacaoPratica":N,"confiabilidadeTecnica":N,"observacoes":"texto curto, no máximo 2 frases"}

Onde N é um número inteiro de 0 a 5. Seja criterioso: nota 5 é reservada para respostas excepcionais, nota 0 para respostas que não investigaram nada. Esta é apenas uma SUGESTÃO inicial que um consultor humano vai revisar e pode corrigir — não é a avaliação final.`;
}

function _montarUserPrompt(problemaOriginal, respostaInvestigacao) {
  return `PROBLEMA ORIGINAL DO CLIENTE:\n${problemaOriginal}\n\nRESPOSTA DE INVESTIGAÇÃO A AVALIAR:\n${respostaInvestigacao}`;
}

function _extrairJson(texto) {
  const match = String(texto || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

// Nunca "clampa" uma nota fora de 0-5 (ex. 9 -> 5) -- isso corrigiria
// silenciosamente um modelo que nao seguiu as instrucoes do prompt,
// escondendo um sinal real de que a sugestao nao e confiavel. Fora da faixa
// = sugestao inteira descartada (notasValidas rejeita), nunca ajustada.
function _normalizarNota(valor) {
  const n = Number(valor);
  return Number.isInteger(n) ? n : null;
}

/**
 * Gera uma sugestão de avaliação para uma mensagem do assistente. Nunca
 * lança -- sempre devolve { sucesso: true, sugestao } ou { sucesso: false }.
 */
async function gerarPreAvaliacao(empresaId, { atendimentoId, mensagemAssistenteId }) {
  try {
    const atendimento = atendimentoRepo.getAtendimento(empresaId, atendimentoId);
    if (!atendimento) return { sucesso: false };

    const mensagem = mensagemRepo.getMensagem(empresaId, mensagemAssistenteId);
    if (!mensagem || mensagem.atendimentoId !== atendimentoId || mensagem.papel !== 'assistant') {
      return { sucesso: false };
    }
    if (!mensagem.conteudo || !String(mensagem.conteudo).trim()) return { sucesso: false };

    const { keys, cfg } = aiConfigService.resolverKeysEOrdem(empresaId);
    const systemPrompt = _montarSystemPrompt();
    const userPrompt = _montarUserPrompt(atendimento.conteudoBruto || '', mensagem.conteudo);

    const resultado = await aiProviderClient.chamarIA(
      keys, cfg, systemPrompt, userPrompt, [],
      { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS, json: true, maxProviderRounds: 1 },
    );

    const parsed = _extrairJson(resultado.texto);
    if (!parsed) return { sucesso: false };

    const notas = {};
    for (const campo of CAMPOS_NOTA) notas[campo] = _normalizarNota(parsed[campo]);
    if (!notasValidas(notas)) return { sucesso: false };

    const observacoes = typeof parsed.observacoes === 'string' ? parsed.observacoes.trim().slice(0, 500) : null;

    return { sucesso: true, sugestao: { notas, observacoes } };
  } catch (err) {
    console.error('[IA Service] Pré-avaliação por IA falhou, modal abre sem sugestão:', err.message);
    return { sucesso: false };
  }
}

module.exports = { gerarPreAvaliacao };
