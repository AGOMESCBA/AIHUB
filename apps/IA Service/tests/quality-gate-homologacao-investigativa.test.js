const assert = require('assert');

const qualityGate = require('../backend/services/quality-gate-service');
const investigacaoService = require('../backend/services/investigacao-service');
const pesquisaService = require('../backend/services/technical-research-service');
const safeFetch = require('../backend/services/safe-web-fetch-service');

function falha(gate, codigo) {
  return (gate.falhas || []).some(f => f.codigo === codigo);
}

function manifestoComEvidenciaAusente() {
  return {
    selecionados: [
      {
        tipo: 'anexo',
        status: 'ANALISADA',
        nome: 'retorno-esocial-parcial.pdf',
        trecho: 'Evento S-2240. Ocorrencia 723. Observacao: XML original e log TSS nao anexados.',
      },
    ],
    omitidos: [],
    quadroInvestigativo: {
      evidencias: [
        {
          referencia: 'retorno-esocial-parcial.pdf',
          resumo: 'Ocorrencia 723; XML original e log TSS nao anexados.',
          papeis: ['CENTRAL'],
        },
      ],
      lacunasInformacao: ['XML original e log TSS nao anexados.'],
    },
    planoRespostaRastreavel: {
      lacunasObrigatorias: [
        { texto: 'XML original e log TSS nao anexados.', bloqueiaConclusao: true },
      ],
      termosTecnicosPermitidos: [
        { termo: 'S-2240', usoPermitido: 'evidencia_interna', causalPermitido: false, origens: [{ origem: 'anexo' }] },
        { termo: '723', usoPermitido: 'evidencia_interna', causalPermitido: false, origens: [{ origem: 'anexo' }] },
      ],
    },
  };
}

function testarContradicaoFactualBloqueada() {
  const gate = qualityGate.avaliarResposta({
    textoResposta: 'O PDF contem o XML completo do S-2240 e mostra que a tag de ambiente foi enviada incorretamente.',
    manifesto: manifestoComEvidenciaAusente(),
    pesquisa: null,
    pergunta: 'Analise o PDF e diga o proximo passo.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gate, 'FACTUAL_CONTRADICTION_WITH_MISSING_EVIDENCE'), true, 'deve bloquear afirmacao de XML completo quando a evidencia diz que o XML nao foi anexado');
  assert.strictEqual(gate.decisoes.bloqueiosObjetivos >= 1, true, 'contradicao factual deve ser bloqueio objetivo');
}

function testarHipoteseComLacunaPermitida() {
  const gate = qualityGate.avaliarResposta({
    textoResposta: 'A rejeicao 723 indica uma hipotese de divergencia no cadastro de ambientes. Ainda nao da para confirmar a causa porque o XML original e o log TSS nao foram anexados. O proximo teste e comparar o codigo de ambiente cadastrado no TAF com o codigo enviado no XML e coletar o log TSS do horario da rejeicao.',
    manifesto: manifestoComEvidenciaAusente(),
    pesquisa: null,
    pergunta: 'Analise o PDF e diga o proximo passo.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gate, 'FACTUAL_CONTRADICTION_WITH_MISSING_EVIDENCE'), false, 'hipotese que reconhece XML/log ausentes deve ser permitida pela regra factual');
}

function testarTruncamentoFailClosed() {
  const status = investigacaoService._statusFinalExecucao({
    qualityGate: { aprovado: true, falhas: [], decisoes: {} },
    retryDeQualityGate: false,
    respostaTruncada: true,
  });
  assert.strictEqual(status, 'revisao_necessaria_quality_gate', 'resposta truncada nunca pode finalizar como concluida');
}

function testarPesquisaSoftExpertPriorizaDocsTecnicos() {
  const plano = pesquisaService.montarConsultas({
    atendimento: {
      conteudoBruto: 'Sistema/modulo: SoftExpert / Workflow\nCallback API nao avanca etapa apos HTTP 200.',
    },
    mensagens: [
      { conteudo: 'Log informa callback recebido e workflow permanece na atividade por pending responsible role resolution.' },
    ],
  });
  assert.strictEqual(plano.dominio, 'softexpert');
  assert.ok(plano.consultas.some(q => q.includes('site:documentation.softexpert.com')), 'deve priorizar documentation.softexpert.com');
  assert.ok(plano.consultas.some(q => q.includes('site:developer.softexpert.com')), 'deve priorizar developer.softexpert.com');
}

function testarReferenciaExternaComoQualificadorDeModulo() {
  const manifesto = {
    selecionados: [
      { tipo: 'mensagem', status: 'ANALISADA', trecho: 'Pedido aprovado via workflow permanece em aprovacao. Correcao aplicada por ponto de entrada; aguardando validacao.' },
    ],
    omitidos: [],
    planoRespostaRastreavel: {
      termosTecnicosPermitidos: [
        { termo: 'SIGACOM', usoPermitido: 'apoio_externo_apenas', causalPermitido: false, origens: [{ origem: 'pesquisa_externa' }] },
      ],
      lacunasObrigatorias: [],
    },
  };
  const gate = qualityGate.avaliarResposta({
    textoResposta: 'A causa identificada pela Fabrica foi a falha no disparo automatico de e-mail em rotina padrao do Protheus, no modulo Compras/SIGACOM. O proximo passo e validar se o pedido aprovado no workflow atualiza o status apos o ponto de entrada aplicado.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o chamado de compras.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gate, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), false, 'referencia externa usada como qualificador de modulo nao deve ser tratada como causa');

  const gateCausal = qualityGate.avaliarResposta({
    textoResposta: 'O SIGACOM causou o travamento do workflow e corrigir o SIGACOM resolvera o pedido.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o chamado de compras.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gateCausal, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), true, 'referencia externa promovida a causa deve continuar bloqueada');
}

function testarCausaDefinitivaComFonteParcialBloqueada() {
  const manifesto = {
    selecionados: [
      {
        tipo: 'anexo',
        status: 'ANALISADA',
        nome: 'FATDANFE_CUSTOM.PRW',
        trecho: 'Trecho do fonte customizado: If Empty(cSerieDanfe) cSerieDanfe := cSerie EndIf.',
      },
      {
        tipo: 'anexo',
        status: 'ANALISADA',
        nome: 'appserver-danfe.log',
        trecho: 'ERROR: variable cSerieDanfe does not exist on U_DANFEPRINT(FATDANFE_CUSTOM.PRW) line 87.',
      },
    ],
    omitidos: [],
    planoRespostaRastreavel: {
      lacunasObrigatorias: [
        { texto: 'Fonte completo ainda nao foi validado; ha apenas trecho do fonte.', bloqueiaConclusao: true },
      ],
      termosTecnicosPermitidos: [
        { termo: 'cSerieDanfe', usoPermitido: 'evidencia_interna', causalPermitido: false, origens: [{ origem: 'anexo' }] },
      ],
    },
  };
  const gate = qualityGate.avaliarResposta({
    textoResposta: 'A ponte causal e direta: a causa tecnica e a falta de declaracao Local cSerieDanfe no inicio da funcao. Adicionar Local cSerieDanfe resolve o erro especifico.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o trecho do fonte e o log.',
    historicoMensagens: [
      { conteudo: 'Foi anexado log AppServer e trecho do fonte customizado.' },
    ],
  });
  assert.strictEqual(falha(gate, 'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE'), true, 'fonte parcial nao pode sustentar causa definitiva de escopo');

  const gateComRessalvaTardia = qualityGate.avaliarResposta({
    textoResposta: 'A ponte causal e direta: a variavel cSerieDanfe nao existe no escopo da funcao e isso e o erro. Mais abaixo, sem ver o arquivo completo, nao consigo confirmar se foi removida ou se era global.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o trecho do fonte e o log.',
    historicoMensagens: [
      { conteudo: 'Foi anexado log AppServer e trecho do fonte customizado.' },
    ],
  });
  assert.strictEqual(falha(gateComRessalvaTardia, 'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE'), true, 'ressalva em outro paragrafo nao deve liberar afirmacao conclusiva sobre fonte parcial');

  const gateCausaClara = qualityGate.avaliarResposta({
    textoResposta: 'A causa esta clara no log: a variavel cSerieDanfe foi usada sem Local. Ainda assim, peca o fonte completo para conferir outras referencias.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o trecho do fonte e o log.',
    historicoMensagens: [
      { conteudo: 'Foi anexado log AppServer e trecho do fonte customizado.' },
    ],
  });
  assert.strictEqual(falha(gateCausaClara, 'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE'), true, 'frase "causa esta clara" com fonte parcial deve ser bloqueada mesmo que peca fonte depois');

  const gateHipotese = qualityGate.avaliarResposta({
    textoResposta: 'A hipotese mais provavel e problema de escopo de cSerieDanfe, mas preciso confirmar no fonte completo se a variavel e inicializada em outro ponto. O teste e compilar com a declaracao adequada em ambiente controlado e repetir a impressao da DANFE.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o trecho do fonte e o log.',
    historicoMensagens: [
      { conteudo: 'Foi anexado log AppServer e trecho do fonte customizado.' },
    ],
  });
  assert.strictEqual(falha(gateHipotese, 'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE'), false, 'hipotese com teste e fonte completo pendente deve ser permitida');
}

async function testarPesquisaAbreProximoResultadoQuandoOficialFalha() {
  const oldFetch = safeFetch.fetchTextoSeguro;
  const chamadas = [];
  safeFetch.fetchTextoSeguro = async (url, opts = {}) => {
    chamadas.push({ url, opts });
    if (url.includes('/workflow/')) throw new Error('Pagina excede limite de download.');
    return {
      url,
      contentType: 'text/html',
      bytes: 1200,
      raw: '<html><body>SoftExpert Workflow callback API transition responsible role resolution activity audit log.</body></html>',
      redirects: [],
    };
  };
  try {
    const resultados = [
      { titulo: 'Workflow marketing', url: 'https://www.softexpert.com/en/module/workflow/', trecho: 'workflow', consulta: 'SoftExpert Workflow', fonte: 'Serper/Google' },
      { titulo: 'Workflow marketing duplicado', url: 'https://www.softexpert.com/en/module/workflow/', trecho: 'workflow', consulta: 'SoftExpert Workflow', fonte: 'Serper/Google' },
      { titulo: 'Integration Services', url: 'https://www.softexpert.com/en/services/integration/', trecho: 'integration api', consulta: 'SoftExpert Workflow', fonte: 'Serper/Google' },
    ];
    const paginas = await pesquisaService._abrirResultados(resultados, 1, {
      dominio: 'softexpert',
      sinaisTecnicos: { produtos: ['SoftExpert'], http: ['200'] },
      fontesPrioritarias: ['softexpert.com', 'developer.softexpert.com', 'documentation.softexpert.com'],
      objetivo: 'SoftExpert workflow callback HTTP 200 activity',
    }, { maxTentativas: 4 });
    assert.ok(chamadas.length >= 2, 'deve tentar outro resultado quando o primeiro oficial falha');
    assert.strictEqual(chamadas.filter(c => c.url.includes('/workflow/')).length, 2, 'URL grande pode ter retry com limite maior, mas resultado duplicado nao deve gerar terceira abertura');
    assert.ok(paginas.some(p => p.status === 'lida' && p.url.includes('/integration/')), 'deve preservar conteudo lido de resultado oficial alternativo');
  } finally {
    safeFetch.fetchTextoSeguro = oldFetch;
  }
}

function testarSoftExpertNaoPromovePermissaoACausaConfirmada() {
  const manifesto = {
    selecionados: [
      {
        tipo: 'anexo',
        status: 'ANALISADA',
        nome: 'callback-workflow.log',
        trecho: 'HTTP 200 callback received. WARN process remains at ACT-VALIDACAO; pending responsible role resolution.',
      },
    ],
    omitidos: [],
    planoRespostaRastreavel: {
      lacunasObrigatorias: [
        { texto: 'Falta log interno do workflow e configuracao da atividade.', bloqueiaConclusao: true },
      ],
      termosTecnicosPermitidos: [
        { termo: 'ACT-VALIDACAO', usoPermitido: 'evidencia_interna', causalPermitido: false, origens: [{ origem: 'anexo' }] },
      ],
    },
  };
  const gate = qualityGate.avaliarResposta({
    textoResposta: 'A permissao do usuario de integracao bloqueou a transicao e explica por que o callback foi aceito mas a atividade nao avancou.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o callback SoftExpert Workflow.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gate, 'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE'), true, 'permissao/papel nao pode virar causa confirmada sem log interno/configuracao');

  const gateHipotese = qualityGate.avaliarResposta({
    textoResposta: 'O aviso pending responsible role resolution sugere hipotese de papel/responsavel pendente, mas isso precisa ser confirmado no log interno do workflow e na configuracao da atividade ACT-VALIDACAO.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise o callback SoftExpert Workflow.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gateHipotese, 'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE'), false, 'hipotese com lacuna e teste deve ser permitida');
}

function testarMensagemOperacionalIncidentalNaoBloqueiaFonteCentral() {
  const manifesto = {
    quadroInvestigativo: {
      evidencias: [
        {
          referencia: 'fonte.prw',
          papeis: ['CENTRAL', 'TECNICA_RELACIONADA'],
          resumo: 'Fonte mostra uso da variavel cSerieDanfe.',
        },
        {
          referencia: 'msg-operacional',
          papeis: ['OPERACIONAL', 'INCIDENTAL'],
          resumo: 'Foi anexado log AppServer e trecho do fonte customizado.',
        },
      ],
    },
    selecionados: [
      { tipo: 'anexo', status: 'ANALISADA', nome: 'fonte.prw', trecho: 'If Empty(cSerieDanfe)' },
    ],
  };
  const gate = qualityGate.avaliarResposta({
    textoResposta: 'O log AppServer e o fonte indicam hipotese de variavel cSerieDanfe sem declaracao no escopo. O proximo passo e conferir o fonte completo, compilar em homologacao e executar a impressao controlada.',
    manifesto,
    pesquisa: null,
    pergunta: 'Analise DANFE.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gate, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE'), false, 'mensagem operacional incidental sobre anexo nao deve bloquear uso da evidencia tecnica central');
}

function testarPesquisaSemPaginaLidaComLimitacaoDeclarada() {
  const pesquisa = {
    configurado: true,
    modo: 'web',
    paginasLidas: [
      { status: 'erro_fetch', titulo: 'SoftExpert Workflow', url: 'https://www.softexpert.com/en/module/workflow/', erro: 'Pagina excede limite de download.' },
    ],
  };
  const gate = qualityGate.avaliarResposta({
    textoResposta: 'A pesquisa retornou links oficiais, mas nenhuma pagina foi lida com conteudo utilizavel. Vou conduzir a investigacao pelas evidencias internas: HTTP 200 confirma recebimento do callback, enquanto a atividade parada sugere hipotese de resolucao de responsavel pendente a confirmar no log interno do workflow.',
    manifesto: { selecionados: [{ tipo: 'anexo', status: 'ANALISADA', nome: 'callback.log', trecho: 'HTTP 200; remains at ACT-VALIDACAO; pending responsible role resolution.' }] },
    pesquisa,
    pergunta: 'Use pesquisa tecnica e analise SoftExpert Workflow.',
    historicoMensagens: [],
  });
  assert.strictEqual(falha(gate, 'RESEARCH_FOUND_BUT_NOT_READ'), false, 'pesquisa sem pagina lida deve ser permitida quando a resposta declara a limitacao e nao finge documentacao consultada');
}

testarContradicaoFactualBloqueada();
testarHipoteseComLacunaPermitida();
testarTruncamentoFailClosed();
testarPesquisaSoftExpertPriorizaDocsTecnicos();
testarReferenciaExternaComoQualificadorDeModulo();
testarCausaDefinitivaComFonteParcialBloqueada();
testarSoftExpertNaoPromovePermissaoACausaConfirmada();
testarMensagemOperacionalIncidentalNaoBloqueiaFonteCentral();
testarPesquisaSemPaginaLidaComLimitacaoDeclarada();
testarPesquisaAbreProximoResultadoQuandoOficialFalha()
  .then(() => console.log('quality-gate-homologacao-investigativa.test.js OK'))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
