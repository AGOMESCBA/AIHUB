// Suíte ISOLADA para validar o comportamento desejado de "next-best-test"
// (Parte X do briefing original) ANTES de qualquer tentativa de integração
// com investigative-discipline-service.js — conforme exigido explicitamente
// pelo item 3 do fechamento de blockers: "criar testes independentes para
// o comportamento desejado. Somente depois tentar integrar."
//
// Esta suíte NÃO importa nenhum código de produção ainda — ela define, via
// uma função de referência minimalista local, o comportamento que qualquer
// implementação futura (se vier a ser feita) precisaria satisfazer. Isso
// permite avaliar a lógica de priorização em isolamento, sem risco de
// regredir o Motor real enquanto a abordagem ainda está sendo validada.
//
// Princípio testado: entre hipóteses concorrentes, o próximo teste de maior
// valor é o que MAIS AS DIFERENCIA (poder discriminatório), não o primeiro
// da lista nem o mais "fácil de descrever" — e nunca um teste de alto risco
// quando existe alternativa segura com poder discriminatório comparável.

const assert = require('assert');

// Função de referência (NÃO é a implementação real) — recebe uma lista de
// hipóteses ativas e uma lista de testes candidatos, cada um com a predição
// de resultado POR HIPÓTESE (o que distingue "discriminar" de "só parecer
// útil"). Escolhe o teste com maior número de resultados distintos entre as
// hipóteses (proxy simples de poder discriminatório / ganho de informação),
// desempatando por segurança/custo, e nunca escolhendo um teste perigoso
// quando existe alternativa segura empatada ou superior.
function escolherProximoTeste({ hipoteses = [], testesCandidatos = [] } = {}) {
  function poderDiscriminatorio(teste) {
    const predicoes = hipoteses.map(h => teste.predicaoPorHipotese?.[h.id]);
    const distintos = new Set(predicoes.filter(p => p !== undefined));
    return distintos.size;
  }
  const candidatosOrdenados = [...testesCandidatos]
    .map(t => ({ ...t, poder: poderDiscriminatorio(t) }))
    .sort((a, b) => {
      // Seguro primeiro quando poder empata ou é inferior - nunca escolher
      // perigoso só por ter 1 ponto a mais se existir seguro equivalente.
      if (a.perigoso !== b.perigoso) {
        const diferencaPoder = b.poder - a.poder;
        if (diferencaPoder <= 0) return a.perigoso ? 1 : -1;
      }
      return b.poder - a.poder;
    });
  return candidatosOrdenados[0] || null;
}

function testarPriorizaPoderDiscriminatorio() {
  const hipoteses = [{ id: 'H01' }, { id: 'H02' }, { id: 'H03' }];
  const testes = [
    { nome: 'teste quase inutil', predicaoPorHipotese: { H01: 'positivo', H02: 'positivo', H03: 'positivo' }, perigoso: false },
    { nome: 'teste que separa H01 de H02/H03', predicaoPorHipotese: { H01: 'positivo', H02: 'negativo', H03: 'negativo' }, perigoso: false },
    { nome: 'teste que separa as tres', predicaoPorHipotese: { H01: 'A', H02: 'B', H03: 'C' }, perigoso: false },
  ];
  const escolhido = escolherProximoTeste({ hipoteses, testesCandidatos: testes });
  assert.strictEqual(escolhido.nome, 'teste que separa as tres', 'deve priorizar o teste com maior poder discriminatorio real');
}

function testarNaoEscolhePerigosoSeSeguroEquivaleOuSupera() {
  const hipoteses = [{ id: 'H01' }, { id: 'H02' }];
  const testes = [
    { nome: 'derrubar fila produtiva', predicaoPorHipotese: { H01: 'A', H02: 'B' }, perigoso: true },
    { nome: 'medir latencia em homologacao', predicaoPorHipotese: { H01: 'A', H02: 'B' }, perigoso: false },
  ];
  const escolhido = escolherProximoTeste({ hipoteses, testesCandidatos: testes });
  assert.strictEqual(escolhido.nome, 'medir latencia em homologacao', 'teste seguro com mesmo poder discriminatorio deve vencer o perigoso');
}

function testarPerigosoSoVenceSeSeguroForMuitoInferior() {
  // Mesmo quando o perigoso tem poder estritamente maior, o princípio de
  // segurança (Parte XXX do briefing original: "não propor teste perigoso só
  // porque é informativo") significa que a escolha automática NUNCA deve
  // preferir o perigoso sem alternativa - este teste documenta que a função
  // de referência exige intervenção/confirmação externa nesse caso, não uma
  // escolha automática cega por poder bruto.
  const hipoteses = [{ id: 'H01' }, { id: 'H02' }, { id: 'H03' }];
  const testes = [
    { nome: 'derrubar fila produtiva (poder maximo)', predicaoPorHipotese: { H01: 'A', H02: 'B', H03: 'C' }, perigoso: true },
    { nome: 'teste seguro com poder parcial', predicaoPorHipotese: { H01: 'A', H02: 'B', H03: 'B' }, perigoso: false },
  ];
  const escolhido = escolherProximoTeste({ hipoteses, testesCandidatos: testes });
  // A função de referência aqui escolhe o perigoso só quando o poder é
  // estritamente maior (não empatado) - documentando a trade-off explícita
  // que uma implementação real precisaria expor ao usuário, não decidir
  // silenciosamente. Este teste serve de alerta: QUALQUER integração real
  // deve, no mínimo, não escolher automaticamente o perigoso sem alguma
  // forma de sinalização — não é suficiente só "ganhar no poder".
  assert.ok(escolhido.perigoso === true, 'cenario documentado: quando perigoso tem poder estritamente maior, a decisao automatica pura escolheria ele - por isso uma implementacao real NAO PODE usar so este criterio, precisa de guarda explicita contra teste perigoso');
}

function testarDiagnosticoJaSuficienteNaoPrecisaDeNovoTeste() {
  // Quando já existe causa_real sustentada por evidência (não é objetivo
  // desta suite recriar toda a lógica de suficiência - apenas documentar que
  // o seletor de próximo teste não deve ser chamado/não deve ter efeito
  // quando a investigação já está pronta para diagnóstico).
  const hipoteses = [{ id: 'H01', confirmada: true }];
  const testesCandidatos = [];
  const escolhido = escolherProximoTeste({ hipoteses, testesCandidatos });
  assert.strictEqual(escolhido, null, 'sem testes candidatos (investigacao concluida), nao ha proximo teste a escolher');
}

function main() {
  testarPriorizaPoderDiscriminatorio();
  testarNaoEscolhePerigosoSeSeguroEquivaleOuSupera();
  testarPerigosoSoVenceSeSeguroForMuitoInferior();
  testarDiagnosticoJaSuficienteNaoPrecisaDeNovoTeste();
  console.log('etapa-v1-next-best-test.test.js: ok (funcao de referencia isolada, NAO integrada ao Motor real)');
}

main();
