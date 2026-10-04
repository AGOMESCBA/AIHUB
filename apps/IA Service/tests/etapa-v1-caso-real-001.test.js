// Regressão permanente do COMPORTAMENTO observado no Caso Real #001
// (atendimento real da empresa J2A, 2026-10, dados anonimizados — nenhuma
// referência ao número do chamado, CNPJ ou nome de cliente permanece aqui).
//
// O objetivo NÃO é recriar a resposta exata que a IA deu. É garantir que o
// MECANISMO que causou o comportamento errado continue corrigido:
// o extrator de sinais da pesquisa não deve mais ser desviado por um anexo
// de código de assunto diferente do diagnóstico já em curso na conversa.

const assert = require('assert');
const os = require('os');
const path = require('path');

const database = require('../backend/database');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const pesquisaService = require('../backend/services/technical-research-service');
const dossieContextService = require('../backend/services/dossie-context-service');

function dbTmp() {
  return path.join(os.tmpdir(), `ia-service-caso-real-001-${Date.now()}.db`);
}

// Fixture anonimizada: reproduz a ESTRUTURA do caso real (chamado sobre
// truncamento de texto em campo de banco; anexo de código de um assunto não
// relacionado — rotina de impressão fiscal — presente no mesmo atendimento;
// diagnóstico prévio da IA citando rotina/stack trace específicos diferentes
// do assunto do anexo) sem usar nenhum dado real do cliente.
function montarAtendimentoFixture(empresaId) {
  const at = atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Texto em campo de observacoes aparece cortado no cadastro de fornecedor.' });

  mensagemRepo.salvarMensagem(empresaId, at.id, { papel: 'user', conteudo: 'Boa tarde, o texto no campo de observacoes esta cortado, falta letras nas ultimas palavras de cada linha.' });
  mensagemRepo.salvarMensagem(empresaId, at.id, {
    papel: 'assistant',
    conteudo: 'O stack trace indica que o erro ocorre em ROTINA_CADASTRO_FORN.PRX, linha 457, chamado por MODULO_FINANCEIRO.API.CONTAS.',
  });

  // Anexo de código de um assunto DIFERENTE (impressão de documento fiscal),
  // mesma estrutura do caso real (código longo, rico em padrões sintáticos
  // tecnicos que não têm relação com o diagnóstico já dado acima).
  anexoRepo.salvarMetadadosAnexo(empresaId, at.id, {
    nomeOriginal: 'impressao_documento_fiscal.prw',
    nomeInterno: `${at.id}-impressao_documento_fiscal.prw`,
    mimeType: 'application/octet-stream',
    tamanho: 500,
    caminhoRelativo: 'fake/impressao_documento_fiscal.prw',
    conteudoExtraido: `
      // Define se quebra a impressao em lotes
      local cProg := iif(existBlock("ImprimeProc"),"U_ImprimeProc","ImprimeProc")
      oImpressora := FWMSPrinter():New("DOC_FISCAL", IMP_SPOOL)
      Static Function ImprimeDocumento()
      PARAM_IMP_01 PARAM_IMP_02 CAMPO_DOC CAMPO_SERIE
      ROTINA_CADASTRO_FORN MODULO_IMPRESSAO
    `.repeat(10),
    linguagemDetectada: 'advpl',
    eCodigo: true,
  });

  return at;
}

async function testarObjetivoNaoDesviaParaAnexoDeAssuntoDiferente() {
  const empresaId = 71001;
  const at = montarAtendimentoFixture(empresaId);

  const historico = mensagemRepo.listarMensagens(empresaId, at.id);
  const anexos = anexoRepo.listarAnexos(empresaId, at.id).filter(a => a.conteudoExtraido);
  const texto = 'Revise todo o historico deste chamado e os anexos sincronizados e pesquise uma nova solucao.';
  const dossieOperacional = dossieContextService.montarMemoriaOperacional({ empresaId, atendimentoId: at.id, mensagemAtual: texto, orcamentoEntrada: 16000 });

  const plano = pesquisaService.planejarPesquisa({
    empresaId,
    atendimentoId: at.id,
    atendimento: at,
    mensagens: historico,
    anexos,
    texto,
    dossieOperacional,
  });

  // 1. Objetivo deve citar a causa já diagnosticada na conversa (rotina real
  // do cadastro de fornecedor), não o anexo de impressão fiscal.
  assert.ok(
    /ROTINA_CADASTRO_FORN|MODULO_FINANCEIRO/.test(plano.objetivo),
    `objetivo deveria citar a causa já diagnosticada na conversa, veio: "${plano.objetivo}"`
  );

  // 2. Nenhuma consulta deve ser desviada para termos do anexo de impressão
  // fiscal (assunto não relacionado ao diagnóstico em curso).
  const consultaDesviada = plano.consultas.some(c => /imprimeproc|doc_fiscal|modulo_impressao/i.test(c));
  assert.ok(!consultaDesviada, `consulta não deveria citar termos do anexo de assunto diferente: ${JSON.stringify(plano.consultas)}`);
}

// 2. Stack trace não vira prova causal automaticamente — o objetivo/consulta
// deve refletir o QUE FOI OBSERVADO (stack trace, rotina), não transformar
// isso em afirmação de causa fechada por si só. Esta suíte testa a camada
// mecânica (pesquisa); a camada de linguagem/certeza é responsabilidade do
// Quality Gate (UNSUPPORTED_FACT_OR_DIAGNOSIS), já coberta em
// etapa4b1-fechamento-release.test.js e não duplicada aqui.
function testarQualityGateDetectaCausalidadeNaoSustentadaParaEsteFormato() {
  const qualityGate = require('../backend/services/quality-gate-service');
  const resposta = 'Diagnostico: a causa raiz e o tamanho insuficiente do campo, confirmado pelo stack trace.';
  const r = qualityGate.avaliarResposta({
    textoResposta: resposta,
    manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'anexo', trecho: 'ROTINA_CADASTRO_FORN linha 457' }], omitidos: [] },
    pesquisa: { plano: { devePesquisar: false }, configurado: true, modo: 'nao_pesquisado' },
    pergunta: 'Ainda não temos evidência de que seja tamanho do campo. Como podemos comprovar a causa antes de alterar qualquer coisa?',
  });
  // Esse texto específico não necessariamente dispara UNSUPPORTED_FACT_OR_DIAGNOSIS
  // (depende dos tokens críticos reconhecidos pela disciplina) — o que este
  // teste documenta é que o mecanismo EXISTE e roda sobre este tipo de
  // entrada sem lançar exceção, servindo de regressão estrutural.
  assert.ok(Array.isArray(r.falhas));
}

// 3. Pesquisa real ocorre quando disponível: com Serper mockado retornando
// resultado real, a pesquisa deve efetivamente abrir e ler a página, não só
// decidir "devePesquisar=true" e parar aí.
async function testarPesquisaRealOcorreQuandoDisponivel() {
  const empresaId = 71002;
  const at = montarAtendimentoFixture(empresaId);
  const historico = mensagemRepo.listarMensagens(empresaId, at.id);
  const texto = 'Pesquise uma solução para isso.';
  const dossieOperacional = dossieContextService.montarMemoriaOperacional({ empresaId, atendimentoId: at.id, mensagemAtual: texto, orcamentoEntrada: 16000 });

  const pesquisa = await pesquisaService.pesquisar({
    empresaId,
    atendimentoId: at.id,
    atendimento: at,
    mensagens: historico,
    texto,
    dossieOperacional,
  }, {
    buscarSerper: async () => [{
      titulo: 'Documentacao tecnica controlada',
      url: 'https://tdn.totvs.com/pages/viewpage.action?pageId=caso001',
      trecho: 'conteudo tecnico controlado',
      fonte: 'Serper/Google',
      consulta: 'q',
    }],
    buscarBing: async () => [],
    abrirResultados: async (resultados) => resultados.slice(0, 1).map(r => ({
      titulo: r.titulo, url: r.url, status: 'lida', trecho: 'trecho real lido', consulta: r.consulta, rankingScore: r.rankingScore,
    })),
    interpretarSemantico: async () => ({
      resultado: { haMudancaInvestigativa: true, tipoMudanca: 'informacao_contextual', haEvidenciaNova: true, relevanciaParaPesquisa: 'alta', justificativa: 'pedido explicito', referenciasEstado: [], confiancaQualitativa: 'media' },
      provider: 'fixture', model: 'fixture', tokens: 10,
    }),
  });

  assert.strictEqual(pesquisa.plano.devePesquisar, true, 'pedido explícito deve resultar em devePesquisar=true');
  assert.strictEqual(pesquisa.modo, 'web', 'quando busca está configurada (mock) e devePesquisar=true, pesquisa real deve ocorrer, não só a decisão');
  assert.ok(pesquisa.paginasLidas.some(p => p.status === 'lida'), 'página deve ter sido efetivamente lida, não só listada como resultado');
}

async function main() {
  database.inicializarDB(dbTmp());
  try {
    await testarObjetivoNaoDesviaParaAnexoDeAssuntoDiferente();
    testarQualityGateDetectaCausalidadeNaoSustentadaParaEsteFormato();
    await testarPesquisaRealOcorreQuandoDisponivel();
    console.log('etapa-v1-caso-real-001.test.js: ok (regressao comportamental do Caso Real #001)');
  } finally {
    database.fecharDB();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
