// node "apps/IA Service/tests/chat-interno-edicao.test.js"
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const migrations = require('../backend/database/migrations');
const database = require('../backend/database');
const chat = require('../backend/services/chat-interno-service');
const consultores = require('../backend/repositories/consultor-repository');
const realtime = require('../backend/services/chat-interno-realtime');
const dbPath = path.join(os.tmpdir(), `chat-edicao-${crypto.randomUUID()}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');

(async () => {
  let server;
  try {
    // Atualização de uma base v50 com conteúdo existente, sem tocar na base real.
    const antiga = new Database(dbPath);
    for (const m of migrations.filter((m) => m.version < 51)) antiga.exec(m.sql);
    antiga.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, descricao TEXT, aplicado_em TEXT NOT NULL)`);
    for (const m of migrations.filter((m) => m.version < 51)) {
      antiga.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(m.version, m.descricao, new Date().toISOString());
    }
    antiga.prepare('INSERT INTO svc_chat_conversas VALUES (?, ?, ?, ?, ?)').run('legado', 1, 'a|b', '2026-01-01', '2026-01-01');
    antiga.prepare('INSERT INTO svc_chat_mensagens VALUES (?, ?, ?, ?, ?, ?, ?)').run('antiga', 'legado', 1, 'a', 'Conteúdo preservado', 0, '2026-01-01');
    antiga.close();
    database.inicializarDB(dbPath);
    const preservada = database.getDB().prepare('SELECT * FROM svc_chat_mensagens WHERE id = ?').get('antiga');
    assert.equal(preservada.texto, 'Conteúdo preservado');
    assert.equal(preservada.editado_em, null);
    assert.equal(preservada.apagado_em, null);

    const empresa = 99401;
    const ana = consultores.criarConsultor(empresa, { telefone: '5565991000001' });
    const beto = consultores.criarConsultor(empresa, { telefone: '5565991000002' });
    const caio = consultores.criarConsultor(empresa, { telefone: '5565991000003' });
    const conv = chat.abrirConversaDireta(empresa, ana.id, beto.id);
    const outraConv = chat.abrirConversaDireta(empresa, ana.id, caio.id);
    const enviada = chat.enviarMensagem(empresa, ana.id, conv, 'Original').mensagem;
    const falha = (fn, status) => assert.throws(fn, (e) => e.status === status);
    for (const metodo of ['editarMensagem', 'apagarMensagem']) {
      falha(() => chat[metodo](empresa, beto.id, conv, enviada.id, 'Invasão'), 403);
      falha(() => chat[metodo](empresa, caio.id, conv, enviada.id, 'Invasão'), 404);
      falha(() => chat[metodo](empresa + 1, ana.id, conv, enviada.id, 'Invasão'), 404);
      falha(() => chat[metodo](empresa, ana.id, outraConv, enviada.id, 'Invasão'), 404);
      falha(() => chat[metodo](empresa, ana.id, conv, 'inexistente', 'Invasão'), 404);
    }
    falha(() => chat.editarMensagem(empresa, ana.id, conv, enviada.id, '  '), 400);
    falha(() => chat.editarMensagem(empresa, ana.id, conv, enviada.id, 'x'.repeat(1001)), 400);
    const editada = chat.editarMensagem(empresa, ana.id, conv, enviada.id, '  Corrigida <script>  ').mensagem;
    assert.equal(editada.texto, 'Corrigida <script>');
    assert.ok(editada.editadoEm);
    assert.equal(editada.criadoEm, enviada.criadoEm);
    assert.equal(chat.listarMensagens(empresa, beto.id, conv).mensagens[0].texto, editada.texto);
    assert.equal(chat.listarContatos(empresa, beto.id).naoLidasTotal, 1);
    assert.ok(database.getDB().prepare('SELECT texto FROM svc_chat_mensagens WHERE id = ?').get(enviada.id).texto.startsWith('svcchat:v1:'));

    // Rotas reais e eventos para as salas do autor e destinatário.
    const eventos = [];
    const ns = { sockets: new Map(), use() {}, on() {}, to: (sala) => ({ emit: (evento, payload) => eventos.push({ sala, evento, payload }) }) };
    realtime.iniciar({ of: () => ns });
    let usuario = ana.id;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.svcEmpresaId = empresa; req.svcConsultorExterno = usuario; next(); });
    require('../backend/routes/chat-interno-routes')(app);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${server.address().port}/api/ia-service-externo/chat-interno/conversas/${conv}/mensagens/${enviada.id}`;
    let res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Via API' }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).texto, 'Via API');
    assert.equal(eventos.length, 2);
    assert.ok(eventos.every((e) => e.evento === 'chat:mensagem-alterada'));
    assert.deepEqual(eventos.map((e) => e.sala), [`e${empresa}:c${beto.id}`, `e${empresa}:c${ana.id}`]);
    assert.deepEqual(eventos.map((e) => e.payload.minha), [false, true]);
    usuario = beto.id;
    for (const method of ['PATCH', 'DELETE']) {
      res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'PATCH' ? JSON.stringify({ texto: 'Invasão' }) : undefined });
      assert.equal(res.status, 403);
      await res.json();
    }
    assert.equal(eventos.length, 2, 'operações negadas não emitem eventos');
    usuario = ana.id;
    res = await fetch(url, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const apagada = await res.json();
    assert.equal(apagada.texto, 'Mensagem apagada');
    assert.ok(apagada.apagadoEm);
    assert.equal(chat.apagarMensagem(empresa, ana.id, conv, enviada.id).mensagem.apagadoEm, apagada.apagadoEm);
    falha(() => chat.editarMensagem(empresa, ana.id, conv, enviada.id, 'Restaurar'), 409);
    assert.equal(chat.listarContatos(empresa, beto.id).naoLidasTotal, 0);
    assert.equal(chat.listarContatos(empresa, beto.id).contatos.find((c) => c.consultorId === ana.id).ultimaMensagem.texto, 'Mensagem apagada');
    assert.equal(chat.marcarEntregues(empresa, beto.id).length, 0);
    assert.equal(chat.marcarVistas(empresa, beto.id, conv).length, 0);
    assert.equal(database.getDB().prepare('SELECT texto FROM svc_chat_mensagens WHERE id = ?').get(enviada.id).texto, '');
    const pendente = chat.enviarMensagem(empresa, ana.id, conv, 'Mensagem com recibos').mensagem;
    realtime.emitirMensagem(empresa, { mensagem: pendente, destinatario: beto.id });
    assert.ok(eventos.slice(-2).every((e) => e.evento === 'chat:mensagem'), 'envios continuam usando o evento original');
    chat.marcarVistas(empresa, beto.id, conv);
    const comRecibos = chat.editarMensagem(empresa, ana.id, conv, pendente.id, 'Correção com recibos').mensagem;
    assert.ok(comRecibos.vistoEm && comRecibos.entregueEm);
    // Uma transmissão é armazenada como cópias independentes por conversa.
    const copia = chat.enviarMensagem(empresa, ana.id, outraConv, 'Mensagem com recibos').mensagem;
    database.getDB().prepare('UPDATE svc_chat_mensagens SET transmissao = 1 WHERE id IN (?, ?)').run(pendente.id, copia.id);
    chat.editarMensagem(empresa, ana.id, conv, pendente.id, 'Correção com recibos');
    chat.apagarMensagem(empresa, ana.id, outraConv, copia.id);
    assert.equal(chat.listarMensagens(empresa, beto.id, conv).mensagens[1].texto, 'Correção com recibos');
    falha(() => chat.enviarParaTodos(empresa, ana.id, 'Disparo imediato'), 429);
    consultores.atualizarConsultor(empresa, ana.id, { ativo: false });
    falha(() => chat.editarMensagem(empresa, ana.id, conv, pendente.id, 'Inativo'), 403);
    falha(() => chat.apagarMensagem(empresa, ana.id, conv, pendente.id), 403);

    database.fecharDB();
    database.inicializarDB(dbPath);
    const historico = chat.listarMensagens(empresa, beto.id, conv).mensagens;
    assert.equal(historico[0].apagadoEm, apagada.apagadoEm);
    assert.equal(historico[0].texto, 'Mensagem apagada');
    assert.equal(historico[1].texto, 'Correção com recibos');
    assert.ok(historico[1].editadoEm >= comRecibos.editadoEm);
    assert.equal(historico[1].vistoEm, comRecibos.vistoEm);
    assert.equal(database.getDB().pragma('foreign_key_check').length, 0);
    console.log('chat-interno-edicao.test.js: OK (migração v50→v51, autoria, empresa, API, eventos, criptografia, recibos, exclusão e reabertura)');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
