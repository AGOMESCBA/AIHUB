'use strict';
// Texto dos prints gravado no anexo (2026-11-03, #036914: 24,5 s relendo
// prints a cada turno — antes só em memória, perdida a cada reinício). Print
// já lido nunca volta para a IA; um print por chamada; falha não grava;
// limpeza de encerrados e nova cópia apagam o texto.
// Sem rede e sem IA: provider simulado. Dados sintéticos.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-texto-print-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const armazenamento = require('../backend/services/armazenamento-anexos');
const aiProviderClient = require('../backend/services/ai-provider-client');
const aiConfigService = require('../backend/services/ai-config-service');
const investigacao = require('../backend/services/investigacao-service');

const EMPRESA = 99511;
const PASTA = `_teste-texto-print-${process.pid}`;
fs.mkdirSync(path.join(armazenamento.ANEXOS_DIR, PASTA), { recursive: true });
const originais = { chamarIA: aiProviderClient.chamarIA, resolver: aiConfigService.resolverKeysEOrdem };
aiConfigService.resolverKeysEOrdem = () => ({ keys: { openai: 'x' }, cfg: { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: 'm' } } });
after(() => {
  aiProviderClient.chamarIA = originais.chamarIA;
  aiConfigService.resolverKeysEOrdem = originais.resolver;
  try { database.getDB().close(); } catch (_) {}
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
  fs.rmSync(path.join(armazenamento.ANEXOS_DIR, PASTA), { recursive: true, force: true });
});

// Provider simulado: responde o "texto" de cada imagem pelo conteúdo do arquivo.
let chamadas = [];
let falhar = false;
aiProviderClient.chamarIA = async (keys, cfg, system, user, imagens) => {
  chamadas.push(imagens.length);
  if (falhar) throw new Error('read ECONNRESET');
  return { texto: Buffer.from(imagens[0].base64, 'base64').toString('utf8') };
};

let seq = 0;
function print(atendimentoId, conteudo, origemSistema = null) {
  const nome = `${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(armazenamento.ANEXOS_DIR, PASTA, nome), conteudo);
  const a = anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimentoId, { nomeOriginal: `print${++seq}.png`, nomeInterno: nome, mimeType: 'image/png', tamanho: conteudo.length, caminhoRelativo: path.join(PASTA, nome), origemSistema });
  database.getDB().prepare('UPDATE anexos SET criado_em = ? WHERE id = ?').run(new Date(Date.now() + seq * 1000).toISOString(), a.id);
  return a;
}
const novoAtendimento = () => atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'manual', canalEntrada: 'chat', conteudoBruto: 'Erro na tela.' });
const ler = at => investigacao._transcreverPrintsParaBusca(EMPRESA, anexoRepo.listarAnexos(EMPRESA, at.id));

test('lê cada print numa chamada própria, grava no anexo e não relê depois (nem após reiniciar)', async () => {
  const at = novoAtendimento();
  print(at.id, 'MATA110 - Erro A');
  print(at.id, 'Failed to load program');
  chamadas = [];
  const texto = await ler(at);
  assert.deepEqual(chamadas, [1, 1], 'um print por chamada');
  assert.match(texto, /Failed to load program/);
  assert.match(texto, /MATA110 - Erro A/);
  chamadas = [];
  assert.equal(await ler(at), texto, 'mesmo texto vindo do banco');
  assert.deepEqual(chamadas, [], 'nenhuma chamada à IA no turno seguinte');
});

test('print novo: só ele vai para a IA', async () => {
  const at = novoAtendimento();
  print(at.id, 'Tela 1');
  await ler(at);
  print(at.id, 'Tela 2');
  chamadas = [];
  const texto = await ler(at);
  assert.deepEqual(chamadas, [1]);
  assert.match(texto, /Tela 1/);
  assert.match(texto, /Tela 2/);
});

test('falha na leitura não grava: tenta de novo no próximo turno', async () => {
  const at = novoAtendimento();
  const p = print(at.id, 'Erro B');
  falhar = true;
  try { assert.equal(await ler(at), ''); } finally { falhar = false; }
  assert.equal(anexoRepo.getAnexo(EMPRESA, p.id).textoPrintBusca, null);
  chamadas = [];
  assert.equal(await ler(at), 'Erro B');
  assert.deepEqual(chamadas, [1]);
});

test('print sem texto legível fica gravado como vazio e não é relido no mesmo turno', async () => {
  const at = novoAtendimento();
  const p = print(at.id, '');
  const anexos = anexoRepo.listarAnexos(EMPRESA, at.id);
  fs.writeFileSync(path.join(armazenamento.ANEXOS_DIR, p.caminhoRelativo), ' '); // arquivo não vazio, "texto" em branco
  chamadas = [];
  assert.equal(await investigacao._transcreverPrintsParaBusca(EMPRESA, anexos), '');
  assert.equal(await investigacao._transcreverPrintsParaBusca(EMPRESA, anexos), '', 'a pesquisa relê a mesma lista do turno');
  assert.deepEqual(chamadas, [1]);
  assert.equal(anexoRepo.getAnexo(EMPRESA, p.id).textoPrintBusca, '');
});

test('até 3 prints mais recentes, com o mesmo limite total de 1500 caracteres', async () => {
  const at = novoAtendimento();
  for (let i = 0; i < 4; i++) print(at.id, `P${i} ` + 'x'.repeat(900));
  chamadas = [];
  const texto = await ler(at);
  assert.equal(chamadas.length, 3);
  assert.ok(!texto.includes('P0 '), 'o mais antigo fica de fora');
  assert.ok(texto.length <= 1500 + 2);
});

test('limpeza de encerrados e nova cópia do arquivo apagam o texto (LGPD / arquivo trocado)', async () => {
  const at = novoAtendimento();
  const p = print(at.id, 'Dado do cliente', 'softexpert');
  await ler(at);
  assert.equal(anexoRepo.getAnexo(EMPRESA, p.id).textoPrintBusca, 'Dado do cliente');
  anexoRepo.marcarArquivoRemovido(EMPRESA, p.id);
  assert.equal(anexoRepo.getAnexo(EMPRESA, p.id).textoPrintBusca, null);
  chamadas = [];
  assert.equal(await ler(at), '', 'arquivo removido não é lido');
  assert.deepEqual(chamadas, []);
  anexoRepo.salvarTextoPrintBusca(EMPRESA, p.id, 'antigo');
  anexoRepo.atualizarArquivoSincronizado(EMPRESA, p.id, { nomeOriginal: 'print.png', nomeInterno: p.nomeInterno, mimeType: 'image/png', tamanho: 5, caminhoRelativo: p.caminhoRelativo });
  assert.equal(anexoRepo.getAnexo(EMPRESA, p.id).textoPrintBusca, null, 'arquivo novo será lido de novo');
});
