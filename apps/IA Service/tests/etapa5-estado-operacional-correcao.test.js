// Estado operacional do Quadro Investigativo: correcao disponibilizada em
// homologacao vs validacao pendente vs implantacao em producao, e chamados
// citados no historico. Historico real do #036287 (nomes anonimizados) mais
// variacoes de linguagem e casos negativos (simples mencao nao e correcao).
//
// As regras deterministicas apenas APOIAM o modelo (o quadro e "heuristico;
// conferir contra o historico original"): o teste cobre sinais, nao a resposta.

const assert = require('assert');
const contextEngine = require('../backend/services/context-engine');

const montar = (textos, { pendencia = null, numero = '036287' } = {}) => {
  const mensagens = textos.map((t, i) => (typeof t === 'string'
    ? { papel: 'user', conteudo: t, criadoEm: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z` }
    : { criadoEm: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`, ...t }));
  return contextEngine._montarQuadroInvestigativo({
    atendimento: { conteudoBruto: 'contratos com saldo negativo', referenciaExterna: numero },
    mensagens,
    mensagemAtual: 'Revise todo o historico e pesquise uma solucao para este chamado.',
    selecionadosEfetivos: [],
    pesquisaSelecionada: null,
    pendenciaConsolidada: pendencia,
  });
};
const CLIENTE = { responsavel: 'cliente', bloqueante: false, textoOriginal: 'RETORNO - CLIENTE' };
const FORNECEDOR = { responsavel: 'fornecedor', bloqueante: true, textoOriginal: 'RETORNO - FORNECEDOR' };

// Historico real do #036287 (autores anonimizados).
const HISTORICO_036287 = [
  { papel: 'customer', conteudo: 'Abertura do chamado. Bom dia, a customização de contratos, esta permitindo os saldos ficarem negativos. Temos que colocar uma trava.' },
  { papel: 'user', conteudo: 'Bom dia, Vamos entender se colocar um positivo no campo ele vai travar não ocorrer, porque tem que entender junto ao cliente primeiro.' },
  { papel: 'user', conteudo: 'Podemos agendar uma cal, pra vc me explicar melhor, e problema na rotina e ou relatório ? somente o seu print não ficou muito claro. Me retorne no chamado um data e horário que envio o link da sala.' },
  { papel: 'customer', conteudo: 'Boa tarde, o analista A esta a par da situação.' },
  { papel: 'user', conteudo: 'Conforme alinhado, segue o chamado para encerramento, pois já esta sendo tratado no chamado 035988 - COABRA - Regra de saldo contrato, esse já esta com FSW aberta e sendo tratado pelo analista B.' },
  { papel: 'customer', conteudo: 'Favor deixar em aberto, pois é o primeiro que foi aberto.' },
  { papel: 'user', conteudo: 'Será aberto FSW, pois o analista B esta realizando a analise.' },
  { papel: 'user', conteudo: 'Bom dia, tudo bem? Referente ao chamado, gostaria de perguntar se vai ser finalizado 035988 e dado continuidade nesse, ou se podemos finalizar esse, É continuar no 035988 que já existe fabrica, O iniciador do chamado foi o: usuario C, valida com ele por gentileza ou retorna para gente aqui.' },
  { papel: 'user', conteudo: 'Foram realizados os ajustes e enviados ao usuário para a realização dos testes no ambiente HMG. Ficamos no aguardo da confirmação para prosseguir com o envio dos PATCHs, que serão aplicados em produção.' },
  { papel: 'user', conteudo: 'Retornando chamado para N1' },
  { papel: 'user', conteudo: 'Bom dia, Conforme retorno da fabrica, foram realizados os ajustes e enviados ao usuário para a realização dos testes no ambiente HMG. Ficamos no aguardo da confirmação para prosseguir com o envio dos PATCHs, que serão aplicados em produção. AMBIENTE: hmg_compila usuário C, já avisado para os testes.' },
];

function teste(nome, fn) {
  try { fn(); } catch (err) { err.message = `${nome}: ${err.message}`; throw err; }
}

// ── caso real ────────────────────────────────────────────────────────────────
teste('#036287 real: correcao em HMG, validacao pendente, nao "encaminhado a fabrica"', () => {
  const q = montar(HISTORICO_036287, { pendencia: CLIENTE });
  assert.strictEqual(q.estadoOperacional, 'correcao_aplicada_pendente_validacao');
  assert.strictEqual(q.ambienteCorrecao, 'homologacao');
  assert.ok(q.correcoesAplicadas.length >= 1);
  assert.ok(q.acoesParaReduzirIncerteza.some(a => /homologacao/i.test(a)), 'acao candidata cita homologacao');
  assert.ok(!q.acoesParaReduzirIncerteza.some(a => /Acompanhar o retorno da f/i.test(a)));
});

teste('#036287 real: sem a pendencia consolidada o estado continua correto (validacao pendente no texto)', () => {
  const q = montar(HISTORICO_036287, { pendencia: null });
  assert.strictEqual(q.estadoOperacional, 'correcao_aplicada_pendente_validacao');
  assert.strictEqual(q.ambienteCorrecao, 'homologacao');
});

teste('#036287 real: lacuna e quadro textual indicam homologacao, nao producao', () => {
  const q = montar(HISTORICO_036287, { pendencia: CLIENTE });
  assert.ok(q.lacunasInformacao.some(l => /validacao da correcao/i.test(l)));
  const txt = contextEngine._formatarQuadroInvestigativo
    ? contextEngine._formatarQuadroInvestigativo(q)
    : '';
  assert.ok(txt, 'formatador exportado');
  {
    assert.match(txt, /HOMOLOGACAO \(sem evidencia de implantacao em producao\)/);
    assert.match(txt, /#035988/);
  }
});

// ── chamados citados ────────────────────────────────────────────────────────
teste('chamados citados: #035988 aparece como referencia, o proprio chamado nao', () => {
  const q = montar(HISTORICO_036287, { pendencia: CLIENTE });
  const nums = q.chamadosCitados.map(c => c.numero);
  assert.deepStrictEqual(nums, ['035988']);
  assert.ok(q.chamadosCitados[0].mencoes >= 2);
  assert.match(q.chamadosCitados[0].origem, /^mensagem:\d+$/);
  assert.ok(q.chamadosCitados[0].trecho.length > 0 && q.chamadosCitados[0].trecho.length <= 180);
});

teste('chamados citados: formas "#035988", "chamado 35988", "FSW 036111" e sem falso positivo de data/telefone', () => {
  const q = montar([
    'Veja o #035988 e o chamado 36100.',
    'Aberta FSW 036111 para a fabrica. Contato 65 99948-1696, em 04/09/2026 as 14:00.',
    'CNPJ 12.345.678/0001-90 valor 1234,56',
  ]);
  assert.deepStrictEqual(q.chamadosCitados.map(c => c.numero).sort(), ['035988', '036100', '036111']);
});

teste('chamados citados: respostas da IA nao geram referencia; limite de 8; resolver injetado so enriquece', () => {
  const q = montar([{ papel: 'assistant', conteudo: 'Veja o chamado 040000.' }, 'Sem citacao aqui.']);
  assert.deepStrictEqual(q.chamadosCitados, []);
  const muitos = montar([Array.from({ length: 12 }, (_, i) => `chamado 0360${String(10 + i)}`).join(' ')]);
  assert.strictEqual(muitos.chamadosCitados.length, 8);
  const enriquecido = contextEngine._montarQuadroInvestigativo({
    atendimento: { conteudoBruto: 'x', referenciaExterna: '036287' },
    mensagens: [{ papel: 'user', conteudo: 'ver chamado 035988', criadoEm: null }],
    mensagemAtual: 'x', selecionadosEfetivos: [], pesquisaSelecionada: null, pendenciaConsolidada: null,
    resolverChamado: n => ({ titulo: 'Regra de saldo contrato', situacao: 'Andamento', aguardando: 'RETORNO - CLIENTE', numero: n }),
  });
  assert.strictEqual(enriquecido.chamadosCitados[0].titulo, 'Regra de saldo contrato');
  const falha = contextEngine._montarQuadroInvestigativo({
    atendimento: { conteudoBruto: 'x', referenciaExterna: '036287' },
    mensagens: [{ papel: 'user', conteudo: 'ver chamado 035988', criadoEm: null }],
    mensagemAtual: 'x', selecionadosEfetivos: [], pesquisaSelecionada: null, pendenciaConsolidada: null,
    resolverChamado: () => { throw new Error('boom'); },
  });
  assert.strictEqual(falha.chamadosCitados[0].numero, '035988'); // falha do resolvedor nao derruba o quadro
});

// ── variacoes de linguagem (positivos) ──────────────────────────────────────
const POSITIVOS_HMG = [
  'Os ajustes realizados foram enviados para homologação.',
  'As correções foram disponibilizadas no ambiente de homologação.',
  'Alterações enviadas para homologação, aguardando validação do cliente.',
  'Ajuste aplicado em HMG, aguardamos o teste do usuario.',
  'O patch foi liberado no ambiente hmg_compila para testes.',
  'Correção implantada em homologação.',
];
for (const frase of POSITIVOS_HMG) {
  teste(`positivo HMG: "${frase}"`, () => {
    const q = montar([frase], { pendencia: CLIENTE });
    assert.strictEqual(q.estadoOperacional, 'correcao_aplicada_pendente_validacao');
    assert.strictEqual(q.ambienteCorrecao, 'homologacao');
  });
}

teste('positivo: aguardando validacao do cliente + correcao => pendente validacao sem depender da pendencia consolidada', () => {
  const q = montar(['Os ajustes foram realizados.', 'Aguardando validação do cliente.']);
  assert.strictEqual(q.estadoOperacional, 'correcao_aplicada_pendente_validacao');
});

teste('positivo: correcao em PRODUCAO e distinguida de homologacao', () => {
  for (const frase of [
    'Os ajustes foram aplicados em produção ontem.',
    'A correção já está em produção.',
    'Patch implantado no ambiente de produção.',
  ]) {
    const q = montar([frase]);
    assert.strictEqual(q.ambienteCorrecao, 'producao', frase);
    assert.strictEqual(q.estadoOperacional, 'correcao_aplicada_sem_validacao_comprovada', frase);
  }
});

teste('positivo: homologacao primeiro e depois producao => ambiente final producao', () => {
  const q = montar([
    'Ajustes realizados e enviados para homologação.',
    'Cliente validou. Os ajustes foram aplicados em produção.',
  ]);
  assert.strictEqual(q.ambienteCorrecao, 'producao');
});

teste('positivo: fornecedor em retorno externo continua prioridade (estado bloqueante)', () => {
  const q = montar(['Os ajustes foram realizados.'], { pendencia: FORNECEDOR });
  assert.strictEqual(q.estadoOperacional, 'aguardando_retorno_externo');
});

// ── negativos ───────────────────────────────────────────────────────────────
const NEGATIVOS = [
  ['mencao a testes', 'Vamos realizar testes na homologação amanhã.'],
  ['mencao a homologacao', 'O ambiente de homologação esta fora do ar.'],
  ['ajuste solicitado', 'Precisamos de um ajuste na rotina de contratos.'],
  ['ajuste futuro', 'O ajuste será realizado na próxima semana.'],
  ['aplicacao futura em producao', 'As correções serão aplicadas em produção após a validação.'],
  ['negacao', 'O ajuste não foi aplicado em produção.'],
  ['pergunta', 'Os ajustes já foram realizados?'],
  ['aguardando envio', 'Aguardando envio do patch pela fábrica.'],
  ['teste realizado sem correcao', 'Foram realizados testes e o erro persiste.'],
];
for (const [rotulo, frase] of NEGATIVOS) {
  teste(`negativo (${rotulo}): "${frase}"`, () => {
    const q = montar([frase]);
    assert.strictEqual(q.correcoesAplicadas.length, 0, `nao pode registrar correcao aplicada (estado ${q.estadoOperacional})`);
    assert.ok(!/^correcao_aplicada/.test(q.estadoOperacional), q.estadoOperacional);
    assert.strictEqual(q.ambienteCorrecao, null);
  });
}

teste('negativo: mensagem da IA (assistant) nunca vira correcao aplicada', () => {
  const q = montar([{ papel: 'assistant', conteudo: 'Os ajustes foram realizados e enviados para homologação.' }]);
  assert.strictEqual(q.correcoesAplicadas.length, 0);
});

teste('negativo: "aplicados em producao" no futuro nao rebaixa a entrega em HMG para producao (caso real)', () => {
  const q = montar([HISTORICO_036287[8]], { pendencia: CLIENTE });
  assert.strictEqual(q.ambienteCorrecao, 'homologacao');
});

console.log('etapa5-estado-operacional-correcao.test.js: ok');
