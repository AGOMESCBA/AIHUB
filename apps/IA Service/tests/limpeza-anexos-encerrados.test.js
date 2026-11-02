// node --test "apps/IA Service/tests/limpeza-anexos-encerrados.test.js"
// Cópias do SoftExpert de chamados encerrados há mais do prazo: simulação não
// apaga nada; o modo apagar remove arquivo e texto, mantém o registro, e o
// anexo volta a ser copiado se o chamado for reaberto.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-limpeza-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

let origem = [];
const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
require.cache[adapterPath] = {
  id: adapterPath, filename: adapterPath, loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo() { return []; },
    async listarPosicionamentosDoChamado() { return []; },
    async listarAnexosDoChamado(_e, _f, _n, opcoes) {
      const lista = opcoes.oid ? origem.filter((a) => a.OID === opcoes.oid) : origem;
      return lista.map((a) => (opcoes.comConteudo === false ? { ...a, FLDATA: null } : a));
    },
  },
};

const { getDB } = require('../backend/database');
const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const armazenamento = require('../backend/services/armazenamento-anexos');
const servico = require('../backend/services/anexos-softexpert-service');
const limpeza = require('../backend/services/limpeza-anexos-encerrados-service');

const EMPRESA = 99105;
const AGORA = new Date('2026-11-02T12:00:00Z');
const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'k', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
let sequencia = 0;

function bruto(oid, nome) {
  const b = Buffer.from(`conteudo pessoal de ${nome}`, 'utf8');
  return { origem: 'anexo', OID_REFERENCIA: 'R', OID: oid, NMNAME: nome, IDEXTENSION: 'txt', NRSIZE: b.length, FLDATA: b.toString('base64'), CONTEUDO_ACESSIVEL: 1 };
}

async function chamadoComAnexo({ status, ultimaMovimentacao, nome = 'log.txt' }) {
  sequencia += 1;
  const numero = String(60000 + sequencia);
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: `OID-${numero}`, numero, titulo: 'C', dataAbertura: ultimaMovimentacao });
  getDB().prepare('UPDATE chamados SET status_encerramento = ? WHERE id = ?').run(status, chamado.id);
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'softexpert', canalEntrada: 'radar', referenciaExterna: numero, conteudoBruto: 'H' });
  origem = [bruto(`O-${numero}`, nome)];
  await servico.garantirAnexosParaIA(EMPRESA, chamado.id, atendimento.id, { esperaMs: 1 });
  const [anexo] = anexoRepo.listarAnexos(EMPRESA, atendimento.id);
  return { chamado, atendimento, anexo, numero };
}

const caminho = (a) => path.join(armazenamento.ANEXOS_DIR, a.caminhoRelativo);

after(() => {
  database.fecharDB();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
});

test('simulação conta só o que passou do prazo e não apaga nada', async () => {
  const antigo = await chamadoComAnexo({ status: 'Encerrado', ultimaMovimentacao: '2026-08-01T10:00:00.000Z' });
  const recente = await chamadoComAnexo({ status: 'Encerrado', ultimaMovimentacao: '2026-10-20T10:00:00.000Z' });
  const aberto = await chamadoComAnexo({ status: 'Andamento', ultimaMovimentacao: '2026-01-01T10:00:00.000Z' });
  const r = limpeza.executar({ modo: 'simular', agora: AGORA });
  const numeros = limpeza.listarCandidatos({ prazoDias: 15, agora: AGORA }).linhas.map((l) => l.numero);
  assert.ok(numeros.includes(antigo.numero));
  assert.ok(!numeros.includes(recente.numero), 'encerrado há menos de 15 dias fica');
  assert.ok(!numeros.includes(aberto.numero), 'chamado aberto nunca entra');
  assert.equal(r.removidos, 0);
  assert.ok(fs.existsSync(caminho(antigo.anexo)), 'simulação não apaga');
  assert.ok(anexoRepo.getAnexo(EMPRESA, antigo.anexo.id).conteudoExtraido);
});

test('apagar remove arquivo e texto, mantém o registro e não toca no anexo do chat', async () => {
  const c = await chamadoComAnexo({ status: 'Encerrado', ultimaMovimentacao: '2026-07-01T10:00:00.000Z' });
  const doChat = armazenamento.salvarAnexo(EMPRESA, c.atendimento.id, { nomeOriginal: 'enviado.txt', mimeType: 'text/plain', tamanho: 5, conteudo: Buffer.from('chat!'), usuarioId: null });
  const r = limpeza.executar({ modo: 'apagar', prazoDias: 30, agora: AGORA });
  assert.ok(r.removidos >= 1);
  assert.deepEqual(r.erros, []);
  assert.equal(fs.existsSync(caminho(c.anexo)), false, 'arquivo apagado');
  const registro = anexoRepo.getAnexo(EMPRESA, c.anexo.id);
  assert.ok(registro, 'registro mantido');
  assert.equal(registro.conteudoExtraido, null, 'texto extraído apagado');
  assert.ok(registro.arquivoRemovidoEm);
  assert.ok(fs.existsSync(path.join(armazenamento.ANEXOS_DIR, doChat.caminhoRelativo)), 'anexo do chat fica');
  assert.deepEqual(anexoRepo.listarAnexos(EMPRESA, c.atendimento.id).map((a) => a.nomeOriginal), ['enviado.txt'], 'tela e IA não veem a cópia removida');
  assert.equal(limpeza.executar({ modo: 'apagar', prazoDias: 30, agora: AGORA }).anexos, 0, 'nova execução não repete');
});

test('chamado encerrado: abrir o anexo mostra do SoftExpert e não grava cópia', async () => {
  const c = await chamadoComAnexo({ status: 'Encerrado', ultimaMovimentacao: '2026-06-01T10:00:00.000Z', nome: 'antigo.txt' });
  limpeza.executar({ modo: 'apagar', prazoDias: 30, agora: AGORA });
  const b = await servico.baixarAnexo(EMPRESA, c.chamado.id, c.anexo.origemOid);
  assert.match(b.buffer.toString(), /conteudo pessoal de antigo\.txt/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(anexoRepo.getAnexo(EMPRESA, c.anexo.id).arquivoRemovidoEm !== null, true, 'continua sem cópia');
});

test('reaberto: o anexo removido volta a ser copiado no primeiro uso, no mesmo registro', async () => {
  const c = await chamadoComAnexo({ status: 'Encerrado', ultimaMovimentacao: '2026-05-01T10:00:00.000Z', nome: 'volta.txt' });
  limpeza.executar({ modo: 'apagar', prazoDias: 30, agora: AGORA });
  getDB().prepare("UPDATE chamados SET status_encerramento = 'Andamento' WHERE id = ?").run(c.chamado.id);
  origem = [bruto(c.anexo.origemOid, 'volta.txt')];
  const g = await servico.garantirAnexosParaIA(EMPRESA, c.chamado.id, c.atendimento.id, { esperaMs: 1 });
  assert.deepEqual(g.faltantes, []);
  const [restaurado] = anexoRepo.listarAnexos(EMPRESA, c.atendimento.id);
  assert.equal(restaurado.id, c.anexo.id, 'mesmo registro');
  assert.equal(restaurado.arquivoRemovidoEm, null);
  assert.match(restaurado.conteudoExtraido, /conteudo pessoal de volta\.txt/);
  assert.ok(fs.existsSync(caminho(restaurado)));
});

test('caminho adulterado fora da pasta de anexos não é apagado', async () => {
  const c = await chamadoComAnexo({ status: 'Encerrado', ultimaMovimentacao: '2026-04-01T10:00:00.000Z', nome: 'x.txt' });
  const fora = path.join(os.tmpdir(), `nao-apagar-${Date.now()}.txt`);
  fs.writeFileSync(fora, 'x');
  getDB().prepare('UPDATE anexos SET caminho_relativo = ? WHERE id = ?').run(path.relative(armazenamento.ANEXOS_DIR, fora), c.anexo.id);
  const r = limpeza.executar({ modo: 'apagar', prazoDias: 30, agora: AGORA });
  assert.ok(r.erros.some((e) => e.anexoId === c.anexo.id));
  assert.ok(fs.existsSync(fora));
  fs.unlinkSync(fora);
});

test('modo padrão é simular', () => {
  delete process.env.SVC_LIMPEZA_ANEXOS_MODO;
  assert.equal(limpeza.configuracao().modo, 'simular');
  assert.equal(limpeza.configuracao().prazoDias, 15);
});
