// Etapa 3A.1 - correcoes finais de homologacao da 3A.
// Executar: node "apps/IA Service/tests/etapa3a1-homologacao-final.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

const database = require('../backend/database');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const dossieRepo = require('../backend/repositories/investigacao-dossie-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const dossieService = require('../backend/services/investigacao-dossie-service');
const { redigirValor, redigirUrl } = require('../backend/services/redaction-service');

const EMPRESA = 9911;

async function modoWorker() {
  const [, , , dbPath, empresaId, atendimentoId] = process.argv;
  database.inicializarDB(dbPath);
  process.send?.({ tipo: 'ready', pid: process.pid });
  process.on('message', msg => {
    if (!msg || msg.tipo !== 'start') return;
    try {
      const item = dossieService.criarItem(Number(empresaId), atendimentoId, {
        tipo: 'FATO',
        descricao: `Fato concorrente criado pelo processo ${process.pid}`,
      });
      database.fecharDB();
      process.send?.({ tipo: 'done', ok: true, codigo: item.codigo, id: item.id });
      process.exit(0);
    } catch (err) {
      database.fecharDB();
      process.send?.({ tipo: 'done', ok: false, code: err.code, message: err.message });
      process.exit(0);
    }
  });
}

function limpar(dbPath) {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
}

function aguardarMensagem(proc, tipo, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${tipo} do processo ${proc.pid}`)), timeoutMs);
    proc.on('message', msg => {
      if (msg?.tipo === tipo) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    proc.on('exit', code => {
      if (tipo !== 'done' && code !== null) {
        clearTimeout(timer);
        reject(new Error(`Processo ${proc.pid} encerrou antes de ${tipo}: ${code}`));
      }
    });
  });
}

async function testarConcorrencia(dbPath, atendimentoId) {
  const workerA = fork(__filename, ['worker', dbPath, String(EMPRESA), atendimentoId], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const workerB = fork(__filename, ['worker', dbPath, String(EMPRESA), atendimentoId], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });

  await Promise.all([aguardarMensagem(workerA, 'ready'), aguardarMensagem(workerB, 'ready')]);
  const doneA = aguardarMensagem(workerA, 'done');
  const doneB = aguardarMensagem(workerB, 'done');
  workerA.send({ tipo: 'start' });
  workerB.send({ tipo: 'start' });
  const resultados = await Promise.all([doneA, doneB]);

  const inesperados = resultados.filter(r => !r.ok && !/SQLITE_BUSY|SQLITE_CONSTRAINT|UNIQUE/i.test(`${r.code || ''} ${r.message || ''}`));
  assert.deepStrictEqual(inesperados, [], `erros inesperados na concorrencia: ${JSON.stringify(inesperados)}`);

  const db = database.getDB();
  const duplicados = db.prepare(`
    SELECT codigo, COUNT(*) AS total
      FROM investigacao_itens
     WHERE empresa_id = ? AND atendimento_id = ? AND tipo = 'FATO'
     GROUP BY codigo
    HAVING COUNT(*) > 1
  `).all(EMPRESA, atendimentoId);
  assert.deepStrictEqual(duplicados, [], 'concorrencia nao pode persistir codigos duplicados');

  const integridade = db.prepare('PRAGMA integrity_check').get();
  assert.strictEqual(integridade.integrity_check, 'ok', 'SQLite deve permanecer integro apos concorrencia');

  return resultados;
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `ia-service-etapa3a1-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  database.inicializarDB(dbPath);

  try {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, {
      origem: 'manual',
      canalEntrada: 'web',
      conteudoBruto: 'Homologacao final da 3A.',
    });
    const dossie = dossieService.obterOuCriarDossie(EMPRESA, atendimento.id);
    const db = database.getDB();

    db.prepare(`
      UPDATE investigacao_dossies
         SET problema_atual = ?, resumo_estado = ?, pendencias_json = ?
       WHERE id = ?
    `).run(
      'Problema legado session=SEGREDO-LEGADO-999',
      'Resumo com Bearer SEGREDO-LEGADO-999',
      JSON.stringify([{ texto: 'password=SEGREDO-LEGADO-999' }]),
      dossie.id
    );

    const itemId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO investigacao_itens (
        id, empresa_id, atendimento_id, dossie_id, tipo, codigo, titulo, descricao,
        status, confianca, dados_json, ordem, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, 'FATO', 'F99', ?, ?, 'REGISTRADO', NULL, ?, 99, ?, ?)
    `).run(
      itemId,
      EMPRESA,
      atendimento.id,
      dossie.id,
      'Titulo session=SEGREDO-LEGADO-999',
      'Descricao com Bearer SEGREDO-LEGADO-999',
      JSON.stringify({ detalhe: 'token=SEGREDO-LEGADO-999' }),
      new Date().toISOString(),
      new Date().toISOString()
    );
    db.prepare(`
      INSERT INTO investigacao_item_relacoes (
        id, empresa_id, atendimento_id, item_id, alvo_tipo, alvo_id, papel, detalhe_json, criado_em
      ) VALUES (?, ?, ?, ?, 'fonte_externa', ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      EMPRESA,
      atendimento.id,
      itemId,
      'https://docs.example/?token=SEGREDO-LEGADO-999',
      'papel session=SEGREDO-LEGADO-999',
      JSON.stringify({ trecho: 'Authorization: Bearer SEGREDO-LEGADO-999' }),
      new Date().toISOString()
    );

    const estadoLegado = dossieService.obterEstadoCompleto(EMPRESA, atendimento.id);
    const serializadoDossie = JSON.stringify(estadoLegado);
    assert.ok(!serializadoDossie.includes('SEGREDO-LEGADO-999'), 'leitura do dossie nao deve expor segredo legado');

    const execId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO investigacao_execucoes (
        id, empresa_id, atendimento_id, provider, model, status,
        contexto_json, pesquisa_json, quality_gate_json, usage_json, tentativas_json,
        resposta_truncada, retry_de_quality_gate, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(
      execId,
      EMPRESA,
      atendimento.id,
      'Bearer SEGREDO-EXECUCAO',
      'modelo password=SEGREDO-EXECUCAO',
      'status session=SEGREDO-EXECUCAO',
      JSON.stringify({ prompt: 'Bearer SEGREDO-EXECUCAO' }),
      JSON.stringify({ url: 'https://docs.example/?token=SEGREDO-EXECUCAO' }),
      JSON.stringify({ falha: 'api_key=SEGREDO-EXECUCAO' }),
      JSON.stringify({ header: 'Authorization: Bearer SEGREDO-EXECUCAO' }),
      JSON.stringify([{ erro: 'senha=SEGREDO-EXECUCAO' }]),
      new Date().toISOString()
    );
    const execucao = execucaoRepo.getExecucao(EMPRESA, execId);
    assert.ok(!JSON.stringify(execucao).includes('SEGREDO-EXECUCAO'), 'leitura de execucao nao deve expor segredo legado');

    const casos = redigirValor({
      bearerCurto: 'Bearer ABC123',
      authorization: 'Authorization: Bearer ABC123',
      session: 'session=XYZ789',
      sessionId: 'session_id=XYZ789',
      password: 'password=MINHASENHA',
      senha: 'senha=SEGREDO',
      token: 'token=ABC12345',
      apiKey: 'api_key=sk-abc12345',
      cookie: 'Cookie: sid=abc12345',
      normal: 'a sessao foi encerrada e o token expirou',
    });
    const url = redigirUrl('https://user:pass@example.com/api?token=ABC12345&ok=1');
    const serializadoCasos = JSON.stringify({ casos, url });
    for (const segredo of ['ABC123', 'XYZ789', 'MINHASENHA', 'SEGREDO', 'sk-abc12345', 'abc12345']) {
      assert.ok(!serializadoCasos.includes(segredo), `segredo nao deve aparecer apos redaction: ${segredo}`);
    }
    const urlRedigida = new URL(url);
    assert.strictEqual(urlRedigida.username, '%5BREDACTED%5D');
    assert.strictEqual(urlRedigida.password, '%5BREDACTED%5D');
    assert.ok(casos.normal.includes('token expirou'), 'redaction nao deve apagar texto tecnico comum');
    assert.ok(url.includes('ok=1'), 'redaction de URL deve preservar query nao sensivel');

    const resultadosConcorrencia = await testarConcorrencia(dbPath, atendimento.id);
    assert.strictEqual(resultadosConcorrencia.length, 2);
    const codigosPersistidos = db.prepare(`
      SELECT codigo FROM investigacao_itens
       WHERE empresa_id = ? AND atendimento_id = ? AND tipo = 'FATO'
       ORDER BY codigo
    `).all(EMPRESA, atendimento.id).map(r => r.codigo);
    assert.strictEqual(new Set(codigosPersistidos).size, codigosPersistidos.length, 'codigos persistidos devem ser unicos');

    console.log(`etapa3a1-homologacao-final.test.js: ok (${JSON.stringify(resultadosConcorrencia)})`);
    limpar(dbPath);
  } catch (err) {
    try { limpar(dbPath); } catch (_) {}
    throw err;
  }
}

if (process.argv[2] === 'worker') {
  modoWorker().catch(err => {
    try { database.fecharDB(); } catch (_) {}
    process.send?.({ tipo: 'done', ok: false, code: err.code, message: err.message });
    process.exit(0);
  });
} else {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
