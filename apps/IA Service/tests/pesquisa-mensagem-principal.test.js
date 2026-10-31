'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const ctx = {
  chamado: { produto: 'Protheus', descricao: 'Erro na baixa MATA185 em EXISTBLOCK' },
  texto: 'Pesquise a mensagem do erro anexado.',
  textoPrints: 'Failed to load program EXEMPLO.PRW in file E:\\build\\localenv.cpp at line 884\non EXISTBLOCK(APLIB190.PRW) line : 484',
};
const artigos = [
  { titulo: 'Protheus - There is a source name conflict on EXISTBLOCK(APLIB190.PRW)', url: 'https://tdn.totvs.com/conflict', trecho: 'Configure IXBLOG para conflito de nomes.' },
  { titulo: 'Protheus - Erro failed to load program', url: 'https://tdn.totvs.com/load', trecho: 'Falha ao carregar programa compilado.' },
];

test('linha do fonte não é HTTP; códigos explícitos continuam reconhecidos', () => {
  assert.deepEqual(svc._extrairSinaisTecnicos(ctx).http, []);
  assert.deepEqual(svc._extrairSinaisTecnicos({ texto: 'HTTP/1.1 403 e HTTP: 401; status code: 500; fonte linha 484' }).http, ['403', '401', '500']);
});

test('mensagem principal vence função compartilhada da pilha no ranking', () => {
  const plano = { sinaisTecnicos: svc._extrairSinaisTecnicos(ctx) };
  const r = svc._rankearResultados(artigos, plano);
  assert.equal(r[0].url, artigos[1].url);
  assert.ok(r[1].rankingScore < 0);
});

test('hipótese de erro na resposta anterior da IA não vira assinatura observada', () => {
  const sinais = svc._extrairSinaisTecnicos({ ...ctx, mensagens: [{ papel: 'assistant', conteudo: 'There is a source name conflict' }] });
  assert.deepEqual(sinais.assinaturasErro, ['failed to load program']);
});

test('assinaturas funcionam para outros erros sem depender de rotina do chamado', () => {
  const sinais = svc._extrairSinaisTecnicos({ texto: 'variable does not exist na rotina TESTE' });
  const r = svc._rankearResultados([
    { titulo: 'Type mismatch', url: 'https://tdn.totvs.com/a' },
    { titulo: 'Variable does not exist', url: 'https://tdn.totvs.com/b' },
  ], { sinaisTecnicos: sinais });
  assert.equal(r[0].url, 'https://tdn.totvs.com/b');
});

test('busca prioriza erro literal e não abre artigo com outra mensagem mesmo se seletor falhar', async () => {
  let consultas, candidatos, abertas;
  const r = await svc.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: '', serperApiKey: 'fixture' },
    gerarConsultasIA: async () => ({ consultas: ['EXISTBLOCK APLIB190 MATA185'], consultaNatural: 'erro baixa almoxarifado protheus EXISTBLOCK' }),
    buscarSerper: async qs => { consultas = qs; return artigos; },
    selecionarArtigosIA: async args => { candidatos = args.candidatos; throw Error('timeout simulado'); },
    abrirResultados: async rs => { abertas = rs; return []; },
  });
  assert.equal(r.plano.devePesquisar, true);
  assert.equal(consultas[0], 'Protheus failed to load program');
  assert.deepEqual(candidatos.map(a => a.titulo), [artigos[1].titulo]);
  assert.deepEqual(abertas.map(a => a.url), [artigos[1].url]);
});

test('orientação de resposta não transforma leitura em causa confirmada nem força hipótese sem fonte', () => {
  const lida = svc.formatarContextoParaPrompt({ paginasLidas: [{ status: 'lida', titulo: 'Artigo', trecho: 'Texto' }] });
  assert.match(lida, /leitura e selecao nao confirmam aplicabilidade/);
  assert.match(lida, /peca o material especifico/);
  const vazia = svc.formatarContextoParaPrompt({ selecaoArtigos: { executada: true, indices: [] } });
  assert.match(vazia, /solicite o log, fonte ou dado especifico/);
  assert.doesNotMatch(vazia, /indicar a causa tipica mais provavel/);
});

test('artigo da mensagem literal é lido mesmo sem o nome da customização', async () => {
  let abertas;
  const r = await svc.pesquisar(ctx, {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: '', serperApiKey: 'fixture' },
    gerarConsultasIA: async () => ({ consultas: ['EXISTBLOCK APLIB190 MATA185'] }),
    buscarSerper: async () => artigos,
    selecionarArtigosIA: async () => ({ selecionados: [], motivo: 'não cita EXEMPLO.PRW' }),
    abrirResultados: async rs => { abertas = rs; return []; },
  });
  assert.deepEqual(abertas.map(a => a.url), [artigos[1].url]);
  assert.deepEqual(r.selecaoArtigos.indicesIA, []);
  assert.deepEqual(r.selecaoArtigos.indicesCorrespondenciaLiteral, [0]);
});
