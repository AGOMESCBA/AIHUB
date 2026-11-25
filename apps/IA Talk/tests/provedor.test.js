'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProvedorBase, validarEnvelope, conferirImplementacao, CAPACIDADES_VAZIAS } = require('../backend/provedores/interface');
const { ProvedorSimulado, CAPACIDADES_SIMULADO } = require('../backend/provedores/simulado');

const esperar = (emissor, evento) => new Promise((r) => emissor.once(evento, r));

test('interface: provedor simulado cumpre o contrato', () => {
  assert.deepEqual(conferirImplementacao(new ProvedorSimulado()), []);
  assert.throws(() => new ProvedorBase(), /abstrata/);
});

test('interface: provedor incompleto é apontado', () => {
  class Incompleto extends ProvedorBase { get codigo() { return 'x'; } capacidades() { return { texto: true }; } }
  const faltando = conferirImplementacao(new Incompleto());
  for (const m of ['iniciar', 'parar', 'enviar']) assert.ok(faltando.includes(m), m);
  assert.ok(faltando.includes('capacidades.modelos'), 'capacidades sem chave obrigatória');
});

test('envelope: recusa o que o canal não suporta, sem simular', () => {
  const caps = { ...CAPACIDADES_VAZIAS, texto: true };
  const pdf = { nome: 'a.pdf', mime: 'application/pdf', dados: Buffer.from('%PDF-1.4') };
  assert.equal(validarEnvelope({ tipo: 'texto', texto: 'oi', destinatario: { tipo: 'telefone', valor: '5565999990000' } }, caps), true);
  const recusado = (env, c = caps) => assert.throws(() => validarEnvelope(env, c), (e) => e.codigo === 'recurso_nao_suportado');
  recusado({ tipo: 'documento', arquivo: pdf, destinatario: { tipo: 'telefone', valor: '1' } });
  recusado({ tipo: 'texto', texto: 'oi', destinatario: { tipo: 'grupo', valor: 'g1' } });
  recusado({ tipo: 'texto', texto: 'oi', modelo: { nome: 'aviso' }, destinatario: { tipo: 'telefone', valor: '1' } });
  recusado({ tipo: 'documento', arquivo: pdf, destinatario: { tipo: 'telefone', valor: '1' } },
    { ...caps, documento: true, max_midia_bytes: 3, mimes_aceitos: [] });
  assert.throws(() => validarEnvelope({ tipo: 'texto', texto: '  ', destinatario: { tipo: 'telefone', valor: '1' } }, caps), (e) => e.codigo === 'requisicao_invalida');
  assert.throws(() => validarEnvelope({ tipo: 'sticker', destinatario: { tipo: 'telefone', valor: '1' } }, caps), (e) => e.codigo === 'requisicao_invalida');
});

test('simulado: QR → conectado → envio com recibos em ordem', async () => {
  const p = new ProvedorSimulado({ atrasoMs: 1 });
  const estados = [];
  p.on('estado', (e) => estados.push(e.estado));
  const qr = esperar(p, 'qr');
  await p.iniciar();
  assert.match((await qr).qr, /^data:image\/png;base64,/);
  await assert.rejects(p.enviar({ tipo: 'texto', texto: 'oi', destinatario: { tipo: 'telefone', valor: '5565999990000' } }), (e) => e.tipo === 'temporario');
  p.simularLeituraQr();
  const recibos = [];
  const fim = new Promise((r) => p.on('status', (s) => { recibos.push(s.estado); if (s.estado === 'lida') r(); }));
  const { id_provedor } = await p.enviar({ tipo: 'texto', texto: 'oi', destinatario: { tipo: 'telefone', valor: '5565999990000' } });
  await fim;
  assert.ok(id_provedor.startsWith('sim_'));
  assert.deepEqual(recibos, ['enviada', 'entregue', 'lida']);
  assert.deepEqual(estados, ['iniciando', 'qr_pendente', 'conectado']);
});

test('simulado: falha forçada informa o tipo e não envia', async () => {
  const p = new ProvedorSimulado();
  await p.iniciar();
  p.simularLeituraQr();
  p.falhar = 'desconhecido';
  await assert.rejects(p.enviar({ tipo: 'texto', texto: 'oi', destinatario: { tipo: 'telefone', valor: '1' } }), (e) => e.tipo === 'desconhecido');
  assert.equal(p.enviados.length, 0);
  const recebida = esperar(p, 'mensagem');
  p.simularRecebimento({ texto: 'olá' });
  assert.equal((await recebida).texto, 'olá');
  assert.equal(CAPACIDADES_SIMULADO.video, false);
});
