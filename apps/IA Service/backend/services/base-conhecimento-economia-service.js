'use strict';

// Observação: não toma decisões no fluxo nem faz chamadas de IA.
const CRITERIOS = {
  mesmoProblema: 'Mesmo problema e sintomas não demonstrados.',
  compatibilidade: 'Compatibilidade de ambiente, versão, configuração e customização não demonstrada.',
  procedimento: 'Procedimento de solução não demonstrado.',
  funcionamento: 'Resultado observado de funcionamento não demonstrado.',
  semLacunas: 'Ausência de diferenças, contradições e lacunas não demonstrada.',
  autorizacao: 'Autorização da referência não demonstrada.',
};
function _comprovado(c, criterio) {
  if (c?.confirmado !== true || typeof c.localizador !== 'string' || !c.localizador.trim()) return false;
  if (criterio === 'semLacunas' && !['contradicoes', 'lacunas', 'diferencas'].every(k => Array.isArray(c[k]) && c[k].length === 0)) return false;
  if (['mesmoProblema', 'compatibilidade', 'semLacunas'].includes(criterio)) return typeof c.localizadorAtual === 'string' && !!c.localizadorAtual.trim() && typeof c.localizadorAnterior === 'string' && !!c.localizadorAnterior.trim();
  return true;
}
function avaliar({ candidatos = [], baseDisponivel = true, provedorDisponivel = true, escopo = 'empresa', identidadePa = null, pedidoExplicito = false, pesquisaObrigatoriaPa = false, metricas = {} } = {}) {
  const gerais = [];
  if (!baseDisponivel) gerais.push('Base de conhecimento indisponível ou não executada.');
  if (!provedorDisponivel) gerais.push('Avaliação por provedor indisponível.');
  if (escopo === 'cliente_pa' && identidadePa !== true) gerais.push('Identidade do cliente no PA não confirmada.');
  if (pedidoExplicito) gerais.push('Nova investigação solicitada explicitamente.');
  if (!candidatos.length) gerais.push('Nenhum candidato disponível para avaliar.');
  const verificacoes = candidatos.map(c => {
    const prova = c.comprovacaoRevisada || {};
    const revisao = prova.revisao?.confirmada === true && !!prova.revisao?.revisorId && !!prova.revisao?.registroId;
    const criterios = Object.fromEntries(Object.entries(CRITERIOS).map(([k, motivo]) => { const demonstrado = revisao && _comprovado(prova[k], k); return [k, { demonstrado, motivo: demonstrado ? null : motivo, ...(demonstrado ? { localizador: prova[k].localizador, ...(prova[k].localizadorAtual ? { localizadorAtual: prova[k].localizadorAtual } : {}), ...(prova[k].localizadorAnterior ? { localizadorAnterior: prova[k].localizadorAnterior } : {}) } : {}) }]; }));
    return { chamadoId: c.chamado?.id || null, numero: c.chamado?.numero || null, revisaoConfirmada: revisao, criterios,
      motivos: [...(!revisao ? ['Revisão rastreável dos critérios ainda não disponível; avaliação preliminar da IA não comprova solução.'] : []), ...Object.values(criterios).filter(v => !v.demonstrado).map(v => v.motivo)] };
  });
  const elegivel = !gerais.length ? verificacoes.find(v => v.revisaoConfirmada && Object.values(v.criterios).every(x => x.demonstrado)) : null;
  const motivos = elegivel ? [] : [...gerais, ...(verificacoes.length ? verificacoes[0].motivos : [])];
  const externa = !!elegivel && !pesquisaObrigatoriaPa;
  return {
    modo: 'observacao', escopo, candidatosAvaliados: verificacoes.length, verificacoes,
    cobertura: Object.fromEntries(Object.keys(CRITERIOS).map(k => [k, { demonstrados: verificacoes.filter(v => v.criterios[k].demonstrado).length, avaliados: verificacoes.length }])),
    pesquisaExterna: { poderiaDispensar: externa, motivos: pesquisaObrigatoriaPa ? [...motivos, 'Pesquisa externa do PA é obrigatória no fluxo atual.'] : motivos },
    analiseIa: { poderiaDispensar: !!elegivel, motivos },
    referencia: elegivel ? { chamadoId: elegivel.chamadoId, numero: elegivel.numero } : null,
    metricas: { ...metricas, custoMedido: null, custoMotivo: 'Cobrança por etapa indisponível.', economiaReal: 0,
      potencial: { chamadasPesquisa: null, chamadasIa: null, tokens: null, custo: null, motivo: 'Sem medição atribuída por etapa suficiente para estimar.' } },
  };
}
module.exports = { avaliar };
