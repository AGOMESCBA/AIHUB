// Fase 2 - respostas objetivas, dinamicas e orientadas a resolucao.
// Executar: node "apps/IA Service/tests/fase2-respostas-objetivas.test.js"

const assert = require('assert');

const respostaOperacional = require('../backend/services/resposta-operacional-service');
const qualityGate = require('../backend/services/quality-gate-service');

function ficha(base = {}) {
  return respostaOperacional.construirFichaOperacional({
    diagnostico: base.diagnostico,
    nivelConfianca: base.nivelConfianca,
    conteudo: base.conteudo || '',
    fontesCorrigidos: base.fontesCorrigidos || [],
    avisosFonteCorrigido: base.avisosFonteCorrigido || [],
  });
}

function codigos(gate) {
  return new Set((gate.falhas || []).map(f => f.codigo));
}

function manifestoComEvidencia(extra = {}) {
  return {
    selecionados: [{
      id: 'log-1',
      tipo: 'anexo',
      nome: 'erro.log',
      status: 'ANALISADA',
      trecho: '2026-10-08 ERROR array out of bounds na rotina ROTINA.PRW linha 42',
    }],
    omitidos: [],
    ...extra,
  };
}

async function main() {
  const causaConfirmada = ficha({
    nivelConfianca: 'causa confirmada',
    diagnostico: {
      'Diagnóstico': 'Causa confirmada: acesso a indice inexistente no array aItens.',
      'Evidências': 'erro.log mostra array out of bounds na linha 42 e o fonte anexo usa aItens[nPos] sem validar.',
      'Correção proposta': 'Aplicar validacao de indice antes de acessar aItens[nPos].',
      'Validação': 'Compilar em homologacao e repetir a operacao que gerou o log.',
    },
  });
  assert.equal(causaConfirmada.tipo, 'causa_confirmada', 'deve diferenciar causa confirmada');
  assert.equal(causaConfirmada.rotuloDiagnostico, 'Diagnóstico');
  assert.ok(causaConfirmada.acaoRecomendada.includes('validacao de indice'));
  assert.ok(causaConfirmada.validacao.includes('homologacao'));

  const hipotese = ficha({
    nivelConfianca: 'hipótese provável',
    diagnostico: {
      'Diagnóstico': 'Possivel acesso a posicao inexistente de array na rotina ADVPL.',
      'Evidências': 'O log aponta array out of bounds, mas falta reproduzir com o mesmo cadastro.',
      'Correção proposta': 'Aplicar a validacao de indice proposta no fonte corrigido.',
      'Validação': 'Compilar no ambiente de homologacao e reproduzir a operacao.',
    },
  });
  assert.equal(hipotese.tipo, 'hipotese_principal', 'deve rotular hipotese tecnica sem vender certeza');
  assert.equal(hipotese.rotuloDiagnostico, 'Hipótese técnica');

  const insuficiente = ficha({
    nivelConfianca: 'evidência insuficiente',
    diagnostico: {
      'Diagnóstico': 'Ainda nao ha dados suficientes para fechar a causa.',
      'Evidências': 'Mensagem nao trouxe log, fonte ou print do erro.',
      'Validação': 'Enviar log completo e fonte relacionado antes de aplicar ajuste.',
    },
  });
  assert.equal(insuficiente.tipo, 'evidencia_insuficiente', 'deve tratar evidencia insuficiente como estado proprio');
  assert.ok(insuficiente.proximoPasso || insuficiente.acaoRecomendada, 'deve deixar proximo passo claro');

  const comFonte = ficha({
    nivelConfianca: 'hipótese provável',
    fontesCorrigidos: [{ id: 10, nomeOriginal: 'ROTINA_CORRIGIDA.PRW' }],
    diagnostico: {
      'Diagnóstico': 'Hipotese sustentada pelo fonte anexado.',
      'Correção proposta': 'Usar o fonte corrigido gerado.',
      'Fonte corrigido': '```advpl\nUser Function ROTINA()\nReturn\n```',
      'Validação': 'Compilar e executar o mesmo fluxo.',
    },
  });
  assert.equal(comFonte.possuiArquivoCorrigido, true, 'deve sinalizar card de fonte corrigido');
  assert.ok(comFonte.detalhes.some(d => d.titulo === 'Fonte corrigido'), 'detalhes devem preservar fonte corrigido completo');

  const fallback = ficha({
    conteudo: 'Resposta antiga sem secoes estruturadas, mas com orientacao textual preservada.',
  });
  assert.equal(fallback.tipo, 'sem_estrutura', 'resposta antiga sem secoes deve continuar suportada');
  assert.ok(fallback.detalhes.some(d => d.titulo === 'Resposta original'), 'fallback deve preservar conteudo original');

  const anexada = respostaOperacional.anexarFichaOperacional({
    id: 777,
    papel: 'assistant',
    conteudo: 'Texto',
    diagnostico: { 'Diagnóstico': 'Hipotese provável de falha no VALID.' },
    nivelConfianca: 'hipótese provável',
  });
  assert.equal(anexada.id, 777, 'anexar ficha nao deve alterar identidade da mensagem');
  assert.ok(anexada.respostaOperacional?.temEstrutura, 'rota deve conseguir anexar ficha em mensagens antigas');

  const gateCerteza = qualityGate.avaliarResposta({
    textoResposta: 'Causa confirmada: o erro e definitivamente do array.',
    manifesto: manifestoComEvidencia(),
  });
  assert.ok(codigos(gateCerteza).has('CERTAINTY_WITHOUT_EVIDENCE'), 'deve barrar certeza sem evidencia explicita');

  const gateValidacao = qualityGate.avaliarResposta({
    textoResposta: 'Ajuste a rotina e aplique a correcao no fonte ADVPL.',
    manifesto: manifestoComEvidencia(),
  });
  assert.ok(codigos(gateValidacao).has('CORRECTION_WITHOUT_VALIDATION'), 'deve barrar correcao sem validacao');

  const gateAcao = qualityGate.avaliarResposta({
    textoResposta: 'A evidencia do log mostra array out of bounds na rotina ROTINA.PRW.',
    manifesto: manifestoComEvidencia(),
  });
  assert.ok(codigos(gateAcao).has('EVIDENCE_WITHOUT_NEXT_ACTION'), 'deve barrar evidencia sem proximo passo');

  const gateRegressao = qualityGate.avaliarResposta({
    textoResposta: 'Aplicar novamente a solucao de reinicializar o array aItens no fonte.',
    manifesto: manifestoComEvidencia({
      dossie: {
        regressaoGuard: {
          solucoesFalhas: [{ codigo: 'SOL-001', descricao: 'reinicializar o array aItens' }],
        },
      },
    }),
  });
  assert.ok(codigos(gateRegressao).has('REGRESSAO_INVESTIGATIVA_SOLUCAO_FALHA'), 'deve impedir repetir solucao ja falha sem nova evidencia');

  const novoLog = ficha({
    nivelConfianca: 'hipótese provável',
    diagnostico: {
      'Diagnóstico': 'Novo log muda a prioridade para a rotina U_ROTINA.',
      'Evidências': 'erro-novo.log mostra a stack U_ROTINA -> FWFORM.',
      'Correção proposta': 'Corrigir primeiro a validacao em U_ROTINA.',
      'Validação': 'Executar o fluxo com o mesmo usuario do novo log.',
    },
  });
  assert.ok(novoLog.evidencia.includes('erro-novo.log'), 'deve exibir evidencia nova na ficha curta');

  assert.ok(causaConfirmada.detalhes.length >= 4, 'detalhes devem manter analise completa expandivel');
  assert.ok(!Object.keys(comFonte).some(k => /resolveu|naoResolveu|feedback/i.test(k)), 'Fase 2 nao deve introduzir controles de confirmacao da Fase 3');

  console.log('fase2-respostas-objetivas.test.js OK');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
