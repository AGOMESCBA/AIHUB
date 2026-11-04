'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const analiseReal = require('../backend/services/analise-log-service');
const caminho = require.resolve('../backend/routes/analise-log-routes');
let liberar;
let bloquear = false;
const chamadas = [];
const stubs = {
  '../services/analise-log-service': { ...analiseReal, analisarBuffer: async (_empresa, conteudo, nome) => {
    if (bloquear) await new Promise(resolve => { liberar = resolve; });
    return analiseReal.localizarErros(conteudo, nome);
  } },
  '../repositories/chamado-repository': { getChamado: (empresa, id) => Number(empresa) === 1 && id === 'chamado-A' ? { id, numero: '123', sistemaOrigem: 'softexpert' } : null },
  '../repositories/atendimento-repository': { getAtendimentoPorReferencia: () => ({ id: 'at-A' }) },
  '../repositories/anexo-repository': {
    listarAnexos: () => [{ id: 'anexo-A', nomeOriginal: 'error.log.txt', criadoEm: '2026-11-03', tamanho: 10 }],
    getAnexo: (empresa, id) => Number(empresa) === 1 && ['anexo-A', 'outro'].includes(id)
      ? { nomeOriginal: 'error.log', atendimentoId: id === 'outro' ? 'at-B' : 'at-A', caminhoRelativo: 'empresa/at-A/log' } : null,
  },
  '../services/armazenamento-anexos': { resolverCaminhoSeguro: p => { chamadas.push(p); return p; } },
  '../services/anexos-softexpert-service': {
    listarAnexosDoChamado: async () => { throw new Error('origem indisponível'); },
    baixarAnexo: async (_empresa, _chamado, id) => {
      if (id !== 'oid-A') throw Object.assign(new Error('Anexo não encontrado neste chamado.'), { status: 404 });
      return { nome: 'remoto.log', buffer: Buffer.from('Ambiente iniciado') };
    },
  },
  'node:fs/promises': { stat: async () => ({ size: 100 }), readFile: async () => Buffer.from('Ambiente iniciado') },
};
const originalLoad = Module._load;
let registrar;
try {
  Module._load = function(request, parent, ...args) {
    if (parent?.filename === caminho && Object.hasOwn(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, ...args);
  };
  registrar = require(caminho);
} finally { Module._load = originalLoad; }

let servidor;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.svcEmpresaId = Number(req.headers['x-empresa'] || 1); next(); });
  registrar(app, '/api/ia-service');
  registrar(app, '/api/ia-service-externo');
  servidor = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => new Promise(resolve => servidor.close(resolve)));

function post(prefixo, body, headers = {}) {
  return fetch(`${base}${prefixo}/radar/logs/analisar`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

test('lista anexos locais com aviso quando SoftExpert falha nos dois namespaces', async () => {
  for (const prefixo of ['/api/ia-service', '/api/ia-service-externo']) {
    const res = await fetch(`${base}${prefixo}/radar/logs?chamadoId=chamado-A`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const dados = await res.json();
    assert.equal(dados.arquivos[0].nome, 'error.log.txt');
    assert.match(dados.avisos[0], /incompleta/);
  }
});

test('nega chamado de outra empresa e anexo de outro atendimento antes de ler arquivo', async () => {
  const n = chamadas.length;
  assert.equal((await post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'outro' })).status, 404);
  assert.equal((await post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' }, { 'x-empresa': '2' })).status, 404);
  assert.equal(chamadas.length, n);
});

test('analisa arquivo original local e anexo remoto mantendo origem explícita', async () => {
  for (const [tipo, arquivoId] of [['chat', 'anexo-A'], ['softexpert', 'oid-A']]) {
    const res = await post('/api/ia-service', { chamadoId: 'chamado-A', tipo, arquivoId });
    assert.equal(res.status, 200);
    const r = await res.json();
    assert.equal(r.origem.numero, '123');
    assert.equal(r.origem.tipo, tipo);
    assert.equal(r.cobertura.varreduraCompleta, true);
  }
});

test('avulso funciona sem chamado e não acessa armazenamento de anexos', async () => {
  const n = chamadas.length;
  const form = new FormData(); form.append('arquivo', new Blob(['Ambiente iniciado']), 'avulso.log.txt');
  const res = await fetch(`${base}/api/ia-service-externo/radar/logs/avulso`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.deepEqual(r.origem, { tipo: 'avulso' });
  assert.equal(r.arquivo.nome, 'avulso.log.txt');
  assert.equal(chamadas.length, n);
});

test('rejeita avulso ausente, extensão incorreta e origem inválida', async () => {
  const form = new FormData(); form.append('arquivo', new Blob(['normal']), 'x.txt');
  assert.equal((await fetch(`${base}/api/ia-service/radar/logs/avulso`, { method: 'POST', body: form })).status, 400);
  assert.equal((await fetch(`${base}/api/ia-service/radar/logs/avulso`, { method: 'POST', body: new FormData() })).status, 400);
  assert.equal((await post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'invalido' })).status, 400);
});

test('análises simultâneas na mesma empresa são limitadas e o lock é liberado', async () => {
  bloquear = true;
  const pendente = post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' });
  const inicio = Date.now();
  while (!liberar) {
    if (Date.now() - inicio > 3000) throw new Error('Análise não iniciou');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await post('/api/ia-service-externo', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' })).status, 429);
  bloquear = false; liberar();
  assert.equal((await pendente).status, 200);
  assert.equal((await post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' })).status, 200);
});
