'use strict';
// Fontes da pesquisa na resposta Técnica (bloco determinístico), leitura de
// artigo da Central TOTVS pela API JSON e contexto da pergunta curta.
// Sem rede e sem IA: safeFetch é simulado. Dados 100% sintéticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const safeFetch = require('../backend/services/safe-web-fetch-service');
const research = require('../backend/services/technical-research-service');
const investigacao = require('../backend/services/investigacao-service');
const { analisarPreservacao } = require('../backend/services/validacao-preservacao-service');

const ARTIGO = 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/1234567890-RH-Exemplo-sintetico';

test('URL de artigo da Central TOTVS vira a URL da API JSON; outras URLs não', () => {
  assert.equal(research._urlApiArtigoCentralTotvs(ARTIGO), 'https://centraldeatendimento.totvs.com/api/v2/help_center/pt-br/articles/1234567890.json');
  assert.equal(research._urlApiArtigoCentralTotvs('https://centraldeatendimento.totvs.com/hc/en-US/articles/42'), 'https://centraldeatendimento.totvs.com/api/v2/help_center/en-us/articles/42.json');
  for (const u of ['https://tdn.totvs.com/display/x', 'http://centraldeatendimento.totvs.com/hc/pt-br/articles/1', 'https://centraldeatendimento.totvs.com.evil.com/hc/pt-br/articles/1', 'https://centraldeatendimento.totvs.com/hc/pt-br/sections/1', '']) {
    assert.equal(research._urlApiArtigoCentralTotvs(u), null, u);
  }
});

test('artigo da Central TOTVS é lido pela API JSON, com o mesmo fetch seguro e só JSON aceito', async () => {
  const original = safeFetch.fetchTextoSeguro;
  const chamadas = [];
  safeFetch.fetchTextoSeguro = async (url, opts) => {
    chamadas.push({ url, opts });
    return { url, raw: JSON.stringify({ article: { title: 'Mensagem sintética de período fechado', html_url: ARTIGO, body: '<p>O parâmetro MV_EXEMPLO conta dias corridos após o fim do período.</p>' } }), bytes: 100, contentType: 'application/json', redirects: [] };
  };
  try {
    const r = await research._lerArtigoCentralTotvs(ARTIGO);
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0].url, /\/api\/v2\/help_center\/pt-br\/articles\/1234567890\.json$/);
    assert.deepEqual(chamadas[0].opts.contentTypes, ['application/json']);
    assert.match(r.raw, /Mensagem sintética de período fechado/);
    assert.match(r.raw, /MV_EXEMPLO conta dias corridos/);
    assert.equal(r.url, ARTIGO);
  } finally { safeFetch.fetchTextoSeguro = original; }
});

test('falha na API JSON (erro, JSON inválido, sem corpo) devolve null para seguir o caminho normal', async () => {
  const original = safeFetch.fetchTextoSeguro;
  try {
    for (const resposta of [() => { throw new Error('HTTP 403'); }, () => ({ raw: '<html>bloqueado</html>' }), () => ({ raw: JSON.stringify({ article: { title: 'x' } }) })]) {
      safeFetch.fetchTextoSeguro = async () => resposta();
      assert.equal(await research._lerArtigoCentralTotvs(ARTIGO), null);
    }
    let chamou = false;
    safeFetch.fetchTextoSeguro = async () => { chamou = true; return {}; };
    assert.equal(await research._lerArtigoCentralTotvs('https://tdn.totvs.com/display/x'), null);
    assert.equal(chamou, false, 'URL fora da Central não dispara a API');
  } finally { safeFetch.fetchTextoSeguro = original; }
});

// ── Bloco "Fontes consultadas" na Técnica ──────────────────────────────────
const PESQUISA = { modo: 'web', paginasLidas: [
  { titulo: 'Artigo oficial sintético', url: ARTIGO, status: 'lida' },
  { titulo: 'Página genérica sintética', url: 'https://tdn.totvs.com/display/exemplo', status: 'erro_fetch', erro: 'HTTP 403' },
  { titulo: 'Reaproveitada', url: 'https://exemplo.com/a', status: 'reutilizada' },
  { titulo: 'Duplicada', url: ARTIGO, status: 'lida' },
  { titulo: 'Busca', url: 'https://www.google.com/search?q=teste', status: 'lida' },
] };

test('Técnica ganha bloco de fontes com link e situação; busca do Google e duplicadas ficam fora', () => {
  const t = investigacao._anexarFontesConsultadas('Análise técnica sintética.', PESQUISA);
  assert.match(t, /\n\nFontes consultadas na pesquisa:\n/);
  assert.match(t, new RegExp(`- Artigo oficial sintético — ${ARTIGO.replace(/[.?]/g, '\\$&')} — conteúdo lido`));
  assert.match(t, /- Página genérica sintética — https:\/\/tdn\.totvs\.com\/display\/exemplo — conteúdo não recuperado \(HTTP 403\)/);
  assert.match(t, /- Reaproveitada — https:\/\/exemplo\.com\/a — conteúdo lido em pesquisa anterior/);
  assert.equal((t.match(/1234567890/g) || []).length, 1, 'link duplicado aparece uma vez');
  assert.doesNotMatch(t, /google\.com\/search/);
});

test('sem pesquisa, ou sem link útil, a Técnica não muda; o bloco tem no máximo 8 fontes', () => {
  assert.equal(investigacao._anexarFontesConsultadas('Texto.', null), 'Texto.');
  assert.equal(investigacao._anexarFontesConsultadas('Texto.', { paginasLidas: [{ url: 'https://www.google.com/search?q=x', status: 'lida' }] }), 'Texto.');
  const muitas = { paginasLidas: Array.from({ length: 12 }, (_, i) => ({ titulo: `F${i}`, url: `https://exemplo.com/${i}`, status: 'lida' })) };
  assert.equal((investigacao._anexarFontesConsultadas('T.', muitas).match(/^- /gm) || []).length, 8);
});

test('a Objetiva que perde um link do bloco de fontes é rejeitada pelo validador', () => {
  const tecnica = investigacao._anexarFontesConsultadas('O parâmetro MV_EXEMPLO foi alterado e o cliente confirmou que funcionou.', PESQUISA);
  const OPC = { permitirSintese: true, exigirEstrutura: true };
  assert.equal(analisarPreservacao(tecnica, tecnica, OPC).aprovado, true);
  const semLink = tecnica.replace(/\n- Página genérica sintética[^\n]*/, '');
  const r = analisarPreservacao(tecnica, semLink, OPC);
  assert.equal(r.aprovado, false);
  assert.ok(r.falhas.some(f => f.codigo === 'REFERENCIA_TECNICA_REMOVIDA'));
});

// ── Contexto da pergunta curta ─────────────────────────────────────────────
test('pergunta curta: última resposta da IA vai inteira (com o link); as demais seguem resumidas', () => {
  const longaAntiga = 'A'.repeat(1500);
  const ultima = `${'Contexto técnico sintético. '.repeat(40)}Link: ${ARTIGO}`;
  const historico = [
    { papel: 'assistant', conteudo: longaAntiga },
    { papel: 'user', conteudo: 'Pesquise mais.' },
    { papel: 'assistant', conteudo: ultima },
    { papel: 'user', conteudo: 'Por que não mandou o link?' },
  ];
  const ctx = investigacao._historicoParaPerguntaCurta(historico);
  assert.ok(ultima.indexOf(ARTIGO) > 600, 'o link fica depois do caractere 600 (cenário real)');
  assert.ok(ctx.includes(ARTIGO), 'a IA enxerga o link que ela mesma enviou');
  assert.ok(!ctx.includes('A'.repeat(601)), 'mensagens anteriores continuam cortadas em 600 caracteres');
  assert.match(ctx, /\[Analista\]: Por que não mandou o link\?/);
});
