'use strict';

// Somente dados das validações: nunca reutiliza a prosa, o código ou as
// recomendações da IA para redigir o resultado de uma proposta bloqueada.
const MOTIVOS = {
  FINALIZACAO_DESVIADA: 'A alteração introduz um caminho que deixa de executar uma finalização existente.',
  FLUXO_NAO_COMPROVADO: 'Não foi possível comprovar a segurança dos caminhos de execução afetados.',
  ESTRUTURA_ADVPL_INVALIDA: 'A alteração compromete o balanceamento dos blocos ADVPL/TLPP.',
  DECLARACAO_REMOVIDA: 'A alteração remove declarações existentes.',
  RESTAURACAO_CONTEXTO_REMOVIDA: 'A alteração remove restauração de contexto existente.',
  ROTINAS_ALTERADAS: 'A alteração compromete a preservação das rotinas existentes.',
  CONTRADICAO_CAUSAL: 'Foi identificada contradição entre a proposta e o comportamento do fonte.',
  SOURCE_BEHAVIOR_CONTRADICTION: 'A premissa da correção contradiz o comportamento demonstrado pelo fonte.',
  CONTRADICAO_NAO_COMPROVADA: 'O verificador não comprovou a consistência causal da proposta.',
  ANCORA_AUSENTE: 'O trecho original indicado pela proposta não foi encontrado exatamente no fonte.',
  ANCORA_DUPLICADA: 'A âncora corresponde a mais de um trecho do fonte.',
  DIAGNOSTICO_REPROVADO: 'O diagnóstico não foi aprovado pelo Quality Gate.',
  GERACAO_DESATIVADA: 'A geração está desabilitada; a proposta não passou pela cadeia de aprovação do arquivo.',
};

// Impede que metadados de arquivo/operação se tornem blocos ou instruções
// Markdown. Só são apresentados como rótulos e evidências do bloqueio.
const rotulo = valor => String(valor ?? '').replace(/[\r\n`<>*\[\]]/g, ' ').slice(0, 240);

function construirRespostaBloqueada({ avaliacoes = [], fontes = [] } = {}) {
  const bloqueadas = avaliacoes.filter(a => a.estado !== 'aprovado');
  if (!bloqueadas.length) return null;
  const evidencias = bloqueadas.map(a => {
    const linhas = [
      `Arquivo: ${rotulo(a.arquivo || 'proposta de fonte')}. Estado: ${rotulo(a.estado)}. Código: ${rotulo(a.codigo)}.`,
      MOTIVOS[a.codigo] || (a.estado === 'falha_tecnica'
        ? 'Uma falha de processamento impediu a aprovação da proposta.'
        : 'As verificações exigidas não comprovaram a segurança da proposta.'),
    ];
    const vistas = new Set();
    for (const e of a.etapas?.fluxo?.evidencias || []) {
      const chave = JSON.stringify([e.operacao, e.linha, e.trilha, e.condicoes]);
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      linhas.push(`Operação/finalização afetada: ${rotulo(e.operacao)}. Saída na linha ${Number(e.linha) || 'não identificada'}.`);
      const trilha = (e.trilha || []).filter(Number.isInteger);
      if (trilha.length) linhas.push(`Trilha de execução (linhas): ${trilha.join(' → ')}.`);
      const condicoes = Object.entries(e.condicoes || {}).filter(([, v]) => typeof v === 'boolean');
      if (condicoes.length) linhas.push(`Condições do caminho: ${condicoes.map(([k, v]) => `${rotulo(k.split('|')[0])} = ${v}`).join('; ')}.`);
    }
    linhas.push('Nenhum arquivo corrigido foi gerado ou disponibilizado para esta proposta bloqueada.');
    return linhas.join('\n');
  });
  return [
    '**Diagnóstico**',
    'A proposta de alteração de fonte foi bloqueada pelo IA Service e precisa ser revista. Não aplique a proposta rejeitada.',
    '', '**Evidências**', ...evidencias,
    ...(fontes.length ? ['', 'As propostas de outros arquivos que foram aprovadas permanecem disponíveis separadamente para validação.'] : []),
    '', '**Validação**',
    'Revisar a proposta a partir das evidências do bloqueio. O fonte original permanece intacto. A resposta original da IA foi preservada na auditoria interna da execução.',
    'A aprovação do IA Service não equivale a compilação ou homologação Protheus; propostas aprovadas exigem compilação e testes funcionais no ambiente de homologação.',
  ].join('\n');
}

module.exports = { construirRespostaBloqueada };
