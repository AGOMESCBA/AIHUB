'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escolherAtendente, prazoDaOferta, ofertaVencida } = require('../backend/lib/distribuicao');

const candidato = (id, extras = {}) => ({ id, status: 'disponivel', online: true, abertas: 0, ultima_oferta_em: null, ...extras });
const escolher = (candidatos, extras = {}) => escolherAtendente({ candidatos, limite: 3, ...extras });

test('exclui indisponíveis, offline, quem atingiu o limite e recusou', () => {
  const pessoas = [candidato('ocupado', { status: 'ocupado' }), candidato('ausente', { status: 'ausente' }),
    candidato('offline', { online: false }), candidato('limite', { abertas: 3 }), candidato('recusou'), candidato('apto', { abertas: 2 })];
  assert.deepEqual(escolher(pessoas, { excluir: ['recusou'] }), { usuario_id: 'apto' });
  assert.equal(escolher(pessoas.slice(0, 5), { excluir: ['recusou'] }), null);
});

test('prioriza menor carga, depois oferta mais antiga e quem nunca recebeu', () => {
  const pessoas = [candidato('muito', { abertas: 2 }), candidato('recente', { abertas: 1, ultima_oferta_em: '2026-11-28T10:00:00Z' }),
    candidato('antigo', { abertas: 1, ultima_oferta_em: '2026-11-27T10:00:00Z' })];
  assert.deepEqual(escolher(pessoas), { usuario_id: 'antigo' });
  pessoas.push(candidato('nunca', { abertas: 1 }));
  assert.deepEqual(escolher(pessoas), { usuario_id: 'nunca' });
  pessoas.push(candidato('menor', { abertas: 0, ultima_oferta_em: '2026-11-28T11:00:00Z' }));
  assert.deepEqual(escolher(pessoas), { usuario_id: 'menor' });
});

test('empate total usa id, independente da ordem e sem alterar candidatos', () => {
  const pessoas = [candidato('z'), candidato('a'), candidato('b')];
  const copia = structuredClone(pessoas);
  for (let i = 0; i < 100; i++) assert.deepEqual(escolher(i % 2 ? pessoas : [...pessoas].reverse()), { usuario_id: 'a' });
  assert.deepEqual(pessoas, copia);
});

test('entradas vazias e malformadas não geram escolha insegura', () => {
  assert.equal(escolher([]), null);
  assert.equal(escolher([null, {}, candidato('', {}), candidato('data', { ultima_oferta_em: 'inválida' }), candidato('carga', { abertas: '0' })]), null);
  assert.deepEqual(escolher([{}, candidato('válido')]), { usuario_id: 'válido' });
  for (const limite of ['3', NaN, Infinity, null, 0]) assert.equal(escolher([candidato('a')], { limite }), null);
  assert.equal(escolherAtendente(), null);
});

test('calcula e verifica vencimento no instante exato', () => {
  const agoraMs = Date.parse('2026-11-28T12:00:00.000Z');
  const ate = prazoDaOferta({ agoraMs, tempoAceiteMin: 3 });
  assert.equal(ate, '2026-11-28T12:03:00.000Z');
  assert.equal(ofertaVencida({ ate, agoraMs: agoraMs + 179999 }), false);
  assert.equal(ofertaVencida({ ate, agoraMs: agoraMs + 180000 }), true);
  assert.equal(ofertaVencida({ ate, agoraMs: agoraMs + 180001 }), true);
  assert.equal(ofertaVencida({ ate: 'inválida', agoraMs }), false);
  assert.throws(() => prazoDaOferta({ agoraMs, tempoAceiteMin: NaN }), TypeError);
});
