// Decompõe uma execução de investigação (investigacao_execucoes) em eventos
// cronológicos para a aba "Trilha de Investigação" do chat. Não executa
// nenhuma chamada de IA nova e não acrescenta nenhum dado que não exista já
// em manifesto_json/pesquisa_json/quality_gate_json/tentativas_json/usage_json
// e nos metadados de humanização da mensagem — só reorganiza o que já foi persistido em
// passos legíveis. A execução vem redigida pelo repositório; os textos da
// mensagem passam pelo mesmo redator antes de aparecer na trilha.

const STATUS_EXECUCAO_LABEL = {
  concluido: 'Concluída',
  concluido_com_alerta_quality_gate: 'Concluída com alerta',
  revisao_necessaria_quality_gate: 'Revisão necessária',
  erro_imagem: 'Erro ao processar evidência visual',
  erro_provider: 'Erro no provider de IA',
};
const { redigirValor } = require('./redaction-service');

function _eventosComunicacao(mensagem) {
  const h = mensagem?.diagnostico?.humanizacao;
  const original = h?.respostaOriginal ?? mensagem?.conteudo;
  if (mensagem?.papel !== 'assistant' || typeof original !== 'string') return [];
  const primaria = {
    tipo: 'resposta_tecnica_original', titulo: 'Resposta técnica original', status: 'concluido',
    resumo: 'Resposta primária preservada antes de qualquer ajuste de comunicação.',
    detalhes: { mensagemId: mensagem.id, conteudo: redigirValor(original) },
  };
  if (!h || typeof h.respostaOriginal !== 'string') return [primaria];
  const aplicada = h.status === 'aplicada';
  const numeroUso = (...chaves) => {
    const valor = chaves.map(chave => h.usage?.[chave]).find(v => typeof v === 'number' && Number.isFinite(v));
    return valor ?? null;
  };
  const metadados = {
    mensagemId: mensagem.id,
    estilo: h.estilo || 'ORIGINAL',
    statusHumanizacao: h.status || 'original',
    motivo: h.motivo || null,
    provider: h.provider || null,
    model: h.model || null,
    latenciaMs: h.latenciaMs ?? null,
  };
  return [
    primaria,
    {
      tipo: 'resposta_ajustada', titulo: 'Resposta ajustada',
      status: aplicada ? 'concluido' : h.status === 'fallback' ? 'alerta' : 'dispensada',
      resumo: aplicada ? `Comunicação ajustada no estilo ${h.estilo}.` : 'Ajuste não aplicado; resposta original entregue ao analista.',
      detalhes: {
        ...redigirValor(metadados),
        respostaCandidata: h.respostaCandidata ? redigirValor(h.respostaCandidata) : null,
        validacaoPreservacao: h.validacaoPreservacao ? redigirValor(h.validacaoPreservacao) : null,
        conteudo: redigirValor(aplicada && typeof h.respostaHumanizada === 'string' ? h.respostaHumanizada : h.respostaOriginal),
        consumoAdicional: {
          entrada: numeroUso('prompt_tokens', 'input_tokens', 'promptTokens', 'promptTokenCount'),
          saida: numeroUso('completion_tokens', 'output_tokens', 'completionTokens', 'candidatesTokenCount'),
          total: numeroUso('total_tokens', 'totalTokens', 'totalTokenCount'),
        },
      },
    },
  ];
}

function _statusLabel(status) {
  return STATUS_EXECUCAO_LABEL[status] || status || 'Desconhecido';
}

function _eventoLeituraHistorico(execucao) {
  const manifesto = execucao.manifesto || {};
  const disponiveis = manifesto.mensagensDisponiveis ?? null;
  const selecionadas = manifesto.mensagensSelecionadas ?? null;
  const dossie = manifesto.dossie || null;
  return {
    tipo: 'leitura_historico',
    titulo: 'Leitura do histórico e contexto',
    status: disponiveis === null ? 'indisponivel' : 'concluido',
    resumo: disponiveis === null
      ? 'Sem dados de manifesto registrados para esta execução.'
      : `${selecionadas ?? 0} de ${disponiveis} mensagem(ns) do histórico selecionadas para o contexto.`,
    detalhes: {
      mensagensDisponiveis: disponiveis,
      mensagensSelecionadas: selecionadas,
      dossieStatus: dossie?.status || null,
      dossieStale: dossie?.stale ?? null,
      dossieItensSelecionados: dossie?.itensSelecionados?.length ?? null,
      pendenciaConsolidada: manifesto.pendenciaConsolidada || null,
    },
  };
}

function _eventoAnexos(execucao) {
  const manifesto = execucao.manifesto || {};
  const selecionados = (manifesto.selecionados || []).filter(e => e.tipo === 'anexo' || e.tipo === 'imagem');
  const omitidos = (manifesto.omitidos || []).filter(e => e.tipo === 'anexo' || e.tipo === 'imagem');
  const total = (manifesto.anexosDisponiveis ?? 0);
  const observacoesVisuais = manifesto.observacoesVisuais || [];
  if (!total && selecionados.length === 0 && omitidos.length === 0) {
    return {
      tipo: 'processamento_anexos',
      titulo: 'Processamento de anexos',
      status: 'sem_dado',
      resumo: 'Nenhum anexo envolvido nesta execução.',
      detalhes: { processados: [], omitidos: [], observacoesVisuais: [] },
    };
  }
  return {
    tipo: 'processamento_anexos',
    titulo: 'Processamento de anexos',
    status: 'concluido',
    resumo: `${selecionados.length} anexo(s)/imagem(ns) processado(s)${omitidos.length ? `, ${omitidos.length} omitido(s)` : ''}${observacoesVisuais.length ? `, ${observacoesVisuais.length} observação(ões) visual(is) extraída(s)` : ''}.`,
    detalhes: {
      processados: selecionados.map(e => ({
        nome: e.nome || e.id,
        tipo: e.tipo,
        status: e.status,
        enviadoComoImagem: !!e.enviadoComoImagem,
        motivo: e.motivo || null,
      })),
      omitidos: omitidos.map(e => ({
        nome: e.nome || e.id,
        tipo: e.tipo,
        status: e.status,
        motivo: e.motivo || null,
      })),
      observacoesVisuais: observacoesVisuais.map(o => ({
        nome: o.nome || o.anexoId || null,
        observacao: o.observacao || null,
        textosVisiveis: o.textosVisiveis || [],
        campos: o.campos || [],
        valores: o.valores || [],
        confiancaVisual: o.confiancaVisual || null,
      })),
    },
  };
}

function _eventoPesquisaTecnica(execucao) {
  const pesquisa = execucao.pesquisa;
  if (!pesquisa) {
    return {
      tipo: 'pesquisa_tecnica',
      titulo: 'Pesquisa técnica',
      status: 'sem_dado',
      resumo: 'Nenhuma pesquisa técnica registrada nesta execução.',
      detalhes: null,
    };
  }
  if (pesquisa.modo === 'nao_pesquisado') {
    return {
      tipo: 'pesquisa_tecnica',
      titulo: 'Pesquisa técnica',
      status: 'dispensada',
      resumo: 'Pesquisa dispensada pelo plano investigativo (sem evidência técnica nova suficiente).',
      detalhes: { dominio: pesquisa.dominio, confianca: pesquisa.confianca },
    };
  }
  const paginas = pesquisa.paginasLidas || [];
  const tentativasBusca = pesquisa.tentativasBusca || [];
  return {
    tipo: 'pesquisa_tecnica',
    titulo: 'Pesquisa técnica',
    status: pesquisa.modo === 'web' ? 'concluido' : pesquisa.erroBusca ? 'erro' : 'sem_resultado',
    resumo: pesquisa.modo === 'web'
      ? `${paginas.length} fonte(s) consultada(s) via ${pesquisa.providerBusca || 'provider de busca'}.`
      : pesquisa.configurado
        ? 'Pesquisa configurada, mas sem resultado nesta tentativa.'
        : 'Pesquisa web não configurada para esta empresa.',
    detalhes: {
      dominio: pesquisa.dominio,
      confianca: pesquisa.confianca,
      consultasExecutadas: pesquisa.consultasExecutadas || [],
      providerBusca: pesquisa.providerBusca || null,
      tentativasBusca: tentativasBusca.map(t => ({ provider: t.provider, status: t.status, latenciaMs: t.latenciaMs ?? null })),
      fontes: paginas.map(p => ({ titulo: p.titulo || null, url: p.url || null, status: p.status || null, oficial: !!p.oficial })),
    },
  };
}

function _eventoDiagnosticoEstruturado(execucao) {
  const manifesto = execucao.manifesto || {};
  const quadro = manifesto.quadroInvestigativo || null;
  const prr = manifesto.planoRespostaRastreavel || null;
  if (!quadro && !prr) {
    return {
      tipo: 'diagnostico_estruturado',
      titulo: 'Construção do diagnóstico',
      status: 'sem_dado',
      resumo: 'Sem quadro investigativo estruturado registrado nesta execução.',
      detalhes: null,
    };
  }
  const evidenciasPorPapel = (quadro?.evidencias || []).reduce((acc, e) => {
    for (const p of e.papeis || []) acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  return {
    tipo: 'diagnostico_estruturado',
    titulo: 'Construção do diagnóstico',
    status: 'concluido',
    resumo: quadro?.problemaPrincipal
      ? `Estado operacional: ${quadro.estadoOperacional || 'não classificado'}; ${(quadro.evidencias || []).length} evidência(s) classificada(s); ${(quadro.lacunasInformacao || []).length} lacuna(s) identificada(s).`
      : 'Quadro investigativo disponível para esta execução.',
    detalhes: {
      problemaPrincipal: quadro?.problemaPrincipal || null,
      estadoOperacional: quadro?.estadoOperacional || null,
      evidenciasPorPapel,
      lacunasInformacao: quadro?.lacunasInformacao || [],
      acoesParaReduzirIncerteza: quadro?.acoesParaReduzirIncerteza || [],
      planoRespostaRastreavel: prr ? {
        fatosComprovados: (prr.fatosComprovados || []).length,
        hipotesesFundamentadas: (prr.hipotesesFundamentadas || []).length,
        termosTecnicosPermitidos: (prr.termosTecnicosPermitidos || []).length,
        lacunasObrigatorias: (prr.lacunasObrigatorias || []).map(l => ({ texto: l.texto, bloqueiaConclusao: !!l.bloqueiaConclusao })),
        proximoPassoRecomendado: prr.proximoPassoRecomendado?.descricao || null,
      } : null,
    },
  };
}

// usage_json vem do provider (ex.: {prompt_tokens, completion_tokens}) e passa
// por redigirValor na leitura — a regex de redação mascara qualquer chave que
// contenha "token" (pensada para token de autenticação), o que também atinge
// prompt_tokens/completion_tokens (contagem numérica, não segredo). Nesses
// casos usage.* chega como a string '[REDACTED]', não um número: cai para a
// estimativa própria da execução em vez de exibir o valor mascarado.
function _tokensUsage(usage, valorRedigido, estimativa) {
  const valor = usage?.[valorRedigido];
  return typeof valor === 'number' ? valor : (estimativa ?? null);
}

function _eventoChamadaProvider(execucao) {
  const tentativas = execucao.tentativas || [];
  const usage = execucao.usage || {};
  if (!tentativas.length && !execucao.provider) {
    return {
      tipo: 'chamada_provider',
      titulo: 'Diagnóstico por IA',
      status: 'sem_dado',
      resumo: 'Nenhuma chamada a provider de IA registrada nesta execução.',
      detalhes: null,
    };
  }
  const houveFallback = new Set(tentativas.map(t => t.provider)).size > 1;
  return {
    tipo: 'chamada_provider',
    titulo: 'Diagnóstico por IA',
    status: execucao.provider ? 'concluido' : 'erro',
    resumo: execucao.provider
      ? `Respondido por ${execucao.provider}${execucao.model ? ` (${execucao.model})` : ''}${houveFallback ? ', com fallback entre providers' : ''}.`
      : 'Nenhum provider respondeu com sucesso.',
    detalhes: {
      providerFinal: execucao.provider || null,
      modelFinal: execucao.model || null,
      latenciaMs: execucao.latenciaMs ?? null,
      tokensPrompt: _tokensUsage(usage, 'promptTokens', null) ?? _tokensUsage(usage, 'prompt_tokens', execucao.tokensEstimadosPrompt),
      tokensResposta: _tokensUsage(usage, 'completionTokens', null) ?? _tokensUsage(usage, 'completion_tokens', execucao.tokensEstimadosResposta),
      respostaTruncada: !!execucao.respostaTruncada,
      tentativas: tentativas.map(t => ({
        provider: t.provider,
        model: t.model || null,
        status: t.status,
        rodada: t.rodada ?? null,
        latenciaMs: t.latenciaMs ?? null,
        erro: t.erro || null,
      })),
    },
  };
}

function _eventoQualityGate(execucao) {
  const qg = execucao.qualityGate;
  if (!qg) {
    return {
      tipo: 'quality_gate',
      titulo: 'Quality Gate',
      status: 'sem_dado',
      resumo: 'Sem avaliação de Quality Gate registrada nesta execução.',
      detalhes: null,
    };
  }
  const falhas = qg.falhas || [];
  const retry = qg.retryCorretivo || null;
  const revisao = qg.revisaoNecessaria || null;
  const recuperacao = qg.recuperacaoDeterministica || null;
  return {
    tipo: 'quality_gate',
    titulo: 'Quality Gate',
    status: revisao ? 'bloqueado' : qg.aprovado ? 'aprovado' : 'alerta',
    resumo: revisao
      ? (revisao.motivo === 'resposta_truncada_pelo_provider'
        ? 'Resposta cortada pelo limite de tamanho da IA; entregue parcial com aviso.'
        : 'Resposta bloqueada para revisão humana após retry corretivo.')
      : qg.aprovado
        ? `Resposta aprovada sem ressalvas${recuperacao?.aplicada ? ' (após recuperação determinística)' : ''}.`
        : `${falhas.length} ponto(s) de atenção identificado(s)${retry?.executado ? ', com retry corretivo aplicado' : ''}.`,
    detalhes: {
      aprovado: qg.aprovado,
      deveRetry: qg.deveRetry,
      falhas: falhas.map(f => ({ codigo: f.codigo, severidade: f.severidade || null, categoria: f.decisionKind || f.categoriaDecisao || null, detalhe: f.detalhe || null })),
      decisoes: qg.decisoes || null,
      retryCorretivo: retry ? {
        executado: !!retry.executado,
        acoes: (retry.acoes || []).map(a => a.tipo),
        falhasAntes: (retry.antes?.qualityGate?.falhas || []).map(f => f.codigo),
        falhasDepois: (retry.depois?.qualityGate?.falhas || []).map(f => f.codigo),
      } : null,
      recuperacaoDeterministica: recuperacao ? { aplicada: !!recuperacao.aplicada, modo: recuperacao.modo || null, origem: recuperacao.origem || null } : null,
      revisaoNecessaria: revisao ? { motivo: revisao.motivo, falhas: revisao.falhas || [] } : null,
      criterios: qg.criterios || null,
      // Proveniencia das referencias tecnicas citadas (transparencia: o que
      // consta no chamado, na pesquisa ou e conhecimento/hipotese do modelo).
      proveniencia: qg.proveniencia ? {
        contagem: qg.proveniencia.contagem || null,
        atribuicoesFalsas: qg.proveniencia.atribuicoesFalsas ?? 0,
        referencias: qg.proveniencia.referencias || [],
      } : null,
    },
  };
}

/**
 * Monta a trilha de uma única execução: lista ordenada de eventos + metadados
 * de cabeçalho (status geral, timestamps, ids de mensagem).
 */
function montarTrilhaDaExecucao(execucao, mensagem = null) {
  return {
    execucaoId: execucao.id,
    criadoEm: execucao.criadoEm,
    status: execucao.status,
    statusLabel: _statusLabel(execucao.status),
    mensagemId: execucao.mensagemId,
    mensagemUsuarioId: execucao.mensagemUsuarioId,
    provider: execucao.provider,
    model: execucao.model,
    latenciaMs: execucao.latenciaMs,
    retryDeQualityGate: !!execucao.retryDeQualityGate,
    eventos: [
      _eventoLeituraHistorico(execucao),
      _eventoAnexos(execucao),
      _eventoPesquisaTecnica(execucao),
      _eventoDiagnosticoEstruturado(execucao),
      _eventoChamadaProvider(execucao),
      _eventoQualityGate(execucao),
      ..._eventosComunicacao(mensagem),
    ],
  };
}

/**
 * Monta a trilha completa do atendimento: uma entrada por execução,
 * ordenadas da mais antiga para a mais recente (ordem de leitura natural de
 * uma linha do tempo).
 */
function montarTrilha(execucoes = [], mensagens = []) {
  const porId = new Map(mensagens.map(m => [m.id, m]));
  const vinculadas = new Set(execucoes.map(e => e.mensagemId));
  const trilha = execucoes.map(e => montarTrilhaDaExecucao(e, porId.get(e.mensagemId)));
  // Conversas curtas não criam execução investigativa. A auditoria usa a
  // própria mensagem, sem inventar uma investigação nem duplicar persistência.
  for (const m of mensagens) {
    if (m.papel !== 'assistant' || vinculadas.has(m.id) || !m.respostaCurta) continue;
    const eventos = _eventosComunicacao(m);
    if (!eventos.length) continue;
    trilha.push({ execucaoId: `conversa-${m.id}`, origem: 'conversa', criadoEm: m.criadoEm,
      mensagemId: m.id, status: 'concluido', statusLabel: 'Conversa com a IA', eventos });
  }
  return trilha.sort((a, b) => new Date(a.criadoEm) - new Date(b.criadoEm));
}

module.exports = { montarTrilha, montarTrilhaDaExecucao };
