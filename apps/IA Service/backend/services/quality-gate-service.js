'use strict';

const investigativeDiscipline = require('./investigative-discipline-service');

function _temRespostaGenerica(texto) {
  const s = String(texto || '').toLowerCase();
  if (s.length < 450) return true;
  const genericos = [
    'verifique os logs',
    'envie mais informacoes',
    'envie mais informações',
    'pode ser um problema de configuracao',
    'pode ser um problema de configuração',
    'recomendo verificar',
  ];
  return genericos.filter(g => s.includes(g)).length >= 2 && !/\*\*evid[eê]ncias\*\*|fonte corrigido|linha|stack|exception|erro/i.test(texto || '');
}

function _normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function _temJustificativa(texto) {
  const s = _normalizar(texto);
  return /\b(porque|devido|pois|apos|nova evidencia|mudou|alterou|repetir.*rev|novo log|periodo diferente|execucao diferente|ambiente mudou|versao nova|revalidar)\b/i.test(s);
}

function _avaliarRegressaoInvestigativa(textoResposta, manifesto) {
  const falhas = [];
  const resposta = _normalizar(textoResposta);
  const guard = manifesto?.dossie?.regressaoGuard || {};
  const justificavel = _temJustificativa(textoResposta);

  for (const teste of guard.testesExecutados || []) {
    if (!teste.codigo || !resposta.includes(_normalizar(teste.codigo))) continue;
    if (/\b(faca|execute|reteste|repita|realize|rode)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_TESTE_REPETIDO',
        severidade: 'media',
        itemCodigo: teste.codigo,
        detalhe: 'teste ja executado/encerrado citado como proximo passo sem justificativa nova',
        acaoCorretiva: 'nao_repetir_teste_sem_justificativa',
      });
    }
  }

  for (const hipotese of guard.hipotesesDescartadas || []) {
    if (!hipotese.codigo || !resposta.includes(_normalizar(hipotese.codigo))) continue;
    if (/\b(causa|provavel|hipotese|deve ser)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_HIPOTESE_DESCARTADA',
        severidade: 'media',
        itemCodigo: hipotese.codigo,
        detalhe: 'hipotese descartada reapresentada sem nova evidencia',
        acaoCorretiva: 'reconhecer_descarte_ou_justificar_reconsideracao',
      });
    }
  }

  for (const ev of manifesto?.dossie?.evidenciasRecuperadas || []) {
    const nome = _normalizar(ev.nome || '');
    if (nome.length < 4 || !resposta.includes(nome)) continue;
    if (/\b(envie|mande|anexe|encaminhe|preciso do|solicite)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_EVIDENCIA_JA_RECEBIDA',
        severidade: 'media',
        evidencia: ev.nome || ev.id,
        detalhe: 'evidencia recuperada pelo dossie foi solicitada novamente sem motivo',
        acaoCorretiva: 'nao_pedir_evidencia_ja_recebida_sem_justificativa',
      });
    }
  }

  for (const solucao of guard.solucoesFalhas || []) {
    const termos = _normalizar(solucao.descricao || '').split(/\s+/).filter(t => t.length >= 4).slice(0, 8);
    if (termos.length && termos.some(t => resposta.includes(t)) && /\b(aplicar|aplique|solucao|corrigir)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_SOLUCAO_FALHA',
        severidade: 'media',
        itemCodigo: solucao.codigo,
        detalhe: 'solucao/resultado ja negativo reaparece como novidade sem justificativa',
        acaoCorretiva: 'evitar_solucao_ja_falha_sem_nova_razao',
      });
      break;
    }
  }

  return falhas;
}

function avaliarResposta({ textoResposta, manifesto, pesquisa, pergunta, houveRetry = false } = {}) {
  const falhas = [];
  const resposta = String(textoResposta || '');
  const perguntaTexto = String(pergunta || '');
  const selecionados = manifesto?.selecionados || [];
  const omitidos = manifesto?.omitidos || [];
  const analisados = selecionados.filter(e => e.status === 'ANALISADA' || e.status === 'PARCIALMENTE_ANALISADA');
  const anexosAnalisados = analisados.filter(e => e.tipo === 'anexo' || e.tipo === 'imagem');
  const pedeAnexo = /\b(anexo|arquivo|fonte|log|print|imagem|screenshot|pdf|compare|ver novamente)\b/i.test(perguntaTexto);
  const evidenciaCriticaOmitida = omitidos.find(e => (e.score || 0) >= 80 && e.status !== 'NAO_SUPORTADA');

  if (pedeAnexo && anexosAnalisados.length === 0) {
    falhas.push({ codigo: 'ATTACHMENT_NOT_ANALYZED', legado: 'PERGUNTA_PEDE_ANEXO_SEM_ANEXO_ANALISADO', severidade: 'alta', acaoCorretiva: 'reconstruir_contexto_com_anexo_ou_visual' });
  }
  if (evidenciaCriticaOmitida) {
    falhas.push({ codigo: 'CRITICAL_EVIDENCE_OMITTED', legado: 'EVIDENCIA_CRITICA_OMITIDA', severidade: 'alta', evidencia: evidenciaCriticaOmitida.nome || evidenciaCriticaOmitida.id, evidenciaId: evidenciaCriticaOmitida.id, acaoCorretiva: 'forcar_evidencia_no_retry' });
  }
  if (_temRespostaGenerica(resposta) && analisados.length > 0) {
    falhas.push({ codigo: 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE', legado: 'RESPOSTA_GENERICA_COM_EVIDENCIA_DISPONIVEL', severidade: 'media', acaoCorretiva: 'reforcar_evidencias_especificas' });
  }
  falhas.push(...investigativeDiscipline.avaliarAfirmacoes({
    textoResposta: resposta,
    evidenciasTexto: [
      perguntaTexto,
      ...(analisados || []).map(e => `${e.nome || e.id || ''} ${e.trecho || e.resumo || e.conteudo || ''}`),
      pesquisa?.plano ? JSON.stringify(pesquisa.plano) : '',
    ].filter(Boolean).join('\n'),
    manifesto: { ...manifesto, pesquisa },
  }));
  falhas.push(..._avaliarRegressaoInvestigativa(resposta, manifesto));
  if (/pesquis|tdn|totvs|softexpert|documenta[cç][aã]o|fonte oficial/i.test(perguntaTexto)) {
    if (!pesquisa?.configurado) falhas.push({ codigo: 'RESEARCH_REQUIRED_NOT_EXECUTED', legado: 'PESQUISA_NAO_CONFIGURADA', severidade: 'media', acaoCorretiva: 'informar_pesquisa_indisponivel' });
    else if (pesquisa?.modo !== 'web') falhas.push({ codigo: 'RESEARCH_CONFIGURED_WITHOUT_RESULTS', legado: 'PESQUISA_CONFIGURADA_SEM_RESULTADO', severidade: 'baixa' });
    else if (!(pesquisa?.paginasLidas || []).some(p => p.status === 'lida')) falhas.push({ codigo: 'RESEARCH_FOUND_BUT_NOT_READ', legado: 'PESQUISA_SEM_PAGINA_LIDA', severidade: 'media', acaoCorretiva: 'tentar_fetch_seguro' });
  }

  const deveRetry = !houveRetry && falhas.some(f => ['alta', 'media'].includes(f.severidade));
  return {
    aprovado: falhas.length === 0,
    deveRetry,
    falhas,
    criterios: {
      anexosAnalisados: anexosAnalisados.length,
      evidenciasSelecionadas: selecionados.length,
      evidenciasOmitidas: omitidos.length,
      dossieStatus: manifesto?.dossie?.status || null,
      dossieStale: manifesto?.dossie?.stale ?? null,
      dossieItensSelecionados: manifesto?.dossie?.itensSelecionados?.length || 0,
      pesquisaModo: pesquisa?.modo || null,
      paginasLidas: (pesquisa?.paginasLidas || []).filter(p => p.status === 'lida').length,
    },
  };
}

function montarInstrucaoRetry(gate) {
  const falhas = (gate?.falhas || []).map(f => f.codigo).join(', ');
  const regressao = (gate?.falhas || []).filter(f => String(f.codigo || '').startsWith('REGRESSAO_INVESTIGATIVA'));
  // Achado real, Caso #001 (2026-10): quando pesquisa era necessária mas não
  // pôde ser executada (sem chave configurada) OU foi mal interpretada pelo
  // plano, a resposta seguia como se a investigação externa tivesse sido
  // considerada normalmente, sem declarar a limitação — o usuário via uma
  // "causa provável" repetida sem saber que nenhuma fonte externa real foi
  // consultada. Esta instrução não inventa resultado nem força retry
  // infinito (deveRetry já é limitado a 1 tentativa em investigacao-service.js);
  // apenas garante que, quando a 2ª tentativa ainda carregar essa falha, o
  // texto final seja obrigado a declarar a limitação explicitamente.
  const pesquisaIndisponivel = (gate?.falhas || []).some(f => f.codigo === 'RESEARCH_REQUIRED_NOT_EXECUTED');
  return [
    'A resposta anterior falhou no Quality Gate interno.',
    `Falhas detectadas: ${falhas || 'nao especificadas'}.`,
    regressao.length ? `Regressao investigativa detectada: ${regressao.map(f => `${f.codigo}${f.itemCodigo ? ` em ${f.itemCodigo}` : ''}${f.evidencia ? ` em ${f.evidencia}` : ''}`).join('; ')}.` : '',
    regressao.length ? 'Use o estado atual do dossie: nao repita teste/evidencia/hipotese/solucao ja encerrados sem justificar explicitamente qual evidencia ou mudanca nova torna a repeticao necessaria.' : '',
    'Refaca a analise usando explicitamente as evidencias selecionadas no manifesto. Cite as evidencias tecnicas que sustentam o diagnostico.',
    'Se a evidencia necessaria nao estiver disponivel ou nao for suportada, diga isso objetivamente e peca a evidencia especifica que falta.',
    'Se uma causa ou fato tecnico nao estiver sustentado, rebaixe para hipotese explicita e informe a lacuna/proximo passo de maior valor.',
    pesquisaIndisponivel ? 'Pesquisa tecnica externa era necessaria para esta pergunta mas nao pode ser executada (mecanismo de busca indisponivel nesta instalacao). Declare isso explicitamente na resposta ao usuario — nao apresente a causa como se tivesse sido corroborada por fonte externa, e nao finja ter pesquisado.' : '',
  ].filter(Boolean).join('\n');
}

module.exports = { avaliarResposta, montarInstrucaoRetry, _avaliarRegressaoInvestigativa };
