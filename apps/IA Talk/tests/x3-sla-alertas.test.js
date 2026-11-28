'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { avaliarSla, alertasDevidos, textoDoAlerta } = require('../backend/lib/sla-alertas');
const inicio = Date.parse('2026-11-28T12:00:00.000Z');
const abertaEm = new Date(inicio).toISOString();
const pessoas = [
  { id: 'a', status: 'disponivel', online: true, alertas_whatsapp: true },
  { id: 'b', status: 'disponivel', online: false, alertas_whatsapp: false },
  { id: 'c', status: 'ocupado', online: false, alertas_whatsapp: true },
  { id: 'd', status: 'ausente', online: true, alertas_whatsapp: true },
];
const setor = { alertas: { whatsapp_ligado: true, espera_min: 5, escalonar_min: 15, escalonar_para: ['c', 'd'] }, supervisao: ['a'] };
const conversa = { id: 'cv', na_fila: true, aguardando_desde: abertaEm, sla_situacao: 'estourado', oferta: { para: { id: 'c' } } };
const params = { conversa, setor, pessoas, jaEnviados: new Set(), agoraMs: inicio + 16 * 60000, dentroDoHorario: true };
const chave = a => [conversa.id, a.tipo, a.usuario_id, a.via].join('|');
const tem = (lista, tipo, usuario_id, via) => lista.some(a => a.tipo === tipo && a.usuario_id === usuario_id && a.via === via);

test('SLA mantém as bordas e muda após 80% e 100%', () => {
  const base = { abertaEm, respondida: false, primeiraRespostaMin: 10, atencaoPct: 80 };
  for (const [delta, situacao] of [[0, 'ok'], [480000, 'ok'], [480001, 'atencao'], [600000, 'atencao'], [600001, 'estourado']]) {
    assert.deepEqual(avaliarSla({ ...base, agoraMs: inicio + delta }), { prazo: '2026-11-28T12:10:00.000Z', situacao });
  }
  assert.equal(avaliarSla({ ...base, respondida: true, agoraMs: inicio }), null);
});

test('oferta, fila, espera, SLA e escalonamento respeitam destinatários', () => {
  const lista = alertasDevidos(params);
  assert.ok(tem(lista, 'oferta', 'c', 'tela'));
  assert.ok(!lista.some(a => a.tipo === 'oferta' && a.via === 'whatsapp'));
  for (const tipo of ['nova_na_fila', 'espera_longa', 'sla_estourado']) {
    assert.ok(tem(lista, tipo, 'a', 'tela')); assert.ok(tem(lista, tipo, 'b', 'tela'));
    assert.ok(!tem(lista, tipo, 'c', 'tela'));
  }
  assert.ok(tem(lista, 'escalonamento', 'c', 'tela'));
  assert.ok(tem(lista, 'escalonamento', 'c', 'whatsapp'));
  assert.ok(!lista.some(a => a.usuario_id === 'd'));
  assert.ok(tem(lista, 'espera_longa', 'a', 'whatsapp'));
  assert.ok(!tem(lista, 'espera_longa', 'b', 'whatsapp'));
});

test('não repete, não altera entradas e respeita horário e configurações', () => {
  const enviados = new Set(); const lista = alertasDevidos({ ...params, jaEnviados: enviados });
  assert.equal(enviados.size, 0);
  lista.forEach(a => enviados.add(chave(a)));
  assert.deepEqual(alertasDevidos({ ...params, jaEnviados: enviados }), []);
  assert.deepEqual(alertasDevidos({ ...params, dentroDoHorario: false }), []);
  const desligado = { ...setor, alertas: { ...setor.alertas, whatsapp_ligado: false } };
  assert.ok(!alertasDevidos({ ...params, setor: desligado }).some(a => a.via === 'whatsapp'));
});

test('espera e escalonamento só após limite; usa supervisão se destinos vazios', () => {
  const config = { ...setor, alertas: { ...setor.alertas, escalonar_para: [] } };
  let lista = alertasDevidos({ ...params, setor: config, agoraMs: inicio + 5 * 60000 });
  assert.ok(!lista.some(a => a.tipo === 'espera_longa'));
  lista = alertasDevidos({ ...params, setor: config, agoraMs: inicio + 15 * 60000 });
  assert.ok(!lista.some(a => a.tipo === 'escalonamento'));
  lista = alertasDevidos({ ...params, setor: config });
  assert.ok(tem(lista, 'escalonamento', 'a', 'tela'));
  const semEscala = { ...config, alertas: { ...config.alertas, escalonar_min: 0 } };
  assert.ok(!alertasDevidos({ ...params, setor: semEscala }).some(a => a.tipo === 'escalonamento'));
  assert.ok(!alertasDevidos({ ...params, conversa: { ...conversa, na_fila: false } }).some(a => ['nova_na_fila', 'espera_longa', 'escalonamento'].includes(a.tipo)));
});

test('sem pessoas online, alerta os disponíveis autorizados no WhatsApp', () => {
  const offline = pessoas.map(p => ({ ...p, online: false }));
  const lista = alertasDevidos({ ...params, pessoas: offline, agoraMs: inicio });
  assert.ok(tem(lista, 'nova_na_fila', 'a', 'whatsapp'));
  assert.ok(!tem(lista, 'nova_na_fila', 'b', 'whatsapp'));
});

test('texto do alerta não inclui conteúdo do cliente', () => {
  const texto = textoDoAlerta({ tipo: 'nova_na_fila', protocolo: '2026-000123', setorNome: 'Suporte', esperaMin: 5,
    linkPortal: 'https://exemplo.test/portal', conversa: { texto: 'DADO PRIVADO DO CLIENTE' } });
  assert.match(texto, /Suporte.*2026-000123/);
  assert.match(texto, /Espera: 5 min/);
  assert.ok(texto.includes('https://exemplo.test/portal'));
  assert.ok(!texto.includes('DADO PRIVADO DO CLIENTE'));
});
