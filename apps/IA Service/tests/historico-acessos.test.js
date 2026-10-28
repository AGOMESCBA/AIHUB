// Histórico de Acessos (2026-10-28): uma linha por login que sobrevive ao
// Limpar/Sair/retenção da presença, IP e navegador do login, motivo de
// encerramento, falhas de login, isolamento por empresa e exclusão por período.
// Executar: node "apps/IA Service/tests/historico-acessos.test.js"
//
// Usa a empresa REAL J2A (id=1) no fluxo de login, pelo mesmo motivo de
// login-externo-telefone.test.js: listarEmpresasDoTelefone descarta empresa
// que não existe em empresas.json.

const assert = require('assert');
process.env.SVC_ALLOW_LEGACY_CONSULTORES = '1';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-historico-acessos-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = process.env.SVC_DATA_CRYPTO_KEY || crypto.randomBytes(32).toString('base64');

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const consultorRepo = require('../backend/repositories/consultor-repository');
const loginExternoService = require('../backend/services/login-externo-service');
const presencaService = require('../backend/services/presenca-service');
const historico = require('../backend/services/acesso-historico-service');

const EMPRESA = 1;
const OUTRA_EMPRESA = 99302;
const TELEFONE = '5565999880011';
const CLIENTE = { ip: '10.0.0.5', ipEncaminhado: '177.10.20.30', navegador: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' };

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

const linha = (sessaoRef) => database.getDB().prepare('SELECT * FROM svc_acessos_historico WHERE sessao_ref = ?').get(sessaoRef);
const periodoAmplo = () => ({ de: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), ate: new Date(Date.now() + 3600 * 1000).toISOString() });

function recuarSinais(sessaoRef, ms) {
  const db = database.getDB();
  const p = db.prepare('SELECT id, ultimo_sinal_em FROM svc_presenca WHERE sessao_ref = ?').get(sessaoRef);
  db.prepare('UPDATE svc_presenca SET ultimo_sinal_em = ? WHERE id = ?').run(new Date(new Date(p.ultimo_sinal_em).getTime() - ms).toISOString(), p.id);
}

try {
  const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'se-hist', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: 'OID-HIST-1', numero: '036001', titulo: 'Teste' });
  const consultor = consultorRepo.criarConsultor(EMPRESA, { telefone: TELEFONE });

  // 1. Login pelo código cria a linha do histórico com IP, navegador e telefone.
  const inicio = loginExternoService.iniciarLogin(TELEFONE);
  const login = loginExternoService.verificarLogin(inicio.challengeId, TELEFONE, inicio.codigo, CLIENTE);
  assert.strictEqual(login.escolhaEmpresa, false);
  const sessao = loginExternoService.validarSessaoExterna(login.token);
  let h = linha(sessao.sessaoId);
  assert.ok(h, 'login deve criar linha no histórico');
  assert.strictEqual(h.origem, 'chat');
  assert.strictEqual(h.ip, '10.0.0.5');
  assert.strictEqual(h.ip_encaminhado, '177.10.20.30');
  assert.ok(h.navegador.includes('Chrome'));
  assert.strictEqual(h.telefone, TELEFONE);
  assert.strictEqual(h.consultor_id, consultor.id);

  // 2. Sinais somam tempo de tela, contam telas e guardam o chamado aberto.
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessao.sessaoId, consultorId: consultor.id, tela: 'Radar J2A', acao: 'Fila' });
  recuarSinais(sessao.sessaoId, 40 * 1000);
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'chat', sessaoRef: sessao.sessaoId, consultorId: consultor.id, tela: 'Chat', acao: 'Conversa', chamadoId: chamado.id });
  h = linha(sessao.sessaoId);
  assert.ok(h.segundos_ativos >= 39 && h.segundos_ativos <= 41, `deve somar ~40s, somou ${h.segundos_ativos}`);
  assert.strictEqual(h.telas_visitadas, 2, 'Radar J2A + Chat');
  assert.strictEqual(h.chamados, '036001');

  // 3. Limpar o Monitor apaga a presença mas NÃO o histórico; marca o motivo.
  presencaService.limparMonitor(EMPRESA, Date.now(), 7);
  h = linha(sessao.sessaoId);
  assert.ok(h, 'Limpar não pode apagar o histórico');
  assert.ok(h.segundos_ativos >= 39, 'tempo de tela preservado');
  assert.strictEqual(h.motivo_encerramento, 'limpar');
  assert.strictEqual(h.encerrado_por, 7);
  assert.ok(h.encerrado_em);

  // 4. Sair: encerra com motivo "sair" e mantém a linha.
  const login2 = loginExternoService.verificarLogin(...(() => { const i = loginExternoService.iniciarLogin(TELEFONE); return [i.challengeId, TELEFONE, i.codigo, CLIENTE]; })());
  const sessao2 = loginExternoService.validarSessaoExterna(login2.token);
  presencaService.encerrarSessaoChat(EMPRESA, sessao2.sessaoId);
  assert.strictEqual(linha(sessao2.sessaoId).motivo_encerramento, 'sair');

  // 5. Derrubar: motivo "derrubado" com quem derrubou.
  const login3 = loginExternoService.verificarLogin(...(() => { const i = loginExternoService.iniciarLogin(TELEFONE); return [i.challengeId, TELEFONE, i.codigo, CLIENTE]; })());
  const sessao3 = loginExternoService.validarSessaoExterna(login3.token);
  presencaService.derrubarPessoaChat(EMPRESA, consultor.id, 9);
  assert.strictEqual(linha(sessao3.sessaoId).motivo_encerramento, 'derrubado');
  assert.strictEqual(linha(sessao3.sessaoId).encerrado_por, 9);

  // 6. Sessão interna nasce no primeiro sinal, com IP/navegador do sinal.
  const refInterno = presencaService.hashSessaoInterna('sid-hist');
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'interno', sessaoRef: refInterno, usuarioIdIahub: null, tela: 'Base Histórica', acao: 'Rotina', cliente: CLIENTE });
  assert.strictEqual(linha(refInterno).ip, '10.0.0.5');
  // Sinal com cliente nulo nunca quebra (bug pego na homologação deste recurso).
  presencaService.registrarSinal({ empresaId: EMPRESA, origem: 'interno', sessaoRef: presencaService.hashSessaoInterna('sid-null'), tela: 'X', acao: 'Y', cliente: null });
  assert.ok(linha(presencaService.hashSessaoInterna('sid-null')), 'cliente nulo também grava');

  // 7. Falhas (a rota de login chama registrarFalha no catch; aqui direto).
  const inicioErro = loginExternoService.iniciarLogin(TELEFONE);
  const codigoErrado = String((Number(inicioErro.codigo) + 1) % 1000000).padStart(6, '0');
  assert.throws(() => loginExternoService.verificarLogin(inicioErro.challengeId, TELEFONE, codigoErrado), /Código inválido/);
  historico.registrarFalha({ empresaId: EMPRESA, telefone: TELEFONE, etapa: 'Validar código', motivo: 'Código inválido.', cliente: CLIENTE });
  historico.registrarFalha({ empresaId: null, telefone: '5511000000000', etapa: 'Pedir código', motivo: 'Número não encontrado', cliente: null });

  // 8. Listagem: só da empresa, com situação, resumo por pessoa e falhas.
  const outroConsultor = consultorRepo.criarConsultor(OUTRA_EMPRESA, { telefone: '5565999880099' });
  historico.registrarLoginChat({ empresaId: OUTRA_EMPRESA, sessaoId: crypto.randomUUID(), consultorId: outroConsultor.id, cliente: CLIENTE });
  const lista = historico.listarHistorico(EMPRESA, periodoAmplo());
  assert.strictEqual(lista.acessos.filter(a => a.origem === 'chat').length, 3, 'três logins do chat');
  assert.ok(lista.acessos.every(a => a.telefone !== '5565999880099'), 'nada de outra empresa');
  assert.strictEqual(lista.falhas.length, 1, 'falha sem empresa não aparece em nenhum painel');
  assert.ok(lista.acessos.find(a => a.situacao === 'encerrado' && a.situacaoRotulo === 'Encerrado pelo Limpar do Monitor'));
  const pessoa = lista.resumoPorUsuario.find(u => u.pessoaRef === `chat:${consultor.id}`);
  assert.strictEqual(pessoa.acessos, 3);
  assert.strictEqual(pessoa.dias, 1);
  assert.strictEqual(lista.acessos.find(a => a.origem === 'chat').ip, '177.10.20.30','IP exibido prefere o encaminhado pelo proxy');
  assert.strictEqual(historico.listarHistorico(EMPRESA, { ...periodoAmplo(), origem: 'interno' }).acessos.length, 2);
  assert.strictEqual(historico.listarHistorico(EMPRESA, { ...periodoAmplo(), busca: '036001' }).acessos.length, 1, 'busca por chamado');

  // 9. Período inválido é recusado.
  assert.throws(() => historico.listarHistorico(EMPRESA, { de: 'x', ate: 'y' }), /Período inválido/);
  assert.throws(() => historico.listarHistorico(EMPRESA, { de: new Date().toISOString(), ate: new Date(Date.now() - 1000).toISOString() }), /maior que a final/);

  // 10. Exclusão por período: só a empresa e só o período.
  const vazio = historico.excluirPeriodo(EMPRESA, { de: '2001-01-01T00:00:00.000Z', ate: '2001-12-31T23:59:59.999Z' });
  assert.deepStrictEqual(vazio, { acessosRemovidos: 0, falhasRemovidas: 0 });
  const removido = historico.excluirPeriodo(EMPRESA, periodoAmplo());
  assert.strictEqual(removido.acessosRemovidos, 5);
  assert.strictEqual(removido.falhasRemovidas, 1);
  assert.strictEqual(historico.listarHistorico(OUTRA_EMPRESA, periodoAmplo()).acessos.length, 1, 'outra empresa intocada');

  console.log('historico-acessos.test.js: OK');
} finally {
  limparEDesligar();
}
