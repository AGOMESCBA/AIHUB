'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const mensagemErro = 'Failed to load program M185GRV.PRW on EXISTBLOCK(APLIB190.PRW) ao baixar requisição na MATA185.';
const inicial = () => ({
  chamado: { produto: 'Protheus', descricao: mensagemErro },
  mensagens: [{ papel: 'customer', conteudo: mensagemErro }],
  texto: '',
});

test('sem texto atual, usa erro técnico ainda não pesquisado do histórico', async () => {
  const plano = await svc.planejarPesquisaComSemantica(inicial());
  assert.equal(plano.devePesquisar, true, plano.motivo);
  assert.ok(plano.consultas.length > 0);
});

test('primeira análise automática pesquisa o erro do print antes de pedir evidência do ambiente', async () => {
  const plano = await svc.planejarPesquisaComSemantica({
    ...inicial(), texto: 'Faça uma pré-análise inicial com base no chamado e nos anexos.',
    textoPrints: mensagemErro, primeiraAnalise: true, disciplina4B: true,
  });
  assert.equal(plano.devePesquisar, true, plano.motivo);
  assert.ok(plano.sinaisTecnicos.erros.some(e => e.includes('Failed to load')));
});

test('pesquisa inicial chega à transcrição e à busca com provedores simulados', async () => {
  let transcricoes = 0, buscas = 0;
  const pesquisa = await svc.pesquisar({ ...inicial(), obterTextoPrints: async () => {
    transcricoes++; return mensagemErro;
  } }, {
    searchConfig: { serperApiKey: 'fixture', provedorPrimario: 'serper', fallbackOrdem: '' },
    gerarConsultasIA: async () => ({ consultas: ['Failed to load program M185GRV.PRW EXISTBLOCK'] }),
    buscarSerper: async () => { buscas++; return []; },
    abrirResultados: async () => [],
  });
  assert.equal(pesquisa.plano.devePesquisar, true, pesquisa.plano.motivo);
  assert.equal(transcricoes, 1);
  assert.equal(buscas, 1);
});

test('cortesia atual não repesquisa só porque há erro no histórico', async () => {
  const plano = await svc.planejarPesquisaComSemantica({ ...inicial(), texto: 'Obrigado' });
  assert.equal(plano.devePesquisar, false);
});

test('sem erro técnico concreto, produto sozinho não dispara pesquisa inicial', async () => {
  const plano = await svc.planejarPesquisaComSemantica({ chamado: { produto: 'Protheus' }, texto: '' });
  assert.equal(plano.devePesquisar, false);
});

test('resposta anterior não é tratada como investigação inicial sem mensagem nova', async () => {
  const ctx = inicial();
  ctx.mensagens.push({ papel: 'assistant', conteudo: 'Envie o fonte e o log para continuar.' });
  assert.equal((await svc.planejarPesquisaComSemantica(ctx)).devePesquisar, false);
});

test('memória de teste já realizado impede tratar o contexto como primeiro contato', async () => {
  const ctx = { ...inicial(), dossieOperacional: {
    texto: 'O teste de recompilação já foi realizado.',
    manifesto: { regressaoGuard: { testesExecutados: ['recompilação já realizada'] } },
  } };
  const plano = await svc.planejarPesquisaComSemantica(ctx);
  assert.equal(plano.devePesquisar, false);
});

test('pendência externa é respeitada antes de transcrever ou pesquisar', async () => {
  let chamadas = 0;
  const pesquisa = await svc.pesquisar({ ...inicial(),
    pesquisaExternaBloqueada: { responsavel: 'cliente', motivo: 'aguardando retorno' },
    obterTextoPrints: async () => { chamadas++; return mensagemErro; },
  }, {
    gerarConsultasIA: async () => { chamadas++; return { consultas: [] }; },
    buscarSerper: async () => { chamadas++; return []; },
  });
  assert.equal(pesquisa.plano.devePesquisar, false);
  assert.equal(chamadas, 0);
});
