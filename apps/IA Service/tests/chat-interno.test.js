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

    // 1. Contatos: "Você" no topo (2026-10-28) + só da empresa, sem inativos; chamados pelo critério da grade.
    let r = chat.listarContatos(EMPRESA, ana.id);
    assert.strictEqual(r.contatos[0].consultorId, ana.id, '"Você" no topo');
    assert.strictEqual(r.contatos[0].eu, true);
    const ids = r.contatos.slice(1).map(c => c.consultorId);
    assert.deepStrictEqual(ids.sort(), [beto.id, caio.id].sort(), 'demais contatos = consultores ativos da empresa');
    assert.strictEqual(r.contatos.find(c => c.consultorId === beto.id).chamadosEmAndamento, 2);
    assert.strictEqual(r.contatos.find(c => c.consultorId === caio.id).chamadosEmAndamento, 0, 'encerrado não conta');
    assert.strictEqual(r.destinatariosTransmissao, 1);
    assert.strictEqual(r.contatos[1].consultorId, beto.id, 'quem tem chamados vem antes (depois do "Você")');

    // 2. Conversa direta: única por par, nos dois sentidos.
    const conv = chat.abrirConversaDireta(EMPRESA, ana.id, beto.id);
    assert.strictEqual(chat.abrirConversaDireta(EMPRESA, beto.id, ana.id), conv, 'mesma conversa nos dois sentidos');

    // 3. Isolamento: não conversa com outra empresa nem inativo. Consigo mesmo
    //    pode (decisão do usuário, 2026-10-28): 1 participante, sem recibo.
    await esperaErro(() => chat.abrirConversaDireta(EMPRESA, ana.id, deOutra.id), 404);
    await esperaErro(() => chat.abrirConversaDireta(EMPRESA, ana.id, inativo.id), 404);
    const comigo = chat.abrirConversaDireta(EMPRESA, ana.id, ana.id);
    assert.strictEqual(chat.abrirConversaDireta(EMPRESA, ana.id, ana.id), comigo, 'mesma conversa consigo mesmo');
    const nota = chat.enviarMensagem(EMPRESA, ana.id, comigo, 'lembrete');
    assert.strictEqual(nota.destinatario, null, 'sem destinatário');
    const minhas = chat.listarMensagens(EMPRESA, ana.id, comigo);
    assert.strictEqual(minhas.contato.consultorId, ana.id);
    assert.strictEqual(minhas.mensagens[0].texto, 'lembrete');
    assert.strictEqual(chat.listarContatos(EMPRESA, ana.id).contatos[0].ultimaMensagem.texto, 'lembrete');
    await esperaErro(() => chat.listarMensagens(EMPRESA, beto.id, comigo), 404, 'não encontrada');
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

    // 9. Criptografia em repouso: banco guarda cifrado; a API devolve legível.
    const bruto = database.getDB().prepare("SELECT texto FROM svc_chat_mensagens WHERE conversa_id = ? AND remetente_id = ? ORDER BY criado_em LIMIT 1").get(conv, ana.id).texto;
    assert.ok(bruto.startsWith('svcchat:v1:'), 'texto deve estar cifrado no banco');
    assert.ok(!bruto.includes('Oi Beto'), 'texto puro não pode aparecer no banco');
    // Mensagem antiga (gravada antes da criptografia) continua legível.
    database.getDB().prepare('INSERT INTO svc_chat_mensagens (id, conversa_id, empresa_id, remetente_id, texto, transmissao, criado_em) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(crypto.randomUUID(), conv, EMPRESA, beto.id, 'mensagem antiga em claro', new Date().toISOString());
    msgs = chat.listarMensagens(EMPRESA, ana.id, conv).mensagens;
    assert.strictEqual(msgs[msgs.length - 1].texto, 'mensagem antiga em claro');
    assert.strictEqual(chat.listarContatos(EMPRESA, ana.id).contatos.find(c => c.consultorId === beto.id).ultimaMensagem.texto, 'mensagem antiga em claro');

    // 10. Lista = TODOS os analistas com chamados (base do Radar):
    //  - quem tem chamados e número autorizado na Platform vira contato e
    //    recebe mensagem mesmo sem nunca ter entrado no J2A;
    //  - quem tem chamados e NÃO tem acesso aparece com semAcesso (sem conversa).
    const E3 = 99303;
    const platformStore = require('../../IAHUB/backend/platform-store');
    const fonte3 = agenteRepo.criarFonte(E3, { connectionKey: 'se-chat-3', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
    const eu3 = consultorRepo.criarConsultor(E3, { telefone: '5565990003001', idSoftexpert: 'T3-EU' });
    const tAutorizado = clienteRepo.upsertTecnico(E3, { sistemaOrigem: 'softexpert', idOrigem: 'T3-AUT', nome: 'Kelbyr Cruz' }).tecnico;
    const tSemAcesso = clienteRepo.upsertTecnico(E3, { sistemaOrigem: 'softexpert', idOrigem: 'T3-SEM', nome: 'Fernan Hudson' }).tecnico;
    chamadoRepo.upsertChamado(E3, { fonteId: fonte3.id, sistemaOrigem: 'softexpert', oidOrigem: 'E3-1', numero: '31', tecnicoResponsavelId: tAutorizado.id });
    chamadoRepo.upsertChamado(E3, { fonteId: fonte3.id, sistemaOrigem: 'softexpert', oidOrigem: 'E3-2', numero: '32', tecnicoResponsavelId: tSemAcesso.id });
    const listarOriginal = platformStore.listarIaServicePorEmpresa;
    platformStore.listarIaServicePorEmpresa = (emp) => (Number(emp) === E3 ? [{
      platformIdentityId: 'plat-kelbyr', empresaId: E3, telefone: '5565990003002', ativo: true,
      usuarioIdIahub: null, idSoftexpert: 'T3-AUT', preAnaliseAutomatica: true, atualizadoEm: new Date().toISOString(),
    }] : []);
    try {
      const r3 = chat.listarContatos(E3, eu3.id);
      const kelbyr = r3.contatos.find(c => c.nome === 'Kelbyr Cruz');
      const fernan = r3.contatos.find(c => c.nome === 'Fernan Hudson');
      assert.ok(kelbyr && kelbyr.consultorId && !kelbyr.semAcesso, 'autorizado na Platform vira contato antes do 1º login');
      assert.strictEqual(kelbyr.online, false, 'nunca entrou: offline');
      assert.ok(fernan && fernan.semAcesso && fernan.consultorId === null, 'sem acesso aparece marcado');
      assert.strictEqual(fernan.chamadosEmAndamento, 1);
      assert.strictEqual(r3.contatos[r3.contatos.length - 1].nome, 'Fernan Hudson', 'sem acesso fica por último');
      assert.strictEqual(r3.destinatariosTransmissao, 1, '"para todos" não conta quem não tem acesso');
      // Mensagem para quem está offline fica guardada e conta como não lida para ele.
      const convK = chat.abrirConversaDireta(E3, eu3.id, kelbyr.consultorId);
      chat.enviarMensagem(E3, eu3.id, convK, 'Kelbyr, quando entrar me chama?');
      assert.strictEqual(chat.listarContatos(E3, kelbyr.consultorId).naoLidasTotal, 1, 'offline recebe ao entrar');
      // Falha na Platform nunca derruba a lista (empresa nova, sem throttle).
      platformStore.listarIaServicePorEmpresa = () => { throw new Error('platform fora'); };
      const E4 = 99304;
      const eu4 = consultorRepo.criarConsultor(E4, { telefone: '5565990004001', idSoftexpert: 'T4-EU' });
      const fonte4 = agenteRepo.criarFonte(E4, { connectionKey: 'se-chat-4', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
      const t4 = clienteRepo.upsertTecnico(E4, { sistemaOrigem: 'softexpert', idOrigem: 'T4-OUTRO', nome: 'Henrique Simões' }).tecnico;
      chamadoRepo.upsertChamado(E4, { fonteId: fonte4.id, sistemaOrigem: 'softexpert', oidOrigem: 'E4-1', numero: '41', tecnicoResponsavelId: t4.id });
      let chamouPlatform = false;
      platformStore.listarIaServicePorEmpresa = () => { chamouPlatform = true; throw new Error('platform fora'); };
      const r4 = chat.listarContatos(E4, eu4.id);
      assert.ok(chamouPlatform, 'a Platform foi consultada (e falhou)');
      assert.ok(r4.contatos.find(c => c.nome === 'Henrique Simões')?.semAcesso, 'lista continua, quem não sincronizou fica sem acesso');
    } finally {
      platformStore.listarIaServicePorEmpresa = listarOriginal;
    }

    console.log('chat-interno.test.js: OK');
  } finally {
    limparEDesligar();
  }
})().catch((e) => { console.error(e); process.exit(1); });
