// Fase 1 - entrega operacional de fontes corrigidos.
// Executar: node "apps/IA Service/tests/fase1-fontes-corrigidos.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-fase1-fontes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const aiConfigService = require('../backend/services/ai-config-service');
const technicalResearchService = require('../backend/services/technical-research-service');
const investigacaoDossieAtualizador = require('../backend/services/investigacao-dossie-atualizador-service');
const investigacaoService = require('../backend/services/investigacao-service');
const versaoFonteService = require('../backend/services/versao-fonte-service');
const armazenamento = require('../backend/services/armazenamento-anexos');
const registrarRotas = require('../backend/routes');

const EMPRESA_A = 99101;
const EMPRESA_B = 99102;

function respostaIA(fonteCorrigido) {
  return `**Diagnóstico**
O erro vem do uso de cRet sem inicializacao antes do retorno.

**Causa provável**
Causa confirmada pelo log e pelo fonte anexado.

**Evidências**
O PRW anexado retorna cRet sem inicializar a variavel.

**Correção proposta**
Inicializar cRet antes do retorno.

**Fonte corrigido**
\`\`\`advpl
${fonteCorrigido}
\`\`\`

**Alterações realizadas**
Incluida inicializacao de cRet.

**Validação**
Aplicar em homologacao e executar novamente o fluxo que gerava o erro.`;
}

function fakeProviderResponse(texto) {
  const res = new Readable({ read() {} });
  res.statusCode = 200;
  res.headers = { 'content-type': 'application/json' };
  process.nextTick(() => {
    res.emit('data', Buffer.from(JSON.stringify({
      choices: [{ message: { content: texto }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 80 },
    })));
    res.emit('end');
  });
  return res;
}

function prepararArquivo(empresaId, atendimentoId, nome, conteudo) {
  const dir = path.join(armazenamento.ANEXOS_DIR, String(empresaId), String(atendimentoId));
  fs.mkdirSync(dir, { recursive: true });
  const caminho = path.join(dir, nome);
  fs.writeFileSync(caminho, conteudo, 'utf8');
  return path.relative(armazenamento.ANEXOS_DIR, caminho).split(path.sep).join('/');
}

function criarAnexoCodigo(empresaId, atendimentoId, nome, conteudo) {
  const caminhoRelativo = prepararArquivo(empresaId, atendimentoId, nome, conteudo);
  return anexoRepo.salvarMetadadosAnexo(empresaId, atendimentoId, {
    nomeOriginal: nome,
    nomeInterno: path.basename(caminhoRelativo),
    mimeType: 'text/plain',
    tamanho: Buffer.byteLength(conteudo, 'utf8'),
    caminhoRelativo,
    conteudoExtraido: conteudo,
    linguagemDetectada: 'advpl',
    encodingDetectado: 'utf-8',
    eCodigo: true,
  });
}

async function comIAFake(textoResposta, fn) {
  const oldResolver = aiConfigService.resolverKeysEOrdem;
  const oldPesquisar = technicalResearchService.pesquisar;
  const oldFormatar = technicalResearchService.formatarContextoParaPrompt;
  const oldAtualizarDossie = investigacaoDossieAtualizador.atualizarAposTurno;
  const oldRequest = https.request;

  aiConfigService.resolverKeysEOrdem = () => ({
    keys: { groq: 'gsk-test' },
    cfg: { provedorPrimario: 'groq', fallbackOrdem: 'groq', modelos: { groq: 'openai/gpt-oss-20b' } },
  });
  technicalResearchService.pesquisar = async () => ({ configurado: false, modo: 'nao_pesquisado', resultados: [], paginasLidas: [] });
  technicalResearchService.formatarContextoParaPrompt = () => '';
  investigacaoDossieAtualizador.atualizarAposTurno = async () => ({ aplicado: false });
  https.request = (options, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.write = () => {};
    req.end = () => process.nextTick(() => cb(fakeProviderResponse(textoResposta)));
    return req;
  };

  try {
    return await fn();
  } finally {
    aiConfigService.resolverKeysEOrdem = oldResolver;
    technicalResearchService.pesquisar = oldPesquisar;
    technicalResearchService.formatarContextoParaPrompt = oldFormatar;
    investigacaoDossieAtualizador.atualizarAposTurno = oldAtualizarDossie;
    https.request = oldRequest;
  }
}

async function iniciarAppTeste() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user_id: 1 };
    next();
  });
  registrarRotas(app, {
    requireAuth: (req, _res, next) => next(),
    requireIaService: (req, _res, next) => {
      req.svcEmpresaId = Number(req.query?.empresa_id || 0);
      next();
    },
  });
  const server = await new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function limpar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
  for (const empresaId of [EMPRESA_A, EMPRESA_B]) {
    try { fs.rmSync(path.join(armazenamento.ANEXOS_DIR, String(empresaId)), { recursive: true, force: true }); } catch (_) {}
  }
}

async function main() {
  let server;
  try {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, {
      origem: 'manual',
      canalEntrada: 'web',
      conteudoBruto: 'Erro em fonte PRW customizado.',
    });
    const original = criarAnexoCodigo(EMPRESA_A, atendimento.id, 'MeuWorkflow.prw', 'User Function MeuWF()\nreturn cRet');

    const resposta = await comIAFake(respostaIA('User Function MeuWF()\nLocal cRet := ""\nreturn cRet'), () =>
      investigacaoService.processarTurno(EMPRESA_A, atendimento.id, {
        texto: 'Corrija o fonte anexado.',
        usuarioId: 1,
        anexoIds: [original.id],
      })
    );

    assert.strictEqual(resposta.fontesCorrigidos.length, 1, 'um unico PRW deve gerar uma entrega de fonte corrigido');
    assert.strictEqual(resposta.fontesCorrigidos[0].original.id, original.id, 'entrega deve referenciar o original correto');
    assert.strictEqual(resposta.fontesCorrigidos[0].versao.mensagemOrigemId, resposta.id, 'versao deve apontar para a resposta que a originou');
    assert.match(resposta.fontesCorrigidos[0].versao.nomeOriginal, /MeuWorkflow \(corrigido\)\.prw$/, 'download deve preservar extensao PRW');

    const originalDepois = anexoRepo.getAnexo(EMPRESA_A, original.id);
    assert.strictEqual(originalDepois.conteudoExtraido, 'User Function MeuWF()\nreturn cRet', 'original deve permanecer intacto');

    const versao = resposta.fontesCorrigidos[0].versao;
    const diff = versaoFonteService.calcularDiff(originalDepois.conteudoExtraido, versao.conteudoExtraido);
    assert.ok(diff.some(l => l.tipo === 'adicionada' && l.texto.includes('Local cRet')), 'diff deve mostrar linha adicionada');

    const segundaVersao = versaoFonteService.criarVersaoCorrigida(EMPRESA_A, {
      anexoOriginalId: original.id,
      atendimentoId: atendimento.id,
      mensagemOrigemId: resposta.id,
      conteudoCorrigido: 'User Function MeuWF()\nLocal cRet := ""\nConOut(cRet)\nreturn cRet',
      explicacaoAlteracao: 'Incluido log temporario.',
      usuarioId: 1,
    });
    const historico = versaoFonteService.listarVersoes(EMPRESA_A, original.id);
    assert.deepStrictEqual(historico.map(v => v.id), [original.id, versao.id, segundaVersao.id], 'historico deve manter original e multiplas versoes');

    const appTeste = await iniciarAppTeste();
    server = appTeste.server;
    const download = await fetch(`${appTeste.baseUrl}/api/ia-service/anexos/${versao.id}/download?empresa_id=${EMPRESA_A}`);
    assert.strictEqual(download.status, 200, 'download do fonte corrigido deve funcionar');
    assert.match(download.headers.get('content-disposition') || '', /MeuWorkflow/i);
    assert.strictEqual(await download.text(), versao.conteudoExtraido, 'download deve devolver conteudo corrigido real');

    const diffHttp = await fetch(`${appTeste.baseUrl}/api/ia-service/anexos/${original.id}/diff/${versao.id}?empresa_id=${EMPRESA_A}`);
    assert.strictEqual(diffHttp.status, 200, 'endpoint de diff deve funcionar');
    const diffBody = await diffHttp.json();
    assert.strictEqual(diffBody.original.id, original.id);
    assert.strictEqual(diffBody.versao.id, versao.id);
    assert.ok(diffBody.diff.some(l => l.tipo === 'adicionada'), 'endpoint de diff deve retornar linhas adicionadas');

    const crossEmpresa = await fetch(`${appTeste.baseUrl}/api/ia-service/anexos/${versao.id}/download?empresa_id=${EMPRESA_B}`);
    assert.strictEqual(crossEmpresa.status, 404, 'empresa B nao pode baixar anexo da empresa A');

    const atendimentoAmbiguo = atendimentoRepo.criarAtendimento(EMPRESA_A, {
      origem: 'manual',
      canalEntrada: 'web',
      conteudoBruto: 'Dois fontes possiveis.',
    });
    const fonteA = criarAnexoCodigo(EMPRESA_A, atendimentoAmbiguo.id, 'A.prw', 'User Function A()\nreturn cRet');
    const fonteB = criarAnexoCodigo(EMPRESA_A, atendimentoAmbiguo.id, 'B.prw', 'User Function B()\nreturn cRet');
    const respostaAmbigua = await comIAFake(respostaIA('User Function A()\nLocal cRet := ""\nreturn cRet'), () =>
      investigacaoService.processarTurno(EMPRESA_A, atendimentoAmbiguo.id, {
        texto: 'Corrija o fonte.',
        usuarioId: 1,
        anexoIds: [fonteA.id, fonteB.id],
      })
    );
    assert.strictEqual(respostaAmbigua.fontesCorrigidos.length, 0, 'dois fontes ambiguos nao devem gerar versao automatica');
    assert.ok(respostaAmbigua.avisosFonteCorrigido.some(a => /mais de um anexo/i.test(a)), 'ambiguidade deve ser informada');

    const atendimentoTruncado = atendimentoRepo.criarAtendimento(EMPRESA_A, {
      origem: 'manual',
      canalEntrada: 'web',
      conteudoBruto: 'Fonte incompleto.',
    });
    const fonteTruncado = criarAnexoCodigo(EMPRESA_A, atendimentoTruncado.id, 'Curto.prw', 'User Function Curto()\nreturn cRet');
    const respostaCurta = await comIAFake(respostaIA('x'), () =>
      investigacaoService.processarTurno(EMPRESA_A, atendimentoTruncado.id, {
        texto: 'Corrija o fonte.',
        usuarioId: 1,
        anexoIds: [fonteTruncado.id],
      })
    );
    assert.strictEqual(respostaCurta.fontesCorrigidos.length, 0, 'fonte corrigido incompleto nao deve ser entregue como arquivo');
    assert.ok(respostaCurta.avisosFonteCorrigido.length, 'incompletude deve gerar aviso');

    const mensagens = mensagemRepo.listarMensagens(EMPRESA_A, atendimento.id);
    assert.ok(mensagens.some(m => m.id === resposta.id), 'resposta da IA deve permanecer registrada normalmente');

    assert.throws(
      () => versaoFonteService.listarVersoes(EMPRESA_B, original.id),
      /não encontrado|n[aã]o encontrado/i,
      'empresa B nao deve listar historico da empresa A'
    );

    console.log('fase1-fontes-corrigidos.test.js: ok (todos os asserts passaram)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    limpar();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
