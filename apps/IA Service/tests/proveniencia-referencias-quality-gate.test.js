// Proveniencia em vez de permissao (2026-10): o Quality Gate nao bloqueia
// conhecimento tecnico novo por ausencia nas evidencias; protege a integridade
// do que se afirma sobre o caso. Nao chama IA real.
// Executar: node "apps/IA Service/tests/proveniencia-referencias-quality-gate.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-proveniencia-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const contextEngine = require('../backend/services/context-engine');
const qg = require('../backend/services/quality-gate-service');
const investigacao = require('../backend/services/investigacao-service');
const trilha = require('../backend/services/trilha-investigacao-service');
const promptBuilder = require('../backend/services/prompt-builder');

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

const falha = (gate, codigo) => (gate.falhas || []).find(f => f.codigo === codigo);
const MANIFESTO = () => ({
  selecionados: [{ tipo: 'anexo', id: 'a1', nome: 'nota.pdf', status: 'ANALISADA', resumo: 'Nota tecnica sobre apuracao PIS COFINS.' }],
  omitidos: [],
});
const avaliar = (texto, extra = {}) => qg.avaliarResposta({
  textoResposta: texto,
  manifesto: extra.manifesto || MANIFESTO(),
  pergunta: extra.pergunta || 'Pesquise uma solucao para este chamado.',
  historicoMensagens: extra.historico || [{ papel: 'customer', conteudo: 'Erro ao gerar o registro na apuracao.' }],
  indiceReferencias: extra.indice || null,
  houveRetry: !!extra.houveRetry,
});

// 1. Conhecimento tecnico novo (nao consta no chamado) NAO e erro.
function testarHipoteseTecnicaNovaNaoBloqueia() {
  const g = avaliar('Verifique no ambiente a rotina MATA410 e o parametro MV_ESTNEG, e compare com a tabela SC7010; teste em homologacao antes de aplicar.');
  assert.ok(!falha(g, 'UNTRACEABLE_TECHNICAL_REFERENCE'));
  assert.ok(!falha(g, 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED'));
  assert.ok(!falha(g, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'));
  const origens = Object.fromEntries(g.proveniencia.referencias.map(r => [r.termo, r.origem]));
  assert.strictEqual(origens.MATA410, 'conhecimento_modelo');
  assert.strictEqual(origens.MV_ESTNEG, 'conhecimento_modelo');
  assert.ok(g.proveniencia.contagem.conhecimento_modelo >= 2);
}

// 2. Referencia do conhecimento do modelo apresentada como observada no caso = falha.
function testarAtribuicaoFalsaAoCasoBloqueia() {
  const g = avaliar('O log do cliente mostra que a rotina XPTO_CALCULA_TOTAL falhou na confirmacao do pedido.');
  const f = falha(g, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE');
  assert.ok(f, 'fato inventado sobre o chamado deve ser sinalizado');
  assert.strictEqual(f.decisionKind, 'bloqueio_objetivo');
  assert.ok(g.deveRetry, 'deve acionar retry para corrigir a atribuicao');
  assert.ok(qg.temFalhaDeIntegridade(g));

  // Afirmada como causa confirmada, sem hedge.
  const causa = avaliar('A causa confirmada e a rotina XPTO_CALCULA_TOTAL; corrija-a.');
  assert.ok(falha(causa, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'));

  // A mesma referencia, rotulada, e conhecimento tecnico legitimo.
  const hip = avaliar('Como hipotese a validar, pode existir uma rotina como XPTO_CALCULA_TOTAL envolvida; confirme no fonte antes de concluir.');
  assert.ok(!falha(hip, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'));
  const orient = avaliar('Em geral, o calculo do total passa pela rotina XPTO_CALCULA_TOTAL no Protheus; vale conferir se ela esta customizada.');
  assert.ok(!falha(orient, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'));
}

// 3. Corpus do QG = texto enviado das evidencias (corrige o falso positivo).
function testarCorpusConsistenteComTextoEnviado() {
  const texto = 'O anexo traz o campo NAT_REC_COD no leiaute, e o registro precisa ser conferido.';
  const semIndice = avaliar(texto);
  assert.ok(falha(semIndice, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), 'sem o texto integral da evidencia a referencia nao e rastreavel');
  const comIndice = avaliar(texto, { indice: new Set(['NAT_REC_COD']) });
  assert.ok(!falha(comIndice, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), 'termo presente no texto integral enviado deve ser origem=chamado');
  assert.strictEqual(comIndice.proveniencia.referencias.find(r => r.termo === 'NAT_REC_COD').origem, 'chamado');
}

// 4. Pesquisa: referencia so da pesquisa nao pode virar "o cliente informou".
function testarReferenciaDePesquisaNaoViraEvidenciaDoCaso() {
  const pesquisa = { paginasLidas: [{ titulo: 'TDN', url: 'https://tdn.totvs.com/x', trecho: 'O parametro MV_ESPECIE controla as especies.' }] };
  const bom = qg.avaliarResposta({
    textoResposta: 'Segundo a documentacao da TOTVS (pesquisa externa), o parametro MV_ESPECIE controla as especies; vale conferir no ambiente.',
    manifesto: MANIFESTO(), pesquisa, pergunta: 'Analise.', historicoMensagens: [],
  });
  assert.ok(!falha(bom, 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE'));
  assert.strictEqual(bom.proveniencia.referencias.find(r => r.termo === 'MV_ESPECIE').origem, 'pesquisa');
  const ruim = qg.avaliarResposta({
    textoResposta: 'O cliente informou no historico que o parametro MV_ESPECIE esta com valor incorreto.',
    manifesto: MANIFESTO(), pesquisa, pergunta: 'Analise.', historicoMensagens: [],
  });
  assert.ok(falha(ruim, 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE'));
}

// 5. Retry preserva conteudo tecnico e corrige so atribuicao/certeza.
function testarRetryPreservaConteudoTecnico() {
  const g = avaliar('O log mostra que a rotina XPTO_CALCULA_TOTAL falhou.');
  const instrucao = qg.montarInstrucaoRetry(g, { manifesto: MANIFESTO() });
  assert.ok(/ATRIBUICAO/.test(instrucao));
  assert.ok(/MANTENHA o conteudo tecnico|Mantenha o conteudo tecnico/.test(instrucao));
  assert.ok(/XPTO_CALCULA_TOTAL/.test(instrucao));
  assert.ok(!/nao invente nome de rotina/i.test(instrucao));
  assert.ok(!/referencias tecnicas autorizadas/i.test(instrucao));
  assert.ok(!/descreva funcionalmente a evidencia faltante/i.test(instrucao));
}

// 6. Politica de entrega graduada (M4) e pendencia externa informativa (M7).
function testarPoliticaGraduada() {
  const estilo = { aprovado: false, falhas: [{ codigo: 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE', decisionKind: 'correcao_estilo' }] };
  assert.strictEqual(investigacao._statusFinalQualityGate(estilo, true), 'concluido_com_alerta_quality_gate');
  const integridade = { aprovado: false, falhas: [{ codigo: 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE', decisionKind: 'bloqueio_objetivo' }] };
  assert.strictEqual(investigacao._statusFinalQualityGate(integridade, true), 'revisao_necessaria_quality_gate');
  const certeza = { aprovado: false, falhas: [{ codigo: 'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE', decisionKind: 'bloqueio_objetivo' }] };
  assert.strictEqual(investigacao._statusFinalQualityGate(certeza, true), 'revisao_necessaria_quality_gate');
  const ids = { aprovado: false, falhas: [{ codigo: 'INTERNAL_IDS_USED_AS_EVIDENCE', decisionKind: 'bloqueio_objetivo' }] };
  assert.strictEqual(investigacao._statusFinalQualityGate(ids, true), 'revisao_necessaria_quality_gate');

  const manifesto = { ...MANIFESTO(), pendenciaConsolidada: { responsavel: 'fornecedor', bloqueante: true } };
  const g = avaliar('Verifique a configuracao do registro e teste em homologacao antes de aplicar.', { manifesto });
  const pend = falha(g, 'EXTERNAL_PENDING_DEPENDENCY_IGNORED');
  assert.ok(pend, 'alerta informativo continua registrado');
  assert.strictEqual(pend.severidade, 'baixa');
  assert.strictEqual(pend.decisionKind, 'correcao_estilo', 'e alerta, nao bloqueio');
  assert.ok(!qg.ehFalhaDeIntegridade(pend), 'nao veta a entrega');
  assert.ok(!['alta', 'media'].includes(pend.severidade), 'severidade baixa nao aciona retry por si so');
}

// 7. Protocolo de observacoes visuais: nenhum marcador chega ao analista.
function testarProtocoloVisualNaoVaza() {
  const j = '{"observacoesVisuais":[{"anexoId":"a","nome":"x.png","textosVisiveis":["Rejeicao 1062"],"observacao":"tela"}]}';
  const resp = 'Verifique as regras de calculo e valide o diferimento em homologacao.';
  const variantes = {
    correto: `<<<OBSERVACOES_VISUAIS_AUDITORIA>>>\n${j}\n<<<FIM_OBSERVACOES_VISUAIS_AUDITORIA>>>\n${resp}`,
    sem_abertura: `${j}\n<<<FIM_OBSERVACOES_VISUAIS_AUDITORIA>>>\n${resp}`,
    sem_delimitadores: `OBSERVACOES_VISUAIS_AUDITORIA\n${j}\nFIM_OBSERVACOES_VISUAIS_AUDITORIA\n${resp}`,
    cerca_json: `\`\`\`json\n${j}\n\`\`\`\n${resp}`,
    bloco_no_fim: `${resp}\n<<<OBSERVACOES_VISUAIS_AUDITORIA>>>\n${j}\n<<<FIM_OBSERVACOES_VISUAIS_AUDITORIA>>>`,
    truncado: `${resp}\n<<<OBSERVACOES_VISUAIS_AUDITORIA>>>\n${j}\n<<<FIM_OBSERVACOES_VISUAIS_AU`,
  };
  for (const [nome, texto] of Object.entries(variantes)) {
    const r = investigacao._extrairObservacoesVisuaisDaResposta(texto, { manifesto: { selecionados: [] } });
    assert.ok(!/OBSERVACOES_VISUAIS_AUDITORIA/i.test(r.textoLimpo), `${nome}: marcador vazou`);
    assert.ok(!/observacoesVisuais/.test(r.textoLimpo), `${nome}: JSON de auditoria vazou`);
    assert.ok(r.textoLimpo.includes('valide o diferimento'), `${nome}: resposta ao analista deve ser preservada`);
    const g = avaliar(r.textoLimpo);
    assert.ok(!falha(g, 'UNTRACEABLE_TECHNICAL_REFERENCE') && !falha(g, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE'), `${nome}: nao deve bloquear por protocolo`);
  }
  // Mesmo se o marcador chegasse ao gate, nao e referencia tecnica.
  const g = avaliar(`${resp}\nFIM_OBSERVACOES_VISUAIS_AUDITORIA`);
  assert.ok(!falha(g, 'UNTRACEABLE_TECHNICAL_REFERENCE'));
  assert.ok(!g.proveniencia.referencias.some(r => /OBSERVACOES_VISUAIS/.test(r.termo)));
}

// 8. Context Engine: indice transitorio vem do texto enviado, sem respostas da IA.
function testarIndiceDeReferenciasDoContexto() {
  const at = atendimentoRepo.criarAtendimento(9950, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Adequacao fiscal' });
  mensagemRepo.salvarMensagem(9950, at.id, { papel: 'customer', conteudo: 'Precisamos do registro C197 na apuracao.' });
  mensagemRepo.salvarMensagem(9950, at.id, { papel: 'assistant', conteudo: 'Verifique a rotina ZZZ_SO_DA_IA no ambiente.' });
  const meta = anexoRepo.salvarMetadadosAnexo(9950, at.id, { nomeOriginal: 'nt.pdf', nomeInterno: 'nt.pdf', mimeType: 'application/pdf', tamanho: 10, caminhoRelativo: '9950/nt.pdf' });
  anexoRepo.atualizarExtracao(9950, meta.id, { conteudoExtraido: 'Nota: o campo NAT_REC_COD e o registro M220 devem ser informados.', linguagemDetectada: 'pdf', encodingDetectado: 'utf-8', eCodigo: false });
  const ctx = contextEngine.montarContextoInvestigacao({
    atendimento: at,
    mensagens: mensagemRepo.listarMensagens(9950, at.id, { limite: 50 }),
    mensagemAtual: 'Revise o historico e pesquise uma solucao.',
    anexosDoTurno: anexoRepo.listarAnexos(9950, at.id),
    anexosComoContexto: true,
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg: { provedorPrimario: 'openai', modelos: { openai: 'gpt-4o-mini' } },
    candidatoOrcamento: { provider: 'openai', model: 'gpt-4o-mini' },
  });
  assert.ok(ctx.indiceReferencias instanceof Set);
  for (const t of ['C197', 'NAT_REC_COD', 'M220']) assert.ok(ctx.indiceReferencias.has(t), `${t} deve estar no indice`);
  assert.ok(!ctx.indiceReferencias.has('ZZZ_SO_DA_IA'), 'resposta da IA nao autoriza referencia');
  assert.ok(!('indiceReferencias' in ctx.manifesto), 'indice nao deve ser persistido no manifesto');
  // Prompt: sem linguagem de "autorizado/nao cite".
  assert.ok(!/nao estejam autorizados no PRR/i.test(ctx.userPrompt));
  assert.ok(/nao como limite do seu conhecimento/i.test(ctx.userPrompt));
  assert.ok(!/contrato obrigatorio de geracao/i.test(ctx.userPrompt));
}

// 9. Auditoria e trilha registram a proveniencia.
function testarAuditoriaETrilha() {
  const g = avaliar('Verifique MATA410. O log do cliente mostra XPTO_CALCULA_TOTAL.', { indice: new Set(['MATA410']) });
  assert.ok(g.proveniencia && g.proveniencia.contagem);
  assert.strictEqual(g.proveniencia.referencias.find(r => r.termo === 'MATA410').origem, 'chamado');
  const t = trilha.montarTrilhaDaExecucao({
    id: 'e1', status: 'concluido_com_alerta_quality_gate', criadoEm: '2026-10-15T12:00:00Z',
    manifesto: {}, qualityGate: { ...g, aprovado: false }, tentativas: [], usage: {},
  });
  const evento = (t.eventos || []).find(e => e.tipo === 'quality_gate');
  assert.ok(evento && evento.detalhes.proveniencia, 'trilha deve expor a proveniencia');
  assert.ok(evento.detalhes.proveniencia.contagem.chamado >= 1);
  assert.ok(evento.detalhes.proveniencia.atribuicoesFalsas >= 1);
}

// 10. O retry nao pode piorar a resposta (recusa do provider, vazia ou truncada).
function testarRetryNaoDegradaResposta() {
  const anterior = 'O ponto mais critico e a rejeicao 1062. Verifique a regra de calculo do IBS/CBS e o percentual de diferimento; valide em homologacao. '.repeat(4);
  assert.strictEqual(investigacao._retryDegradouResposta('Desculpe, nao posso ajudar com isso.', anterior), 'recusa_do_provider');
  assert.strictEqual(investigacao._retryDegradouResposta('', anterior), 'vazia');
  assert.strictEqual(investigacao._retryDegradouResposta('Verifique a regra.', anterior), 'muito_mais_curta');
  assert.strictEqual(investigacao._retryDegradouResposta(anterior + ' Acrescimo corrigindo a atribuicao.', anterior), null);
  // Resposta curta legitima (anterior tambem curta) nao e descartada.
  assert.strictEqual(investigacao._retryDegradouResposta('Peca o log da rotina.', 'Precisa do log.'), null);
}

function main() {
  try {
    testarHipoteseTecnicaNovaNaoBloqueia();
    testarAtribuicaoFalsaAoCasoBloqueia();
    testarCorpusConsistenteComTextoEnviado();
    testarReferenciaDePesquisaNaoViraEvidenciaDoCaso();
    testarRetryPreservaConteudoTecnico();
    testarPoliticaGraduada();
    testarProtocoloVisualNaoVaza();
    testarIndiceDeReferenciasDoContexto();
    testarAuditoriaETrilha();
    testarRetryNaoDegradaResposta();
    console.log('proveniencia-referencias-quality-gate.test.js: ok (10 grupos)');
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
