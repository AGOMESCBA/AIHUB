// node --test "apps/IA Service/tests/agente-arquivo-softexpert.test.js"
// Anexo fora do banco: o IA Service pede à rota /arquivo-softexpert do Agente Local
// e o arquivo segue o fluxo normal até a IA. Agente simulado por HTTP real.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-arquivo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

let origem = [];
let chamadasAdapter = [];
const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
require.cache[adapterPath] = {
  id: adapterPath, filename: adapterPath, loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo() { return []; },
    async listarPosicionamentosDoChamado() { return []; },
    async listarAnexosDoChamado(_e, _f, _n, opcoes) {
      chamadasAdapter.push(opcoes);
      const lista = opcoes.oid ? origem.filter((a) => a.OID === opcoes.oid) : origem;
      return lista.map((a) => ({ ...a, FLDATA: null }));
    },
  },
};

const provider = require('../backend/services/agente-local-provider');
const { encryptPayload, decryptPayload, isEncryptedEnvelope } = require('../backend/services/crypto-envelope');
const agenteLocalService = require('../backend/services/agente-local-service');
const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const servico = require('../backend/services/anexos-softexpert-service');

const EMPRESA = 99104;
const CHAVE = crypto.randomBytes(32).toString('base64');
const PDF = Buffer.from('%PDF-1.4 conteudo real do print '.repeat(30));
const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'k', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });

let servidor;
let urlAgente;
let recebidos = [];
let responder = null;

before(async () => {
  servidor = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const corpo = JSON.parse(raw || '{}');
      const claro = isEncryptedEnvelope(corpo) ? decryptPayload(corpo, CHAVE) : corpo;
      recebidos.push({ url: req.url, corpo, claro, autorizacao: req.headers.authorization });
      const { status, json } = responder(claro, isEncryptedEnvelope(corpo));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  urlAgente = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor?.close();
  database.fecharDB();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
});

const arquivoOk = () => ({ status: 200, json: { status: 'ok', nome_gravado: '00043254.pdf.gz', compactado: true, tamanho: PDF.length, conteudo_base64: PDF.toString('base64') } });
const LER = (extras = {}) => ({ cdfile: '43254', extensao: 'pdf', pasta: 'C:\\GED\\C3I', cryptoAtivo: false, empresaId: EMPRESA, ...extras });

test('provider: envia só código, extensão e pasta, com o token, e devolve o conteúdo', async () => {
  recebidos = [];
  responder = arquivoOk;
  const r = await provider.lerArquivo(urlAgente, 'tok', LER());
  assert.equal(r.conteudoBase64, PDF.toString('base64'));
  assert.equal(r.tamanho, PDF.length);
  assert.equal(recebidos[0].url, '/arquivo-softexpert');
  assert.equal(recebidos[0].autorizacao, 'Bearer tok');
  assert.equal(recebidos[0].claro.cdfile, '43254');
  assert.equal(recebidos[0].claro.pasta, 'C:\\GED\\C3I');
});

test('provider: com criptografia ativa, pedido e resposta vão cifrados', async () => {
  recebidos = [];
  responder = (_c, cifrado) => ({ status: 200, json: cifrado ? encryptPayload(arquivoOk().json, CHAVE, { kid: 'x' }) : { status: 'erro', codigo: 'x', erro: 'em claro' } });
  const r = await provider.lerArquivo(urlAgente, 'tok', LER({ cryptoAtivo: true, cryptoKey: CHAVE }));
  assert.equal(r.nomeGravado, '00043254.pdf.gz');
  assert.equal(isEncryptedEnvelope(recebidos[0].corpo), true);
  assert.equal(JSON.stringify(recebidos[0].corpo).includes('GED'), false, 'a pasta não trafega em claro');
});

test('provider: agente antigo (404) vira mensagem de atualização', async () => {
  responder = () => ({ status: 404, json: { detail: 'Not Found' } });
  await assert.rejects(provider.lerArquivo(urlAgente, 'tok', LER()), (e) => e.codigo === 'agente_desatualizado' && /desatualizado/.test(e.message));
});

test('provider: erro do agente preserva o código', async () => {
  responder = () => ({ status: 200, json: { status: 'erro', codigo: 'pasta_inacessivel', erro: 'Pasta de arquivos inacessivel pelo Agente Local.' } });
  await assert.rejects(provider.lerArquivo(urlAgente, 'tok', LER()), (e) => e.codigo === 'pasta_inacessivel');
});

// ---- Fluxo do serviço, com a configuração da Platform simulada
let sequencia = 0;
function cenario() {
  sequencia += 1;
  const numero = String(70000 + sequencia);
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: `OID-${numero}`, numero, titulo: 'Chamado' });
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'softexpert', canalEntrada: 'radar', referenciaExterna: numero, conteudoBruto: 'H' });
  origem = [{ origem: 'workflow', OID_REFERENCIA: 'R', OID: 'wf-43254', NMNAME: 'Doc1.pdf', IDEXTENSION: null, NRSIZE: 383761, FLDATA: null, CONTEUDO_ACESSIVEL: '0' }];
  chamadasAdapter = [];
  return { chamadoId: chamado.id, atendimentoId: atendimento.id };
}

async function comAgente(pasta, lerArquivo, fn) {
  const a = { get: agenteLocalService.getPastaArquivos, ler: agenteLocalService.lerArquivoDaPasta };
  agenteLocalService.getPastaArquivos = () => pasta;
  agenteLocalService.lerArquivoDaPasta = lerArquivo;
  try { return await fn(); } finally {
    agenteLocalService.getPastaArquivos = a.get;
    agenteLocalService.lerArquivoDaPasta = a.ler;
  }
}

const RAPIDO = { esperaMs: 1 };
const lerOk = async () => ({ conteudoBase64: PDF.toString('base64'), nomeGravado: '00043254.pdf.gz', tamanho: PDF.length });

test('com a pasta configurada, o anexo fora do banco é copiado e chega à IA', async () => {
  const { chamadoId, atendimentoId } = cenario();
  const pedidos = [];
  await comAgente('C:\\GED\\C3I', async (_e, p) => { pedidos.push(p); return lerOk(); }, async () => {
    // A lista também dispara a cópia antecipada: as duas usam uma única leitura.
    const lista = await servico.listarAnexosDoChamado(EMPRESA, chamadoId);
    assert.equal(lista[0].conteudoAcessivel, true);
    const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
    assert.deepEqual(r.faltantes, []);
    assert.deepEqual(pedidos, [{ cdfile: '43254', extensao: 'pdf' }], 'um único pedido ao agente');
    const [copia] = anexoRepo.listarAnexos(EMPRESA, atendimentoId);
    assert.equal(copia.nomeOriginal, 'Doc1.pdf');
    assert.equal(copia.origemOid, 'wf-43254');
    assert.equal(copia.tamanho, PDF.length, 'tamanho do conteúdo descompactado');
    // Segunda análise: cópia íntegra, nada volta ao agente.
    pedidos.length = 0;
    const r2 = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
    assert.equal(r2.copiados.length, 0);
    assert.equal(pedidos.length, 0);
  });
});

test('download pelo chat também lê da pasta', async () => {
  const { chamadoId } = cenario();
  await comAgente('C:\\GED\\C3I', lerOk, async () => {
    const b = await servico.baixarAnexo(EMPRESA, chamadoId, 'wf-43254');
    assert.equal(b.nome, 'Doc1.pdf');
    assert.equal(b.mimeType, 'application/pdf');
    assert.deepEqual(b.buffer, PDF);
  });
});

test('sem pasta configurada continua o aviso "guardado só no SoftExpert"', async () => {
  const { chamadoId, atendimentoId } = cenario();
  let chamou = false;
  await comAgente(null, async () => { chamou = true; return lerOk(); }, async () => {
    const lista = await servico.listarAnexosDoChamado(EMPRESA, chamadoId);
    assert.equal(lista[0].conteudoAcessivel, false);
    const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
    assert.deepEqual(r.faltantes, [{ nome: 'Doc1.pdf', motivo: 'somente_softexpert' }]);
  });
  assert.equal(chamou, false);
});

for (const [codigo, mensagem, texto] of [
  ['agente_desatualizado', 'Agente Local desatualizado: instale.', /precisa ser atualizado/],
  ['pasta_inacessivel', 'Pasta de arquivos inacessivel pelo Agente Local.', /não acessa a pasta/],
  ['arquivo_nao_encontrado', 'Arquivo 00043254 nao encontrado na pasta configurada.', /não encontrado na pasta/],
]) {
  test(`falha "${codigo}" não trava a análise, não repete e explica o motivo`, async () => {
    const { chamadoId, atendimentoId } = cenario();
    let tentativas = 0;
    await comAgente('C:\\GED\\C3I', async () => { tentativas += 1; const e = new Error(mensagem); e.codigo = codigo; throw e; }, async () => {
      const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
      assert.deepEqual(r.faltantes, [{ nome: 'Doc1.pdf', motivo: codigo }]);
      assert.match(servico.descreverGarantia(r).avisoAnalista, texto);
    });
    assert.equal(tentativas, 1, 'erro definitivo não gera nova tentativa');
  });
}

test('falha passageira de rede na pasta é superada com novas tentativas', async () => {
  const { chamadoId, atendimentoId } = cenario();
  let tentativas = 0;
  await comAgente('C:\\GED\\C3I', async () => { tentativas += 1; if (tentativas < 3) throw new Error('Falha ao conectar ao agente: ECONNRESET'); return lerOk(); }, async () => {
    const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
    assert.equal(r.copiados.length, 1);
    assert.equal(tentativas, 3);
  });
});

test('Platform: coluna, validação e tela da pasta', () => {
  const Database = require('better-sqlite3');
  const { ensurePlatformSchema } = require('../../IAHUB/backend/platform-schema');
  const db = new Database(':memory:');
  ensurePlatformSchema(db);
  assert.ok(db.prepare('PRAGMA table_info(platform_agent_configs)').all().some((c) => c.name === 'agente_local_pasta_arquivos'));
  db.close();
  const rotas = fs.readFileSync(path.resolve(__dirname, '../../IAHUB/backend/platform-routes.js'), 'utf8');
  const regexValida = rotas.match(/!\/(\^\(\[a-zA-Z\][^\n]*?)\/\.test\(pastaArquivos\) \|\| \/(.*?)\/\.test\(pastaArquivos\)/);
  assert.ok(regexValida, 'validação presente');
  const formato = new RegExp(regexValida[1]);
  const pontos = new RegExp(regexValida[2]);
  const aceita = (p) => formato.test(p) && !pontos.test(p);
  for (const p of ['C:\\GED\\C3I', 'D:/ged', '\\\\servidor\\GED\\C3I', '/mnt/ged']) assert.equal(aceita(p), true, p);
  for (const p of ['GED', 'C3I\\a', 'C:ged', '\\\\', 'C:\\GED\\..\\Windows', '..\\x']) assert.equal(aceita(p), false, p);
  const tela = fs.readFileSync(path.resolve(__dirname, '../../IA Administracao/frontend/platform-config.html'), 'utf8');
  assert.match(tela, /id="agent-pasta-arquivos"/);
  assert.match(tela, /agenteLocalPastaArquivos:document\.getElementById\('agent-pasta-arquivos'\)/);
});
