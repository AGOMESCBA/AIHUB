// Monitor de Acessos (2026-10): presença por sessão, tempo de tela,
// isolamento por empresa e checagem de rotina no servidor.
// Executar: node "apps/IA Service/tests/monitor-acessos.test.js"

const assert = require('assert');
// Consultores deste teste sao criados direto no IA Service (sem cadastro na
// Platform): modo legado, senao a revogacao de acesso por Platform os derruba.
process.env.SVC_ALLOW_LEGACY_CONSULTORES = '1';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-monitor-acessos-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = process.env.SVC_DATA_CRYPTO_KEY || crypto.randomBytes(32).toString('base64');

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const consultorRepo = require('../backend/repositories/consultor-repository');
const presencaService = require('../backend/services/presenca-service');
const { requireRotinaSvc } = require('../backend/services/rotina-permissao');

const EMPRESA = 99201;
const OUTRA_EMPRESA = 99202;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function criarSessaoExterna(empresaId, consultorId, { ultimoAcessoMsAtras = 0 } = {}) {
  const id = crypto.randomUUID();
  const agora = Date.now();
  database.getDB().prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, empresaId, consultorId, crypto.randomBytes(16).toString('hex'),
    new Date(agora + 8 * 3600 * 1000).toISOString(), new Date(agora - 3600 * 1000).toISOString(),
    new Date(agora - ultimoAcessoMsAtras).toISOString());
  return id;
}

function recuarUltimoSinal(sessaoRef, ms) {
  const db = database.getDB();
  const row = db.prepare('SELECT id, ultimo_sinal_em FROM svc_presenca WHERE sessao_ref = ?').get(sessaoRef);
  db.prepare('UPDATE svc_presenca SET ultimo_sinal_em = ? WHERE id = ?')
    .run(new Date(new Date(row.ultimo_sinal_em).getTime() - ms).toISOString(), row.id);
}

const presenca = (sessaoRef) => database.getDB().prepare('SELECT * FROM svc_presenca WHERE sessao_ref = ?').get(sessaoRef);

function chamarMiddleware(mw, req) {
  let status = 200;
  let passou = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  mw(req, res, () => { passou = true; });
  return { passou, status };
}

try {
  const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'se-monitor', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
  const fonteOutra = agenteRepo.criarFonte(OUTRA_EMPRESA, { connectionKey: 'se-monitor-2', nome: 'SE 2', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: 'OID-MON-1', numero: '035988', titulo: 'Nota fiscal rejeitada' });
  const { chamado: chamadoOutra } = chamadoRepo.upsertChamado(OUTRA_EMPRESA, { fonteId: fonteOutra.id, sistemaOrigem: 'softexpert', oidOrigem: 'OID-MON-2', numero: '777777', titulo: 'De outra empresa' });

  const consultor = consultorRepo.criarConsultor(EMPRESA, { telefone: '5565999990001' });
  const consultorOutra = consultorRepo.criarConsultor(OUTRA_EMPRESA, { telefone: '5565999990002' });

  // 1. Primeiro sinal cria a presença, sem tempo acumulado, com 1 evento.
  const sessaoChat = criarSessaoExterna(EMPRESA, consultor.id);
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoChat, consultorId: consultor.id, tela: 'Radar J2A', acao: 'Fila pessoal', chamadoId: null });
  let p = presenca(sessaoChat);
  assert.strictEqual(p.segundos_ativos, 0, 'primeiro sinal não acumula tempo');
  assert.strictEqual(database.getDB().prepare('SELECT COUNT(*) n FROM svc_presenca_eventos WHERE presenca_id = ?').get(p.id).n, 1);

  // 2. Sinal dentro da janela soma o intervalo e resolve o número do chamado no servidor.
  recuarUltimoSinal(sessaoChat, 40 * 1000);
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoChat, consultorId: consultor.id, tela: 'Radar J2A', acao: 'Conversa com a IA', chamadoId: chamado.id });
  p = presenca(sessaoChat);
  assert.ok(p.segundos_ativos >= 39 && p.segundos_ativos <= 41, `deve somar ~40s, somou ${p.segundos_ativos}`);
  assert.strictEqual(p.chamado_numero, '035988');

  // 3. Lacuna maior que a janela (aba fechada/minimizada) não conta como tempo de tela.
  recuarUltimoSinal(sessaoChat, 10 * 60 * 1000);
  const antes = presenca(sessaoChat).segundos_ativos;
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoChat, consultorId: consultor.id, tela: 'Radar J2A', acao: 'Conversa com a IA', chamadoId: chamado.id });
  assert.strictEqual(presenca(sessaoChat).segundos_ativos, antes, 'lacuna fora da janela não soma');

  // 4. Sinal com aba escondida só renova o último sinal: não soma nem troca a tela.
  recuarUltimoSinal(sessaoChat, 30 * 1000);
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoChat, tela: 'Outra', acao: 'x', chamadoId: null, visivel: false });
  p = presenca(sessaoChat);
  assert.strictEqual(p.segundos_ativos, antes);
  assert.strictEqual(p.acao, 'Conversa com a IA');

  // 5. Chamado de OUTRA empresa é descartado (cliente não pendura chamado alheio).
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoChat, tela: 'Radar J2A', acao: 'Conversa com a IA', chamadoId: chamadoOutra.id });
  p = presenca(sessaoChat);
  assert.strictEqual(p.chamado_id, null);
  assert.strictEqual(p.chamado_numero, null);

  // 6. Texto é limitado (nunca guarda blocos grandes vindos da tela).
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoChat, tela: 'Radar J2A', acao: 'a'.repeat(500) });
  assert.strictEqual(presenca(sessaoChat).acao.length, 120);

  // 7. Trilha de eventos fica limitada a 20 por sessão.
  for (let i = 0; i < 30; i += 1) {
    presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoChat, tela: 'Radar J2A', acao: `passo ${i}` });
  }
  assert.strictEqual(database.getDB().prepare('SELECT COUNT(*) n FROM svc_presenca_eventos WHERE presenca_id = ?').get(presenca(sessaoChat).id).n, 20);

  // 8. Painel: sessão do chat sem nenhum sinal aparece (inativa pelo último acesso),
  // sessão interna aparece, e nada da outra empresa vaza.
  criarSessaoExterna(EMPRESA, consultor.id, { ultimoAcessoMsAtras: 30 * 60 * 1000 });
  const sessaoOutra = criarSessaoExterna(OUTRA_EMPRESA, consultorOutra.id);
  presencaService.registrarSinal({ empresaId: OUTRA_EMPRESA, origem: 'chat', sessaoRef: sessaoOutra, tela: 'Radar J2A', acao: 'Fila' });
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'interno', sessaoRef: presencaService.hashSessaoInterna('sid-teste'), usuarioIdIahub: null, tela: 'Base Histórica', acao: 'Rotina interna do IA Service' });

  const painel = presencaService.listarMonitor(EMPRESA);
  assert.strictEqual(painel.sessoes.length, 3, 'duas sessões do chat + uma interna, só da empresa');
  assert.ok(painel.sessoes.every(s => !s.id.includes(sessaoOutra)), 'sessão de outra empresa não pode aparecer');
  const semSinal = painel.sessoes.find(s => s.origem === 'chat' && s.segundosAtivos === 0 && s.acao === 'Aguardando o primeiro sinal da tela');
  assert.ok(semSinal, 'sessão sem sinal deve aparecer com aviso');
  assert.strictEqual(semSinal.situacao, 'inativo');
  assert.strictEqual(painel.sessoes.find(s => s.origem === 'interno').tela, 'Base Histórica');
  assert.strictEqual(painel.resumo.total, 3);
  assert.strictEqual(painel.resumo.online + painel.resumo.ausente + painel.resumo.inativo, 3);

  // 9. Faixas de situação.
  const agora = Date.now();
  assert.strictEqual(presencaService.situacaoPorSinal(new Date(agora - 60 * 1000).toISOString(), agora), 'online');
  assert.strictEqual(presencaService.situacaoPorSinal(new Date(agora - 5 * 60 * 1000).toISOString(), agora), 'ausente');
  assert.strictEqual(presencaService.situacaoPorSinal(new Date(agora - 20 * 60 * 1000).toISOString(), agora), 'inativo');

  // 10. Resumo de chamado respeita a empresa.
  assert.strictEqual(presencaService.resumoChamado(EMPRESA, chamado.id).numero, '035988');
  assert.strictEqual(presencaService.resumoChamado(EMPRESA, chamadoOutra.id), null);

  // 11. Hash da sessão interna nunca é o sessionID em claro.
  assert.notStrictEqual(presencaService.hashSessaoInterna('sid-teste'), 'sid-teste');

  // 12. Rotina no servidor: admin passa; usuário sem permissão recebe 403.
  const mw = requireRotinaSvc('svc-monitor-acessos');
  assert.strictEqual(chamarMiddleware(mw, { session: { role: 'admin' }, svcEmpresaId: EMPRESA }).passou, true);
  const negado = chamarMiddleware(mw, { session: { role: 'user', user_id: 987654321 }, svcEmpresaId: EMPRESA });
  assert.strictEqual(negado.passou, false);
  assert.strictEqual(negado.status, 403);

  // 13. Agrupamento por pessoa: as duas sessões do chat do mesmo consultor
  // trazem o mesmo pessoaRef (a tela junta numa linha só).
  const doConsultor = painel.sessoes.filter(s => s.origem === 'chat');
  assert.strictEqual(doConsultor.length, 2);
  assert.ok(doConsultor.every(s => s.pessoaRef === `chat:${consultor.id}`), 'sessões do mesmo consultor devem ter o mesmo pessoaRef');

  // 14. Limpar: zera presença e eventos da empresa e expira TODOS os logins do
  // chat dela (o token deixa de valer); outra empresa fica intacta.
  const loginExternoService = require('../backend/services/login-externo-service');
  const tokenAtivo = 'token-limpar-' + crypto.randomBytes(8).toString('hex');
  const idSessaoToken = crypto.randomUUID();
  database.getDB().prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(idSessaoToken, EMPRESA, consultor.id, crypto.createHash('sha256').update(tokenAtivo).digest('hex'),
    new Date(Date.now() + 3600 * 1000).toISOString(), new Date().toISOString(), new Date().toISOString());
  assert.ok(loginExternoService.validarSessaoExterna(tokenAtivo), 'pré-condição: token válido antes de limpar');

  const limpo = presencaService.limparMonitor(EMPRESA);
  assert.strictEqual(limpo.sessoesEncerradas, 3, 'duas sessões do teste 8 + a do token');
  assert.ok(limpo.presencasRemovidas >= 2);
  assert.strictEqual(loginExternoService.validarSessaoExterna(tokenAtivo), null, 'login encerrado não pode mais ser usado');
  assert.strictEqual(database.getDB().prepare('SELECT COUNT(*) n FROM svc_presenca WHERE empresa_id = ?').get(EMPRESA).n, 0);
  assert.strictEqual(database.getDB().prepare(`SELECT COUNT(*) n FROM svc_presenca_eventos e JOIN svc_presenca p ON p.id = e.presenca_id WHERE p.empresa_id = ?`).get(EMPRESA).n, 0);
  assert.strictEqual(database.getDB().prepare('SELECT COUNT(*) n FROM svc_sessoes_externas WHERE id = ?').get(idSessaoToken).n, 1, 'sessão é expirada, não apagada');
  assert.strictEqual(presencaService.listarMonitor(EMPRESA).sessoes.length, 0, 'painel da empresa fica vazio');
  assert.strictEqual(presencaService.listarMonitor(OUTRA_EMPRESA).sessoes.length, 1, 'outra empresa não é afetada');

  // 15. Fechar a tela (pagehide) tira de "Online" na hora, sem esperar 2 min;
  // um sinal novo (recarregou / outra aba) volta a Online.
  const tokenSaida = 'token-saida-' + crypto.randomBytes(8).toString('hex');
  const sessaoSaida = crypto.randomUUID();
  database.getDB().prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessaoSaida, EMPRESA, consultor.id, crypto.createHash('sha256').update(tokenSaida).digest('hex'),
    new Date(Date.now() + 3600 * 1000).toISOString(), new Date().toISOString(), new Date().toISOString());
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoSaida, tela: 'Radar J2A', acao: 'Conversa com a IA' });
  assert.strictEqual(presencaService.listarMonitor(EMPRESA).sessoes[0].situacao, 'online');
  presencaService.registrarSaida({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoSaida });
  let item = presencaService.listarMonitor(EMPRESA).sessoes[0];
  assert.strictEqual(item.situacao, 'inativo', 'tela fechada não pode continuar Online');
  assert.strictEqual(item.tela, 'Fora da tela');
  assert.ok(loginExternoService.validarSessaoExterna(tokenSaida), 'fechar a tela não derruba o login');
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessaoSaida, tela: 'Radar J2A', acao: 'Fila pessoal' });
  item = presencaService.listarMonitor(EMPRESA).sessoes[0];
  assert.strictEqual(item.situacao, 'online', 'novo sinal visível volta a Online');
  assert.strictEqual(item.tela, 'Radar J2A');

  // 16. "Sair" do J2A encerra a sessão no servidor: token deixa de valer e a
  // sessão sai do painel. Só a própria sessão, da própria empresa.
  presencaService.encerrarSessaoChat(OUTRA_EMPRESA, sessaoSaida);
  assert.ok(loginExternoService.validarSessaoExterna(tokenSaida), 'empresa errada não encerra a sessão');
  presencaService.encerrarSessaoChat(EMPRESA, sessaoSaida);
  assert.strictEqual(loginExternoService.validarSessaoExterna(tokenSaida), null, 'token encerrado não pode mais ser usado');
  assert.strictEqual(presencaService.listarMonitor(EMPRESA).sessoes.length, 0, 'sessão encerrada sai do painel');
  assert.strictEqual(presencaService.listarMonitor(OUTRA_EMPRESA).sessoes.length, 1, 'outra empresa não é afetada');

  // 17. Derrubar UMA pessoa: encerra todas as sessões dela (duas abas), só dela,
  // só na empresa informada; auditoria registrada.
  const tokA = 'tok-a-' + crypto.randomBytes(8).toString('hex');
  const tokB = 'tok-b-' + crypto.randomBytes(8).toString('hex');
  for (const t of [tokA, tokB]) {
    database.getDB().prepare('INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), EMPRESA, consultor.id, crypto.createHash('sha256').update(t).digest('hex'), new Date(Date.now() + 3600e3).toISOString(), new Date().toISOString(), new Date().toISOString());
  }
  assert.deepStrictEqual(presencaService.derrubarPessoaChat(OUTRA_EMPRESA, consultor.id).sessaoIds, [], 'empresa errada não derruba ninguém');
  assert.ok(loginExternoService.validarSessaoExterna(tokA));
  const derrubadas = presencaService.derrubarPessoaChat(EMPRESA, consultor.id).sessaoIds;
  assert.strictEqual(derrubadas.length, 2, 'as duas abas da pessoa caem');
  assert.strictEqual(loginExternoService.validarSessaoExterna(tokA), null);
  assert.strictEqual(loginExternoService.validarSessaoExterna(tokB), null);
  assert.strictEqual(presencaService.listarMonitor(OUTRA_EMPRESA).sessoes.length, 1, 'outra empresa intacta');
  presencaService.registrarAuditoria({ empresaId: EMPRESA, acao: 'derrubar', alvo: `chat:${consultor.id}`, usuarioId: 7, motivo: 'teste '.repeat(50), detalhe: { sessoes: 2 } });
  const aud = database.getDB().prepare('SELECT * FROM svc_monitor_auditoria WHERE empresa_id = ? AND acao = ?').get(EMPRESA, 'derrubar');
  assert.strictEqual(aud.usuario_id, 7);
  assert.ok(aud.motivo.length <= 120, 'motivo é limitado');

  // Desconectar internos (2026-10-28): só do IA Service, nunca a si mesmo,
  // só a empresa pedida; a marca bloqueia as APIs até o sinal do shell.
  const { bloquearDesconectados } = require('../backend/routes/monitor-acessos-routes');
  const sid = (n) => `sid-teste-${n}-${crypto.randomBytes(6).toString('hex')}`;
  const sidAdmin = sid('admin'), sidA1 = sid('a1'), sidA2 = sid('a2'), sidOutra = sid('outra');
  for (const [s, emp, u] of [[sidAdmin, EMPRESA, 1], [sidA1, EMPRESA, 5], [sidA2, EMPRESA, 5], [sidOutra, OUTRA_EMPRESA, 5]]) {
    presencaService.registrarSinal({ empresaId: emp, origem: 'interno', sessaoRef: presencaService.hashSessaoInterna(s), usuarioIdIahub: u, tela: 'Radar', acao: 'x' });
  }
  const r1 = presencaService.desconectarInternos(EMPRESA, { escopo: 'ia-service', excetoSessionId: sidAdmin });
  assert.strictEqual(r1.sessoesDesconectadas, 2, 'as duas sessões do usuário 5 caem');
  assert.strictEqual(r1.ignorouPropria, true);
  assert.ok(presenca(presencaService.hashSessaoInterna(sidAdmin)), 'a sessão de quem desconecta fica');
  assert.strictEqual(presenca(presencaService.hashSessaoInterna(sidA1)), undefined);
  assert.ok(presenca(presencaService.hashSessaoInterna(sidOutra)), 'outra empresa intacta');
  assert.strictEqual(presencaService.desconexaoPendente(sidAdmin), null);
  assert.strictEqual(presencaService.desconexaoPendente(sidOutra), null);

  const chamar = (s, p, extra = {}) => {
    let status = 200, corpo = null, passou = false;
    const res = { status(c) { status = c; return this; }, json(b) { corpo = b; return this; } };
    bloquearDesconectados({ sessionID: s, baseUrl: '/api/ia-service', path: p, ...extra }, res, () => { passou = true; });
    return { status, corpo, passou };
  };
  assert.strictEqual(chamar(sidAdmin, '/radar').passou, true);
  let b = chamar(sidA1, '/radar/fila');
  assert.strictEqual(b.status, 403);
  assert.strictEqual(b.corpo.desconectado, 'ia-service');
  assert.strictEqual(chamar(sidA1, '/radar/fila').status, 403, 'outra chamada não consome a marca');
  assert.strictEqual(chamar(sidA1, '/presenca').corpo.desconectado, 'ia-service', 'o sinal do shell recebe o aviso');
  assert.strictEqual(chamar(sidA1, '/radar/fila').passou, true, 'depois do aviso pode entrar de novo');

  // Sozinho na lista: pedir para desconectar a própria sessão não faz nada.
  const soAdmin = presencaService.desconectarInternos(EMPRESA, { presencaIds: [presenca(presencaService.hashSessaoInterna(sidAdmin)).id], excetoSessionId: sidAdmin });
  assert.deepStrictEqual(soAdmin, { sessoesDesconectadas: 0, ignorouPropria: true });

  // Do IAHub inteiro: apaga o arquivo da sessão e a próxima chamada encerra a sessão.
  const sidIahub = sid('iahub');
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'interno', sessaoRef: presencaService.hashSessaoInterna(sidIahub), usuarioIdIahub: 6, tela: 'Radar', acao: 'x' });
  const dirSessoes = require('../../IAHUB/backend/data-paths').appDataDir('sessions');
  fs.mkdirSync(dirSessoes, { recursive: true });
  const arqSessao = path.join(dirSessoes, sidIahub + '.json');
  fs.writeFileSync(arqSessao, '{}');
  try {
    const pid = presenca(presencaService.hashSessaoInterna(sidIahub)).id;
    assert.strictEqual(presencaService.desconectarInternos(EMPRESA, { presencaIds: [pid], escopo: 'iahub', excetoSessionId: sidAdmin }).sessoesDesconectadas, 1);
    assert.strictEqual(fs.existsSync(arqSessao), false, 'arquivo da sessão do IAHub apagado');
    let destruiu = false;
    b = chamar(sidIahub, '/radar', { session: { destroy(cb) { destruiu = true; cb(); } } });
    assert.strictEqual(destruiu, true);
    assert.strictEqual(b.status, 401);
  } finally {
    try { fs.unlinkSync(arqSessao); } catch (_) {}
  }
  assert.throws(() => presencaService.desconectarInternos(EMPRESA, { escopo: 'outro' }), /Escopo inválido/);

  // Chat de todos da empresa (botão Desconectar > Chat).
  const sc1 = criarSessaoExterna(EMPRESA, consultor.id);
  const scOutra = criarSessaoExterna(OUTRA_EMPRESA, consultorOutra.id);
  const chatTodos = presencaService.desconectarChatTodos(EMPRESA).sessaoIds;
  assert.ok(chatTodos.includes(sc1));
  assert.ok(!chatTodos.includes(scOutra), 'chat de outra empresa intacto');

  console.log('monitor-acessos.test.js: OK');
} finally {
  limparEDesligar();
}
