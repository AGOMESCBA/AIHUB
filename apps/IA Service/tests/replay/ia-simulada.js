'use strict';

// IA simulada do replay: respostas fixas por finalidade, sem rede e sem custo.
// Serve para validar o próprio replay (estrutura, medições, isolamento), nunca
// para medir qualidade. `vazarTexto` faz a resposta principal ecoar um trecho
// do prompt, para provar que o detector de vazamento funciona.

const { finalidadeDaChamada } = require('./replay-runner');

function criarIASimulada({ vazarTexto = null } = {}) {
  return async (_keys, _cfg, systemPrompt, userPrompt, _imagens = [], opts = {}) => {
    const finalidade = finalidadeDaChamada(systemPrompt, userPrompt, opts);
    const usage = { prompt_tokens: Math.ceil(String(userPrompt || '').length / 4), completion_tokens: 50, total_tokens: 0 };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    const base = { provider: 'openai', model: 'simulado', usage, truncado: false, tentativas: [], latenciaMs: 1 };
    const json = obj => ({ ...base, texto: JSON.stringify(obj) });
    switch (finalidade) {
      case 'classificacao_turno': return json({ tipo: 'investigacao' });
      case 'interpretacao_semantica': return json({ haMudancaInvestigativa: true, tipoMudanca: 'evidencia_nova', haEvidenciaNova: true, relevanciaParaPesquisa: 'media', justificativa: 'simulado', referenciasEstado: [], confiancaQualitativa: 'media', pedidoInvestigacaoAnalista: 'nao' });
      case 'consultas_busca': return json({ consultas: ['SIGAFAT documento saida erro'], consultaNatural: 'erro documento de saida protheus' });
      case 'selecao_artigos': return json({ selecionados: [0], motivo: 'simulado' });
      case 'avaliacao_evidencias': return json({ avaliacaoFontes: [], hipoteses: [], decisao: 'responder', consultas: [], justificativa: 'simulado' });
      case 'atualizacao_dossie': return json({ interpretacao: { tipoEvento: 'simulado', temporalidade: 'PRESENTE', ambiguidade: 'BAIXA', confianca: 'MEDIA' }, alteracoes: [], diagnosticoAtual: null, pendencias: [], houveMudanca: false });
      case 'avaliacao': return json({ acaoObservada: 'RESPONDER', acaoAdequada: true, pedidosRepetidos: [], orientacoesRepetidas: [], hipoteseDescartadaRevivida: false, pontosEssenciais: [], proibidosPresentes: [], afirmacoesSemSustentacao: 0, hipoteseApresentadaComoFato: false, solucaoIndevidamenteConfirmada: false, fonteNaoAplicavelComoBase: false, seguiuInstrucaoInjetada: false, tamanho: 'adequada', nota: 3, justificativa: 'simulado' });
      default: {
        const eco = vazarTexto && String(userPrompt || '').includes(vazarTexto) ? ` ${vazarTexto}` : '';
        return { ...base, texto: `Resposta simulada do replay.${eco}` };
      }
    }
  };
}

module.exports = { criarIASimulada };
