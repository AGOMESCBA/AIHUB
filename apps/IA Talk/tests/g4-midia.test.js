'use strict';

// G4 (Antigravity): contrato de backend/lib/midia.
// Mesmos casos que a C3 vai usar; não afrouxar sem combinar com o Claude Code.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const zlib = require('zlib');
const midia = require('../backend/lib/midia');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a4649460001', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from('24000000', 'hex'), Buffer.from('WEBP')]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1');
const OGG = Buffer.from('OggS\x00\x02\x00\x00', 'latin1');
const MP3_ID3 = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1');
const MP3_FRAME = Buffer.from('fffb906400000000', 'hex');
const MP4_VIDEO = Buffer.concat([Buffer.from('00000018', 'hex'), Buffer.from('ftypisom\x00\x00\x02\x00isommp42', 'ascii')]);
const MP4_AUDIO = Buffer.concat([Buffer.from('00000018', 'hex'), Buffer.from('ftypM4A \x00\x00\x00\x00M4A isom', 'ascii')]);
const REGRAS = { mimesAceitos: ['image/png', 'application/pdf'], limiteBytes: 1024 };

// Monta um arquivo ZIP real em memória (com Local Headers + Central Directory + EOCD) para testar OOXML/ZIP.
function criarZipMinimo(entradas, { comprimir = true } = {}) {
  const locais = [];
  const centrais = [];
  let offset = 0;

  for (const { nome, conteudo } of entradas) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const bruto = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8');
    const metodo = comprimir ? 8 : 0;
    const dados = comprimir ? zlib.deflateRawSync(bruto) : bruto;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nomeBuf, dados);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(bruto.length, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, nomeBuf);

    offset += local.length + nomeBuf.length + dados.length;
  }

  const cdBuf = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locais, cdBuf, eocd]);
}

function criarTransporteFalso(handler) {
  const chamadas = [];
  return {
    chamadas,
    request(opts, cb) {
      chamadas.push(opts);
      const req = new EventEmitter();
      req.destroyed = false;
      req.destroy = (err) => {
        req.destroyed = true;
        if (err) process.nextTick(() => req.emit('error', err));
      };
      req.end = () => {
        if (opts.signal?.aborted) {
          return process.nextTick(() => req.emit('error', opts.signal.reason || new Error('aborted')));
        }
        const onAbort = () => req.emit('error', opts.signal.reason || new Error('aborted'));
        opts.signal?.addEventListener('abort', onAbort, { once: true });

        // Executa lookup exatamente como o Node faz para validar o IP preso.
        opts.lookup(opts.hostname, { all: true }, (lookupErr, enderecos) => {
          if (lookupErr) return req.emit('error', lookupErr);
          const res = new EventEmitter();
          res.statusCode = 200;
          res.headers = {};
          res.resume = () => {};
          res.destroy = () => { res.destroyed = true; };
          handler({ opts, enderecos, req, res, cb });
        });
      };
      return req;
    },
  };
}

test('assinatura: módulo exporta as funções congeladas', () => {
  for (const f of ['detectarMime', 'validarArquivo', 'ipBloqueado', 'baixarUrlSegura']) assert.equal(typeof midia[f], 'function', f);
  assert.equal(new midia.ErroMidia('url_invalida', 'x').codigo, 'url_invalida');
});

test('detectarMime: pelo conteúdo, não pela extensão', () => {
  assert.equal(midia.detectarMime(PNG), 'image/png');
  assert.equal(midia.detectarMime(PDF), 'application/pdf');
  assert.equal(midia.detectarMime(Buffer.from('texto qualquer')), null);
});

test('detectarMime: cobre JPEG, WEBP, GIF, OGG, MP3, MP4, M4A, ZIP e OOXML (xlsx, docx, pptx)', () => {
  assert.equal(midia.detectarMime(JPEG), 'image/jpeg');
  assert.equal(midia.detectarMime(WEBP), 'image/webp');
  assert.equal(midia.detectarMime(Buffer.from('GIF87a\x01\x00')), 'image/gif');
  assert.equal(midia.detectarMime(Buffer.from('GIF89a\x01\x00')), 'image/gif');
  assert.equal(midia.detectarMime(OGG), 'audio/ogg');
  assert.equal(midia.detectarMime(MP3_ID3), 'audio/mpeg');
  assert.equal(midia.detectarMime(MP3_FRAME), 'audio/mpeg');
  assert.equal(midia.detectarMime(MP4_VIDEO), 'video/mp4');
  assert.equal(midia.detectarMime(MP4_AUDIO), 'audio/mp4');
  assert.equal(midia.detectarMime(Buffer.alloc(0)), null);
  assert.equal(midia.detectarMime(null), null);

  const zipGenerico = criarZipMinimo([{ nome: 'leia-me.txt', conteudo: 'ola' }]);
  assert.equal(midia.detectarMime(zipGenerico), 'application/zip');

  const xlsx = criarZipMinimo([
    {
      nome: '[Content_Types].xml',
      conteudo: '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    },
    { nome: 'xl/workbook.xml', conteudo: '<workbook/>' },
  ]);
  assert.equal(midia.detectarMime(xlsx), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const docx = criarZipMinimo([
    {
      nome: '[Content_Types].xml',
      conteudo: '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    { nome: 'word/document.xml', conteudo: '<document/>' },
  ], { comprimir: false });
  assert.equal(midia.detectarMime(docx), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const pptx = criarZipMinimo([
    {
      nome: '[Content_Types].xml',
      conteudo: '<Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    },
    { nome: 'ppt/presentation.xml', conteudo: '<presentation/>' },
  ]);
  assert.equal(midia.detectarMime(pptx), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});

test('validarArquivo: aceita, recusa tipo, tamanho, conteúdo trocado e caminho no nome', () => {
  assert.deepEqual(midia.validarArquivo({ nome: 'a.png', mime: 'image/png', dados: PNG }, REGRAS), { ok: true, mime: 'image/png', tamanho: PNG.length, nome: 'a.png' });
  assert.equal(midia.validarArquivo({ nome: 'a.pdf', mime: 'image/png', dados: PDF }, REGRAS).codigo, 'arquivo_invalido');
  assert.equal(midia.validarArquivo({ nome: 'a.gif', mime: 'image/gif', dados: Buffer.from('GIF89a') }, REGRAS).codigo, 'tipo_nao_suportado');
  assert.equal(midia.validarArquivo({ nome: 'g.pdf', mime: 'application/pdf', dados: Buffer.concat([PDF, Buffer.alloc(2048)]) }, REGRAS).codigo, 'arquivo_grande');
  assert.equal(midia.validarArquivo({ nome: 'v.png', mime: 'image/png', dados: Buffer.alloc(0) }, REGRAS).codigo, 'arquivo_invalido');
  assert.equal(midia.validarArquivo({ nome: '..\\..\\x.png', mime: 'image/png', dados: PNG }, REGRAS).nome, 'x.png');
});

test('validarArquivo: texto/CSV válidos vs binário disfarçado e decodificarBase64Estrito', () => {
  const regrasTexto = { mimesAceitos: ['text/plain', 'text/csv'], limiteBytes: 1024 };
  assert.deepEqual(
    midia.validarArquivo({ nome: '/tmp/../dados.csv', mime: 'text/csv; charset=utf-8', dados: Buffer.from('a;b\n1;2\n', 'utf8') }, regrasTexto),
    { ok: true, mime: 'text/csv', tamanho: 8, nome: 'dados.csv' }
  );
  // Binário com byte nulo disfarçado de text/plain é recusado.
  assert.equal(
    midia.validarArquivo({ nome: 'falso.txt', mime: 'text/plain', dados: Buffer.from([0x41, 0x00, 0x42]) }, regrasTexto).codigo,
    'arquivo_invalido'
  );
  // PDF disfarçado de text/plain é recusado pelo magic byte.
  assert.equal(
    midia.validarArquivo({ nome: 'falso.txt', mime: 'text/plain', dados: PDF }, regrasTexto).codigo,
    'arquivo_invalido'
  );
  // Texto válido, mas text/plain não aceito no canal.
  assert.equal(
    midia.validarArquivo({ nome: 'nota.txt', mime: 'text/plain', dados: Buffer.from('ola') }, REGRAS).codigo,
    'tipo_nao_suportado'
  );

  // Base64 estrito
  const b64 = PNG.toString('base64');
  assert.deepEqual(midia.decodificarBase64Estrito(b64, 1024), PNG);
  assert.throws(() => midia.decodificarBase64Estrito('nao-e-base64!!!', 1024), (e) => e.codigo === 'arquivo_invalido');
  assert.throws(() => midia.decodificarBase64Estrito(b64, 4), (e) => e.codigo === 'arquivo_grande');
});

test('ipBloqueado: privados, loopback, link-local, CGNAT, IPv6 e mapeados', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(midia.ipBloqueado(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '200.160.2.3', '2001:4860:4860::8888']) assert.equal(midia.ipBloqueado(ip), false, ip);
});

test('ipBloqueado: formas expandidas, hex mapeado, zone ID, broadcast e entradas inválidas', () => {
  for (const ip of [
    '::',
    '0:0:0:0:0:0:0:1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:100.64.0.1',
    'fc00::1',
    'ff02::1',
    'fe80::1%eth0',
    '[::1]',
    '255.255.255.255',
    '198.18.0.1',
    '2001:db8::1',
    '',
    'nao-e-ip',
  ]) {
    assert.equal(midia.ipBloqueado(ip), true, ip);
  }
  for (const ip of ['1.1.1.1', '2606:4700:4700::1111', '[2001:4860:4860::8888]']) {
    assert.equal(midia.ipBloqueado(ip), false, ip);
  }
});

test('baixarUrlSegura: só https e nunca destino interno', async () => {
  await assert.rejects(midia.baixarUrlSegura('http://exemplo.com/a.png'), (e) => e.codigo === 'url_invalida');
  await assert.rejects(midia.baixarUrlSegura('file:///C:/Windows/win.ini'), (e) => e.codigo === 'url_invalida');
  await assert.rejects(midia.baixarUrlSegura('https://interno.exemplo/a.png', { resolverDns: async () => ['10.0.0.5'] }), (e) => e.codigo === 'destino_bloqueado');
  await assert.rejects(midia.baixarUrlSegura('https://misto.exemplo/a.png', { resolverDns: async () => ['8.8.8.8', '127.0.0.1'] }), (e) => e.codigo === 'destino_bloqueado');
});

test('baixarUrlSegura: download seguro, redirecionamento validado, limite de tamanho e timeout', async () => {
  // Credenciais embutidas e localhost bloqueados antes de qualquer conexão.
  await assert.rejects(midia.baixarUrlSegura('https://user:pass@exemplo.com/a.png'), (e) => e.codigo === 'url_invalida');
  await assert.rejects(midia.baixarUrlSegura('https://localhost/a.png'), (e) => e.codigo === 'destino_bloqueado');

  // 1) Download válido: usa IP resolvido no lookup, ignora Content-Type errado e limpa nome.
  const transporteOk = criarTransporteFalso(({ opts, enderecos, res, cb }) => {
    assert.deepEqual(enderecos, [{ address: '93.184.216.34', family: 4 }]);
    assert.equal(opts.headers.Cookie, undefined);
    assert.equal(opts.headers.Authorization, undefined);
    res.statusCode = 200;
    res.headers = {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="../../relatorio.pdf"',
    };
    cb(res);
    process.nextTick(() => {
      res.emit('data', PDF);
      res.emit('end');
    });
  });

  const baixado = await midia.baixarUrlSegura('https://cdn.exemplo.com/x', {
    resolverDns: async () => ['93.184.216.34'],
    _transporte: transporteOk,
  });
  assert.deepEqual(baixado, { dados: PDF, mime: 'application/pdf', nome: 'relatorio.pdf' });

  // 2) Redirecionamento para IP interno é barrado no segundo salto.
  const transporteRedirInterno = criarTransporteFalso(({ res, cb }) => {
    res.statusCode = 302;
    res.headers = { location: 'https://metadata.interno/secret' };
    cb(res);
  });
  await assert.rejects(
    midia.baixarUrlSegura('https://cdn.exemplo.com/redir', {
      resolverDns: async (host) => (host === 'cdn.exemplo.com' ? ['93.184.216.34'] : ['169.254.169.254']),
      _transporte: transporteRedirInterno,
    }),
    (e) => e.codigo === 'destino_bloqueado'
  );

  // 3) Excesso de redirecionamentos.
  const transporteLoop = criarTransporteFalso(({ res, cb }) => {
    res.statusCode = 302;
    res.headers = { location: 'https://cdn.exemplo.com/loop' };
    cb(res);
  });
  await assert.rejects(
    midia.baixarUrlSegura('https://cdn.exemplo.com/loop', {
      maxRedirecionamentos: 2,
      resolverDns: async () => ['93.184.216.34'],
      _transporte: transporteLoop,
    }),
    (e) => e.codigo === 'falha_download'
  );

  // 4) Corte imediato ao ultrapassar limiteBytes no streaming.
  const transporteGrande = criarTransporteFalso(({ res, cb }) => {
    res.statusCode = 200;
    res.headers = { 'content-type': 'image/png' };
    cb(res);
    process.nextTick(() => {
      res.emit('data', PNG);
      res.emit('data', Buffer.alloc(200));
    });
  });
  await assert.rejects(
    midia.baixarUrlSegura('https://cdn.exemplo.com/grande.png', {
      limiteBytes: 100,
      resolverDns: async () => ['93.184.216.34'],
      _transporte: transporteGrande,
    }),
    (e) => e.codigo === 'arquivo_grande'
  );

  // 5) Timeout total via AbortController.
  const transporteLento = criarTransporteFalso(() => {
    // Nunca responde: deve disparar tempo_esgotado.
  });
  await assert.rejects(
    midia.baixarUrlSegura('https://cdn.exemplo.com/lento.png', {
      tempoMs: 40,
      resolverDns: async () => ['93.184.216.34'],
      _transporte: transporteLento,
    }),
    (e) => e.codigo === 'tempo_esgotado'
  );
});
