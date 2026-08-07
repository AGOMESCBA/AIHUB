'use strict';

// Decide, ANTES de acionar qualquer orquestrador/motor específico, a qual sistema (erp)
// uma pergunta pertence — quando a empresa tem intenções ai_text_to_sql de mais de um
// sistema cadastradas (ex: Protheus + SoftExpert). Não altera em nada o comportamento de
// empresas com um único sistema: nesse caso, retorna o sistema único sem nenhum cálculo.

const localResolver = require('./local-intent-resolver');

const DIFERENCA_MINIMA_PARA_DESEMPATE = 3;

function _erpDaIntencao(intent = {}) {
  return String(intent.erp || 'protheus').trim().toLowerCase() || 'protheus';
}

function _sistemasDisponiveis(intencoesAiSql = []) {
  return [...new Set(intencoesAiSql.map(_erpDaIntencao))];
}

// Agrega o ranking por intenção (já pontuado por intent-service._ranquearIntencoesAiSql)
// em um ranking por sistema — usa o melhor score entre as intenções de cada sistema.
// scoreForte marca se algum sinal DECISIVO (nome do módulo, ou sinônimo cadastrado
// explicitamente para a intenção) bateu — usado para não tratar como ambíguo um caso em
// que só um sistema tem esse sinal forte, mesmo que a diferença numérica seja pequena.
function _ranquearSistemas(ranking = []) {
  const porSistema = new Map();
  for (const item of ranking) {
    const erp = _erpDaIntencao(item.intent);
    const atual = porSistema.get(erp);
    if (!atual || item.score > atual.score) {
      porSistema.set(erp, { sistema: erp, score: item.score, scoreForte: item.scoreForte || 0, intent: item.intent });
    }
  }
  return [...porSistema.values()].sort((a, b) => b.score - a.score);
}

function resolverSistema(mensagem, intencoes = [], sinonimos = [], normalizacoes = []) {
  const intentService = require('./intent-service');
  const candidatas = (intencoes || []).filter(i => String(i.acao || '').toLowerCase() === 'ai_text_to_sql');
  const sistemas = _sistemasDisponiveis(candidatas);

  // Caminho dominante: só Protheus (ou nenhum sistema dinâmico) cadastrado — comportamento
  // idêntico ao anterior à existência deste módulo, sem custo adicional de processamento.
  if (sistemas.length <= 1) {
    return { sistema: sistemas[0] || 'protheus', ambiguo: false, candidatos: [] };
  }

  const ranking = intentService._ranquearIntencoesAiSql(mensagem, candidatas, sinonimos, normalizacoes)
    .filter(r => r.score > 0);
  if (!ranking.length) {
    return { sistema: null, ambiguo: false, candidatos: [] };
  }

  const porSistema = _ranquearSistemas(ranking);
  if (porSistema.length === 1) {
    return { sistema: porSistema[0].sistema, ambiguo: false, candidatos: [] };
  }

  // Sinal forte exclusivo (nome do módulo ou sinônimo cadastrado bateu em só um sistema):
  // decide sozinho, mesmo com diferença numérica pequena para o segundo colocado — o sinal
  // fraco do concorrente (bigrama incidental de outra frase de exemplo) não deve competir
  // com uma correspondência intencional e explícita.
  const comSinalForte = porSistema.filter(p => p.scoreForte > 0);
  if (comSinalForte.length === 1) {
    return { sistema: comSinalForte[0].sistema, ambiguo: false, candidatos: [] };
  }

  const diferenca = porSistema[0].score - porSistema[1].score;
  const ambiguo = diferenca <= DIFERENCA_MINIMA_PARA_DESEMPATE;

  return {
    sistema: ambiguo ? null : porSistema[0].sistema,
    ambiguo,
    candidatos: porSistema.map(p => ({
      sistema: p.sistema,
      intencao: p.intent?.nome || null,
      modulo: p.intent?.modulo || null,
      score: p.score,
    })),
  };
}

module.exports = {
  resolverSistema,
  _erpDaIntencao,
  _sistemasDisponiveis,
  _ranquearSistemas,
};
