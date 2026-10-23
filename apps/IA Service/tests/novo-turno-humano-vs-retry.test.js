// Novo turno humano x retry automatico do Quality Gate (2026-10; regressao
// sintetica equivalente ao caso #036765, sem dados reais do chamado).
// Principio: o Quality Gate valida a RESPOSTA; quem decide pedir nova
// investigacao e o analista. Retry automatico continua com todas as protecoes.
// Nao chama IA nem rede: providers, busca e classificador sao simulados.
// Executar: node "apps/IA Service/tests/novo-turno-humano-vs-retry.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-turno-humano-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const aiConfigService = require('../backend/services/ai-config-service');
const aiProviderClient = require('../backend/services/ai-provider-client');
const promptBuilder = require('../backend/services/prompt-builder');
const technicalResearchService = require('../backend/services/technical-research-service');
const qualityGateService = require('../backend/services/quality-gate-service');
const investigacaoDossieAtualizador = require('../backend/services/investigacao-dossie-atualizador-service');
const dossieContextService = require('../backend/services/dossie-context-service');
const investigacaoService = require('../backend/services/investigacao-service');

const EMPRESA = 9101;
const OUTRA_EMPRESA = 9102;
const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });
const falha = (gate, codigo) => (gate?.falhas || []).some(f => f.codigo === codigo);

const PEDIDO_TURNO_1 = 'Revise todo o historico, anexos e fontes disponiveis e pesquise uma solucao para este chamado.';
const PEDIDO_TURNO_2 = 'Preciso de mais detalhes sim, inclusive poderia pesquisar se tem algum chamado na totvs ou nos foruns sobre esse tipo de problema.';
const CONTEUDO_CHAMADO = 'Portal web recusa a gravacao da solicitacao de ajuste com a mensagem ERR-PRZ-01 Prazo excedido. O prazo configurado e de 20 dias.';
const RESPOSTA_BOA_1 = 'O portal recusa a solicitacao com ERR-PRZ-01 porque a data informada passa do prazo configurado de 20 dias. A pesquisa externa nas fontes oficiais nao retornou resultados para este caso. Primeiro teste: grave em homologacao uma solicitacao dentro do prazo e compare com a recusada.';
const RESPOSTA_BOA_2 = 'Complementando a resposta anterior: a pesquisa externa foi feita nas fontes TOTVS e foruns e nao retornou nenhum resultado que confirme a causa. Continua sem confirmacao se o prazo de 20 dias e validado no portal ou no backend. Falta o log do servidor no momento da recusa ERR-PRZ-01. Proximo passo: coletar esse log em homologacao repetindo a gravacao.';
const REJEITADA = 'MARCADOR_REJEITADO_XYZ Conforme o Quality Gate, a causa confirmada e o prazo.';

function criarAtendimento(empresaId = EMPRESA) {
  return atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto: CONTEUDO_CHAMADO });
}

function interpretacao({ pedido = false, evidenciaNova = false } = {}) {
  return {
    haMudancaInvestigativa: evidenciaNova,
    tipoMudanca: evidenciaNova ? 'evidencia_nova' : 'nenhuma_mudanca',
    haEvidenciaNova: evidenciaNova,
    relevanciaParaPesquisa: evidenciaNova ? 'alta' : 'nenhuma',
    justificativa: 'fixture',
    referenciasEstado: [],
    confiancaQualitativa: 'media',
    pedidoInvestigacaoAnalista: pedido,
  };
}

// Executa processarTurno com IA, busca e classificador simulados, mas com a
// logica REAL de planejamento de pesquisa, Quality Gate e retry.
async function comFluxoSimulado({ respostas, semantica = interpretacao() }, fn) {
  const old = {
    resolver: aiConfigService.resolverKeysEOrdem,
    configPesquisa: aiConfigService.resolverConfigPesquisa,
    pesquisar: technicalResearchService.pesquisar,
    chamarIA: aiProviderClient.chamarIA,
    dossie: investigacaoDossieAtualizador.atualizarAposTurno,
  };
  const reg = { principais: [], buscas: 0, semanticaCtx: [], pesquisaCtx: [] };
  aiConfigService.resolverKeysEOrdem = () => ({
    keys: { groq: 'gsk-test' },
    cfg: { provedorPrimario: 'groq', fallbackOrdem: 'groq', modelos: { groq: 'openai/gpt-oss-20b' } },
  });
  aiConfigService.resolverConfigPesquisa = () => ({ provedorPrimario: 'serper', fallbackOrdem: '', serperApiKey: 'fixture' });
  technicalResearchService.pesquisar = (ctx, opts = {}) => {
    reg.pesquisaCtx.push(ctx);
    return old.pesquisar(ctx, {
      ...opts,
      buscarSerper: async () => { reg.buscas++; return []; },
      interpretarSemantico: async ({ ctx: c }) => {
        reg.semanticaCtx.push(c);
        return { resultado: typeof semantica === 'function' ? semantica(c) : semantica, provider: 'fixture', model: 'fixture', tokens: 10 };
      },
    });
  };
  investigacaoDossieAtualizador.atualizarAposTurno = async () => ({ aplicado: false });
  aiProviderClient.chamarIA = async (_keys, _cfg, system, prompt) => {
    if (/classifica uma única mensagem/.test(system)) return { texto: '{"tipo":"investigacao"}', provider: 'groq', model: 'x' };
    if (system !== promptBuilder.SYSTEM_PROMPT) throw new Error('chamada de IA inesperada no teste');
    reg.principais.push(prompt);
    const texto = typeof respostas === 'function' ? respostas(prompt, reg.principais.length) : respostas[Math.min(reg.principais.length - 1, respostas.length - 1)];
    return { texto, provider: 'groq', model: 'x', tentativas: [] };
  };
  try {
    return await fn(reg);
  } finally {
    aiConfigService.resolverKeysEOrdem = old.resolver;
    aiConfigService.resolverConfigPesquisa = old.configPesquisa;
    technicalResearchService.pesquisar = old.pesquisar;
    aiProviderClient.chamarIA = old.chamarIA;
    investigacaoDossieAtualizador.atualizarAposTurno = old.dossie;
  }
}

function ultimaExecucao(empresaId, atendimentoId) {
  return execucaoRepo.listarPorAtendimento(empresaId, atendimentoId, { limite: 1 })[0];
}

// ── 1. Retry automatico continua protegido ──────────────────────────────────
teste('gate: no retry automatico "resposta anterior" continua sendo vazamento e nao ha novo retry', () => {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'Na resposta anterior faltou a evidencia; reescrevendo com o log ERR-PRZ-01.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Analise o erro.',
    houveRetry: true,
  });
  assert.ok(falha(gate, 'RETRY_CONTEXT_LEAKED'));
  assert.strictEqual(gate.deveRetry, false, 'segundo retry nunca e permitido');
  assert.ok(qualityGateService.temFalhaDeIntegridade(gate), 'vazamento continua classificado como integridade');
  // 2026-10-23: o gate nunca trava a entrega; vira alerta.
  assert.strictEqual(investigacaoService._statusFinalExecucao({ qualityGate: gate, retryDeQualityGate: true }), 'concluido_com_alerta_quality_gate');
});

teste('gate: mencionar o Quality Gate e vazamento em qualquer tentativa', () => {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: 'O Quality Gate reprovou a analise, mas o erro ERR-PRZ-01 indica prazo.',
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Analise o erro.',
    houveRetry: false,
  });
  assert.ok(falha(gate, 'RETRY_CONTEXT_LEAKED'));
});

teste('gate: na primeira tentativa de um novo turno humano, "resposta anterior" e conversa, nao vazamento', () => {
  const gate = qualityGateService.avaliarResposta({
    textoResposta: RESPOSTA_BOA_2,
    manifesto: { selecionados: [], omitidos: [] },
    pergunta: 'Preciso de mais detalhes.',
    houveRetry: false,
    historicoMensagens: [{ papel: 'assistant', conteudo: RESPOSTA_BOA_1 }],
  });
  assert.ok(!falha(gate, 'RETRY_CONTEXT_LEAKED'), JSON.stringify(gate.falhas.map(f => f.codigo)));
});

// 2026-10-23 (caso #036537): o gate nunca trava a mensagem. Apos o retry, a
// resposta da IA e entregue com alerta; os codigos ficam so na auditoria.
teste('fluxo: resposta reprovada -> 1 retry permitido -> nova reprovacao -> entrega com alerta, sem loop', async () => {
  const at = criarAtendimento();
  await comFluxoSimulado({ respostas: [REJEITADA] }, async (reg) => {
    const msg = await investigacaoService.processarTurno(EMPRESA, at.id, { texto: PEDIDO_TURNO_1, usuarioId: 1 });
    assert.strictEqual(reg.principais.length, 2, `uma chamada + um retry, nunca mais (foram ${reg.principais.length})`);
    assert.match(reg.principais[1], /Reprocessamento por Quality Gate/);
    const exec = ultimaExecucao(EMPRESA, at.id);
    assert.strictEqual(exec.status, 'concluido_com_alerta_quality_gate');
    assert.ok(exec.qualityGate.falhas.some(f => f.codigo === 'RETRY_CONTEXT_LEAKED'), 'codigo interno preservado na auditoria');
    assert.ok(msg.conteudo.includes('MARCADOR_REJEITADO_XYZ'), 'a analise da IA e entregue');
    assert.ok(!/bloqueada para revisao|RETRY_CONTEXT_LEAKED/.test(msg.conteudo), 'sem aviso de bloqueio nem codigo interno');
  });
});

// ── 2. Caso #036765 (sintetico): novo turno humano apos a primeira resposta ─
teste('#036765 sintetico: turno 2 humano pedindo nova pesquisa executa a investigacao e nao e tratado como retry', async () => {
  const at = criarAtendimento();
  await comFluxoSimulado({
    respostas: (prompt) => (prompt.includes(PEDIDO_TURNO_2) ? RESPOSTA_BOA_2 : RESPOSTA_BOA_1),
    semantica: c => interpretacao({ pedido: c.texto === PEDIDO_TURNO_2 }),
  }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, at.id, { texto: PEDIDO_TURNO_1, usuarioId: 1 });
    const exec1 = ultimaExecucao(EMPRESA, at.id);
    assert.ok(exec1.pesquisa.consultasExecutadas.length > 0, 'turno 1 pesquisou');
    const buscasTurno1 = reg.buscas;
    const principaisTurno1 = reg.principais.length;

    const msg2 = await investigacaoService.processarTurno(EMPRESA, at.id, { texto: PEDIDO_TURNO_2, usuarioId: 1 });
    const exec2 = ultimaExecucao(EMPRESA, at.id);
    assert.strictEqual(reg.pesquisaCtx.at(-1).turnoHumano, true, 'mensagem persistida do analista = novo turno humano');
    assert.strictEqual(exec2.pesquisa.plano.devePesquisar, true, `motivo: ${exec2.pesquisa.plano.motivo}`);
    assert.strictEqual(exec2.pesquisa.plano.pedidoInvestigacaoAnalista, true);
    assert.ok(exec2.pesquisa.consultasExecutadas.length > 0, 'consultas reexecutadas apesar do historico do turno 1');
    assert.ok(reg.buscas > buscasTurno1, 'a busca externa foi de fato chamada no turno 2');
    assert.strictEqual(reg.principais.length - principaisTurno1, 1, 'turno 2 nao precisou de retry');
    assert.ok(!reg.principais.at(-1).includes('Reprocessamento por Quality Gate'), 'turno 2 nao herda instrucao de retry');
    assert.ok(!falha(exec2.qualityGate, 'RETRY_CONTEXT_LEAKED'));
    assert.ok(!falha(exec2.qualityGate, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'));
    assert.notStrictEqual(exec2.status, 'revisao_necessaria_quality_gate');
    assert.strictEqual(msg2.conteudo, RESPOSTA_BOA_2);
  });
});

teste('novo turno humano apos resposta entregue com alerta: investiga normalmente, sem codigos internos no prompt', async () => {
  const at = criarAtendimento();
  await comFluxoSimulado({
    respostas: (prompt, n) => (n <= 2 ? REJEITADA : RESPOSTA_BOA_2),
    semantica: c => interpretacao({ pedido: c.texto === 'Pesquise novamente.' }),
  }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, at.id, { texto: PEDIDO_TURNO_1, usuarioId: 1 });
    assert.strictEqual(ultimaExecucao(EMPRESA, at.id).status, 'concluido_com_alerta_quality_gate');

    const msg = await investigacaoService.processarTurno(EMPRESA, at.id, { texto: 'Pesquise novamente.', usuarioId: 1 });
    const exec = ultimaExecucao(EMPRESA, at.id);
    const prompt = reg.principais.at(-1);
    assert.strictEqual(reg.principais.length, 3, 'nova investigacao executada em uma unica tentativa');
    assert.ok(reg.semanticaCtx.some(c => c.texto === 'Pesquise novamente.'), 'mensagem curta do analista vai para a camada semantica');
    assert.strictEqual(exec.pesquisa.plano.devePesquisar, true, `motivo: ${exec.pesquisa.plano.motivo}`);
    assert.ok(!/bloqueada para revisao|RETRY_CONTEXT_LEAKED/.test(prompt), 'aviso de bloqueio e codigos nao entram no prompt');
    assert.notStrictEqual(exec.status, 'revisao_necessaria_quality_gate');
    assert.strictEqual(msg.conteudo, RESPOSTA_BOA_2);
  });
});

// ── 3. Pesquisa executada sem resultados ────────────────────────────────────
teste('pesquisa executada sem resultado: prompt orienta resposta operacional sem inventar', async () => {
  const at = criarAtendimento();
  await comFluxoSimulado({ respostas: [RESPOSTA_BOA_1] }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, at.id, { texto: PEDIDO_TURNO_1, usuarioId: 1 });
    const exec = ultimaExecucao(EMPRESA, at.id);
    assert.strictEqual(exec.pesquisa.modo, 'links');
    assert.match(reg.principais[0], /Busca externa EXECUTADA neste turno, sem resultado aproveitavel/);
    assert.match(reg.principais[0], /Nao invente resultados/);
    assert.ok(!falha(exec.qualityGate, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'), 'resposta que declara a ausencia de resultado e valida');
  });
});

teste('pesquisa sem resultado e resposta que nao declara: codigo fica na auditoria, resposta entregue com alerta (sem bloqueio)', async () => {
  const at = criarAtendimento();
  const semDeclarar = 'O portal recusa a solicitacao com ERR-PRZ-01 porque a data passa do prazo de 20 dias. Primeiro teste: grave em homologacao uma solicitacao dentro do prazo.';
  await comFluxoSimulado({ respostas: [semDeclarar] }, async () => {
    const msg = await investigacaoService.processarTurno(EMPRESA, at.id, { texto: PEDIDO_TURNO_1, usuarioId: 1 });
    const exec = ultimaExecucao(EMPRESA, at.id);
    assert.ok(falha(exec.qualityGate, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'), 'codigo tecnico mantido na auditoria');
    assert.notStrictEqual(exec.status, 'revisao_necessaria_quality_gate');
    assert.ok(!/bloqueada para revisao|RESEARCH_CONFIGURED_WITHOUT_RESULTS/.test(msg.conteudo), 'analista recebe a resposta, nao o codigo');
  });
});

teste('gate: declaracao de "sem resultado" so dispensa pesquisa que foi realmente executada', () => {
  const base = { manifesto: { selecionados: [], omitidos: [] }, pergunta: 'pesquise na TOTVS', textoResposta: 'A pesquisa nas fontes TOTVS nao retornou resultados para o erro ERR-PRZ-01.' };
  const executada = qualityGateService.avaliarResposta({ ...base, pesquisa: { configurado: true, modo: 'links', consultasExecutadas: ['ERR-PRZ-01 portal'] } });
  assert.ok(!falha(executada, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'));
  const dispensada = qualityGateService.avaliarResposta({ ...base, pesquisa: { configurado: true, modo: 'nao_pesquisado', consultasExecutadas: [] } });
  assert.ok(falha(dispensada, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'), 'pesquisa dispensada pelo plano continua falha');
  const naoDeclara = qualityGateService.avaliarResposta({ ...base, textoResposta: 'O erro ERR-PRZ-01 indica prazo excedido.', pesquisa: { configurado: true, modo: 'links', consultasExecutadas: ['ERR-PRZ-01 portal'] } });
  assert.ok(falha(naoDeclara, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'));
});

// ── 4. Nova evidencia apos tentativa anterior ───────────────────────────────
teste('nova evidencia apos bloqueio: novo turno investiga com o contexto tecnico anterior disponivel', async () => {
  const at = criarAtendimento();
  const novoLog = 'Segue novo log do servidor: java.lang.IllegalStateException PrazoValidator linha 88 ao gravar a solicitacao. Reavalie.';
  await comFluxoSimulado({
    respostas: (prompt, n) => (n === 1 ? RESPOSTA_BOA_1 : n <= 3 ? REJEITADA : RESPOSTA_BOA_2),
    semantica: c => interpretacao({ evidenciaNova: c.texto === novoLog }),
  }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, at.id, { texto: PEDIDO_TURNO_1, usuarioId: 1 });
    await investigacaoService.processarTurno(EMPRESA, at.id, { texto: 'Continua dando o mesmo erro, investigue outra possibilidade.', usuarioId: 1 });
    assert.strictEqual(ultimaExecucao(EMPRESA, at.id).status, 'concluido_com_alerta_quality_gate');

    const msg = await investigacaoService.processarTurno(EMPRESA, at.id, { texto: novoLog, usuarioId: 1 });
    const prompt = reg.principais.at(-1);
    assert.ok(prompt.includes('PrazoValidator'), 'nova evidencia entra no turno');
    assert.ok(prompt.includes('prazo configurado de 20 dias'), 'resposta tecnica aprovada anterior continua no contexto');
    assert.ok(!prompt.includes('Reprocessamento por Quality Gate'), 'instrucao de retry nao vaza para o turno seguinte');
    assert.ok(reg.pesquisaCtx.at(-1).dossieOperacional, 'dossie continua sendo montado');
    assert.strictEqual(msg.conteudo, RESPOSTA_BOA_2);
  });
});

// ── 5. Seguranca: automatico, multiempresa e decisao semantica ──────────────
teste('turno automatico nao ganha a garantia do pedido humano (dedup preservado)', async () => {
  const at = criarAtendimento();
  const dossie = dossieContextService.montarMemoriaOperacional({ empresaId: EMPRESA, atendimentoId: at.id, mensagemAtual: PEDIDO_TURNO_2, orcamentoEntrada: 16000 });
  const ctx = { empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto: PEDIDO_TURNO_2, dossieOperacional: dossie };
  const opts = { buscarSerper: async () => [], interpretarSemantico: async () => ({ resultado: interpretacao({ pedido: true }) }) };
  // Turno 1 ja executou as mesmas consultas: o historico passa a deduplicar.
  const anterior = await technicalResearchService.pesquisar({ ...ctx, forcarPesquisa: true }, opts);
  execucaoRepo.salvarExecucao(EMPRESA, { atendimentoId: at.id, status: 'concluido', pesquisa: anterior });
  const automatico = await technicalResearchService.pesquisar({ ...ctx, turnoHumano: false }, opts);
  assert.strictEqual(automatico.plano.devePesquisar, false, `automatico continua sem repetir pesquisa: ${automatico.plano.motivo}`);
  assert.notStrictEqual(automatico.plano.pedidoInvestigacaoAnalista, true);
  const humano = await technicalResearchService.pesquisar({ ...ctx, turnoHumano: true }, opts);
  assert.strictEqual(humano.plano.devePesquisar, true);
  assert.strictEqual(humano.plano.pedidoInvestigacaoAnalista, true);
});

teste('semantica decide: turno humano que nao e pedido de investigacao nao forca pesquisa', async () => {
  const at = criarAtendimento();
  execucaoRepo.salvarExecucao(EMPRESA, { atendimentoId: at.id, status: 'concluido', pesquisa: { consultas: ['portal ERR-PRZ-01 prazo excedido'] } });
  const texto = 'O que o cliente respondeu sobre o prazo de 20 dias no ultimo contato?';
  const dossie = dossieContextService.montarMemoriaOperacional({ empresaId: EMPRESA, atendimentoId: at.id, mensagemAtual: texto, orcamentoEntrada: 16000 });
  const r = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto, dossieOperacional: dossie, turnoHumano: true },
    { buscarSerper: async () => [], interpretarSemantico: async () => ({ resultado: interpretacao({ pedido: false }) }) });
  assert.strictEqual(r.plano.devePesquisar, false, r.plano.motivo);
  assert.notStrictEqual(r.plano.pedidoInvestigacaoAnalista, true);
});

// Decisao do usuario (2026-10): cortesia seguida de ordem e pedido do analista.
// O atalho de conversa administrativa nao pode impedir a camada semantica.
teste('cortesia + ordem ("Ok, procura nos foruns") chega a semantica e executa a pesquisa', async () => {
  const pedidos = [
    'Ok, procura nos fóruns.',
    'Beleza, investigue outra causa.',
    'Certo, pesquisa de novo.',
    'Combinado, procura outra possibilidade.',
    'Ok, dá uma olhada nos fóruns.',
    'Beleza, vê outra causa.',
    'Valeu, investiga mais.',
  ];
  for (const texto of pedidos) {
    const at = criarAtendimento();
    let consultada = false;
    const r = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto, turnoHumano: true }, {
      buscarSerper: async () => [],
      interpretarSemantico: async () => { consultada = true; return { resultado: interpretacao({ pedido: true }) }; },
    });
    assert.ok(consultada, `"${texto}" deve chegar a camada semantica`);
    assert.strictEqual(r.plano.devePesquisar, true, `"${texto}": ${r.plano.motivo}`);
    assert.strictEqual(r.plano.pedidoInvestigacaoAnalista, true, texto);
  }
});

teste('cortesia pura ("Ok, obrigado") nao vira pesquisa: a semantica decide que nao e pedido', async () => {
  for (const texto of ['Ok, obrigado.', 'Beleza, valeu!', 'Combinado, vou verificar com o cliente.']) {
    const at = criarAtendimento();
    let consultada = false;
    const r = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto, turnoHumano: true }, {
      buscarSerper: async () => { throw new Error('nao deveria buscar'); },
      interpretarSemantico: async () => { consultada = true; return { resultado: interpretacao({ pedido: false }) }; },
    });
    assert.strictEqual(r.plano.devePesquisar, false, `"${texto}": ${r.plano.motivo}`);
    assert.notStrictEqual(r.plano.pedidoInvestigacaoAnalista, true, texto);
    if (!consultada) assert.match(r.plano.motivo || '', /./);
  }
});

teste('turno automatico com texto de cortesia continua no atalho administrativo (sem chamada semantica)', async () => {
  const at = criarAtendimento();
  let consultada = false;
  const r = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto: 'Ok, procura nos fóruns.', turnoHumano: false }, {
    buscarSerper: async () => [],
    interpretarSemantico: async () => { consultada = true; return { resultado: interpretacao({ pedido: true }) }; },
  });
  assert.strictEqual(consultada, false);
  assert.strictEqual(r.plano.devePesquisar, false);
});

// Decisao do usuario (2026-10): na duvida o chat pergunta ao analista;
// agradecimentos e confirmacoes nao sao pesquisa.
teste('duvida: semantica "incerto" nao pesquisa e orienta o chat a perguntar ao analista', async () => {
  const at = criarAtendimento();
  const texto = 'E sobre aquele outro ponto do prazo, como fica?';
  const r = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto, turnoHumano: true }, {
    buscarSerper: async () => { throw new Error('nao deveria buscar'); },
    interpretarSemantico: async () => ({ resultado: { ...interpretacao(), pedidoInvestigacaoAnalista: 'incerto' } }),
  });
  assert.strictEqual(r.plano.devePesquisar, false);
  assert.strictEqual(r.plano.confirmarPedidoPesquisa, true);
  assert.match(technicalResearchService.formatarContextoParaPrompt(r, []), /pergunte ao analista, em uma frase objetiva, se ele quer que a pesquisa seja feita/);
});

teste('duvida: classificador indisponivel numa mensagem que nao e cortesia -> pergunta; cortesia -> nada', async () => {
  const falhar = async () => { throw new Error('provider fora'); };
  const at = criarAtendimento();
  const duvida = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto: 'E aquele outro ponto do prazo, como fica?', turnoHumano: true }, { buscarSerper: async () => [], interpretarSemantico: falhar });
  assert.strictEqual(duvida.plano.confirmarPedidoPesquisa, true, duvida.plano.motivo);
  for (const texto of ['Ok, obrigado.', 'Combinado, valeu!']) {
    const at2 = criarAtendimento();
    const r = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at2.id, atendimento: at2, texto, turnoHumano: true }, { buscarSerper: async () => [], interpretarSemantico: falhar });
    assert.strictEqual(r.plano.devePesquisar, false, texto);
    assert.notStrictEqual(r.plano.confirmarPedidoPesquisa, true, `agradecimento/confirmacao nao gera pergunta: ${texto}`);
  }
});

teste('duvida: semantica "sim" pesquisa; "nao" (agradecimento) nem pesquisa nem pergunta', async () => {
  for (const [valor, pesquisa, pergunta] of [['sim', true, false], ['nao', false, false]]) {
    const at = criarAtendimento();
    const r = await technicalResearchService.pesquisar({ empresaId: EMPRESA, atendimentoId: at.id, atendimento: at, texto: valor === 'sim' ? 'Ok, procura nos fóruns.' : 'Ok, obrigado.', turnoHumano: true }, {
      buscarSerper: async () => [],
      interpretarSemantico: async () => ({ resultado: { ...interpretacao(), pedidoInvestigacaoAnalista: valor } }),
    });
    assert.strictEqual(r.plano.devePesquisar, pesquisa, valor);
    assert.strictEqual(!!r.plano.confirmarPedidoPesquisa, pergunta, valor);
  }
});

teste('gate: aguardando confirmacao so dispensa a falha de pesquisa quando a resposta pergunta', () => {
  const pesquisa = { configurado: true, modo: 'nao_pesquisado', consultasExecutadas: [], plano: { confirmarPedidoPesquisa: true } };
  const base = { manifesto: { selecionados: [], omitidos: [] }, pergunta: 'e a pesquisa na totvs?', pesquisa };
  const pergunta = qualityGateService.avaliarResposta({ ...base, textoResposta: 'O erro ERR-PRZ-01 indica prazo excedido. Quer que eu pesquise na documentacao TOTVS e nos foruns?' });
  assert.ok(!falha(pergunta, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'));
  const semPergunta = qualityGateService.avaliarResposta({ ...base, textoResposta: 'O erro ERR-PRZ-01 indica prazo excedido.' });
  assert.ok(falha(semPergunta, 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'));
});

teste('pendencia externa: mensagem no chat e liberada 100% (sem classificador)', async () => {
  const gatePendencia = require('../backend/services/pendencia-externa-gate');
  const pendencia = { externa: true, responsavel: 'cliente' };
  for (const texto of ['e agora?', 'obrigado', 'pesquise outra causa']) {
    const d = await gatePendencia.decidirPesquisaExterna({ pendencia, origemAcao: 'texto_livre', texto });
    assert.strictEqual(d.liberada, true, texto);
    assert.strictEqual(d.chamadaIA, false, texto);
  }
});
teste('multiempresa: status de execucao bloqueada so e lido na propria empresa', () => {
  const at = criarAtendimento();
  const m = mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'assistant', conteudo: 'x' });
  execucaoRepo.salvarExecucao(EMPRESA, { atendimentoId: at.id, mensagemId: m.id, status: 'revisao_necessaria_quality_gate' });
  assert.strictEqual(execucaoRepo.listarStatusPorMensagens(EMPRESA, [m.id])[m.id], 'revisao_necessaria_quality_gate');
  assert.deepStrictEqual(execucaoRepo.listarStatusPorMensagens(OUTRA_EMPRESA, [m.id]), {});
});

function limparEDesligar() {
  try { database.fecharDB(); } catch (_) {}
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbTmpPath + s, { force: true });
}

async function main() {
  let falhas = 0;
  for (const t of testes) {
    try {
      await t.fn();
      console.log(`  ok  ${t.nome}`);
    } catch (err) {
      falhas++;
      console.error(`  FALHOU  ${t.nome}\n    ${err.stack || err.message}`);
    }
  }
  limparEDesligar();
  console.log(falhas ? `\n${falhas} teste(s) falharam.` : `\n${testes.length} testes passaram.`);
  process.exit(falhas ? 1 : 0);
}

main().catch(err => { console.error(err); limparEDesligar(); process.exit(1); });
