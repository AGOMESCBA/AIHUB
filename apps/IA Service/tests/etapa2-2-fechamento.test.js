const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const database = require('../backend/database');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const { redigirTexto, redigirValor } = require('../backend/services/redaction-service');
const armazenamento = require('../backend/services/armazenamento-anexos');
const aiConfigService = require('../backend/services/ai-config-service');
const technicalResearchService = require('../backend/services/technical-research-service');
const contextEngine = require('../backend/services/context-engine');
const investigacaoService = require('../backend/services/investigacao-service');

function fakeProviderResponse(texto) {
  const res = new Readable({ read() {} });
  res.statusCode = 200;
  res.headers = { 'content-type': 'application/json' };
  process.nextTick(() => {
    res.emit('data', Buffer.from(JSON.stringify({
      choices: [{ message: { content: texto }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })));
    res.emit('end');
  });
  return res;
}

function criarPngMinimo() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZfJqQAAAABJRU5ErkJggg==',
    'base64'
  );
}

function criarPdfBuffer(texto) {
  const safe = String(texto).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`;
  const objetos = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objetos) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objetos.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function prepararArquivoAnexo(empresaId, atendimentoId, nome, buffer) {
  const dir = path.join(armazenamento.ANEXOS_DIR, String(empresaId), String(atendimentoId));
  fs.mkdirSync(dir, { recursive: true });
  const caminho = path.join(dir, nome);
  fs.writeFileSync(caminho, buffer);
  return path.relative(armazenamento.ANEXOS_DIR, caminho).split(path.sep).join('/');
}

function manifestoBaseSelecionado() {
  return {
    versao: 1,
    selecionados: [{ id: 'texto', tipo: 'anexo', status: 'ANALISADA', score: 10 }],
    omitidos: [],
  };
}

async function executarTurnoComContextos({ empresaId, atendimento, contextos, respostaFinal = 'Resposta final com evidencias especificas, stack trace e linha 10.' }) {
  const oldResolver = aiConfigService.resolverKeysEOrdem;
  const oldPesquisar = technicalResearchService.pesquisar;
  const oldFormatar = technicalResearchService.formatarContextoParaPrompt;
  const oldMontar = contextEngine.montarContextoInvestigacao;
  const oldRequest = https.request;
  const chamadas = [];
  let contextoIdx = 0;

  aiConfigService.resolverKeysEOrdem = () => ({
    keys: { groq: 'gsk-test', openai: 'sk-test' },
    cfg: { provedorPrimario: 'groq', fallbackOrdem: 'groq,openai', modelos: { groq: 'openai/gpt-oss-20b', openai: 'gpt-4o-mini' } },
  });
  technicalResearchService.pesquisar = async () => ({ configurado: false, modo: 'links', paginasLidas: [] });
  technicalResearchService.formatarContextoParaPrompt = () => '';
  contextEngine.montarContextoInvestigacao = (...args) => {
    const contexto = contextos[Math.min(contextoIdx, contextos.length - 1)](...args);
    contextoIdx += 1;
    return contexto;
  };

  https.request = (options, cb) => {
    let raw = '';
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.write = chunk => { raw += chunk; };
    req.end = () => {
      const body = JSON.parse(raw);
      chamadas.push({ hostname: options.hostname, body });
      const texto = chamadas.length === 1
        ? 'Recomendo verificar os logs e envie mais informações.'
        : respostaFinal;
      process.nextTick(() => cb(fakeProviderResponse(texto)));
    };
    return req;
  };

  try {
    await investigacaoService.processarTurno(empresaId, atendimento.id, {
      texto: 'Analise o chamado',
      usuarioId: null,
      anexoIds: [],
    });
    return chamadas;
  } finally {
    aiConfigService.resolverKeysEOrdem = oldResolver;
    technicalResearchService.pesquisar = oldPesquisar;
    technicalResearchService.formatarContextoParaPrompt = oldFormatar;
    contextEngine.montarContextoInvestigacao = oldMontar;
    https.request = oldRequest;
  }
}

async function main() {
  assert.strictEqual(redigirTexto('session=xyz12345'), 'session=[REDACTED]');
  assert.strictEqual(redigirTexto('session: xyz12345'), 'session: [REDACTED]');
  assert.strictEqual(redigirTexto('SESSION_ID: abcdef123'), 'SESSION_ID: [REDACTED]');
  assert.strictEqual(redigirTexto('sessionid=abcdef123'), 'sessionid=[REDACTED]');
  assert.strictEqual(redigirTexto('session-token=abcdef123'), 'session-token=[REDACTED]');
  assert.strictEqual(redigirTexto('session_token=abcdef123'), 'session_token=[REDACTED]');
  assert.ok(!JSON.stringify(redigirValor({
    erro: 'Authorization: Bearer zzzzzzzzzz password=segredo123 secret=abc12345 token=tok12345 session=xyz12345 cookie: sid=abc',
    url: 'https://user:pass.example@example.com?a=1&token=abcdef123456&session=xyz12345',
  })).includes('xyz12345'));

  const dbTmpPath = path.join(os.tmpdir(), `ia-service-etapa22-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  database.inicializarDB(dbTmpPath);

  try {
    const atendimentoRedaction = atendimentoRepo.criarAtendimento(9801, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'redaction' });
    execucaoRepo.salvarExecucao(9801, {
      atendimentoId: atendimentoRedaction.id,
      provider: 'openai',
      model: 'gpt-4o-mini',
      pesquisa: { erro: 'Erro externo: session=xyz12345' },
      tentativas: [{ erro: 'Provider falhou com SESSION_ID: abcdef123' }],
    });
    const auditoria = execucaoRepo.listarPorAtendimento(9801, atendimentoRedaction.id);
    const auditoriaJson = JSON.stringify(auditoria);
    assert.ok(!auditoriaJson.includes('xyz12345'));
    assert.ok(!auditoriaJson.includes('abcdef123'));
    assert.ok(auditoriaJson.includes('session=[REDACTED]') || auditoriaJson.includes('SESSION_ID: [REDACTED]'));

    const atendimentoImagem = atendimentoRepo.criarAtendimento(9802, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'imagem omitida' });
    const png = criarPngMinimo();
    const caminhoImagem = prepararArquivoAnexo(9802, atendimentoImagem.id, 'historico.png', png);
    const imagem = anexoRepo.salvarMetadadosAnexo(9802, atendimentoImagem.id, {
      nomeOriginal: 'historico.png',
      nomeInterno: 'historico.png',
      mimeType: 'image/png',
      tamanho: png.length,
      caminhoRelativo: caminhoImagem,
    });

    const chamadasImagem = await executarTurnoComContextos({
      empresaId: 9802,
      atendimento: atendimentoImagem,
      contextos: [
        () => ({
          userPrompt: 'tentativa 1 sem imagem',
          imagensSelecionadas: [],
          pdfsVisuaisSelecionados: [],
          manifesto: { ...manifestoBaseSelecionado(), omitidos: [{ id: imagem.id, nome: imagem.nomeOriginal, tipo: 'imagem', status: 'DISPONIVEL_NAO_ENVIADA', score: 90 }] },
          contextoResumo: { tokensEstimadosPrompt: 10 },
        }),
        () => ({
          userPrompt: 'tentativa 2 com imagem',
          imagensSelecionadas: [imagem],
          pdfsVisuaisSelecionados: [],
          manifesto: {
            versao: 1,
            selecionados: [{ id: imagem.id, nome: imagem.nomeOriginal, tipo: 'imagem', status: 'ANALISADA', statusEnvio: 'ENVIADA_COMO_IMAGEM', enviadoComoImagem: true, imagemEnviada: true, motivo: 'evidencia forçada por retry do Quality Gate' }],
            omitidos: [],
          },
          contextoResumo: { tokensEstimadosPrompt: 20 },
        }),
      ],
    });
    const chamadasImagemPrincipais = chamadasImagem.filter(c => !c.body.response_format);
    assert.strictEqual(chamadasImagemPrincipais.length, 2);
    assert.strictEqual(chamadasImagemPrincipais[0].hostname, 'api.groq.com');
    assert.strictEqual(typeof chamadasImagemPrincipais[0].body.messages[1].content, 'string');
    assert.strictEqual(chamadasImagemPrincipais[1].hostname, 'api.openai.com');
    assert.strictEqual(chamadasImagemPrincipais[1].body.messages[1].content[1].type, 'image_url');
    assert.match(chamadasImagemPrincipais[1].body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
    const execImagem = execucaoRepo.listarPorAtendimento(9802, atendimentoImagem.id)[0];
    assert.strictEqual(execImagem.retryDeQualityGate, true);
    assert.strictEqual(execImagem.qualityGate.deveRetry, false);
    assert.ok(execImagem.qualityGate.retryCorretivo.acoes.some(a => a.tipo === 'contexto_reconstruido'));
    assert.ok(execImagem.manifesto.selecionados.some(e => e.id === imagem.id && e.enviadoComoImagem === true));

    const atendimentoPdf = atendimentoRepo.criarAtendimento(9803, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'pdf visual omitido' });
    const pdf = criarPdfBuffer('PDF VISUAL RETRY 2244');
    const caminhoPdf = prepararArquivoAnexo(9803, atendimentoPdf.id, 'visual.pdf', pdf);
    const anexoPdf = anexoRepo.salvarMetadadosAnexo(9803, atendimentoPdf.id, {
      nomeOriginal: 'visual.pdf',
      nomeInterno: 'visual.pdf',
      mimeType: 'application/pdf',
      tamanho: pdf.length,
      caminhoRelativo: caminhoPdf,
      conteudoExtraido: '[PDF detectado]\nsem texto OCR',
      linguagemDetectada: 'pdf',
    });

    const chamadasPdf = await executarTurnoComContextos({
      empresaId: 9803,
      atendimento: atendimentoPdf,
      contextos: [
        () => ({
          userPrompt: 'tentativa 1 sem pdf visual',
          imagensSelecionadas: [],
          pdfsVisuaisSelecionados: [],
          manifesto: { ...manifestoBaseSelecionado(), omitidos: [{ id: anexoPdf.id, nome: anexoPdf.nomeOriginal, tipo: 'anexo', status: 'DISPONIVEL_NAO_ENVIADA', score: 90 }] },
          contextoResumo: { tokensEstimadosPrompt: 10 },
        }),
        () => ({
          userPrompt: 'tentativa 2 com pdf visual',
          imagensSelecionadas: [],
          pdfsVisuaisSelecionados: [{ anexo: anexoPdf, paginas: [1] }],
          manifesto: {
            versao: 1,
            selecionados: [{ id: anexoPdf.id, nome: anexoPdf.nomeOriginal, tipo: 'anexo', status: 'ANALISADA', statusEnvio: 'ENVIADA_COMO_IMAGEM', enviadoComoImagem: true, pdfPaginasEnviadas: [1], motivo: 'evidencia forçada por retry do Quality Gate' }],
            omitidos: [],
          },
          contextoResumo: { tokensEstimadosPrompt: 20 },
        }),
      ],
    });
    const chamadasPdfPrincipais = chamadasPdf.filter(c => !c.body.response_format);
    assert.strictEqual(chamadasPdfPrincipais.length, 2);
    assert.strictEqual(chamadasPdfPrincipais[0].hostname, 'api.groq.com');
    assert.strictEqual(chamadasPdfPrincipais[1].hostname, 'api.openai.com');
    assert.match(chamadasPdfPrincipais[1].body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
    const execPdf = execucaoRepo.listarPorAtendimento(9803, atendimentoPdf.id)[0];
    assert.ok(execPdf.manifesto.selecionados.some(e => e.id === anexoPdf.id && e.enviadoComoImagem === true && e.pdfPaginasEnviadas.includes(1)));
    assert.strictEqual(execPdf.qualityGate.retryCorretivo.executado, true);
  } finally {
    database.fecharDB();
    for (const empresaDir of ['9802', '9803']) {
      try { fs.rmSync(path.join(armazenamento.ANEXOS_DIR, empresaDir), { recursive: true, force: true }); } catch (_) {}
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
    }
  }

  console.log('etapa2-2-fechamento.test.js: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
