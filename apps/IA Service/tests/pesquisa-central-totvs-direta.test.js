'use strict';
// Busca direta na Central TOTVS (API pública do Help Center), sem rede: busca injetada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const ctx = { chamado: { produto: 'Protheus', titulo: 'Aprovação de contrato não chega ao aprovador' }, mensagens: [{ conteudo: 'Ao incluir o contrato no SIGAGCT não gera alçada de aprovação e não libera medição.' }], texto: 'Revise o histórico e pesquise uma solução na documentação oficial para este chamado.' };
const searchConfig = { serperApiKey: 'fixture', provedorPrimario: 'serper', fallbackOrdem: '' };
const artigo = { titulo: 'SIGAGCT - Como habilitar controle de alçada na mudança de situação do contrato', url: 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/1-alcada', trecho: 'alçada', fonte: 'Central TOTVS', status: 'ENCONTRADA', oficial: true };

test('consulta da Central sai sem site:, sem produto e com no máximo 6 termos', () => {
  assert.equal(svc._consultaCentralTotvs('site:tdn.totvs.com TOTVS Protheus contrato alcada aprovacao medicao situacao revisao extra'), 'contrato alcada aprovacao medicao situacao revisao');
});

test('investigação Protheus consulta a Central direto e soma aos resultados do provider', async () => {
  let consultaRecebida = null;
  const r = await svc.pesquisar(ctx, {
    searchConfig,
    buscarSerper: async () => [{ titulo: 'Outro', url: 'https://exemplo.com/a', trecho: 'x', fonte: 'Serper/Google', status: 'ENCONTRADA', oficial: false }],
    buscarCentralTotvs: async (q) => { consultaRecebida = q; return [artigo]; },
    abrirResultados: async () => [],
    interpretarSemantico: async () => null,
  });
  assert.ok(consultaRecebida);
  assert.ok(r.tentativasBusca.some(t => t.provider === 'Central TOTVS' && t.status === 'ok'));
  assert.ok(r.resultados.some(x => x.url === artigo.url));
  assert.ok(r.resultados.some(x => x.url === 'https://exemplo.com/a'));
});

test('falha da Central não derruba a pesquisa', async () => {
  const r = await svc.pesquisar(ctx, {
    searchConfig,
    buscarSerper: async () => [],
    buscarCentralTotvs: async () => { throw new Error('timeout'); },
    abrirResultados: async () => [],
    interpretarSemantico: async () => null,
  });
  assert.ok(r.tentativasBusca.some(t => t.provider === 'Central TOTVS' && t.status === 'erro'));
});
