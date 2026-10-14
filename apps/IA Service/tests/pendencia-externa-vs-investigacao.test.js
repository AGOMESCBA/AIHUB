// Pendencia externa x investigacao (2026-10, #036571):
//  1. a pendencia externa continua sendo FATO operacional, mas nao e a unica
//     acao possivel — verificacoes internas entram so quando ha evidencia;
//  2. codigos curtos de registro (C197, E115...) sao extraidos das evidencias;
//  3. respostas anteriores da IA nao viram fato, acao ou fonte de termos.
// Nao chama IA real.
// Executar: node "apps/IA Service/tests/pendencia-externa-vs-investigacao.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-pendencia-externa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const contextEngine = require('../backend/services/context-engine');
const prr = require('../backend/services/plano-resposta-rastreavel-service');
const promptBuilder = require('../backend/services/prompt-builder');

const OPENAI = { provider: 'openai', model: 'gpt-4o-mini' };
const PEDIDO = 'Revise todo o historico, anexos e fontes disponiveis e pesquise uma solucao para este chamado.';
const PERGUNTA_STATUS = 'Qual o status atual?';

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function criar(empresaId, { conteudoBruto, mensagens = [], anexos = [] }) {
  const at = atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto });
  for (const m of mensagens) mensagemRepo.salvarMensagem(empresaId, at.id, m);
  for (const a of anexos) {
    const meta = anexoRepo.salvarMetadadosAnexo(empresaId, at.id, {
      nomeOriginal: a.nome,
      nomeInterno: `${a.nome}-${Math.random().toString(36).slice(2)}`,
      mimeType: a.mime || 'application/pdf',
      tamanho: Buffer.byteLength(a.conteudo),
      caminhoRelativo: `${empresaId}/${at.id}/${a.nome}`,
    });
    anexoRepo.atualizarExtracao(empresaId, meta.id, { conteudoExtraido: a.conteudo, linguagemDetectada: a.linguagem ?? 'pdf', encodingDetectado: 'utf-8', eCodigo: false });
  }
  return at;
}

function montar(empresaId, at, { mensagemAtual = PEDIDO, aguardando = 'RETORNO - FORNECEDOR', turno = true } = {}) {
  const todos = anexoRepo.listarAnexos(empresaId, at.id);
  return contextEngine.montarContextoInvestigacao({
    atendimento: at,
    mensagens: mensagemRepo.listarMensagens(empresaId, at.id, { limite: 100 }),
    mensagemAtual,
    anexosDoTurno: turno ? todos : [],
    anexosComoContexto: turno,
    pesquisaTecnicaTexto: '',
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg: { provedorPrimario: 'openai', modelos: { openai: 'gpt-4o-mini' } },
    candidatoOrcamento: OPENAI,
    chamado: aguardando ? { aguardandoConsolidado: aguardando } : null,
  });
}

const NOTA = 'Nota tecnica: os ajustes devem ser informados nos registros M220 e M620; o registro C197 recebe o ajuste da escrituracao fiscal e o registro E115 detalha a apuracao.';
const HIST_TECNICO = [
  { papel: 'customer', conteudo: 'Solicitamos a adequacao do sistema para gerar os registros M220 e M620 conforme a nota tecnica.' },
  { papel: 'user', conteudo: 'Abrimos chamado na TOTVS e aguardamos retorno. Configuramos o registro C197 nas TES 503/603 e explicamos o registro E115.' },
];

// Situacao A: pendencia externa + verificacoes internas sustentadas por evidencia.
function testarSituacaoA() {
  const at = criar(9901, { conteudoBruto: 'Adequacao fiscal M220 M620 C197 E115', mensagens: HIST_TECNICO, anexos: [{ nome: 'nota-tecnica.pdf', conteudo: NOTA }] });
  const ctx = montar(9901, at);
  const q = ctx.manifesto.quadroInvestigativo;
  assert.strictEqual(q.estadoOperacional, 'aguardando_retorno_externo', 'a pendencia externa continua como fato operacional');
  assert.ok(q.pendencias.some(p => p.responsavel === 'fornecedor' && p.bloqueante));
  assert.strictEqual(q.modoInvestigacao, 'verificacao_interna_com_pendencia_externa_paralela');
  assert.strictEqual(q.pendenciaExterna.acoesInternasJustificadas, true);
  assert.ok(/^Verificar internamente/.test(q.acoesParaReduzirIncerteza[0]), q.acoesParaReduzirIncerteza[0]);
  assert.ok(q.acoesParaReduzirIncerteza[0].includes('nota-tecnica.pdf'));
  for (const ref of ['C197', 'E115', 'M220', 'M620']) assert.ok(q.pendenciaExterna.referenciasInternas.includes(ref), `referencia ${ref} extraida da evidencia`);
  assert.ok(/Manter em paralelo o acompanhamento/.test(q.acoesParaReduzirIncerteza[1]));
  assert.ok(!/unica acao/.test(q.acoesParaReduzirIncerteza[0]));
  // O proximo passo do PRR deixa de ser "cobrar o fornecedor".
  const prox = ctx.manifesto.planoRespostaRastreavel.proximoPassoRecomendado.descricao;
  assert.ok(/^Verificar internamente/.test(prox), prox);
  assert.ok(ctx.userPrompt.includes('NAO impede verificacoes internas'));
  // Termos rastreaveis com origem.
  const termo = ctx.manifesto.planoRespostaRastreavel.termosTecnicosPermitidos.find(t => t.termo === 'C197');
  assert.ok(termo, 'C197 deve estar nos termos permitidos');
  assert.ok(termo.origens.some(o => o.referencia === 'nota-tecnica.pdf' || o.origem === 'historico' || o.origem === 'nota-tecnica.pdf'));
}

// Situacao B: sem evidencia interna — o retorno externo e realmente necessario.
function testarSituacaoB() {
  const at = criar(9902, {
    conteudoBruto: 'Aguardando retorno do fornecedor',
    mensagens: [
      { papel: 'customer', conteudo: 'Chamado aberto, ficamos no aguardo do retorno.' },
      { papel: 'user', conteudo: 'Encaminhado ao fornecedor, aguardando.' },
    ],
  });
  const ctx = montar(9902, at, { mensagemAtual: PERGUNTA_STATUS });
  const q = ctx.manifesto.quadroInvestigativo;
  assert.strictEqual(q.estadoOperacional, 'aguardando_retorno_externo');
  assert.strictEqual(q.modoInvestigacao, 'dependente_de_retorno_externo');
  assert.strictEqual(q.pendenciaExterna.acoesInternasJustificadas, false);
  assert.ok(/Acompanhar\/cobrar o retorno externo/.test(q.acoesParaReduzirIncerteza[0]));
  assert.ok(/sem inventar procedimentos/.test(q.acoesParaReduzirIncerteza[0]));
  assert.ok(q.lacunasInformacao.some(l => /resolucao depende do retorno externo/.test(l)));
  assert.ok(!/NAO impede verificacoes internas/.test(ctx.userPrompt), 'sem evidencia, nao ha verificacao interna a sugerir');
  assert.ok(ctx.userPrompt.includes('depende desse retorno'));
}

// Situacao C: pedido explicito de pesquisa respeitado, status nao e proibicao.
function testarSituacaoC() {
  const at = criar(9903, { conteudoBruto: 'Adequacao fiscal', mensagens: HIST_TECNICO, anexos: [{ nome: 'nota-tecnica.pdf', conteudo: NOTA }] });
  const pedido = montar(9903, at, { mensagemAtual: PEDIDO });
  assert.strictEqual(pedido.manifesto.quadroInvestigativo.pedidoInvestigacaoExplicito, true);
  assert.ok(pedido.userPrompt.includes('o status administrativo nao e proibicao de analise'));
  const status = montar(9903, at, { mensagemAtual: PERGUNTA_STATUS });
  assert.strictEqual(status.manifesto.quadroInvestigativo.pedidoInvestigacaoExplicito, false);
  assert.ok(!status.userPrompt.includes('o status administrativo nao e proibicao'));
}

// Sem pendencia externa: comportamento anterior preservado.
function testarSemPendenciaExterna() {
  const at = criar(9904, { conteudoBruto: 'Erro na rotina MATA410 ao confirmar pedido', mensagens: [{ papel: 'customer', conteudo: 'Erro na rotina MATA410 ao confirmar pedido.' }] });
  const ctx = montar(9904, at, { aguardando: null });
  const q = ctx.manifesto.quadroInvestigativo;
  assert.strictEqual(q.pendenciaExterna, null);
  assert.strictEqual(q.modoInvestigacao, null);
  assert.ok(/^Atacar primeiro a evidencia central/.test(q.acoesParaReduzirIncerteza[0]));
  // Pendencia do cliente tambem nao vira bloqueio externo.
  const ctxCliente = montar(9904, at, { aguardando: 'RETORNO - CLIENTE' });
  assert.strictEqual(ctxCliente.manifesto.quadroInvestigativo.pendenciaExterna, null);
}

// SoftExpert: a logica e generica, sem texto especifico de TOTVS/Protheus.
function testarSoftExpertSemTextoEspecificoDeFornecedor() {
  const at = criar(9905, {
    conteudoBruto: 'SoftExpert Workflow: atividade parada apos HTTP 200 no callback',
    mensagens: [
      { papel: 'customer', conteudo: 'No SoftExpert Workflow a atividade ficou parada; o callback retornou HTTP 200.' },
      { papel: 'user', conteudo: 'Aberto ticket no fornecedor do SoftExpert; aguardando.' },
    ],
    anexos: [{ nome: 'wf-callback.log', mime: 'text/plain', linguagem: 'log', conteudo: '2026-10-02 10:00:00 INFO callback WFPROCESS enviado\n2026-10-02 10:00:01 ERROR atividade ATV-02 nao avancou idprocess=123' }],
  });
  const ctx = montar(9905, at, { aguardando: 'RETORNO - FORNECEDOR' });
  const q = ctx.manifesto.quadroInvestigativo;
  assert.strictEqual(q.modoInvestigacao, 'verificacao_interna_com_pendencia_externa_paralela');
  const textos = q.acoesParaReduzirIncerteza.join(' ');
  assert.ok(!/TOTVS|Protheus/i.test(textos), 'acoes geradas nao devem carregar nome de fornecedor/ERP especifico');
  assert.ok(textos.includes('wf-callback.log'));
}

// Item 3: respostas anteriores da IA nao viram fato, acao nem fonte de termos.
function testarRespostaDaIANaoViraFato() {
  const at = criar(9906, {
    conteudoBruto: 'Adequacao fiscal',
    mensagens: [
      ...HIST_TECNICO,
      { papel: 'assistant', conteudo: 'A analise indica que estamos aguardando retorno do fornecedor TOTVS; abrimos chamado e o registro M999 e a rotina MATA999 devem ser conferidos.' },
    ],
    anexos: [{ nome: 'nota-tecnica.pdf', conteudo: NOTA }],
  });
  // O assistant sozinho nao gera acao operacional.
  const so = criar(9907, {
    conteudoBruto: 'Chamado de teste',
    mensagens: [{ papel: 'assistant', conteudo: 'Estamos aguardando retorno do fornecedor: chamado aberto na TOTVS, ticket encaminhado.' }],
  });
  const ctxSo = montar(9907, so, { aguardando: null });
  assert.deepStrictEqual(ctxSo.manifesto.quadroInvestigativo.eventosOperacionais, []);
  assert.strictEqual(ctxSo.manifesto.quadroInvestigativo.estadoOperacional, 'triagem_investigativa');

  const ctx = montar(9906, at);
  const q = ctx.manifesto.quadroInvestigativo;
  const ia = q.evidencias.filter(e => e.autoria === 'ia');
  assert.ok(ia.length >= 1, 'resposta da IA permanece no historico/quadro');
  assert.ok(ia.every(e => e.papeis.length === 1 && e.papeis[0] === 'HISTORICO_IA'));
  const plano = ctx.manifesto.planoRespostaRastreavel;
  assert.ok(!plano.fatosComprovados.some(f => /M999|MATA999/.test(f.texto)), 'resposta da IA nao e fato');
  assert.ok(plano.hipotesesFundamentadas.some(h => h.permissaoUso === 'resposta_anterior_ia_nao_confirmada'));
  const termos = plano.termosTecnicosPermitidos.map(t => t.termo);
  assert.ok(!termos.includes('M999') && !termos.includes('MATA999'), 'termos citados so pela IA nao viram referencia rastreavel');
  assert.ok(termos.includes('C197') && termos.includes('M220'), 'fatos de documentos e do analista continuam rastreaveis');
  // O historico conversacional continua disponivel no prompt.
  assert.ok(ctx.userPrompt.includes('IA anterior'));
}

// Item 2: extracao de referencias curtas, sem ruido.
function testarExtracaoDeReferencias() {
  const texto = 'Registros C197 e E115; M220/M620; M110 e M115; tabela SC7010; rotina MATA410; LC224 de 2025; ano T2026; TOTVS e PDF e HTTP 200; ACAO INCLUIR.';
  const evid = prr.extrairTermosTecnicos(texto, { codigosCurtos: true }).map(t => t.termo);
  for (const t of ['C197', 'E115', 'M220', 'M620', 'M110', 'M115', 'SC7010', 'MATA410']) assert.ok(evid.includes(t), `${t} deve ser extraido`);
  for (const t of ['T2026', 'TOTVS', 'PDF', 'HTTP', 'INCLUIR']) assert.ok(!evid.includes(t), `${t} nao e referencia tecnica`);
  // Verificacao da RESPOSTA mantem o comportamento anterior (Quality Gate inalterado).
  const resp = prr.extrairTermosTecnicos(texto).map(t => t.termo);
  assert.ok(!resp.includes('C197') && resp.includes('MATA410'));
}

// Empresas diferentes: nenhuma influencia a outra.
function testarIsolamentoEntreEmpresas() {
  const a = criar(9910, { conteudoBruto: 'Adequacao', mensagens: HIST_TECNICO, anexos: [{ nome: 'nota-a.pdf', conteudo: NOTA }] });
  const b = criar(9911, { conteudoBruto: 'Aguardando', mensagens: [{ papel: 'user', conteudo: 'Aguardando retorno do fornecedor.' }] });
  const qa = montar(9910, a).manifesto.quadroInvestigativo;
  const qb = montar(9911, b, { mensagemAtual: PERGUNTA_STATUS }).manifesto.quadroInvestigativo;
  assert.strictEqual(qa.modoInvestigacao, 'verificacao_interna_com_pendencia_externa_paralela');
  assert.strictEqual(qb.modoInvestigacao, 'dependente_de_retorno_externo');
  assert.ok(!qb.pendenciaExterna.referenciasInternas.includes('C197'));
}

function main() {
  try {
    testarSituacaoA();
    testarSituacaoB();
    testarSituacaoC();
    testarSemPendenciaExterna();
    testarSoftExpertSemTextoEspecificoDeFornecedor();
    testarRespostaDaIANaoViraFato();
    testarExtracaoDeReferencias();
    testarIsolamentoEntreEmpresas();
    console.log('pendencia-externa-vs-investigacao.test.js: ok (8 grupos)');
  } finally {
    limparEDesligar();
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
