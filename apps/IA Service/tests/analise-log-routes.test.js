'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const analiseReal = require('../backend/services/analise-log-service');
const caminho = require.resolve('../backend/routes/analise-log-routes');
let liberar;
let filaLiberar = [];
let bloquear = false;
let falharHistorico = false;
const chamadas = [];
const historicos = new Map();
const stubs = {
  '../repositories/analise-log-repository': {
    excluir: (empresa, ids) => {
      if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('Selecione análises.'), { status: 400 });
      if (ids.some(id => historicos.get(id)?.empresa !== Number(empresa))) throw Object.assign(new Error('Análise não encontrada nesta empresa.'), { status: 404 });
      for (const id of ids) historicos.delete(id);
      return ids.length;
    },
    listar: empresa => [...historicos.values()].filter(h => h.empresa === Number(empresa)).map(h => ({ id: h.id, nome: h.resultado.arquivo.nome })),
    obter: (empresa, id) => { const h = historicos.get(id); return h?.empresa === Number(empresa) ? h : null; },
    salvar: (empresa, { resultado, hashArquivo, historicoId, autor }) => {
      if (falharHistorico) throw new Error('Falha de gravação simulada');
      const id = historicoId || `hist-${historicos.size + 1}`; historicos.set(id, { id, empresa: Number(empresa), hashArquivo, resultado: structuredClone(resultado), autor });
      return { id, salvo: true, atualizadoEm: new Date().toISOString(), bytesHistorico: 200 };
    },
  },
  '../services/analise-log-service': { ...analiseReal, analisarBuffer: async (_empresa, conteudo, nome, deps = {}) => {
    deps.onProgress?.('varredura');
    if (bloquear) await new Promise(resolve => { liberar = resolve; filaLiberar.push(resolve); });
    deps.onProgress?.('relatorio', { semErros: true });
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
  app.use((req, _res, next) => {
    req.svcEmpresaId = Number(req.headers['x-empresa'] || 1);
    if (req.headers['x-consultor']) req.svcConsultorExterno = req.headers['x-consultor'];
    else if (req.headers['x-usuario'] !== 'ausente') req.session = { user_id: req.headers['x-usuario'] || '1' };
    next();
  });
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

test('bloqueia duplicidade do mesmo usuário e libera a operação ao terminar', async () => {
  bloquear = true;
  const pendente = post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' });
  const inicio = Date.now();
  while (!liberar) {
    if (Date.now() - inicio > 3000) throw new Error('Análise não iniciou');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await post('/api/ia-service-externo', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' })).status, 429);
  bloquear = false; liberar(); filaLiberar = [];
  assert.equal((await pendente).status, 200);
  assert.equal((await post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' })).status, 200);
});

test('permite usuários diferentes em paralelo, limita capacidade e isola empresas e identidades', async () => {
  bloquear = true; filaLiberar = [];
  const pendentes = [];
  const enviar = headers => {
    const form = new FormData(); form.append('arquivo', new Blob(['normal']), 'teste.log');
    return fetch(`${base}/api/ia-service/radar/logs/avulso`, { method: 'POST', body: form, headers });
  };
  async function iniciar(headers, esperado) {
    pendentes.push(enviar(headers));
    const inicio = Date.now();
    while (filaLiberar.length < esperado) {
      if (Date.now() - inicio > 3000) throw new Error('Operação concorrente não iniciou');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    await iniciar({ 'x-usuario': '7' }, 1);
    await iniciar({ 'x-consultor': '7' }, 2);
    assert.equal((await enviar({ 'x-usuario': '8' })).status, 429);
    await iniciar({ 'x-empresa': '2', 'x-usuario': '7' }, 3);
    await iniciar({ 'x-empresa': '2', 'x-usuario': '8' }, 4);
    assert.equal((await enviar({ 'x-empresa': '3', 'x-usuario': '9' })).status, 429);
  } finally {
    bloquear = false; filaLiberar.forEach(resolve => resolve()); filaLiberar = [];
    const respostas = await Promise.all(pendentes);
    for (const r of respostas) assert.equal(r.status, 200);
  }
  assert.equal((await enviar({ 'x-usuario': '8' })).status, 200);
});

test('rejeita identidade ausente e registra autoria da sessão sem aceitar autor enviado pelo cliente', async () => {
  const body = { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A', autor: { tipo: 'usuario_iahub', id: 'fraude' } };
  assert.equal((await post('/api/ia-service', body, { 'x-usuario': 'ausente' })).status, 401);
  const r = await (await post('/api/ia-service', body, { 'x-usuario': '42' })).json();
  const salvo = await (await fetch(`${base}/api/ia-service/radar/logs/historico/${r.historico.id}`, { headers: { 'x-usuario': '99' } })).json();
  assert.deepEqual(salvo.historico.autor, { tipo: 'usuario_iahub', id: '42' });
});

test('streaming transmite etapas e relatório, mantendo JSON padrão para clientes anteriores', async () => {
  const res = await post('/api/ia-service', { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' });
  assert.match(res.headers.get('content-type'), /application\/json/);
  const streaming = await fetch(`${base}/api/ia-service/radar/logs/analisar?progresso=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' }),
  });
  assert.match(streaming.headers.get('content-type'), /application\/x-ndjson/);
  const eventos = (await streaming.text()).trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(eventos.filter(e => e.tipo === 'progresso').map(e => e.etapa), ['arquivo', 'varredura', 'relatorio']);
  assert.equal(eventos.at(-1).tipo, 'resultado');
  assert.equal(eventos.at(-1).resultado.origem.numero, '123');
});

test('streaming devolve erro legível quando arquivo de outro atendimento é solicitado', async () => {
  const res = await fetch(`${base}/api/ia-service/radar/logs/analisar?progresso=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'outro' }) });
  const eventos = (await res.text()).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(eventos.at(-1).tipo, 'erro');
  assert.match(eventos.at(-1).error, /não encontrado neste chamado/);
});

test('busca avulsa retorna trechos do arquivo e preserva o vínculo de acesso para busca no chamado', async () => {
  const form = new FormData(); form.append('arquivo', new Blob(['normal\nCTEST encontrado\n']), 'teste.log');
  const res = await fetch(`${base}/api/ia-service-externo/radar/logs/avulso?busca=ctest`, { method: 'POST', body: form });
  const r = await res.json(); assert.equal(r.total, 1); assert.equal(r.resultados[0].linha, 2);
  const negado = await fetch(`${base}/api/ia-service/radar/logs/analisar?busca=ctest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'outro' }) });
  assert.equal(negado.status, 404);
});

test('histórico reabre o relatório sem executar análise e nega outra empresa', async () => {
  const antes = chamadas.length;
  const lista = await (await fetch(`${base}/api/ia-service/radar/logs/historico`)).json();
  assert.ok(lista.analises.length > 0);
  const id = lista.analises[0].id;
  const r = await fetch(`${base}/api/ia-service-externo/radar/logs/historico/${id}`);
  assert.equal(r.status, 200); assert.equal((await r.json()).historico.salvo, true);
  assert.equal(chamadas.length, antes);
  assert.equal((await fetch(`${base}/api/ia-service/radar/logs/historico/${id}`, { headers: { 'x-empresa': '2' } })).status, 404);
});

test('reattach de arquivo diferente do histórico é recusado antes da IA', async () => {
  const lista = await (await fetch(`${base}/api/ia-service/radar/logs/historico`)).json();
  const form = new FormData(); form.append('arquivo', new Blob(['outro conteúdo']), 'teste.log');
  const res = await fetch(`${base}/api/ia-service/radar/logs/avulso?busca=teste&historicoId=${lista.analises[0].id}`, { method: 'POST', body: form });
  assert.equal(res.status, 409);
});

test('exclui apenas análises selecionadas da empresa nos dois namespaces sem tocar anexos', async () => {
  for (const prefixo of ['/api/ia-service', '/api/ia-service-externo']) {
    const r = await (await post(prefixo, { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' })).json();
    const id = r.historico.id; const leiturasAntes = chamadas.length;
    const apagar = headers => fetch(`${base}${prefixo}/radar/logs/historico`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ids: [id], empresa_id: 1 }) });
    assert.equal((await apagar({ 'x-empresa': '2' })).status, 404);
    assert.ok(historicos.has(id));
    const res = await apagar({ 'x-usuario': 'outro-usuario' });
    assert.equal(res.status, 200); assert.equal((await res.json()).excluidas, 1);
    assert.equal(historicos.has(id), false); assert.equal(chamadas.length, leiturasAntes);
  }
});

test('falha temporária ao salvar mantém o vínculo com a análise anterior', async () => {
  const body = { chamadoId: 'chamado-A', tipo: 'chat', arquivoId: 'anexo-A' };
  const criado = await (await post('/api/ia-service', body)).json();
  falharHistorico = true;
  try {
    const res = await fetch(`${base}/api/ia-service/radar/logs/analisar?grupoId=erro-1&historicoId=${criado.historico.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    const r = await res.json();
    assert.equal(r.historico.salvo, false);
    assert.equal(r.historico.id, criado.historico.id, 'a próxima tentativa continua ligada ao mesmo histórico');
  } finally { falharHistorico = false; }
});
