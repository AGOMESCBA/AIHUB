'use strict';
// Ciclo investigativo conduzido pela IA (2026-11-13): depois de uma rodada de
// pesquisa, a IA avalia as fontes e decide aprofundar (com consultas que ela
// escreve), responder ou pedir evidência do ambiente; o backend executa e
// limita. Sem rede e sem IA: busca, leitura e decisões simuladas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const ctx = () => ({
  chamado: { produto: 'Protheus', titulo: 'Pedido não libera crédito', descricao: 'Ao liberar o pedido na MATA440 aparece "Bloqueio de crédito por risco" para clientes com limite disponível.' },
  mensagens: [{ papel: 'customer', conteudo: 'Ao liberar o pedido na MATA440 aparece "Bloqueio de crédito por risco" para clientes com limite disponível.' }],
  texto: 'Pesquise por que o crédito bloqueia mesmo com limite.',
});

// A primeira fonte cita uma causa alternativa (parâmetro MV_BLQCRED) que só
// uma segunda pesquisa, com esse termo, encontra.
const FONTE_A = { titulo: 'MATA440 - Bloqueio de crédito por risco', url: 'https://tdn.totvs.com/credito-risco', fonte: 'TDN', oficial: true, trecho: 'O bloqueio por risco considera o risco do cliente (A1_RISCO). Quando o cliente tem risco E, o bloqueio ocorre mesmo com limite; ver tambem o parametro MV_BLQCRED.' };
const FONTE_B = { titulo: 'MV_BLQCRED - Bloqueio de credito na liberacao', url: 'https://tdn.totvs.com/mv-blqcred', fonte: 'TDN', oficial: true, trecho: 'MV_BLQCRED define se a liberacao bloqueia por titulos em atraso, independente do limite.' };

function ambiente(decisoes) {
  const buscas = []; const avaliacoes = [];
  const opts = {
    searchConfig: { serperApiKey: 'fixture', provedorPrimario: 'serper', fallbackOrdem: '' },
    interpretarSemantico: async () => null,
    gerarConsultasIA: async () => ({ consultas: ['MATA440 bloqueio credito risco'] }),
    buscarSerper: async (qs) => { buscas.push(qs); return qs.some(q => /MV_BLQCRED/i.test(q)) ? [FONTE_B] : [FONTE_A]; },
    buscarCentralTotvs: async () => [],
    selecionarArtigosIA: async ({ candidatos }) => ({ selecionados: candidatos.map(c => c.i), motivo: 'trata do bloqueio' }),
    abrirResultados: async (lista) => lista.map(r => ({ ...r, status: 'lida' })),
    avaliarEvidenciasIA: async (entrada) => { avaliacoes.push(entrada); return decisoes[avaliacoes.length - 1] || { decisao: 'responder' }; },
  };
  return { opts, buscas, avaliacoes };
}

async function investigar(decisoes, extraCtx = {}) {
  const amb = ambiente(decisoes);
  const c = { ...ctx(), ...extraCtx };
  const primeira = await svc.pesquisar(c, amb.opts);
  const final = await svc.aprofundarPesquisa(c, primeira, amb.opts);
  return { ...amb, primeira, final };
}

test('a IA lê a primeira fonte, decide aprofundar com a consulta que escreveu e responde depois', async () => {
  const { final, buscas, avaliacoes } = await investigar([
    { decisao: 'aprofundar', consultas: ['MV_BLQCRED liberacao pedido'], objetivoNovaPesquisa: 'confirmar o parametro citado na fonte',
      avaliacaoFontes: [{ url: FONTE_A.url, aplicavel: 'parcial', motivo: 'explica o risco, mas cita outro parametro' }],
      hipoteses: [{ descricao: 'cliente com risco E', situacao: 'nova' }, { descricao: 'MV_BLQCRED bloqueando por atraso', situacao: 'nova' }], justificativa: 'a fonte cita MV_BLQCRED' },
    { decisao: 'responder', avaliacaoFontes: [{ url: FONTE_A.url, aplicavel: 'sim' }, { url: FONTE_B.url, aplicavel: 'sim', motivo: 'explica o bloqueio por atraso' }],
      hipoteses: [{ descricao: 'MV_BLQCRED bloqueando por atraso', situacao: 'reforcada' }], justificativa: 'duas causas documentadas para conferir' },
  ]);
  assert.equal(buscas.length, 2, 'duas pesquisas no mesmo turno');
  assert.ok(buscas[1].some(q => q.includes('MV_BLQCRED')), 'a segunda usa a consulta escrita pela IA');
  assert.ok(!buscas[1].some(q => /MATA440 bloqueio credito risco/.test(q)), 'a segunda não repete a primeira');
  assert.equal(avaliacoes.length, 2);
  assert.deepEqual(avaliacoes[0].fontesLidas.map(f => f.url), [FONTE_A.url], 'a IA avalia o que foi lido');
  assert.deepEqual(avaliacoes[1].fontesLidas.map(f => f.url), [FONTE_A.url, FONTE_B.url], 'a reavaliação vê as fontes acumuladas');
  assert.deepEqual(avaliacoes[0].rodadasAnteriores, []);
  assert.deepEqual(avaliacoes[1].rodadasAnteriores, [{ rodada: 1, consultas: ['MV_BLQCRED liberacao pedido'], objetivo: 'confirmar o parametro citado na fonte', fontesNovasEncontradas: 1 }], 'a IA sabe o que o aprofundamento trouxe');
  assert.deepEqual(final.paginasLidas.map(p => p.url), [FONTE_A.url, FONTE_B.url]);
  assert.deepEqual(final.ciclo.map(a => a.decisao), ['aprofundar', 'responder']);
  assert.deepEqual(final.ciclo[0].resultadoRodada.paginasNovas, [FONTE_B.url]);
  const texto = svc.formatarContextoParaPrompt(final);
  assert.match(texto, /Investigacao conduzida neste turno/);
  assert.match(texto, /mv-blqcred: aplicavel=sim/);
  assert.match(texto, /hipotese \(reforcada\): MV_BLQCRED/);
});

test('falta de evidência do ambiente encerra o ciclo e a informação necessária chega à resposta', async () => {
  const { final, buscas } = await investigar([{ decisao: 'falta_evidencia_do_ambiente', informacaoNecessaria: 'valor de A1_RISCO do cliente e de MV_BLQCRED', justificativa: 'as fontes apontam duas causas' }]);
  assert.equal(buscas.length, 1);
  assert.equal(final.ciclo[0].decisao, 'falta_evidencia_do_ambiente');
  assert.match(svc.formatarContextoParaPrompt(final), /informacao necessaria para avancar: valor de A1_RISCO/);
});

test('o backend limita as rodadas: IA que sempre aprofunda para no limite', async () => {
  const sempre = q => ({ decisao: 'aprofundar', consultas: [q], objetivoNovaPesquisa: 'mais' });
  const { final, buscas } = await investigar([sempre('MV_BLQCRED liberacao pedido'), sempre('A1_RISCO cliente risco classificacao'), sempre('MATA450 analise credito manual'), sempre('SC9 liberacao estoque credito')]);
  assert.equal(buscas.length, 1 + svc.MAX_RODADAS_APROFUNDAMENTO);
  assert.equal(final.ciclo.at(-1).limiteAtingido, true);
});

test('consulta equivalente à já executada não vira nova pesquisa', async () => {
  const { final, buscas } = await investigar([{ decisao: 'aprofundar', consultas: ['MATA440 bloqueio credito risco'] }]);
  assert.equal(buscas.length, 1);
  assert.equal(final.ciclo[0].decisaoIA, 'aprofundar');
  assert.equal(final.ciclo[0].decisao, 'responder');
});

test('avaliação indisponível não bloqueia o turno nem aprofunda', async () => {
  const amb = ambiente([]);
  amb.opts.avaliarEvidenciasIA = async () => { throw new Error('timeout'); };
  const primeira = await svc.pesquisar(ctx(), amb.opts);
  const final = await svc.aprofundarPesquisa(ctx(), primeira, amb.opts);
  assert.equal(amb.buscas.length, 1);
  assert.equal(final.ciclo[0].executada, false);
  assert.deepEqual(final.paginasLidas.map(p => p.url), [FONTE_A.url]);
});

test('sem pesquisa na primeira rodada ou sob pendência externa, não há ciclo', async () => {
  const amb = ambiente([{ decisao: 'aprofundar', consultas: ['MV_BLQCRED liberacao pedido'] }]);
  const naoPesquisou = { plano: { devePesquisar: false }, modo: 'nao_pesquisado' };
  assert.equal(await svc.aprofundarPesquisa(ctx(), naoPesquisou, amb.opts), naoPesquisou);
  const bloqueada = await svc.aprofundarPesquisa({ ...ctx(), pesquisaExternaBloqueada: { responsavel: 'cliente' } }, { plano: { devePesquisar: true }, modo: 'web' }, amb.opts);
  assert.equal(bloqueada.ciclo, undefined);
  assert.equal(amb.avaliacoes.length, 0);
});

test('fontes citadas pela IA que não foram lidas nem encontradas são descartadas da avaliação', async () => {
  const { final } = await investigar([{ decisao: 'responder', avaliacaoFontes: [{ url: 'https://inventada.example/x', aplicavel: 'sim' }, { url: FONTE_A.url, aplicavel: 'sim' }] }]);
  assert.deepEqual(final.ciclo[0].avaliacaoFontes.map(f => f.url), [FONTE_A.url]);
});

test('resultado encontrado mas não lido não é classificado como fonte aplicável', async () => {
  const r = await svc.avaliarEvidenciasPesquisa({ empresaId: 1 }, {
    paginasLidas: [{ url: 'https://fonte.example/lida', status: 'lida', trecho: 'Texto lido.' }, { url: 'https://fonte.example/vazia', status: 'lida', trecho: '' }],
    resultados: [{ url: 'https://fonte.example/nao-lida', titulo: 'Resultado', trecho: 'Resumo' }],
  }, { avaliarEvidenciasIA: async () => ({ decisao: 'responder', avaliacaoFontes: [
    { url: 'https://fonte.example/lida', aplicavel: 'sim' },
    { url: 'https://fonte.example/vazia', aplicavel: 'sim' },
    { url: 'https://fonte.example/nao-lida', aplicavel: 'sim' },
  ] }) });
  assert.deepEqual(r.avaliacaoFontes.map(f => f.url), ['https://fonte.example/lida']);
});
