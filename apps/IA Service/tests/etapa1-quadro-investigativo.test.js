// Regressao da Etapa 1: Quadro Investigativo no Context Engine.
//
// Casos sinteticos/anonimizados baseados nos chamados reais #036475, #035988,
// #036726 e #036596. O objetivo nao e "passar teste por ticket", mas garantir
// que o motor entregue ao modelo uma hierarquia de evidencias e que o Quality
// Gate bloqueie conclusoes sem ponte causal.

const assert = require('assert');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-quadro-investigativo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const contextEngine = require('../backend/services/context-engine');
const qualityGateService = require('../backend/services/quality-gate-service');
const investigacaoService = require('../backend/services/investigacao-service');
const planoRespostaRastreavel = require('../backend/services/plano-resposta-rastreavel-service');
const promptBuilder = require('../backend/services/prompt-builder');

const EMPRESA = 99041;

function seedAtendimento(conteudoBruto) {
  return atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: 'softexpert',
    canalEntrada: 'radar',
    conteudoBruto,
  });
}

function salvarMsg(atendimento, papel, conteudo) {
  return mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel, conteudo });
}

function salvarAnexo(atendimento, dados) {
  return anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimento.id, {
    nomeOriginal: dados.nomeOriginal,
    nomeInterno: dados.nomeOriginal,
    mimeType: dados.mimeType || 'text/plain',
    tamanho: dados.tamanho || String(dados.conteudoExtraido || '').length || 10,
    caminhoRelativo: `teste/${dados.nomeOriginal}`,
    conteudoExtraido: dados.conteudoExtraido,
    linguagemDetectada: dados.linguagemDetectada || null,
    eCodigo: !!dados.eCodigo,
  });
}

function montarContexto(atendimento, mensagemAtual, extra = {}) {
  const historico = mensagemRepo.listarMensagens(EMPRESA, atendimento.id);
  return contextEngine.montarContextoInvestigacao({
    atendimento,
    mensagens: historico,
    mensagemAtual,
    anexosDoTurno: extra.anexosDoTurno || [],
    pesquisaTecnicaTexto: '',
    pesquisa: null,
    relacionados: [],
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg: { modelos: { groq: 'openai/gpt-oss-20b' }, provedorPrimario: 'groq' },
    chamado: extra.chamado || null,
  });
}

function falha(gate, codigo) {
  return gate.falhas.some(f => f.codigo === codigo);
}

function testarCaso036475_ComprasNaoPromoveContabilidadeIncidental() {
  const atendimento = seedAtendimento('Pedido de compras nao muda o status apos aprovacao via workflow.');
  salvarMsg(atendimento, 'customer', 'Quando geramos um pedido de compra ele envia o WF para aprovacao. O usuario aprova pelo WF, porem no sistema o status fica como em aprovacao.');
  salvarMsg(atendimento, 'user', 'Foi aberta Fabrica para acompanhar o problema.');
  salvarMsg(atendimento, 'user', 'A analise indicou rotina padrao: o e-mail automatico ao aprovador nao estava sendo enviado. O chamado foi encaminhado a TOTVS com ticket 999999.');
  salvarMsg(atendimento, 'user', 'A correcao do disparo de e-mail foi realizada por ponto de entrada e ja esta aplicada em producao. Enviando o chamado para validacao.');
  const printContabil = salvarAnexo(atendimento, {
    nomeOriginal: 'print-fina050-contabilidade.png',
    mimeType: 'image/png',
    conteudoExtraido: 'Help FINA050 - CONTAS A PAGAR. O titulo U 6498 NF 00701101 possui movimentos sem contabilizacao.',
  });

  const contexto = montarContexto(atendimento, 'Qual o proximo passo para resolver o chamado?', { anexosDoTurno: [printContabil] });
  const quadro = contexto.manifesto.quadroInvestigativo;

  assert.ok(quadro, 'manifesto deve conter quadroInvestigativo');
  assert.ok(/Compras/.test(quadro.dominioModuloProvavel), 'problema principal deve permanecer em compras/workflow');
  assert.strictEqual(quadro.estadoOperacional, 'correcao_aplicada_pendente_validacao', 'correcao aplicada em producao deve virar pendencia de validacao, nao investigacao inicial');
  assert.ok(
    quadro.evidencias.some(e => e.referencia === 'print-fina050-contabilidade.png' && e.papeis.includes('INCIDENTAL') && /Vinculo causal nao demonstrado/.test(e.vinculoCausal)),
    'print contabil deve ser evidencia incidental sem ponte causal demonstrada'
  );
  assert.ok(/Quadro investigativo estruturado/.test(contexto.userPrompt), 'prompt deve incluir o quadro investigativo');

  const respostaRuim = 'O problema do status deve estar sendo impactado pelos titulos com movimentos sem contabilidade. Recomendo verificar os titulos no FINA050 e regularizar a contabilizacao antes de testar novamente a aprovacao.';
  const gateRuim = qualityGateService.avaliarResposta({
    textoResposta: respostaRuim,
    manifesto: contexto.manifesto,
    pergunta: 'Qual o proximo passo?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(
    falha(gateRuim, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE'),
    'Quality Gate deve reprovar promocao de evidencia incidental sem ponte causal'
  );

  const respostaBoa = 'O que muda a analise e que ja houve correcao aplicada em producao por ponto de entrada e o chamado foi enviado para validacao. O print do FINA050 e de outro dominio e, sem ponte causal demonstrada com o status do pedido, eu nao usaria isso como causa. Agora eu validaria o fluxo original: gerar pedido, aprovar pelo workflow, confirmar disparo do e-mail e checar se o status saiu de em aprovacao.';
  const gateBom = qualityGateService.avaliarResposta({
    textoResposta: respostaBoa,
    manifesto: contexto.manifesto,
    pergunta: 'Qual o proximo passo?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(!falha(gateBom, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE'), 'resposta que reconhece limite causal nao deve ser bloqueada');
  assert.ok(!falha(gateBom, 'INVESTIGATIVE_FRAME_OPERATIONAL_STAGE_IGNORED'), 'resposta que prioriza validacao nao deve ignorar estado operacional');
}

function testarCaso035988_ContratosEmTesteNaoReabreFabrica() {
  const atendimento = seedAtendimento('Regra de saldo contrato agricola.');
  salvarMsg(atendimento, 'customer', 'As devolucoes estao exigindo inclusao manual de saldo para serem lancadas.');
  salvarMsg(atendimento, 'user', 'Favor abrir uma Fabrica para analisar a regra de saldo do contrato agricola.');
  salvarMsg(atendimento, 'user', 'Aguardando a confirmacao do teste ja solicitado para darmos sequencia no chamado.');

  const contexto = montarContexto(atendimento, 'O que falta para avancar?');
  const quadro = contexto.manifesto.quadroInvestigativo;

  assert.ok(/Contratos agricolas/.test(quadro.dominioModuloProvavel), 'dominio deve refletir contratos agricolas');
  assert.strictEqual(quadro.estadoOperacional, 'validacao_solicitada_ou_aguardando_confirmacao', 'teste solicitado depois da Fabrica deve virar validacao pendente, nao triagem');
  assert.ok(quadro.acoesSolicitadasOuPlanejadas.some(a => a.tipo === 'validacao'), 'teste/validacao solicitada deve aparecer como acao pendente');

  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Como proximo passo, recomendo abrir uma Fabrica para investigar a regra de saldo do contrato agricola.',
    manifesto: contexto.manifesto,
    pergunta: 'O que falta?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(falha(gate, 'REDUNDANT_OPERATIONAL_ESCALATION'), 'nao pode recomendar abrir Fabrica quando o historico ja registrou essa etapa');

  const gateAcompanhamento = qualityGateService.avaliarResposta({
    textoResposta: 'Como a Fabrica ja foi solicitada e agora existe teste aguardando confirmacao, eu nao abriria nova Fabrica. O proximo passo e acompanhar a confirmacao do teste solicitado e, se reprovar, usar o resultado para cobrar a evidencia tecnica do ajuste.',
    manifesto: contexto.manifesto,
    pergunta: 'O que falta?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(!falha(gateAcompanhamento, 'REDUNDANT_OPERATIONAL_ESCALATION'), 'acompanhar teste/retorno ja pendente deve ser permitido');
}

function testarCaso036726_RegressaoComCompilacaoPendente() {
  const atendimento = seedAtendimento('Regressao apos atualizacao: rotina customizada voltou a falhar.');
  salvarMsg(atendimento, 'customer', 'Depois da atualizacao, o erro voltou no processo de faturamento.');
  salvarMsg(atendimento, 'user', 'Foi identificado que a fonte corrigida esta pendente de compilacao no RPO de homologacao.');

  const contexto = montarContexto(atendimento, 'Qual deve ser o proximo passo?');
  const quadro = contexto.manifesto.quadroInvestigativo;

  assert.strictEqual(quadro.estadoOperacional, 'pendencia_tecnica_identificada', 'compilacao pendente deve ser estado tecnico, nao triagem generica');
  assert.ok(
    quadro.acoesParaReduzirIncerteza.some(a => /evidencia central|evidencia faltante|Atacar primeiro/i.test(a)) || quadro.acoesSolicitadasOuPlanejadas.some(a => a.tipo === 'pendencia_tecnica'),
    'quadro deve preservar a pendencia tecnica como trilha principal'
  );
}

function testarCaso036596_ReuniaoEFabricaNaoSignificamResolucao() {
  const atendimento = seedAtendimento('Rateio de notas com erro em documento de entrada e pre-nota.');
  salvarMsg(atendimento, 'customer', 'Valores de rateio ficam em 100% mesmo inserindo o valor correto.');
  salvarMsg(atendimento, 'user', 'Favor solicitar agenda para videoconferencia com o cliente.');
  salvarMsg(atendimento, 'customer', 'Foi realizada chamada via google meet em 28/09 para demonstrar o problema.');
  salvarMsg(atendimento, 'user', 'Retornando chamado para Fabrica.');

  const contexto = montarContexto(atendimento, 'Como devemos responder?');
  const quadro = contexto.manifesto.quadroInvestigativo;

  assert.strictEqual(quadro.estadoOperacional, 'encaminhado_fabrica_em_andamento', 'encaminhamento a Fabrica deve ser andamento, nao resolucao');
  assert.ok(quadro.acoesExecutadas.some(a => a.tipo === 'reuniao_realizada'), 'reuniao realizada deve ser reconhecida');

  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Sugiro agendar uma videochamada com o cliente e abrir uma Fabrica para entender melhor o problema.',
    manifesto: contexto.manifesto,
    pergunta: 'Como devemos responder?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(falha(gate, 'REDUNDANT_OPERATIONAL_MEETING'), 'nao pode recomendar reuniao ja realizada');
  assert.ok(falha(gate, 'REDUNDANT_OPERATIONAL_ESCALATION'), 'nao pode recomendar abertura/encaminhamento ja registrado');

  const gateBom = qualityGateService.avaliarResposta({
    textoResposta: 'A videochamada ja foi realizada e o chamado ja voltou para a Fabrica. O proximo passo e acompanhar o retorno da Fabrica pedindo evidencia objetiva sobre o erro de rateio, sem tratar isso como correcao validada.',
    manifesto: contexto.manifesto,
    pergunta: 'Como devemos responder?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(!falha(gateBom, 'REDUNDANT_OPERATIONAL_MEETING'), 'reconhecer reuniao ja realizada deve ser permitido');
  assert.ok(!falha(gateBom, 'REDUNDANT_OPERATIONAL_ESCALATION'), 'acompanhar Fabrica ja encaminhada deve ser permitido');
}

function testarAdversarial_RelacaoIntermodularLegitimaComPonte() {
  const manifesto = {
    selecionados: [],
    omitidos: [],
    quadroInvestigativo: {
      estadoOperacional: 'triagem_investigativa',
      evidencias: [{
        referencia: 'log-integracao.txt',
        papeis: ['TECNICA_RELACIONADA'],
        dominio: 'Compras / workflow + Financeiro / contabilidade',
        resumo: 'Log mostra que ao atualizar o status do pedido aprovado a rotina financeira bloqueia o commit do mesmo fluxo.',
        vinculoCausal: 'Possivel vinculo com o problema principal; confirmar pela resposta e demais evidencias.',
      }],
    },
  };
  const resposta = 'Ha hipotese tecnica legitima de relacao entre compras e financeiro porque o log mostra a rotina financeira bloqueando o commit no mesmo fluxo que atualiza o status do pedido. Eu validaria esse encadeamento no log transacional antes de mexer na contabilizacao.';
  const gate = qualityGateService.avaliarResposta({ textoResposta: resposta, manifesto, pergunta: 'x' });
  assert.ok(!falha(gate, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE'), 'relacao intermodular com ponte causal nao deve ser bloqueada');
}

function testarAdversarial_HistoricoIncompletoEAcoesPrometidas() {
  const atendimento = seedAtendimento('Chamado com historico incompleto.');
  salvarMsg(atendimento, 'customer', 'O pedido nao muda status.');
  salvarMsg(atendimento, 'user', 'Irei abrir uma Fabrica.');

  const contexto = montarContexto(atendimento, 'O que fazer?');
  const quadro = contexto.manifesto.quadroInvestigativo;
  assert.ok(quadro.lacunasInformacao.length >= 1 || quadro.acoesParaReduzirIncerteza.length >= 1, 'historico incompleto deve gerar lacuna ou acao de reducao de incerteza');
  assert.ok(quadro.acoesSolicitadasOuPlanejadas.some(a => a.tipo === 'encaminhamento_fabrica'), 'acao prometida deve ser planejada/solicitada, nao necessariamente concluida');
}

function testarAdversarial_CorrecaoAplicadaSemValidacaoBloqueiaReabertura() {
  const manifesto = {
    selecionados: [],
    omitidos: [],
    quadroInvestigativo: {
      estadoOperacional: 'correcao_aplicada_sem_validacao_comprovada',
      evidencias: [],
      correcoesPendentesValidacao: [{ origem: 'mensagem:3', evidencia: 'correcao aplicada em producao' }],
    },
  };
  const resposta = 'Recomendo acionar a Fabrica para investigar novamente a causa do problema.';
  const gate = qualityGateService.avaliarResposta({ textoResposta: resposta, manifesto, pergunta: 'x' });
  assert.ok(falha(gate, 'INVESTIGATIVE_FRAME_OPERATIONAL_STAGE_IGNORED'), 'correcao aplicada sem validacao deve priorizar validacao, nao reabrir etapa inicial');
}

function testarAdversarial_EvidenciaNovaAlteraHipotese() {
  const manifesto = {
    selecionados: [],
    omitidos: [],
    quadroInvestigativo: {
      estadoOperacional: 'triagem_investigativa',
      evidencias: [{
        referencia: 'novo-log.txt',
        papeis: ['CENTRAL', 'TECNICA_RELACIONADA'],
        dominio: 'Compras / workflow de aprovacao',
        resumo: 'Novo log de teste mostra erro STATUSWF ao confirmar aprovacao do pedido.',
        vinculoCausal: 'Possivel vinculo com o problema principal; confirmar pela resposta e demais evidencias.',
      }],
    },
  };
  const resposta = 'Com o novo log de teste, eu mudaria a hipotese: o erro STATUSWF ocorre no momento de confirmar a aprovacao do pedido, entao a proxima validacao e reproduzir esse ponto com log transacional.';
  const gate = qualityGateService.avaliarResposta({ textoResposta: resposta, manifesto, pergunta: 'x' });
  assert.ok(!falha(gate, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE'), 'evidencia nova central pode alterar hipotese sem falso positivo de incidental');
}

function testarEtapa12_RastreabilidadeTecnica() {
  const manifesto = {
    selecionados: [{
      id: 'msg-visivel',
      tipo: 'mensagem',
      status: 'ANALISADA',
      trecho: 'Cliente relata que saldo de contrato agricola nao atualiza apos devolucao. Aguardando confirmacao do teste solicitado.',
    }],
    omitidos: [],
    quadroInvestigativo: {
      estadoOperacional: 'validacao_solicitada_ou_aguardando_confirmacao',
      evidencias: [],
    },
  };
  const pesquisa = {
    paginasLidas: [{
      status: 'lida',
      titulo: 'Cross Segmentos - Totvs Backoffice Protheus - SIGAGCT',
      url: 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/x',
      trecho: 'Help CNTA120COMPET ao realizar uma medicao em contratos.',
    }],
  };

  const externoComoInterno = qualityGateService.avaliarResposta({
    textoResposta: 'As mensagens do cliente mostram o erro CNTA120COMPET em todas as ocorrencias, entao a causa provavel e falta de saldo na competencia.',
    manifesto,
    pesquisa,
    historicoMensagens: [{ papel: 'customer', conteudo: manifesto.selecionados[0].trecho }],
  });
  assert.ok(falha(externoComoInterno, 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE'), 'termo de pesquisa externa nao pode ser apresentado como evidencia interna');

  const externoRastreado = qualityGateService.avaliarResposta({
    textoResposta: 'A pesquisa externa da TOTVS cita CNTA120COMPET em medicao de contratos, mas isso nao aparece no historico do chamado. Eu usaria essa fonte apenas como trilha de apoio e validaria primeiro o teste pendente do cliente.',
    manifesto,
    pesquisa,
    historicoMensagens: [{ papel: 'customer', conteudo: manifesto.selecionados[0].trecho }],
  });
  assert.ok(!falha(externoRastreado, 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE'), 'referencia externa rastreada e limitada deve ser permitida');

  const semOrigem = qualityGateService.avaliarResposta({
    textoResposta: 'Compare o codigo da rotina CALCULA_SALDO_CONTRATO e ajuste a chamada, pois ela e o ponto de entrada concreto.',
    manifesto,
    pesquisa,
    historicoMensagens: [{ papel: 'customer', conteudo: manifesto.selecionados[0].trecho }],
  });
  // Proveniencia (2026-10): referencia fora das evidencias nao e erro por ausencia;
  // so e falha quando afirmada como fato/causa do caso, sem rotulo de hipotese.
  assert.ok(falha(semOrigem, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), 'conhecimento do modelo afirmado como ponto concreto do caso deve reprovar');

  const hipoteseLegitima = qualityGateService.avaliarResposta({
    textoResposta: 'Como hipotese a validar, pode existir uma rotina customizada semelhante a CALCULA_SALDO_CONTRATO, mas ela nao aparece nas evidencias; por isso eu pediria o fonte ou log antes de concluir.',
    manifesto,
    pesquisa,
    historicoMensagens: [{ papel: 'customer', conteudo: manifesto.selecionados[0].trecho }],
  });
  assert.ok(!falha(hipoteseLegitima, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'identificador novo rotulado como hipotese deve ser permitido');
}

function testarEtapa12_FatosOperacionaisEIdsInternos() {
  const atendimento = seedAtendimento('Rateio de notas com erro.');
  salvarMsg(atendimento, 'customer', 'Valores de rateio ficam em 100% mesmo inserindo valor correto.');
  salvarMsg(atendimento, 'customer', 'Foi realizada chamada via google meet para demonstrar o problema.');
  salvarMsg(atendimento, 'user', 'Retornando chamado para Fabrica.');
  const historicoMensagens = mensagemRepo.listarMensagens(EMPRESA, atendimento.id);

  const gateContagem = qualityGateService.avaliarResposta({
    textoResposta: 'Antes de escalar para a Fabrica novamente, isso ja foi feito 3 vezes, peca outra demonstracao ao cliente.',
    manifesto: { selecionados: [], omitidos: [] },
    historicoMensagens,
  });
  assert.ok(falha(gateContagem, 'UNSUPPORTED_OPERATIONAL_COUNT'), 'contagem operacional sem suporte deve reprovar');

  const gateId = qualityGateService.avaliarResposta({
    textoResposta: 'As mensagens aud-msg-035988-1 a aud-msg-035988-10 mostram a mesma falha.',
    manifesto: { selecionados: [], omitidos: [] },
    historicoMensagens,
  });
  assert.ok(falha(gateId, 'INTERNAL_IDS_USED_AS_EVIDENCE'), 'ids internos de auditoria/manifesto nao podem aparecer como evidencia');

  const gateIdUnicode = qualityGateService.avaliarResposta({
    textoResposta: 'A mensagem aud\u2011msg\u2011035988\u20111 mostra a mesma falha.',
    manifesto: { selecionados: [], omitidos: [] },
    historicoMensagens,
  });
  assert.ok(falha(gateIdUnicode, 'INTERNAL_IDS_USED_AS_EVIDENCE'), 'ids internos com hifen Unicode tambem devem reprovar');
}

function testarEtapa13_RastreabilidadeVisualSemPromoverCausa() {
  const manifesto = {
    selecionados: [{
      id: 'img-fina050',
      tipo: 'imagem',
      status: 'ANALISADA',
      imagemEnviada: true,
      textoObservado: 'Tela com Help FINA050. Mensagem: O titulo U 6498 NF 00701101 possui movimentos sem contabilizacao.',
    }],
    omitidos: [],
    quadroInvestigativo: {
      estadoOperacional: 'correcao_aplicada_pendente_validacao',
      evidencias: [{
        referencia: 'print-fina050.png',
        papeis: ['INCIDENTAL'],
        dominio: 'Financeiro / contabilidade',
        resumo: 'Help FINA050 com titulo sem contabilizacao.',
        vinculoCausal: 'Vinculo causal nao demonstrado.',
      }],
    },
  };

  const respostaBoa = 'O print mostra FINA050 e titulo sem contabilizacao, mas isso e outro dominio e sem ponte causal demonstrada com o status do pedido. Eu nao usaria isso como causa; validaria primeiro o fluxo original de compras apos a correcao aplicada.';
  const gateBom = qualityGateService.avaliarResposta({
    textoResposta: respostaBoa,
    manifesto,
    pergunta: 'Analise os prints e o historico.',
  });
  assert.ok(!falha(gateBom, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'rotina observada em evidencia visual estruturada deve ser rastreavel');
  assert.ok(!falha(gateBom, 'VISUAL_EVIDENCE_TOO_GENERIC'), 'codigo/tela observado no print deve contar como evidencia visual concreta');
  assert.ok(!falha(gateBom, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE'), 'evidencia visual incidental reconhecida como limite nao deve reprovar');

  const respostaRuim = 'O problema do workflow e causado pelo FINA050. Corrija a contabilizacao antes de testar novamente a aprovacao.';
  const gateRuim = qualityGateService.avaliarResposta({
    textoResposta: respostaRuim,
    manifesto,
    pergunta: 'Analise os prints e o historico.',
  });
  assert.ok(falha(gateRuim, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE'), 'evidencia visual incidental nao pode virar causa principal sem ponte causal');
}

function testarEtapa13_ImagemSemOCRNaoViraProvaLivre() {
  const manifesto = {
    selecionados: [{
      id: 'img-sem-ocr',
      tipo: 'imagem',
      status: 'ANALISADA',
      imagemEnviada: true,
    }],
    omitidos: [],
  };
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'O print comprova que a rotina CALCULA_SALDO_CONTRATO e a causa concreta; ajuste esse fonte.',
    manifesto,
    pergunta: 'Analise o print.',
  });
  assert.ok(falha(gate, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'imagem sem texto estruturado nao pode justificar qualquer identificador tecnico inventado');
}

function testarEtapa13_HipoteseTecnicaCondicional() {
  const manifesto = { selecionados: [], omitidos: [] };
  const hipotese = qualityGateService.avaliarResposta({
    textoResposta: 'Como hipotese a validar, procure por customizacao na rotina de pre-nota de entrada, MATA100 ou similar. Isso nao aparece como causa comprovada; e apenas uma trilha para a Fabrica conferir.',
    manifesto,
    pergunta: 'Qual proximo passo?',
  });
  assert.ok(!falha(hipotese, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'referencia tecnica condicionada como hipotese ou similar deve ser permitida');

  const afirmacao = qualityGateService.avaliarResposta({
    textoResposta: 'A causa e a rotina MATA100. Corrija a rotina para resolver o rateio.',
    manifesto,
    pergunta: 'Qual proximo passo?',
  });
  assert.ok(falha(afirmacao, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), 'rotina fora das evidencias apresentada como causa confirmada deve continuar reprovando');
  assert.ok(!falha(afirmacao, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'a falha e de atribuicao/certeza, nao de ausencia da referencia');
}

function testarEtapa14_DecisoesEObservacaoVisual() {
  const manifesto = {
    selecionados: [{
      id: 'img-stack',
      tipo: 'imagem',
      status: 'ANALISADA',
      imagemEnviada: true,
    }],
    observacoesVisuais: [{
      anexoId: 'img-stack',
      nome: 'central-diagnostico.png',
      textosVisiveis: ['CALLAPP', 'PGCA010.PRW'],
      campos: [],
      valores: [],
      confiancaVisual: 'media',
    }],
    omitidos: [],
  };
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra CALLAPP e PGCA010.PRW na Central de Diagnostico, mas isso e contexto de execucao e nao causa confirmada do workflow.',
    manifesto,
    pergunta: 'Analise o print.',
  });
  assert.ok(!falha(gate, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'observacao visual estruturada deve rastrear termo visto em imagem');
}

function testarEtapa14_VisualSemObservacaoViraEvidenciaInsuficiente() {
  const manifesto = {
    selecionados: [{ id: 'img-stack', tipo: 'imagem', status: 'ANALISADA', imagemEnviada: true }],
    omitidos: [],
  };
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra CALLAPP na Central de Diagnostico.',
    manifesto,
    pergunta: 'Analise o print.',
  });
  const f = gate.falhas.find(x => x.codigo === 'UNTRACEABLE_TECHNICAL_REFERENCE');
  assert.ok(f, 'termo visual sem observacao estruturada deve gerar falha de rastreabilidade');
  assert.strictEqual(f.decisionKind, 'evidencia_insuficiente', 'falha visual sem observacao deve ser evidencia insuficiente, nao erro comprovado');
}

function testarEtapa14_NegacaoDeReferenciaExternaNaoBloqueia() {
  const manifesto = { selecionados: [], omitidos: [] };
  const pesquisa = {
    paginasLidas: [{
      status: 'lida',
      titulo: 'TOTVS OMS montagem de carga',
      trecho: 'Ponto de entrada OM200PES permite sobrescrever peso por item.',
    }],
  };
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'A pesquisa externa cita OM200PES, mas nao ha no historico nenhuma mencao a esse ponto de entrada. Eu trataria isso so como hipotese a validar.',
    manifesto,
    pesquisa,
    historicoMensagens: [{ papel: 'customer', conteudo: 'Acerto de carga voltou a buscar primeiro peso.' }],
  });
  assert.ok(!falha(gate, 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE'), 'negacao explicita de fonte interna nao deve bloquear referencia externa');
}

function testarEtapa14_AcaoTelaNaoEIdentificadorTecnico() {
  const manifesto = {
    selecionados: [{ id: 'img-rateio', tipo: 'imagem', status: 'ANALISADA', imagemEnviada: true }],
    observacoesVisuais: [{
      anexoId: 'img-rateio',
      nome: 'rateio.png',
      textosVisiveis: ['Nf Rateio - Especifico - INCLUIR', 'Modo edicao nao respeitado'],
      campos: ['% Rateio'],
      valores: ['105.6'],
      confiancaVisual: 'media',
    }],
    omitidos: [],
  };
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra a tela INCLUIR com a mensagem "Modo edicao nao respeitado" no campo % Rateio.',
    manifesto,
    pergunta: 'Analise o print.',
  });
  assert.ok(!falha(gate, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'INCLUIR e acao de tela e nao deve virar identificador tecnico critico');
  assert.ok(!falha(gate, 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE'), 'INCLUIR nao deve ser tratado como referencia externa');
}

function testarEtapa14_ContagemPorExtenso() {
  const atendimento = seedAtendimento('Rateio de notas com erro.');
  salvarMsg(atendimento, 'customer', 'Valores de rateio ficam em 100%.');
  salvarMsg(atendimento, 'user', 'Abrir Fabrica e acompanhar retorno.');
  salvarMsg(atendimento, 'customer', 'Foi realizada chamada via google meet em 28/09 para demonstrar o problema.');
  salvarMsg(atendimento, 'user', 'Retornando chamado para Fabrica.');
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'A Fabrica ja foi acionada tres vezes desde 25/09, entao peca nova demonstracao.',
    manifesto: { selecionados: [], omitidos: [] },
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(falha(gate, 'UNSUPPORTED_OPERATIONAL_COUNT'), 'contagem por extenso sem suporte deve reprovar');
}

function testarEtapa23_ContagemOperacionalExigeQuantidadeExplicita() {
  const atendimento = seedAtendimento('Rateio de notas com erro.');
  salvarMsg(atendimento, 'user', 'Abrir Fabrica e acompanhar retorno.');
  salvarMsg(atendimento, 'user', 'Irei abrir uma Fabrica.');
  salvarMsg(atendimento, 'user', 'Retornando chamado para Fabrica.');

  const gateSemContagem = qualityGateService.avaliarResposta({
    textoResposta: 'O chamado ja foi encaminhado a Fabrica tres vezes; acompanhe o retorno tecnico.',
    manifesto: { selecionados: [], omitidos: [] },
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(falha(gateSemContagem, 'UNSUPPORTED_OPERATIONAL_COUNT'), 'nao deve inferir "tres vezes" somando mensagens operacionais parecidas');

  salvarMsg(atendimento, 'user', 'Registrado explicitamente: a Fabrica foi acionada tres vezes neste atendimento.');
  const gateComContagem = qualityGateService.avaliarResposta({
    textoResposta: 'A Fabrica foi acionada tres vezes, conforme registro explicito; agora acompanhe o retorno tecnico.',
    manifesto: { selecionados: [], omitidos: [] },
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(!falha(gateComContagem, 'UNSUPPORTED_OPERATIONAL_COUNT'), 'contagem operacional explicita no historico pode ser citada');
}

function testarEtapa15_HipoteseTecnicaComoExemploNaoBloqueia() {
  const manifesto = { selecionados: [], omitidos: [] };
  const gateBom = qualityGateService.avaliarResposta({
    textoResposta: 'Para fechar a validacao, preciso do codigo-fonte do ponto de entrada implementado: qual e o nome, ex.: MATA120_MAIL001, MATA121_MAIL001, ou outro, e em qual evento ele esta registrado. Isso e exemplo de trilha a conferir, nao fato do chamado.',
    manifesto,
    pergunta: 'Qual evidencia falta?',
  });
  assert.ok(!falha(gateBom, 'UNTRACEABLE_TECHNICAL_REFERENCE'), 'referencia tecnica usada como exemplo/hipotese nao deve bloquear');

  const gateRuim = qualityGateService.avaliarResposta({
    textoResposta: 'A causa comprovada e o ponto de entrada MATA121_MAIL001. Corrija essa rotina para resolver o chamado.',
    manifesto,
    pergunta: 'Qual evidencia falta?',
  });
  assert.ok(falha(gateRuim, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), 'referencia fora das evidencias apresentada como causa comprovada deve continuar bloqueada');
}

function testarEtapa15_CustomizacaoCondicionalNaoBloqueia() {
  const manifesto = { selecionados: [], omitidos: [] };
  const gateBom = qualityGateService.avaliarResposta({
    textoResposta: 'Sem fonte do gatilho, log ou ponto de entrada, nao da para afirmar se e comportamento padrao do Protheus ou customizacao. Eu trataria como hipotese e pediria o fonte/PE antes de descartar qualquer customizacao.',
    manifesto,
    pergunta: 'Analise o caso.',
  });
  assert.ok(!falha(gateBom, 'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG'), 'analise condicional que reconhece falta de fonte/log nao deve bloquear');

  const gateRuim = qualityGateService.avaliarResposta({
    textoResposta: 'Nao e customizacao; e comportamento padrao do Protheus. Siga a validacao no ambiente e encerre.',
    manifesto,
    pergunta: 'Analise o caso.',
  });
  assert.ok(falha(gateRuim, 'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG'), 'descarte categorico de customizacao sem fonte/log deve bloquear');
}

function testarEtapa15_FailClosedPorBloqueioObjetivo() {
  const gateBloqueado = {
    aprovado: false,
    falhas: [{
      codigo: 'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG',
      severidade: 'media',
      decisionKind: 'bloqueio_objetivo',
    }],
  };
  // 2026-10-23: o gate nunca trava a entrega; bloqueio objetivo vira alerta
  // com observacao ao analista (caso #036537).
  assert.strictEqual(
    investigacaoService._statusFinalQualityGate(gateBloqueado, true),
    'concluido_com_alerta_quality_gate',
    'bloqueio objetivo apos retry entrega a resposta com alerta',
  );

  const gateEstilo = {
    aprovado: false,
    falhas: [{
      codigo: 'CORRECTION_WITHOUT_VALIDATION',
      severidade: 'media',
      decisionKind: 'correcao_estilo',
    }],
  };
  // M4 (2026-10): estilo/qualidade nao veta a entrega — gera alerta. Apenas
  // falhas de integridade (atribuicao falsa, certeza indevida, dados internos)
  // vetam apos o retry.
  assert.strictEqual(
    investigacaoService._statusFinalQualityGate(gateEstilo, true),
    'concluido_com_alerta_quality_gate',
    'falha de estilo remanescente apos retry deve gerar alerta, nao bloquear a resposta',
  );
}

function testarEtapa2_PRRNoContextoEPrompt() {
  const atendimento = seedAtendimento('Pedido de compras nao muda status no novo fluxo.');
  salvarMsg(atendimento, 'customer', 'Pedido de compra aprovado no workflow continua em aprovacao.');
  salvarMsg(atendimento, 'user', 'Print da Central de Diagnostico mostra PGCA010.PRW no Novo Fluxo de Compras.');
  const contexto = montarContexto(atendimento, 'Qual o proximo passo?');
  const plano = contexto.manifesto.planoRespostaRastreavel;
  assert.ok(plano, 'manifesto deve conter Plano de Resposta Rastreavel');
  assert.ok(/Plano de Resposta Rastreavel/.test(contexto.userPrompt), 'prompt deve incluir PRR');
  assert.ok(plano.fatosComprovados.length > 0, 'PRR deve trazer fatos comprovados');
}

function testarEtapa2_PRRBloqueiaReferenciaTecnicaNaoAutorizada() {
  const plano = planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Acerto de carga voltou a buscar primeiro peso apos atualizacao.',
        estadoOperacional: 'encaminhado_fabrica_em_andamento',
        evidencias: [{
          referencia: 'historico',
          papeis: ['OPERACIONAL'],
          resumo: 'Analista pediu alinhamento sobre compilacao de fonte que esta faltando.',
          vinculoCausal: 'Evidencia operacional; nao comprova causa tecnica por si so.',
        }],
        lacunasInformacao: ['Nao ha fonte, log ou stack trace para afirmar a rotina envolvida.'],
        acoesParaReduzirIncerteza: ['Confirmar qual fonte ficou pendente de compilacao e validar RPO/ambiente.'],
      },
    },
    pesquisaTexto: 'Pesquisa externa cita OM200PES como ponto de entrada de peso, sem evidencia interna no chamado.',
  });

  const manifesto = { selecionados: [], omitidos: [], planoRespostaRastreavel: plano };
  const pesquisa = { paginasLidas: [{ status: 'lida', titulo: 'TOTVS OM200PES', trecho: 'OM200PES ponto de entrada de peso.' }] };

  const gateExternoComoCausa = qualityGateService.avaliarResposta({
    textoResposta: 'A causa e o ponto de entrada OM200PES. Abra a rotina e ajuste o calculo do peso.',
    manifesto,
    pesquisa,
    pergunta: 'Analise o caso.',
  });
  assert.ok(falha(gateExternoComoCausa, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'PRR deve bloquear referencia externa usada como causa/acao principal');

  const gateExternoComoHipotese = qualityGateService.avaliarResposta({
    textoResposta: 'A pesquisa externa cita OM200PES, mas isso nao aparece no historico. Eu trataria apenas como hipotese a validar depois de confirmar qual fonte ficou pendente de compilacao.',
    manifesto,
    pesquisa,
    pergunta: 'Analise o caso.',
  });
  assert.ok(!falha(gateExternoComoHipotese, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'PRR deve permitir referencia externa como hipotese limitada');

  const gateInventado = qualityGateService.avaliarResposta({
    textoResposta: 'Abra a rotina D1_RATEIO e ajuste a validacao de percentual.',
    manifesto,
    pesquisa,
    pergunta: 'Analise o caso.',
  });
  assert.ok(!falha(gateInventado, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'), 'PRR nao e catalogo de conhecimento autorizado: referencia nova nao bloqueia');
  assert.ok(!falha(gateInventado, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), 'orientacao tecnica com referencia nova, sem atribuir ao caso, nao e falha');
  const refD1 = (gateInventado.proveniencia?.referencias || []).find(r => r.termo === 'D1_RATEIO');
  assert.ok(refD1 && refD1.origem === 'conhecimento_modelo', 'proveniencia deve registrar a referencia como conhecimento do modelo');
}

function testarEtapa2_PRRPermiteHipoteseSemNomeInventado() {
  const plano = planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Rateio de nota apresenta erro de modo de edicao.',
        estadoOperacional: 'encaminhado_fabrica_em_andamento',
        evidencias: [{
          referencia: 'print-rateio.png',
          papeis: ['CENTRAL'],
          resumo: 'Print mostra mensagem "Modo edicao nao respeitado. Valor nao pode ser atribuido. (% Rateio)".',
          vinculoCausal: 'Possivel vinculo com o problema principal; confirmar pela resposta e demais evidencias.',
        }],
        lacunasInformacao: ['Falta fonte, gatilho ou ponto de entrada que atua no campo % Rateio.'],
        acoesParaReduzirIncerteza: ['Solicitar fonte/gatilho/ponto de entrada ou log/stack do erro de atribuicao.'],
      },
    },
  });
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'A evidencia sustenta uma hipotese de bloqueio de atribuicao no campo de rateio, mas falta fonte, gatilho ou ponto de entrada para nomear a rotina. O proximo passo e coletar esse fonte ou log/stack antes de afirmar causa.',
    manifesto: { selecionados: [], omitidos: [], planoRespostaRastreavel: plano },
    pergunta: 'Analise o caso.',
  });
  assert.ok(!falha(gate, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'), 'PRR nao deve bloquear hipotese util quando ela nao inventa identificador tecnico');
  assert.ok(!falha(gate, 'PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP'), 'hipotese com lacuna explicita nao deve virar bloqueio de causa confirmada');
}

function testarEtapa21_PRRReconciliacaoVisualPermiteContexto() {
  const planoInicial = planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Pedido de compra aprovado no workflow continua em aprovacao.',
        estadoOperacional: 'correcao_aplicada_pendente_validacao',
        evidencias: [{
          referencia: 'historico',
          papeis: ['OPERACIONAL'],
          resumo: 'Correcao aplicada em producao e enviada para validacao.',
          vinculoCausal: 'Evidencia operacional; nao comprova causa tecnica por si so.',
        }],
        lacunasInformacao: ['Falta validacao do fluxo original apos a correcao aplicada.'],
        acoesParaReduzirIncerteza: ['Validar o fluxo original de compras/workflow apos a correcao aplicada.'],
      },
    },
  });
  const plano = planoRespostaRastreavel.reconciliarObservacoesVisuais(planoInicial, [{
    anexoId: 'img-fina050',
    nome: 'print-fina050.png',
    textosVisiveis: ['Help FINA050 - Contas a Pagar', 'movimentos sem contabilizacao'],
    campos: [],
    valores: [],
    confiancaVisual: 'media',
  }]);
  assert.ok(plano.termosTecnicosPermitidos.some(t => t.termo === 'FINA050' && t.usoPermitido === 'contexto_visual' && t.causalPermitido === false), 'termo visual deve entrar no PRR como contexto_visual sem permissao causal');

  const manifesto = { selecionados: [], omitidos: [], planoRespostaRastreavel: plano };
  const gateContexto = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra FINA050, mas isso e de outro dominio e sem ponte causal demonstrada com o status do pedido. Eu nao usaria isso como causa; validaria primeiro o fluxo original de compras apos a correcao aplicada.',
    manifesto,
    pergunta: 'Analise os prints.',
  });
  assert.ok(!falha(gateContexto, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'), 'FINA050 visual deve poder ser citado para delimitar dominio ou ausencia de vinculo causal');
  assert.ok(!falha(gateContexto, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'FINA050 visual contextual nao e referencia externa usada como causa');

  const gateCausa = qualityGateService.avaliarResposta({
    textoResposta: 'O problema do workflow e causado pelo FINA050. Corrija a contabilizacao antes de testar novamente a aprovacao.',
    manifesto,
    pergunta: 'Analise os prints.',
  });
  assert.ok(falha(gateCausa, 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE') || falha(gateCausa, 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE'), 'termo visual nao pode virar causa do problema sem ponte causal');
}

function testarEtapa21_PRRSemObservacaoNaoAutorizaVisual() {
  const plano = planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Pedido de compra aprovado no workflow continua em aprovacao.',
        estadoOperacional: 'correcao_aplicada_pendente_validacao',
        evidencias: [],
        lacunasInformacao: ['Falta observacao visual estruturada dos prints.'],
        acoesParaReduzirIncerteza: ['Validar o fluxo original.'],
      },
    },
  });
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra FINA050 e por isso o problema e contabilizacao.',
    manifesto: { selecionados: [], omitidos: [], planoRespostaRastreavel: plano },
    pergunta: 'Analise os prints.',
  });
  assert.ok(falha(gate, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), 'sem observacao visual estruturada, termo citado como visto no print e atribuicao falsa ao caso');
}

function planoComFINA050Visual() {
  const planoInicial = planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Pedido de compra aprovado no workflow continua em aprovacao.',
        estadoOperacional: 'correcao_aplicada_pendente_validacao',
        evidencias: [],
        lacunasInformacao: ['Falta validacao do fluxo original de compras apos a correcao aplicada.'],
      },
    },
  });
  return planoRespostaRastreavel.reconciliarObservacoesVisuais(planoInicial, [{
    anexoId: 'img-fina050',
    nome: 'print-fina050.png',
    textosVisiveis: ['Help FINA050 - Contas a Pagar', 'movimentos sem contabilizacao'],
    campos: [],
    valores: [],
    confiancaVisual: 'media',
  }]);
}

function testarEtapa22_ContextoVisualENegacaoCausal() {
  const manifesto = { selecionados: [], omitidos: [], planoRespostaRastreavel: planoComFINA050Visual() };

  const observacao = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra FINA050 na tela de Contas a Pagar.',
    manifesto,
    pergunta: 'Analise os prints.',
  });
  assert.ok(!falha(observacao, 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE'), 'FINA050 como observacao visual deve ser permitido');
  assert.ok(!falha(observacao, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'), 'FINA050 visual rastreado nao deve ser tratado como inventado');

  const negacao = qualityGateService.avaliarResposta({
    textoResposta: 'FINA050 aparece no print, mas nao possui vinculo causal demonstrado com o problema de compras.',
    manifesto,
    pergunta: 'Analise os prints.',
  });
  assert.ok(!falha(negacao, 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE'), 'negacao explicita de causalidade nao deve ser classificada como uso causal');

  const fraseLonga = qualityGateService.avaliarResposta({
    textoResposta: 'O anexo mostra FINA050, que e evidencia visual de outro dominio e sem ponte causal demonstrada com compras, enquanto a pesquisa externa cita SIGAEST apenas como apoio e nenhum dos dois deve orientar a correcao principal.',
    manifesto: {
      selecionados: [],
      omitidos: [],
      planoRespostaRastreavel: planoRespostaRastreavel.montarPlano({
        manifesto: {
          observacoesVisuais: [{
            anexoId: 'img-fina050',
            nome: 'print-fina050.png',
            textosVisiveis: ['FINA050'],
            campos: [],
            valores: [],
          }],
          quadroInvestigativo: {
            problemaPrincipal: 'Pedido de compra aprovado no workflow continua em aprovacao.',
            evidencias: [],
          },
        },
        pesquisaTexto: 'Pesquisa externa cita SIGAEST como modulo de estoque.',
      }),
    },
    pergunta: 'Analise os prints.',
  });
  assert.ok(!falha(fraseLonga, 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE'), 'frase longa com negacao causal nao deve bloquear termo visual');
  assert.ok(!falha(fraseLonga, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'referencia externa incidental com limite explicito nao deve bloquear');
}

function testarEtapa22_BloqueiaCausaERecomendacaoVisualSemPonte() {
  const manifesto = { selecionados: [], omitidos: [], planoRespostaRastreavel: planoComFINA050Visual() };

  const causa = qualityGateService.avaliarResposta({
    textoResposta: 'FINA050 causou o bloqueio da aprovacao do pedido.',
    manifesto,
    pergunta: 'Analise os prints.',
  });
  assert.ok(falha(causa, 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE'), 'termo visual promovido a causa deve bloquear');
  const falhaCausa = causa.falhas.find(f => f.codigo === 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE');
  assert.strictEqual(falhaCausa.classificacaoContextual, 'afirmacao_causal', 'bloqueio deve registrar classificacao contextual');
  assert.ok(/FINA050 causou/.test(falhaCausa.trecho), 'bloqueio deve registrar trecho exato avaliado');

  const acao = qualityGateService.avaliarResposta({
    textoResposta: 'Corrigir FINA050 resolvera o workflow de compras.',
    manifesto,
    pergunta: 'Analise os prints.',
  });
  assert.ok(falha(acao, 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE'), 'recomendacao tecnica baseada em termo visual sem ponte deve bloquear');
}

function testarEtapa22_ReferenciaExternaIncidentalVersusCausa() {
  const plano = planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Fonte ADVPL apresentou regressao apos atualizacao.',
        estadoOperacional: 'pendencia_tecnica_identificada',
        evidencias: [],
        lacunasInformacao: ['Falta log/stack com o ponto exato da falha.'],
      },
    },
    pesquisaTexto: 'Pesquisa externa cita SIGAEST em contexto de estoque.',
  });
  const manifesto = { selecionados: [], omitidos: [], planoRespostaRastreavel: plano };

  const incidental = qualityGateService.avaliarResposta({
    textoResposta: 'A pesquisa externa cita SIGAEST, mas e referencia de apoio e nao ha ponte causal demonstrada com o fonte anexado.',
    manifesto,
    pergunta: 'Analise o fonte.',
  });
  assert.ok(!falha(incidental, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'SIGAEST externo incidental nao deve bloquear por causalidade');

  const causa = qualityGateService.avaliarResposta({
    textoResposta: 'SIGAEST e a causa do erro no fonte U_SALDOCONTRATO.',
    manifesto,
    pergunta: 'Analise o fonte.',
  });
  assert.ok(falha(causa, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'SIGAEST externo promovido a causa confirmada deve bloquear');
}

function testarEtapa22_InventadosEIdsContinuamBloqueados() {
  const manifesto = { selecionados: [], omitidos: [], planoRespostaRastreavel: planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Rateio de nota apresenta erro no campo % Rateio.',
        estadoOperacional: 'encaminhado_fabrica_em_andamento',
        evidencias: [],
        lacunasInformacao: ['Falta fonte, log ou ponto de entrada que atua no campo % Rateio.'],
      },
    },
  }) };

  const inventados = qualityGateService.avaliarResposta({
    textoResposta: 'Ajuste PARM_RATEIO_EXATOS e revise F3ANTES e F3APOS para corrigir o percentual.',
    manifesto,
    pergunta: 'Analise o rateio.',
  });
  assert.ok(!falha(inventados, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'), 'hipoteses tecnicas novas (PARM_RATEIO_EXATOS/F3ANTES/F3APOS) nao bloqueiam por ausencia');
  const origensInventados = (inventados.proveniencia?.referencias || []).filter(r => r.origem === 'conhecimento_modelo').map(r => r.termo);
  assert.ok(origensInventados.includes('PARM_RATEIO_EXATOS'), 'devem ser registradas como conhecimento do modelo na proveniencia');

  const idInterno = qualityGateService.avaliarResposta({
    textoResposta: 'A evidencia aud-msg-035988-2 comprova a falha.',
    manifesto,
    pergunta: 'Analise.',
  });
  assert.ok(falha(idInterno, 'INTERNAL_IDS_USED_AS_EVIDENCE'), 'aud-msg-* continua bloqueado como identificador interno');
}

function testarEtapa22_RedundanciaOperacionalPreservada() {
  const atendimento = seedAtendimento('Rateio de notas com erro.');
  salvarMsg(atendimento, 'customer', 'Valores de rateio ficam em 100% mesmo inserindo valor correto.');
  salvarMsg(atendimento, 'customer', 'Foi realizada chamada via google meet em 28/09 para demonstrar o problema.');
  salvarMsg(atendimento, 'user', 'Retornando chamado para Fabrica.');

  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Recomendo abrir novamente a Fabrica para iniciar a investigacao do erro de rateio.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Como devemos responder?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(falha(gate, 'REDUNDANT_OPERATIONAL_ESCALATION'), 'recomendar abertura de Fabrica ja encaminhada deve continuar bloqueando');

  const acompanhamento = qualityGateService.avaliarResposta({
    textoResposta: 'O que falta agora e a Fabrica retornar com a analise tecnica do ponto de validacao; acompanhe esse retorno e peca a evidencia objetiva do ajuste.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Como devemos responder?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(!falha(acompanhamento, 'REDUNDANT_OPERATIONAL_ESCALATION'), 'acompanhar retorno da Fabrica ja em andamento deve ser permitido');

  const negacaoOperacional = qualityGateService.avaliarResposta({
    textoResposta: 'Nao recomende videochamada adicional agora e nao abra nova Fabrica; o cliente ja demonstrou o problema e o chamado ja esta aguardando retorno tecnico.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Como devemos responder?',
    historicoMensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id),
  });
  assert.ok(!falha(negacaoOperacional, 'REDUNDANT_OPERATIONAL_MEETING'), 'negacao de nova reuniao nao deve ser tratada como recomendacao redundante');
  assert.ok(!falha(negacaoOperacional, 'REDUNDANT_OPERATIONAL_ESCALATION'), 'negacao de nova Fabrica nao deve ser tratada como recomendacao redundante');
}

function testarEtapa23_PrintFuturoNaoExigeOCRDeAnexo() {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Tire um print do pedido logo apos a aprovacao, mostrando o campo de status, para validar se a correcao aplicada resolveu o sintoma.',
    manifesto: {
      selecionados: [{ id: 'img-1', tipo: 'imagem', status: 'ANALISADA', nome: 'diagnostico.png' }],
      omitidos: [],
    },
    pergunta: 'Analise os anexos e diga o proximo passo.',
  });
  assert.ok(!falha(gate, 'VISUAL_EVIDENCE_TOO_GENERIC'), 'pedido de print futuro para validacao nao deve ser tratado como citacao generica do anexo analisado');
}

function testarEtapa23_RetryDirecionadoPorPRR() {
  const plano = planoRespostaRastreavel.montarPlano({
    manifesto: {
      quadroInvestigativo: {
        problemaPrincipal: 'Rateio de nota apresenta erro no campo % Rateio.',
        estadoOperacional: 'encaminhado_fabrica_em_andamento',
        evidencias: [{
          referencia: 'print-rateio.png',
          papeis: ['CENTRAL'],
          resumo: 'Print mostra "Modo edicao nao respeitado. Valor nao pode ser atribuido. (% Rateio)".',
          vinculoCausal: 'Possivel vinculo com o problema principal; confirmar pela resposta e demais evidencias.',
        }],
        lacunasInformacao: ['Falta fonte, log ou ponto de entrada real que atua no campo % Rateio.'],
        acoesParaReduzirIncerteza: ['Cobrar retorno tecnico da Fabrica com fonte/log/gatilho do bloqueio de atribuicao.'],
      },
    },
  });
  const gate = {
    falhas: [
      { codigo: 'INTERNAL_IDS_USED_AS_EVIDENCE', decisionKind: 'bloqueio_objetivo' },
      { codigo: 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE', decisionKind: 'bloqueio_objetivo', termos: ['RATEIO_DOCENTRADA'] },
      { codigo: 'REDUNDANT_OPERATIONAL_ESCALATION', decisionKind: 'bloqueio_objetivo' },
    ],
  };
  const instrucao = qualityGateService.montarInstrucaoRetry(gate, {
    manifesto: {
      quadroInvestigativo: { estadoOperacional: 'encaminhado_fabrica_em_andamento' },
      planoRespostaRastreavel: plano,
    },
  });
  assert.ok(/INTERNAL_IDS_USED_AS_EVIDENCE/.test(instrucao), 'retry deve tratar IDs internos de forma direcionada');
  assert.ok(/RATEIO_DOCENTRADA/.test(instrucao), 'retry deve citar a referencia cuja ATRIBUICAO precisa ser corrigida');
  assert.ok(/ATRIBUICAO/.test(instrucao), 'retry deve pedir correcao de atribuicao, nao remocao do conteudo tecnico');
  assert.ok(/encaminhado_fabrica_em_andamento/.test(instrucao), 'retry deve receber estado operacional atual');
  assert.ok(!/descreva funcionalmente|descricao funcional generica/i.test(instrucao), 'retry nao deve pedir para trocar referencia tecnica por descricao generica');
  assert.ok(/Organizacao do caso \(PRR\)/.test(instrucao), 'retry deve incluir a organizacao do caso (PRR) resumida');
  assert.ok(!/autorizad/i.test(instrucao) && !/nao invente nome de rotina/i.test(instrucao), 'retry nao deve tratar o PRR como lista de conhecimento autorizado');
  assert.ok(/Mantenha o conteudo tecnico/.test(instrucao), 'retry deve preservar o conteudo tecnico e corrigir so atribuicao/certeza');
}

function testarEtapa23_PrrNaoBloqueiaNegacaoDeCausaConfirmada() {
  const plano = {
    lacunasObrigatorias: [{ texto: 'Falta validacao do sintoma em producao.', bloqueiaConclusao: true }],
    termosTecnicosPermitidos: [],
  };
  const falhasNegacao = planoRespostaRastreavel.avaliarRespostaContraPlano({
    textoResposta: 'Isso e apoio externo, nao causa confirmada aqui; falta validar o sintoma original em producao.',
    plano,
  });
  assert.ok(!falhasNegacao.some(f => f.codigo === 'PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP'), 'negacao explicita de causa confirmada nao deve bloquear');

  const falhasAfirmacao = planoRespostaRastreavel.avaliarRespostaContraPlano({
    textoResposta: 'A causa confirmada e a rotina de envio, mesmo sem validacao do sintoma.',
    plano,
  });
  assert.ok(falhasAfirmacao.some(f => f.codigo === 'PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP'), 'afirmacao conclusiva com lacuna bloqueante deve continuar bloqueando');
}

function testarEtapa24_RespostaSeguraRemoveReferenciaNaoAutorizada() {
  const plano = {
    fatosComprovados: [{
      id: 'fato-pdf',
      texto: 'PDF extraido: Parametro MV_TESTE deve ficar ativo apenas em homologacao. Cliente relata erro em producao.',
      origem: 'anexo',
      permissaoUso: 'fato_do_chamado',
    }],
    termosTecnicosPermitidos: [{
      termo: 'MV_TESTE',
      tipo: 'parametro',
      usoPermitido: 'fato_do_chamado',
      causalPermitido: true,
      origens: [{ origem: 'anexo', referencia: 'manual-parametrizacao.pdf' }],
    }],
    lacunasObrigatorias: [],
    proximoPassoRecomendado: {
      descricao: 'Confirmar o valor do parametro em producao e comparar com homologacao antes de concluir a causa.',
      origem: 'quadro_investigativo',
      exigeValidacao: true,
    },
  };
  const gate = {
    falhas: [{
      codigo: 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED',
      termos: ['PAG_PARAMETRO'],
      decisionKind: 'bloqueio_objetivo',
    }],
  };
  const segura = planoRespostaRastreavel.gerarRespostaSeguraDeterministica({ plano, gate });
  assert.ok(segura?.texto, 'deve gerar resposta segura quando referencia nao autorizada e acessoria');
  assert.ok(!/PAG_PARAMETRO/.test(segura.texto), 'resposta segura nao pode manter referencia fora do PRR');
  assert.ok(/MV_TESTE/.test(segura.texto), 'referencia autorizada pelo PRR deve ser preservada');
  assert.ok(!/resposta anterior|quality gate|retry|controle de rastreabilidade|PRR/i.test(segura.texto), 'resposta segura entregue ao analista nao pode expor bastidores internos');

  const qg = qualityGateService.avaliarResposta({
    textoResposta: segura.texto,
    manifesto: { selecionados: [], omitidos: [], planoRespostaRastreavel: plano },
    pergunta: 'Analise o PDF.',
  });
  assert.ok(!falha(qg, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'), 'resposta segura nao deve violar o PRR');
}

function testarEtapa24_RespostaSeguraPreservaFailClosedCritico() {
  const plano = {
    fatosComprovados: [{ id: 'fato', texto: 'Print mostra FINA050 em tela de contabilidade.', origem: 'observacao_visual' }],
    termosTecnicosPermitidos: [{
      termo: 'FINA050',
      tipo: 'rotina',
      usoPermitido: 'contexto_visual',
      causalPermitido: false,
      origens: [{ origem: 'observacao_visual', referencia: 'print.png' }],
    }],
    lacunasObrigatorias: [{ texto: 'Sem ponte causal entre contabilidade e problema de compras.', bloqueiaConclusao: true }],
    proximoPassoRecomendado: { descricao: 'Validar o sintoma principal no fluxo de compras.' },
  };
  const gate = {
    falhas: [{
      codigo: 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE',
      termos: ['FINA050'],
      decisionKind: 'bloqueio_objetivo',
    }],
  };
  const segura = planoRespostaRastreavel.gerarRespostaSeguraDeterministica({ plano, gate });
  assert.strictEqual(segura, null, 'falha critica de causalidade visual nao deve ser escondida por recuperacao deterministica');
}

function testarEtapa24_RespostaSeguraNaoReescreveApenasEstilo() {
  const plano = {
    fatosComprovados: [{ id: 'fato', texto: 'Fonte anexado retorna variavel sem inicializacao.', origem: 'anexo' }],
    termosTecnicosPermitidos: [],
    lacunasObrigatorias: [],
    proximoPassoRecomendado: { descricao: 'Aplicar a correcao em homologacao e validar o fluxo original.' },
  };
  const gate = {
    falhas: [{
      codigo: 'ROBOTIC_TEMPLATE_RESPONSE',
      decisionKind: 'correcao_estilo',
    }],
  };
  const segura = planoRespostaRastreavel.gerarRespostaSeguraDeterministica({ plano, gate });
  assert.strictEqual(segura, null, 'recuperacao deterministica nao deve substituir resposta tecnica quando resta apenas correcao de estilo');
}

function testarQualityGate_BloqueiaVazamentoDeRetry() {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'A resposta anterior falhou no Quality Gate, entao vou refazer de forma menos robotica.',
    manifesto: { selecionados: [{ tipo: 'anexo', status: 'ANALISADA', nome: 'erro.log' }], omitidos: [] },
    pergunta: 'Analise o erro.',
  });
  assert.ok(falha(gate, 'RETRY_CONTEXT_LEAKED'), 'resposta final nao pode expor bastidor de retry/Quality Gate ao analista');
}

function testarInvestigacao_FailClosedAposRetryComQualquerFalha() {
  const status = investigacaoService._statusFinalExecucao({
    retryDeQualityGate: true,
    qualityGate: {
      aprovado: false,
      falhas: [{
        codigo: 'RETRY_CONTEXT_LEAKED',
        decisionKind: 'correcao_estilo',
      }],
    },
  });
  assert.strictEqual(status, 'concluido_com_alerta_quality_gate', 'falha remanescente apos retry entrega a resposta com alerta (2026-10-23)');
}

function testarInvestigativo_ModuloNaoContaminaPorRotuloTitulo() {
  const atendimento = seedAtendimento([
    'Caso anonimizado: CH-04',
    'Sistema/modulo: Protheus / Estoque',
    'Titulo: ERRO SMARTVIEW - KARDEX',
    'Assunto: ERRO SMARTVIEW - KARDEX',
    'Descricao: Ao abrir o SmartView do Kardex ocorre erro na consulta de estoque.',
  ].join('\n'));
  salvarMsg(atendimento, 'customer', 'Ao abrir o SmartView do Kardex ocorre erro na consulta de estoque.');

  const contexto = montarContexto(atendimento, 'Qual o proximo passo?');
  const quadro = contexto.manifesto.quadroInvestigativo;

  assert.ok(/Estoque \/ Kardex/.test(quadro.dominioModuloProvavel), 'dominio deve usar o modulo/problema real de estoque');
  assert.ok(!/Financeiro \/ contabilidade/.test(quadro.dominioModuloProvavel), 'rotulo administrativo Titulo nao pode classificar como financeiro');
}

function testarInvestigativo_DadosAberturaSaoSinalConfiavel() {
  const atendimento = seedAtendimento([
    'Caso anonimizado: CH-09',
    'Titulo: [TERMO_MASCARADO] [TERMO_MASCARADO] NO RETORNO',
    'Descricao: Texto livre mascarado sem termos tecnicos suficientes.',
  ].join('\n'));
  salvarMsg(atendimento, 'customer', 'Texto livre mascarado sem termos tecnicos suficientes.');

  const contexto = montarContexto(atendimento, 'Qual o proximo passo?', {
    chamado: {
      produto: 'Protheus',
      familia: 'Backoffice',
      modulo: 'Financeiro',
      servico: 'Retorno bancario',
      titulo: 'BORDERÔ COM ERRO NO RETORNO',
      assunto: 'BORDERÔ COM ERRO NO RETORNO',
    },
  });
  const quadro = contexto.manifesto.quadroInvestigativo;

  assert.ok(/Financeiro \/ contabilidade/.test(quadro.dominioModuloProvavel), 'modulo/servico da abertura devem classificar dominio quando o texto livre esta mascarado');
}

function testarInvestigativo_NFeNaoViraEntradaRateioSemSinalDeEntrada() {
  const atendimento = seedAtendimento([
    'Caso anonimizado: SINT-001',
    'Sistema/modulo: Protheus / Faturamento',
    'Titulo: Impressao de DANFE falha apos recompilar fonte customizado',
    'Descricao: Ao imprimir DANFE/NF-e ocorre erro em fonte ADVPL customizado.',
  ].join('\n'));
  salvarMsg(atendimento, 'customer', 'Ao imprimir DANFE no Protheus, a rotina falha apos recompilar fonte customizado em homologacao.');

  const contexto = montarContexto(atendimento, 'Qual o proximo passo?');
  const quadro = contexto.manifesto.quadroInvestigativo;

  assert.ok(/Faturamento \/ NF-e/.test(quadro.dominioModuloProvavel), 'DANFE/NF-e deve classificar como faturamento');
  assert.ok(!/Documento de entrada \/ rateio/.test(quadro.dominioModuloProvavel), 'NF-e/DANFE sem entrada, compra ou rateio nao pode contaminar dominio como documento de entrada');
}

function testarInvestigativo_AnexoOmitidoViraLacunaNoPRR() {
  const atendimento = seedAtendimento('Sistema/modulo: Protheus / TAF\nTitulo: LANÇAMENTO DE APOSENTADORIA POR INVALIDEZ PERMANENTE');
  salvarMsg(atendimento, 'customer', 'Preciso lançar aposentadoria por invalidez permanente com data retroativa no TAF/eSocial.');
  salvarAnexo(atendimento, {
    nomeOriginal: 'carta-concessao.pdf',
    mimeType: 'application/pdf',
    conteudoExtraido: '',
    linguagemDetectada: 'pdf',
  });

  const contexto = montarContexto(atendimento, 'Analise o caso.', { anexosDoTurno: [] });
  const quadro = contexto.manifesto.quadroInvestigativo;
  const plano = contexto.manifesto.planoRespostaRastreavel;

  assert.ok(/TAF \/ eSocial/.test(quadro.dominioModuloProvavel), 'dominio deve preservar TAF/eSocial sem cair em financeiro por Titulo');
  assert.ok(quadro.evidenciasIndisponiveis.some(e => e.referencia === 'carta-concessao.pdf'), 'anexo sem texto deve aparecer como evidencia indisponivel');
  assert.ok(plano.lacunasObrigatorias.some(l => /carta-concessao\.pdf/.test(l.texto) && l.bloqueiaConclusao), 'PRR deve carregar lacuna bloqueante do anexo indisponivel');
  assert.ok(/nao afirmar conteudo desse anexo/i.test(plano.lacunasObrigatorias.map(l => l.texto).join(' ')), 'lacuna deve impedir falsa leitura do anexo');
}

function testarEtapa32_PesquisaExternaContextualNaoViraCausa() {
  const plano = {
    fatosComprovados: [{ id: 'fato', texto: 'Chamado relata erro em relatorio contabil.', origem: 'historico' }],
    termosTecnicosPermitidos: [{
      termo: 'SIGACTB',
      tipo: 'modulo',
      usoPermitido: 'apoio_externo_apenas',
      causalPermitido: false,
      origens: [{ origem: 'pesquisa_externa', referencia: 'TOTVS' }],
    }],
    lacunasObrigatorias: [],
  };

  const permitido = qualityGateService.avaliarResposta({
    textoResposta: 'A pesquisa externa da TOTVS sobre SIGACTB foi recuperada como pagina oficial e mostra que esse e um tema documentado, mas nao comprova a causa do chamado.',
    manifesto: { selecionados: [], omitidos: [], planoRespostaRastreavel: plano },
    pergunta: 'Analise o erro.',
  });
  assert.ok(!falha(permitido, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'referencia externa contextual com limite causal explicito nao deve ser bloqueada como causa');

  const bloqueado = qualityGateService.avaliarResposta({
    textoResposta: 'O SIGACTB causou o erro e deve ser ajustado para resolver o chamado.',
    manifesto: { selecionados: [], omitidos: [], planoRespostaRastreavel: plano },
    pergunta: 'Analise o erro.',
  });
  assert.ok(falha(bloqueado, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'), 'referencia externa promovida a causa/acao sem ponte causal deve continuar bloqueada');
}

function testarEtapa32_LogCriticoPreservaIdentificadorTecnicoNoPRR() {
  const atendimento = seedAtendimento([
    'Sistema/modulo: Protheus / Compras',
    'Titulo: Erro ao aprovar solicitacao de compras',
    'Descricao: Ao aprovar a solicitacao ocorre falha no workflow de compras.',
  ].join('\n'));
  salvarMsg(atendimento, 'customer', 'Ao aprovar a solicitacao de compras ocorre falha no workflow.');
  const ruido = 'linha informativa sem relevancia '.repeat(30);
  salvarAnexo(atendimento, {
    nomeOriginal: 'erro-workflow.log',
    mimeType: 'text/plain',
    linguagemDetectada: 'log',
    conteudoExtraido: `${ruido}\nCOMMAND FAILED on FWTHREADSEMAPHOREEX durante aprovacao no SIGACOM\nCustom routine U_MATR080C em MATR080_CUSTOM.PRX retornou erro\n${ruido}`,
  });

  const contexto = montarContexto(atendimento, 'Analise o erro.');
  const termos = (contexto.manifesto.planoRespostaRastreavel.termosTecnicosPermitidos || []).map(t => t.termo);
  assert.ok(termos.includes('U_MATR080C') || termos.includes('MATR080_CUSTOM.PRX'), 'log tecnico critico deve preservar identificadores relevantes no PRR');
}

// Regressao da auditoria independente 2026-10-11/12: PRR nao capturava
// termos tecnicos do texto completo de anexos/mensagens SELECIONADOS no
// manifesto (so varria o resumo compactado do quadro investigativo),
// bloqueando com PRR_TECHNICAL_REFERENCE_NOT_ALLOWED citacoes legitimas de
// termos presentes em PDF/log/codigo-fonte real do caso. Casos reais
// confirmados: 033521 (MATA300/SB2/SB8 citados pelo suporte no historico),
// 035398 (campos de um PDF de especificacao DOC044 anexado), 036166/036558
// (campos de log JSON e codigo-fonte PRW anexados).
function testarAuditoria2026_PRRCapturaTermoDeAnexoSelecionadoCompleto() {
  const atendimento = seedAtendimento('Chamado de divergencia de saldo entre tabelas Protheus.');
  const anexo = salvarAnexo(atendimento, {
    nomeOriginal: 'log-retorno.txt',
    mimeType: 'text/plain',
    linguagemDetectada: 'log',
    conteudoExtraido: 'Execucao da rotina MATA300 (Refaz Saldos) concluida; divergencia entre SB2 e SB8 identificada no produto 000074212.',
  });
  const contexto = montarContexto(atendimento, 'Investigue a divergencia de saldo.', { anexosDoTurno: [anexo] });
  const termos = (contexto.manifesto.planoRespostaRastreavel.termosTecnicosPermitidos || []).map(t => t.termo);
  assert.ok(termos.includes('MATA300'), 'termo tecnico presente em anexo selecionado deve entrar no PRR como permitido');

  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'A rotina MATA300 (Refaz Saldos) foi executada e a divergencia entre SB2 e SB8 confirma a hipotese levantada no log.',
    manifesto: contexto.manifesto,
    pergunta: 'Investigue a divergencia de saldo.',
  });
  assert.ok(!falha(gate, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'), 'citar termo presente no anexo selecionado nao deve disparar bloqueio de referencia fora do PRR');
}

// Regressao: ATTACHMENT_NOT_ANALYZED disparava mesmo quando o atendimento
// NAO TEM nenhum anexo (ex.: pergunta de investigacao padrao menciona a
// palavra "anexos" genericamente). Caso real confirmado: 036381 (chamado
// consultivo, so historico textual, 0 anexos).
function testarAuditoria2026_AttachmentNotAnalyzedNaoDisparaSemAnexoDisponivel() {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Com base no historico, trata-se de uma consulta de arquitetura, nao ha evidencia tecnica a investigar.',
    manifesto: { selecionados: [], omitidos: [], anexosDisponiveis: 0 },
    pergunta: 'Faca a investigacao com base no historico e nos anexos disponiveis.',
  });
  assert.ok(!falha(gate, 'ATTACHMENT_NOT_ANALYZED'), 'nao deve reclamar de anexo nao analisado quando o atendimento nao tem nenhum anexo');
}

function testarAuditoria2026_AttachmentNotAnalyzedContinuaValidoComAnexoReal() {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Nao analisei o anexo enviado.',
    manifesto: { selecionados: [], omitidos: [], anexosDisponiveis: 2 },
    pergunta: 'Compare o anexo enviado com o anterior.',
  });
  assert.ok(falha(gate, 'ATTACHMENT_NOT_ANALYZED'), 'deve continuar bloqueando quando ha anexo disponivel e nenhum foi analisado');
}

// Regressao: CRITICAL_EVIDENCE_OMITTED disparava para mensagens de HISTORICO
// cortadas por orcamento de contexto (comportamento esperado do sistema),
// nao apenas para ANEXOS criticos de fato omitidos. Caso real confirmado:
// 035068 (15 itens omitidos eram todos mensagens, nenhum anexo).
function testarAuditoria2026_CriticalEvidenceOmittedIgnoraMensagemDeHistorico() {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Resposta direta com base no log analisado.',
    manifesto: {
      selecionados: [{ tipo: 'anexo', status: 'ANALISADA' }],
      omitidos: [{ id: 'msg-1', tipo: 'mensagem', score: 100, status: 'DISPONIVEL_NAO_ENVIADA' }],
    },
    pergunta: 'Analise o log.',
  });
  assert.ok(!falha(gate, 'CRITICAL_EVIDENCE_OMITTED'), 'mensagem de historico cortada por orcamento nao deve contar como evidencia critica omitida');
}

function testarAuditoria2026_CriticalEvidenceOmittedContinuaValidoParaAnexo() {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Resposta sem considerar o segundo anexo.',
    manifesto: {
      selecionados: [{ tipo: 'anexo', status: 'ANALISADA' }],
      omitidos: [{ id: 'an-2', tipo: 'anexo', score: 90, status: 'DISPONIVEL_NAO_ENVIADA' }],
    },
    pergunta: 'Analise todos os anexos.',
  });
  assert.ok(falha(gate, 'CRITICAL_EVIDENCE_OMITTED'), 'anexo critico de fato omitido deve continuar bloqueando');
}

// Regressao: resposta afirmando que uma soma/correspondencia numerica "fecha"
// quando na verdade nao fecha (achado real, caso 035635: diferenca de saldo
// de R$ 61.487,96 atribuida a dois valores que somam R$ 11.263.000,00, uma
// discrepancia de ~184x nunca detectada pelo Quality Gate anterior).
function testarAuditoria2026_ArithmeticClaimDoesNotReconcile() {
  const gateErrado = qualityGateService.avaliarResposta({
    textoResposta: 'A diferenca de R$ 61.487,96 corresponde a duas aplicacoes CDB de grande volume (11.117.500,00 + 145.500,00) que explicam a divergencia.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Explique a divergencia de saldo.',
  });
  assert.ok(falha(gateErrado, 'ARITHMETIC_CLAIM_DOES_NOT_RECONCILE'), 'correspondencia numerica que nao fecha deve ser bloqueada');

  const gateCorreto = qualityGateService.avaliarResposta({
    textoResposta: 'A diferenca de R$ 100,00 corresponde a dois lancamentos: 60,00 + 40,00, confirmados no extrato.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Explique a divergencia de saldo.',
  });
  assert.ok(!falha(gateCorreto, 'ARITHMETIC_CLAIM_DOES_NOT_RECONCILE'), 'correspondencia numerica que fecha corretamente nao deve ser bloqueada');

  const gateSemMencaoNumerica = qualityGateService.avaliarResposta({
    textoResposta: 'Nao ha divergencia relevante nos valores apresentados pelo cliente.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Explique a divergencia de saldo.',
  });
  assert.ok(!falha(gateSemMencaoNumerica, 'ARITHMETIC_CLAIM_DOES_NOT_RECONCILE'), 'resposta sem afirmacao de correspondencia numerica nao deve ser avaliada por este criterio');
}

// Regressao: VISUAL_EVIDENCE_TOO_GENERIC usava um vocabulario de deteccao
// (fwwhen/rateio/100,00 etc.) calibrado so para cenarios de customizacao de
// tela/rateio — achado real, caso 036166: resposta citou codigo de tela
// curto ("V260416") e status operacional lido do print ("BLOQUEADO /
// REJEITADO", campo de data "vazia (/ /)") e foi bloqueada como generica,
// mesmo citando conteudo concreto que so vem de leitura real da imagem.
function testarAuditoria2026_VisualEvidenceConcretaForaDoVocabularioDeRateio() {
  const manifesto = { selecionados: [{ tipo: 'imagem', status: 'ANALISADA' }], omitidos: [] };
  const respostaComCodigoDeTela = qualityGateService.avaliarResposta({
    textoResposta: 'Os prints confirmam: o titulo 53 aparece com DT Baixa vazia (/ /), e o Monitor de Pagamentos (V260416) exibe o status BLOQUEADO / REJEITADO com a mensagem do banco.',
    manifesto,
    pergunta: 'Analise os prints.',
  });
  assert.ok(!falha(respostaComCodigoDeTela, 'VISUAL_EVIDENCE_TOO_GENERIC'), 'citar codigo de tela curto (V260416) e status lido do print nao deve ser tratado como generico');

  // Controle negativo: resposta que so menciona "o print" de forma vaga,
  // sem transcrever nada exclusivo da imagem, deve continuar bloqueada.
  const respostaVaga = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra que a grid esta vazia, o que sugere um problema na integracao.',
    manifesto,
    pergunta: 'Analise o print.',
  });
  assert.ok(falha(respostaVaga, 'VISUAL_EVIDENCE_TOO_GENERIC'), 'mencao vaga a print sem conteudo concreto deve continuar bloqueada');

  // Controle negativo: parenteses vazios de chamada de funcao no codigo-fonte
  // (ex. SendSoapMsg()) nao deve ser confundido com "campo vazio lido na tela".
  const respostaComParentesesDeCodigo = qualityGateService.avaliarResposta({
    textoResposta: 'O print mostra a grid vazia. No fonte, a chamada `_oWsdl:SendSoapMsg()` pode estar falhando silenciosamente.',
    manifesto,
    pergunta: 'Analise o print e o fonte.',
  });
  assert.ok(falha(respostaComParentesesDeCodigo, 'VISUAL_EVIDENCE_TOO_GENERIC'), 'parenteses vazios de chamada de funcao no codigo nao deve ser lido como evidencia visual concreta');
}

function main() {
  testarCaso036475_ComprasNaoPromoveContabilidadeIncidental();
  testarCaso035988_ContratosEmTesteNaoReabreFabrica();
  testarCaso036726_RegressaoComCompilacaoPendente();
  testarCaso036596_ReuniaoEFabricaNaoSignificamResolucao();
  testarAdversarial_RelacaoIntermodularLegitimaComPonte();
  testarAdversarial_HistoricoIncompletoEAcoesPrometidas();
  testarAdversarial_CorrecaoAplicadaSemValidacaoBloqueiaReabertura();
  testarAdversarial_EvidenciaNovaAlteraHipotese();
  testarEtapa12_RastreabilidadeTecnica();
  testarEtapa12_FatosOperacionaisEIdsInternos();
  testarEtapa13_RastreabilidadeVisualSemPromoverCausa();
  testarEtapa13_ImagemSemOCRNaoViraProvaLivre();
  testarEtapa13_HipoteseTecnicaCondicional();
  testarEtapa14_DecisoesEObservacaoVisual();
  testarEtapa14_VisualSemObservacaoViraEvidenciaInsuficiente();
  testarEtapa14_NegacaoDeReferenciaExternaNaoBloqueia();
  testarEtapa14_AcaoTelaNaoEIdentificadorTecnico();
  testarEtapa14_ContagemPorExtenso();
  testarEtapa23_ContagemOperacionalExigeQuantidadeExplicita();
  testarEtapa15_HipoteseTecnicaComoExemploNaoBloqueia();
  testarEtapa15_CustomizacaoCondicionalNaoBloqueia();
  testarEtapa15_FailClosedPorBloqueioObjetivo();
  testarEtapa2_PRRNoContextoEPrompt();
  testarEtapa2_PRRBloqueiaReferenciaTecnicaNaoAutorizada();
  testarEtapa2_PRRPermiteHipoteseSemNomeInventado();
  testarEtapa21_PRRReconciliacaoVisualPermiteContexto();
  testarEtapa21_PRRSemObservacaoNaoAutorizaVisual();
  testarEtapa22_ContextoVisualENegacaoCausal();
  testarEtapa22_BloqueiaCausaERecomendacaoVisualSemPonte();
  testarEtapa22_ReferenciaExternaIncidentalVersusCausa();
  testarEtapa22_InventadosEIdsContinuamBloqueados();
  testarEtapa22_RedundanciaOperacionalPreservada();
  testarEtapa23_PrintFuturoNaoExigeOCRDeAnexo();
  testarEtapa23_RetryDirecionadoPorPRR();
  testarEtapa23_PrrNaoBloqueiaNegacaoDeCausaConfirmada();
testarEtapa24_RespostaSeguraRemoveReferenciaNaoAutorizada();
testarEtapa24_RespostaSeguraPreservaFailClosedCritico();
testarEtapa24_RespostaSeguraNaoReescreveApenasEstilo();
testarQualityGate_BloqueiaVazamentoDeRetry();
testarInvestigacao_FailClosedAposRetryComQualquerFalha();
testarInvestigativo_ModuloNaoContaminaPorRotuloTitulo();
  testarInvestigativo_DadosAberturaSaoSinalConfiavel();
  testarInvestigativo_NFeNaoViraEntradaRateioSemSinalDeEntrada();
  testarInvestigativo_AnexoOmitidoViraLacunaNoPRR();
  testarEtapa32_PesquisaExternaContextualNaoViraCausa();
  testarEtapa32_LogCriticoPreservaIdentificadorTecnicoNoPRR();
  testarAuditoria2026_PRRCapturaTermoDeAnexoSelecionadoCompleto();
  testarAuditoria2026_AttachmentNotAnalyzedNaoDisparaSemAnexoDisponivel();
  testarAuditoria2026_AttachmentNotAnalyzedContinuaValidoComAnexoReal();
  testarAuditoria2026_CriticalEvidenceOmittedIgnoraMensagemDeHistorico();
  testarAuditoria2026_CriticalEvidenceOmittedContinuaValidoParaAnexo();
  testarAuditoria2026_ArithmeticClaimDoesNotReconcile();
  testarAuditoria2026_VisualEvidenceConcretaForaDoVocabularioDeRateio();
  console.log('etapa1-quadro-investigativo.test.js: ok (4 casos reais anonimizados + 43 adversariais/rastreabilidade/PRR + 7 regressao auditoria 2026-10)');
}

try {
  main();
} finally {
  database.fecharDB();
}
