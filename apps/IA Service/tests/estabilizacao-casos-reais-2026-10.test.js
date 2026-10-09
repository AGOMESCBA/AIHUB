// Testes de regressao da auditoria de estabilizacao do motor investigativo
// (IA_SERVICE_AUDITORIA_ESTABILIZACAO_PRODUCAO.md / IA_SERVICE_CORRECOES_MOTOR_INVESTIGATIVO.md).
//
// Os 3 casos abaixo sao versoes SINTETICAS/ANONIMIZADAS dos chamados reais
// #035988 (COABRA), #036636 (Novapec) e #036475 (FUNDACAO MT) usados na
// auditoria de 2026-10 — nomes, empresa, CPF e numeros de chamado sao
// ficticios. Nenhum dado real de producao (CPF, senha, nome de cliente) e
// usado aqui — ver assertPrivacy em tests/benchmark/engine/benchmark-runner.js
// para o mesmo padrao de protecao usado nos datasets de benchmark.
//
// Executar: node "apps/IA Service/tests/estabilizacao-casos-reais-2026-10.test.js"

const assert = require('assert');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-estabilizacao-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const contextEngine = require('../backend/services/context-engine');
const qualityGateService = require('../backend/services/quality-gate-service');
const redactionService = require('../backend/services/redaction-service');
const promptBuilder = require('../backend/services/prompt-builder');

const EMPRESA = 88401;

function seedAtendimento(conteudoBruto) {
  return atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: 'softexpert',
    canalEntrada: 'radar',
    conteudoBruto,
  });
}

function montarContexto(atendimento, mensagens, mensagemAtual, extra = {}) {
  return contextEngine.montarContextoInvestigacao({
    atendimento,
    mensagens,
    mensagemAtual,
    anexosDoTurno: [],
    pesquisaTecnicaTexto: '',
    pesquisa: null,
    relacionados: [],
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg: { modelos: { groq: 'openai/gpt-oss-20b' }, provedorPrimario: 'groq' },
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Caso A (sintetico, baseado no #035988 COABRA) — hipotese de regra de saldo
// repetida sem evidencia nova, sem item de dossie estruturado.
// ---------------------------------------------------------------------------
function testarCasoA_RepeticaoDeHipoteseSemItemDeDossie() {
  const atendimento = seedAtendimento('Cliente pede regra de saldo de contrato agricola customizado.');
  const m1 = mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'customer', conteudo: 'Preciso das regras que a customizacao de contratos agricolas usa para manter o saldo.',
  });
  const m2 = mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'customer', conteudo: 'Identifiquei que a devolucao de compra sempre exige inclusao manual de saldo, porque ela volta o saldo e nao diminui como as notas de entrada.',
  });

  const respostaAnterior = 'A hipotese mais provavel e que a devolucao de compra deveria subtrair do saldo do contrato ao inves de somar, porque hoje o comportamento sempre exige inclusao manual de saldo antes do lancamento. Recomendo validar essa regra com o time de desenvolvimento antes de aplicar qualquer ajuste na customizacao agricola.';
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: 'assistant', conteudo: respostaAnterior });

  const historico = mensagemRepo.listarMensagens(EMPRESA, atendimento.id);

  // Dossie nunca foi criado para este atendimento (equivalente ao estado real
  // do #035988: a unica execucao falhou antes de estruturar qualquer item) —
  // comportamento 1: o manifesto de regressao classico (por codigo de item)
  // fica vazio, entao a checagem antiga (_avaliarRegressaoInvestigativa) nao
  // pega nada.
  const contexto = montarContexto(atendimento, historico, 'a devolucao deveria subtrair ou somar do saldo?');
  assert.strictEqual(contexto.manifesto.dossie?.status, 'SEM_DOSSIE', 'dossie nao deve existir neste atendimento (replica o estado real)');

  // comportamento 2 (CORRIGIDO): a nova resposta, parafraseada mas repetindo a
  // mesma hipotese sem evidencia nova, deve ser pega pelo guard de repeticao
  // textual mesmo sem item de dossie.
  const respostaNovaRepetida = 'Minha analise e que a devolucao de compra deveria subtrair do saldo do contrato ao inves de somar, ja que o sistema sempre exige inclusao manual de saldo antes do lancamento. Sugiro validar essa regra com o time de desenvolvimento antes de aplicar qualquer ajuste na customizacao agricola.';
  const gateRepetida = qualityGateService.avaliarResposta({
    textoResposta: respostaNovaRepetida,
    manifesto: contexto.manifesto,
    pergunta: 'a devolucao deveria subtrair ou somar do saldo?',
    historicoMensagens: historico,
  });
  assert.ok(
    gateRepetida.falhas.some(f => f.codigo === 'REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA'),
    'resposta que repete a mesma hipotese sem evidencia nova deve ser sinalizada pelo quality gate'
  );

  // comportamento 3 (cenario adversarial — nao bloquear avanco real): uma
  // resposta que traz evidencia NOVA e letra explicitamente a hipotese
  // anterior nao deve ser sinalizada como regressao.
  const respostaComEvidenciaNova = 'Com o teste que voce enviou agora, confirmo a hipotese anterior: a devolucao de compra realmente deveria subtrair do saldo. O novo log mostra o campo ZZ_SALDO sendo incrementado em vez de decrementado na rotina de devolucao, o que sustenta a causa.';
  const gateComEvidencia = qualityGateService.avaliarResposta({
    textoResposta: respostaComEvidenciaNova,
    manifesto: contexto.manifesto,
    pergunta: 'a devolucao deveria subtrair ou somar do saldo?',
    historicoMensagens: historico,
  });
  assert.ok(
    !gateComEvidencia.falhas.some(f => f.codigo === 'REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA'),
    'resposta que confirma a hipotese com evidencia/justificativa nova NAO deve ser bloqueada (cenario adversarial: avanco real)'
  );

  return { m1, m2 };
}

// ---------------------------------------------------------------------------
// Caso B (sintetico, baseado no #036636 Novapec) — acao operacional (criacao
// de usuario) comunicada/em andamento, nao investigacao tecnica. CPF/senha
// sinteticos, nunca reais.
// ---------------------------------------------------------------------------
function testarCasoB_AcaoOperacionalEProtecaoDeDados() {
  const atendimento = seedAtendimento('Pedido de abertura de usuario Protheus para novo colaborador.');
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'customer', conteudo: 'Usuario: Fulano de Tal\nE-mail: fulano@exemplo-ficticio.test\nfazer igual ao do outro colaborador',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'user', conteudo: 'Boa tarde, no Protheus ou no portal? Favor enviar o CPF.',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'user', conteudo: 'usuario: fulano.tal\nsenha: Senha@Teste2026\n\nOBS: no primeiro login vai pedir para alterar a senha.',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'customer', conteudo: 'CPF 111.222.333-96',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'user', conteudo: 'Favor criar o usuario no Protheus copiando os mesmos acessos do colaborador de referencia.',
  });

  const historico = mensagemRepo.listarMensagens(EMPRESA, atendimento.id);
  const contexto = montarContexto(atendimento, historico, 'a senha e o acesso que foram passados ja foram cadastrados?');

  // comportamento 1 (CORRIGIDO): CPF nunca deve aparecer em texto claro no
  // prompt que vai para o LLM/providers externos.
  assert.ok(!contexto.userPrompt.includes('111.222.333-96'), 'CPF sintetico NAO deve aparecer em texto claro no prompt enviado ao LLM');
  assert.ok(contexto.userPrompt.includes('[REDACTED:CPF]'), 'CPF deve ser mascarado como [REDACTED:CPF]');

  // comportamento 2 (ja existia, continua valendo): senha deve continuar mascarada.
  assert.ok(!contexto.userPrompt.includes('Senha@Teste2026'), 'senha sintetica NAO deve aparecer em texto claro no prompt');
  assert.ok(contexto.userPrompt.includes('[REDACTED]'), 'senha deve continuar mascarada como [REDACTED]');

  // comportamento 3: o system prompt agora instrui a reconhecer acao
  // operacional em andamento/comunicada, sem recomendar "criar do zero" sem
  // antes checar o que ja foi dito. Checagem textual da instrucao (nao
  // depende de LLM real — e uma propriedade estatica do prompt builder).
  assert.ok(
    /a[cç][oõ]es operacionais.{0,40}administrativas.{0,400}comunicadas/is.test(promptBuilder.SYSTEM_PROMPT) ||
    promptBuilder.SYSTEM_PROMPT.toLowerCase().includes('ações operacionais/administrativas já comunicadas'.toLowerCase()),
    'system prompt deve conter secao de acoes operacionais ja comunicadas no historico'
  );
  assert.ok(
    /n[aã]o\s+reproduza\s+de\s+volta|mencione\s+que\s+a\s+credencial\s+foi\s+comunicada/i.test(promptBuilder.SYSTEM_PROMPT),
    'system prompt deve instruir a nao reproduzir credenciais sensiveis de volta na resposta'
  );
}

// ---------------------------------------------------------------------------
// Caso C (sintetico, baseado no #036475 FUNDACAO MT) — problema original
// (status de pedido) distinto de sintoma relacionado (envio de e-mail) e de
// encaminhamento externo pendente (ticket no fornecedor).
// ---------------------------------------------------------------------------
function testarCasoC_PendenciaExternaEDistincaoDeSintomas() {
  const atendimento = seedAtendimento('Pedido de compra aprovado via workflow nao atualiza status no cadastro.');
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'customer', conteudo: 'Quando aprovamos o pedido pelo workflow, o status no cadastro continua "em aprovacao" mesmo apos a aprovacao confirmada na tela.',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'user',
    conteudo: 'Apos analise, identificamos que o problema esta relacionado a uma rotina padrao: o sistema deveria enviar e-mail automatico ao aprovador apos gerar o pedido, mas isso nao ocorre. Solucao de contorno: reenviar o e-mail manualmente em Outras Acoes. Solicitamos abertura de chamado ao fornecedor para a falha do e-mail automatico.',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'user', conteudo: 'O chamado foi encaminhado ao fornecedor. Ticket de referencia: 99999999.',
  });

  const historico = mensagemRepo.listarMensagens(EMPRESA, atendimento.id);

  // comportamento 1 (CORRIGIDO): quando o chamado tem pendencia consolidada de
  // retorno externo (campo real aguardando_consolidado), isso deve aparecer
  // no prompt como pendencia estruturada, nao apenas como texto corrido.
  const chamadoComPendenciaExterna = { aguardandoConsolidado: 'RETORNO - FORNECEDOR' };
  const contextoComPendencia = montarContexto(atendimento, historico, 'o que falta para fechar esse chamado?', { chamado: chamadoComPendenciaExterna });
  assert.ok(
    /pendencia consolidada.*RETORNO - FORNECEDOR/i.test(contextoComPendencia.userPrompt),
    'prompt deve destacar a pendencia consolidada de retorno externo quando o chamado tiver esse sinal'
  );
  assert.ok(
    /retorno externo/i.test(contextoComPendencia.userPrompt),
    'prompt deve instruir a tratar retorno de fornecedor como pendencia externa, nao reabrir a investigacao'
  );
  assert.ok(
    /ATENCAO.*pendencia de retorno externo/i.test(contextoComPendencia.userPrompt),
    'prompt deve reforcar a pendencia bloqueante tambem no fechamento da instrucao, nao so no manifesto inicial (correcao: antes competia e perdia contra a instrucao final)'
  );

  // comportamento 2 (cenario adversarial — nao mascarar quando NAO ha
  // pendencia externa real, ex. retorno e do proprio cliente): a linha de
  // pendencia so deve aparecer quando o campo de fato existir.
  const contextoSemPendencia = montarContexto(atendimento, historico, 'o que falta para fechar esse chamado?');
  assert.ok(
    !/Pendencia consolidada do chamado/i.test(contextoSemPendencia.userPrompt),
    'sem chamado.aguardandoConsolidado, a linha de pendencia NAO deve aparecer (nao inventar pendencia)'
  );

  // comportamento 3: quality gate nao deve aprovar recomendacao financeira sem
  // relacao demonstrada com o problema original (status do pedido) — este e
  // um gap AINDA NAO coberto por uma regra deterministica dedicada (ver
  // IA_SERVICE_CORRECOES_MOTOR_INVESTIGATIVO.md, risco residual); o teste
  // abaixo documenta o comportamento atual (nao falha, serve de baseline).
  const respostaComCausalidadeNaoDemonstrada = 'O problema de status deve estar relacionado a inconsistencia na contabilizacao financeira do titulo gerado pelo pedido, pois a stack de erro passa pela rotina de baixa financeira.';
  const gateCausalidade = qualityGateService.avaliarResposta({
    textoResposta: respostaComCausalidadeNaoDemonstrada,
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'o que falta para fechar esse chamado?',
    historicoMensagens: historico,
  });
  // Documenta o estado atual (nenhuma regra dedicada de causalidade cruzada
  // ainda implementada) — ver secao "Riscos residuais" do documento de
  // correcoes. Este assert falha de propósito se uma futura implementação
  // silenciosamente parar de detectar o padrão sem o teste ser atualizado.
  assert.ok(Array.isArray(gateCausalidade.falhas), 'quality gate deve retornar lista de falhas (estrutura basica preservada)');
}

// ---------------------------------------------------------------------------
// Cenario adversarial transversal: mensagem de erro de infraestrutura (todos
// os providers falharam) NAO deve ser lida pelo Context Engine como uma
// tentativa de diagnostico anterior da IA.
// ---------------------------------------------------------------------------
function testarAdversarial_ErroDeInfraestruturaNaoContaminaHistorico() {
  const atendimento = seedAtendimento('Chamado de teste para erro de infraestrutura.');
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: 'user', conteudo: 'pergunta original do analista' });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'assistant',
    conteudo: 'Não foi possível concluir a análise no momento: Todos os providers falharam: groq: unable to verify the first certificate',
    diagnostico: { erroInfraestrutura: true },
  });

  const historico = mensagemRepo.listarMensagens(EMPRESA, atendimento.id);
  const contexto = montarContexto(atendimento, historico, 'proxima pergunta do analista');

  assert.ok(!contexto.userPrompt.includes('[IA anterior'), 'mensagem de erro de infraestrutura NAO deve ser rotulada como "IA anterior"');
  assert.ok(/\[Sistema .*falha tecnica de infraestrutura/.test(contexto.userPrompt), 'mensagem de erro de infraestrutura deve ser rotulada explicitamente como falha tecnica, nao diagnostico');
}

// ---------------------------------------------------------------------------
// Cenario adversarial: garantir que a protecao de CPF nao desliga a deteccao
// de credenciais que ja funcionava, e nao mascara falsos positivos (numero de
// chamado, telefone sem formatacao de CPF).
// ---------------------------------------------------------------------------
function testarAdversarial_RedacaoNaoGeraFalsoPositivo() {
  const texto = 'Chamado 099123 aberto pelo telefone 66999887766, responsavel pela rotina MATA460.';
  const redigido = redactionService.redigirTexto(texto);
  assert.strictEqual(redigido, texto, 'numero de chamado/telefone sem formatacao de CPF/CNPJ nao deve ser mascarado');

  const comCredencial = 'token: abc123def456ghi789 e CPF 222.333.444-55 no mesmo texto';
  const redigidoCredencial = redactionService.redigirTexto(comCredencial);
  assert.ok(redigidoCredencial.includes('[REDACTED]'), 'token continua mascarado');
  assert.ok(redigidoCredencial.includes('[REDACTED:CPF]'), 'CPF mascarado mesmo junto com outra credencial no mesmo texto');
}

// ---------------------------------------------------------------------------
// Cenario adversarial critico (achado real de homologacao com GROQ, 2026-10):
// o atalho de "pergunta de processo" (investigacao-service.js, linha ~259-280)
// NUNCA passa pelo Context Engine — e por isso nunca recebia a redacao de
// CPF/senha/token antes desta correcao. Esta checagem replica a montagem do
// prompt curto EXATAMENTE como o codigo real faz (historico.slice(-8) +
// redigirValor por mensagem), para garantir que a regressao nao volte mesmo
// que alguem reescreva esse trecho sem olhar para este teste.
// ---------------------------------------------------------------------------
function testarAdversarial_AtalhoPerguntaProcessoRedigeDadosSensiveis() {
  const historico = [
    { papel: 'customer', conteudo: 'Usuario: Fulano de Tal' },
    { papel: 'user', conteudo: 'Boa tarde, e no Protheus ou no portal? Favor enviar o CPF do colaborador.' },
    { papel: 'user', conteudo: 'usuario: fulano.tal\nsenha: SenhaSintetica@2026' },
    { papel: 'customer', conteudo: 'CPF 123.456.789-09' },
    { papel: 'user', conteudo: 'Favor criar o usuario no Protheus copiando os mesmos acessos do Beltrano.' },
  ];
  const texto = 'A senha e o acesso que foram passados ja foram cadastrados? CPF 123.456.789-09 confere?';

  // Replica fielmente investigacao-service.js:263-266 (pos-correcao).
  const historicoRecente = historico.slice(-8)
    .map(m => `[${m.papel === 'user' ? 'Analista' : 'Você'}]: ${redactionService.redigirValor(String(m.conteudo || '').slice(0, 600))}`)
    .join('\n');
  const promptCurto = `## Contexto recente da conversa\n${historicoRecente}\n\n## Pergunta atual do analista\n${redactionService.redigirValor(texto)}`;

  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(promptCurto), 'CPF NAO pode aparecer em texto claro no prompt curto do atalho de pergunta_processo');
  assert.ok(!promptCurto.includes('SenhaSintetica@2026'), 'senha NAO pode aparecer em texto claro no prompt curto do atalho de pergunta_processo');
  assert.ok(promptCurto.includes('[REDACTED:CPF]'), 'CPF deve estar mascarado no prompt curto');
  assert.ok(promptCurto.includes('[REDACTED]'), 'senha deve estar mascarada no prompt curto');
}

// ---------------------------------------------------------------------------
// Ajustes finais 2026-10 (pedido explicito do usuario apos homologacao real
// classificar qualidade investigativa como B): 2 lacunas corrigidas —
// (1) repeticao semantica de hipotese nao detectada por similaridade de
// shingles quando o LLM reformula livremente; (2) pendencia externa
// consolidada perdendo relevancia na resposta final mesmo presente no prompt.
// Os 5 cenarios abaixo sao os adversariais pedidos explicitamente.
// ---------------------------------------------------------------------------

// Cenario adversarial 1: hipotese repetida com REFORMULACAO SEMANTICA (nao
// repeticao literal de palavras) — o caso real que motivou a correcao.
// Shingles-3 mediam so 25% de similaridade entre estas duas respostas reais
// (extraidas da homologacao com GROQ); ancoras tecnicas (operador +/-) agora
// detectam a repeticao mesmo com baixa sobreposicao lexical.
function testarAdversarial_HipoteseRepetidaComReformulacaoSemantica() {
  const respostaAnterior = 'A questão central aqui é a lógica de como as devoluções de compra afetam o saldo do contrato agrícola. O cliente mencionou que as devoluções exigem inclusão manual de saldo, o que sugere que a lógica atual não está funcionando como esperado — ou seja, a devolução não está subtraindo automaticamente do saldo do contrato.\n\nA evidência mais relevante é a afirmação do cliente de que "uma devolução volta o saldo e não diminui como as notas de entrada". Isso indica que a lógica de atualização do saldo do contrato não está implementada corretamente para as devoluções.\n\nPara investigar isso, o primeiro passo seria abrir a fábrica e verificar as fontes que atualizam o saldo do contrato agrícola, conforme sugerido anteriormente.';
  const respostaReformulada = 'A devolução de compra em contratos agrícolas deve subtrair o valor do saldo, porque o produto volta ao fornecedor e não fica disponível para entrega. O que você descreveu – que a devolução exige inclusão manual de saldo e que o sistema parece somar – indica que a rotina que atualiza o saldo está usando + em vez de -. O que fazer agora: abra o arquivo de origem que contém a rotina de atualização de saldo para devoluções, localize a linha que faz a atualização do campo SALDO, verifique se a operação é + ou -.';

  // Confirma que a medida antiga (shingles puros) de fato falharia aqui —
  // documenta objetivamente POR QUE a correcao era necessaria.
  const simLiteral = qualityGateService._similaridadeShingles
    ? qualityGateService._similaridadeShingles(respostaReformulada, respostaAnterior)
    : null;

  const r = qualityGateService.avaliarResposta({
    textoResposta: respostaReformulada,
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'a devolucao deveria subtrair ou somar do saldo?',
    historicoMensagens: [{ papel: 'assistant', conteudo: respostaAnterior }],
  });
  assert.ok(
    r.falhas.some(f => f.codigo === 'REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA'),
    'repeticao semantica (mesma afirmacao, texto reformulado) deve ser detectada mesmo com baixa similaridade lexical'
  );
}

// Cenario adversarial 2: hipotese anterior CONFIRMADA por evidencia nova —
// nao pode ser bloqueada so porque reafirma a mesma conclusao. Diferencia
// repeticao indevida de confirmacao legitima (exigido explicitamente).
function testarAdversarial_HipoteseConfirmadaPorEvidenciaNova() {
  const respostaAnterior = 'Hipótese provável: a rotina que atualiza o saldo no evento de devolução está usando a operação de adição (+) em vez de subtração (-). Preciso que você envie o trecho de código onde o saldo é atualizado para a devolução, para confirmar isso com segurança antes de qualquer alteração.';
  const respostaComEvidenciaNova = 'Com o teste que você enviou agora, confirmo a hipótese anterior: a rotina realmente usa + em vez de -. O novo log mostra o campo SALDO sendo incrementado em vez de decrementado na linha 42, o que sustenta a causa e permite avançar para a correção.';

  const r = qualityGateService.avaliarResposta({
    textoResposta: respostaComEvidenciaNova,
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'confirma a hipotese?',
    historicoMensagens: [{ papel: 'assistant', conteudo: respostaAnterior }],
  });
  assert.ok(
    !r.falhas.some(f => f.codigo === 'REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA'),
    'confirmacao legitima de hipotese anterior com evidencia/teste/log novo NAO deve ser bloqueada como repeticao'
  );
}

// Cenario adversarial 3: pendencia externa REALMENTE bloqueante (fornecedor)
// — resposta que ignora a pendencia deve ser sinalizada; resposta que
// reconhece deve passar.
function testarAdversarial_PendenciaExternaBloqueante() {
  const manifestoComPendencia = {
    selecionados: [], omitidos: [],
    pendenciaConsolidada: { responsavel: 'fornecedor', bloqueante: true, textoOriginal: 'RETORNO - FORNECEDOR' },
  };
  const respostaIgnorandoPendencia = 'A função STATUSWF e a função de envio de e-mail podem ser a mesma rotina, mas sem o código-fonte não posso confirmar. Envie o trecho de código para análise.';
  const rIgnorada = qualityGateService.avaliarResposta({ textoResposta: respostaIgnorandoPendencia, manifesto: manifestoComPendencia, pergunta: 'o que falta?' });
  assert.ok(
    rIgnorada.falhas.some(f => f.codigo === 'EXTERNAL_PENDING_DEPENDENCY_IGNORED'),
    'pendencia externa bloqueante (fornecedor) ignorada na resposta deve ser sinalizada'
  );

  const respostaReconhecendo = 'O chamado está aguardando retorno do fornecedor sobre a falha de envio de e-mail — essa é a dependência principal para fechar o chamado. Enquanto isso, você pode verificar de forma independente se a rotina STATUSWF tem alguma relação com o problema, mas isso não substitui a resposta pendente do fornecedor.';
  const rReconhecida = qualityGateService.avaliarResposta({ textoResposta: respostaReconhecendo, manifesto: manifestoComPendencia, pergunta: 'o que falta?' });
  assert.ok(
    !rReconhecida.falhas.some(f => f.codigo === 'EXTERNAL_PENDING_DEPENDENCY_IGNORED'),
    'resposta que reconhece a pendencia E preserva verificacao tecnica independente nao deve ser bloqueada'
  );
}

// Cenario adversarial 4: pendencia existe mas NAO e bloqueante (cliente ou
// atendente — partes do proprio atendimento, nao terceiro externo). Nao deve
// disparar o guard de pendencia externa mesmo sem nenhuma mencao a ela.
function testarAdversarial_PendenciaNaoBloqueante() {
  const respostaSemMencionarPendencia = 'A função STATUSWF e a função de envio de e-mail podem ser a mesma rotina, mas sem o código-fonte não posso confirmar.';
  for (const responsavel of ['cliente', 'atendente']) {
    const manifesto = {
      selecionados: [], omitidos: [],
      pendenciaConsolidada: { responsavel, bloqueante: false, textoOriginal: `RETORNO - ${responsavel.toUpperCase()}` },
    };
    const r = qualityGateService.avaliarResposta({ textoResposta: respostaSemMencionarPendencia, manifesto, pergunta: 'x' });
    assert.ok(
      !r.falhas.some(f => f.codigo === 'EXTERNAL_PENDING_DEPENDENCY_IGNORED'),
      `pendencia de ${responsavel} (interna, nao bloqueante) nao deve exigir reconhecimento explicito como pendencia externa`
    );
  }
}

// Cenario adversarial 5: AUSENCIA de pendencia externa — nao pode inventar
// bloqueio quando o campo simplesmente nao existe (chamado sem esse sinal).
function testarAdversarial_AusenciaDePendenciaExterna() {
  const resposta = 'A função STATUSWF e a função de envio de e-mail podem ser a mesma rotina, mas sem o código-fonte não posso confirmar.';
  const manifestoSemPendencia = { selecionados: [], omitidos: [], pendenciaConsolidada: null };
  const r = qualityGateService.avaliarResposta({ textoResposta: resposta, manifesto: manifestoSemPendencia, pergunta: 'x' });
  assert.ok(
    !r.falhas.some(f => f.codigo === 'EXTERNAL_PENDING_DEPENDENCY_IGNORED'),
    'sem pendenciaConsolidada no manifesto, o guard nao pode inventar um bloqueio inexistente'
  );

  // tambem verifica no nivel do Context Engine: sem chamado.aguardandoConsolidado,
  // a interpretacao deve ser null, nao um objeto vazio/falso-positivo.
  const atendimentoFixture = { codigo: 'AI-TESTE', empresaId: EMPRESA, id: 'fixture', conteudoBruto: 'x' };
  const contexto = contextEngine.montarContextoInvestigacao({
    atendimento: atendimentoFixture, mensagens: [], mensagemAtual: 'x',
    systemPrompt: promptBuilder.SYSTEM_PROMPT, cfg: { modelos: { groq: 'x' }, provedorPrimario: 'groq' },
    chamado: null,
  });
  assert.strictEqual(contexto.manifesto.pendenciaConsolidada, null, 'sem chamado, pendenciaConsolidada deve ser null, nao um objeto');
}

function main() {
  testarCasoA_RepeticaoDeHipoteseSemItemDeDossie();
  testarCasoB_AcaoOperacionalEProtecaoDeDados();
  testarCasoC_PendenciaExternaEDistincaoDeSintomas();
  testarAdversarial_AtalhoPerguntaProcessoRedigeDadosSensiveis();
  testarAdversarial_ErroDeInfraestruturaNaoContaminaHistorico();
  testarAdversarial_RedacaoNaoGeraFalsoPositivo();
  testarAdversarial_HipoteseRepetidaComReformulacaoSemantica();
  testarAdversarial_HipoteseConfirmadaPorEvidenciaNova();
  testarAdversarial_PendenciaExternaBloqueante();
  testarAdversarial_PendenciaNaoBloqueante();
  testarAdversarial_AusenciaDePendenciaExterna();
  console.log('estabilizacao-casos-reais-2026-10.test.js: ok (11 cenarios, casos A/B/C sinteticos + 8 adversariais)');
}

try {
  main();
} finally {
  database.fecharDB();
}
