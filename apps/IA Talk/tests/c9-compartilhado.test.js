'use strict';

// C9 parte 2 — número compartilhado, ponta a ponta e o mais perto da realidade possível:
//   - IA Command REAL (WhatsAppService._handleMessage + rotas internas por HTTP) com o banco
//     dele em memória e todas as migrações;
//   - IA Talk REAL (atendimento + cliente HTTP do IA Command) com o banco dele em memória;
//   - cada mensagem do WhatsApp é entregue AOS DOIS (o número está conectado nos dois, como
//     em produção). Nenhum banco real é aberto e nenhuma mensagem de verdade sai.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

// ── IA Command em memória (mesmo preparo de apps/IA Command/tests/talk-compartilhado.test.js) ──
const IAC = path.join(__dirname, '../../IA Command');
const iacDb = new Database(':memory:');
iacDb.pragma('foreign_keys = ON');
for (const m of [...require(path.join(IAC, 'modules/database/migrations'))].sort((a, b) => a.version - b.version)) { iacDb.exec(m.sql || ''); if (m.run) m.run(iacDb); }
require(path.join(IAC, 'modules/database')).getDB = () => iacDb;
require.cache[require.resolve(path.join(__dirname, '../../../modules/empresas/database'))] = { exports: { buscarPorId: () => ({ razao_social: 'J2A Consultoria' }) } };
const WhatsAppService = require(path.join(IAC, 'modules/whatsapp/service'));
const rotasExternas = require(path.join(IAC, 'modules/whatsapp/servico-externo-routes'));
const talkIac = require(path.join(IAC, 'modules/whatsapp/talk-compartilhado'));
talkIac._test.definirEsperaRecibo(2000); // em produção: 8 s

// ── IA Talk ───────────────────────────────────────────────────────────────────
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { Atendimento } = require('../backend/atendimento/servico');
const { criarClienteIaCommand } = require('../backend/atendimento/ia-command');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

const NUMERO = '5565999991752';     // o mesmo número nos dois sistemas
const AUTORIZADO = '5565999995116'; // usuário do ERP (autorizado no IA Command)
const CLIENTE = '5565911112222';    // cliente sem cadastro no IA Command
const SEGREDO = 'segredo-falso-so-de-teste';

let servidorIac; let talkDb; let atendimento; let canalTalk;
const avisosTalk = [];
const env = { IAC_WHATSAPP_SERVICO_EXTERNO_SECRET: SEGREDO };

test.before(async () => {
  const t = new Date().toISOString();
  iacDb.prepare(`INSERT INTO whatsapp_channels (id, nome, numero, provider, auth_client_id, ativo, criado_em, atualizado_em)
    VALUES ('ch_j2a', 'Canal J2A', ?, 'wweb', 'iac_ch_j2a', 1, ?, ?)`).run(NUMERO, t, t);
  iacDb.prepare(`INSERT INTO whatsapp_channel_companies (id, channel_id, empresa_id, padrao, ativo, criado_em, atualizado_em) VALUES ('cc1', 'ch_j2a', 1, 1, 1, ?, ?)`).run(t, t);
  iacDb.prepare(`INSERT INTO whatsapp_allowed_numbers (empresa_id, nome, numero, ativo, criado_em, atualizado_em) VALUES (1, 'Ana (ERP)', ?, 1, ?, ?)`).run(AUTORIZADO, t, t);

  // Rotas internas do IA Command num servidor HTTP de verdade (o Talk chama por rede).
  const app = express();
  app.use(express.json());
  rotasExternas(app);
  servidorIac = http.createServer(app);
  await new Promise(r => servidorIac.listen(0, '127.0.0.1', r));
  env.IA_COMMAND_INTERNAL_URL = `http://127.0.0.1:${servidorIac.address().port}`;
  process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET = SEGREDO; // o IA Command lê do ambiente

  // Talk: empresa, setor e o canal em uso "compartilhado" (envio ligado só para a lista de teste).
  talkDb = abrirBanco({ arquivo: ':memory:' });
  const emp = novoId('empresa');
  talkDb.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES (?, 'J2A', 'j2a', 'ativa', ?, ?)").run(emp, t, t);
  const setor = novoId('setor');
  talkDb.prepare("INSERT INTO setores (id, empresa_id, codigo, nome, criado_em, atualizado_em) VALUES (?, ?, 'suporte', 'Suporte', ?, ?)").run(setor, emp, t, t);
  canalTalk = novoId('canal');
  talkDb.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, numero, provedor, estado, estado_desde, ligado, sessao_id, criado_em, atualizado_em,
      envio_modo, recebimento_modo, numeros_teste, uso, atendimento_empresa_id, setor_padrao_id)
    VALUES (?, ?, 'J2A', ?, 'wweb', 'conectado', ?, 1, 's1', ?, ?, 'teste', 'todos', ?, 'compartilhado', ?, ?)`)
    .run(canalTalk, emp, NUMERO, t, t, t, JSON.stringify([AUTORIZADO, CLIENTE]), emp, setor);
  atendimento = new Atendimento({ db: talkDb, iaCommand: criarClienteIaCommand({ env }), aoAviso: (c, texto) => avisosTalk.push(texto) });
  const atendente = novoId('usuario');
  talkDb.prepare("INSERT INTO usuarios (id, nome, telefone, criado_em, atualizado_em) VALUES (?, 'Carla Souza', '5565999990003', ?, ?)").run(atendente, t, t);
  atendimento.acesso = { empresaId: emp, usuarioId: atendente, veTudo: true };
  atendimento.esperasSincronizacao = [0, 10, 20]; // novas tentativas rápidas no teste
  assert.equal(await atendimento.enviarBatimentos(), 1, 'Talk manda o "estou vivo" do número compartilhado conectado');
});
test.after(async () => {
  delete process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET;
  await new Promise(r => servidorIac.close(r));
});

const chave = (v) => iacDb.prepare("UPDATE whatsapp_channels SET repassar_nao_autorizados_talk = ? WHERE id = 'ch_j2a'").run(v);
let seq = 0;
// A mesma mensagem chega aos dois aparelhos do número. Devolve o que cada lado fez.
async function chega(de, texto, { talkNoAr = true } = {}) {
  const id = `wamid_${++seq}`;
  const svc = new WhatsAppService();
  Object.assign(svc, { _empresaId: 1, _channelId: 'ch_j2a', _channelName: 'Canal J2A' });
  svc.log = () => {}; svc.logLocal = () => {};
  const assistente = [];
  svc._handleText = async () => assistente.push(texto);
  const enviadosIac = [];
  const ts = Math.floor(Date.now() / 1000);
  const msg = { fromMe: false, id: { id, _serialized: id }, timestamp: ts, from: `${de}@c.us`, type: 'chat', body: texto,
    getContact: async () => ({ number: de, id: { _serialized: `${de}@c.us` } }), getChat: async () => ({ sendMessage: async (t) => enviadosIac.push(t) }) };
  const antes = talkDb.prepare("SELECT COUNT(*) AS n FROM conversa_itens WHERE categoria = 'mensagem' AND direcao = 'entrada'").get().n;
  // Os dois aparelhos do número recebem a mesma mensagem ao mesmo tempo.
  await Promise.all([
    svc._handleMessage(msg),
    talkNoAr ? atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: de }, tipo: 'texto', texto, em: new Date(ts * 1000).toISOString() }) : null,
  ]);
  const gravadas = talkDb.prepare("SELECT COUNT(*) AS n FROM conversa_itens WHERE categoria = 'mensagem' AND direcao = 'entrada'").get().n - antes;
  return { assistente: assistente.length > 0, iaCommandEnviou: enviadosIac, talkGravou: gravadas > 0 };
}
async function chegaTalkPrimeiro(de, texto) {
  const id = `wamid_${++seq}`;
  const svc = new WhatsAppService();
  Object.assign(svc, { _empresaId: 1, _channelId: 'ch_j2a', _channelName: 'Canal J2A' });
  svc.log = () => {}; svc.logLocal = () => {};
  const assistente = [];
  svc._handleText = async () => assistente.push(texto);
  const enviadosIac = [];
  const antes = talkDb.prepare("SELECT COUNT(*) AS n FROM conversa_itens WHERE categoria = 'mensagem' AND direcao = 'entrada'").get().n;
  const ts = Math.floor(Date.now() / 1000);
  await atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: de }, tipo: 'texto', texto, em: new Date(ts * 1000).toISOString() });
  await svc._handleMessage({ fromMe: false, id: { id, _serialized: id }, timestamp: ts, from: `${de}@c.us`, type: 'chat', body: texto,
    getContact: async () => ({ number: de, id: { _serialized: `${de}@c.us` } }), getChat: async () => ({ sendMessage: async (t) => enviadosIac.push(t) }) });
  const gravadas = talkDb.prepare("SELECT COUNT(*) AS n FROM conversa_itens WHERE categoria = 'mensagem' AND direcao = 'entrada'").get().n - antes;
  return { assistente: assistente.length > 0, iaCommandEnviou: enviadosIac, talkGravou: gravadas > 0 };
}
const conversaDe = (tel) => talkDb.prepare(`SELECT cv.id FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE ct.telefone = ? AND cv.situacao = 'aberta'`).get(tel)?.id;

test('chave desligada no IA Command: tudo como hoje; o Talk não grava nada e avisa no Terminal', async () => {
  chave(0);
  const r = await chega(CLIENTE, 'Oi, quero um orçamento');
  assert.equal(r.iaCommandEnviou.length, 1, 'IA Command manda o aviso de não autorizado, como hoje');
  assert.equal(r.talkGravou, false, 'Talk não grava');
  assert.match(avisosTalk.join('\n'), /está desligado neste canal/);
  const a = await chega(AUTORIZADO, 'faturamento de hoje');
  assert.equal(a.assistente, true);
  assert.equal(a.talkGravou, false);
});

test('chave ligada: cliente vai só para o Talk; usuário do ERP só para o assistente', async () => {
  chave(1);
  const r = await chega(CLIENTE, 'Oi, quero um orçamento');
  assert.deepEqual(r.iaCommandEnviou, [], 'IA Command em silêncio');
  assert.equal(r.assistente, false);
  assert.equal(r.talkGravou, true, 'vira conversa no Talk');
  assert.ok(conversaDe(CLIENTE));
  const a = await chega(AUTORIZADO, 'faturamento de hoje');
  assert.equal(a.assistente, true, 'assistente responde o usuário do ERP');
  assert.equal(a.talkGravou, false, 'Talk NÃO grava a conversa do ERP');
});

test('usuário do ERP escreve "atendente": passa para o Talk, é atendido e volta ao assistente ao encerrar', async () => {
  chave(1);
  const p = await chega(AUTORIZADO, 'atendente');
  assert.deepEqual(p.iaCommandEnviou, [talkIac.TEXTOS.passar], 'aviso de passagem');
  assert.equal(p.assistente, false);
  const m = await chega(AUTORIZADO, 'O boleto da nota 1234 não chegou');
  assert.equal(m.assistente, false, 'assistente em silêncio');
  assert.equal(m.talkGravou, true, 'mensagem cai na fila do Talk');
  const cv = conversaDe(AUTORIZADO);
  assert.ok(cv);
  const textos = talkDb.prepare("SELECT texto FROM conversa_itens WHERE conversa_id = ? AND categoria = 'mensagem'").all(cv).map(x => x.texto);
  assert.ok(!textos.some(t => /faturamento/.test(t)), 'conversa do ERP anterior não vai para o Talk');

  // Atendente assume e responde (fila de saída do Talk).
  atendimento.assumir(atendimento.acesso, cv);
  atendimento.responder(atendimento.acesso, cv, 'Vou reenviar o boleto agora.');
  await atendimento.sincronizacao;
  // Encerrar: o IA Command volta a responder e o Talk avisa a pessoa.
  atendimento.encerrar(atendimento.acesso, cv, { motivo: 'Boleto reenviado' });
  await atendimento.sincronizacao;
  assert.equal(talkIac.estadoDoNumero(NUMERO, AUTORIZADO).em_atendimento, false);
  const aviso = talkDb.prepare("SELECT conteudo FROM mensagens WHERE origem = 'automatica'").all().map(x => x.conteudo);
  assert.deepEqual(aviso, ['O atendimento foi encerrado. O assistente voltou a responder por aqui.']);
  const depois = await chega(AUTORIZADO, 'faturamento de hoje');
  assert.equal(depois.assistente, true, 'assistente voltou');
  assert.equal(depois.talkGravou, false);
});

test('cliente sem cadastro: encerrar não manda o aviso do assistente (ele nunca foi do assistente)', async () => {
  chave(1);
  const cv = conversaDe(CLIENTE);
  atendimento.assumir(atendimento.acesso, cv);
  atendimento.responder(atendimento.acesso, cv, 'Segue o orçamento.');
  await atendimento.sincronizacao;
  const antes = talkDb.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE origem = 'automatica'").get().n;
  atendimento.encerrar(atendimento.acesso, cv, {});
  await atendimento.sincronizacao;
  assert.equal(talkDb.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE origem = 'automatica'").get().n, antes);
  assert.equal(iacDb.prepare('SELECT COUNT(*) AS n FROM talk_atendimentos').get().n, 0);
});

test('Talk abre a conversa (chamado) com usuário do ERP: a resposta dele vai para o atendente', async () => {
  chave(1);
  const app = novoId('aplicacao');
  const t = new Date().toISOString();
  talkDb.prepare(`INSERT INTO aplicacoes (id, empresa_id, nome, situacao, escopos, criado_em, atualizado_em) VALUES (?, ?, 'SoftExpert', 'ativa', '["conversas:criar"]', ?, ?)`)
    .run(app, atendimento.acesso.empresaId, t, t);
  talkDb.prepare('INSERT INTO aplicacao_canais (aplicacao_id, canal_id) VALUES (?, ?)').run(app, canalTalk);
  const r = atendimento.abrirPorChamado({ aplicacaoId: app, empresaId: atendimento.acesso.empresaId, nome: 'SoftExpert' },
    { canal: canalTalk, contato: { telefone: AUTORIZADO }, referencia: { sistema: 'softexpert', id: '037500' } });
  assert.equal(r.resultado, 'criada');
  await atendimento.sincronizacao;
  const resposta = await chega(AUTORIZADO, 'Recebi o chamado, pode me ligar?');
  assert.equal(resposta.assistente, false, 'não cai no assistente');
  assert.equal(resposta.talkGravou, true, 'vai para a conversa do chamado');
  talkIac.encerrarPorNumero(NUMERO, AUTORIZADO);
});

test('IA Command fora do ar: o Talk não grava (pode ser conversa do assistente) e avisa no Terminal', async () => {
  chave(1);
  const urlBoa = env.IA_COMMAND_INTERNAL_URL;
  env.IA_COMMAND_INTERNAL_URL = 'http://127.0.0.1:9'; // ninguém escuta
  try {
    const n = await atendimento.receber(canalTalk, { id_provedor: 'x1', id_decisao: 'x1', de: { tipo: 'telefone', valor: '5565933334444' }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
    assert.equal(n, null);
    assert.match(avisosTalk.join('\n'), /não respondeu à conferência/);
  } finally {
    env.IA_COMMAND_INTERNAL_URL = urlBoa;
  }
  // Segredo errado: o IA Command recusa (403) e o Talk trata igual a "fora do ar".
  const errado = new Atendimento({ db: talkDb, iaCommand: criarClienteIaCommand({ env: { ...env, IAC_WHATSAPP_SERVICO_EXTERNO_SECRET: 'outro' } }), aoAviso: () => {} });
  assert.equal(await errado.receber(canalTalk, { id_provedor: 'x2', id_decisao: 'x2', de: { tipo: 'telefone', valor: '5565933334444' }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() }), null);
});

test('duas mensagens seguidas do mesmo cliente entram na ordem em que chegaram', async () => {
  chave(1);
  const tel = '5565955556666';
  const em = new Date().toISOString();
  await Promise.all([1, 2, 3].map(i => atendimento.receber(canalTalk, { id_provedor: `ord${i}`, id_decisao: `ord${i}`, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: `parte ${i}`, em })));
  const cv = conversaDe(tel);
  const textos = talkDb.prepare("SELECT texto FROM conversa_itens WHERE conversa_id = ? AND categoria = 'mensagem' ORDER BY em, rowid").all(cv).map(x => x.texto);
  assert.deepEqual(textos, ['parte 1', 'parte 2', 'parte 3']);
  assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE ct.telefone = ?').get(tel).n, 1, 'uma conversa só');
});

test('"atendente" chega primeiro no Talk: a conversa aparece na fila e o IA Command manda o aviso uma vez', async () => {
  chave(1);
  const tel = '5565988880000';
  const t = new Date().toISOString();
  iacDb.prepare("INSERT INTO whatsapp_allowed_numbers (empresa_id, nome, numero, ativo, criado_em, atualizado_em) VALUES (1, 'Bruno (ERP)', ?, 1, ?, ?)").run(tel, t, t);
  const r = await chegaTalkPrimeiro(tel, 'Atendente');
  assert.equal(r.talkGravou, true, 'a primeira mensagem já entra na fila');
  assert.deepEqual(r.iaCommandEnviou, [talkIac.TEXTOS.passar], 'aviso de passagem sai uma vez');
  assert.equal(r.assistente, false);
  assert.ok(conversaDe(tel));
  const depois = await chegaTalkPrimeiro(tel, 'é sobre a nota 99');
  assert.equal(depois.talkGravou, true);
  assert.equal(depois.assistente, false);
  talkIac.encerrarPorNumero(NUMERO, tel);
});

test('remetente só com o código interno do WhatsApp (LID não resolvido) nunca vira conversa', async () => {
  chave(1);
  const r = await atendimento.receber(canalTalk, { id_provedor: 'lid1', id_decisao: 'lid1', de: { tipo: 'lid', valor: '1234567890123' }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
  assert.equal(r, null);
  assert.equal(talkDb.prepare("SELECT COUNT(*) AS n FROM contatos WHERE telefone = '1234567890123'").get().n, 0);
});

test('Talk sem mandar o "estou vivo": o IA Command volta a responder todo mundo como hoje', async () => {
  chave(1);
  iacDb.prepare("UPDATE whatsapp_channels SET talk_batimento_em = NULL WHERE id = 'ch_j2a'").run();
  try {
    const r = await chega('5565977770000', 'Oi');
    assert.equal(r.iaCommandEnviou.length, 1, 'cliente recebe o aviso de sempre (ninguém ficaria sem resposta)');
    const p = await chega(AUTORIZADO, 'atendente');
    assert.deepEqual(p.iaCommandEnviou, [talkIac.TEXTOS.indisponivel]);
    assert.equal(p.talkGravou, false, 'não passa para o Talk');
  } finally {
    await atendimento.enviarBatimentos();
  }
});

test('falha ao avisar o IA Command: tenta de novo; se não conseguir, registra na conversa e no Terminal', async () => {
  chave(1);
  let falhas = 2;
  const real = atendimento.iaCommand;
  const instavel = { ...real, iniciado: async (...a) => (falhas-- > 0 ? null : real.iniciado(...a)) };
  atendimento.iaCommand = instavel;
  try {
    const app = talkDb.prepare("SELECT id FROM aplicacoes WHERE nome = 'SoftExpert'").get().id;
    const r = atendimento.abrirPorChamado({ aplicacaoId: app, empresaId: atendimento.acesso.empresaId, nome: 'SoftExpert' },
      { canal: canalTalk, contato: { telefone: AUTORIZADO }, referencia: { sistema: 'softexpert', id: '037600' } });
    await atendimento.sincronizacao;
    assert.equal(talkIac.estadoDoNumero(NUMERO, AUTORIZADO).em_atendimento, true, 'na 3ª tentativa marcou');
    // Agora o IA Command recusa sempre: evento na conversa + aviso no Terminal.
    atendimento.iaCommand = { ...real, encerrado: async () => null };
    const qtd = avisosTalk.length;
    atendimento.encerrar(atendimento.acesso, r.cv.id, {});
    await atendimento.sincronizacao;
    assert.ok(avisosTalk.length > qtd && avisosTalk.at(-1).includes('Não foi possível avisar o IA Command (atendimento encerrado: sem resposta do IA Command)'));
    const ev = talkDb.prepare("SELECT texto FROM conversa_itens WHERE conversa_id = ? AND categoria = 'evento' ORDER BY rowid DESC LIMIT 1").get(r.cv.id).texto;
    assert.match(ev, /Não foi possível avisar o IA Command/);
  } finally {
    atendimento.iaCommand = real;
    talkIac.encerrarPorNumero(NUMERO, AUTORIZADO);
  }
});

test('marcar atrasado e encerrar logo em seguida: o IA Command termina sem atendimento (a ordem é mantida)', async () => {
  chave(1);
  const real = atendimento.iaCommand;
  atendimento.iaCommand = { ...real, iniciado: async (...a) => { await new Promise(r => setTimeout(r, 150)); return real.iniciado(...a); } };
  try {
    const app = talkDb.prepare("SELECT id FROM aplicacoes WHERE nome = 'SoftExpert'").get().id;
    const r = atendimento.abrirPorChamado({ aplicacaoId: app, empresaId: atendimento.acesso.empresaId, nome: 'SoftExpert' },
      { canal: canalTalk, contato: { telefone: AUTORIZADO }, referencia: { sistema: 'softexpert', id: '037700' } });
    atendimento.encerrar(atendimento.acesso, r.cv.id, {}); // antes de a marcação lenta terminar
    await atendimento.sincronizacao;
    assert.equal(talkIac.estadoDoNumero(NUMERO, AUTORIZADO).em_atendimento, false, 'encerrou depois de marcar, na ordem certa');
  } finally {
    atendimento.iaCommand = real;
  }
});

test('Talk caiu logo depois do "estou vivo": sem recibo da mensagem, o IA Command responde como hoje', async () => {
  chave(1);
  await atendimento.enviarBatimentos(); // sinal de vida acabou de chegar
  const r = await chega('5565944440000', 'Bom dia', { talkNoAr: false }); // mas o Talk não recebe a cópia
  assert.equal(r.iaCommandEnviou.length, 1, 'cliente recebe o aviso de sempre (não fica sem resposta)');
});

test('recebimento só de números de teste: quem está fora da lista recebe a resposta de sempre do IA Command', async () => {
  chave(1);
  // O supervisor do Talk descarta (fora da lista) e nem chama o atendimento: nenhum recibo é dado.
  talkDb.prepare("UPDATE canais SET recebimento_modo = 'teste' WHERE id = ?").run(canalTalk);
  try {
    const r = await chega('5565945450000', 'Oi', { talkNoAr: false });
    assert.equal(r.iaCommandEnviou.length, 1);
  } finally {
    talkDb.prepare("UPDATE canais SET recebimento_modo = 'todos' WHERE id = ?").run(canalTalk);
  }
});

test('texto longo que começa com "atendente" não passa a pessoa para o Talk (o texto vai inteiro)', async () => {
  chave(1);
  const texto = 'atendente' + ' '.repeat(4087) + 'faturamento de hoje';
  const r = await chega(AUTORIZADO, texto);
  assert.equal(r.assistente, true, 'assistente responde');
  assert.equal(r.talkGravou, false, 'Talk não grava a conversa do ERP');
  assert.equal(talkIac.estadoDoNumero(NUMERO, AUTORIZADO).em_atendimento, false);
});

test('reinício do Talk com desmarcação pendente: a reconciliação acerta o IA Command', async () => {
  chave(1);
  // Pessoa autorizada em atendimento; o Talk encerrou mas "caiu" antes de avisar (simulado: marca direto no IA Command).
  const app = talkDb.prepare("SELECT id FROM aplicacoes WHERE nome = 'SoftExpert'").get().id;
  const r = atendimento.abrirPorChamado({ aplicacaoId: app, empresaId: atendimento.acesso.empresaId, nome: 'SoftExpert' },
    { canal: canalTalk, contato: { telefone: AUTORIZADO }, referencia: { sistema: 'softexpert', id: '037800' } });
  await atendimento.sincronizacao;
  talkDb.prepare("UPDATE conversas SET situacao = 'encerrada', encerrada_em = ? WHERE id = ?").run(new Date().toISOString(), r.cv.id);
  assert.equal(talkIac.estadoDoNumero(NUMERO, AUTORIZADO).em_atendimento, true, 'IA Command ainda acha que está em atendimento');
  const automaticasAntes = talkDb.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE origem = 'automatica'").get().n;
  const res = await atendimento.reconciliar();
  assert.ok(res.desmarcadas >= 1);
  assert.equal(talkIac.estadoDoNumero(NUMERO, AUTORIZADO).em_atendimento, false, 'acertado');
  assert.equal(talkDb.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE origem = 'automatica'").get().n, automaticasAntes, 'a reconciliação não manda mensagem para a pessoa');
});

test('IA Command sem o número cadastrado: não conta como sucesso; avisa na conversa e no Terminal', async () => {
  chave(1);
  const real = atendimento.iaCommand;
  atendimento.iaCommand = { ...real, encerrado: async () => ({ ok: true, canal_encontrado: false, encerrados: 0 }) };
  try {
    const app = talkDb.prepare("SELECT id FROM aplicacoes WHERE nome = 'SoftExpert'").get().id;
    const r = atendimento.abrirPorChamado({ aplicacaoId: app, empresaId: atendimento.acesso.empresaId, nome: 'SoftExpert' },
      { canal: canalTalk, contato: { telefone: CLIENTE }, referencia: { sistema: 'softexpert', id: '037900' } });
    await atendimento.sincronizacao;
    const qtd = avisosTalk.length;
    atendimento.encerrar(atendimento.acesso, r.cv.id, {});
    await atendimento.sincronizacao;
    assert.ok(avisosTalk.length > qtd && avisosTalk.at(-1).includes('o IA Command não tem um canal com este número'));
  } finally {
    atendimento.iaCommand = real;
  }
});

test('falha ao criar o aviso de fora do horário não gasta a janela de 12 h', async () => {
  const t = new Date().toISOString();
  const setor = talkDb.prepare('SELECT setor_padrao_id AS id FROM canais WHERE id = ?').get(canalTalk).id;
  const hoje = new Date(Date.now() - 4 * 3600 * 1000).getUTCDay();
  talkDb.prepare('UPDATE setores SET horario = ?, fora_horario = ? WHERE id = ?').run(
    JSON.stringify({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: (hoje + 3) % 7, inicio: '08:00', fim: '09:00' }] }),
    JSON.stringify({ ligado: true, texto: 'Fora do horário.' }), setor);
  talkDb.exec("CREATE TRIGGER falha_auto BEFORE INSERT ON mensagens WHEN NEW.origem = 'automatica' BEGIN SELECT RAISE(ABORT, 'disco cheio'); END");
  try {
    iacDb.prepare("UPDATE whatsapp_channels SET repassar_nao_autorizados_talk = 1 WHERE id = 'ch_j2a'").run();
    await atendimento.receber(canalTalk, { id_provedor: 'fh1', id_decisao: 'fh1', de: { tipo: 'telefone', valor: CLIENTE }, tipo: 'texto', texto: 'oi', em: t });
    const cv = conversaDe(CLIENTE);
    assert.equal(talkDb.prepare('SELECT ultimo_aviso_fora_horario_em AS v FROM conversas WHERE id = ?').get(cv).v, null, 'janela continua livre');
  } finally {
    talkDb.exec('DROP TRIGGER falha_auto');
    talkDb.prepare('UPDATE setores SET fora_horario = ? WHERE id = ?').run(JSON.stringify({ ligado: false, texto: '' }), setor);
  }
});


test('falha de gravação da entrada não produz recibo no IA Command', async () => {
  chave(1);
  const id = 'falha-gravacao-unica';
  talkDb.exec("CREATE TRIGGER falha_entrada BEFORE INSERT ON conversa_itens WHEN NEW.id_provedor = 'falha-gravacao-unica' BEGIN SELECT RAISE(ABORT, 'erro de gravação'); END");
  try {
    await assert.rejects(atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: '5565910101000' }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() }));
    assert.equal(iacDb.prepare('SELECT COUNT(*) AS n FROM talk_recibos_mensagem WHERE mensagem_id = ?').get(id).n, 0);
  } finally { talkDb.exec('DROP TRIGGER falha_entrada'); }
});


test('copia do Talk atrasada respeita decisao anterior do assistente', async () => {
  chave(1); await atendimento.enviarBatimentos();
  const tel = '5565941212121'; const id = 'decisao-atrasada';
  const svc = new WhatsAppService(); Object.assign(svc, { _empresaId: 1, _channelId: 'ch_j2a', _channelName: 'Canal J2A' });
  svc.log = () => {}; svc.logLocal = () => {};
  const respostas = [];
  talkIac._test.definirEsperaRecibo(0);
  try {
    await svc._handleMessage({ fromMe: false, id: { id, _serialized: id }, timestamp: Math.floor(Date.now()/1000), from: tel+'@c.us', type: 'chat', body: 'oi', getContact: async () => ({ number: tel }), getChat: async () => ({ sendMessage: async t => respostas.push(t) }) });
    assert.equal(respostas.length, 1);
    const r = await atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
    assert.equal(r, null);
    assert.equal(conversaDe(tel), undefined);
    assert.equal(iacDb.prepare('SELECT dono FROM talk_decisoes_mensagem WHERE mensagem_id = ?').get(id).dono, 'assistente');
    assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(id).n, 0);
  } finally { talkIac._test.definirEsperaRecibo(2000); }
});

test('resposta perdida e reinicio preservam pendente e respeitam dono anterior', async () => {
  chave(1); await atendimento.enviarBatimentos();
  const tel = '5565941313131'; const id = 'decisao-resposta-perdida';
  const real = atendimento.iaCommand;
  let perdeu = false;
  atendimento.iaCommand = { ...real, decisao: async (...args) => { const r = await real.decisao(...args); if (!perdeu) { perdeu = true; return null; } return r; } };
  try {
    assert.equal(await atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() }), null);
    assert.equal(iacDb.prepare('SELECT dono FROM talk_decisoes_mensagem WHERE mensagem_id = ?').get(id).dono, 'talk');
    assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(id).n, 1);
    assert.equal(conversaDe(tel), undefined);
    const reiniciado = new Atendimento({ db: talkDb, iaCommand: real });
    await reiniciado.retomarPendentes();
    assert.ok(conversaDe(tel));
    assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(id).n, 0);
  } finally { atendimento.iaCommand = real; }
});

test('command indisponivel mantem mensagem pendente ate reconectar', async () => {
  chave(1); const tel = '5565941414141'; const id = 'decisao-offline'; const real = atendimento.iaCommand;
  atendimento.iaCommand = { ...real, decisao: async () => null };
  try {
    await atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
    assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(id).n, 1);
    assert.equal(conversaDe(tel), undefined);
    atendimento.iaCommand = real; await atendimento.retomarPendentes();
    assert.ok(conversaDe(tel));
  } finally { atendimento.iaCommand = real; }
});

test('disputa repetida conserva um unico dono por mensagem', async () => {
  chave(1); const tel = '5565941515151';
  for (let i = 0; i < 40; i++) {
    const id = 'decisao-disputa-'+i;
    const [talk, command] = await Promise.all([
      atendimento.iaCommand.decisao(NUMERO, tel, id, 'oi'),
      Promise.resolve().then(() => talkIac.escolherDono('ch_j2a', tel, id, 'assistente')),
    ]);
    assert.equal(talk.dono, command);
    assert.equal(iacDb.prepare('SELECT COUNT(*) AS n FROM talk_decisoes_mensagem WHERE mensagem_id = ?').get(id).n, 1);
  }
});


test('duas representacoes do mesmo ID intrinseco compartilham a decisao', async () => {
  chave(1); await atendimento.enviarBatimentos();
  const tel = '5565941616161'; const chaveId = 'id-intrinseco-001';
  assert.equal(talkIac.escolherDono('ch_j2a', tel, chaveId, 'assistente'), 'assistente');
  const resultado = await atendimento.receber(canalTalk, { id_provedor: 'false_lid_id-intrinseco-001', id_decisao: chaveId, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
  assert.equal(resultado, null);
  assert.equal(conversaDe(tel), undefined);
});

test('IDs diferentes no mesmo segundo recebem decisoes independentes', async () => {
  chave(1); const tel = '5565941717171'; const em = new Date().toISOString();
  assert.equal(talkIac.escolherDono('ch_j2a', tel, 'mesmo-segundo-a', 'assistente'), 'assistente');
  const r = await atendimento.receber(canalTalk, { id_provedor: 'mesmo-segundo-b', id_decisao: 'mesmo-segundo-b', de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'oi', em });
  assert.ok(r);
  assert.equal(iacDb.prepare('SELECT COUNT(*) AS n FROM talk_decisoes_mensagem WHERE mensagem_id IN (?, ?)').get('mesmo-segundo-a', 'mesmo-segundo-b').n, 2);
});


test('pedido de atendente atrasado nao contradiz dono assistente ja decidido', async () => {
  chave(1); await atendimento.enviarBatimentos();
  const id = 'atendente-atrasado'; const tel = AUTORIZADO;
  talkIac.encerrarPorNumero(NUMERO, tel);
  assert.equal(talkIac.escolherDono('ch_j2a', tel, id, 'assistente'), 'assistente');
  const r = await atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'atendente', em: new Date().toISOString() });
  assert.equal(r, null);
  assert.equal(talkIac.estadoDoNumero(NUMERO, tel).em_atendimento, false);
  assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM conversa_itens WHERE id_provedor = ?').get(id).n, 0);
});

test('pendente com mais de 30 minutos permanece salvo e gera aviso', async () => {
  chave(1); const tel = '5565941818181'; const id = 'pendente-antigo'; const real = atendimento.iaCommand;
  atendimento.iaCommand = { ...real, decisao: async () => null };
  try {
    await atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
    talkDb.prepare('UPDATE atendimento_entradas_pendentes SET criada_em = ? WHERE mensagem_id = ?').run(new Date(Date.now()-31*60000).toISOString(), id);
    const antes = avisosTalk.length; await atendimento.retomarPendentes();
    assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(id).n, 1);
    assert.ok(avisosTalk.length > antes);
  } finally { atendimento.iaCommand = real; talkDb.prepare('DELETE FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').run(id); }
});


test('pendente sobrevive ao fechamento e abertura do arquivo SQLite', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-pendente-')); const arquivo = path.join(dir, 'talk.db');
  const tel = '5565941919191'; const id = 'pendente-em-disco'; const real = atendimento.iaCommand;
  atendimento.iaCommand = { ...real, decisao: async () => null };
  let novo;
  try {
    chave(1);
    await atendimento.receber(canalTalk, { id_provedor: id, id_decisao: id, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
    await talkDb.backup(arquivo);
    novo = abrirBanco({ arquivo }); novo.close(); novo = abrirBanco({ arquivo });
    const reiniciado = new Atendimento({ db: novo, iaCommand: real });
    await reiniciado.retomarPendentes();
    assert.equal(novo.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(id).n, 0);
    assert.equal(novo.prepare('SELECT COUNT(*) AS n FROM conversa_itens WHERE id_provedor = ?').get(id).n, 1);
  } finally {
    atendimento.iaCommand = real; talkDb.prepare('DELETE FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').run(id);
    if (novo?.open) novo.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sem o ID final da mensagem (id_decisao), o Talk não decide nem grava', async () => {
  chave(1);
  const r = await atendimento.receber(canalTalk, { id_provedor: 'false_x@c.us_SEMID', de: { tipo: 'telefone', valor: '5565977001100' }, tipo: 'texto', texto: 'oi', em: new Date().toISOString() });
  assert.equal(r, null);
  assert.equal(talkDb.prepare("SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = 'false_x@c.us_SEMID'").get().n, 0);
  assert.match(avisosTalk.at(-1), /sem identificador/);
});

test('assistente pegou a mensagem do cliente e caiu antes de responder: o Talk espera e assume depois do prazo', async () => {
  chave(1);
  await atendimento.enviarBatimentos();
  const tel = '5565978780000';
  const id = '3EB0RETOMADA01';
  // O IA Command decide "assistente" (o Talk demorou) e o aviso de "não autorizado" falha (caiu).
  const svc = new WhatsAppService();
  Object.assign(svc, { _empresaId: 1, _channelId: 'ch_j2a', _channelName: 'Canal J2A' });
  svc.log = () => {}; svc.logLocal = () => {};
  svc._handleText = async () => {};
  await svc._handleMessage({ fromMe: false, id: { id, _serialized: `false_${tel}@c.us_${id}` }, timestamp: Math.floor(Date.now() / 1000), from: `${tel}@c.us`, type: 'chat', body: 'Bom dia',
    getContact: async () => ({ number: tel, id: { _serialized: `${tel}@c.us` } }), getChat: async () => ({ sendMessage: async () => { throw new Error('caiu'); } }) });
  // A cópia do Talk chega depois: fica pendente (aguardando), sem aparecer para o atendente.
  const m = { id_provedor: `false_${tel}@c.us_${id}`, id_decisao: id, de: { tipo: 'telefone', valor: tel }, tipo: 'texto', texto: 'Bom dia', em: new Date().toISOString() };
  assert.equal(await atendimento.receber(canalTalk, m), null);
  assert.equal(conversaDe(tel), undefined, 'ainda não aparece');
  assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(m.id_provedor).n, 1, 'continua pendente');
  // Passado o prazo sem resposta do assistente, a retomada do Talk assume a mensagem.
  iacDb.prepare('UPDATE talk_decisoes_mensagem SET criado_em = ? WHERE mensagem_id = ?').run(new Date(Date.now() - talkIac.RETOMADA_MS - 1000).toISOString(), id);
  await atendimento.retomarPendentes();
  assert.ok(conversaDe(tel), 'agora está na fila do Talk');
  assert.equal(talkDb.prepare('SELECT COUNT(*) AS n FROM atendimento_entradas_pendentes WHERE mensagem_id = ?').get(m.id_provedor).n, 0);
});
