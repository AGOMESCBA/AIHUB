// Testes da fundacao do IA Service — camada Service (contrato canonico,
// validacao contra usuarios reais do IA HUB, orquestracao atendimento+mensagem).
// Executar: node "apps/IA Service/tests/fundacao-services.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoService = require('../backend/services/atendimento-service');
const consultorService = require('../backend/services/consultor-service');

// Usuário 1 (admin) já existe nos dados reais do IA HUB — leitura apenas,
// nenhuma escrita é feita em usuarios.json por este teste.
const USUARIO_IAHUB_EXISTENTE = 1;
const USUARIO_IAHUB_INEXISTENTE = 999999;
const EMPRESA = 9101;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

try {
  // ── Teste 18: contrato canonico cria atendimento + primeira mensagem ─────
  const atendimento = atendimentoService.criarAtendimentoDeEntradaCanonica({
    origem: 'manual',
    empresaId: EMPRESA,
    conteudoBruto: 'Na hora que gero um pagamento antecipado quero que o saldo bancario nao seja atualizado.',
    metadados: { criadoPorUsuarioId: USUARIO_IAHUB_EXISTENTE },
  });
  assert.ok(atendimento.id);
  assert.strictEqual(atendimento.contextoOrigem, 'nao_processado', 'sem extracao por IA nesta etapa, contexto deve ficar nao_processado');
  assert.strictEqual(atendimento.canalEntrada, 'web', 'entrada sem canalEntrada explicito deve assumir default web (ajustes finais da Etapa 1, item 3)');
  assert.strictEqual(atendimento.origem, 'manual');

  const mensagens = atendimentoService.listarMensagens(EMPRESA, atendimento.id);
  assert.strictEqual(mensagens.length, 1, 'a entrada canonica deve gerar a primeira mensagem automaticamente');
  assert.strictEqual(mensagens[0].papel, 'user');

  // ── Validacao de entrada canonica invalida (sem conteudoBruto) ───────────
  assert.throws(
    () => atendimentoService.criarAtendimentoDeEntradaCanonica({ origem: 'manual', empresaId: EMPRESA, conteudoBruto: '' }),
    /conteudoBruto é obrigatório/,
    'entrada sem conteudoBruto deve ser rejeitada'
  );

  assert.throws(
    () => atendimentoService.criarAtendimentoDeEntradaCanonica({ origem: 'invalido', empresaId: EMPRESA, conteudoBruto: 'x' }),
    /origem inválida/,
    'origem fora do enum deve ser rejeitada'
  );

  // ── Ajustes finais da Etapa 1, item 3: 'api' NAO e mais uma origem valida —
  // e canal_entrada, nao origem de negocio.
  assert.throws(
    () => atendimentoService.criarAtendimentoDeEntradaCanonica({ origem: 'api', empresaId: EMPRESA, conteudoBruto: 'x' }),
    /origem inválida/,
    "'api' deve ser rejeitada como origem — e canal_entrada, nao origem de negocio"
  );

  assert.throws(
    () => atendimentoService.criarAtendimentoDeEntradaCanonica({ origem: 'manual', canalEntrada: 'canal_invalido', empresaId: EMPRESA, conteudoBruto: 'x' }),
    /canalEntrada inválido/,
    'canalEntrada fora do enum deve ser rejeitado'
  );

  // origem=softexpert + canalEntrada=api deve ser aceito (dimensoes independentes)
  const atendimentoSoftexpertApi = atendimentoService.criarAtendimentoDeEntradaCanonica({
    origem: 'softexpert',
    canalEntrada: 'api',
    empresaId: EMPRESA,
    conteudoBruto: 'Simulacao de entrada futura via API do SoftExpert.',
    referenciaExterna: '007000',
  });
  assert.strictEqual(atendimentoSoftexpertApi.origem, 'softexpert');
  assert.strictEqual(atendimentoSoftexpertApi.canalEntrada, 'api');

  // ── Ajustes finais da Etapa 1, item 2: dois atendimentos com a mesma
  // referencia_externa (mesma empresa) devem ser aceitos pelo service tambem,
  // nao so pelo repository — confirma que nenhuma validacao nova no service
  // reintroduziu a restricao que foi removida do banco.
  const segundoComMesmaRef = atendimentoService.criarAtendimentoDeEntradaCanonica({
    origem: 'softexpert',
    canalEntrada: 'web',
    empresaId: EMPRESA,
    conteudoBruto: 'Segundo atendimento relacionado ao mesmo chamado SoftExpert #7000.',
    referenciaExterna: '007000',
  });
  assert.ok(segundoComMesmaRef.id);
  assert.notStrictEqual(segundoComMesmaRef.id, atendimentoSoftexpertApi.id);

  // ── Transicao de status ───────────────────────────────────────────────────
  const atualizado = atendimentoService.atualizarStatus(EMPRESA, atendimento.id, 'EM_DIAGNOSTICO');
  assert.strictEqual(atualizado.status, 'EM_DIAGNOSTICO');

  assert.throws(
    () => atendimentoService.atualizarStatus(EMPRESA, atendimento.id, 'STATUS_INVENTADO'),
    /status inválido/,
    'status fora da lista aprovada deve ser rejeitado'
  );

  // ── Teste 17: usuario IA HUB inexistente nao pode ser vinculado silenciosamente
  assert.throws(
    () => consultorService.criarConsultor(EMPRESA, { usuarioIdIahub: USUARIO_IAHUB_INEXISTENTE }),
    /Usuário IA HUB não encontrado/,
    'vinculo a usuario inexistente deve falhar explicitamente'
  );

  // ── Teste 15: consultor vinculado com sucesso a usuario real do IA HUB ───
  const consultor = consultorService.criarConsultor(EMPRESA, {
    usuarioIdIahub: USUARIO_IAHUB_EXISTENTE,
    idSoftexpert: '784',
  });
  assert.strictEqual(consultor.usuarioIdIahub, USUARIO_IAHUB_EXISTENTE);

  const consultorEncontrado = consultorService.getConsultorPorUsuario(EMPRESA, USUARIO_IAHUB_EXISTENTE);
  assert.ok(consultorEncontrado, 'deve ser possivel buscar o consultor pelo usuario IA HUB');

  console.log('fundacao-services.test.js: ok (todos os asserts passaram)');
} finally {
  limparEDesligar();
}
