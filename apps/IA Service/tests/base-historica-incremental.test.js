// Teste do Checkpoint 6 — sincronização incremental.
// Executar: node "apps/IA Service/tests/base-historica-incremental.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-incremental-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = require('crypto').randomBytes(32).toString('base64');

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const importacaoRepo = require('../backend/repositories/importacao-repository');

const EMPRESA = 9801;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
let periodosConsultados = [];
const CHAMADOS_POR_DATA = {
  '20260101': [{ OID: 'INC-1', IDPROCESS: '900001', DT: '20260101', CNPJCPF: '11.111.111/0001-11', DP: 'Cliente Inc', TITULOCHAMADO: 'Chamado antigo (full load)' }],
  '20260610': [{ OID: 'INC-2', IDPROCESS: '900002', DT: '20260610', CNPJCPF: '11.111.111/0001-11', DP: 'Cliente Inc', TITULOCHAMADO: 'Chamado novo (deve entrar no incremental)' }],
};

require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo(empresaId, fonte, periodo, { offset = 0 } = {}) {
      periodosConsultados.push(periodo);
      if (offset > 0) return [];
      const todos = Object.entries(CHAMADOS_POR_DATA)
        .filter(([dt]) => dt >= periodo.inicio && dt < periodo.fim)
        .flatMap(([, rows]) => rows);
      return todos;
    },
    async listarPosicionamentosDoChamado() { return []; },
  },
};

const historicalImportService = require('../backend/services/import/historical-import-service');
const historicalSyncService = require('../backend/services/import/historical-sync-service');

async function main() {
  const fonte = agenteRepo.criarFonte(EMPRESA, {
    connectionKey: 'softexpert-inc', nome: 'SoftExpert Incremental', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter',
  });

  // Full load inicial cobrindo até 20260601 (não inclui o chamado de 20260610)
  const full = await historicalImportService.executarFullLoad(EMPRESA, fonte.id, {
    periodoInicio: '20260101', periodoFim: '20260601', tamanhoLote: 10,
  });
  assert.strictEqual(full.status, 'concluido');
  assert.strictEqual(full.registrosInseridos, 1, 'full load deve pegar apenas o chamado de 20260101 (dentro do período)');
  assert.ok(chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'INC-1'));
  assert.strictEqual(chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'INC-2'), null, 'chamado de 20260610 não deve existir ainda (fora do período do full load)');

  // Incremental: deve calcular uma janela que cobre 20260610 (recente) sem
  // reprocessar tudo desde o início.
  periodosConsultados = [];
  const incremental = await historicalSyncService.executarIncremental(EMPRESA, fonte.id, {
    janelaDias: 7,
    ateData: '2026-06-15', // simula "agora" = 15/06/2026, pouco depois do chamado novo
  });

  assert.strictEqual(incremental.status, 'concluido');
  assert.strictEqual(incremental.tipo, 'incremental', 'importação deve ser marcada como tipo incremental, não full');
  assert.strictEqual(incremental.registrosInseridos, 1, 'incremental deve inserir o chamado novo (INC-2)');
  assert.ok(chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'INC-2'), 'chamado de 20260610 deve existir após o incremental');

  // A janela consultada não deve ser "desde o início dos tempos" — confirma
  // que o incremental é mais barato que um full load (não reconsultou 20260101).
  const consultouPeriodoAntigo = periodosConsultados.some(p => p.inicio <= '20260101');
  assert.strictEqual(consultouPeriodoAntigo, false, 'incremental não deve reconsultar o período coberto pelo full load original (janela deve ser retroativa, não desde o início)');

  // Rodar de novo o incremental na mesma janela não deve duplicar nada
  // (reaproveita o mesmo pipeline idempotente do full load).
  const totalAntes = chamadoRepo.contarChamados(EMPRESA);
  const segundoIncremental = await historicalSyncService.executarIncremental(EMPRESA, fonte.id, { janelaDias: 7, ateData: '2026-06-15' });
  assert.strictEqual(segundoIncremental.registrosInseridos, 0, 'rodar o incremental de novo não deve inserir duplicata');
  assert.strictEqual(chamadoRepo.contarChamados(EMPRESA), totalAntes);

  console.log('base-historica-incremental.test.js: ok (todos os asserts passaram)');
}

main()
  .then(() => { limparEDesligar(); process.exit(0); })
  .catch((err) => { limparEDesligar(); console.error(err); process.exit(1); });
