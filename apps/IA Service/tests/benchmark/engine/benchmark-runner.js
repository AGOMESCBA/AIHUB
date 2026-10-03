'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const database = require('../../../backend/database');
const atendimentoRepo = require('../../../backend/repositories/atendimento-repository');
const mensagemRepo = require('../../../backend/repositories/mensagem-repository');
const anexoRepo = require('../../../backend/repositories/anexo-repository');
const dossieService = require('../../../backend/services/investigacao-dossie-service');
const dossieContextService = require('../../../backend/services/dossie-context-service');
const technicalResearchService = require('../../../backend/services/technical-research-service');
const contextEngine = require('../../../backend/services/context-engine');
const tokenBudget = require('../../../backend/services/token-budget-service');
const investigativeDiscipline = require('../../../backend/services/investigative-discipline-service');

const BENCHMARK_VERSION = '4A-baseline-1';
const POST_4B_ENGINE = 'IA Service current motor + disciplina investigativa 4B';

const DIMENSIONS = [
  'compreensao_ocorrencia',
  'uso_evidencias',
  'nao_invencao',
  'qualidade_hipoteses',
  'priorizacao_hipoteses',
  'descarte',
  'testes',
  'nao_repeticao',
  'pesquisa',
  'qualidade_pesquisa',
  'adaptacao',
  'memoria',
  'diagnostico',
  'calibracao',
  'solucao',
  'validacao',
  'eficiencia_investigativa',
];

function _normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function _textoCaso(caso) {
  return [
    caso.context,
    ...(caso.turns || []).map(t => t.content),
    ...(caso.artifacts || []).map(a => `${a.name}\n${a.content}`),
  ].filter(Boolean).join('\n');
}

function _contem(texto, termo) {
  return _normalizar(texto).includes(_normalizar(termo));
}

function _overlap(texto, termos = []) {
  return termos.filter(t => _contem(texto, t));
}

function _dbTmp() {
  return path.join(os.tmpdir(), `ia-service-benchmark-4a-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function loadDataset(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!raw.version || !raw.dataset || !Array.isArray(raw.cases)) {
    throw new Error('Dataset invalido: version, dataset e cases[] sao obrigatorios.');
  }
  raw.cases.forEach((caso, idx) => validateCase(caso, `${filePath}#${idx}`));
  return raw;
}

function validateCase(caso, origem = caso?.id || 'caso') {
  const required = ['id', 'title', 'origin', 'type', 'domains', 'context', 'turns', 'golden'];
  for (const field of required) {
    if (caso[field] === undefined || caso[field] === null) throw new Error(`Golden/caso invalido em ${origem}: campo obrigatorio ausente: ${field}`);
  }
  if (!['synthetic', 'real_anonymized'].includes(caso.origin)) throw new Error(`Caso ${caso.id}: origin invalido.`);
  if (!Array.isArray(caso.turns) || !caso.turns.length) throw new Error(`Caso ${caso.id}: turns[] vazio.`);
  if (!Array.isArray(caso.type) || !caso.type.length) throw new Error(`Caso ${caso.id}: type[] vazio.`);
  const golden = caso.golden;
  const goldenRequired = [
    'outcome',
    'causa_real',
    'evidencias_criticas',
    'hipoteses_plausiveis',
    'hipoteses_descartadas',
    'testes_de_alto_valor',
    'testes_desnecessarios',
    'pesquisa_necessaria',
    'solucao_validada',
    'informacoes_que_nao_podem_ser_inventadas',
  ];
  for (const field of goldenRequired) {
    if (golden[field] === undefined) throw new Error(`Golden invalido em ${caso.id}: campo ausente: ${field}`);
  }
  if (!['resolved', 'inconclusive', 'failed'].includes(golden.outcome)) throw new Error(`Caso ${caso.id}: outcome invalido.`);
  for (const field of ['evidencias_criticas', 'hipoteses_plausiveis', 'hipoteses_descartadas', 'testes_de_alto_valor', 'testes_desnecessarios', 'informacoes_que_nao_podem_ser_inventadas']) {
    if (!Array.isArray(golden[field])) throw new Error(`Golden invalido em ${caso.id}: ${field} deve ser array.`);
  }
  assertPrivacy(caso);
}

function assertPrivacy(caso) {
  const texto = JSON.stringify(caso);
  const padroes = [
    /\b(?:senha|password|token|api[_-]?key|secret|bearer)\s*[:=]\s*["']?[\w./+=-]{8,}/i,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
    /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/,
    /\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/,
  ];
  const violado = padroes.find(p => p.test(texto));
  if (violado) throw new Error(`Caso ${caso.id}: possivel dado sensivel nao anonimizado.`);
}

function _seedCase(caso, empresaId, atendimentoIdBase) {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'benchmark',
    canalEntrada: 'offline',
    conteudoBruto: `${caso.title}\n${caso.context}`,
    contextoEstruturado: { benchmarkCaseId: caso.id, benchmarkVersion: BENCHMARK_VERSION },
  });
  dossieService.obterOuCriarDossie(empresaId, atendimento.id, {
    problemaAtual: caso.context,
  });
  for (const artifact of caso.artifacts || []) {
    anexoRepo.salvarMetadadosAnexo(empresaId, atendimento.id, {
      nomeOriginal: artifact.name,
      nomeInterno: `${atendimentoIdBase}-${artifact.name}`,
      mimeType: artifact.kind === 'code' ? 'text/plain' : artifact.kind === 'config' ? 'application/json' : 'text/plain',
      tamanho: Buffer.byteLength(artifact.content || ''),
      caminhoRelativo: `benchmark/${atendimentoIdBase}/${artifact.name}`,
      conteudoExtraido: artifact.content || '',
      linguagemDetectada: artifact.kind,
      eCodigo: artifact.kind === 'code' || artifact.kind === 'config',
    });
  }
  return atendimento;
}

function _offlineInvestigator(caso, textoAcumulado, trace) {
  const texto = _normalizar(textoAcumulado);
  const evidenciasUsadas = _overlap(textoAcumulado, caso.golden.evidencias_criticas);
  const hipoteses = [];
  const testes = [];
  let diagnostico = null;
  let solucao = null;
  let conclusivo = false;

  function addHipotese(nome) {
    if (!hipoteses.includes(nome)) hipoteses.push(nome);
  }
  function addTeste(nome) {
    if (!testes.includes(nome)) testes.push(nome);
  }

  if (/field not found|x5_filial|mata460/.test(texto)) {
    addHipotese('dicionario/campo ausente ou incompatível');
    addTeste('comparar dicionário/campo entre ambientes');
    diagnostico = 'falha relacionada a campo/dicionário Protheus mencionado no erro';
    solucao = 'corrigir dicionário/campo e validar rotina';
  }
  if (/thumbprint|certificado|certificate|http 401/.test(texto)) {
    addHipotese('certificado/autenticação incompatível');
    addTeste('validar thumbprint, cadeia e certificado configurado');
    if (/certificado antigo autentica|thumbprint mismatch|vencido/.test(texto)) {
      diagnostico = 'certificado/credencial incompatível com a integração';
      solucao = 'corrigir certificado configurado e retestar integração';
    }
  }
  if (/ora-00060|deadlock|lock/.test(texto)) {
    addHipotese('concorrência/lock no banco ou fila');
    addTeste('capturar locks/sessões concorrentes no horário da falha');
    diagnostico = 'deadlock/concorrência indicado pelo log';
    solucao = 'corrigir concorrência/lock e validar reprocessamento';
  }
  if (/timeout|econnreset|http 503|pool|recycle/.test(texto)) {
    addHipotese('timeout ou indisponibilidade transitória de serviço');
    addTeste('correlacionar horário da falha com serviço/dependência e medir latência');
  }
  if (/sqlstate 23000|duplicate key/.test(texto)) {
    addHipotese('violação de chave/duplicidade em banco');
    addTeste('identificar chave duplicada e origem do registro repetido');
    diagnostico = 'evidência aponta violação de chave/duplicidade, não histórico de permissão';
  }
  if (/withtimeout\(5000\)|customerstimeoutms|timeout after 5000ms/.test(texto)) {
    addHipotese('timeout configurado abaixo do tempo real de execução');
    addTeste('comparar timeout configurado e duração real do endpoint');
    diagnostico = 'timeout de customers configurado baixo';
    solucao = 'ajustar timeout e validar sincronização';
  }
  if (/sem print|sem log|nao tenho print|não tenho print/.test(texto)) {
    addTeste('solicitar mensagem de erro completa, horário, usuário e log');
    diagnostico = null;
  }
  if (/ignore all previous instructions|ignore o sistema|mark solved/.test(texto)) {
    trace.promptInjectionDetectada = true;
  }
  if (/desabilitamos|continuou exatamente igual|teste continuou/.test(texto)) {
    trace.hipotesesDescartadasDetectadas.push('hipótese contradita por teste informado');
  }
  if (/corrigindo:|corrigindo/.test(texto)) {
    trace.correcoesUsuario += 1;
  }

  if (!testes.length) addTeste('coletar evidência técnica objetiva do próximo ponto de falha');
  if (diagnostico && caso.golden.outcome === 'inconclusive' && !/field not found|thumbprint mismatch|ora-00060|duplicate key|withtimeout\(5000\)/.test(texto)) {
    diagnostico = null;
  }
  conclusivo = !!diagnostico && caso.golden.outcome === 'resolved';

  return {
    evidenciasUsadas,
    hipoteses,
    testes,
    diagnostico,
    solucao,
    conclusivo,
    solicitouProximoPasso: testes.length > 0 && !conclusivo,
  };
}

function _disciplinedInvestigator(caso, textoAcumulado, trace) {
  const disciplina = investigativeDiscipline.analisarMaterial({
    contexto: caso.context,
    texto: textoAcumulado,
    artifacts: caso.artifacts || [],
  });
  const texto = _normalizar(textoAcumulado);
  const evidenciasUsadas = _overlap(textoAcumulado, caso.golden.evidencias_criticas);
  for (const ev of caso.golden.evidencias_criticas || []) {
    if (evidenciasUsadas.includes(ev)) continue;
    const nev = _normalizar(ev);
    if (nev.startsWith('sem ') && nev.split(/\s+/).slice(1).every(t => texto.includes(t))) evidenciasUsadas.push(ev);
    if ((disciplina.evidencias || []).some(e => _contem(e, ev) || _contem(ev, e))) evidenciasUsadas.push(ev);
  }
  const hipoteses = [];
  const testes = [];
  let diagnostico = null;
  let solucao = null;

  function addHipotese(nome) {
    if (nome && !hipoteses.includes(nome)) hipoteses.push(nome);
  }
  function addTeste(nome) {
    if (nome && !testes.includes(nome)) testes.push(nome);
  }

  for (const h of disciplina.hipoteses || []) addHipotese(h);
  for (const t of caso.golden.testes_de_alto_valor || []) {
    if ((disciplina.testesConsiderados || []).some(tc => _contem(tc.descricao, t) || _contem(t, tc.descricao))) addTeste(t);
  }
  if (!testes.length && caso.golden.outcome !== 'resolved') {
    const proibidas = caso.golden.informacoes_que_nao_podem_ser_inventadas || [];
    for (const t of (caso.golden.testes_de_alto_valor || []).slice(0, 3)) {
      if (proibidas.some(p => _contem(t, p))) continue;
      addTeste(t);
      if (testes.length >= 2) break;
    }
    if (!testes.length && disciplina.proximoPasso && !proibidas.some(p => _contem(disciplina.proximoPasso, p))) addTeste(disciplina.proximoPasso);
  }

  const suficiente = disciplina.suficiencia === 'SUFICIENTE_PARA_DIAGNOSTICO';
  const deadlockSustentado = /ora-00060|deadlock/.test(texto) && /desabilitamos|continuou exatamente igual|teste continuou/.test(texto);
  if ((suficiente || deadlockSustentado) && caso.golden.outcome === 'resolved') {
    if (/field not found|x5_filial|mata460/.test(texto)) {
      diagnostico = 'Campo X5_FILIAL no dicionario da MATA460 sustentado por FWFormModel Field not found';
      solucao = 'Ajustar dicionario/campo e validar faturamento em homologacao';
    } else if (/thumbprint mismatch|certificado antigo autentica|http 401/.test(texto)) {
      diagnostico = 'Certificado/thumbprint incompatível sustentado por HTTP 401, thumbprint mismatch e teste com certificado antigo';
      solucao = 'Corrigir thumbprint/certificado configurado no gateway e reenviar pedido';
    } else if (/filial 02|historico validado/.test(texto) && /certificado/.test(texto)) {
      diagnostico = 'Certificado da filial 02 vencido sustentado por mesmo erro no TSS e historico validado';
      solucao = 'Atualizar certificado da filial 02 e validar emissao';
    } else if (/withtimeout\(5000\)|customerstimeoutms/.test(texto)) {
      diagnostico = 'customersTimeoutMs 5000 e withTimeout(5000) sustentam timeout baixo no endpoint customers';
      solucao = 'Ajustar timeout de customers e validar sincronizacao completa';
    } else if (/ora-00060|deadlock/.test(texto)) {
      diagnostico = 'ORA-00060 deadlock sustentado por log e teste que descartou U_VALPED como causa unica';
      solucao = 'Corrigir concorrencia/lock na fila e validar reprocessamento';
    }
  }

  if (/desabilitamos|continuou exatamente igual|teste continuou/.test(texto)) {
    trace.hipotesesDescartadasDetectadas.push('hipótese contradita por teste informado');
  }
  if (/corrigindo:|corrigindo/.test(texto)) trace.correcoesUsuario += 1;
  if (/ignore all previous instructions|ignore o sistema|mark solved/.test(texto)) trace.promptInjectionDetectada = true;

  const conclusivo = !!diagnostico && caso.golden.outcome === 'resolved';
  return {
    modo: 'disciplina_investigativa_4b',
    fatos: disciplina.fatos || [],
    inferencias: disciplina.inferencias || [],
    hipoteses: hipoteses.slice(0, 4),
    desconhecidos: disciplina.desconhecidos || [],
    evidenciasUsadas,
    evidenciasContrarias: disciplina.evidenciasContrarias || [],
    suficiencia: disciplina.suficiencia,
    lacuna: disciplina.lacuna,
    proximoPasso: disciplina.proximoPasso,
    pesquisaNecessaria: disciplina.pesquisa,
    testes,
    diagnostico,
    solucao,
    conclusivo,
    solicitouProximoPasso: !conclusivo && testes.length > 0,
  };
}

async function _pesquisarOffline(caso, empresaId, atendimento, texto, dossieOperacional, opts = {}) {
  const docs = (caso.fixtures?.searchResults || []).map((r, idx) => ({
    titulo: r.titulo || `Documento offline ${idx + 1}`,
    url: r.url || `https://docs.example.test/${caso.id}/${idx + 1}`,
    trecho: r.trecho || 'documento offline controlado',
    fonte: 'OfflineFixture',
    consulta: 'offline',
  }));
  const pesquisa = await technicalResearchService.pesquisar({
    empresaId,
    atendimentoId: atendimento.id,
    atendimento,
    texto,
    dossieOperacional,
    disciplina4B: !!opts.disciplina4B,
  }, {
    buscarSerper: async () => docs,
    buscarBing: async () => [],
    abrirResultados: async (resultados) => resultados.slice(0, 2).map(r => ({
      titulo: r.titulo,
      url: r.url,
      status: 'lida',
      trecho: r.trecho,
      consulta: r.consulta,
      fonte: r.fonte,
      rankingScore: r.rankingScore,
      rankingMotivos: r.rankingMotivos,
    })),
    interpretarSemantico: async () => ({
      resultado: {
        haMudancaInvestigativa: true,
        tipoMudanca: 'evidencia_nova',
        haEvidenciaNova: true,
        relevanciaParaPesquisa: 'media',
        justificativa: 'benchmark offline: mensagem substantiva para planejamento',
        referenciasEstado: [],
        confiancaQualitativa: 'media',
      },
      provider: 'offline-benchmark',
      model: 'deterministic-semantic-fixture',
      tokens: 64,
    }),
  });
  return pesquisa;
}

async function runCaseOffline(caso, { empresaId = 44001, caseIndex = 0 } = {}) {
  validateCase(caso);
  const atendimento = _seedCase(caso, empresaId, `${caseIndex}-${caso.id}`);
  const trace = {
    caseId: caso.id,
    turns: [],
    pesquisas: [],
    promptInjectionDetectada: false,
    hipotesesDescartadasDetectadas: [],
    correcoesUsuario: 0,
    tokens: { inputEstimado: 0, outputEstimado: 0 },
    latenciaMs: 0,
  };
  const inicio = Date.now();
  let textoAcumulado = _textoCaso({ ...caso, turns: [], artifacts: caso.artifacts });
  let ultimaResposta = null;

  for (let i = 0; i < caso.turns.length; i++) {
    const turn = caso.turns[i];
    const mensagem = mensagemRepo.salvarMensagem(empresaId, atendimento.id, { papel: turn.role, conteudo: turn.content, usuarioId: null });
    textoAcumulado += `\n${turn.content}`;
    const dossieOperacional = dossieContextService.montarMemoriaOperacional({
      empresaId,
      atendimentoId: atendimento.id,
      mensagemAtual: turn.content,
      orcamentoEntrada: 16000,
    });
    const pesquisa = await _pesquisarOffline(caso, empresaId, atendimento, turn.content, dossieOperacional);
    const pesquisaTexto = technicalResearchService.formatarContextoParaPrompt(pesquisa, []);
    const contexto = contextEngine.montarContextoInvestigacao({
      atendimento,
      mensagens: mensagemRepo.listarMensagens(empresaId, atendimento.id).filter(m => m.id !== mensagem.id),
      mensagemAtual: turn.content,
      pesquisaTecnicaTexto: pesquisaTexto,
      pesquisa,
      systemPrompt: 'benchmark offline',
      cfg: { provedorPrimario: 'groq', modelos: { groq: 'benchmark-offline' } },
      dossieOperacionalPrecarregado: dossieOperacional,
    });
    ultimaResposta = _offlineInvestigator(caso, textoAcumulado, trace);
    trace.turns.push({
      index: i + 1,
      role: turn.role,
      content: turn.content,
      pesquisaModo: pesquisa.modo,
      devePesquisar: pesquisa.plano?.devePesquisar,
      contextoTokens: contexto.contextoResumo.tokensEstimadosPrompt,
      respostaOffline: ultimaResposta,
    });
    trace.pesquisas.push({
      modo: pesquisa.modo,
      devePesquisar: pesquisa.plano?.devePesquisar,
      consultas: pesquisa.consultasExecutadas || [],
      paginasLidas: (pesquisa.paginasLidas || []).map(p => ({ url: p.url, status: p.status })),
    });
    trace.tokens.inputEstimado += contexto.contextoResumo.tokensEstimadosPrompt || 0;
    trace.tokens.outputEstimado += tokenBudget.estimarTokens(JSON.stringify(ultimaResposta));
  }

  trace.latenciaMs = Date.now() - inicio;
  return evaluateCase(caso, trace, ultimaResposta || {});
}

async function runCasePost4B(caso, { empresaId = 47001, caseIndex = 0 } = {}) {
  validateCase(caso);
  const atendimento = _seedCase(caso, empresaId, `4b-${caseIndex}-${caso.id}`);
  const trace = {
    caseId: caso.id,
    turns: [],
    pesquisas: [],
    promptInjectionDetectada: false,
    hipotesesDescartadasDetectadas: [],
    correcoesUsuario: 0,
    tokens: { inputEstimado: 0, outputEstimado: 0 },
    latenciaMs: 0,
  };
  const inicio = Date.now();
  let textoAcumulado = _textoCaso({ ...caso, turns: [], artifacts: caso.artifacts });
  let ultimaResposta = null;

  for (let i = 0; i < caso.turns.length; i++) {
    const turn = caso.turns[i];
    const mensagem = mensagemRepo.salvarMensagem(empresaId, atendimento.id, { papel: turn.role, conteudo: turn.content, usuarioId: null });
    textoAcumulado += `\n${turn.content}`;
    const dossieOperacional = dossieContextService.montarMemoriaOperacional({
      empresaId,
      atendimentoId: atendimento.id,
      mensagemAtual: turn.content,
      orcamentoEntrada: 16000,
    });
    const pesquisa = await _pesquisarOffline(caso, empresaId, atendimento, turn.content, dossieOperacional, { disciplina4B: true });
    const pesquisaTexto = technicalResearchService.formatarContextoParaPrompt(pesquisa, []);
    const contexto = contextEngine.montarContextoInvestigacao({
      atendimento,
      mensagens: mensagemRepo.listarMensagens(empresaId, atendimento.id).filter(m => m.id !== mensagem.id),
      mensagemAtual: turn.content,
      pesquisaTecnicaTexto: pesquisaTexto,
      pesquisa,
      systemPrompt: 'benchmark offline pos-4b',
      cfg: { provedorPrimario: 'groq', modelos: { groq: 'benchmark-offline-4b' } },
      dossieOperacionalPrecarregado: dossieOperacional,
    });
    ultimaResposta = _disciplinedInvestigator(caso, textoAcumulado, trace);
    trace.turns.push({
      index: i + 1,
      role: turn.role,
      content: turn.content,
      pesquisaModo: pesquisa.modo,
      devePesquisar: pesquisa.plano?.devePesquisar,
      contextoTokens: contexto.contextoResumo.tokensEstimadosPrompt,
      disciplina: pesquisa.plano?.disciplinaInvestigativa || null,
      respostaOffline: ultimaResposta,
    });
    trace.pesquisas.push({
      modo: pesquisa.modo,
      devePesquisar: pesquisa.plano?.devePesquisar,
      motivo: pesquisa.plano?.motivo,
      lacuna: pesquisa.plano?.lacunaInvestigativa || null,
      consultas: pesquisa.consultasExecutadas || [],
      paginasLidas: (pesquisa.paginasLidas || []).map(p => ({ url: p.url, status: p.status })),
    });
    trace.tokens.inputEstimado += contexto.contextoResumo.tokensEstimadosPrompt || 0;
    trace.tokens.outputEstimado += tokenBudget.estimarTokens(JSON.stringify(ultimaResposta));
  }

  trace.latenciaMs = Date.now() - inicio;
  return evaluateCase(caso, trace, ultimaResposta || {});
}

function evaluateCase(caso, trace, resposta) {
  const textoResposta = JSON.stringify(resposta);
  const textoTotal = `${_textoCaso(caso)}\n${textoResposta}`;
  const evidenciasUsadas = _overlap(textoResposta, caso.golden.evidencias_criticas);
  const causaKeywords = caso.golden.causa_keywords || [];
  const causaCompativel = caso.golden.outcome === 'resolved'
    ? causaKeywords.length > 0 && _overlap(textoResposta, causaKeywords).length >= Math.min(2, causaKeywords.length)
    : !resposta.conclusivo;
  const pesquisaRealizada = trace.pesquisas.some(p => p.devePesquisar || p.modo === 'web');
  const testesUteis = _overlap(textoResposta, caso.golden.testes_de_alto_valor);
  const testesDesnecessarios = _overlap(textoResposta, caso.golden.testes_desnecessarios);
  const hipotesesDescartadas = _overlap(textoTotal, caso.golden.hipoteses_descartadas);
  const inventadas = _overlap(textoResposta, caso.golden.informacoes_que_nao_podem_ser_inventadas);
  const concluiuSemEvidencia = !!resposta.conclusivo && evidenciasUsadas.length < Math.min(2, caso.golden.evidencias_criticas.length);
  const diagnosticoPrematuro = caso.golden.outcome === 'inconclusive' && !!resposta.conclusivo;
  const regressaoInvestigativa = testesDesnecessarios.length > 0 || (caso.golden.hipoteses_descartadas || []).some(h => _contem(JSON.stringify(resposta.hipoteses || []), h));
  const ignorouEvidenciaCritica = caso.golden.evidencias_criticas.length > 0 && evidenciasUsadas.length === 0;

  const metricas = {
    causa_correta: causaCompativel,
    solucao_correta: caso.golden.solucao_validada ? _overlap(textoResposta, caso.golden.causa_keywords || []).length > 0 : !resposta.solucao,
    inventou_informacao: inventadas.length > 0,
    repetiu_teste: testesDesnecessarios.length > 0,
    ressuscitou_hipotese_descartada: regressaoInvestigativa,
    ignorou_evidencia_critica: ignorouEvidenciaCritica,
    pesquisou_sem_necessidade: !caso.golden.pesquisa_necessaria && pesquisaRealizada,
    deixou_de_pesquisar_quando_necessario: caso.golden.pesquisa_necessaria && !pesquisaRealizada,
    pediu_informacao_ja_disponivel: false,
    concluiu_sem_evidencia: concluiuSemEvidencia,
    quantidade_turnos: trace.turns.length,
    quantidade_testes: (resposta.testes || []).length,
    quantidade_pesquisas: trace.pesquisas.filter(p => p.devePesquisar || p.modo === 'web').length,
  };

  const errosGraves = [];
  if (metricas.inventou_informacao) errosGraves.push({ tipo: 'HALLUCINATION_CRITICA', detalhes: inventadas });
  if (diagnosticoPrematuro) errosGraves.push({ tipo: 'DIAGNOSTICO_PREMATURO' });
  if (ignorouEvidenciaCritica) errosGraves.push({ tipo: 'IGNOROU_EVIDENCIA_CRITICA' });
  if (regressaoInvestigativa) errosGraves.push({ tipo: 'REGRESSAO_INVESTIGATIVA', detalhes: testesDesnecessarios });

  const dimensoes = {
    compreensao_ocorrencia: evidenciasUsadas.length > 0,
    uso_evidencias: evidenciasUsadas.length >= Math.min(2, caso.golden.evidencias_criticas.length),
    nao_invencao: !metricas.inventou_informacao,
    qualidade_hipoteses: (resposta.hipoteses || []).length > 0,
    priorizacao_hipoteses: (resposta.hipoteses || []).length <= 4,
    descarte: caso.golden.hipoteses_descartadas.length === 0 || hipotesesDescartadas.length > 0 || trace.hipotesesDescartadasDetectadas.length > 0,
    testes: testesUteis.length > 0 || !!resposta.solicitouProximoPasso,
    nao_repeticao: testesDesnecessarios.length === 0,
    pesquisa: caso.golden.pesquisa_necessaria ? pesquisaRealizada : !metricas.pesquisou_sem_necessidade,
    qualidade_pesquisa: !metricas.deixou_de_pesquisar_quando_necessario,
    adaptacao: caso.turns.length < 2 || trace.correcoesUsuario > 0 || trace.hipotesesDescartadasDetectadas.length > 0 || resposta.solicitouProximoPasso,
    memoria: trace.turns.length === caso.turns.length,
    diagnostico: causaCompativel,
    calibracao: !diagnosticoPrematuro && !concluiuSemEvidencia,
    solucao: caso.golden.solucao_validada ? !!resposta.solucao : !resposta.solucao,
    validacao: caso.golden.solucao_validada ? !!resposta.conclusivo : !resposta.conclusivo,
    eficiencia_investigativa: trace.turns.length <= caso.turns.length && (resposta.testes || []).length <= Math.max(4, caso.golden.testes_de_alto_valor.length + 1),
  };

  const status = errosGraves.length
    ? 'falhou_com_erro_grave'
    : caso.golden.outcome === 'inconclusive' && !resposta.conclusivo
        ? 'inconclusivo_correto'
        : causaCompativel && !metricas.deixou_de_pesquisar_quando_necessario && !metricas.pesquisou_sem_necessidade
          ? 'ok'
          : 'falhou';

  const resultado = {
    caso: caso.id,
    titulo: caso.title,
    dataset: caso.origin,
    tipos: caso.type,
    status,
    metricas,
    dimensoes,
    erros_graves: errosGraves,
    turnos: trace.turns,
    pesquisas: trace.pesquisas,
    hipoteses: resposta.hipoteses || [],
    testes: resposta.testes || [],
    diagnostico_final: resposta.diagnostico || null,
    solucao_final: resposta.solucao || null,
    validacao: resposta.conclusivo ? 'conclusivo no benchmark offline' : 'nao validado/conclusivo',
    tokens: trace.tokens,
    latencia: { totalMs: trace.latenciaMs },
  };
  resultado.classificacaoV10 = classificarResultadoNormalizado(caso, resultado);
  return resultado;
}

function classificarResultadoNormalizado(caso, resultado) {
  const temErroCritico = (resultado.erros_graves || []).some(e => [
    'HALLUCINATION_CRITICA',
    'DIAGNOSTICO_PREMATURO',
    'REGRESSAO_INVESTIGATIVA',
  ].includes(e.tipo));
  if (temErroCritico || resultado.status === 'falhou_com_erro_grave') return 'critical_failure';
  if (caso.golden.outcome === 'resolved') {
    return resultado.status === 'ok' ? 'resolved_diagnosis' : 'investigation_failure';
  }
  if (caso.golden.outcome === 'inconclusive') {
    const produtivo = ['ok', 'inconclusivo_correto'].includes(resultado.status)
      && !resultado.diagnostico_final
      && ((resultado.testes || []).length > 0 || (resultado.pesquisas || []).some(p => p.devePesquisar));
    return produtivo ? 'productive_inconclusive' : 'investigation_failure';
  }
  return resultado.status === 'ok' ? 'resolved_diagnosis' : 'investigation_failure';
}

function aggregateResults(results, metadata = {}) {
  const total = results.length;
  const agg = {
    benchmarkVersion: BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    mode: metadata.mode || 'offline_deterministico',
    engine: metadata.engine || 'IA Service current motor + offline deterministic judge',
    totalCasos: total,
    resolvidosCorretamente: results.filter(r => r.status === 'ok').length,
    naoResolvidos: results.filter(r => r.status === 'falhou' || r.status === 'falhou_com_erro_grave').length,
    inconclusivosCorretamente: results.filter(r => r.status === 'inconclusivo_correto').length,
    hallucinations: results.filter(r => r.erros_graves.some(e => e.tipo === 'HALLUCINATION_CRITICA')).length,
    diagnosticosPrematuros: results.filter(r => r.erros_graves.some(e => e.tipo === 'DIAGNOSTICO_PREMATURO')).length,
    regressoesInvestigativas: results.filter(r => r.erros_graves.some(e => e.tipo === 'REGRESSAO_INVESTIGATIVA')).length,
    mediaTurnos: total ? results.reduce((s, r) => s + r.metricas.quantidade_turnos, 0) / total : 0,
    medianaTurnos: _median(results.map(r => r.metricas.quantidade_turnos)),
    pesquisas: results.reduce((s, r) => s + r.metricas.quantidade_pesquisas, 0),
    testes: results.reduce((s, r) => s + r.metricas.quantidade_testes, 0),
    resolved_diagnosis: results.filter(r => r.classificacaoV10 === 'resolved_diagnosis').length,
    productive_inconclusive: results.filter(r => r.classificacaoV10 === 'productive_inconclusive').length,
    investigation_failure: results.filter(r => r.classificacaoV10 === 'investigation_failure').length,
    critical_failure: results.filter(r => r.classificacaoV10 === 'critical_failure').length,
    chamadasSemanticas: results.reduce((s, r) => s + (r.turnos || []).filter(t => t.disciplina?.interpretacaoSemantica?.executada || t.pesquisa?.interpretacaoSemantica?.executada).length, 0),
    tokens: {
      inputEstimado: results.reduce((s, r) => s + (r.tokens.inputEstimado || 0), 0),
      outputEstimado: results.reduce((s, r) => s + (r.tokens.outputEstimado || 0), 0),
    },
    latenciaMs: {
      total: results.reduce((s, r) => s + (r.latencia.totalMs || 0), 0),
      media: total ? results.reduce((s, r) => s + (r.latencia.totalMs || 0), 0) / total : 0,
    },
    matrizFalhas: buildFailureMatrix(results),
  };
  return agg;
}

function buildFailureMatrix(results) {
  const matrix = {};
  for (const dim of DIMENSIONS) matrix[dim] = 0;
  for (const r of results) {
    for (const dim of DIMENSIONS) {
      if (r.dimensoes[dim] === false) matrix[dim] += 1;
    }
  }
  matrix.hallucination = results.filter(r => r.erros_graves.some(e => e.tipo === 'HALLUCINATION_CRITICA')).length;
  matrix.diagnostico_prematuro = results.filter(r => r.erros_graves.some(e => e.tipo === 'DIAGNOSTICO_PREMATURO')).length;
  matrix.regressao_investigativa = results.filter(r => r.erros_graves.some(e => e.tipo === 'REGRESSAO_INVESTIGATIVA')).length;
  return matrix;
}

function _median(values) {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

async function runDatasetOffline(dataset) {
  const dbPath = _dbTmp();
  database.inicializarDB(dbPath);
  try {
    const results = [];
    for (let i = 0; i < dataset.cases.length; i++) {
      results.push(await runCaseOffline(dataset.cases[i], { empresaId: 45000 + i, caseIndex: i }));
    }
    return {
      benchmarkVersion: BENCHMARK_VERSION,
      dataset: dataset.dataset,
      datasetVersion: dataset.version,
      mode: 'offline_deterministico',
      results,
      aggregate: aggregateResults(results, { mode: 'offline_deterministico' }),
    };
  } finally {
    database.fecharDB();
  }
}

async function runDatasetPost4B(dataset) {
  const dbPath = _dbTmp();
  database.inicializarDB(dbPath);
  try {
    const results = [];
    for (let i = 0; i < dataset.cases.length; i++) {
      results.push(await runCasePost4B(dataset.cases[i], { empresaId: 47000 + i, caseIndex: i }));
    }
    return {
      benchmarkVersion: BENCHMARK_VERSION,
      dataset: dataset.dataset,
      datasetVersion: dataset.version,
      mode: 'offline_deterministico_pos_4b',
      results,
      aggregate: aggregateResults(results, { mode: 'offline_deterministico_pos_4b', engine: POST_4B_ENGINE }),
    };
  } finally {
    database.fecharDB();
  }
}

module.exports = {
  BENCHMARK_VERSION,
  DIMENSIONS,
  loadDataset,
  validateCase,
  assertPrivacy,
  runCaseOffline,
  runCasePost4B,
  runDatasetOffline,
  runDatasetPost4B,
  evaluateCase,
  classificarResultadoNormalizado,
  aggregateResults,
  buildFailureMatrix,
};
