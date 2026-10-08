// Regressao pos-auditoria da Fase 3.
// Executar: node "apps/IA Service/tests/fase3-pos-auditoria.test.js"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-fase3-pos-auditoria-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const validacaoRepo = require('../backend/repositories/validacao-solucao-repository');
const validacaoService = require('../backend/services/validacao-solucao-service');
const dossieRepo = require('../backend/repositories/investigacao-dossie-repository');
const consultorRepo = require('../backend/repositories/consultor-repository');
const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const historicalImportService = require('../backend/services/import/historical-import-service');
const registrarRotas = require('../backend/routes');
const registrarRotasExterno = require('../backend/routes/externo-routes');

const EMPRESA_A = 99301;
const EMPRESA_B = 99302;

function criarAtendimentoComAssistente(empresaId, conteudo = 'Orientacao tecnica da IA.') {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: conteudo,
  });
  const mensagem = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant',
    conteudo,
  });
  return { atendimento, mensagem };
}

async function iniciarAppInterno() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user_id: 42 };
    next();
  });
  registrarRotas(app, {
    requireAuth: (_req, _res, next) => next(),
    requireIaService: (req, _res, next) => {
      req.svcEmpresaId = Number(req.query?.empresa_id || 0);
      next();
    },
  });
  const server = await new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function iniciarAppExterno() {
  const app = express();
  app.use(express.json());
  registrarRotasExterno(app);
  const server = await new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function criarSessaoExterna(empresaId) {
  const consultor = consultorRepo.criarConsultor(empresaId, {
    idSoftexpert: `TEC-${empresaId}`,
    telefone: `5565999${empresaId}`,
  });
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 60 * 60 * 1000);
  database.getDB().prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    Number(empresaId),
    consultor.id,
    crypto.createHash('sha256').update(token).digest('hex'),
    expiraEm.toISOString(),
    agora.toISOString(),
    agora.toISOString()
  );
  return token;
}

async function testarAutorizacaoHttp() {
  const a = criarAtendimentoComAssistente(EMPRESA_A, 'Orientacao A.');
  const b = criarAtendimentoComAssistente(EMPRESA_A, 'Orientacao B.');
  const outraEmpresa = criarAtendimentoComAssistente(EMPRESA_B, 'Orientacao empresa B.');
  await validacaoService.confirmarSolucao(EMPRESA_A, {
    atendimentoId: b.atendimento.id,
    mensagemAssistenteId: b.mensagem.id,
    resultado: 'RESOLVEU',
    usuarioId: 42,
  });

  const interno = await iniciarAppInterno();
  try {
    const ok = await fetch(`${interno.baseUrl}/api/ia-service/atendimentos/${b.atendimento.id}/mensagens/${b.mensagem.id}/validacao?empresa_id=${EMPRESA_A}`);
    assert.strictEqual(ok.status, 200, 'mensagem do atendimento correto deve ser lida');

    const cruzado = await fetch(`${interno.baseUrl}/api/ia-service/atendimentos/${a.atendimento.id}/mensagens/${b.mensagem.id}/validacao?empresa_id=${EMPRESA_A}`);
    assert.strictEqual(cruzado.status, 404, 'mensagem de outro atendimento da mesma empresa deve ser bloqueada');

    const multiempresa = await fetch(`${interno.baseUrl}/api/ia-service/atendimentos/${a.atendimento.id}/mensagens/${outraEmpresa.mensagem.id}/validacao?empresa_id=${EMPRESA_A}`);
    assert.strictEqual(multiempresa.status, 404, 'mensagem de outra empresa deve ser bloqueada');

    const inexistente = await fetch(`${interno.baseUrl}/api/ia-service/atendimentos/${a.atendimento.id}/mensagens/nao-existe/validacao?empresa_id=${EMPRESA_A}`);
    assert.strictEqual(inexistente.status, 404, 'mensagem inexistente deve retornar 404 sem revelar recursos');
  } finally {
    await new Promise(resolve => interno.server.close(resolve));
  }

  const externo = await iniciarAppExterno();
  try {
    const semSessao = await fetch(`${externo.baseUrl}/api/ia-service-externo/atendimentos/${b.atendimento.id}/mensagens/${b.mensagem.id}/validacao`);
    assert.strictEqual(semSessao.status, 401, 'sessao externa ausente deve ser bloqueada');

    const token = criarSessaoExterna(EMPRESA_A);
    const cruzadoExt = await fetch(`${externo.baseUrl}/api/ia-service-externo/atendimentos/${a.atendimento.id}/mensagens/${b.mensagem.id}/validacao`, {
      headers: { 'x-sessao-externa': token },
    });
    assert.strictEqual(cruzadoExt.status, 404, 'namespace externo tambem deve bloquear mensagem de outro atendimento');
  } finally {
    await new Promise(resolve => externo.server.close(resolve));
  }
}

async function testarDossieGlobalNaoEncerraPorOrientacaoIndividual() {
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: 'Atendimento com tres orientacoes.',
  });
  const msg1 = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'assistant', conteudo: 'Primeira orientacao.' });
  const msg2 = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'assistant', conteudo: 'Segunda orientacao.' });
  const msg3 = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'assistant', conteudo: 'Terceira orientacao.' });

  await validacaoService.confirmarSolucao(EMPRESA_A, {
    atendimentoId: atendimento.id,
    mensagemAssistenteId: msg1.id,
    resultado: 'RESOLVEU',
    comentario: 'Resolveu a primeira tentativa.',
    usuarioId: 42,
  });
  await validacaoService.confirmarSolucao(EMPRESA_A, {
    atendimentoId: atendimento.id,
    mensagemAssistenteId: msg2.id,
    resultado: 'NAO_RESOLVEU',
    comentario: 'Segunda tentativa falhou.',
    usuarioId: 42,
  });

  const estado3 = validacaoRepo.obterEstadoAtual(EMPRESA_A, msg3.id);
  assert.strictEqual(estado3.status, 'AGUARDANDO_VALIDACAO');

  const estadoCompleto = dossieRepo.getEstadoCompleto(EMPRESA_A, atendimento.id);
  assert.notStrictEqual(estadoCompleto.dossie.status, 'RESOLVIDO', 'dossie global nao deve ser encerrado por uma orientacao individual');
  assert.ok(estadoCompleto.resultados.some(r => r.dados?.validacaoId && r.dados.resultado === 'RESOLVEU'), 'resultado positivo individual deve entrar no contexto');
  assert.ok(estadoCompleto.resultados.some(r => r.dados?.validacaoId && r.dados.resultado === 'NAO_RESOLVEU'), 'resultado negativo individual deve entrar no contexto');

  await validacaoService.confirmarSolucao(EMPRESA_A, {
    atendimentoId: atendimento.id,
    mensagemAssistenteId: msg1.id,
    resultado: 'NAO_RESOLVEU',
    comentario: 'Reavaliada como falha.',
    usuarioId: 42,
  });
  const reavaliada = validacaoRepo.obterEstadoAtual(EMPRESA_A, msg1.id);
  assert.strictEqual(reavaliada.status, 'NAO_RESOLVEU', 'ultima confirmacao explicita deve prevalecer na orientacao');
  assert.strictEqual(reavaliada.historico.length, 2, 'historico append-only deve ser preservado na reavaliacao');
}

async function testarResumoEOrdenacao() {
  const pendente = criarAtendimentoComAssistente(EMPRESA_A, 'Orientacao nunca avaliada.');
  const naoTestado = criarAtendimentoComAssistente(EMPRESA_A, 'Orientacao nao testada.');
  await validacaoService.confirmarSolucao(EMPRESA_A, {
    atendimentoId: naoTestado.atendimento.id,
    mensagemAssistenteId: naoTestado.mensagem.id,
    resultado: 'NAO_TESTADO',
    usuarioId: 42,
  });
  const resumo = validacaoRepo.obterResumoPorEmpresa(EMPRESA_A);
  assert.ok(resumo.AGUARDANDO_VALIDACAO >= 1, 'orientacao sem evento deve contar como aguardando validacao');
  assert.ok(resumo.NAO_TESTADO >= 1, 'NAO_TESTADO deve ser distinto de aguardando');

  const empate = criarAtendimentoComAssistente(EMPRESA_A, 'Orientacao com eventos no mesmo timestamp.');
  const db = database.getDB();
  const mesmaHora = '2026-10-08T12:00:00.000Z';
  db.prepare(`
    INSERT INTO validacoes_solucao (
      id, empresa_id, atendimento_id, mensagem_assistente_id, origem, resultado, comentario, usuario_id, criado_em
    ) VALUES (?, ?, ?, ?, 'confirmacao_analista', ?, ?, ?, ?)
  `).run('tie-a', EMPRESA_A, empate.atendimento.id, empate.mensagem.id, 'NAO_RESOLVEU', 'primeiro', 42, mesmaHora);
  db.prepare(`
    INSERT INTO validacoes_solucao (
      id, empresa_id, atendimento_id, mensagem_assistente_id, origem, resultado, comentario, usuario_id, criado_em
    ) VALUES (?, ?, ?, ?, 'confirmacao_analista', ?, ?, ?, ?)
  `).run('tie-b', EMPRESA_A, empate.atendimento.id, empate.mensagem.id, 'RESOLVEU', 'segundo', 42, mesmaHora);
  const estado = validacaoRepo.obterEstadoAtual(EMPRESA_A, empate.mensagem.id);
  assert.strictEqual(estado.ultimaConfirmacao.id, 'tie-b', 'empate de timestamp deve usar desempate deterministico por rowid');
}

async function testarSoftExpertMensagemCorretaEIdempotencia() {
  const fonte = agenteRepo.criarFonte(EMPRESA_A, {
    connectionKey: 'softexpert-pos-auditoria',
    nome: 'SoftExpert Pos Auditoria',
    sistemaOrigem: 'softexpert',
    adapter: 'SoftExpertSqlServerAdapter',
  });
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'softexpert',
    canalEntrada: 'radar',
    referenciaExterna: 'SE-105',
    conteudoBruto: 'Atendimento longo.',
  });
  let ultimaAssistente = null;
  for (let i = 0; i < 105; i++) {
    ultimaAssistente = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, {
      papel: i % 3 === 0 ? 'user' : 'assistant',
      conteudo: `Mensagem ${i}`,
      criadoEm: new Date(Date.UTC(2026, 9, 8, 12, 0, i)).toISOString(),
    });
  }
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA_A, {
    fonteId: fonte.id,
    sistemaOrigem: 'softexpert',
    oidOrigem: 'OID-SE-105',
    numero: 'SE-105',
    titulo: 'Chamado longo',
    statusEncerramento: 'Andamento',
  });

  const evidencia = await historicalImportService._registrarEvidenciaExternaSeAplicavel(EMPRESA_A, chamado, {
    de: 'Andamento',
    para: 'Encerrado',
    reabertura: false,
  });
  assert.strictEqual(evidencia.registrado, true);
  assert.strictEqual(evidencia.registro.mensagemAssistenteId, ultimaAssistente.id, 'evidencia externa deve vincular a ultima orientacao real, mesmo apos 100 mensagens');

  const primeira = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
    atendimentoId: atendimento.id,
    mensagemAssistenteId: ultimaAssistente.id,
    chamadoId: chamado.id,
    statusEncerramentoTransicao: { de: 'Encerrado', para: 'Andamento', reabertura: true, eventoId: 'EVT-1' },
  });
  const resync = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
    atendimentoId: atendimento.id,
    mensagemAssistenteId: ultimaAssistente.id,
    chamadoId: chamado.id,
    statusEncerramentoTransicao: { de: 'Encerrado', para: 'Andamento', reabertura: true, eventoId: 'EVT-1' },
  });
  const repetidaDistinta = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
    atendimentoId: atendimento.id,
    mensagemAssistenteId: ultimaAssistente.id,
    chamadoId: chamado.id,
    statusEncerramentoTransicao: { de: 'Encerrado', para: 'Andamento', reabertura: true, eventoId: 'EVT-2' },
  });
  assert.strictEqual(primeira.duplicado, false);
  assert.strictEqual(resync.duplicado, true, 'ressincronizacao do mesmo evento deve ser idempotente');
  assert.strictEqual(repetidaDistinta.duplicado, false, 'evento externo confiavel diferente deve ser registrado separadamente');
}

function limpar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

async function main() {
  await testarAutorizacaoHttp();
  await testarDossieGlobalNaoEncerraPorOrientacaoIndividual();
  await testarResumoEOrdenacao();
  await testarSoftExpertMensagemCorretaEIdempotencia();
  console.log('fase3-pos-auditoria.test.js: ok');
}

main()
  .then(() => { limpar(); process.exit(0); })
  .catch(err => { limpar(); console.error(err); process.exit(1); });
