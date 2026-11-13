'use strict';

// Resumo legível do replay: comparação com/sem 4B e tabela por caso
// (média ± desvio entre as execuções).

const METRICAS_RESUMO = [
  ['turnosQuePesquisaram', 'Turnos que pesquisaram'],
  ['consultasExecutadas', 'Consultas executadas'],
  ['consultasRepetidas', 'Consultas repetidas'],
  ['paginasAplicaveisLidas', 'Páginas aplicáveis lidas'],
  ['paginasNaoAplicaveisLidas', 'Páginas não aplicáveis lidas'],
  ['acaoAdequadaPct', 'Ação adequada (%)'],
  ['pontosEssenciaisCobertosPct', 'Pontos essenciais cobertos (%)'],
  ['pedidosRepetidos', 'Pedidos repetidos de dado disponível'],
  ['orientacoesRepetidas', 'Orientações já testadas repetidas'],
  ['hipotesesDescartadasRevividas', 'Hipóteses descartadas revividas'],
  ['afirmacoesSemSustentacao', 'Afirmações sem sustentação'],
  ['hipoteseComoFato', 'Hipótese apresentada como fato'],
  ['solucaoIndevidamenteConfirmada', 'Solução confirmada indevidamente'],
  ['fonteNaoAplicavelComoBase', 'Fonte não aplicável como base'],
  ['seguiuInstrucaoInjetada', 'Seguiu instrução injetada'],
  ['respostasLongasDemais', 'Respostas longas demais'],
  ['notaMedia', 'Nota média (1–5)'],
  ['chamadasIA', 'Chamadas de IA do motor'],
  ['tokensEntrada', 'Tokens de entrada'],
  ['tokensSaida', 'Tokens de saída'],
  ['custo', 'Custo (USD)'],
  ['latenciaMediaTurnoMs', 'Latência média por turno (ms)'],
  ['tempoAtePrimeiraOrientacaoUtilMs', 'Tempo até 1ª orientação útil (ms)'],
  ['vazamentoEntreEmpresas', 'Vazamento entre empresas'],
  ['turnosComErro', 'Turnos com erro'],
  ['turnosComFalhaProvider', 'Turnos com falha do provider'],
];

function _fmt(v, casas = 1) {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(casas);
}

function gerarResumo({ meta, porCaso, porVariante }) {
  const l = [];
  l.push(`# Replay do motor de investigação — ${meta.simulado ? 'SIMULADO (não mede qualidade)' : meta.modelo}`);
  l.push('');
  l.push(`Data: ${meta.data} · Modelo: ${meta.modelo} · Avaliador: ${meta.modeloAvaliador} (${meta.rubrica}) · Execuções por caso: ${meta.execucoesPorCaso} · Casos: ${meta.casos.length}`);
  l.push('');
  l.push('## Comparação por variante (média por caso; soma entre casos)');
  l.push('');
  const variantes = Object.keys(porVariante);
  l.push(`| Métrica | ${variantes.map(v => `${v} (média/caso)`).join(' | ')} | ${variantes.map(v => `${v} (total)`).join(' | ')} |`);
  l.push(`|---|${variantes.map(() => '---').join('|')}|${variantes.map(() => '---').join('|')}|`);
  for (const [chave, rotulo] of METRICAS_RESUMO) {
    const medias = variantes.map(v => _fmt(porVariante[v][chave]?.mediaEntreCasos, 2));
    const totais = variantes.map(v => (/Pct|notaMedia|latenciaMedia/.test(chave) ? '—' : _fmt(porVariante[v][chave]?.somaDasMedias, 2)));
    l.push(`| ${rotulo} | ${medias.join(' | ')} | ${totais.join(' | ')} |`);
  }
  l.push('');
  l.push('## Por caso (média ± desvio entre execuções)');
  l.push('');
  const colunas = ['turnosQuePesquisaram', 'consultasRepetidas', 'acaoAdequadaPct', 'pontosEssenciaisCobertosPct', 'pedidosRepetidos', 'afirmacoesSemSustentacao', 'tokensEntrada', 'latenciaMediaTurnoMs', 'vazamentoEntreEmpresas'];
  l.push(`| Caso | Variante | ${colunas.join(' | ')} |`);
  l.push(`|---|---|${colunas.map(() => '---').join('|')}|`);
  for (const g of [...porCaso].sort((a, b) => a.casoId.localeCompare(b.casoId) || a.variante.localeCompare(b.variante))) {
    l.push(`| ${g.casoId} | ${g.variante} | ${colunas.map(c => {
      const m = g.metricas[c];
      return m.media === null ? '—' : `${_fmt(m.media)} ± ${_fmt(m.desvio)}`;
    }).join(' | ')} |`);
  }
  l.push('');
  return l.join('\n');
}

module.exports = { gerarResumo };
