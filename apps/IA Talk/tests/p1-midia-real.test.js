'use strict';

// P1 (docs/contratos.md §10) no servidor REAL, ponta a ponta com o processo do canal usando o provedor
// SIMULADO (nada de WhatsApp de verdade): API v1 com arquivo até "enviada"; recebimento com arquivo
// (guardado, recusado, grande); anexo pela Central até o canal; ver/baixar, prazo vencido; arquivo
// cifrado no disco; provedor do WhatsApp baixando a mídia (msg falsa).

const fs = require('fs');
const os = require('os');
const path = require('path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-p1-'));
process.env.IA_TALK_DATA_DIR = pasta; // antes de carregar o config: os arquivos vão para a pasta do teste

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { criarApp } = require('../backend/servidor');
const { SupervisorCanais } = require('../backend/canais/supervisor');
const { Despachante } = require('../backend/mensagens/despachante');
const { Atendimento } = require('../backend/atendimento/servico');
const { ProvedorWweb } = require('../backend/provedores/wweb');
const armazem = require('../backend/midias/armazem');
const { camposFaltando } = require('../backend/contratos');
const { AMOSTRAS } = require('../backend/simulado/midia-simulada');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);
const esperar = async (cond, ms = 8000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('condição não atingida a tempo');
};
const CLIENTE = '5565999990010';
const PNG = AMOSTRAS.imagem().dados;
const PDF = AMOSTRAS.pdf().dados;
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 7)]);

let db; let base; let servidor; let supervisor; let despachante; let atendimento; let cookie; let canal; let token;

test.before(async () => {
  db = abrirBanco({ arquivo: ':memory:' });
  supervisor = new SupervisorCanais({ db, emitir: () => {}, dirSessoes: path.join(pasta, 'sessoes'),
    envFilho: { IA_TALK_PROVEDOR_FORCADO: 'simulado' }, log: { error() {} }, esperas: [100, 100] });
  despachante = new Despachante({ db, supervisor, emitir: () => {}, intervaloMinimoMs: 0, variacaoMs: 0, tickMs: 50, esperas: [50] });
  atendimento = new Atendimento({ db, despachante });
  despachante.aoAvisar = (m) => atendimento.aoEstadoMensagem(m);
  servidor = http.createServer(criarApp({ db, log: { error() {} }, supervisor, despachante, atendimento, transportes: { whatsapp: async () => ({ ok: false }) } }));
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}/app/ia-talk`;
  despachante.iniciar();

  const { link } = primeiroAcesso({ db, nome: 'Ana', telefone: '5565999990001', empresa: 'J2A', apelido: 'j2a' });
  cookie = (await fetch(`${base}${link.slice(link.indexOf('/api/publico'))}`, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  canal = (await admin('/canais', 'POST', { nome: 'Envio', provedor: 'wweb', numero: '5565900000000' })).corpo;
  await admin(`/canais/${canal.id}/conectar`, 'POST');
  await esperar(async () => (await admin(`/canais/${canal.id}`)).corpo.estado === 'qr_pendente');
  supervisor._comandoTeste(canal.id, 'simular-leitura');
  await esperar(async () => (await admin(`/canais/${canal.id}`)).corpo.estado === 'conectado');
  const setor = (await admin('/setores', 'POST', { nome: 'Suporte' })).corpo;
  assert.equal((await admin(`/canais/${canal.id}`, 'PUT', { envio_habilitado: true, numeros_teste: [CLIENTE], uso: 'atendimento', setor_padrao_id: setor.id })).status, 200);
  const app = (await admin('/aplicacoes', 'POST', { nome: 'ERP', escopos: ['mensagens:enviar', 'mensagens:ler', 'canais:ler'], canais_autorizados: [canal.id] })).corpo;
  token = (await admin(`/aplicacoes/${app.id}/tokens`, 'POST')).corpo.token;
});
test.after(async () => {
  despachante.parar();
  await supervisor.pararTodos();
  await new Promise(r => servidor.close(r));
  fs.rmSync(pasta, { recursive: true, force: true });
});

async function admin(caminho, metodo = 'GET', corpo, { binario } = {}) {
  const r = await fetch(`${base}/api/admin${caminho}`, { method: metodo,
    headers: { Cookie: cookie, 'Content-Type': binario ? 'application/octet-stream' : 'application/json' },
    body: binario || (corpo === undefined ? undefined : JSON.stringify(corpo)) });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, corpo: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
async function v1(corpo, chave) {
  const r = await fetch(`${base}/api/v1/mensagens`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': chave }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json() };
}
const estadoDa = (id) => db.prepare('SELECT estado FROM mensagens WHERE id = ?').get(id)?.estado;

test('API v1: PDF em base64 sai pelo canal até "enviada"; tipo errado, executável e URL interna são recusados', async () => {
  const r = await v1({ canal: canal.id, para: `+${CLIENTE}`, tipo: 'documento', legenda: 'Seu boleto', arquivo: { nome: 'boleto.pdf', base64: PDF.toString('base64') } }, 'midia-0001');
  assert.equal(r.status, 202);
  await esperar(() => ['enviada', 'entregue', 'lida'].includes(estadoDa(r.corpo.id)));
  const m = db.prepare('SELECT tipo, conteudo, previa, midia_id FROM mensagens WHERE id = ?').get(r.corpo.id);
  assert.deepEqual([m.tipo, m.conteudo, m.previa], ['documento', 'Seu boleto', 'Seu boleto']);
  const det = (await admin(`/mensagens/${r.corpo.id}`)).corpo;
  forma('mensagemDetalhe', det);
  assert.deepEqual(det.anexos.map(a => [a.nome, a.mime]), [['boleto.pdf', 'application/pdf']]);
  assert.equal((await v1({ canal: canal.id, para: `+${CLIENTE}`, tipo: 'documento', legenda: 'Seu boleto', arquivo: { nome: 'boleto.pdf', base64: PDF.toString('base64') } }, 'midia-0001')).corpo.id, r.corpo.id, 'idempotente');

  const errado = await v1({ canal: canal.id, para: `+${CLIENTE}`, tipo: 'imagem', arquivo: { base64: PDF.toString('base64') } }, 'midia-0002');
  assert.equal(errado.status, 400);
  assert.match(errado.corpo.erro.campos.tipo, /documento/);
  const exe = await v1({ canal: canal.id, para: `+${CLIENTE}`, tipo: 'documento', arquivo: { nome: 'nota.pdf', base64: EXE.toString('base64') } }, 'midia-0003');
  assert.deepEqual([exe.status, exe.corpo.erro.codigo], [422, 'tipo_nao_suportado']);
  const interna = await v1({ canal: canal.id, para: `+${CLIENTE}`, tipo: 'imagem', arquivo: { url: 'https://127.0.0.1/x.png' } }, 'midia-0004');
  assert.equal(interna.status, 422, 'rede interna bloqueada');
  assert.ok(['destino_bloqueado', 'url_invalida'].includes(interna.corpo.erro.codigo));
  const dois = await v1({ canal: canal.id, para: `+${CLIENTE}`, tipo: 'imagem', arquivo: { base64: PNG.toString('base64'), url: 'https://exemplo.com/a.png' } }, 'midia-0005');
  assert.equal(dois.status, 400, 'exatamente um entre base64 e url');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM midias WHERE direcao = 'saida'").get().n, 1, 'recusados não deixam arquivo');
});

test('recebimento: imagem guardada (cifrada no disco), executável recusado, grande registrado; a conversa mostra os três', async () => {
  const chega = (extra) => atendimento.receber(canal.id, { id_provedor: novoId('mensagem'), de: { tipo: 'telefone', valor: CLIENTE }, em: new Date().toISOString(), ...extra });
  chega({ tipo: 'imagem', texto: 'Olha o erro', arquivo: { nome: 'print.png', base64: PNG.toString('base64') } });
  chega({ tipo: 'documento', texto: '', arquivo: { nome: 'nota.pdf', base64: EXE.toString('base64') } });
  chega({ tipo: 'video', texto: '', arquivo_falha: { motivo: 'grande', nome: 'video.mp4', mime: 'video/mp4', tamanho: 40_000_000, voz: false } });
  const cv = db.prepare('SELECT id FROM conversas').get();
  const itens = (await admin(`/conversas/${cv.id}/itens?limite=50`)).corpo.itens.filter(i => i.categoria === 'mensagem');
  for (const i of itens) forma('itemConversa', i);
  const [video, exe, img] = itens; // mais recente primeiro
  assert.deepEqual([img.tipo, img.texto, img.midia.mime, img.midia.disponivel], ['imagem', 'Olha o erro', 'image/png', true]);
  assert.deepEqual([exe.midia.disponivel, exe.midia.motivo, exe.midia.mime], [false, 'recusado', null], 'tipo declarado não vale');
  assert.deepEqual([video.midia.disponivel, video.midia.motivo], [false, 'grande']);

  const md = db.prepare('SELECT * FROM midias WHERE id = ?').get(img.midia.id);
  const noDisco = fs.readFileSync(path.join(pasta, 'midias', md.caminho));
  assert.equal(noDisco.includes(PNG.subarray(0, 8)), false, 'cifrado no disco');
  const r = await admin(`/midias/${img.midia.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.corpo.equals(PNG));
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('content-security-policy'), 'sandbox');
  assert.match((await admin(`/midias/${img.midia.id}?baixar=1`)).headers.get('content-disposition'), /^attachment/);
  assert.equal((await admin(`/midias/${exe.midia.id}`)).status, 410);
  const resumo = (await admin(`/conversas/${cv.id}`)).corpo;
  assert.equal(resumo.ultima_mensagem.previa, '📎 Vídeo');
});

test('Central: anexo sai pelo canal; tipo pelo conteúdo; recusas; prazo vencido apaga o arquivo e responde 410', async () => {
  const cv = db.prepare('SELECT id FROM conversas').get();
  const it = await admin(`/conversas/${cv.id}/anexos?nome=resposta.pdf&legenda=Segue`, 'POST', undefined, { binario: PDF });
  assert.equal(it.status, 202);
  forma('itemConversa', it.corpo);
  assert.deepEqual([it.corpo.tipo, it.corpo.texto, it.corpo.midia.nome], ['documento', 'Segue', 'resposta.pdf']);
  await esperar(() => ['enviada', 'entregue', 'lida'].includes(estadoDa(it.corpo.mensagem_id)));
  assert.equal((await admin(`/conversas/${cv.id}/anexos?nome=foto.png`, 'POST', undefined, { binario: EXE })).status, 422);
  assert.equal((await admin(`/conversas/${cv.id}/anexos?nome=x.pdf`, 'POST', undefined, { binario: Buffer.alloc(16 * 1024 * 1024 + 5, 0x20) })).status, 413);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'conversa.assumida'").get().n, 0, 'anexar da fila assume pelo serviço (evento na conversa)');

  db.prepare('UPDATE midias SET expira_em = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), it.corpo.midia.id);
  assert.equal((await admin(`/midias/${it.corpo.midia.id}`)).status, 410);
  const caminho = db.prepare('SELECT caminho FROM midias WHERE id = ?').get(it.corpo.midia.id).caminho;
  assert.ok(armazem.apagarVencidas(db) >= 1);
  assert.equal(fs.existsSync(path.join(pasta, 'midias', caminho)), false, 'arquivo apagado; a descrição fica');
  const item = (await admin(`/conversas/${cv.id}/itens?limite=1`)).corpo.itens[0];
  assert.deepEqual([item.midia.disponivel, item.midia.motivo], [false, 'expirado']);
});

test('provedor do WhatsApp: baixa a mídia, marca voz, figurinha vira imagem, localização vira texto, falha não derruba', async () => {
  const p = new ProvedorWweb({ canal: { id: 'cn_t', sessao_id: 's' }, dirSessoes: '.' });
  const recebidas = [];
  p.on('mensagem', (m) => recebidas.push(m));
  const msg = (id, extra) => ({ from: '5565999875116@c.us', timestamp: Math.floor(Date.now() / 1000), id: { id }, _data: {}, getContact: async () => ({}), ...extra });
  await p._receber(msg('M1', { type: 'ptt', hasMedia: true, body: '', downloadMedia: async () => ({ mimetype: 'audio/ogg; codecs=opus', data: Buffer.from('OggS...').toString('base64') }) }));
  await p._receber(msg('M2', { type: 'sticker', hasMedia: true, body: '', downloadMedia: async () => ({ mimetype: 'image/webp', data: PNG.toString('base64') }) }));
  await p._receber(msg('M3', { type: 'location', hasMedia: false, body: '', location: { latitude: -15.6, longitude: -56.09 } }));
  await p._receber(msg('M4', { type: 'image', hasMedia: true, body: 'legenda', downloadMedia: async () => { throw new Error('rede'); } }));
  await p._receber(msg('M5', { type: 'document', hasMedia: true, body: '', _data: { size: 40_000_000 }, downloadMedia: async () => { throw new Error('não deveria baixar'); } }));
  const [voz, figurinha, local, falhou, grande] = recebidas;
  assert.deepEqual([voz.tipo, voz.arquivo.voz, voz.texto], ['audio', true, '']);
  assert.equal(figurinha.tipo, 'imagem');
  assert.deepEqual([local.tipo, local.texto], ['texto', '📍 Localização: -15.60000, -56.09000']);
  assert.deepEqual([falhou.tipo, falhou.texto, falhou.arquivo_falha.motivo], ['imagem', 'legenda', 'falhou']);
  assert.equal(grande.arquivo_falha.motivo, 'grande');
});
