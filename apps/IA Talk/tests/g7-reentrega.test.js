'use strict';

// G7 (Antigravity) — testes unitários da biblioteca backend/lib/reentrega.

const test = require('node:test');
const assert = require('node:assert/strict');
const reentrega = require('../backend/lib/reentrega');

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const BASE = Date.parse('2026-11-26T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

test('reentrega: percorre cada degrau (1m, 5m, 15m, 1h, 3h, 6h) e depois a cada 6h até 24h', () => {
  const criados = iso(BASE);
  const esperadosMin = [1, 5, 15, 60, 180, 360, 360, 360];

  let cursor = BASE;
  for (let tentativa = 0; tentativa < esperadosMin.length; tentativa++) {
    const res = reentrega.proximaTentativa({ tentativa, criadoEm: criados, agora: iso(cursor) });
    const esperadoMs = cursor + esperadosMin[tentativa] * MIN;
    assert.deepEqual(res, { em: iso(esperadoMs) }, `degrau tentativa=${tentativa}`);
    cursor = esperadoMs;
  }

  // Após 1m + 5m + 15m + 1h + 3h + 6h + 6h + 6h = 22h21m, +6h ultrapassa 24h → esgotado
  const fim = reentrega.proximaTentativa({ tentativa: 8, criadoEm: criados, agora: iso(cursor) });
  assert.deepEqual(fim, { esgotado: true });
});

test('reentrega: respeita o limite exato de 24 h desde a criação', () => {
  const criadoEm = iso(BASE);

  // Exatamente 18h + degrau de 6h = exatamente 24h → ainda permitido
  const exato = reentrega.proximaTentativa({
    tentativa: 5,
    criadoEm,
    agora: iso(BASE + 18 * HORA),
  });
  assert.deepEqual(exato, { em: iso(BASE + 24 * HORA) });

  // 1 ms depois do limite de 24 h → esgotado
  const passou = reentrega.proximaTentativa({
    tentativa: 5,
    criadoEm,
    agora: iso(BASE + 18 * HORA + 1),
  });
  assert.deepEqual(passou, { esgotado: true });

  // Tentativa 0 a 23h59m00s → exatamente 24h (ok); a 23h59m01s → esgotado
  assert.deepEqual(
    reentrega.proximaTentativa({ tentativa: 0, criadoEm, agora: iso(BASE + 24 * HORA - MIN) }),
    { em: iso(BASE + 24 * HORA) },
  );
  assert.deepEqual(
    reentrega.proximaTentativa({ tentativa: 0, criadoEm, agora: iso(BASE + 24 * HORA - MIN + 1000) }),
    { esgotado: true },
  );
});

test('reentrega: recusa tentativa e datas inválidas', () => {
  const criadoEm = iso(BASE);
  for (const invalida of [-1, 1.5, NaN, Infinity, '0', null, undefined]) {
    assert.throws(
      () => reentrega.proximaTentativa({ tentativa: invalida, criadoEm, agora: criadoEm }),
      TypeError,
    );
  }
  assert.throws(
    () => reentrega.proximaTentativa({ tentativa: 0, criadoEm: 'data-invalida', agora: criadoEm }),
    TypeError,
  );
  assert.throws(
    () => reentrega.proximaTentativa({ tentativa: 0, criadoEm, agora: 'invalida' }),
    TypeError,
  );
});

test('reentrega: classifica status HTTP, tempo esgotado (> 10 s) e erro de rede', () => {
  // 2xx em até 10 s → entregue
  assert.equal(reentrega.classificarResposta({ status: 200, duracaoMs: 120 }), 'entregue');
  assert.equal(reentrega.classificarResposta({ status: 202, duracaoMs: 10000 }), 'entregue');
  assert.equal(reentrega.classificarResposta({ status: 204, duracaoMs: 0 }), 'entregue');

  // 2xx acima de 10 s → repetir (tempo esgotado)
  assert.equal(reentrega.classificarResposta({ status: 200, duracaoMs: 10001 }), 'repetir');

  // 410 Gone → falha definitiva
  assert.equal(reentrega.classificarResposta({ status: 410, duracaoMs: 80 }), 'falha_definitiva');

  // 429, 5xx, 408, 4xx outros e erro de rede → repetir
  assert.equal(reentrega.classificarResposta({ status: 429, duracaoMs: 50 }), 'repetir');
  assert.equal(reentrega.classificarResposta({ status: 500, duracaoMs: 250 }), 'repetir');
  assert.equal(reentrega.classificarResposta({ status: 502, duracaoMs: 300 }), 'repetir');
  assert.equal(reentrega.classificarResposta({ status: 503, duracaoMs: 400 }), 'repetir');
  assert.equal(reentrega.classificarResposta({ status: 504, duracaoMs: 9000 }), 'repetir');
  assert.equal(reentrega.classificarResposta({ status: 408, duracaoMs: 5000 }), 'repetir');
  assert.equal(reentrega.classificarResposta({ status: 404, duracaoMs: 90 }), 'repetir');
  assert.equal(reentrega.classificarResposta({ status: null, duracaoMs: 10005, erroRede: true }), 'repetir');
  assert.equal(reentrega.classificarResposta({ erroRede: new Error('ECONNRESET') }), 'repetir');
});
