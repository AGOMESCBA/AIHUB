'use strict';

// C2 no servidor real: canais, processo filho por canal (provedor SIMULADO —
// nada de WhatsApp de verdade nos testes), concessão, modo de teste, log,
// permissões da empresa dona e Socket.IO autenticado pela sessão.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { criarApp } = require('../backend/servidor');
const { SupervisorCanais } = require('../backend/canais/supervisor');
const { configurarTempoReal } = require('../backend/tempo-real');
const { camposFaltando } = require('../backend/contratos');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');
const desafios = require('../backend/acesso/desafios');

cifra.definirChaveParaTeste(crypto.randomBytes(32));
const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);
const esperar = async (cond, ms = 5000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('condição não atingida a tempo');
};

let db; let base; let servidor; let supervisor; let ioServer; let pasta;

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-c2-'));
  db = abrirBanco({ arquivo: ':memory:' });
  let emitir = () => {};
  supervisor = new SupervisorCanais({ db, emitir: (...a) => emitir(...a), dirSessoes: path.join(pasta, 'sessoes'),
    envFilho: { IA_TALK_PROVEDOR_FORCADO: 'simulado' }, log: { error() {} }, esperas: [100, 100] });
  servidor = http.createServer(criarApp({ db, log: { error() {} }, supervisor, transportes: { whatsapp: async () => ({ ok: false }) } }));
  const { Server } = require('socket.io');
  ioServer = new Server(servidor, { path: '/app/ia-talk/socket.io' });
  emitir = configurarTempoReal(ioServer.of('/talk'), { db, supervisor });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(async () => {
  await supervisor.pararTodos();
  ioServer.close();
  await new Promise(r => servidor.close(r));
  fs.rmSync(pasta, { recursive: true, force: true });
});

function navegador() {
  let cookie = '';
  const ir = async (caminho, { metodo = 'GET', corpo } = {}) => {
    const r = await fetch(`${base}/app/ia-talk${caminho}`, { method: metodo, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const sc = r.headers.get('set-cookie');
    if (sc && sc.startsWith('talk.sid=') && !sc.startsWith('talk.sid=;')) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : await r.text() };
  };
  return { ir, cookie: () => cookie };
}

async function entrar(dados) {
  const nav = navegador();
  const { link } = primeiroAcesso({ db, ...dados });
  await nav.ir(link.slice(link.indexOf('/api/publico')));
  return nav;
}

test('canais: criar, conectar por QR, receber no modo de teste e desconectar', async () => {
  const nav = await entrar({ nome: 'Ana', telefone: '5565999990001', empresa: 'J2A', apelido: 'j2a' });
  assert.equal((await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'X', provedor: 'meta' } })).status, 400, 'Meta indisponível');
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'WhatsApp J2A', provedor: 'wweb', numero: '5565900000000' } })).corpo;
  forma('canal', c);
  assert.equal(c.estado, 'parado');
  assert.equal(c.modo_teste, true, 'nasce em modo de teste');
  assert.equal(c.empresas_vinculadas[0].padrao, true, 'primeiro canal da empresa vira o padrão');

  // Só a plataforma ajusta a lista de teste.
  const lista = await nav.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { numeros_teste: ['5565999875116'] } });
  assert.equal(lista.status, 200);
  assert.deepEqual(lista.corpo.numeros_teste_mascarados, ['+55 65 9••••-5116']);

  const con = await nav.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' });
  assert.equal(con.status, 200);
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}`)).corpo.estado === 'qr_pendente');
  const qr = (await nav.ir(`/api/admin/canais/${c.id}/qr`)).corpo;
  forma('qrCanal', qr);
  assert.match(qr.qr, /^data:image\/png;base64,/);

  supervisor._comandoTeste(c.id, 'simular-leitura');
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}`)).corpo.estado === 'conectado');

  // Modo de teste: número da lista entra no log; outro número só conta.
  supervisor._comandoTeste(c.id, 'simular-mensagem', { de: '5565999875116', texto: 'Olá, teste do Talk' });
  supervisor._comandoTeste(c.id, 'simular-mensagem', { de: '5565911112222', texto: 'conversa de cliente' });
  await esperar(() => db.prepare('SELECT recebidas_descartadas n FROM canais WHERE id = ?').get(c.id).n === 1);
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}/log`)).corpo.itens.some(l => l.tipo === 'received'));
  const log = (await nav.ir(`/api/admin/canais/${c.id}/log?limite=200`)).corpo;
  log.itens.forEach(l => forma('logCanal', l));
  const textoLog = JSON.stringify(log);
  assert.match(textoLog, /9••••-5116/);
  assert.match(textoLog, /Olá, teste do Talk/);
  assert.doesNotMatch(textoLog, /conversa de cliente/, 'mensagem de cliente fora da lista não é gravada');
  assert.doesNotMatch(textoLog, /5565999875116|5565911112222/, 'número nunca completo no log');

  await nav.ir(`/api/admin/canais/${c.id}/desconectar`, { metodo: 'POST' });
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}`)).corpo.estado === 'parado');
  assert.equal(supervisor.filhos.has(c.id), false, 'processo do canal encerrado');
  assert.equal(db.prepare('SELECT dono FROM canal_concessoes WHERE canal_id = ?').get(c.id).dono, null, 'concessão devolvida');
});

test('canais: número cadastrado — obrigatório, único, trocado só sem sessão', async () => {
  const nav = await entrar({ nome: 'Ana', telefone: '5565999990001', apelido: 'j2a' });
  const sem = await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Sem número', provedor: 'wweb' } });
  assert.equal(sem.status, 400);
  assert.ok(sem.corpo.erro.campos.numero);
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Cadastro', provedor: 'wweb', numero: '+55 (65) 98888-0001' } })).corpo;
  assert.equal(c.numero_mascarado, '+55 65 9••••-0001');
  assert.doesNotMatch(JSON.stringify(c), /5565988880001/, 'número nunca completo na resposta');
  // Mesmo número, com ou sem o nono dígito, não entra em outro canal.
  const dup = await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Repetido', provedor: 'wweb', numero: '556588880001' } });
  assert.equal(dup.status, 409);
  // Troca com o canal parado e sem sessão: aceita. Com sessão salva: pede para remover antes.
  assert.equal((await nav.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { numero: '5565988880002' } })).corpo.numero_mascarado, '+55 65 9••••-0002');
  const pasta = path.join(supervisor.dirSessoes, `session-${db.prepare('SELECT sessao_id s FROM canais WHERE id = ?').get(c.id).s}`);
  fs.mkdirSync(pasta, { recursive: true });
  assert.equal((await nav.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { numero: '5565988880003' } })).status, 409);
  fs.rmSync(pasta, { recursive: true, force: true });
  // Canal antigo sem número não conecta.
  db.prepare('UPDATE canais SET numero = NULL WHERE id = ?').run(c.id);
  assert.equal((await nav.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' })).status, 400);
});

test('canais: QR lido por outro número → desfaz a conexão e não grava mensagens', async () => {
  const nav = await entrar({ nome: 'Ana', telefone: '5565999990001', apelido: 'j2a' });
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Trava', provedor: 'wweb', numero: '5565900000105' } })).corpo;
  await nav.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { numeros_teste: ['5565999875116'] } });
  await nav.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' });
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}`)).corpo.estado === 'qr_pendente');
  supervisor._comandoTeste(c.id, 'simular-leitura', { numero: '5565977770000' });
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}`)).corpo.estado === 'erro');
  supervisor._comandoTeste(c.id, 'simular-mensagem', { de: '5565999875116', texto: 'não deve entrar' });
  const log = JSON.stringify((await nav.ir(`/api/admin/canais/${c.id}/log?limite=200`)).corpo);
  assert.match(log, /lido pelo número \+55 65 9••••-0000, mas este canal é do \+55 65 9••••-0105/);
  assert.doesNotMatch(log, /não deve entrar/);
  assert.equal(db.prepare('SELECT ligado FROM canais WHERE id = ?').get(c.id).ligado, 0, 'não religa sozinho');
  await esperar(() => !supervisor.filhos.has(c.id));
});

test('canais: processo do canal caiu → sobe de novo sozinho', async () => {
  const nav = await entrar({ nome: 'Ana', telefone: '5565999990001', apelido: 'j2a' });
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Queda', provedor: 'wweb', numero: '5565900000101' } })).corpo;
  await nav.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' });
  await esperar(() => supervisor.filhos.has(c.id));
  const primeiro = supervisor.filhos.get(c.id).proc.pid;
  supervisor.filhos.get(c.id).proc.kill();
  await esperar(() => supervisor.filhos.has(c.id) && supervisor.filhos.get(c.id).proc.pid !== primeiro);
  await nav.ir(`/api/admin/canais/${c.id}/desconectar`, { metodo: 'POST' });
});

test('canais: concessão impede dois processos no mesmo número', async () => {
  const nav = await entrar({ nome: 'Ana', telefone: '5565999990001', apelido: 'j2a' });
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Disputado', provedor: 'wweb', numero: '5565900000102' } })).corpo;
  db.prepare('INSERT INTO canal_concessoes (canal_id, dono, ficha, valida_ate) VALUES (?, ?, 1, ?)').run(c.id, 'outro-servidor:1', new Date(Date.now() + 60_000).toISOString());
  const r = await nav.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' });
  assert.equal(r.status, 409);
  assert.equal(supervisor.filhos.has(c.id), false);
});

test('canais: isolamento, empresa vinculada só usa, limpar sessão exige confirmação', async () => {
  const dona = await entrar({ nome: 'Ana', telefone: '5565999990001', apelido: 'j2a' });
  const c = (await dona.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Compartilhado', provedor: 'wweb', numero: '5565900000103' } })).corpo;
  const b = await entrar({ nome: 'Bia', telefone: '5565966660001', empresa: 'Empresa B', apelido: 'empresa-b' });
  assert.equal((await b.ir(`/api/admin/canais/${c.id}`)).status, 404, 'outra empresa não vê');
  const idB = db.prepare("SELECT id FROM empresas WHERE apelido = 'empresa-b'").get().id;
  const idA = db.prepare("SELECT id FROM empresas WHERE apelido = 'j2a'").get().id;
  // Vincular B ao número (a plataforma pode).
  const v = await dona.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { empresas_vinculadas: [{ id: idA, padrao: false }, { id: idB, padrao: true }] } });
  assert.equal(v.status, 200);
  assert.equal((await b.ir(`/api/admin/canais/${c.id}`)).status, 200, 'vinculada passa a ver');
  assert.equal((await b.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' })).status, 403, 'vinculada não conecta');
  assert.equal((await dona.ir(`/api/admin/canais/${c.id}/limpar-sessao`, { metodo: 'POST', corpo: {} })).status, 400);
  assert.equal((await dona.ir(`/api/admin/canais/${c.id}/limpar-sessao`, { metodo: 'POST', corpo: { confirmar: true } })).corpo.estado, 'parado');

  // Supervisor sem permissão de configurar não altera o modo de teste.
  const sup = (await dona.ir('/api/admin/usuarios', { metodo: 'POST', corpo: { nome: 'Sup', telefone: '5565955550009', papel: 'supervisor' } })).corpo;
  const navSup = navegador();
  await navSup.ir(`/api/publico/link/${desafios.criarLink(db, { usuarioId: sup.id, empresaId: idA })}`);
  assert.equal((await navSup.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { modo_teste: false } })).status, 403);
});

test('socket: só conecta com sessão válida do Talk', async () => {
  const nav = await entrar({ nome: 'Ana', telefone: '5565999990001', apelido: 'j2a' });
  const ns = { usar: null, use(fn) { this.usar = fn; }, on() {}, fetchSockets: async () => [] };
  configurarTempoReal(ns, { db, supervisor });
  const conectar = (cookie) => new Promise((r) => { const sock = { handshake: { headers: { cookie } }, data: {} }; ns.usar(sock, (err) => r({ err, sock })); });
  const semSessao = await conectar('');
  assert.equal(semSessao.err?.message, 'nao_autenticado');
  assert.equal((await conectar('talk.sid=inventado')).err?.message, 'nao_autenticado');
  const ok = await conectar(nav.cookie());
  assert.equal(ok.err, undefined);
  assert.ok(ok.sock.data.rotinas.includes('talk-canais'));
});

test('tempo real: o supervisor avisa estado, QR e log do canal', async () => {
  const nav = await entrar({ nome: 'Ana', telefone: '5565999990001', apelido: 'j2a' });
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Ao vivo', provedor: 'wweb', numero: '5565900000104' } })).corpo;
  const avisos = [];
  const original = supervisor.emitir;
  supervisor.emitir = (canalId, evento, dados) => { if (canalId === c.id) avisos.push(evento); original(canalId, evento, dados); };
  try {
    await nav.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' });
    await esperar(() => avisos.includes('canal:qr'));
    for (const ev of ['canal:estado', 'canal:log', 'canal:qr']) assert.ok(avisos.includes(ev), ev);
    await nav.ir(`/api/admin/canais/${c.id}/desconectar`, { metodo: 'POST' });
  } finally { supervisor.emitir = original; }
});
