const assert = require('assert');
const os = require('os');
const path = require('path');

const database = require('../backend/database');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const dossieContextService = require('../backend/services/dossie-context-service');
const pesquisaService = require('../backend/services/technical-research-service');

function dbTmp() {
  return path.join(os.tmpdir(), `ia-service-pesquisa-explicita-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function atendimento(empresaId, conteudo) {
  return atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto: conteudo || 'Atendimento pesquisa explicita' });
}

function memoria(empresaId, atId, texto, orc = 16000) {
  return dossieContextService.montarMemoriaOperacional({ empresaId, atendimentoId: atId, mensagemAtual: texto, orcamentoEntrada: orc });
}

// Fixture determinística: simula a interpretação semântica reconhecendo
// pedido explícito de pesquisa como tipoMudanca relevante quando o texto
// contém qualquer uma das 15+ formulações abaixo — sem depender de regex
// fixa de "pesquise"/"pesquisar"/"procure" no PRODUTO (aqui só no MOCK de
// teste, para isolar a camada de decisão/dedup da camada de IA real).
function interpretarSemanticoComPedido(pedidoDetectado) {
  return async ({ ctx }) => ({
    resultado: {
      haMudancaInvestigativa: pedidoDetectado,
      tipoMudanca: pedidoDetectado ? 'informacao_contextual' : 'pendencia_sem_novidade',
      haEvidenciaNova: pedidoDetectado,
      relevanciaParaPesquisa: pedidoDetectado ? 'alta' : 'nenhuma',
      justificativa: pedidoDetectado ? 'usuario solicitou pesquisa explicitamente' : 'sem novidade',
      referenciasEstado: [],
      confiancaQualitativa: 'media',
    },
    provider: 'fixture',
    model: 'semantic-fixture',
    tokens: 60,
  });
}

const PEDIDOS_EXPLICITOS_PESQUISA = [
  'Pesquise uma solução para isso.',
  'Pode procurar uma documentação sobre esse erro?',
  'Preciso que você busque uma referência técnica sobre esse comportamento.',
  'Consulte a documentação oficial para ver se há algo relacionado.',
  'Veja se existe algo na base de conhecimento do TDN sobre isso.',
  'Dá uma olhada se já teve caso parecido documentado em algum lugar.',
  'Checa se tem algo publicado sobre esse tipo de falha.',
  'Investiga externamente se isso é um comportamento conhecido.',
  'Será que existe algo na internet sobre esse erro específico?',
  'Faça uma pesquisa técnica para confirmar se é um bug conhecido.',
  'Quero que você vasculhe fontes externas sobre esse assunto.',
  'Tenta achar uma referência oficial para esse caso.',
  'Busca lá no site da TOTVS se tem nota técnica sobre isso.',
  'Revise o histórico e pesquise uma nova solução.',
  'Olha se não tem nenhuma documentação que explique isso.',
  'Confirma pesquisando se essa é uma limitação conhecida do sistema.',
];

async function testarPedidosExplicitosQuandoInvestigacaoAberta() {
  for (const [i, pedido] of PEDIDOS_EXPLICITOS_PESQUISA.entries()) {
    const empresaId = 70000 + i;
    const at = atendimento(empresaId, 'Investigacao aberta sem causa fechada');
    const dossie = memoria(empresaId, at.id, pedido);
    const pesquisa = await pesquisaService.pesquisar({
      empresaId,
      atendimentoId: at.id,
      atendimento: at,
      texto: pedido,
      dossieOperacional: dossie,
    }, {
      buscarSerper: async () => [],
      buscarBing: async () => [],
      interpretarSemantico: interpretarSemanticoComPedido(true),
    });
    assert.strictEqual(
      pesquisa.plano.devePesquisar,
      true,
      `pedido explícito "${pedido}" deveria resultar em devePesquisar=true (motivo atual: ${pesquisa.plano.motivo})`
    );
  }
}

// Cenário E: pedido explícito, mas a MESMA pesquisa já foi executada sem
// evidência nova — não deve repetir cegamente a consulta idêntica; deve
// haver sinal de refinamento/justificativa diferente da simples dedup muda.
async function testarPedidoExplicitoComPesquisaJaExecutada() {
  const empresaId = 70100;
  const at = atendimento(empresaId, 'Protheus MATA460 ja pesquisado');
  execucaoRepo.salvarExecucao(empresaId, {
    atendimentoId: at.id,
    status: 'concluido',
    pesquisa: {
      consultas: ['MATA460 FWFormModel X5_FILIAL'],
      paginasLidas: [{ url: 'https://tdn.totvs.com/kb/mata460', status: 'lida', trecho: 'nada util encontrado' }],
    },
  });
  const texto = 'MATA460 FWFormModel X5_FILIAL. Pesquise de novo, por favor, não achamos nada ainda.';
  const dossie = memoria(empresaId, at.id, texto);
  const pesquisa = await pesquisaService.pesquisar({
    empresaId,
    atendimentoId: at.id,
    atendimento: at,
    texto,
    dossieOperacional: dossie,
  }, {
    buscarSerper: async () => [],
    buscarBing: async () => [],
    interpretarSemantico: interpretarSemanticoComPedido(true),
  });
  // Não pode simplesmente devolver "consulta já executada, não pesquiso" sem
  // mais nada: ou refina a consulta (nucleo técnico diferente), ou reexecuta
  // com justificativa de pedido explícito, ou explica objetivamente a lacuna.
  const foiIgnoradaSemExplicacao = pesquisa.plano.devePesquisar === false
    && !pesquisa.plano.motivo?.includes('pedido explicito')
    && !(pesquisa.plano.consultasIgnoradas || []).some(c => c.motivo?.includes('pedido'));
  assert.ok(!foiIgnoradaSemExplicacao, `pedido explícito de repesquisa não pode ser silenciosamente ignorado sem explicação (motivo: ${pesquisa.plano.motivo})`);
}

// Pedido explícito NÃO deve forçar pesquisa quando a investigação já está
// com causa fechada/diagnóstico sustentado (não é para virar pesquisa cega
// em qualquer circunstância) - mas isso é political call do produto, então
// aqui testamos apenas que o sinal de pedido é RESPEITADO quando a
// investigação está aberta, que é o cenário D pedido pelo briefing.
async function testarPedidoExplicitoNaoQuebraDeteccaoDeterministicaForte() {
  const empresaId = 70200;
  const at = atendimento(empresaId, 'Protheus evidencia forte');
  const texto = 'MATA460 FWFormModel: Field not found X5_FILIAL. Pesquise uma solução.';
  const dossie = memoria(empresaId, at.id, texto);
  const pesquisa = await pesquisaService.pesquisar({
    empresaId,
    atendimentoId: at.id,
    atendimento: at,
    texto,
    dossieOperacional: dossie,
  }, {
    buscarSerper: async () => [],
    buscarBing: async () => [],
  });
  // Sinal técnico forte já deve bastar (fast path determinístico) mesmo sem
  // chamar a camada semântica - confirma que a nova lógica não interfere no
  // caminho determinístico já validado.
  assert.strictEqual(pesquisa.plano.devePesquisar, true);
}

async function testarForcarPesquisaVenceSemanticaDesfavoravel() {
  const empresaId = 70250;
  const at = atendimento(empresaId, 'Protheus rateio de nota com comportamento repetido');
  const texto = 'Revise todo o historico deste chamado e os anexos sincronizados e pesquise uma nova solucao.';
  execucaoRepo.salvarExecucao(empresaId, {
    atendimentoId: at.id,
    status: 'concluido',
    pesquisa: {
      consultas: ['TOTVS Protheus rateio nota MV_RATDESP MV_TPRTDSP'],
      paginasLidas: [{ url: 'https://tdn.totvs.com/pages/rateio', status: 'lida', trecho: 'pesquisa anterior' }],
    },
  });
  const dossie = memoria(empresaId, at.id, texto);
  const pesquisa = await pesquisaService.pesquisar({
    empresaId,
    atendimentoId: at.id,
    atendimento: at,
    texto,
    dossieOperacional: dossie,
    forcarPesquisa: true,
  }, {
    buscarSerper: async () => [{
      titulo: 'TDN rateio Protheus',
      url: 'https://tdn.totvs.com/pages/rateio-nf',
      trecho: 'conteudo novo controlado',
      fonte: 'Serper/Google',
      consulta: 'rateio',
    }],
    abrirResultados: async (resultados) => resultados.slice(0, 1).map(r => ({
      titulo: r.titulo,
      url: r.url,
      status: 'lida',
      trecho: 'pagina efetivamente lida no teste',
      consulta: r.consulta,
      rankingScore: r.rankingScore,
    })),
    interpretarSemantico: interpretarSemanticoComPedido(false),
  });
  assert.strictEqual(pesquisa.plano.devePesquisar, true, 'forcarPesquisa=true deve vencer semantica desfavoravel');
  assert.strictEqual(pesquisa.modo, 'web', 'forcarPesquisa=true deve executar busca quando ha provider disponivel');
  assert.ok(pesquisa.paginasLidas.some(p => p.status === 'lida'), 'forcarPesquisa=true deve ler ao menos uma pagina quando ha resultado');
}

async function main() {
  database.inicializarDB(dbTmp());
  try {
    await testarPedidosExplicitosQuandoInvestigacaoAberta();
    await testarPedidoExplicitoComPesquisaJaExecutada();
    await testarPedidoExplicitoNaoQuebraDeteccaoDeterministicaForte();
    await testarForcarPesquisaVenceSemanticaDesfavoravel();
    console.log(`etapa-v1-pesquisa-explicita.test.js: ok (${PEDIDOS_EXPLICITOS_PESQUISA.length} formulacoes + cenario E + regressao fast-path)`);
  } finally {
    database.fecharDB();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
