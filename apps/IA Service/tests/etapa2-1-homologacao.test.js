// Testes da Etapa 2.1: SSRF, redaction, PDF visual, imagem implicita e retry.

const assert = require('assert');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const safeFetch = require('../backend/services/safe-web-fetch-service');
const { redigirValor } = require('../backend/services/redaction-service');
const pdfVisual = require('../backend/services/pdf-visual-service');
const qualityGate = require('../backend/services/quality-gate-service');
const { extrairConteudo } = require('../backend/services/extracao-conteudo');
const aiProviderClient = require('../backend/services/ai-provider-client');
const database = require('../backend/database');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');

const FASES_OBRIGATORIAS = new Set([
  'payload_multimodal',
  'provider_sem_vision',
  'quality_gate_retry',
  'auditoria_persistida',
]);
const fasesExecutadas = new Set();

function marcarFase(nome) {
  fasesExecutadas.add(nome);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout em ${label} apos ${ms}ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fakeResponse({ statusCode = 200, headers = { 'content-type': 'text/html' }, body = '<html>ok</html>' } = {}) {
  const res = new Readable({ read() {} });
  res.statusCode = statusCode;
  res.headers = headers;
  res.resume = () => {};
  process.nextTick(() => {
    res.emit('data', Buffer.from(body));
    res.emit('end');
  });
  return res;
}

async function withMocks({ lookup, request }, fn) {
  const oldLookup = dns.lookup;
  const oldRequest = http.request;
  dns.lookup = lookup || oldLookup;
  http.request = request || oldRequest;
  try { return await fn(); } finally { dns.lookup = oldLookup; http.request = oldRequest; }
}

function mockRequestFactory(responses) {
  return (options, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = err => process.nextTick(() => req.emit('error', err));
    req.end = () => {
      const key = `${options.hostname}${options.path}`;
      const response = responses[key] || responses.default;
      process.nextTick(() => cb(fakeResponse(response)));
    };
    return req;
  };
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

async function capturarPayloadOpenAI(fn) {
  const oldRequest = https.request;
  let body = '';
  https.request = (options, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = err => process.nextTick(() => req.emit('error', err));
    req.write = chunk => { body += chunk; };
    req.end = () => {
      const resposta = JSON.stringify({
        choices: [{ message: { content: 'Resposta com evidencias especificas e stack trace linha 10.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      process.nextTick(() => {
        const res = new Readable({ read() {} });
        res.statusCode = 200;
        res.headers = { 'content-type': 'application/json' };
        res.resume = () => {};
        cb(res);
        process.nextTick(() => {
          res.emit('data', Buffer.from(resposta));
          res.emit('end');
        });
      });
    };
    return req;
  };
  try {
    await fn();
    return JSON.parse(body);
  } finally {
    https.request = oldRequest;
  }
}

async function assertBloqueia(url, lookupResult) {
  await withMocks({
    lookup: async () => Array.isArray(lookupResult) ? lookupResult : [{ address: lookupResult, family: lookupResult.includes(':') ? 6 : 4 }],
  }, async () => {
    await assert.rejects(() => safeFetch.fetchTextoSeguro(url), /bloqueado|Protocolo nao permitido|local/i);
  });
}

async function main() {
  await assertBloqueia('http://localhost/x', '127.0.0.1');
  await assertBloqueia('http://127.0.0.1/x', '127.0.0.1');
  await assertBloqueia('http://127.2.3.4/x', '127.2.3.4');
  await assertBloqueia('http://10.1.2.3/x', '10.1.2.3');
  await assertBloqueia('http://172.16.0.1/x', '172.16.0.1');
  await assertBloqueia('http://172.31.255.1/x', '172.31.255.1');
  await assertBloqueia('http://192.168.1.9/x', '192.168.1.9');
  await assertBloqueia('http://169.254.169.254/latest', '169.254.169.254');
  await assertBloqueia('http://[::1]/x', '::1');
  await assertBloqueia('http://[fe80::1]/x', 'fe80::1');
  await assertBloqueia('http://[fd00::1]/x', 'fd00::1');
  await assert.rejects(() => safeFetch.fetchTextoSeguro('file:///c:/secret.txt'), /Protocolo nao permitido/);

  await withMocks({
    lookup: async host => host === 'public.test' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }],
    request: mockRequestFactory({
      'public.test/': { statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>conteudo tecnico</body></html>' },
      default: { statusCode: 200, body: 'ok' },
    }),
  }, async () => {
    const ok = await safeFetch.fetchTextoSeguro('http://public.test/');
    assert.match(ok.raw, /conteudo tecnico/);
  });

  await withMocks({
    lookup: async host => host === 'public.test' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }],
    request: mockRequestFactory({
      'public.test/': { statusCode: 302, headers: { location: 'http://127.0.0.1/private', 'content-type': 'text/html' }, body: '' },
      default: { statusCode: 200, body: 'ok' },
    }),
  }, async () => {
    await assert.rejects(() => safeFetch.fetchTextoSeguro('http://public.test/'), /bloqueado/);
  });

  await withMocks({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: mockRequestFactory({ default: { statusCode: 200, headers: { 'content-type': 'application/octet-stream' }, body: 'bin' } }),
  }, async () => {
    await assert.rejects(() => safeFetch.fetchTextoSeguro('http://public.test/bin'), /Content-Type nao permitido/);
  });

  await withMocks({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: mockRequestFactory({ default: { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(5000) } }),
  }, async () => {
    await assert.rejects(() => safeFetch.fetchTextoSeguro('http://public.test/big', { maxBytes: 100 }), /limite/);
  });

  const redigido = redigirValor({
    auth: 'Bearer abcdefghijk',
    url: 'https://exemplo.com?a=1&token=abcdef123456',
    erro: 'Authorization: Bearer zzzzzzzzzz password=segredo123',
    cookie: 'sid=abc',
  });
  assert.deepStrictEqual(redigido.auth, '[REDACTED]');
  assert.ok(!JSON.stringify(redigido).includes('abcdef123456'));
  assert.ok(!JSON.stringify(redigido).includes('segredo123'));

  assert.strictEqual(pdfVisual.detectarNecessidadeVisualPdf({ conteudoExtraido: '[PDF detectado]', pergunta: 'analise o pdf' }), true);
  assert.deepStrictEqual(pdfVisual.selecionarPaginasPdf({ conteudoExtraido: 'Pagina: 2\ntexto', pergunta: 'ver pagina 2' }), [2]);
  assert.deepStrictEqual(pdfVisual.selecionarPaginasPdf({ conteudoExtraido: 'sem paginas', pergunta: 'screenshot' }, ), [1]);
  assert.strictEqual(pdfVisual.detectarNecessidadeVisualPdf({ conteudoExtraido: 'Texto longo '.repeat(40), pergunta: 'qual o texto?' }), false);
  const pdfTextual = await extrairConteudo({ buffer: criarPdfBuffer('Manual tecnico PDF-777 com conteudo textual suficiente para fallback seguro'), nomeOriginal: 'manual.pdf', mimeDeclarado: 'application/pdf' });
  assert.strictEqual(pdfTextual.linguagemDetectada, 'pdf');
  assert.match(pdfTextual.conteudoExtraido, /PDF-777/);
  const pdfInvalido = await extrairConteudo({ buffer: Buffer.from('%PDF-1.4\nlixo-sem-xref'), nomeOriginal: 'quebrado.pdf', mimeDeclarado: 'application/pdf' });
  assert.match(pdfInvalido.conteudoExtraido, /nao foi possivel extrair|PDF detectado/i);
  assert.ok(!/PDF-777|segredo/i.test(pdfInvalido.conteudoExtraido));
  assert.deepStrictEqual(pdfVisual.selecionarPaginasPdf({ conteudoExtraido: 'Pagina: 1 texto\nPagina: 2 screenshot\nPagina: 3 texto', pergunta: 'screenshot pagina 2' }), [2, 1, 3].slice(0, pdfVisual.LIMITES.maxPaginas));
  assert.strictEqual(pdfVisual.detectarNecessidadeVisualPdf({ conteudoExtraido: '[PDF detectado]\nsem texto OCR', pergunta: 'o erro da tela aparece?' }), true);
  const pdfRaster = await pdfVisual.rasterizarPdfPaginas(criarPdfBuffer('PDF visual teste'), [1], { maxPaginas: 1, timeoutMs: 15000 });
  assert.ifError(pdfRaster.erro);
  assert.strictEqual(pdfRaster.imagens.length, 1);
  assert.strictEqual(pdfRaster.imagens[0].mimeType, 'image/png');
  assert.ok(pdfRaster.imagens[0].base64.length > 100);

  const payload = await capturarPayloadOpenAI(async () => {
    await aiProviderClient.chamarProvedor(
      'openai',
      'sk-test',
      'sistema',
      'usuario',
      [{ mimeType: 'image/png', base64: Buffer.from('img').toString('base64') }],
      { model: 'gpt-4o-mini', maxTokens: 100 }
    );
  });
  assert.strictEqual(payload.messages[1].content[1].type, 'image_url');
  assert.match(payload.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  marcarFase('payload_multimodal');
  await assert.rejects(
    () => aiProviderClient.chamarProvedor('groq', 'key', 'sys', 'user', [{ mimeType: 'image/png', base64: 'abc' }]),
    /não suporta|n.*o suporta/i
  );
  marcarFase('provider_sem_vision');

  const gate = qualityGate.avaliarResposta({
    textoResposta: 'Recomendo verificar os logs e envie mais informações.',
    manifesto: { selecionados: [{ tipo: 'anexo', status: 'ANALISADA' }], omitidos: [{ id: 'a1', score: 90, status: 'DISPONIVEL_NAO_ENVIADA' }] },
    pesquisa: { configurado: false },
    pergunta: 'pesquise documentação e analise o anexo',
  });
  assert.strictEqual(gate.deveRetry, true);
  assert.ok(gate.falhas.some(f => f.codigo === 'CRITICAL_EVIDENCE_OMITTED' && f.evidenciaId === 'a1'));
  const gateRetry = qualityGate.avaliarResposta({ textoResposta: 'curta', manifesto: { selecionados: [{ tipo: 'anexo', status: 'ANALISADA' }], omitidos: [] }, pergunta: 'anexo', houveRetry: true });
  assert.strictEqual(gateRetry.deveRetry, false);
  marcarFase('quality_gate_retry');

  const dbTmpPath = path.join(os.tmpdir(), `ia-service-etapa21-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  database.inicializarDB(dbTmpPath);
  try {
    const atendimentoA = atendimentoRepo.criarAtendimento(9701, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'A' });
    atendimentoRepo.criarAtendimento(9702, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'B' });
    execucaoRepo.salvarExecucao(9701, {
      atendimentoId: atendimentoA.id,
      provider: 'openai',
      model: 'gpt-4o-mini',
      pesquisa: { paginasLidas: [{ url: 'https://docs.example/?token=abc123456', trecho: 'Authorization: Bearer secret123456' }] },
      manifesto: { selecionados: [{ id: 'a', tipo: 'anexo', tamanhoOriginal: 10, status: 'ANALISADA', textoEnviado: true }] },
      qualityGate: { falhas: [{ codigo: 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE' }] },
      tentativas: [{ provider: 'openai', erro: 'password=senha123456' }],
    });
    const execsA = execucaoRepo.listarPorAtendimento(9701, atendimentoA.id);
    assert.strictEqual(execsA.length, 1);
    assert.strictEqual(execsA[0].provider, 'openai');
    const serializado = JSON.stringify(execsA[0]);
    assert.ok(!serializado.includes('abc123456'));
    assert.ok(!serializado.includes('secret123456'));
    assert.ok(!serializado.includes('senha123456'));
    assert.deepStrictEqual(execucaoRepo.listarPorAtendimento(9702, atendimentoA.id), []);
    marcarFase('auditoria_persistida');
  } finally {
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
    }
  }

  for (const fase of FASES_OBRIGATORIAS) {
    assert.ok(fasesExecutadas.has(fase), `fase obrigatoria nao executada: ${fase}`);
  }
  console.log('etapa2-1-homologacao.test.js: ok');
}

withTimeout(main(), 60000, 'etapa2-1-homologacao.test.js').catch(err => {
  console.error(err);
  process.exit(1);
});
