'use strict';
// Andamento do turno para o chat (sem rede: busca e IA simuladas).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const progresso = require('../backend/services/progresso-turno-service');
const svc = require('../backend/services/technical-research-service');

test('registra etapas em ordem, conclui a anterior e limpa ao finalizar; isolado por empresa', () => {
  progresso.iniciar(1, 'a1');
  progresso.registrar(1, 'a1', 'Lendo o histórico');
  progresso.registrar(1, 'a1', 'Pesquisando');
  assert.deepEqual(progresso.obter(1, 'a1').etapas, [{ texto: 'Lendo o histórico', concluida: true }, { texto: 'Pesquisando', concluida: false }]);
  assert.deepEqual(progresso.obter(2, 'a1').etapas, [], 'outra empresa não vê');
  progresso.registrar(3, 'sem-inicio', 'ignorado');
  assert.deepEqual(progresso.obter(3, 'sem-inicio').etapas, []);
  progresso.finalizar(1, 'a1');
  assert.deepEqual(progresso.obter(1, 'a1').etapas, []);
});

test('pesquisa reporta termos, resultados, seleção e leitura', async () => {
  const etapas = [];
  await svc.pesquisar({ chamado: { produto: 'Protheus', titulo: 'Aprovação de contratos' }, mensagens: [{ conteudo: 'Contrato não gera alçada de aprovação.' }], texto: 'Pesquise uma solução na documentação oficial para este chamado.' }, {
    searchConfig: { serperApiKey: 'fixture', provedorPrimario: 'serper', fallbackOrdem: '' },
    interpretarSemantico: async () => null,
    progresso: (t) => etapas.push(t),
    gerarConsultasIA: async () => ({ consultas: ['SIGAGCT alçada aprovação contratos'] }),
    buscarSerper: async () => [],
    buscarCentralTotvs: async () => [{ titulo: 'SIGAGCT - Alçada na mudança de situação', url: 'https://c/1', trecho: 'x', fonte: 'Central TOTVS', oficial: true }],
    selecionarArtigosIA: async () => ({ selecionados: [0] }),
    abrirResultados: async () => [{ status: 'lida', url: 'https://c/1' }],
  });
  assert.deepEqual(etapas, [
    'Definindo os termos de busca a partir do problema',
    'Pesquisando: "SIGAGCT alçada aprovação contratos"',
    '1 resultado(s) encontrado(s) (1 da Central TOTVS)',
    '1 artigo(s) relevante(s) selecionado(s) para leitura',
    '1 artigo(s) lido(s)',
  ]);
});
