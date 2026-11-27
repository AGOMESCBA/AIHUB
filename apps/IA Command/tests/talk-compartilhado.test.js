'use strict';

// IA Talk — número compartilhado (C9, parte 2). Testa o caminho REAL da mensagem no
// IA Command (WhatsAppService._handleMessage) com o banco do IA Command em memória e
// TODAS as migrações aplicadas. Nada toca data/ia-command.db nem o banco do IAHub.
//
// Cenário que imita produção: um canal com três empresas (J2A, Plantivo, C3I), cada uma
// com seus números autorizados; mensagens de autorizados, de não autorizados, com e sem
// o nono dígito, com o código interno do WhatsApp (@lid), áudio, e o banco falhando.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');

// 1) Banco em memória com todas as migrações, ANTES de carregar qualquer módulo do IA Command.
const MIGRACOES = require('../modules/database/migrations');
let db = new Database(':memory:');
db.pragma('foreign_keys = ON');
for (const m of [...MIGRACOES].sort((a, b) => a.version - b.version)) { db.exec(m.sql || ''); if (m.run) m.run(db); }
const bancoIaCommand = require('../modules/database');
bancoIaCommand.getDB = () => db;
// Nome da empresa vem do banco do IAHub: aqui, nomes fixos (sem abrir banco nenhum).
const NOMES = { 1: 'J2A Consultoria', 7: 'Plantivo', 9: 'C3I Systems' };
require.cache[require.resolve(path.join(__dirname, '../../../modules/empresas/database'))] = {
  exports: { buscarPorId: (id) => ({ razao_social: NOMES[id] }) },
};

const WhatsAppService = require('../modules/whatsapp/service');
const talk = require('../modules/whatsapp/talk-compartilhado');
const rotasExternas = require('../modules/whatsapp/servico-externo-routes');
const templates = require('../modules/whatsapp/message-templates');

const CANAL = 'ch_j2a';
const NUMERO_CANAL = '5565999991752';
const t0 = new Date().toISOString();
db.prepare(`INSERT INTO whatsapp_channels (id, nome, numero, provider, auth_client_id, ativo, criado_em, atualizado_em)
  VALUES (?, 'Canal J2A', ?, 'wweb', 'iac_ch_j2a', 1, ?, ?)`).run(CANAL, NUMERO_CANAL, t0, t0);
let k = 0;
for (const empresa of [1, 7, 9]) {
  db.prepare(`INSERT INTO whatsapp_channel_companies (id, channel_id, empresa_id, padrao, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 1, ?, ?)`).run(`cc${++k}`, CANAL, empresa, empresa === 1 ? 1 : 0, t0, t0);
}
const autorizar = (empresa, numero, lid = null) => db.prepare(`INSERT INTO whatsapp_allowed_numbers (empresa_id, nome, numero, wa_lid, ativo, criado_em, atualizado_em)
  VALUES (?, ?, ?, ?, 1, ?, ?)`).run(empresa, `Usuário ${numero.slice(-4)}`, numero, lid, t0, t0);
autorizar(1, '5565999995116');           // usuário da J2A (com o nono dígito)
autorizar(7, '556598887777');            // Plantivo, cadastrado SEM o nono dígito
autorizar(9, '5565977776666', '123456789012345'); // C3I, com código interno do WhatsApp
// Chave do canal e "estou vivo" do Talk (por padrão, Talk no ar: sinal de agora).
const ligarChave = (v, { talkNoAr = true } = {}) => db.prepare('UPDATE whatsapp_channels SET repassar_nao_autorizados_talk = ?, talk_batimento_em = ? WHERE id = ?')
  .run(v, talkNoAr ? new Date().toISOString() : null, CANAL);

// 2) Serviço real, com só o WhatsApp de verdade trocado por uma mensagem falsa.
let seq = 0;
function servico() {
  const svc = new WhatsAppService();
  svc._empresaId = 1;
  svc._channelId = CANAL;
  svc._channelName = 'Canal J2A';
  svc.logs = [];
  svc.log = (m, tipo) => svc.logs.push([tipo, m]);
  svc.logLocal = () => {};
  svc.assistente = [];
  svc._handleText = async (_msg, sender) => { svc.assistente.push(['texto', sender]); };
  svc._handleAudio = async (_msg, sender) => { svc.assistente.push(['audio', sender]); };
  return svc;
}
function mensagem({ from, body = 'Qual o faturamento de hoje?', type = 'chat', contato = null, falhaEnvio = false }) {
  const enviados = [];
  return {
    enviados,
    msg: {
      // Como o whatsapp-web.js entrega: id.id é o ID final (igual nas duas cópias); _serialized traz o remetente.
      fromMe: false, id: (() => { const k = `3EB0${String(++seq).padStart(6, "0")}`; return { fromMe: false, remote: from, id: k, _serialized: `false_${from}_${k}` }; })(), timestamp: Math.floor(Date.now() / 1000), from, type, body,
      getContact: async () => contato || { number: from.split('@')[0], id: { _serialized: from } },
      getChat: async () => ({ sendMessage: async (t) => { if (falhaEnvio) throw new Error('sem conexão'); enviados.push(t); } }),
    },
  };
}
talk._test.definirEsperaRecibo(300); // em produção: 8 s
// O Talk conferiu a mensagem e vai gravá-la (é o que ele faz ao receber a cópia): vale como recibo.
// O que o Talk real faz ao receber a cópia: pede a decisão (rota talk/decisao).
const reciboDoTalk = (numero, msg) => talk.decidirMensagem(NUMERO_CANAL, numero, msg.id.id, msg.body);
const limparEstado = () => { db.exec('DELETE FROM talk_atendimentos; DELETE FROM talk_recebimentos; DELETE FROM talk_recibos_mensagem; DELETE FROM talk_recibos_expirados; DELETE FROM talk_retorno_assistente;'); };
const AVISO_NAO_AUTORIZADO = templates.render(1, 'numero_nao_autorizado', { numero: '5565911112222', canal_nome: 'Canal J2A' });

test('chave DESLIGADA (padrão): comportamento idêntico ao de hoje', async () => {
  ligarChave(0);
  assert.equal(db.prepare('SELECT repassar_nao_autorizados_talk AS v FROM whatsapp_channels WHERE id = ?').get(CANAL).v, 0);

  // Não autorizado recebe o aviso de sempre.
  const svc = servico();
  const nao = mensagem({ from: '5565911112222@c.us' });
  await svc._handleMessage(nao.msg);
  assert.deepEqual(nao.enviados, [AVISO_NAO_AUTORIZADO]);
  assert.equal(svc.assistente.length, 0);

  // Autorizado (das três empresas) vai para o assistente, inclusive escrevendo "atendente".
  for (const from of ['5565999995116@c.us', '5565998887777@c.us', '5565977776666@c.us']) {
    const s = servico();
    const m = mensagem({ from, body: 'atendente' });
    await s._handleMessage(m.msg);
    assert.deepEqual(s.assistente, [['texto', from]], `assistente responde ${from}`);
    assert.deepEqual(m.enviados, [], 'nenhum aviso de atendimento com a chave desligada');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM talk_atendimentos').get().n, 0);
});

test('chave LIGADA: não autorizado fica em silêncio (o Talk atende); autorizado segue com o assistente', async () => {
  ligarChave(1);
  const svc = servico();
  const nao = mensagem({ from: '5565911112222@c.us' });
  reciboDoTalk('5565911112222', nao.msg);
  await svc._handleMessage(nao.msg);
  assert.deepEqual(nao.enviados, [], 'sem o aviso de não autorizado');
  assert.equal(svc.assistente.length, 0, 'assistente não responde');
  assert.ok(svc.logs.some(([, l]) => /deixado para o IA Talk/.test(l)));

  // Mensagem comum de autorizado: assistente, como sempre (Plantivo cadastrada sem o nono dígito).
  const s2 = servico();
  const aut = mensagem({ from: '5565998887777@c.us', body: 'faturamento de hoje' });
  await s2._handleMessage(aut.msg);
  assert.deepEqual(s2.assistente, [['texto', '5565998887777@c.us']]);
  assert.deepEqual(aut.enviados, []);

  // Não autorizado só com o código interno do WhatsApp (@lid, telefone não resolvido): aviso de sempre,
  // porque o Talk poderia não reconhecer a pessoa e ninguém responderia.
  const s3 = servico();
  const lid = mensagem({ from: '999999999999999@lid', contato: { number: null, id: { _serialized: '999999999999999@lid' } } });
  await s3._handleMessage(lid.msg);
  assert.equal(lid.enviados.length, 1, 'sem telefone resolvido: comportamento de hoje');
});

test('autorizado escreve "atendente": passa para o Talk; depois fica em silêncio; "voltar ao assistente" volta', async () => {
  ligarChave(1);
  const from = '5565999995116@c.us';
  const s1 = servico();
  const pede = mensagem({ from, body: '  Quero falar com um ATENDENTE! ' });
  reciboDoTalk('5565999995116', pede.msg);
  await s1._handleMessage(pede.msg);
  assert.deepEqual(pede.enviados, [talk.TEXTOS.passar]);
  assert.equal(s1.assistente.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM talk_atendimentos WHERE channel_id = ?').get(CANAL).n, 1);

  // Durante o atendimento: texto e áudio não chegam ao assistente, sem resposta automática.
  for (const [type, body] of [['chat', 'o boleto não chegou'], ['ptt', '']]) {
    const s = servico();
    const m = mensagem({ from, body, type });
    reciboDoTalk('5565999995116', m.msg);
    await s._handleMessage(m.msg);
    assert.equal(s.assistente.length, 0, `${type} fica com o atendente`);
    assert.deepEqual(m.enviados, []);
  }
  // O mesmo número sem o nono dígito também está em atendimento.
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '556599995116').em_atendimento, true);

  const s4 = servico();
  const volta = mensagem({ from, body: 'Voltar ao assistente' });
  await s4._handleMessage(volta.msg);
  assert.deepEqual(volta.enviados, [talk.TEXTOS.voltar]);
  const s5 = servico();
  await s5._handleMessage(mensagem({ from, body: 'faturamento de hoje' }).msg);
  assert.deepEqual(s5.assistente, [['texto', from]], 'assistente voltou');

  // "atendente" no meio de uma frase NÃO é pedido de atendimento (palavra fixa, a mensagem inteira).
  const s6 = servico();
  const frase = mensagem({ from, body: 'qual o atendente que mais vendeu?' });
  await s6._handleMessage(frase.msg);
  assert.deepEqual(s6.assistente, [['texto', from]]);
  assert.deepEqual(frase.enviados, []);
});

test('4 h sem mensagem: o atendimento vence e o assistente volta sozinho', () => {
  ligarChave(1);
  const agora = Date.now();
  talk._test.iniciar(CANAL, '5565999995116', agora - talk.VALIDADE_MS - 60_000);
  assert.equal(talk.desvioAutorizado(CANAL, '5565999995116@c.us', 'faturamento', agora), null, 'vencido: segue normal');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM talk_atendimentos').get().n, 0, 'linha vencida apagada');
  // Dentro do prazo, cada mensagem renova as 4 h.
  talk._test.iniciar(CANAL, '5565999995116', agora - talk.VALIDADE_MS + 60_000);
  assert.ok(talk.desvioAutorizado(CANAL, '5565999995116@c.us', 'oi', agora));
  // Quase 4 h depois (o Talk continuou mandando o "estou vivo" a cada minuto).
  db.prepare('UPDATE whatsapp_channels SET talk_batimento_em = ? WHERE id = ?').run(new Date(agora + talk.VALIDADE_MS - 30_000).toISOString(), CANAL);
  assert.ok(talk.desvioAutorizado(CANAL, '5565999995116@c.us', 'oi', agora + talk.VALIDADE_MS - 1000), 'renovado pela mensagem anterior');
  talk._test.encerrar(CANAL, '5565999995116');
});

test('falha no banco ou no envio: o IA Command responde como hoje (nunca fica mudo por defeito)', async () => {
  ligarChave(1);
  const real = db;
  // Banco quebrado só para a regra nova: a consulta da chave lança erro.
  const quebrado = new Proxy(real, { get: (alvo, p) => (p === 'prepare'
    ? (sql) => { if (/repassar_nao_autorizados_talk|talk_atendimentos/.test(sql)) throw new Error('disco cheio'); return alvo.prepare(sql); }
    : (typeof alvo[p] === 'function' ? alvo[p].bind(alvo) : alvo[p])) });
  db = quebrado;
  try {
    const s = servico();
    const nao = mensagem({ from: '5565911112222@c.us' });
    await s._handleMessage(nao.msg);
    assert.deepEqual(nao.enviados, [AVISO_NAO_AUTORIZADO], 'não autorizado recebe o aviso de sempre');
    const s2 = servico();
    const aut = mensagem({ from: '5565999995116@c.us', body: 'atendente' });
    await s2._handleMessage(aut.msg);
    assert.deepEqual(s2.assistente, [['texto', '5565999995116@c.us']], 'autorizado segue com o assistente');
  } finally {
    db = real;
  }
  // Falha ao mandar o aviso de passagem: registra, não quebra, e o atendimento fica marcado.
  const s3 = servico();
  const falha = mensagem({ from: '5565977776666@c.us', body: 'atendente', falhaEnvio: true });
  setTimeout(() => reciboDoTalk('5565977776666', falha.msg), 10);
  await s3._handleMessage(falha.msg);
  assert.ok(s3.logs.some(([tipo, l]) => tipo === 'warning' && /não foi possível enviar o aviso.*passagem desfeita/.test(l)));
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565977776666').em_atendimento, false, 'sem o aviso, a passagem é desfeita: continua com o assistente');
  const s4 = servico();
  await s4._handleMessage(mensagem({ from: '5565977776666@c.us', body: 'faturamento' }).msg);
  assert.deepEqual(s4.assistente, [['texto', '5565977776666@c.us']]);
});

test('o que o IA Talk consulta: estado do número e encerramento (com e sem o nono dígito)', () => {
  ligarChave(1);
  assert.deepEqual(talk.estadoDoNumero(NUMERO_CANAL, '5565911112222'), { canal_encontrado: true, repassar_ligado: true, autorizado: false, em_atendimento: false });
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565998887777').autorizado, true, 'Plantivo cadastrada sem o nono dígito');
  assert.equal(talk.estadoDoNumero('556599991752', '5565999995116').canal_encontrado, true, 'canal informado sem o nono dígito');
  assert.equal(talk.estadoDoNumero('5565900000000', '5565999995116').canal_encontrado, false, 'número de canal que não existe');
  talk.desvioAutorizado(CANAL, '5565999995116@c.us', 'atendente');
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565999995116').em_atendimento, true);
  assert.deepEqual(talk.encerrarPorNumero(NUMERO_CANAL, '556599995116'), { canal_encontrado: true, encerrados: 1 });
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565999995116').em_atendimento, false);
  ligarChave(0);
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565911112222').repassar_ligado, false);
});

test('rotas internas: só de 127.0.0.1, sem proxy e com o segredo', async () => {
  const rotas = {};
  const app = { get: (r, fn) => { rotas[`GET ${r}`] = fn; }, post: (r, fn) => { rotas[`POST ${r}`] = fn; } };
  rotasExternas(app);
  const segredoAntes = process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET;
  process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET = 'segredo-falso-de-teste';
  const chamar = (rota, { headers = {}, ip = '127.0.0.1', query = {}, body = {} } = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(c) { resolve({ status: this.statusCode, corpo: c }); } };
    rotas[rota]({ headers, socket: { remoteAddress: ip }, query, body }, res);
  });
  const ok = { 'x-servico-externo-secret': 'segredo-falso-de-teste' };
  try {
    ligarChave(1);
    for (const rota of ['POST /api/ia-command/whatsapp/talk/mensagem', 'POST /api/ia-command/whatsapp/talk/decisao', 'POST /api/ia-command/whatsapp/talk/batimento',
      'POST /api/ia-command/whatsapp/talk/atendimento-iniciado', 'POST /api/ia-command/whatsapp/talk/atendimento-encerrado']) {
      const corpo = { canal: NUMERO_CANAL, numero: '5565911112222' };
      assert.equal((await chamar(rota, { body: corpo })).status, 403, `${rota}: sem segredo`);
      assert.equal((await chamar(rota, { headers: { ...ok, 'x-forwarded-for': '200.1.1.1' }, body: corpo })).status, 403, `${rota}: via proxy (internet)`);
      assert.equal((await chamar(rota, { headers: ok, ip: '10.0.0.8', body: corpo })).status, 403, `${rota}: de outra máquina`);
      assert.equal((await chamar(rota, { headers: ok, body: {} })).status, 400, `${rota}: sem dados`);
    }
    const r = await chamar('POST /api/ia-command/whatsapp/talk/mensagem', { headers: ok, body: { canal: NUMERO_CANAL, numero: '+55 65 91111-2222', texto: 'oi' } });
    assert.deepEqual(r.corpo, { canal_encontrado: true, repassar_ligado: true, autorizado: false, em_atendimento: false });
    // Talk recebeu "atendente" de um autorizado ANTES do IA Command: a passagem é marcada aqui mesmo.
    const antes = await chamar('POST /api/ia-command/whatsapp/talk/mensagem', { headers: ok, body: { canal: NUMERO_CANAL, numero: '5565998887777', texto: 'Atendente' } });
    assert.equal(antes.corpo.em_atendimento, true);
    const s2 = servico();
    const copia = mensagem({ from: '5565998887777@c.us', body: 'Atendente' });
    reciboDoTalk('5565998887777', copia.msg);
    await s2._handleMessage(copia.msg);
    assert.deepEqual(copia.enviados, [talk.TEXTOS.passar], 'a cópia do IA Command ainda manda o aviso de passagem (uma vez)');
    assert.equal(s2.assistente.length, 0);
    talk.encerrarPorNumero(NUMERO_CANAL, '5565998887777');
    const b = await chamar('POST /api/ia-command/whatsapp/talk/batimento', { headers: ok, body: { canal: NUMERO_CANAL } });
    assert.deepEqual(b.corpo, { ok: true, canal_encontrado: true, repassar_ligado: true });
    // O Talk abriu conversa com uma pessoa autorizada: a resposta dela vai para o atendente.
    const i = await chamar('POST /api/ia-command/whatsapp/talk/atendimento-iniciado', { headers: ok, body: { canal: NUMERO_CANAL, numero: '5565999995116' } });
    assert.deepEqual(i.corpo, { ok: true, canal_encontrado: true, repassar_ligado: true });
    const s = servico();
    const resposta = mensagem({ from: '5565999995116@c.us', body: 'respondendo ao atendente' });
    reciboDoTalk('5565999995116', resposta.msg);
    await s._handleMessage(resposta.msg);
    assert.equal(s.assistente.length, 0, 'resposta da pessoa fica com o atendente');
    assert.equal((await chamar('POST /api/ia-command/whatsapp/talk/atendimento-iniciado', { headers: {}, body: { canal: NUMERO_CANAL, numero: '1' } })).status, 403);
    const e = await chamar('POST /api/ia-command/whatsapp/talk/atendimento-encerrado', { headers: ok, body: { canal: NUMERO_CANAL, numero: '5565999995116' } });
    assert.deepEqual(e.corpo, { ok: true, canal_encontrado: true, encerrados: 1 });
  } finally {
    ligarChave(0);
    if (segredoAntes === undefined) delete process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET; else process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET = segredoAntes;
  }
});

test('Talk fora do ar (sem "estou vivo" há 3 min): o IA Command responde como hoje, mesmo com a chave ligada', async () => {
  ligarChave(1, { talkNoAr: false });
  const s1 = servico();
  const nao = mensagem({ from: '5565911112222@c.us' });
  await s1._handleMessage(nao.msg);
  assert.deepEqual(nao.enviados, [AVISO_NAO_AUTORIZADO], 'não autorizado recebe o aviso de sempre');

  const s2 = servico();
  const pede = mensagem({ from: '5565999995116@c.us', body: 'atendente' });
  await s2._handleMessage(pede.msg);
  assert.deepEqual(pede.enviados, [talk.TEXTOS.indisponivel], 'avisa que o atendimento não está disponível');
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565999995116').em_atendimento, false, 'não passa');

  // Sinal velho (mais de 3 min) vale como fora do ar.
  db.prepare('UPDATE whatsapp_channels SET talk_batimento_em = ? WHERE id = ?').run(new Date(Date.now() - talk.BATIMENTO_MS - 1000).toISOString(), CANAL);
  assert.equal(talk.repassarNaoAutorizado(CANAL, '5565911112222@c.us'), false);

  // Talk cai no meio de um atendimento: a pessoa volta para o assistente.
  ligarChave(1);
  talk.desvioAutorizado(CANAL, '5565999995116@c.us', 'atendente');
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565999995116').em_atendimento, true);
  ligarChave(1, { talkNoAr: false });
  const s3 = servico();
  await s3._handleMessage(mensagem({ from: '5565999995116@c.us', body: 'faturamento de hoje' }).msg);
  assert.deepEqual(s3.assistente, [['texto', '5565999995116@c.us']], 'assistente volta a responder');
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565999995116').em_atendimento, false);
  ligarChave(0);
});

test('migração 97 roda de novo sem erro e não mexe nos dados', () => {
  const m97 = MIGRACOES.find(m => m.version === 97);
  const antes = db.prepare('SELECT id, nome, numero, repassar_nao_autorizados_talk FROM whatsapp_channels').all();
  m97.run(db);
  m97.run(db);
  assert.deepEqual(db.prepare('SELECT id, nome, numero, repassar_nao_autorizados_talk FROM whatsapp_channels').all(), antes);
});

test('sem recibo do Talk para a mensagem (Talk caiu agora, ou descartou pela lista de teste): resposta de sempre', async () => {
  limparEstado();
  ligarChave(1); // sinal de vida recente, mas nenhum recibo desta mensagem
  const s1 = servico();
  const nao = mensagem({ from: '5565922223333@c.us' });
  await s1._handleMessage(nao.msg);
  assert.equal(nao.enviados.length, 1, 'não autorizado recebe o aviso de sempre');
  assert.ok(s1.logs.some(([, l]) => /sem recibo desta mensagem/.test(l)));
  // Em atendimento e sem recibo: o assistente responde (melhor que ninguém).
  talk.desvioAutorizado(CANAL, '5565999995116@c.us', 'atendente');
  const s2 = servico();
  await s2._handleMessage(mensagem({ from: '5565999995116@c.us', body: 'o boleto?' }).msg);
  assert.deepEqual(s2.assistente, [['texto', '5565999995116@c.us']]);
  talk.encerrarPorNumero(NUMERO_CANAL, '5565999995116');
  // Recibo velho (de outra mensagem, antes desta) não vale.
  db.prepare("INSERT OR REPLACE INTO talk_recebimentos (channel_id, numero, mensagem_em) VALUES (?, '5565911112222', ?)").run(CANAL, new Date(Date.now() - 60_000).toISOString());
  const s3 = servico();
  const velho = mensagem({ from: '5565911112222@c.us' });
  await s3._handleMessage(velho.msg);
  assert.equal(velho.enviados.length, 1);
});

test('texto longo que começa com a palavra de atendimento não é pedido de atendimento (nos dois lados)', async () => {
  limparEstado();
  ligarChave(1);
  const texto = 'atendente' + ' '.repeat(191) + 'faturamento de hoje';
  assert.equal(talk.pedeAtendimento(texto), false);
  const e = talk.mensagemNoTalk(NUMERO_CANAL, '5565999995116', texto);
  assert.equal(e.em_atendimento, false, 'a decisão do Talk usa o texto inteiro');
  const s = servico();
  await s._handleMessage(mensagem({ from: '5565999995116@c.us', body: texto }).msg);
  assert.deepEqual(s.assistente, [['texto', '5565999995116@c.us']]);
});

test('"atendente" repetido com o atendimento já em andamento: falha no aviso NÃO desfaz o atendimento', async () => {
  ligarChave(1);
  talk.desvioAutorizado(CANAL, '5565999995116@c.us', 'atendente');
  const s = servico();
  const m = mensagem({ from: '5565999995116@c.us', body: 'atendente', falhaEnvio: true });
  reciboDoTalk('5565999995116', m.msg);
  await s._handleMessage(m.msg);
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565999995116').em_atendimento, true, 'continua em atendimento');
  assert.ok(s.logs.some(([tipo, l]) => tipo === 'warning' && /não foi possível enviar o aviso/.test(l) && !/desfeita/.test(l)));
  talk.encerrarPorNumero(NUMERO_CANAL, '5565999995116');
});

test('chave desligada: o Talk não consegue deixar marcação guardada para quando ela for ligada', () => {
  ligarChave(0);
  assert.deepEqual(talk.iniciarPorNumero(NUMERO_CANAL, '5565999995116'), { canal_encontrado: true, repassar_ligado: false });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM talk_atendimentos').get().n, 0);
  assert.equal(talk.mensagemNoTalk(NUMERO_CANAL, '5565911112222', 'oi').repassar_ligado, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM talk_recebimentos WHERE numero = '5565933330000'").get().n, 0);
  talk.mensagemNoTalk(NUMERO_CANAL, '5565933330000', 'oi');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM talk_recebimentos WHERE numero = '5565933330000'").get().n, 0, 'sem recibo com a chave desligada');
  ligarChave(1);
  const s = servico();
  return s._handleMessage(mensagem({ from: '5565999995116@c.us', body: 'faturamento' }).msg).then(() => {
    assert.deepEqual(s.assistente, [['texto', '5565999995116@c.us']], 'ligar a chave não desvia ninguém sozinho');
  });
});

test('migração 98 completa um banco que já tinha a 97 antiga (caso do banco de desenvolvimento)', () => {
  const antigo = new Database(':memory:');
  antigo.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, descricao TEXT, aplicado_em TEXT NOT NULL)');
  for (const m of [...MIGRACOES].sort((a, b) => a.version - b.version).filter(m => m.version <= 97)) {
    antigo.exec(m.sql || ''); if (m.run) m.run(antigo);
    antigo.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(m.version, m.descricao, 'x');
  }
  const cols = () => antigo.prepare('PRAGMA table_info(whatsapp_channels)').all().map(c => c.name);
  assert.ok(cols().includes('repassar_nao_autorizados_talk') && !cols().includes('talk_batimento_em'), 'como ficou o banco de desenvolvimento');
  const m98 = MIGRACOES.find(m => m.version === 98);
  m98.run(antigo);
  m98.run(antigo);
  assert.ok(cols().includes('talk_batimento_em'));
  assert.ok(antigo.prepare("SELECT 1 FROM sqlite_master WHERE name = 'talk_recebimentos'").get());
});


test('recibo é exclusivo do ID da mensagem, mesmo para o mesmo telefone e instante', async () => {
  limparEstado(); ligarChave(1);
  assert.equal(talk.decidirMensagem(NUMERO_CANAL, '5565911112222', 'id-a', 'oi').dono, 'talk');
  assert.equal(await talk.aguardarRecibo(CANAL, '5565911112222@c.us', 'id-a', { esperaMs: 0 }), true);
  assert.equal(await talk.aguardarRecibo(CANAL, '5565911112222@c.us', 'id-b', { esperaMs: 0 }), false);
});

test('reconciliação preserva retorno ao assistente e não renova a última atividade', () => {
  limparEstado(); ligarChave(1);
  const numero = '5565999995116';
  const antes = Date.now() - 60000;
  talk.iniciarPorNumero(NUMERO_CANAL, numero, antes);
  const linha = () => db.prepare('SELECT ultima_atividade_em AS em FROM talk_atendimentos WHERE channel_id = ? AND numero = ?').get(CANAL, numero);
  const original = linha().em;
  talk.iniciarPorNumero(NUMERO_CANAL, numero, Date.now(), original, true);
  assert.equal(linha().em, original);
  talk.desvioAutorizado(CANAL, numero + '@c.us', 'voltar ao assistente');
  assert.equal(talk.iniciarPorNumero(NUMERO_CANAL, numero, Date.now(), new Date().toISOString(), true).ignorado, true);
  assert.equal(linha(), undefined);
});

test('sem recibo da passagem inicial informa indisponibilidade', async () => {
  limparEstado(); ligarChave(1);
  const s = servico(); const m = mensagem({ from: '5565999995116@c.us', body: 'atendente' });
  await s._handleMessage(m.msg);
  assert.deepEqual(m.enviados, [talk.TEXTOS.indisponivel]);
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, '5565999995116').em_atendimento, false);
});


test('migração 99 é aditiva e idempotente com recibos já existentes', () => {
  const antigo = new Database(':memory:');
  antigo.exec("CREATE TABLE talk_recebimentos (channel_id TEXT, numero TEXT, mensagem_em TEXT); INSERT INTO talk_recebimentos VALUES ('canal', '55', 'antes')");
  const m = MIGRACOES.find(x => x.version === 99);
  antigo.exec(m.sql);
  antigo.exec("INSERT INTO talk_recibos_mensagem VALUES ('canal', '55', 'id', 'agora')");
  antigo.exec(m.sql);
  assert.equal(antigo.prepare('SELECT COUNT(*) AS n FROM talk_recebimentos').get().n, 1);
  assert.equal(antigo.prepare('SELECT COUNT(*) AS n FROM talk_recibos_mensagem').get().n, 1);
  antigo.close();
});


test('recibo tardio nao reativa atendimento apos o prazo', async () => {
  limparEstado(); ligarChave(1);
  const numero = '5565999995116';
  assert.equal(await talk.aguardarRecibo(CANAL, numero + '@c.us', 'id-tardio', { esperaMs: 0 }), false);
  // A cópia atrasada do Talk encontra o assistente como dono e não reativa nada.
  assert.equal(talk.decidirMensagem(NUMERO_CANAL, numero, 'id-tardio', 'atendente').dono, 'assistente');
  assert.equal(talk.estadoDoNumero(NUMERO_CANAL, numero).em_atendimento, false);
});


test('duas conexoes SQLite concorrentes escolhem um unico dono por mensagem', async () => {
  const { Worker } = require('node:worker_threads');
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-decisao-')); const arquivo = path.join(dir, 'test.db');
  const banco = new Database(arquivo); banco.pragma('journal_mode = WAL');
  banco.exec(MIGRACOES.find(m => m.version === 100).sql);
  banco.exec(MIGRACOES.find(m => m.version === 100).sql); // reaplicacao sem alterar dados
  MIGRACOES.find(m => m.version === 101).run(banco); // colunas da retomada pelo Talk
  const sinal = new SharedArrayBuffer(4); const flag = new Int32Array(sinal);
  const codigo = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.sqlite);
    const db = new Database(workerData.arquivo); db.pragma('busy_timeout = 5000');
    require(workerData.banco).getDB = () => db;
    const talk = require(workerData.modulo); const flag = new Int32Array(workerData.sinal);
    parentPort.postMessage('pronto'); Atomics.wait(flag, 0, 0);
    const resultados = [];
    for (let i = 0; i < 40; i++) resultados.push(talk.escolherDono('c', '5565999995116', 'm'+i, workerData.dono));
    db.close(); parentPort.postMessage(resultados);
  `;
  const comum = { sqlite: require.resolve('better-sqlite3'), banco: require.resolve('../modules/database'), modulo: require.resolve('../modules/whatsapp/talk-compartilhado'), arquivo, sinal };
  const criar = dono => new Worker(codigo, { eval: true, workerData: { ...comum, dono } });
  const a = criar('talk'), b = criar('assistente');
  const pronto = w => new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); });
  try {
    await Promise.all([pronto(a), pronto(b)]);
    const espera = w => new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); });
    const pa = espera(a), pb = espera(b); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0, 2);
    const [ra, rb] = await Promise.all([pa, pb]);
    assert.deepEqual(ra, rb);
    assert.equal(banco.prepare('SELECT COUNT(*) AS n FROM talk_decisoes_mensagem').get().n, 40);
  } finally { await Promise.all([a.terminate(), b.terminate()]); banco.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Itens finais: ID sem plano B, falha ao gravar o dono, retomada pelo Talk, ID no log ──
const decisao = (numero, id) => db.prepare('SELECT dono, nao_autorizado, respondida_em FROM talk_decisoes_mensagem WHERE mensagem_id = ?').get(id);

test('ID final no monitor; sem id.id não há decisão (nunca usa o _serialized) e o IA Command responde como sempre', async () => {
  ligarChave(1);
  const s = servico();
  const m = mensagem({ from: '5565966660000@c.us' });
  await s._handleMessage(m.msg);
  assert.ok(s.logs.some(([, l]) => l.includes(`id …${m.msg.id.id.slice(-6)}`)), 'ID final no log');
  const sem = mensagem({ from: '5565966661111@c.us' });
  delete sem.msg.id.id; // só o _serialized
  const s2 = servico();
  await s2._handleMessage(sem.msg);
  assert.equal(sem.enviados.length, 1, 'aviso de sempre');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM talk_decisoes_mensagem WHERE mensagem_id LIKE ?').get('%5565966661111%').n, 0, 'sem decisão com o _serialized');
});

test('banco falha ao gravar o dono: tenta de novo; se não der, responde como sempre e registra erro no monitor', async () => {
  ligarChave(1);
  const real = db;
  let falhas = 2; // as duas primeiras tentativas falham; a terceira grava
  db = new Proxy(real, { get: (alvo, p) => (p === 'prepare'
    ? (sql) => { if (/INSERT OR IGNORE INTO talk_decisoes_mensagem/.test(sql) && falhas-- > 0) throw new Error('database is locked'); return alvo.prepare(sql); }
    : (typeof alvo[p] === 'function' ? alvo[p].bind(alvo) : alvo[p])) });
  try {
    const s = servico();
    const m = mensagem({ from: '5565967770000@c.us' });
    await s._handleMessage(m.msg);
    assert.equal(decisao('', m.msg.id.id)?.dono, 'assistente', 'gravou na 3ª tentativa');
    assert.ok(!s.logs.some(([tipo]) => tipo === 'error'));
    falhas = 99; // banco fora de vez
    const s2 = servico();
    const m2 = mensagem({ from: '5565967771111@c.us' });
    await s2._handleMessage(m2.msg);
    assert.equal(m2.enviados.length, 1, 'responde como sempre (nunca fica mudo)');
    assert.ok(s2.logs.some(([tipo, l]) => tipo === 'error' && /não foi possível gravar o dono/.test(l)));
  } finally {
    db = real;
  }
});

test('assistente pegou a mensagem de quem não é autorizado e não respondeu: o Talk espera e depois assume', async () => {
  ligarChave(1);
  // Aviso de "não autorizado" falha (IA Command "caiu" antes de responder): fica sem respondida_em.
  const s = servico();
  const m = mensagem({ from: '5565968880000@c.us', falhaEnvio: true });
  await s._handleMessage(m.msg);
  const id = m.msg.id.id;
  assert.equal(decisao('', id).dono, 'assistente');
  assert.equal(decisao('', id).respondida_em, null);
  // Logo depois: o Talk espera (não grava, não descarta).
  assert.deepEqual(talk.decidirMensagem(NUMERO_CANAL, '5565968880000', id, 'oi'), { canal_encontrado: true, repassar_ligado: true, dono: 'assistente', aguardar: true });
  // Passado o prazo sem resposta: o Talk assume.
  db.prepare('UPDATE talk_decisoes_mensagem SET criado_em = ? WHERE mensagem_id = ?').run(new Date(Date.now() - talk.RETOMADA_MS - 1000).toISOString(), id);
  assert.deepEqual(talk.decidirMensagem(NUMERO_CANAL, '5565968880000', id, 'oi'), { canal_encontrado: true, repassar_ligado: true, dono: 'talk', retomada: true });
  assert.equal(decisao('', id).dono, 'talk');

  // Aviso saiu: a decisão fica com o assistente para sempre (o Talk descarta).
  const s2 = servico();
  const ok = mensagem({ from: '5565968881111@c.us' });
  await s2._handleMessage(ok.msg);
  assert.ok(decisao('', ok.msg.id.id).respondida_em, 'marcada como respondida');
  db.prepare('UPDATE talk_decisoes_mensagem SET criado_em = ? WHERE mensagem_id = ?').run(new Date(Date.now() - talk.RETOMADA_MS - 1000).toISOString(), ok.msg.id.id);
  assert.equal(talk.decidirMensagem(NUMERO_CANAL, '5565968881111', ok.msg.id.id, 'oi').dono, 'assistente');

  // Usuário do ERP: nunca é assumido pelo Talk (a conversa do ERP não vai para o atendente).
  db.prepare("INSERT INTO talk_decisoes_mensagem (channel_id, numero, mensagem_id, dono, criado_em, nao_autorizado) VALUES (?, '556599995116', 'erp1', 'assistente', ?, 0)")
    .run(CANAL, new Date(Date.now() - talk.RETOMADA_MS - 1000).toISOString());
  assert.equal(talk.decidirMensagem(NUMERO_CANAL, '5565999995116', 'erp1', 'faturamento').dono, 'assistente');
});

test('migração 101 roda de novo sem erro', () => {
  const m101 = MIGRACOES.find(m => m.version === 101);
  m101.run(db);
  m101.run(db);
  const cols = db.prepare('PRAGMA table_info(talk_decisoes_mensagem)').all().map(c => c.name);
  assert.ok(cols.includes('nao_autorizado') && cols.includes('respondida_em'));
});
