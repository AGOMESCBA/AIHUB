// Testes da fundacao do IA Service — camada Repository (SQLite isolado,
// arquivo temporario proprio deste teste, nunca o ia-service.db real).
// Executar: node "apps/IA Service/tests/fundacao-repositories.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const consultorRepo = require('../backend/repositories/consultor-repository');

const EMPRESA_A = 9001;
const EMPRESA_B = 9002;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

try {
  // ── Teste 5/6: banco criado e migrations executam uma unica vez ──────────
  {
    const db = database.getDB();
    const versoes = db.prepare('SELECT COUNT(*) as total FROM schema_migrations').get();
    assert.ok(versoes.total >= 4, 'deve ter aplicado ao menos 4 migrations');
  }

  // ── Teste 7/8: atendimento pode ser criado, codigo amigavel gerado ────────
  const atendimentoA = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual',
    conteudoBruto: 'Ao gerar pagamento antecipado o saldo bancario nao deveria atualizar.',
  });
  assert.ok(atendimentoA.id, 'atendimento deve ter id técnico');
  assert.match(atendimentoA.codigo, /^AI-\d{6}$/, 'codigo amigavel deve seguir o padrao AI-000001');
  assert.strictEqual(atendimentoA.status, 'NOVO', 'status inicial deve ser NOVO');

  const atendimentoA2 = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual',
    conteudoBruto: 'Segundo atendimento de teste.',
  });
  assert.notStrictEqual(atendimentoA.codigo, atendimentoA2.codigo, 'dois atendimentos nao podem ter o mesmo codigo');

  // ── Teste 9/10: consulta so dentro da empresa correta, outra empresa nao ve
  const encontradoMesmaEmpresa = atendimentoRepo.getAtendimento(EMPRESA_A, atendimentoA.id);
  assert.ok(encontradoMesmaEmpresa, 'atendimento deve ser encontrado dentro da propria empresa');

  const encontradoOutraEmpresa = atendimentoRepo.getAtendimento(EMPRESA_B, atendimentoA.id);
  assert.strictEqual(encontradoOutraEmpresa, null, 'atendimento de outra empresa nao deve ser retornado');

  const listaEmpresaB = atendimentoRepo.listarAtendimentos(EMPRESA_B, {});
  assert.strictEqual(listaEmpresaB.length, 0, 'empresa B nao deve ver atendimentos da empresa A');

  const listaEmpresaA = atendimentoRepo.listarAtendimentos(EMPRESA_A, {});
  assert.strictEqual(listaEmpresaA.length, 2, 'empresa A deve ver seus 2 atendimentos');

  // ── Teste 11: mensagem pode ser persistida ────────────────────────────────
  const mensagem = mensagemRepo.salvarMensagem(EMPRESA_A, atendimentoA.id, {
    papel: 'user',
    conteudo: 'Texto original colado pelo analista.',
    usuarioId: 1,
  });
  assert.ok(mensagem.id, 'mensagem deve ter id');
  assert.strictEqual(mensagem.papel, 'user');

  const mensagensDoAtendimento = mensagemRepo.listarMensagens(EMPRESA_A, atendimentoA.id);
  assert.strictEqual(mensagensDoAtendimento.length, 1, 'atendimento deve ter 1 mensagem');

  // ── Teste 12: mensagem nao pode cruzar empresa ────────────────────────────
  assert.throws(
    () => mensagemRepo.salvarMensagem(EMPRESA_B, atendimentoA.id, { papel: 'user', conteudo: 'tentativa invasora' }),
    /não encontrado nesta empresa/i,
    'nao deve ser possivel salvar mensagem em atendimento de outra empresa'
  );

  const mensagensVistoDeOutraEmpresa = mensagemRepo.listarMensagens(EMPRESA_B, atendimentoA.id);
  assert.strictEqual(mensagensVistoDeOutraEmpresa.length, 0, 'empresa B nao deve enxergar mensagens do atendimento da empresa A');

  // ── Teste 13: metadados de anexo podem ser persistidos ────────────────────
  const anexo = anexoRepo.salvarMetadadosAnexo(EMPRESA_A, atendimentoA.id, {
    nomeOriginal: 'print-erro.png',
    nomeInterno: 'uuid-fake-123.png',
    mimeType: 'image/png',
    tamanho: 12345,
    caminhoRelativo: `${EMPRESA_A}/${atendimentoA.id}/uuid-fake-123.png`,
    usuarioId: 1,
  });
  assert.ok(anexo.id, 'anexo deve ter id');
  const anexosDoAtendimento = anexoRepo.listarAnexos(EMPRESA_A, atendimentoA.id);
  assert.strictEqual(anexosDoAtendimento.length, 1, 'atendimento deve ter 1 anexo');

  // ── Teste 14/15: cadastro de consultor funciona e vincula usuario IA HUB ──
  const consultor = consultorRepo.criarConsultor(EMPRESA_A, {
    usuarioIdIahub: 1,
    idSoftexpert: '784',
  });
  assert.ok(consultor.id, 'consultor deve ter id');
  assert.strictEqual(consultor.usuarioIdIahub, 1);

  // ── Teste 16: id_softexpert pode ser persistido ───────────────────────────
  assert.strictEqual(consultor.idSoftexpert, '784');

  // Mesmo usuario pode ser consultor em OUTRA empresa (usuario pode atender >1 empresa)
  const consultorEmpresaB = consultorRepo.criarConsultor(EMPRESA_B, {
    usuarioIdIahub: 1,
    idSoftexpert: '999',
  });
  assert.ok(consultorEmpresaB.id, 'mesmo usuario deve poder ser consultor em outra empresa');
  assert.notStrictEqual(consultor.id, consultorEmpresaB.id);

  // Duplicidade (mesmo usuario + mesma empresa) deve falhar
  assert.throws(
    () => consultorRepo.criarConsultor(EMPRESA_A, { usuarioIdIahub: 1, idSoftexpert: '111' }),
    /Já existe um consultor/i,
    'nao deve permitir 2 perfis de consultor para o mesmo usuario na mesma empresa'
  );

  // ── Teste 18: contrato canonico basico (via repository) ──────────────────
  const atendimentoManual = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual',
    conteudoBruto: 'Chamado colado do SoftExpert sem referencia externa.',
    referenciaExterna: null,
  });
  assert.strictEqual(atendimentoManual.referenciaExterna, null, 'origem manual pode ter referencia externa nula');

  // ── Ajustes finais da Etapa 1, item 2: UNIQUE de idempotencia foi removido.
  // Dois atendimentos MANUAIS com a mesma referencia_externa (mesma empresa)
  // devem ser permitidos — a entrada manual não deve ser bloqueada por uma
  // semantica de idempotencia que so fara sentido quando a integracao existir.
  const primeiroComRef = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'softexpert',
    canalEntrada: 'web',
    conteudoBruto: 'Chamado colado pelo analista, referencia SoftExpert #5821.',
    referenciaExterna: '005821',
  });
  const segundoComMesmaRef = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'softexpert',
    canalEntrada: 'web',
    conteudoBruto: 'Segundo atendimento manual relacionado ao mesmo chamado SoftExpert #5821.',
    referenciaExterna: '005821',
  });
  assert.ok(primeiroComRef.id && segundoComMesmaRef.id, 'ambos os atendimentos devem ser criados com sucesso');
  assert.notStrictEqual(primeiroComRef.id, segundoComMesmaRef.id, 'devem ser dois atendimentos distintos');
  assert.strictEqual(primeiroComRef.referenciaExterna, '005821');
  assert.strictEqual(segundoComMesmaRef.referenciaExterna, '005821');

  // Mesma referencia_externa em OUTRA empresa continua funcionando normalmente.
  const atendimentoOutraEmpresaMesmaRef = atendimentoRepo.criarAtendimento(EMPRESA_B, {
    origem: 'softexpert',
    conteudoBruto: 'Mesma referencia externa, empresa diferente.',
    referenciaExterna: '005821',
  });
  assert.ok(atendimentoOutraEmpresaMesmaRef.id, 'mesma referencia_externa deve ser permitida em empresa diferente');

  // ── Ajustes finais da Etapa 1, item 3: origem x canal_entrada separados ───
  const atendimentoCanalWeb = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: 'Atendimento manual via web (fluxo atual).',
  });
  assert.strictEqual(atendimentoCanalWeb.origem, 'manual');
  assert.strictEqual(atendimentoCanalWeb.canalEntrada, 'web');

  // Atendimento criado sem informar canalEntrada explicitamente deve receber
  // o default 'web' (unico canal em uso nesta etapa).
  const atendimentoSemCanalExplicito = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual',
    conteudoBruto: 'Atendimento sem canalEntrada explicito.',
  });
  assert.strictEqual(atendimentoSemCanalExplicito.canalEntrada, 'web', 'canal_entrada deve assumir default web quando nao informado');

  // ── Ajustes finais da Etapa 1, item 1: transacao atomica atendimento+mensagem
  // criarAtendimentoComPrimeiraMensagem deve criar as duas linhas com sucesso.
  const codigosAntesDoTesteTransacional = atendimentoRepo.listarAtendimentos(EMPRESA_A, { limite: 200 }).length;

  const atendimentoComMensagem = atendimentoRepo.criarAtendimentoComPrimeiraMensagem(
    EMPRESA_A,
    { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Atendimento criado via transacao atomica.' },
    { papel: 'user', conteudo: 'Primeira mensagem, gravada na mesma transacao do atendimento.', usuarioId: 1 }
  );
  assert.ok(atendimentoComMensagem.id, 'atendimento deve ser criado com sucesso quando a mensagem tambem e valida');
  const mensagensDoNovo = mensagemRepo.listarMensagens(EMPRESA_A, atendimentoComMensagem.id);
  assert.strictEqual(mensagensDoNovo.length, 1, 'atendimento criado via transacao deve ja ter sua primeira mensagem');

  // ── Teste de ROLLBACK real: forca falha na insercao da mensagem (papel NULL
  // viola a constraint NOT NULL da coluna `papel` em `mensagens`) e confirma
  // que o atendimento NAO fica gravado orfao — a transacao inteira e desfeita.
  let erroCapturado = null;
  try {
    atendimentoRepo.criarAtendimentoComPrimeiraMensagem(
      EMPRESA_A,
      { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Este atendimento NAO deve sobreviver ao rollback.' },
      { papel: null, conteudo: 'Mensagem invalida — papel nulo viola NOT NULL.', usuarioId: 1 }
    );
  } catch (err) {
    erroCapturado = err;
  }
  assert.ok(erroCapturado, 'a chamada deve lancar erro quando a insercao da mensagem falha');
  assert.match(erroCapturado.message, /NOT NULL constraint failed/i, 'erro deve vir da constraint NOT NULL de mensagens.papel');

  const listaAposRollback = atendimentoRepo.listarAtendimentos(EMPRESA_A, { limite: 200 });
  const orfaoEncontrado = listaAposRollback.find(a => a.conteudoBruto === 'Este atendimento NAO deve sobreviver ao rollback.');
  assert.strictEqual(orfaoEncontrado, undefined, 'ROLLBACK deve ter desfeito a insercao do atendimento — nenhum atendimento orfao deve existir');
  assert.strictEqual(
    listaAposRollback.length,
    codigosAntesDoTesteTransacional + 1,
    'apos o rollback, so o atendimento valido (com mensagem) deve ter sido adicionado — o que falhou nao conta'
  );

  console.log('fundacao-repositories.test.js: ok (todos os asserts passaram)');
} finally {
  limparEDesligar();
}
