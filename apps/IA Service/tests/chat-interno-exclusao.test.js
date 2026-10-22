const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const database = require('../backend/database');
const chat = require('../backend/services/chat-interno-service');
const consultores = require('../backend/repositories/consultor-repository');
const realtime = require('../backend/services/chat-interno-realtime');
const dbPath = path.join(os.tmpdir(), `chat-exclusao-${crypto.randomUUID()}.db`);
const empresa = 99411;
let numero = 0;
const eventos = [];
before(() => {
  process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
  database.inicializarDB(dbPath);
  realtime.iniciar({ of: () => ({ sockets: new Map(), use() {}, on() {}, to: (sala) => ({ emit: (evento, payload) => eventos.push({ sala, evento, payload }) }) }) });
});
after(() => {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
});
function contexto() {
  const pessoa = () => consultores.criarConsultor(empresa, { telefone: `5565992${String(++numero).padStart(6, '0')}` }).id;
  const ana = pessoa(), beto = pessoa(), caio = pessoa();
  const conv = chat.abrirConversaDireta(empresa, ana, beto);
  const enviar = (autor, texto) => chat.enviarMensagem(empresa, autor, conv, texto).mensagem;
  return { ana, beto, caio, conv, enviar };
}
const falha = (fn, status) => assert.throws(fn, (e) => e.status === status);

test('apagar para mim aceita enviadas e recebidas, sem alterar conteúdo, recibos ou histórico do colega', () => {
  const { ana, beto, conv, enviar } = contexto();
  const enviada = enviar(ana, 'Enviada'), recebida = enviar(beto, 'Recebida');
  const resultado = chat.excluirMensagens(empresa, ana, conv, { modo: 'mim', mensagemIds: [enviada.id, recebida.id] });
  assert.equal(resultado.total, 2);
  assert.equal(chat.listarMensagens(empresa, ana, conv).mensagens.length, 0);
  assert.equal(chat.listarMensagens(empresa, beto, conv).mensagens.length, 2);
  const contato = chat.listarContatos(empresa, ana).contatos.find((c) => c.consultorId === beto);
  assert.equal(contato.ultimaMensagem, null);
  assert.equal(contato.naoLidas, 0);
  assert.equal(chat.listarContatos(empresa, beto).contatos.find((c) => c.consultorId === ana).naoLidas, 1);
  assert.equal(chat.marcarVistas(empresa, ana, conv).length, 0);
  assert.equal(chat.marcarEntregues(empresa, ana).length, 0);
  assert.equal(database.getDB().prepare('SELECT visto_em FROM svc_chat_recibos WHERE mensagem_id = ?').get(recebida.id).visto_em, null);
  assert.equal(chat.excluirMensagens(empresa, ana, conv, { modo: 'mim', mensagemIds: [enviada.id, recebida.id] }).total, 0);
  falha(() => chat.editarMensagem(empresa, ana, conv, enviada.id, 'Oculta'), 404);
  assert.equal(chat.mensagemVisivel(empresa, ana, recebida.id), false);
  assert.equal(chat.mensagemVisivel(empresa, beto, recebida.id), true);
  const editada = chat.editarMensagem(empresa, beto, conv, recebida.id, 'Correção');
  eventos.length = 0;
  realtime.emitirMensagem(empresa, editada, 'chat:mensagem-alterada');
  assert.deepEqual(eventos.map((e) => e.sala), [`e${empresa}:c${beto}`]);
  database.fecharDB(); database.inicializarDB(dbPath);
  assert.equal(chat.listarMensagens(empresa, ana, conv).mensagens.length, 0, 'exclusão pessoal persiste ao reabrir');
  assert.equal(chat.listarMensagens(empresa, beto, conv).mensagens[1].texto, 'Correção');
});

test('seleção múltipla valida empresa, conversa, autoria, limites e cancela lotes inválidos por inteiro', () => {
  const { ana, beto, caio, conv, enviar } = contexto();
  const minha = enviar(ana, 'Minha'), dele = enviar(beto, 'Dele');
  falha(() => chat.excluirMensagens(empresa, ana, conv, { modo: 'todos', mensagemIds: [minha.id, dele.id] }), 403);
  assert.equal(chat.listarMensagens(empresa, ana, conv).mensagens[0].apagadoEm, null);
  falha(() => chat.excluirMensagens(empresa, ana, conv, { modo: 'mim', mensagemIds: [minha.id, 'inexistente'] }), 404);
  assert.equal(chat.listarMensagens(empresa, ana, conv).mensagens.length, 2);
  falha(() => chat.excluirMensagens(empresa + 1, ana, conv, { modo: 'mim', todas: true }), 404);
  falha(() => chat.excluirMensagens(empresa, caio, conv, { modo: 'mim', todas: true }), 404);
  const outra = chat.abrirConversaDireta(empresa, ana, caio);
  falha(() => chat.excluirMensagens(empresa, ana, outra, { modo: 'mim', mensagemIds: [minha.id] }), 404);
  for (const dados of [null, [], { modo: 'todos', todas: true }, { modo: 'mim', mensagemIds: [] }, { modo: 'x', mensagemIds: [minha.id] }, { modo: 'mim', todas: 'true' }, { modo: 'mim', mensagemIds: [1] }, { modo: 'mim', mensagemIds: Array(501).fill(minha.id) }]) {
    falha(() => chat.excluirMensagens(empresa, ana, conv, dados), 400);
  }
  const outraMinha = enviar(ana, 'Outra minha');
  const lote = chat.excluirMensagens(empresa, ana, conv, { modo: 'todos', mensagemIds: [minha.id, outraMinha.id, minha.id] });
  assert.equal(lote.alteradas.length, 2);
  assert.ok(lote.alteradas.every((a) => a.mensagem.apagadoEm));
  const depois = chat.listarMensagens(empresa, beto, conv).mensagens;
  assert.equal(depois[1].texto, 'Dele');
  assert.equal(depois[0].texto, 'Mensagem apagada');
  consultores.atualizarConsultor(empresa, ana, { ativo: false });
  falha(() => chat.excluirMensagens(empresa, ana, conv, { modo: 'mim', todas: true }), 403);
});

test('limpar conversa inclui páginas antigas, preserva o colega e permite novas mensagens', () => {
  const { ana, beto, conv, enviar } = contexto();
  for (let i = 0; i < 75; i++) enviar(i % 2 ? ana : beto, `Histórico ${i}`);
  assert.equal(chat.listarMensagens(empresa, ana, conv).mensagens.length, 60);
  const limpeza = chat.excluirMensagens(empresa, ana, conv, { modo: 'mim', todas: true });
  assert.equal(limpeza.total, 75);
  assert.ok(limpeza.ateSequencia > 0);
  assert.equal(chat.listarMensagens(empresa, ana, conv).mensagens.length, 0);
  assert.equal(chat.listarMensagens(empresa, ana, conv, { antesDe: '2099' }).mensagens.length, 0);
  assert.equal(chat.listarMensagens(empresa, beto, conv).mensagens.length, 60);
  assert.equal(chat.excluirMensagens(empresa, ana, conv, { modo: 'mim', todas: true }).total, 0);
  const nova = enviar(beto, 'Depois da limpeza');
  assert.ok(nova.sequencia > limpeza.ateSequencia);
  assert.deepEqual(chat.listarMensagens(empresa, ana, conv).mensagens.map((m) => m.id), [nova.id]);
  assert.equal(chat.listarContatos(empresa, ana).contatos.find((c) => c.consultorId === beto).naoLidas, 1);
  assert.equal(database.getDB().pragma('foreign_key_check').length, 0);
});

test('API de exclusão pessoal emite somente na sala de quem apagou e lote para todos usa o evento de alteração', async () => {
  const { ana, beto, conv, enviar } = contexto();
  const minha = enviar(ana, 'Minha'), dele = enviar(beto, 'Dele');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.svcEmpresaId = empresa; req.svcConsultorExterno = ana; next(); });
  require('../backend/routes/chat-interno-routes')(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/ia-service-externo/chat-interno/conversas/${conv}/excluir-mensagens`;
    const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    eventos.length = 0;
    let res = await post({ modo: 'mim', mensagemIds: [dele.id] });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).mensagemIds, [dele.id]);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].sala, `e${empresa}:c${ana}`);
    assert.equal(eventos[0].evento, 'chat:mensagens-ocultas');
    eventos.length = 0;
    res = await post({ modo: 'todos', mensagemIds: [minha.id] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mensagens[0].texto, 'Mensagem apagada');
    assert.equal(eventos.length, 2);
    assert.ok(eventos.every((e) => e.evento === 'chat:mensagem-alterada'));
    eventos.length = 0;
    res = await post({ modo: 'todos', todas: true });
    assert.equal(res.status, 400); await res.json();
    assert.equal(eventos.length, 0);
    res = await post({ modo: 'mim', todas: true });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).ateSequencia >= minha.sequencia);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].sala, `e${empresa}:c${ana}`);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
