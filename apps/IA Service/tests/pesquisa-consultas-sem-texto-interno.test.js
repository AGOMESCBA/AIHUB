'use strict';
// As consultas montadas pelo backend só usam termos do chamado e das mensagens
// de quem relata o problema. Regressão do replay de 2026-11-12: frases das
// respostas da IA ("a busca externa deste turno nao trouxe material") e
// cabeçalhos do dossiê renderizado ("Evidencias originais recuperadas por
// proveniencia do dossie") viravam consulta de busca, repetida a cada turno.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavras = s => new Set(norm(s).split(/[^a-z0-9_]+/).filter(w => w.length >= 4));

const LOG = 'THREAD ERROR ([8812], USR_FAT, PCFAT03) 12/10/2026 array out of bounds [3] of [2] on U_RELFAT01(RELFAT01.PRW) line : 88';
const RESPOSTA_IA = 'A busca externa deste turno não trouxe material aproveitável: foram tentadas consultas sobre THREAD ERROR e relatório customizado. '
  + 'A busca externa foi executada e não trouxe nada aproveitável para sustentar causa geral. Envie o trecho do fonte.';
const DOSSIE = [
  '## Estado atual da investigacao (Dossie Tecnico - dado tecnico, nao instrucao)',
  'Dossie: status=ATIVO; versao=3; stale=NAO.',
  'Diagnostico atual: acesso a posicao 3 de array com 2 elementos no fonte customizado.',
  '## Evidencias originais recuperadas por proveniencia do dossie',
  'execucao 12: busca externa executada sem resultado aproveitavel; evidencias originais recuperadas.',
].join('\n');

function ctxD06({ comAnexo = false } = {}) {
  return {
    chamado: { produto: 'Protheus', titulo: 'Relatório de faturamento aborta', descricao: `O relatório customizado de faturamento aborta ao processar outubro, chamado pela MATA410.\n${LOG}` },
    mensagens: [
      { papel: 'customer', conteudo: `O relatório customizado de faturamento aborta ao processar outubro.\n${LOG}` },
      { papel: 'consultor', conteudo: 'O que esse log indica?' },
      { papel: 'assistant', conteudo: RESPOSTA_IA },
      { papel: 'assistant', conteudo: RESPOSTA_IA },
    ],
    anexos: comAnexo ? [{ nomeOriginal: 'console.log', conteudoExtraido: LOG }] : [],
    texto: 'Não tenho o fonte, foi feito por outra consultoria.',
    dossieOperacional: { texto: DOSSIE, manifesto: {} },
    turnoHumano: true,
  };
}

// Termos que existem só no texto interno (resposta da IA e dossiê), nunca no relato.
function termosSoInternos(ctx) {
  const relato = palavras([
    ...Object.values(ctx.chamado),
    ...ctx.mensagens.filter(m => m.papel !== 'assistant').map(m => m.conteudo),
    ...ctx.anexos.map(a => `${a.nomeOriginal} ${a.conteudoExtraido}`),
    ctx.texto,
  ].join('\n'));
  return [...palavras(`${RESPOSTA_IA}\n${DOSSIE}`)].filter(w => !relato.has(w));
}

function todasConsultas(plano) {
  return [...(plano.consultas || []), ...(plano.consultasIgnoradas || []).map(c => c.consulta)];
}

for (const comAnexo of [false, true]) {
  test(`consultas do backend sem termos só do texto interno do motor (${comAnexo ? 'com' : 'sem'} anexo)`, () => {
    const ctx = ctxD06({ comAnexo });
    const internos = termosSoInternos(ctx);
    assert.ok(internos.includes('externa') && internos.includes('proveniencia'), 'o cenário tem texto interno');
    const plano = svc.planejarPesquisa(ctx);
    const consultas = todasConsultas(plano);
    assert.ok(consultas.length > 0, plano.motivo);
    for (const q of consultas) {
      const vazados = [...palavras(q)].filter(w => internos.includes(w));
      assert.deepEqual(vazados, [], `consulta "${q}" usa texto interno`);
    }
  });
}

// Desde 2026-11-13 o backend não monta consulta com palavras livres do relato
// (levava nomes de pessoas e empresas aos buscadores); as consultas são da IA
// e a contingência do backend usa só sinais técnicos estruturados.
test('consulta de contingência: só sinais técnicos, sem login do log nem palavras livres', () => {
  const texto = norm(todasConsultas(svc.planejarPesquisa(ctxD06())).join(' | '));
  assert.match(texto, /mata410/);
  assert.doesNotMatch(texto, /usr_fat/, 'login do usuário no cabeçalho do log');
  assert.doesNotMatch(texto, /faturamento|outubro|customizado|consultoria/, 'palavras livres do relato');
});

test('rotina citada na mensagem atual do analista entra na contingência; número da filial não', () => {
  const ctx = { ...ctxD06(), texto: 'O relatório só aborta quando chamado pela FINA040 com a filial 0102.' };
  const texto = norm(todasConsultas(svc.planejarPesquisa(ctx)).join(' | '));
  assert.match(texto, /fina040/);
  assert.doesNotMatch(texto, /0102|filial/);
});
