'use strict';

// Garante que o servidor simulado cumpre os contratos congelados
// (backend/contratos FORMAS). Quando o servidor real ganhar cada rota (C1–C4),
// o mesmo conjunto de formas vale para ele.

const test = require('node:test');
const assert = require('node:assert/strict');
const io = require('../../../node_modules/socket.io/client-dist/socket.io.js');
const { criarServidorSimulado } = require('../backend/simulado/servidor-simulado');
const { camposFaltando, EVENTOS_SOCKET } = require('../backend/contratos');

let sim;
let base;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 40, intervaloQrMs: 200, log: { error() {} } });
  const { port } = await sim.iniciar(0);
  base = `http://127.0.0.1:${port}`;
});
test.after(() => sim.fechar());

const admin = (caminho, opcoes = {}) => fetch(`${base}/app/ia-talk/api/admin${caminho}`, {
  ...opcoes,
  headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
  body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
});
const json = async (r) => ({ status: r.status, corpo: await r.json() });
const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);

test('contrato: sessão, papéis e troca de empresa', async () => {
  const s = (await json(await admin('/sessao'))).corpo;
  forma('sessao', s);
  assert.ok(s.rotinas.includes('talk-empresas'));
  const papeis = (await json(await admin('/papeis'))).corpo;
  forma('pagina', papeis);
  papeis.itens.forEach(p => forma('papel', p));

  const troca = await json(await admin('/sessao/empresa', { method: 'POST', corpo: { empresa_id: 'emp_plantivo' } }));
  assert.equal(troca.status, 200);
  assert.equal((await json(await admin('/sessao'))).corpo.empresa.id, 'emp_plantivo');
  const negada = await json(await admin('/sessao/empresa', { method: 'POST', corpo: { empresa_id: 'emp_antiga' } }));
  assert.equal(negada.status, 403, 'empresa inativa não pode ser escolhida');
  await admin('/sessao/empresa', { method: 'POST', corpo: { empresa_id: 'emp_j2a' } });
});

test('contrato: listas com paginação por cursor, filtros e ordenação', async () => {
  const p1 = (await json(await admin('/mensagens?limite=10'))).corpo;
  forma('pagina', p1);
  assert.equal(p1.itens.length, 10);
  p1.itens.forEach(m => forma('mensagemResumo', m));
  assert.ok(p1.proximo_cursor);
  const p2 = (await json(await admin(`/mensagens?limite=10&cursor=${encodeURIComponent(p1.proximo_cursor)}`))).corpo;
  assert.equal(new Set([...p1.itens, ...p2.itens].map(m => m.id)).size, 20, 'segunda página não repete');

  const falhas = (await json(await admin('/mensagens?apenas_falhas=1&limite=200'))).corpo.itens;
  assert.ok(falhas.length > 0 && falhas.every(m => ['falhou', 'desconhecida'].includes(m.estado)));
  const asc = (await json(await admin('/mensagens?ordenar=criada_em&ordem=asc&limite=5'))).corpo.itens;
  assert.ok(asc[0].criada_em <= asc[1].criada_em);
  const detalhe = (await json(await admin(`/mensagens/${p1.itens[0].id}`))).corpo;
  forma('mensagemDetalhe', detalhe);

  for (const [rota, nome] of [['/empresas', 'empresa'], ['/usuarios', 'usuario'], ['/aplicacoes', 'aplicacao'], ['/canais', 'canal'], ['/eventos', 'evento'], ['/auditoria', 'auditoria']]) {
    const p = (await json(await admin(rota))).corpo;
    forma('pagina', p);
    assert.ok(p.itens.length > 0, rota);
    p.itens.forEach(i => forma(nome, i));
  }
  forma('painel', (await json(await admin('/painel'))).corpo);
  forma('sitesAutorizados', (await json(await admin('/sites-autorizados'))).corpo);
  forma('emailEnvio', (await json(await admin('/email-envio'))).corpo);
  (await json(await admin('/aplicacoes'))).corpo.itens[0].tokens.forEach(t => forma('tokenAplicacao', t));
});

test('privacidade: número nunca sai completo nas respostas administrativas', async () => {
  const textos = await Promise.all(['/usuarios', '/canais', '/mensagens?limite=200'].map(r => admin(r).then(x => x.text())));
  for (const t of textos) assert.doesNotMatch(t, /5565999[0-9]{6}/);
});

test('cenários: vazio, lento e erros com o formato padrão', async () => {
  const vazio = (await json(await admin('/canais', { headers: { 'X-Talk-Simular': 'vazio' } }))).corpo;
  assert.deepEqual(vazio, { itens: [], proximo_cursor: null, total: 0 });
  for (const codigo of [400, 401, 403, 404, 409, 422, 429, 500]) {
    const r = await json(await admin('/empresas', { headers: { 'X-Talk-Simular': String(codigo) } }));
    assert.equal(r.status, codigo);
    forma('erro', r.corpo.erro);
  }
  const r429 = await admin('/empresas?simular=429');
  assert.equal(r429.headers.get('retry-after'), '30');
  const inicio = Date.now();
  await admin('/painel', { headers: { 'X-Talk-Simular': 'lento' } });
  assert.ok(Date.now() - inicio >= 1400, 'lento atrasa ~1,5 s');
});

test('cadastro: validação por campo, conflito e criação', async () => {
  const invalido = await json(await admin('/empresas', { method: 'POST', corpo: { nome: '', apelido: 'Com Espaço' } }));
  assert.equal(invalido.status, 400);
  assert.ok(invalido.corpo.erro.campos.nome && invalido.corpo.erro.campos.apelido);
  const repetido = await json(await admin('/empresas', { method: 'POST', corpo: { nome: 'X', apelido: 'j2a' } }));
  assert.equal(repetido.status, 409);
  const nova = await json(await admin('/empresas', { method: 'POST', corpo: { nome: 'Nova Ltda', apelido: 'nova-ltda' } }));
  assert.equal(nova.status, 201);
  forma('empresa', nova.corpo);

  const sites = (await json(await admin('/sites-autorizados'))).corpo;
  const desatualizado = await json(await admin('/sites-autorizados', { method: 'PUT', corpo: { origens: [], versao: sites.versao - 1 } }));
  assert.equal(desatualizado.status, 409, 'versão antiga não sobrescreve');
});

test('tokens: completo só na geração; depois só o prefixo; revogação', async () => {
  const g = await json(await admin('/aplicacoes/app_iaservice/tokens', { method: 'POST' }));
  assert.equal(g.status, 201);
  assert.match(g.corpo.token, /^tk_teste_/);
  forma('tokenAplicacao', g.corpo.registro);
  const app = (await json(await admin('/aplicacoes/app_iaservice'))).corpo;
  assert.doesNotMatch(JSON.stringify(app), new RegExp(g.corpo.token));
  const rev = await json(await admin(`/aplicacoes/app_iaservice/tokens/${g.corpo.registro.id}`, { method: 'DELETE' }));
  assert.ok(rev.corpo.revogado_em);
});

test('canais: QR fake, ações e limpar sessão com confirmação', async () => {
  const qr = (await json(await admin('/canais/cn_teste/qr'))).corpo;
  forma('qrCanal', qr);
  assert.match(qr.qr, /^data:image\/png;base64,/);
  assert.equal((await json(await admin('/canais/cn_suporte/qr'))).corpo.qr, null, 'canal conectado não tem QR');
  const semConfirmar = await json(await admin('/canais/cn_teste/limpar-sessao', { method: 'POST', corpo: {} }));
  assert.equal(semConfirmar.status, 400);
  const limpo = await json(await admin('/canais/cn_teste/limpar-sessao', { method: 'POST', corpo: { confirmar: true } }));
  assert.equal(limpo.corpo.estado, 'parado');
  await admin('/canais/cn_teste/conectar', { method: 'POST' });
  const log = (await json(await admin('/canais/cn_teste/log'))).corpo;
  log.itens.forEach(l => forma('logCanal', l));
  const meta = await json(await admin('/canais', { method: 'POST', corpo: { nome: 'Oficial', provedor: 'meta' } }));
  assert.equal(meta.status, 400, 'Meta ainda não disponível');
});

test('socket: estado, QR e terminal ao vivo do canal assinado', async (t) => {
  const s = io(`${base}/talk`, { path: '/app/ia-talk/socket.io', transports: ['websocket'], forceNew: true });
  t.after(() => s.close());
  const E = EVENTOS_SOCKET.servidor;
  const estado = new Promise((r) => s.once(E.estadoCanal, r));
  const qr = new Promise((r) => s.once(E.qrCanal, r));
  const logs = [];
  const tresLogs = new Promise((r) => s.on(E.logCanal, (l) => { logs.push(l); if (logs.length === 3) r(); }));
  await new Promise((r) => s.on('connect', r));
  s.emit(EVENTOS_SOCKET.cliente.assinarCanal, { canal_id: 'cn_teste' });
  assert.equal((await estado).canal_id, 'cn_teste');
  assert.match((await qr).qr, /^data:image\/png/);
  await tresLogs;
  logs.forEach(l => { assert.equal(l.canal_id, 'cn_teste'); forma('logCanal', l); });
  const erro = new Promise((r) => s.once(E.erro, r));
  s.emit(EVENTOS_SOCKET.cliente.assinarCanal, { canal_id: 'cn_inexistente' });
  assert.equal((await erro).codigo, 'nao_encontrado');
});

test('login público: empresa por apelido, código e tentativas', async () => {
  const pub = (c, o = {}) => fetch(`${base}/app/ia-talk/api/publico${c}`, { method: o.corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: o.corpo && JSON.stringify(o.corpo) });
  assert.equal((await pub('/empresa/inexistente')).status, 404);
  assert.equal((await pub('/empresa/sol')).status, 404, 'empresa inativa não tem página de entrada');
  const d = (await json(await pub('/login/codigo', { corpo: { apelido: 'j2a', telefone: '5565999990001' } }))).corpo;
  assert.ok(d.desafio_id);
  assert.doesNotMatch(d.destino_mascarado, /999990001/);
  assert.equal((await pub('/login/confirmar', { corpo: { desafio_id: d.desafio_id, codigo: '000000' } })).status, 400);
  assert.equal((await pub('/login/confirmar', { corpo: { desafio_id: d.desafio_id, codigo: '123456' } })).status, 200);
});

test('API v1: token, idempotência, aceite sem prometer entrega', async () => {
  const v1 = (c, o = {}) => fetch(`${base}/app/ia-talk/api/v1${c}`, { method: o.metodo || 'GET', headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.corpo && JSON.stringify(o.corpo) });
  assert.equal((await v1('/canais/cn_suporte/estado')).status, 401);
  const auth = { Authorization: 'Bearer tk_teste_abc' };
  forma('v1EstadoCanal', (await json(await v1('/canais/cn_suporte/estado', { headers: auth }))).corpo);
  const corpo = { canal: 'cn_suporte', para: '+5565999990000', tipo: 'texto', texto: '*Olá*' };
  assert.equal((await v1('/mensagens', { metodo: 'POST', headers: auth, corpo })).status, 400, 'sem Idempotency-Key');
  const h = { ...auth, 'Idempotency-Key': 'teste-1', 'X-Correlation-Id': 'chamado-1' };
  const a = await json(await v1('/mensagens', { metodo: 'POST', headers: h, corpo }));
  assert.equal(a.status, 202);
  forma('v1MensagemAceita', a.corpo);
  assert.equal(a.corpo.estado, 'aceita');
  const b = await json(await v1('/mensagens', { metodo: 'POST', headers: h, corpo }));
  assert.equal(b.corpo.id, a.corpo.id, 'mesma chave = mesma mensagem');
  assert.equal((await v1('/mensagens', { metodo: 'POST', headers: h, corpo: { ...corpo, texto: 'outro' } })).status, 409);
  assert.equal((await v1('/mensagens', { metodo: 'POST', headers: { ...auth, 'Idempotency-Key': 'v' }, corpo: { ...corpo, tipo: 'video', arquivo: { url: 'https://x' } } })).status, 422);
  forma('v1Mensagem', (await json(await v1(`/mensagens/${a.corpo.id}`, { headers: auth }))).corpo);
});
