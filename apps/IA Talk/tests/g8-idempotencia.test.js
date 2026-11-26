'use strict';

// G8 (Antigravity) — testes unitários da biblioteca backend/lib/idempotencia.

const test = require('node:test');
const assert = require('node:assert/strict');
const idempotencia = require('../backend/lib/idempotencia');
const { ErroTalk, corpoErro } = require('../backend/erros');

const HORA = 60 * 60 * 1000;
const BASE = Date.parse('2026-11-26T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

test('idempotencia: impressaoDoPedido ignora ordem das chaves mas distingue ordem em arrays', () => {
  const a = idempotencia.impressaoDoPedido({
    canal: 'cn_suporte',
    para: '+5565999990000',
    metadados: { b: '2', a: '1' },
    tags: ['urgente', 'erp'],
  });
  const b = idempotencia.impressaoDoPedido({
    tags: ['urgente', 'erp'],
    metadados: { a: '1', b: '2', ignorado: undefined },
    para: '+5565999990000',
    canal: 'cn_suporte',
  });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b, 'ordem das chaves não pode mudar o SHA-256');

  const arrayInvertido = idempotencia.impressaoDoPedido({
    canal: 'cn_suporte',
    para: '+5565999990000',
    metadados: { a: '1', b: '2' },
    tags: ['erp', 'urgente'],
  });
  assert.notEqual(a, arrayInvertido, 'ordem dos itens no array deve mudar o SHA-256');

  // Objetos aninhados dentro de arrays também têm chaves normalizadas
  const arrObj1 = idempotencia.impressaoDoPedido([{ z: 1, a: 2 }]);
  const arrObj2 = idempotencia.impressaoDoPedido([{ a: 2, z: 1 }]);
  assert.equal(arrObj1, arrObj2);
});

test('idempotencia: avaliar distingue novo, repetido, conflito e expiração após 24 h', () => {
  const imp1 = idempotencia.impressaoDoPedido({ canal: 'cn_suporte', texto: 'Olá' });
  const imp2 = idempotencia.impressaoDoPedido({ canal: 'cn_suporte', texto: 'Outro texto' });

  // Sem registro → novo
  assert.equal(idempotencia.avaliar({ registro: null, impressao: imp1, agora: iso(BASE) }), 'novo');

  const registro = { impressao: imp1, criado_em: iso(BASE) };

  // Mesma impressão dentro de 24 h (inclusive no limite exato de 24 h) → repetido
  assert.equal(idempotencia.avaliar({ registro, impressao: imp1, agora: iso(BASE + 1000) }), 'repetido');
  assert.equal(idempotencia.avaliar({ registro, impressao: imp1, agora: iso(BASE + 24 * HORA) }), 'repetido');

  // Impressão diferente dentro de 24 h → conflito
  assert.equal(idempotencia.avaliar({ registro, impressao: imp2, agora: iso(BASE + 5 * HORA) }), 'conflito');

  // Mais de 24 h → novo (tanto para mesma impressão quanto para diferente)
  assert.equal(idempotencia.avaliar({ registro, impressao: imp1, agora: iso(BASE + 24 * HORA + 1) }), 'novo');
  assert.equal(idempotencia.avaliar({ registro, impressao: imp2, agora: iso(BASE + 24 * HORA + 1) }), 'novo');
});

test('idempotencia: validarChave aceita 8–128 chars [A-Za-z0-9_-] e lança ErroTalk codigo=validacao para inválidas', () => {
  assert.equal(idempotencia.validarChave('abcd1234'), 'abcd1234');
  assert.equal(idempotencia.validarChave('pedido_36901-envio-01'), 'pedido_36901-envio-01');
  const max128 = 'a'.repeat(128);
  assert.equal(idempotencia.validarChave(max128), max128);

  const invalidas = [
    '',
    null,
    undefined,
    12345678,
    'curta77',          // 7 chars
    'a'.repeat(129),    // 129 chars
    'chave com espaco',
    'chave.com.ponto',
    'chave/barra123',
    'chave@arroba12',
    ' chave_espaco1',
  ];

  for (const chave of invalidas) {
    assert.throws(
      () => idempotencia.validarChave(chave),
      (err) => {
        assert.ok(err instanceof ErroTalk, 'deve usar ErroTalk do backend/erros.js');
        assert.equal(err.codigo, 'validacao');
        assert.equal(err.status, 400);
        const corpo = corpoErro(err);
        assert.equal(corpo.erro.codigo, 'validacao');
        assert.ok(corpo.erro.mensagem.length > 0);
        return true;
      },
      `deveria recusar chave: ${String(chave)}`,
    );
  }
});
