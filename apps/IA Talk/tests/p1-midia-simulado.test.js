'use strict';

// P1 (docs/contratos.md §10) no servidor simulado: anexos na conversa, ver/baixar com tipo real e
// cabeçalhos de segurança, expirado (410), anexar pela Central (corpo binário, tipo pelo conteúdo,
// 16 MB, legenda) e cliente mandando arquivo (/simulado/receber). O servidor real vem no P1 real.

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarServidorSimulado } = require('../backend/simulado/servidor-simulado');
const { camposFaltando } = require('../backend/contratos');
const { AMOSTRAS } = require('../backend/simulado/midia-simulada');

const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);

async function comSimulado(t) {
  const sim = criarServidorSimulado({ intervaloLogMs: 60000, intervaloQrMs: 60000, intervaloConversaMs: 0, log: { error() {} } });
  const { port } = await sim.iniciar(0);
  t.after(() => sim.fechar());
  const base = `http://127.0.0.1:${port}/app/ia-talk/api/admin`;
  const api = async (caminho, { metodo = 'GET', corpo, binario, tipo = 'application/json' } = {}) => {
    const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { 'Content-Type': binario ? 'application/octet-stream' : tipo },
      body: binario || (corpo === undefined ? undefined : JSON.stringify(corpo)) });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, corpo: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { api };
}

test('semente: imagem, PDF e voz na cv_ex01; prévia da conversa; recurso midia ligado (P1 real pronto)', async (t) => {
  const { api } = await comSimulado(t);
  const itens = (await api('/conversas/cv_ex01/itens?limite=100')).corpo.itens;
  const comMidia = itens.filter(i => i.midia);
  assert.deepEqual(comMidia.map(i => i.tipo).sort(), ['audio', 'documento', 'imagem']);
  for (const i of itens) forma('itemConversa', i);
  assert.equal(comMidia.find(i => i.tipo === 'audio').midia.voz, true);
  assert.equal(comMidia.find(i => i.tipo === 'imagem').texto, 'Olha o erro que aparece na tela', 'legenda no texto');
  assert.equal((await api('/atendimento/recursos')).corpo.midia, true);
});

test('ver e baixar: tipo real, abre no navegador ou baixa, cabeçalhos de segurança; expirado = 410', async (t) => {
  const { api } = await comSimulado(t);
  const img = (await api('/conversas/cv_ex01/itens?limite=100')).corpo.itens.find(i => i.tipo === 'imagem').midia;
  const r = await api(`/midias/${img.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('content-disposition'), /^inline/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), 'sandbox');
  assert.equal(r.corpo.length, img.tamanho);
  assert.match((await api(`/midias/${img.id}?baixar=1`)).headers.get('content-disposition'), /^attachment/);
  assert.equal((await api('/midias/md_nao_existe')).status, 404);

  const expirado = (await api('/conversas/cv_ex07/itens?limite=100')).corpo.itens.find(i => i.midia).midia;
  assert.deepEqual([expirado.disponivel, expirado.motivo], [false, 'expirado']);
  const r410 = await api(`/midias/${expirado.id}`);
  assert.equal(r410.status, 410);
  assert.equal(r410.corpo.erro.codigo, 'midia_expirada');
});

test('anexar pela Central: tipo pelo conteúdo, legenda, recusa executável, 16 MB e encerrada', async (t) => {
  const { api } = await comSimulado(t);
  const pdf = AMOSTRAS.pdf().dados;
  const r = await api('/conversas/cv_ex02/anexos?nome=boleto.pdf&legenda=Segue%20o%20boleto', { metodo: 'POST', binario: pdf });
  assert.equal(r.status, 202);
  forma('itemConversa', r.corpo);
  assert.deepEqual([r.corpo.tipo, r.corpo.texto, r.corpo.midia.mime, r.corpo.midia.nome], ['documento', 'Segue o boleto', 'application/pdf', 'boleto.pdf']);
  const volta = await api(`/midias/${r.corpo.midia.id}`);
  assert.ok(volta.corpo.equals(pdf), 'o arquivo guardado é o mesmo enviado');

  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
  const recusado = await api('/conversas/cv_ex02/anexos?nome=foto.png', { metodo: 'POST', binario: exe });
  assert.equal(recusado.status, 422, 'nome .png não engana: vale o conteúdo');
  assert.equal(recusado.corpo.erro.codigo, 'tipo_nao_suportado');

  const grande = await api('/conversas/cv_ex02/anexos?nome=x.pdf', { metodo: 'POST', binario: Buffer.alloc(16 * 1024 * 1024 + 10, 0x20) });
  assert.equal(grande.status, 413);
  assert.equal(grande.corpo.erro.codigo, 'arquivo_grande');
  assert.equal((await api(`/conversas/cv_ex02/anexos?nome=x.pdf&legenda=${'a'.repeat(1025)}`, { metodo: 'POST', binario: pdf })).status, 400);
  assert.equal((await api('/conversas/cv_ex07/anexos?nome=x.pdf', { metodo: 'POST', binario: pdf })).status, 409, 'encerrada');
});

test('cliente manda arquivo: vira item com mídia e prévia "📎 Imagem"', async (t) => {
  const { api } = await comSimulado(t);
  const png = AMOSTRAS.imagem().dados.toString('base64');
  const cv = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex2', midia: { nome: 'print.png', base64: png } } })).corpo;
  assert.equal(cv.ultima_mensagem.previa, '📎 Imagem');
  const ultimo = (await api(`/conversas/${cv.id}/itens?limite=1`)).corpo.itens[0];
  assert.deepEqual([ultimo.tipo, ultimo.texto, ultimo.midia.mime], ['imagem', null, 'image/png']);
  const ruim = await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex2', midia: { nome: 'a.exe', base64: Buffer.from('MZxxxx').toString('base64') } } });
  assert.equal(ruim.status, 422);
});
