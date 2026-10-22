'use strict';
// Regressão dos 4 achados da auditoria do motor de pesquisa (Codex, 2026-10):
// filtro por título+trecho, recorte por concentração de sinais, ranking sem a
// consulta e fim da sequência de provedores em resposta válida vazia.
// Sem rede: provedores e leitura simulados.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const consultas = ['SIGAGCT alçada aprovação contratos'];

test('1. filtro: trecho que descreve o problema mantém o artigo; só módulo/produto não basta', () => {
  const c = [
    { titulo: 'SIGAGCT - Dúvidas frequentes', trecho: 'Como habilitar o controle de alçada na aprovação do contrato.', url: 'https://c/1' },
    { titulo: 'SIGAGCT - Novidades', trecho: 'TOTVS Protheus SIGAGCT release 12.1.2410.', url: 'https://c/2' },
    { titulo: 'SIGAGCT - Relatórios', trecho: '', url: 'https://c/3' },
  ];
  assert.deepEqual(svc._filtrarCandidatos(c, consultas).map(x => x.url), ['https://c/1']);
});

test('2. recorte: menção genérica a "Protheus" no início não vence a solução adiante', () => {
  const inicio = 'TOTVS Protheus. ' + 'Introdução sem relação com o assunto. '.repeat(200);
  const solucao = 'Para habilitar a alçada na aprovação do contrato, configure o parâmetro MV_CNALCRV = .T. e informe o grupo de aprovação.';
  const texto = inicio + solucao + ' Fim do artigo. '.repeat(50);
  const plano = { sinaisTecnicos: { produtos: ['Protheus'] }, consultasIA: { consultas } };
  const r = svc._selecionarTrechoRelevante(texto, plano);
  assert.match(r.trecho, /MV_CNALCRV/);
  assert.ok(r.omitido > 0, 'registro do conteúdo omitido preservado');
  assert.ok(r.trecho.length <= 2200 + 60, 'orçamento preservado');
});

test('2. recorte: sem sinal específico, mantém o comportamento anterior (início/fim)', () => {
  const texto = 'Texto qualquer sem termos do problema. '.repeat(200);
  const r = svc._selecionarTrechoRelevante(texto, { sinaisTecnicos: {}, consultasIA: { consultas } });
  assert.equal(r.motivo, 'sem sinal tecnico localizado; preservado inicio/fim');
});

test('3. ranking: a consulta associada não altera a pontuação do artigo', () => {
  const plano = { sinaisTecnicos: { rotinas: ['CNTA300'], erros: ['CNTA100MIN'] } };
  const artigo = { titulo: 'SIGAGCT - Medições', trecho: 'Configuração de medições.', url: 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/1' };
  const a = svc._rankearResultados([{ ...artigo, consulta: 'medicoes' }], plano)[0];
  const b = svc._rankearResultados([{ ...artigo, consulta: 'CNTA300 CNTA100MIN medicoes' }], plano)[0];
  assert.equal(a.rankingScore, b.rankingScore);
  assert.equal(b.consulta, 'CNTA300 CNTA100MIN medicoes', 'consulta preservada para rastreabilidade');
  const comSinal = svc._rankearResultados([{ ...artigo, trecho: 'Erro CNTA100MIN na rotina CNTA300.' }], plano)[0];
  assert.ok(comSinal.rankingScore > a.rankingScore, 'sinal no conteúdo do artigo continua pontuando');
});

const ctx = { chamado: { produto: 'Protheus', titulo: 'Aprovação de contratos' }, mensagens: [{ conteudo: 'Contrato no SIGAGCT não gera alçada de aprovação.' }], texto: 'Pesquise uma solução na documentação oficial para este chamado.' };
const config = { provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', serperApiKey: 'fixture', geminiApiKey: 'fixture', openaiApiKey: null };
const comum = { searchConfig: config, interpretarSemantico: async () => null, abrirResultados: async () => [] };

test('4. resposta válida vazia encerra a sequência; a Central ainda complementa', async () => {
  let gemini = 0, central = 0;
  const r = await svc.pesquisar(ctx, { ...comum,
    buscarSerper: async () => [],
    buscarGemini: async () => { gemini += 1; return [{ titulo: 'x', url: 'https://x' }]; },
    buscarCentralTotvs: async () => { central += 1; return []; },
  });
  assert.equal(gemini, 0, 'Gemini não é chamado após resposta válida vazia');
  assert.equal(central, 1);
  assert.ok(r.tentativasBusca.some(t => t.provider === 'Serper/Google' && t.status === 'sem_resultado'));
});

test('4. falha operacional avança; ausência de credencial e erro ficam distintos na auditoria', async () => {
  let gemini = 0;
  const r = await svc.pesquisar(ctx, { ...comum,
    buscarSerper: async () => { throw new Error('timeout'); },
    buscarGemini: async () => { gemini += 1; return [{ titulo: 'SIGAGCT alçada', url: 'https://y', trecho: 'alçada' }]; },
  });
  assert.equal(gemini, 1, 'erro do Serper avança para o Gemini');
  const status = Object.fromEntries(r.tentativasBusca.map(t => [t.provider, t.status]));
  assert.equal(status['Serper/Google'], 'erro');
  assert.equal(status.Gemini || Object.values(status).find(s => s === 'ok'), 'ok');
  assert.ok(!r.tentativasBusca.some(t => /openai/i.test(t.provider)), 'OpenAI não é chamado depois de um resultado');
  const semChave = await svc.pesquisar(ctx, { ...comum, searchConfig: { ...config, serperApiKey: null },
    buscarGemini: async () => [{ titulo: 'z', url: 'https://z' }] });
  assert.ok(semChave.tentativasBusca.some(t => t.status === 'sem_chave'));
});

test('mesmo artigo por Google e Central (codificação diferente) tem a mesma chave e é deduplicado', async () => {
  const a = 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/360056366494-Alterar-data-de-vencimento-no-Or%C3%A7amento';
  const b = 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/360056366494-alterar-data-de-vencimento-no-or%c3%a7amento';
  assert.equal(svc._chaveUrl(a), svc._chaveUrl(b));
  assert.equal(svc._dedupPorUrl([{ url: a }, { url: b }, { url: 'https://tdn.totvs.com/x?y=1' }, { url: 'https://tdn.totvs.com/x' }]).length, 2);
});
