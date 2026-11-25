'use strict';

// G4 (Antigravity): contrato de backend/lib/midia. Ao implementar, troque
// `{ todo: PENDENTE }` por `{}` (ou apague a opção) e faça passar.
// Mesmos casos que a C3 vai usar; não afrouxar sem combinar com o Claude Code.

const test = require('node:test');
const assert = require('node:assert/strict');
const midia = require('../backend/lib/midia');

const PENDENTE = 'G4: implementar backend/lib/midia';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1');
const REGRAS = { mimesAceitos: ['image/png', 'application/pdf'], limiteBytes: 1024 };

test('assinatura: módulo exporta as funções congeladas', () => {
  for (const f of ['detectarMime', 'validarArquivo', 'ipBloqueado', 'baixarUrlSegura']) assert.equal(typeof midia[f], 'function', f);
  assert.equal(new midia.ErroMidia('url_invalida', 'x').codigo, 'url_invalida');
});

test('detectarMime: pelo conteúdo, não pela extensão', { todo: PENDENTE }, () => {
  assert.equal(midia.detectarMime(PNG), 'image/png');
  assert.equal(midia.detectarMime(PDF), 'application/pdf');
  assert.equal(midia.detectarMime(Buffer.from('texto qualquer')), null);
});

test('validarArquivo: aceita, recusa tipo, tamanho, conteúdo trocado e caminho no nome', { todo: PENDENTE }, () => {
  assert.deepEqual(midia.validarArquivo({ nome: 'a.png', mime: 'image/png', dados: PNG }, REGRAS), { ok: true, mime: 'image/png', tamanho: PNG.length, nome: 'a.png' });
  assert.equal(midia.validarArquivo({ nome: 'a.pdf', mime: 'image/png', dados: PDF }, REGRAS).codigo, 'arquivo_invalido');
  assert.equal(midia.validarArquivo({ nome: 'a.gif', mime: 'image/gif', dados: Buffer.from('GIF89a') }, REGRAS).codigo, 'tipo_nao_suportado');
  assert.equal(midia.validarArquivo({ nome: 'g.pdf', mime: 'application/pdf', dados: Buffer.concat([PDF, Buffer.alloc(2048)]) }, REGRAS).codigo, 'arquivo_grande');
  assert.equal(midia.validarArquivo({ nome: 'v.png', mime: 'image/png', dados: Buffer.alloc(0) }, REGRAS).codigo, 'arquivo_invalido');
  assert.equal(midia.validarArquivo({ nome: '..\\..\\x.png', mime: 'image/png', dados: PNG }, REGRAS).nome, 'x.png');
});

test('ipBloqueado: privados, loopback, link-local, CGNAT, IPv6 e mapeados', { todo: PENDENTE }, () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(midia.ipBloqueado(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '200.160.2.3', '2001:4860:4860::8888']) assert.equal(midia.ipBloqueado(ip), false, ip);
});

test('baixarUrlSegura: só https e nunca destino interno', { todo: PENDENTE }, async () => {
  await assert.rejects(midia.baixarUrlSegura('http://exemplo.com/a.png'), (e) => e.codigo === 'url_invalida');
  await assert.rejects(midia.baixarUrlSegura('file:///C:/Windows/win.ini'), (e) => e.codigo === 'url_invalida');
  await assert.rejects(midia.baixarUrlSegura('https://interno.exemplo/a.png', { resolverDns: async () => ['10.0.0.5'] }), (e) => e.codigo === 'destino_bloqueado');
  await assert.rejects(midia.baixarUrlSegura('https://misto.exemplo/a.png', { resolverDns: async () => ['8.8.8.8', '127.0.0.1'] }), (e) => e.codigo === 'destino_bloqueado');
});
