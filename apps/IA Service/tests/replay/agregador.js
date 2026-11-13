'use strict';

// Métricas do replay: por execução, por caso×variante (média e dispersão entre
// as execuções) e por variante (soma/média entre casos). "Variante" = com ou
// sem a disciplina 4B.

function _soma(valores) {
  return valores.reduce((a, b) => a + b, 0);
}

function estatisticas(valores) {
  const v = valores.filter(x => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { n: 0, media: null, desvio: null, min: null, max: null };
  const media = _soma(v) / v.length;
  const desvio = v.length > 1 ? Math.sqrt(_soma(v.map(x => (x - media) ** 2)) / (v.length - 1)) : 0;
  return { n: v.length, media, desvio, min: Math.min(...v), max: Math.max(...v) };
}

function metricasDaExecucao(caso, exec) {
  const classe = new Map((caso.fontes || []).map(f => [f.url, f.aplicavel]));
  const turnos = exec.turnos;
  const chamadas = turnos.flatMap(t => t.chamadasIA);
  const custos = chamadas.map(c => c.custo);
  const aval = turnos.map(t => t.avaliacao).filter(a => a?.ok);
  const pontos = aval.flatMap(a => a.pontosEssenciais);
  const lidas = turnos.flatMap(t => t.pesquisa.paginasLidas);
  let acumulado = 0;
  let tempoAteUtil = null;
  for (const t of turnos) {
    acumulado += t.latenciaTurnoMs;
    if (tempoAteUtil === null && t.avaliacao?.ok && t.avaliacao.pontosEssenciais.some(p => p.coberto)) tempoAteUtil = acumulado;
  }
  const conta = (pred) => aval.filter(pred).length;
  return {
    turnos: turnos.length,
    turnosComErro: turnos.filter(t => t.erro).length,
    turnosComFalhaProvider: turnos.filter(t => t.falhaProvider).length,
    turnosQuePesquisaram: turnos.filter(t => t.pesquisa.devePesquisar).length,
    consultasExecutadas: _soma(turnos.map(t => t.pesquisa.consultas.length)),
    consultasRepetidas: _soma(turnos.map(t => t.pesquisa.consultasRepetidas.length)),
    paginasLidas: lidas.length,
    paginasNaoAplicaveisLidas: lidas.filter(u => ['NAO_APLICAVEL', 'RELACIONADO'].includes(classe.get(u))).length,
    paginasAplicaveisLidas: lidas.filter(u => ['APLICAVEL', 'POTENCIAL'].includes(classe.get(u))).length,
    chamadasIA: chamadas.length,
    tokensEntrada: _soma(chamadas.map(c => c.tokensEntrada || 0)),
    tokensSaida: _soma(chamadas.map(c => c.tokensSaida || 0)),
    tokensEntradaRespostaPrincipal: _soma(chamadas.filter(c => c.finalidade === 'resposta_principal').map(c => c.tokensEntrada || 0)),
    custo: custos.length && custos.every(c => typeof c === 'number') ? _soma(custos) : null,
    latenciaTotalMs: _soma(turnos.map(t => t.latenciaTurnoMs)),
    latenciaMediaTurnoMs: turnos.length ? _soma(turnos.map(t => t.latenciaTurnoMs)) / turnos.length : null,
    tempoAtePrimeiraOrientacaoUtilMs: tempoAteUtil,
    avaliacoesValidas: aval.length,
    acaoAdequadaPct: aval.length ? (conta(a => a.acaoAdequada) / aval.length) * 100 : null,
    pedidosRepetidos: _soma(aval.map(a => a.pedidosRepetidos.length)),
    orientacoesRepetidas: _soma(aval.map(a => a.orientacoesRepetidas.length)),
    hipotesesDescartadasRevividas: conta(a => a.hipoteseDescartadaRevivida),
    pontosEssenciaisCobertosPct: pontos.length ? (pontos.filter(p => p.coberto).length / pontos.length) * 100 : null,
    proibidosPresentes: _soma(aval.map(a => a.proibidosPresentes.length)),
    afirmacoesSemSustentacao: _soma(aval.map(a => a.afirmacoesSemSustentacao || 0)),
    hipoteseComoFato: conta(a => a.hipoteseApresentadaComoFato),
    solucaoIndevidamenteConfirmada: conta(a => a.solucaoIndevidamenteConfirmada),
    fonteNaoAplicavelComoBase: conta(a => a.fonteNaoAplicavelComoBase),
    seguiuInstrucaoInjetada: conta(a => a.seguiuInstrucaoInjetada),
    respostasLongasDemais: conta(a => a.tamanho === 'longa_demais'),
    notaMedia: aval.length && aval.every(a => a.nota) ? _soma(aval.map(a => a.nota)) / aval.length : null,
    vazamentoEntreEmpresas: exec.seguranca ? (exec.seguranca.vazou ? 1 : 0) : null,
  };
}

function agregar(casos, execucoes) {
  const porId = new Map(casos.map(c => [c.id, c]));
  const grupos = new Map();
  for (const exec of execucoes) {
    const chave = `${exec.casoId}|${exec.disciplina4B ? 'com4B' : 'sem4B'}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(metricasDaExecucao(porId.get(exec.casoId), exec));
  }
  const porCaso = [];
  for (const [chave, lista] of grupos) {
    const [casoId, variante] = chave.split('|');
    const nomes = Object.keys(lista[0]);
    porCaso.push({
      casoId, variante, conjunto: porId.get(casoId).conjunto, execucoes: lista.length,
      metricas: Object.fromEntries(nomes.map(n => [n, estatisticas(lista.map(m => m[n]))])),
    });
  }
  const porVariante = {};
  for (const variante of ['com4B', 'sem4B']) {
    const doGrupo = porCaso.filter(g => g.variante === variante);
    if (!doGrupo.length) continue;
    const nomes = Object.keys(doGrupo[0].metricas);
    // Média por caso primeiro, depois total entre casos (cada caso pesa igual).
    porVariante[variante] = Object.fromEntries(nomes.map(n => {
      const medias = doGrupo.map(g => g.metricas[n].media).filter(x => x !== null);
      return [n, { somaDasMedias: medias.length ? _soma(medias) : null, mediaEntreCasos: medias.length ? _soma(medias) / medias.length : null, casos: medias.length }];
    }));
  }
  return { porCaso, porVariante };
}

module.exports = { agregar, metricasDaExecucao, estatisticas };
