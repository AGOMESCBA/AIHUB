'use strict';

/**
 * Combina N specs de modulos distintos em um spec unificado para queries cross-module.
 *
 * Principios:
 * - tabelas:              uniao sem duplicatas
 * - regrasTecnicas:       concatenacao com cabecalho por modulo
 * - sqlPatternsProibidos: uniao (todas sao invariantes matematicas validas em qualquer contexto)
 * - camposSx3Essenciais:  merge por tabela
 * - entityCatalog:        merge de DEFINICOES; tiposParaTermo roteia pelo tipo da entidade
 * - resolverEntidades:    despacha cada pedido ao spec que conhece aquele tipo de entidade
 * - sqlMiddleware:        pass-through (v1) — cross-module nao usa middleware de modulo individual
 * - sanitizarFiltrosFilialSX2: desabilitado (cada modulo usa campo de filial diferente)
 */
function combinarSpecs(specs = []) {
  if (!specs.length) throw new Error('cross-module-spec-combiner: nenhum spec fornecido.');
  if (specs.length === 1) return specs[0];

  const nomes = specs.map(s => String(s.nome || 'modulo'));

  // --- tabelas ---
  const tabelas = [...new Set(specs.flatMap(s => s.tabelas || []))];

  // --- camposSx3Essenciais ---
  const camposSx3Essenciais = {};
  for (const spec of specs) {
    for (const [tabela, campos] of Object.entries(spec.camposSx3Essenciais || {})) {
      if (!camposSx3Essenciais[tabela]) {
        camposSx3Essenciais[tabela] = [...campos];
      } else {
        const existentes = new Set(camposSx3Essenciais[tabela]);
        for (const c of campos) if (!existentes.has(c)) camposSx3Essenciais[tabela].push(c);
      }
    }
  }

  // --- regrasTecnicas ---
  // Regra de infraestrutura: a IA nao tem como saber que o motor de execucao aceita apenas
  // uma instrucao SQL por chamada. Esta e a unica regra injetada pelo combiner — tecnica e minima.
  const regraInfraEstrutura = `## Regra de Execucao Cross-Module (OBRIGATORIA)
- O motor de execucao processa UMA UNICA instrucao SQL por chamada.
- PROIBIDO gerar multiplos SELECT separados por ponto-e-virgula como instrucoes independentes.
- Para combinar metricas de modulos distintos em uma unica instrucao, use subqueries escalares, CTEs ou qualquer estrutura SQL valida — escolha a que melhor atende a pergunta do usuario (crescimento, comparativo, saldo, etc.).`;

  const regrasTecnicas = [
    regraInfraEstrutura,
    ...specs.map(s => {
      if (!s.regrasTecnicas) return '';
      const titulo = String(s.nome || 'modulo');
      const cabecalho = `## Contrato Tecnico — Modulo ${titulo.charAt(0).toUpperCase() + titulo.slice(1)}`;
      return `${cabecalho}\n${s.regrasTecnicas}`;
    }).filter(Boolean),
  ].join('\n\n');

  // --- contratosTecnicosPrioritarios ---
  // Relacionamentos fisicos do ERP que devem aparecer cedo no prompt.
  // Sao contexto tecnico para a IA-OWNER, nao correcoes automaticas de SQL.
  const contratosTecnicosPrioritarios = [
    ...new Map(
      specs
        .map(s => String(s.contratosTecnicosPrioritarios || '').trim())
        .filter(Boolean)
        .map(bloco => [bloco.replace(/\s+/g, ' '), bloco])
    ).values(),
  ].join('\n\n');

  // --- sqlPatternsProibidos ---
  const sqlPatternsProibidos = specs.flatMap(s => s.sqlPatternsProibidos || []);

  // --- dimensionLeftJoinBases ---
  const dimensionLeftJoinBases = [...new Set(specs.flatMap(s => s.dimensionLeftJoinBases || []))];

  // --- entityCatalog combinado ---
  const DEFINICOES = {};
  for (const spec of specs) {
    for (const [tipo, def] of Object.entries(spec.entityCatalog?.DEFINICOES || {})) {
      if (!DEFINICOES[tipo]) DEFINICOES[tipo] = def;
    }
  }
  const TIPOS_POR_CONTEXTO = [...new Set(specs.flatMap(s => s.entityCatalog?.TIPOS_POR_CONTEXTO || []))];

  function tiposParaTermo(termo) {
    const tipo = String(termo?.tipo_sugerido || '').trim();
    return DEFINICOES[tipo] && ['explicito', 'filtro_estruturado'].includes(termo?.origem)
      ? [tipo]
      : TIPOS_POR_CONTEXTO;
  }

  const entityCatalog = { DEFINICOES, TIPOS_POR_CONTEXTO, tiposParaTermo };

  // --- resolverEntidades: roteia pelo tipo ao spec correto ---
  const tipoParaSpec = {};
  for (const spec of specs) {
    for (const tipo of Object.keys(spec.entityCatalog?.DEFINICOES || {})) {
      if (!tipoParaSpec[tipo]) tipoParaSpec[tipo] = spec;
    }
  }

  async function resolverEntidades({ pedidos, ...resto }) {
    const resolvidas = [];
    for (const pedido of pedidos || []) {
      const tipo = String(pedido?.tipo || pedido?.tipo_sugerido || '').toLowerCase();
      const specAlvo = tipoParaSpec[tipo] || specs[0];
      if (typeof specAlvo.resolverEntidades !== 'function') continue;
      const result = await specAlvo.resolverEntidades({ pedidos: [pedido], ...resto });
      if (result.status === 'ambigua') return result;
      if (result.status === 'nao_encontrado') return result;
      resolvidas.push(...(result.entidades || []));
    }
    return { status: 'resolvido', entidades: resolvidas };
  }

  // --- formatarPerguntaAmbiguidade: usa o primeiro spec que tiver ---
  const formatarPerguntaAmbiguidade = specs
    .map(s => s.formatarPerguntaAmbiguidade)
    .find(fn => typeof fn === 'function');

  // --- sqlMiddleware pass-through ---
  const sqlMiddleware = {
    carregarConfig: () => ({}),
    processar: (sql) => ({ bloqueado: false, sql_processado: sql }),
  };

  return {
    nome: nomes.join('_'),
    handlerName: `cross-module-${nomes.join('-')}`,
    logPrefix: `CrossModule[${nomes.join('+')}]`,
    defaultMessage: `consulta comparativa ${nomes.join(' x ')}`,
    tabelas,
    entityCatalog,
    resolverEntidadesAntesDaIa: specs.some(s => s.resolverEntidadesAntesDaIa),
    camposSx3Essenciais,
    sqlMiddleware,
    contratosTecnicosPrioritarios,
    regrasTecnicas,
    sqlPatternsProibidos,
    dimensionLeftJoinBases,
    maxTokens: Math.max(...specs.map(s => s.maxTokens || 3500)) + 1500,
    sx3PromptLimit: Math.max(...specs.map(s => s.sx3PromptLimit || 80)),
    sanitizarFiltrosFilialSX2: false,
    resolverEntidades,
    formatarPerguntaAmbiguidade,
    mensagensErro: specs[0].mensagensErro,
    garantirIntencao: () => {},
  };
}

module.exports = { combinarSpecs };
