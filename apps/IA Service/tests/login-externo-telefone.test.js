// Testes do login externo por TELEFONE puro (2026-09) — substituiu o login
// por URL de empresa (/entrar-servico/:empresaSlug). Cobre: 1 empresa
// resolve direto, N empresas exige escolha, troca de empresa dentro da
// sessão sem novo OTP, e isolamento (nunca aceitar empresaId arbitrário).
// Usa empresas REAIS do IAHub (J2A id=1, C3i id=2) porque
// login-externo-service.listarEmpresasDoTelefone resolve nome via
// crud.buscarPorId('empresas', ...) — IDs fake (9xxx) não existem em
// empresas.json e seriam descartados silenciosamente pelo .filter(Boolean).
// Executar: node "apps/IA Service/tests/login-externo-telefone.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SVC_WHATSAPP_OTP_SECRET = process.env.SVC_WHATSAPP_OTP_SECRET || 'teste-secret-nao-usado-neste-teste';
// Este teste cobre o fluxo LEGADO (consultorRepo.criarConsultor direto no
// banco do IA Service) — desde a introdução do IAHub Platform
// (platform-store.listarIaServicePorTelefone), login-externo-service.js
// tenta a Platform primeiro e só cai no legado com esta flag explícita.
// Sem ela, o teste consultaria o banco REAL da Platform (iahub-platform.db,
// fora do banco temporário deste teste) e falharia de forma confusa.
process.env.SVC_ALLOW_LEGACY_CONSULTORES = '1';

const dbTmpPath = path.join(os.tmpdir(), `ia-service-login-tel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const consultorRepo = require('../backend/repositories/consultor-repository');
const loginExternoService = require('../backend/services/login-externo-service');

const EMPRESA_J2A = 1;
const EMPRESA_C3I = 2;
const TELEFONE_MULTIEMPRESA = '5511988887777';
const TELEFONE_UNICA_EMPRESA = '5511977776666';

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

try {
  // ── Setup: consultor no MESMO telefone em duas empresas, + 1 telefone
  // exclusivo de uma única empresa (caso comum, deve continuar sem fricção)
  const consultorJ2A = consultorRepo.criarConsultor(EMPRESA_J2A, {
    usuarioIdIahub: 1, telefone: TELEFONE_MULTIEMPRESA, idSoftexpert: 'TEC-J2A-01',
  });
  const consultorC3I = consultorRepo.criarConsultor(EMPRESA_C3I, {
    usuarioIdIahub: 1, telefone: TELEFONE_MULTIEMPRESA, idSoftexpert: 'TEC-C3I-01',
  });
  consultorRepo.criarConsultor(EMPRESA_J2A, {
    usuarioIdIahub: 2, telefone: TELEFONE_UNICA_EMPRESA, idSoftexpert: 'TEC-J2A-02',
  });

  // ── listarEmpresasDoTelefone: resolve as DUAS empresas do telefone
  // multiempresa, com o consultorId correto (id_softexpert diferente por
  // empresa — nunca reaproveita o mesmo registro entre empresas) ──────────
  const empresasMulti = loginExternoService.listarEmpresasDoTelefone(TELEFONE_MULTIEMPRESA);
  assert.strictEqual(empresasMulti.length, 2, 'telefone multiempresa deve resolver as duas empresas');
  const idsEncontrados = empresasMulti.map(e => e.id).sort();
  assert.deepStrictEqual(idsEncontrados, [EMPRESA_J2A, EMPRESA_C3I].sort());
  const entradaJ2A = empresasMulti.find(e => e.id === EMPRESA_J2A);
  assert.strictEqual(entradaJ2A.consultorId, consultorJ2A.id, 'consultorId deve ser o registro ESPECIFICO da empresa J2A');

  // ── iniciarLogin + verificarLogin: telefone multiempresa deve retornar
  // escolhaEmpresa=true (nunca emitir sessão sozinho quando há ambiguidade) ─
  const inicio = loginExternoService.iniciarLogin(TELEFONE_MULTIEMPRESA);
  assert.ok(inicio.challengeId);
  assert.strictEqual(inicio.codigo.length, 6);

  const verificacao = loginExternoService.verificarLogin(inicio.challengeId, TELEFONE_MULTIEMPRESA, inicio.codigo);
  assert.strictEqual(verificacao.escolhaEmpresa, true, 'N empresas deve pedir escolha, nunca resolver sozinho');
  assert.strictEqual(verificacao.empresas.length, 2);
  assert.ok(!verificacao.token, 'não deve emitir token antes da escolha de empresa');

  // Challenge usado uma vez não pode ser reaproveitado
  assert.throws(
    () => loginExternoService.verificarLogin(inicio.challengeId, TELEFONE_MULTIEMPRESA, inicio.codigo),
    /expirado|inválido/i,
    'challenge já usado não pode ser verificado de novo'
  );

  // ── escolherEmpresa: emite sessão para a empresa escolhida, sem novo OTP ─
  const sessaoJ2A = loginExternoService.escolherEmpresa(TELEFONE_MULTIEMPRESA, EMPRESA_J2A);
  assert.ok(sessaoJ2A.token);
  const validadaJ2A = loginExternoService.validarSessaoExterna(sessaoJ2A.token);
  assert.strictEqual(validadaJ2A.empresaId, EMPRESA_J2A);
  assert.strictEqual(validadaJ2A.consultorId, consultorJ2A.id);

  // Nunca aceitar empresaId arbitrário — telefone multiempresa não tem
  // consultor numa empresa 3 qualquer.
  assert.throws(
    () => loginExternoService.escolherEmpresa(TELEFONE_MULTIEMPRESA, 3),
    /não disponível/i,
    'escolherEmpresa deve rejeitar empresa sem consultor para aquele telefone'
  );

  // ── trocarEmpresa: troca de J2A para C3I dentro da sessão já ativa, SEM
  // pedir novo OTP — reconfirma vínculo pelo telefone da sessão atual ──────
  const trocada = loginExternoService.trocarEmpresa(sessaoJ2A.token, EMPRESA_C3I);
  assert.ok(trocada.token);
  assert.notStrictEqual(trocada.token, sessaoJ2A.token, 'troca deve emitir um token NOVO, não reaproveitar o antigo');
  const validadaC3I = loginExternoService.validarSessaoExterna(trocada.token);
  assert.strictEqual(validadaC3I.empresaId, EMPRESA_C3I);
  assert.strictEqual(validadaC3I.consultorId, consultorC3I.id, 'após trocar, consultorId deve ser o registro ESPECIFICO da empresa C3I');

  // Token antigo (J2A) continua válido — trocar de empresa não invalida a
  // sessão anterior (mesmo padrão "não fecha portas", igual ao IA Command).
  const aindaValidaJ2A = loginExternoService.validarSessaoExterna(sessaoJ2A.token);
  assert.ok(aindaValidaJ2A, 'sessão J2A original deve continuar válida após trocar para C3I em outro token');

  // Isolamento: trocar para uma empresa sem vínculo deve falhar mesmo com
  // sessão válida — nunca aceitar empresaId arbitrário só porque o token é ok.
  assert.throws(
    () => loginExternoService.trocarEmpresa(trocada.token, 999),
    /não disponível/i,
    'trocarEmpresa nunca deve aceitar empresaId sem consultor vinculado ao telefone da sessão'
  );

  // ── Telefone em UMA única empresa: resolve direto, sem pedir escolha ────
  const inicioUnico = loginExternoService.iniciarLogin(TELEFONE_UNICA_EMPRESA);
  const verificacaoUnica = loginExternoService.verificarLogin(inicioUnico.challengeId, TELEFONE_UNICA_EMPRESA, inicioUnico.codigo);
  assert.strictEqual(verificacaoUnica.escolhaEmpresa, false, 'telefone em 1 empresa só não deve pedir escolha');
  assert.ok(verificacaoUnica.token, 'telefone em 1 empresa só deve emitir sessão direto');
  assert.strictEqual(verificacaoUnica.empresaId, EMPRESA_J2A);

  // ── Telefone desconhecido: erro genérico, nunca revela se existe ────────
  assert.throws(
    () => loginExternoService.iniciarLogin('5511900000000'),
    /não encontrado/i
  );

  console.log('login-externo-telefone.test.js: ok (todos os asserts passaram)');
} finally {
  limparEDesligar();
}
