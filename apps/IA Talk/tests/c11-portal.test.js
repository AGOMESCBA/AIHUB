'use strict';

// C11 — portal do atendente no servidor REAL (docs/contratos.md §9.1): endereço por empresa,
// login com destino de volta ao portal, sessão de outra empresa e quem não tem o atendimento.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const cifra = require('../backend/seguranca/cifra');
const config = require('../backend/config');
const { abrirBanco } = require('../backend/database');
const { criarApp } = require('../backend/servidor');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');

cifra.definirChaveParaTeste(crypto.randomBytes(32));

const enviados = [];
let db; let base; let servidor;
const PORTAL_ENTREGUE = fs.existsSync(path.join(config.DIR_FRONTEND, 'portal.html'));

test.before(async () => {
  db = abrirBanco({ arquivo: ':memory:' });
  const transportes = { whatsapp: async (d) => { enviados.push({ telefone: d.telefone, codigo: d.codigo }); return { ok: true }; } };
  servidor = http.createServer(criarApp({ db, log: { error() {} }, transportes }));
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}/app/ia-talk`;
});
test.after(() => new Promise(r => servidor.close(r)));

function navegador() {
  let cookie = '';
  const ir = async (caminho, { metodo = 'GET', corpo } = {}) => {
    const r = await fetch(`${base}${caminho}`, {
      method: metodo, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
  return { ir };
}

async function entrarComLink(dados) {
  const nav = navegador();
  const { link } = primeiroAcesso({ db, ...dados });
  assert.equal((await nav.ir(link.slice(link.indexOf('/api/publico')))).status, 302);
  return nav;
}

async function entrarComCodigo(telefone, { apelido = 'j2a', destino } = {}) {
  const nav = navegador();
  const pedido = await nav.ir('/api/publico/login/codigo', { metodo: 'POST', corpo: { apelido, telefone } });
  assert.equal(pedido.status, 200);
  const r = await nav.ir('/api/publico/login/confirmar', { metodo: 'POST', corpo: { desafio_id: pedido.corpo.desafio_id, codigo: enviados.at(-1).codigo, destino } });
  assert.equal(r.status, 200);
  return { nav, redirecionar: r.corpo.redirecionar };
}

let admin;
test('preparação: empresa com atendente e auditor', async () => {
  admin = await entrarComLink({ nome: 'Ana Admin', telefone: '5565999990001', empresa: 'J2A Consultoria', apelido: 'j2a' });
  for (const [nome, telefone, papel] of [['Carla Atendente', '5565999990003', 'atendente'], ['Davi Auditor', '5565999990004', 'auditor']]) {
    assert.equal((await admin.ir('/api/admin/usuarios', { metodo: 'POST', corpo: { nome, telefone, papel } })).status, 201);
  }
});

test('login com destino atendimento volta ao portal da empresa; outro valor é ignorado', async () => {
  assert.equal((await entrarComCodigo('5565999990003', { destino: 'atendimento' })).redirecionar, '/app/ia-talk/j2a/atendimento');
  // Limite de 3 códigos por celular em 10 min: os outros casos usam a administradora.
  assert.equal((await entrarComCodigo('5565999990001')).redirecionar, '/app/ia-talk/shell.html');
  assert.equal((await entrarComCodigo('5565999990001', { destino: 'https://exemplo.com' })).redirecionar, '/app/ia-talk/shell.html', 'nunca um endereço livre');
});

test('portal sem sessão leva ao login da empresa com destino; apelido desconhecido é 404', async () => {
  const r = await navegador().ir('/j2a/atendimento');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/app/ia-talk/j2a?destino=atendimento');
  const nada = await navegador().ir('/nao-existe/atendimento');
  assert.equal(nada.status, 404);
  assert.match(nada.corpo, /Link de acesso não encontrado/);
});

test('portal: atendente entra; quem não tem o atendimento vê o aviso; sessão de outra empresa volta ao login', async () => {
  const { nav: carla } = await entrarComCodigo('5565999990003', { destino: 'atendimento' });
  const r = await carla.ir('/j2a/atendimento');
  if (PORTAL_ENTREGUE) {
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  } else {
    assert.equal(r.status, 404);
    assert.match(r.corpo, /G15/, 'página ainda não entregue, mas a pessoa passou pelas conferências');
  }

  const { nav: davi } = await entrarComCodigo('5565999990004', { destino: 'atendimento' });
  const negado = await davi.ir('/j2a/atendimento');
  assert.equal(negado.status, 403);
  assert.match(negado.corpo, /acesso ao atendimento/);

  const outra = await entrarComLink({ nome: 'Eva Outra', telefone: '5565999990009', empresa: 'Outra Empresa', apelido: 'outra' });
  const cruzado = await outra.ir('/j2a/atendimento');
  assert.equal(cruzado.status, 302, 'sessão de outra empresa não abre o portal desta');
  assert.equal(cruzado.headers.get('location'), '/app/ia-talk/j2a?destino=atendimento');
});
