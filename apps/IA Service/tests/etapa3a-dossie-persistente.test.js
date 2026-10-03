// Etapa 3A - dossie tecnico persistente minimo do atendimento.
// Executar: node "apps/IA Service/tests/etapa3a-dossie-persistente.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-etapa3a-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const dossieService = require('../backend/services/investigacao-dossie-service');

const EMPRESA_A = 9901;
const EMPRESA_B = 9902;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

try {
  const db = database.getDB();

  // Migration V33: tabelas, indices, banco novo e repeticao sem reaplicar.
  {
    const versao33 = db.prepare('SELECT * FROM schema_migrations WHERE version = 33').get();
    assert.ok(versao33, 'migration v33 deve estar registrada');

    const tabelas = db.prepare(`
      SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('investigacao_dossies', 'investigacao_itens', 'investigacao_item_relacoes')
       ORDER BY name
    `).all().map(r => r.name);
    assert.deepStrictEqual(tabelas, ['investigacao_dossies', 'investigacao_item_relacoes', 'investigacao_itens']);

    const indicesDossie = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'investigacao_dossies'`).all().map(r => r.name);
    assert.ok(indicesDossie.some(n => n.includes('sqlite_autoindex') || n === 'idx_svc_investigacao_dossies_atendimento'), 'dossie deve ter indices/unicidade');

    database.fecharDB();
    database.inicializarDB(dbTmpPath);
    const reaplicada = database.getDB().prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 33').get();
    assert.strictEqual(reaplicada.total, 1, 'migration v33 nao deve ser reaplicada');
  }

  const atendimentoA = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: 'THREAD ERROR no faturamento MATA460.',
  });
  const atendimentoB = atendimentoRepo.criarAtendimento(EMPRESA_B, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: 'Atendimento de outra empresa.',
  });

  const mensagemA = mensagemRepo.salvarMensagem(EMPRESA_A, atendimentoA.id, {
    papel: 'user',
    conteudo: 'Erro THREAD ERROR no faturamento.',
  });
  const mensagemB = mensagemRepo.salvarMensagem(EMPRESA_B, atendimentoB.id, {
    papel: 'user',
    conteudo: 'Mensagem de outra empresa.',
  });

  const anexoA = anexoRepo.salvarMetadadosAnexo(EMPRESA_A, atendimentoA.id, {
    nomeOriginal: 'appserver.log',
    nomeInterno: 'a.log',
    mimeType: 'text/plain',
    tamanho: 20,
    caminhoRelativo: `${EMPRESA_A}/${atendimentoA.id}/a.log`,
    conteudoExtraido: 'stack U_XPTO linha 10',
    linguagemDetectada: 'log',
  });
  const anexoB = anexoRepo.salvarMetadadosAnexo(EMPRESA_B, atendimentoB.id, {
    nomeOriginal: 'outro.log',
    nomeInterno: 'b.log',
    mimeType: 'text/plain',
    tamanho: 20,
    caminhoRelativo: `${EMPRESA_B}/${atendimentoB.id}/b.log`,
  });
  const execucaoA = execucaoRepo.salvarExecucao(EMPRESA_A, {
    atendimentoId: atendimentoA.id,
    mensagemUsuarioId: mensagemA.id,
    provider: 'teste',
    model: 'fixture',
    status: 'concluido',
  });

  // CRUD/estado: cria dossie unico e atualiza com redaction.
  const dossie1 = dossieService.obterOuCriarDossie(EMPRESA_A, atendimentoA.id, {
    problemaAtual: 'THREAD ERROR session=XYZ789',
  });
  const dossie2 = dossieService.obterOuCriarDossie(EMPRESA_A, atendimentoA.id);
  assert.strictEqual(dossie1.id, dossie2.id, 'deve existir um unico dossie por empresa/atendimento');

  const dossieAtualizado = dossieService.atualizarDossie(EMPRESA_A, atendimentoA.id, {
    problemaAtual: 'THREAD ERROR com Bearer ABC123',
    diagnosticoAtual: 'Ainda em analise password=MINHASENHA',
    pendencias: [{ texto: 'Validar session=XYZ789' }],
    nivelConfianca: 'BAIXA',
    stale: false,
    atualizadoPorMensagemId: mensagemA.id,
    atualizadoPorExecucaoId: execucaoA.id,
  }, { versaoEsperada: dossie1.versao });
  assert.strictEqual(dossieAtualizado.versao, dossie1.versao + 1, 'atualizacao deve incrementar versao');
  const serializadoDossie = JSON.stringify(dossieAtualizado);
  assert.ok(!serializadoDossie.includes('ABC123'), 'Bearer deve ser redigido no dossie');
  assert.ok(!serializadoDossie.includes('XYZ789'), 'session deve ser redigida no dossie');
  assert.ok(!serializadoDossie.includes('MINHASENHA'), 'password deve ser redigido no dossie');

  // Optimistic locking.
  assert.throws(
    () => dossieService.atualizarDossie(EMPRESA_A, atendimentoA.id, { resumoEstado: 'escrita atrasada' }, { versaoEsperada: dossie1.versao }),
    err => err.code === 'CONFLITO_VERSAO_DOSSIE',
    'segunda atualizacao com versao antiga deve falhar com conflito'
  );

  // Itens F/H/T/R, codigos estaveis, relacoes e proveniencia.
  const fato1 = dossieService.criarItem(EMPRESA_A, atendimentoA.id, {
    tipo: 'FATO',
    descricao: 'O erro ocorre no faturamento.',
    criadoPorMensagemId: mensagemA.id,
    relacoes: [{ alvoTipo: 'mensagem', alvoId: mensagemA.id, papel: 'evidenciado_por' }],
  });
  const fato2 = dossieService.criarItem(EMPRESA_A, atendimentoA.id, {
    tipo: 'FATO',
    descricao: 'O stack aponta para U_XPTO.',
    relacoes: [{ alvoTipo: 'anexo', alvoId: anexoA.id, papel: 'evidenciado_por', detalhe: { linhas: [10] } }],
  });
  const hipotese = dossieService.criarItem(EMPRESA_A, atendimentoA.id, {
    tipo: 'HIPOTESE',
    descricao: 'Ponto de entrada customizado causa acesso invalido.',
    confianca: 'MEDIA',
    relacoes: [
      { alvoTipo: 'item', alvoId: fato1.id, papel: 'baseada_em' },
      { alvoTipo: 'item', alvoId: fato2.id, papel: 'baseada_em' },
    ],
  });
  const teste = dossieService.criarItem(EMPRESA_A, atendimentoA.id, {
    tipo: 'TESTE',
    descricao: 'Desabilitar o ponto de entrada em homologacao e repetir faturamento.',
    status: 'AGUARDANDO_EXECUCAO',
    relacoes: [{ alvoTipo: 'item', alvoId: hipotese.id, papel: 'testa' }],
  });
  const resultado = dossieService.criarItem(EMPRESA_A, atendimentoA.id, {
    tipo: 'RESULTADO',
    descricao: 'Teste informado como negativo.',
    relacoes: [{ alvoTipo: 'item', alvoId: teste.id, papel: 'resultado_de' }],
  });

  assert.strictEqual(fato1.codigo, 'F01');
  assert.strictEqual(fato2.codigo, 'F02');
  assert.strictEqual(hipotese.codigo, 'H01');
  assert.strictEqual(teste.codigo, 'T01');
  assert.strictEqual(resultado.codigo, 'R01');

  const estado = dossieService.obterEstadoCompleto(EMPRESA_A, atendimentoA.id);
  assert.strictEqual(estado.fatos.length, 2);
  assert.strictEqual(estado.hipoteses.length, 1);
  assert.strictEqual(estado.testes.length, 1);
  assert.strictEqual(estado.resultados.length, 1);
  assert.ok(estado.relacoes.some(r => r.itemId === hipotese.id && r.alvoId === fato2.id), 'cadeia H01 -> F02 deve ser recuperavel');
  assert.ok(estado.relacoes.some(r => r.itemId === resultado.id && r.alvoId === teste.id), 'cadeia R01 -> T01 deve ser recuperavel');

  // Multiempresa e proveniencia cruzada.
  assert.throws(
    () => dossieService.obterEstadoCompleto(EMPRESA_B, atendimentoA.id),
    /Atendimento nao encontrado nesta empresa/,
    'empresa B nao pode obter dossie de atendimento da empresa A'
  );
  assert.throws(
    () => dossieService.atualizarDossie(EMPRESA_A, atendimentoA.id, { atualizadoPorMensagemId: mensagemB.id }),
    /atualizadoPorMensagemId nao pertence/,
    'nao deve aceitar mensagem de outra empresa como referencia'
  );
  assert.throws(
    () => dossieService.criarRelacao(EMPRESA_A, atendimentoA.id, fato1.id, { alvoTipo: 'anexo', alvoId: anexoB.id, papel: 'evidenciado_por' }),
    /Alvo de proveniencia nao encontrado/,
    'nao deve aceitar anexo de outra empresa como proveniencia'
  );

  // STALE.
  const stale = dossieService.marcarStale(EMPRESA_A, atendimentoA.id, true);
  assert.strictEqual(stale.stale, true, 'dossie deve poder ser marcado stale');
  const naoStale = dossieService.marcarStale(EMPRESA_A, atendimentoA.id, false);
  assert.strictEqual(naoStale.stale, false, 'dossie deve poder sair de stale');

  // Nao inventar na 3A: mensagem nova nao conclui teste automaticamente.
  mensagemRepo.salvarMensagem(EMPRESA_A, atendimentoA.id, { papel: 'user', conteudo: 'Vou testar amanha.' });
  const testeAposMensagem = dossieService.listarItens(EMPRESA_A, atendimentoA.id, { tipo: 'TESTE' })[0];
  const hipoteseAposMensagem = dossieService.listarItens(EMPRESA_A, atendimentoA.id, { tipo: 'HIPOTESE' })[0];
  assert.strictEqual(testeAposMensagem.status, 'AGUARDANDO_EXECUCAO');
  assert.strictEqual(hipoteseAposMensagem.status, 'ABERTA');

  // Persistencia real apos nova conexao.
  database.fecharDB();
  database.inicializarDB(dbTmpPath);
  const estadoPersistido = dossieService.obterEstadoCompleto(EMPRESA_A, atendimentoA.id);
  assert.strictEqual(estadoPersistido.dossie.problemaAtual.includes('[REDACTED]'), true);
  assert.strictEqual(estadoPersistido.fatos.length, 2);
  assert.strictEqual(estadoPersistido.hipoteses[0].codigo, 'H01');
  assert.strictEqual(estadoPersistido.testes[0].codigo, 'T01');
  assert.strictEqual(estadoPersistido.resultados[0].codigo, 'R01');

  console.log('etapa3a-dossie-persistente.test.js: ok');
  limparEDesligar();
} catch (err) {
  try { limparEDesligar(); } catch (_) {}
  console.error(err);
  process.exit(1);
}
