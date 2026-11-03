'use strict';
// Exclusão de mensagem do chat (2026-11-02, decisões do usuário): exclusão
// lógica; qualquer analista com acesso ao chamado; cada mensagem sozinha;
// mensagem do SoftExpert nunca; chamado encerrado só consulta; dossiê marcado
// para revisão. A mensagem some do chat e da IA, mas o registro fica.
// Sem rede e sem IA. Dados sintéticos.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-excluir-mensagem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const dossieService = require('../backend/services/investigacao-dossie-service');
const dossieContext = require('../backend/services/dossie-context-service');
const atendimentoService = require('../backend/services/atendimento-service');

const EMPRESA = 99411;
const originais = { stale: dossieService.marcarStale, chamado: chamadoRepo.getChamadoPorNumero };
after(() => {
  dossieService.marcarStale = originais.stale;
  chamadoRepo.getChamadoPorNumero = originais.chamado;
  try { database.getDB().close(); } catch (_) {}
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
});

function cenario() {
  const at = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'manual', canalEntrada: 'chat', conteudoBruto: 'Erro no MATA103.' });
  const doSE = mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'customer', conteudo: 'Posicionamento do cliente', origemSistema: 'softexpert', origemReferencia: `posicionamento:${crypto.randomUUID()}` });
  const digitada = mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'user', conteudo: 'Pergunta digitada no chat' });
  const ia = mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'assistant', conteudo: 'Resposta da IA' });
  return { at, doSE, digitada, ia };
}
const codigo = fn => { try { fn(); return null; } catch (err) { return { status: err.status, mensagem: err.message }; } };

test('mensagem digitada e resposta da IA: somem do chat e da IA, mas o registro fica com quem excluiu', () => {
  const { at, doSE, digitada, ia } = cenario();
  const marcados = [];
  dossieService.marcarStale = (empresaId, atendimentoId, stale) => { marcados.push([atendimentoId, stale]); };
  assert.deepEqual(atendimentoService.excluirMensagem(EMPRESA, at.id, digitada.id, { excluidaPor: 'consultor:7' }), { excluida: true, mensagemId: digitada.id });
  assert.deepEqual(atendimentoService.excluirMensagem(EMPRESA, at.id, ia.id, { excluidaPor: 'usuario:3' }), { excluida: true, mensagemId: ia.id });
  assert.deepEqual(mensagemRepo.listarMensagens(EMPRESA, at.id).map(m => m.id), [doSE.id], 'listagem normal (chat e IA) só com a do SoftExpert');
  const todas = mensagemRepo.listarMensagens(EMPRESA, at.id, { incluirExcluidas: true });
  assert.equal(todas.length, 3, 'registro fica no banco');
  const excluida = todas.find(m => m.id === ia.id);
  assert.ok(excluida.excluidaEm);
  assert.equal(excluida.excluidaPor, 'usuario:3');
  assert.equal(mensagemRepo.getUltimaMensagemAssistente(EMPRESA, at.id), null, 'resposta da IA excluída não conta como última resposta');
  assert.deepEqual(marcados, [[at.id, true], [at.id, true]], 'dossiê marcado para revisão');
  dossieService.marcarStale = originais.stale;
});

test('cada mensagem é excluída sozinha: excluir a pergunta não leva a resposta da IA', () => {
  const { at, digitada, ia } = cenario();
  atendimentoService.excluirMensagem(EMPRESA, at.id, digitada.id, { excluidaPor: 'usuario:1' });
  assert.ok(mensagemRepo.listarMensagens(EMPRESA, at.id).some(m => m.id === ia.id));
});

test('mensagem do SoftExpert nunca é excluída (409, sem derrubar a sessão na tela)', () => {
  const { at, doSE } = cenario();
  assert.deepEqual(codigo(() => atendimentoService.excluirMensagem(EMPRESA, at.id, doSE.id, { excluidaPor: 'usuario:1' })),
    { status: 409, mensagem: 'Mensagens que vieram do SoftExpert não podem ser excluídas.' });
  assert.equal(mensagemRepo.excluirMensagem(EMPRESA, at.id, doSE.id, { excluidaPor: 'x' }), false, 'o repositório também recusa');
  assert.ok(mensagemRepo.listarMensagens(EMPRESA, at.id).some(m => m.id === doSE.id));
});

test('outros papéis, mensagem já excluída, de outro atendimento ou inexistente', () => {
  const { at, digitada } = cenario();
  const outro = cenario();
  const sistema = mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'system', conteudo: 'aviso do sistema' });
  assert.equal(codigo(() => atendimentoService.excluirMensagem(EMPRESA, at.id, sistema.id, {})).status, 409);
  atendimentoService.excluirMensagem(EMPRESA, at.id, digitada.id, { excluidaPor: 'usuario:1' });
  assert.equal(codigo(() => atendimentoService.excluirMensagem(EMPRESA, at.id, digitada.id, {})).status, 404, 'já excluída');
  assert.equal(codigo(() => atendimentoService.excluirMensagem(EMPRESA, at.id, outro.ia.id, {})).status, 404, 'mensagem de outro atendimento');
  assert.equal(codigo(() => atendimentoService.excluirMensagem(EMPRESA, at.id, 'nao-existe', {})).status, 404);
  assert.equal(codigo(() => atendimentoService.excluirMensagem(99999, at.id, outro.ia.id, {})).status, 404, 'outra empresa');
});

test('chamado encerrado é só consulta: não exclui', () => {
  const at = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'softexpert', canalEntrada: 'radar', referenciaExterna: '777001', conteudoBruto: 'x' });
  const ia = mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'assistant', conteudo: 'Resposta' });
  chamadoRepo.getChamadoPorNumero = () => ({ id: 'c1', statusEncerramento: 'Encerrado' });
  try {
    assert.equal(codigo(() => atendimentoService.excluirMensagem(EMPRESA, at.id, ia.id, {})).status, 409);
  } finally { chamadoRepo.getChamadoPorNumero = originais.chamado; }
  assert.ok(mensagemRepo.listarMensagens(EMPRESA, at.id).some(m => m.id === ia.id));
});

test('mensagem excluída não volta para a IA pela memória do dossiê', () => {
  const { at, digitada, ia } = cenario();
  atendimentoService.excluirMensagem(EMPRESA, at.id, ia.id, { excluidaPor: 'usuario:1' });
  const { encontrados } = dossieContext._buscarEvidenciasBatch(EMPRESA, at.id, [
    { alvoTipo: 'mensagem', alvoId: ia.id }, { alvoTipo: 'mensagem', alvoId: digitada.id },
  ], database.getDB());
  assert.ok(encontrados.has(`mensagem:${digitada.id}`));
  assert.ok(!encontrados.has(`mensagem:${ia.id}`), 'resposta excluída fica fora');
});

test('tela: opção aparece só para mensagem gravada, digitada ou da IA, fora do SoftExpert e de chamado encerrado', () => {
  const src = fs.readFileSync(path.join(__dirname, '../frontend/j2a/assets/radar.js'), 'utf8');
  assert.match(src, /function podeExcluirMensagem\(m\)/);
  assert.match(src, /!m\._pendente && !m\._falhou && !state\.somenteLeitura/);
  assert.match(src, /!m\.origemSistema && \(m\.papel === 'user' \|\| m\.papel === 'assistant'\)/);
  assert.match(src, /data-menu-action="excluir" hidden/);
  assert.match(src, /window\.confirm\(/, 'pede confirmação');
  assert.match(src, /\{ method: 'DELETE' \}/);
});
