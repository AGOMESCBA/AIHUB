'use strict';
// Motor de pesquisa mais rápido (2026-11-02): consultas do Serper juntas,
// Central TOTVS ao mesmo tempo que o Serper e páginas baixadas adiantadas.
// O resultado tem de ser o MESMO de antes (ordem, regras e limites); só o tempo
// muda. Até 5 consultas por turno; teto de 25 chamadas simultâneas por serviço
// no servidor (decisão do usuário).
// Sem rede: HTTPS e fetch simulados. Dados sintéticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const safeFetch = require('../backend/services/safe-web-fetch-service');
const motor = require('../backend/services/technical-research-service');

const esperar = ms => new Promise(r => setTimeout(r, ms));

// Serper simulado: responde cada consulta após `atraso(q)` ms, com status opcional.
function comSerperSimulado({ atraso = () => 50, status = () => 200 }, fn) {
  const original = https.request;
  const estado = { ativos: 0, pico: 0, chamadas: [] };
  https.request = (_opts, cb) => {
    const req = new EventEmitter();
    let corpo = '';
    req.setTimeout = () => req;
    req.write = (c) => { corpo += c; };
    req.end = () => {
      const { q } = JSON.parse(corpo);
      estado.chamadas.push(q);
      estado.ativos += 1;
      estado.pico = Math.max(estado.pico, estado.ativos);
      const tentativa = estado.chamadas.filter(x => x === q).length;
      setTimeout(() => {
        estado.ativos -= 1;
        const res = new EventEmitter();
        res.statusCode = status(q, tentativa);
        res.setEncoding = () => {};
        cb(res);
        const dados = res.statusCode >= 400 ? { message: 'Too many requests' } : { organic: [{ title: `T ${q}`, link: `https://exemplo.com/${encodeURIComponent(q)}`, snippet: 's' }] };
        res.emit('data', JSON.stringify(dados));
        res.emit('end');
      }, atraso(q));
    };
    return req;
  };
  return Promise.resolve().then(() => fn(estado)).finally(() => { https.request = original; });
}

test('limitador: nunca passa do máximo de chamadas simultâneas e atende todas, na ordem de chegada', async () => {
  const limitar = motor._criarLimitador(() => 5);
  let ativos = 0, pico = 0;
  const ordem = [];
  const tarefas = Array.from({ length: 12 }, (_, i) => limitar(async () => {
    ativos += 1; pico = Math.max(pico, ativos); ordem.push(i);
    await esperar(10);
    ativos -= 1;
    return i;
  }));
  assert.deepEqual(await Promise.all(tarefas), [...Array(12).keys()]);
  assert.equal(pico, 5);
  assert.deepEqual(ordem, [...Array(12).keys()]);
  await assert.rejects(limitar(async () => { throw new Error('falha'); }), /falha/);
  assert.equal(await limitar(async () => 'segue'), 'segue', 'falha não trava a fila');
});

test('Serper: consultas saem juntas e os resultados ficam na ordem das consultas (como antes)', async () => {
  const consultas = ['c1', 'c2', 'c3', 'c4', 'c5'];
  await comSerperSimulado({ atraso: q => 300 - Number(q[1]) * 50 }, async (estado) => {
    const inicio = Date.now();
    const resultados = await motor._buscarSerper(consultas, 3, { apiKey: 'k' });
    const tempo = Date.now() - inicio;
    assert.deepEqual(resultados.map(r => r.consulta), consultas, 'ordem das consultas, mesmo com respostas fora de ordem');
    assert.equal(estado.pico, 5, 'as 5 consultas ao mesmo tempo');
    assert.ok(tempo < 450, `juntas levam o tempo da mais lenta (${tempo} ms), não a soma (1000 ms)`);
  });
});

test('Serper: teto global de chamadas simultâneas (padrão 25, configurável) é respeitado', async () => {
  const consultas = Array.from({ length: 30 }, (_, i) => `q${i}`);
  await comSerperSimulado({ atraso: () => 40 }, async (estado) => {
    assert.equal((await motor._buscarSerper(consultas, 3, { apiKey: 'k' })).length, 30);
    assert.equal(estado.pico, 25, 'padrão 25');
  });
  process.env.SVC_PESQUISA_SERPER_SIMULTANEAS = '5';
  try {
    await comSerperSimulado({ atraso: () => 40 }, async (estado) => {
      assert.equal((await motor._buscarSerper(consultas.slice(0, 10), 3, { apiKey: 'k' })).length, 10);
      assert.equal(estado.pico, 5, 'teto configurado pelo .env');
    });
  } finally { delete process.env.SVC_PESQUISA_SERPER_SIMULTANEAS; }
});

test('Serper: HTTP 429 espera e tenta de novo uma vez; 429 de novo é falha do provider', async () => {
  process.env.SVC_PESQUISA_ESPERA_429_MS = '1';
  await comSerperSimulado({ status: (q, tentativa) => (q === 'c2' && tentativa === 1 ? 429 : 200) }, async (estado) => {
    const resultados = await motor._buscarSerper(['c1', 'c2'], 3, { apiKey: 'k' });
    assert.deepEqual(resultados.map(r => r.consulta), ['c1', 'c2']);
    assert.equal(estado.chamadas.filter(q => q === 'c2').length, 2);
  });
  await comSerperSimulado({ status: q => (q === 'c2' ? 429 : 200) }, async (estado) => {
    await assert.rejects(motor._buscarSerper(['c1', 'c2'], 3, { apiKey: 'k' }), err => err.status === 429);
    assert.equal(estado.chamadas.filter(q => q === 'c2').length, 2, 'só uma nova tentativa');
  });
  await comSerperSimulado({ status: () => 401 }, async (estado) => {
    await assert.rejects(motor._buscarSerper(['c1'], 3, { apiKey: 'k' }), err => err.status === 401);
    assert.equal(estado.chamadas.length, 1, 'outros erros não tentam de novo');
  });
});

function ctxProtheus(texto = 'Erro MATA103 TES invalida no documento de entrada') {
  return { empresaId: 1, atendimentoId: 'at-1', texto, mensagens: [{ papel: 'user', conteudo: texto }], anexos: [] };
}

test('pesquisar: Central TOTVS roda junto com o Serper, com a mesma junção e a mesma ordem de tentativas', async () => {
  const atraso = 200;
  let pesquisa;
  const inicio = Date.now();
  pesquisa = await motor.pesquisar(ctxProtheus(), {
    searchConfig: { provedorPrimario: 'serper', fallbackOrdem: 'serper', serperApiKey: 'k' },
    interpretarSemantico: async () => ({ resultado: { haMudancaInvestigativa: true, tipoMudanca: 'evidencia_nova', relevanciaParaPesquisa: 'alta', pedidoInvestigacaoAnalista: 'sim' } }),
    buscarSerper: async (consultas) => { await esperar(atraso); return consultas.map((q, i) => ({ titulo: `Serper ${i}`, url: `https://s.com/${i}`, trecho: 'x', fonte: 'Serper/Google', consulta: q })); },
    buscarCentralTotvs: async (consulta) => { await esperar(atraso); return [{ titulo: `Central Protheus ${consulta}`, url: `https://centraldeatendimento.totvs.com/hc/pt-br/articles/1-${encodeURIComponent(consulta)}`, trecho: 'y', fonte: 'Central TOTVS', consulta, oficial: true }, { titulo: 'Repetido', url: 'https://s.com/0', fonte: 'Central TOTVS', consulta }]; },
    abrirResultados: async () => [],
  });
  const tempo = Date.now() - inicio;
  assert.equal(pesquisa.plano.devePesquisar, true, 'o cenário precisa exercitar a busca');
  assert.equal(pesquisa.modo, 'web');
  const provedores = pesquisa.tentativasBusca.map(t => t.provider);
  assert.equal(provedores[0], 'Serper/Google', 'Serper registrado primeiro, como antes');
  assert.ok(provedores.slice(1).every(p => p === 'Central TOTVS'));
  const urls = pesquisa.resultados.map(r => r.url);
  assert.equal(new Set(urls).size, urls.length, 'sem URL repetida');
  assert.ok(tempo < atraso * 2 + 150, `Serper e Central ao mesmo tempo (${tempo} ms)`);
  assert.ok(pesquisa.temposMs && typeof pesquisa.temposMs.busca === 'number', 'tempo da busca medido');
});

// Páginas: 4 candidatas; a 1ª falha, a 2ª redireciona para a 3ª, a 3ª e a 4ª são lidas.
function candidatas() {
  return [1, 2, 3, 4].map(i => ({ titulo: `Artigo ${i} MATA103`, url: `https://exemplo.com/a${i}`, trecho: 'MATA103', fonte: 'Serper/Google', consulta: 'MATA103' }));
}
async function comFetchSimulado(atraso, fn) {
  const original = safeFetch.fetchTextoSeguro;
  const pedidos = [];
  let ativos = 0, pico = 0;
  safeFetch.fetchTextoSeguro = async (url) => {
    pedidos.push(url);
    ativos += 1; pico = Math.max(pico, ativos);
    await esperar(atraso);
    ativos -= 1;
    if (url.endsWith('/a1')) throw new Error('falha de rede');
    const destino = url.endsWith('/a2') ? 'https://exemplo.com/a3' : url;
    return { url: destino, raw: `<p>conteudo ${destino} MATA103</p>`, contentType: 'text/html', bytes: 10 };
  };
  try { return await fn({ pedidos, pico: () => pico }); } finally { safeFetch.fetchTextoSeguro = original; }
}

test('páginas: mesmas regras de antes (falha passa para a próxima, redirecionamento repetido é descartado, para no limite)', async () => {
  await comFetchSimulado(30, async () => {
    const paginas = await motor._abrirResultados(candidatas(), 2, {}, { maxTentativas: 6 });
    const resumo = paginas.map(p => [p.url, p.status]);
    assert.deepEqual(resumo, [
      ['https://exemplo.com/a1', 'erro_fetch'],
      ['https://exemplo.com/a3', 'lida'],
      ['https://exemplo.com/a4', 'lida'],
    ], 'a2 vira a3 (lida); a3 original é pulada por já ter sido lida; a4 completa o limite');
  });
});

test('páginas: downloads adiantados ao mesmo tempo, sem passar do limite de 5', async () => {
  const muitas = Array.from({ length: 8 }, (_, i) => ({ titulo: `Artigo ${i + 5} MATA103`, url: `https://exemplo.com/b${i}`, trecho: 'MATA103', fonte: 'Serper/Google', consulta: 'MATA103' }));
  await comFetchSimulado(150, async ({ pico }) => {
    const inicio = Date.now();
    const paginas = await motor._abrirResultados(muitas, 3, {}, { maxTentativas: 6 });
    const tempo = Date.now() - inicio;
    assert.equal(paginas.filter(p => p.status === 'lida').length, 3);
    assert.ok(pico() >= 2 && pico() <= 5, `downloads simultâneos dentro do limite (pico ${pico()})`);
    assert.ok(tempo < 150 * 3, `mais rápido que uma de cada vez (${tempo} ms)`);
  });
});

test('páginas: URL já lida antes é reutilizada sem novo download', async () => {
  await comFetchSimulado(10, async ({ pedidos }) => {
    const plano = { historico: { urlsLidas: [{ url: 'https://exemplo.com/a3', status: 'lida', trecho: 'trecho anterior' }] } };
    const paginas = await motor._abrirResultados(candidatas().slice(2), 2, plano, { maxTentativas: 6 });
    assert.equal(paginas[0].status, 'reutilizada');
    assert.ok(!pedidos.includes('https://exemplo.com/a3'), 'não baixa de novo o que foi reutilizado');
  });
});
