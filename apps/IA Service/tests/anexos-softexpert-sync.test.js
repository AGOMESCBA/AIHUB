// Valida idempotência dos anexos do SoftExpert por OID real do SEBLOB.
// Executar: node "apps/IA Service/tests/anexos-softexpert-sync.test.js"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-anexos-se-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');

const EMPRESA = 99101;
let anexosOrigem = [];

const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo() { return []; },
    async listarPosicionamentosDoChamado() { return []; },
    async listarAnexosDoChamado() { return anexosOrigem; },
  },
};

const anexosSoftExpertService = require('../backend/services/anexos-softexpert-service');

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function bruto({ oid, nome, conteudo = 'conteudo tecnico do anexo de teste' }) {
  const buffer = Buffer.from(conteudo, 'utf8');
  return {
    origem: 'anexo',
    OID_REFERENCIA: 'OID-CHAMADO-1',
    DATA_REFERENCIA: '20261004',
    AUTOR_REFERENCIA: 'Analista',
    OID: oid,
    NMNAME: nome,
    IDEXTENSION: 'txt',
    NRSIZE: buffer.length,
    FLDATA: buffer.toString('base64'),
  };
}

async function main() {
  const fonte = agenteRepo.criarFonte(EMPRESA, {
    connectionKey: 'softexpert-anexos',
    nome: 'SoftExpert Anexos',
    sistemaOrigem: 'softexpert',
    adapter: 'SoftExpertSqlServerAdapter',
  });

  const { chamado } = chamadoRepo.upsertChamado(EMPRESA, {
    fonteId: fonte.id,
    sistemaOrigem: 'softexpert',
    oidOrigem: 'OID-CHAMADO-1',
    numero: '036475',
    titulo: 'Chamado com anexos',
  });

  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: 'softexpert',
    canalEntrada: 'radar',
    referenciaExterna: '036475',
    conteudoBruto: 'Histórico do chamado 036475',
  });

  anexosOrigem = [bruto({ oid: 'BLOB-1', nome: 'evidencia.txt' })];
  const primeira = await anexosSoftExpertService.sincronizarAnexosParaAtendimento(EMPRESA, chamado.id, atendimento.id);
  assert.strictEqual(primeira.length, 1, 'primeira sincronização deve baixar o anexo');

  let locais = anexoRepo.listarAnexos(EMPRESA, atendimento.id);
  assert.strictEqual(locais.length, 1, 'deve existir um único anexo local');
  assert.strictEqual(locais[0].origemSistema, 'softexpert');
  assert.strictEqual(locais[0].origemOid, 'BLOB-1');
  assert.strictEqual(locais[0].origemTipo, 'anexo');
  assert.strictEqual(locais[0].origemReferenciaOid, 'OID-CHAMADO-1');

  const segunda = await anexosSoftExpertService.sincronizarAnexosParaAtendimento(EMPRESA, chamado.id, atendimento.id);
  assert.strictEqual(segunda.length, 0, 'segunda sincronização por mesmo OID não deve duplicar');
  assert.strictEqual(anexoRepo.listarAnexos(EMPRESA, atendimento.id).length, 1, 'não deve criar duplicata');

  anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimento.id, {
    nomeOriginal: 'legado-sem-oid.txt',
    nomeInterno: 'legado-sem-oid.txt',
    mimeType: 'text/plain',
    tamanho: 32,
    caminhoRelativo: 'legado/legado-sem-oid.txt',
  });
  anexosOrigem = [bruto({ oid: 'BLOB-LEGADO', nome: 'legado-sem-oid.txt' })];
  const legado = await anexosSoftExpertService.sincronizarAnexosParaAtendimento(EMPRESA, chamado.id, atendimento.id);
  assert.strictEqual(legado.length, 1, 'anexo legado por nome deve ser vinculado ao OID real');

  locais = anexoRepo.listarAnexos(EMPRESA, atendimento.id);
  assert.strictEqual(locais.length, 2, 'vincular legado não deve criar terceira linha');
  const localLegado = locais.find(a => a.nomeOriginal === 'legado-sem-oid.txt');
  assert.strictEqual(localLegado.origemOid, 'BLOB-LEGADO');

  console.log('anexos-softexpert-sync.test.js: ok');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(limparEDesligar);
