// Chat interno (2026-10): conversa 1 a 1 entre analistas do J2A, enviar
// para todos com chamados em andamento, recibos e isolamento por empresa.
// Executar: node "apps/IA Service/tests/chat-interno.test.js"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-chat-interno-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = process.env.SVC_DATA_CRYPTO_KEY || crypto.randomBytes(32).toString('base64');

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const clienteRepo = require('../backend/repositories/cliente-repository');
const consultorRepo = require('../backend/repositories/consultor-repository');
const chat = require('../backend/services/chat-interno-service');

const EMPRESA = 99301;
const OUTRA = 99302;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

async function esperaErro(fn, status, trecho) {
  try { fn(); } catch (e) {
    assert.strictEqual(e.status, status, `status esperado ${status}, veio ${e.status} (${e.message})`);
    if (trecho) assert.ok(e.message.includes(trecho), e.message);
    return;
  }
  assert.fail('deveria ter lançado erro');
}

(async () => {
  try {
    const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'se-chat', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
    const ana = consultorRepo.criarConsultor(EMPRESA, { telefone: '5565990000001', idSoftexpert: 'T-ANA' });
    const beto = consultorRepo.criarConsultor(EMPRESA, { telefone: '5565990000002', idSoftexpert: 'T-BETO' });
    const caio = consultorRepo.criarConsultor(EMPRESA, { telefone: '5565990000003', idSoftexpert: 'T-CAIO' });
    const inativo = consultorRepo.criarConsultor(EMPRESA, { telefone: '5565990000004', idSoftexpert: 'T-INATIVO' });
    consultorRepo.atualizarConsultor(EMPRESA, inativo.id, { ativo: false });
    const deOutra = consultorRepo.criarConsultor(OUTRA, { telefone: '5565990000009', idSoftexpert: 'T-OUTRA' });

    const tBeto = clienteRepo.upsertTecnico(EMPRESA, { sistemaOrigem: 'softexpert', idOrigem: 'T-BETO', nome: 'Beto' }).tecnico;
    const tCaio = clienteRepo.upsertTecnico(EMPRESA, { sistemaOrigem: 'softexpert', idOrigem: 'T-CAIO', nome: 'Caio' }).tecnico;
    // Beto: 2 chamados abertos. Caio: só um encerrado (não conta). Ana: nenhum.
    chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: 'C1', numero: '1', tecnicoResponsavelId: tBeto.id });
    chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: 'C2', numero: '2', tecnicoResponsavelId: tBeto.id });
    chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: 'C3', numero: '3', tecnicoResponsavelId: tCaio.id, statusEncerramento: 'Encerrado' });

    // 1. Contatos: só da empresa, sem a própria pessoa e sem inativos; chamados pelo critério da grade.
    let r = chat.listarContatos(EMPRESA, ana.id);
    const ids = r.contatos.map(c => c.consultorId);
    assert.deepStrictEqual(ids.sort(), [beto.id, caio.id].sort(), 'contatos = consultores ativos da empresa, menos eu');
    assert.strictEqual(r.contatos.find(c => c.consultorId === beto.id).chamadosEmAndamento, 2);
    assert.strictEqual(r.contatos.find(c => c.consultorId === caio.id).chamadosEmAndamento, 0, 'encerrado não conta');
    assert.strictEqual(r.destinatariosTransmissao, 1);
    assert.strictEqual(r.contatos[0].consultorId, beto.id, 'quem tem chamados vem antes');

    // 2. Conversa direta: única por par, nos dois sentidos.
    const conv = chat.abrirConversaDireta(EMPRESA, ana.id, beto.id);
    assert.strictEqual(chat.abrirConversaDireta(EMPRESA, beto.id, ana.id), conv, 'mesma conversa nos dois sentidos');

    // 3. Isolamento: não conversa com outra empresa, inativo, consigo mesmo.
    await esperaErro(() => chat.abrirConversaDireta(EMPRESA, ana.id, deOutra.id), 404);
    await esperaErro(() => chat.abrirConversaDireta(EMPRESA, ana.id, inativo.id), 404);
    await esperaErro(() => chat.abrirConversaDireta(EMPRESA, ana.id, ana.id), 400);
    await esperaErro(() => chat.listarMensagens(EMPRESA, caio.id, conv), 404, 'não encontrada');
    await esperaErro(() => chat.enviarMensagem(EMPRESA, caio.id, conv, 'intrometido'), 404);
    await esperaErro(() => chat.listarMensagens(OUTRA, ana.id, conv), 404);

    // 4. Envio + validação de texto.
    await esperaErro(() => chat.enviarMensagem(EMPRESA, ana.id, conv, '   '), 400, 'vazia');
    await esperaErro(() => chat.enviarMensagem(EMPRESA, ana.id, conv, 'x'.repeat(1001)), 400, 'limite');
    const env = chat.enviarMensagem(EMPRESA, ana.id, conv, '  Oi Beto <script>alert(1)</script>  ');
    assert.strictEqual(env.destinatario, beto.id);
    assert.strictEqual(env.mensagem.texto, 'Oi Beto <script>alert(1)</script>', 'guarda o texto como texto (a tela escapa)');

    // 5. Recibos: ✓ enviado → ✓✓ entregue → visto; e não lidas do destinatário.
    let msgs = chat.listarMensagens(EMPRESA, ana.id, conv).mensagens;
    assert.strictEqual(msgs[0].minha, true);
    assert.strictEqual(msgs[0].entregueEm, null);
    assert.strictEqual(chat.listarContatos(EMPRESA, beto.id).naoLidasTotal, 1);
    const entregues = chat.marcarEntregues(EMPRESA, beto.id);
    assert.strictEqual(entregues.length, 1);
    assert.strictEqual(entregues[0].remetenteId, ana.id, 'recibo vai para quem enviou');
    assert.ok(chat.listarMensagens(EMPRESA, ana.id, conv).mensagens[0].entregueEm);
    assert.strictEqual(chat.marcarEntregues(EMPRESA, beto.id).length, 0, 'idempotente');
    const vistos = chat.marcarVistas(EMPRESA, beto.id, conv);
    assert.strictEqual(vistos[0].tipo, 'visto');
    assert.ok(chat.listarMensagens(EMPRESA, ana.id, conv).mensagens[0].vistoEm);
    assert.strictEqual(chat.listarContatos(EMPRESA, beto.id).naoLidasTotal, 0);
    await esperaErro(() => chat.marcarVistas(EMPRESA, caio.id, conv), 404);

    // 6. Resposta volta na mesma conversa; prévia na lista de contatos.
    chat.enviarMensagem(EMPRESA, beto.id, conv, 'Oi Ana!');
    r = chat.listarContatos(EMPRESA, ana.id);
    const cBeto = r.contatos.find(c => c.consultorId === beto.id);
    assert.strictEqual(cBeto.conversaId, conv);
    assert.strictEqual(cBeto.naoLidas, 1);
    assert.strictEqual(cBeto.ultimaMensagem.texto, 'Oi Ana!');
    assert.strictEqual(cBeto.ultimaMensagem.minha, false);

    // 7. Enviar para todos: só quem tem chamados em andamento (menos eu), cada um na conversa 1 a 1.
    const todos = chat.enviarParaTodos(EMPRESA, caio.id, 'Pessoal, prioridade nos atrasados');
    assert.strictEqual(todos.length, 1, 'só Beto tem chamados em andamento');
    assert.strictEqual(todos[0].destinatario, beto.id);
    assert.strictEqual(todos[0].mensagem.transmissao, true);
    const convCaioBeto = chat.abrirConversaDireta(EMPRESA, beto.id, caio.id);
    assert.strictEqual(todos[0].mensagem.conversaId, convCaioBeto, 'transmissão cai na conversa direta');
    await esperaErro(() => chat.enviarParaTodos(EMPRESA, caio.id, 'de novo'), 429, '1 minuto');
    // Beto é o único com chamados: para ele não sobra ninguém.
    await esperaErro(() => chat.enviarParaTodos(EMPRESA, beto.id, 'oi'), 400, 'Nenhum analista');

    // 8. Paginação devolve em ordem cronológica.
    msgs = chat.listarMensagens(EMPRESA, ana.id, conv).mensagens;
    assert.deepStrictEqual(msgs.map(m => m.texto), ['Oi Beto <script>alert(1)</script>', 'Oi Ana!']);

    console.log('chat-interno.test.js: OK');
  } finally {
    limparEDesligar();
  }
})().catch((e) => { console.error(e); process.exit(1); });
