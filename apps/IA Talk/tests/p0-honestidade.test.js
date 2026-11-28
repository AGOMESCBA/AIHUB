'use strict';

// P0 do piloto (servidor REAL): exportação CSV das mensagens, ações da conversa na auditoria da
// empresa e período (de/ate) na lista de conversas. Antes só existiam no simulado ou na tela.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { criarApp } = require('../backend/servidor');
const { Atendimento } = require('../backend/atendimento/servico');
const { aceitarEnvio } = require('../backend/mensagens/servico');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

const CLIENTE = '5565999981001';
let db; let base; let servidor; let atendimento; let cookie; let canal; let emp;

test.before(async () => {
  db = abrirBanco({ arquivo: ':memory:' });
  atendimento = new Atendimento({ db });
  servidor = http.createServer(criarApp({ db, atendimento, log: { error() {} }, transportes: { whatsapp: async () => ({ ok: true }) } }));
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}/app/ia-talk`;
  const { link } = primeiroAcesso({ db, nome: 'Ana Admin', telefone: '5565999990001', empresa: 'J2A Consultoria', apelido: 'j2a' });
  cookie = (await fetch(`${base}${link.slice(link.indexOf('/api/publico'))}`, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  emp = db.prepare("SELECT id FROM empresas WHERE apelido = 'j2a'").get().id;
  const t = new Date().toISOString();
  const setor = novoId('setor');
  db.prepare("INSERT INTO setores (id, empresa_id, codigo, nome, criado_em, atualizado_em) VALUES (?, ?, 'suporte', 'Suporte', ?, ?)").run(setor, emp, t, t);
  canal = novoId('canal');
  db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, numero, provedor, estado, estado_desde, ligado, sessao_id, criado_em, atualizado_em,
      envio_modo, recebimento_modo, numeros_teste, uso, atendimento_empresa_id, setor_padrao_id)
    VALUES (?, ?, 'J2A', '5565900000000', 'wweb', 'conectado', ?, 1, 's1', ?, ?, 'teste', 'todos', ?, 'atendimento', ?, ?)`)
    .run(canal, emp, t, t, t, JSON.stringify([CLIENTE]), emp, setor);
  db.prepare('INSERT INTO canal_empresas (canal_id, empresa_id, padrao) VALUES (?, ?, 1)').run(canal, emp);
});
test.after(() => new Promise(r => servidor.close(r)));

const api = async (caminho, metodo = 'GET', corpo) => {
  const r = await fetch(`${base}/api/admin${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: corpo && JSON.stringify(corpo) });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, corpo: tipo.includes('json') ? await r.json() : await r.text(), headers: r.headers };
};

test('exportar CSV: real, com BOM, telefone mascarado, sem virar fórmula e registrado na auditoria', async () => {
  aceitarEnvio(db, { empresaId: emp, canalId: canal, para: CLIENTE, texto: 'Olá', origem: 'teste_tela', correlacaoId: '=HYPERLINK("x")' });
  const r = await api('/mensagens/exportar');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  // O fetch tira o BOM ao decodificar: confere nos bytes crus.
  const bytes = Buffer.from(await (await fetch(`${base}/api/admin/mensagens/exportar`, { headers: { Cookie: cookie } })).arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM para o Excel');
  const linhas = r.corpo.replace(/^﻿/, '').split('\r\n');
  assert.equal(linhas[0], 'id;direcao;canal;aplicacao;contato;tipo;estado;correlacao;criada_em');
  assert.equal(linhas.length, 2);
  assert.doesNotMatch(r.corpo, /5565999981001/, 'telefone nunca completo');
  assert.match(linhas[1], /;'=HYPERLINK/, 'célula com = vira texto');
  assert.ok(db.prepare("SELECT 1 FROM auditoria WHERE acao = 'mensagens.exportadas'").get());
  assert.equal((await api('/mensagens/exportar?de=15/10/2026')).status, 400, 'mesmos filtros e validação da lista');
});

test('ações da conversa entram na auditoria da empresa; período filtra pela última atividade', async () => {
  atendimento.receber(canal, { id_provedor: novoId('mensagem'), de: { tipo: 'telefone', valor: CLIENTE }, tipo: 'texto', texto: 'Bom dia', em: new Date().toISOString() });
  const cv = db.prepare('SELECT id, protocolo FROM conversas').get();
  assert.equal((await api(`/conversas/${cv.id}/assumir`, 'POST')).status, 200);
  assert.equal((await api(`/conversas/${cv.id}/devolver`, 'POST')).status, 200);
  assert.equal((await api(`/conversas/${cv.id}/encerrar`, 'POST', {})).status, 200);
  assert.equal((await api(`/conversas/${cv.id}/reabrir`, 'POST')).status, 200);
  const acoes = db.prepare("SELECT acao FROM auditoria WHERE acao LIKE 'conversa.%' ORDER BY rowid").all().map(a => a.acao);
  assert.deepEqual(acoes, ['conversa.assumida', 'conversa.devolvida', 'conversa.encerrada', 'conversa.reaberta']);
  const resumo = db.prepare("SELECT resumo FROM auditoria WHERE acao = 'conversa.assumida'").get().resumo;
  assert.equal(resumo, `Assumiu a conversa ${cv.protocolo}`, 'sem texto do cliente');

  db.prepare("UPDATE conversas SET atualizada_em = '2026-10-15T12:00:00.000Z'").run();
  const total = async (q) => (await api(`/conversas?visao=todas${q}`)).corpo.total;
  assert.equal(await total('&de=2026-10-15&ate=2026-10-15'), 1, 'o dia inteiro conta');
  assert.equal(await total('&de=2026-10-16'), 0);
  assert.equal(await total('&ate=2026-10-14'), 0);
  assert.equal((await api('/conversas?de=15/10/2026')).status, 400);
});
