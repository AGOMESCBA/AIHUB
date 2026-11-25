'use strict';

// G4 (Antigravity) — validação de arquivos e download seguro de mídia por URL.
// Assinaturas CONGELADAS na C0: C3 (envio) chama exatamente estas funções.
// Funções puras/isoladas: não acessam banco, sessão nem nada fora desta pasta.
// Testes de contrato: apps/IA Talk/tests/g4-midia.test.js.
//
// Referência de padrão SSRF (lookup fixo com options.all + AbortController de
// prazo total + validação de redirecionamentos):
// apps/IA Service/backend/services/safe-web-fetch-service.js (somente leitura).

const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const zlib = require('zlib');

const LIMITE_PADRAO_BYTES = 16 * 1024 * 1024;
const TEMPO_PADRAO_MS = 15000;
const MAX_REDIRECIONAMENTOS_PADRAO = 3;
const MAX_CONTENT_TYPES_XML_BYTES = 256 * 1024;
const MAX_ENTRADAS_ZIP = 4096;

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const MIMES_TEXTO_SEM_ASSINATURA = new Set(['text/plain', 'text/csv']);

const FAIIXAS_IPV4_BLOQUEADAS = [
  ['0.0.0.0', 8],       // Rede atual / RFC 1122
  ['10.0.0.0', 8],      // Privado RFC 1918
  ['100.64.0.0', 10],   // CGNAT RFC 6598
  ['127.0.0.0', 8],     // Loopback
  ['169.254.0.0', 16],  // Link-local / metadados de nuvem
  ['172.16.0.0', 12],   // Privado RFC 1918
  ['192.0.0.0', 24],    // Atribuições de protocolo IETF
  ['192.0.2.0', 24],    // TEST-NET-1
  ['192.168.0.0', 16],  // Privado RFC 1918
  ['198.18.0.0', 15],   // Benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24],  // TEST-NET-3
  ['224.0.0.0', 4],     // Multicast
  ['240.0.0.0', 4],     // Reservado + broadcast 255.255.255.255
];

const BRANDS_AUDIO_MP4 = new Set(['M4A ', 'M4B ', 'M4P ']);
const BRANDS_VIDEO_MP4 = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'avc1', 'av01', 'M4V ', 'MSNV',
  'dash', 'mp71', 'f4v ', 'qt  ', '3gp4', '3gp5',
]);

class ErroMidia extends Error {
  /**
   * @param {'url_invalida'|'destino_bloqueado'|'tempo_esgotado'|'arquivo_grande'|'falha_download'|'tipo_nao_suportado'|'arquivo_invalido'} codigo
   * @param {string} mensagem texto em pt-BR para a pessoa ler
   */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroMidia';
    this.codigo = codigo;
  }
}

function _paraBuffer(dados) {
  if (Buffer.isBuffer(dados)) return dados;
  if (dados instanceof Uint8Array) return Buffer.from(dados.buffer, dados.byteOffset, dados.byteLength);
  return null;
}

function _comecaCom(buf, bytes) {
  if (buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

function _detectarOoxmlPorXml(xmlTexto) {
  if (!xmlTexto) return null;
  if (xmlTexto.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) return MIME_XLSX;
  if (xmlTexto.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) return MIME_DOCX;
  if (xmlTexto.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')) return MIME_PPTX;
  return null;
}

function _detectarOoxmlPorNomes(nomes) {
  let temWord = false;
  let temXl = false;
  let temPpt = false;
  for (const nome of nomes) {
    if (nome === 'xl/workbook.xml' || nome.startsWith('xl/')) temXl = true;
    else if (nome === 'word/document.xml' || nome.startsWith('word/')) temWord = true;
    else if (nome === 'ppt/presentation.xml' || nome.startsWith('ppt/')) temPpt = true;
  }
  if (temXl) return MIME_XLSX;
  if (temWord) return MIME_DOCX;
  if (temPpt) return MIME_PPTX;
  return null;
}

function _extrairEntradaZip(buf, offsetCabecalhoLocal, metodo, tamComprimido) {
  if (offsetCabecalhoLocal < 0 || offsetCabecalhoLocal + 30 > buf.length) return null;
  if (buf.readUInt32LE(offsetCabecalhoLocal) !== 0x04034b50) return null;

  const nomeLen = buf.readUInt16LE(offsetCabecalhoLocal + 26);
  const extraLen = buf.readUInt16LE(offsetCabecalhoLocal + 28);
  const inicioDados = offsetCabecalhoLocal + 30 + nomeLen + extraLen;
  const fimDados = inicioDados + tamComprimido;
  if (tamComprimido <= 0 || fimDados > buf.length) return null;

  const fatia = buf.subarray(inicioDados, fimDados);
  try {
    if (metodo === 0) {
      if (fatia.length > MAX_CONTENT_TYPES_XML_BYTES) return null;
      return fatia.toString('utf8');
    }
    if (metodo === 8) {
      const descomprimido = zlib.inflateRawSync(fatia, { maxOutputLength: MAX_CONTENT_TYPES_XML_BYTES });
      return descomprimido.toString('utf8');
    }
  } catch (_) {
    return null;
  }
  return null;
}

function _detectarTipoZip(buf) {
  const nomes = new Set();
  let xmlContentTypes = null;

  // 1) Tenta ler o Diretório Central pelo registro EOCD (PK\x05\x06) no fim do arquivo.
  const inicioBuscaEocd = Math.max(0, buf.length - 65557);
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= inicioBuscaEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }

  if (eocdPos >= 0) {
    const totalEntradas = Math.min(buf.readUInt16LE(eocdPos + 10), MAX_ENTRADAS_ZIP);
    const cdSize = buf.readUInt32LE(eocdPos + 12);
    const cdOffset = buf.readUInt32LE(eocdPos + 16);
    const cdFim = Math.min(buf.length, cdOffset + cdSize);
    let pos = cdOffset;
    let lidas = 0;

    while (lidas < totalEntradas && pos + 46 <= cdFim) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;
      const metodo = buf.readUInt16LE(pos + 10);
      const tamComprimido = buf.readUInt32LE(pos + 20);
      const nomeLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const comentarioLen = buf.readUInt16LE(pos + 32);
      const offsetLocal = buf.readUInt32LE(pos + 42);
      const fimNome = pos + 46 + nomeLen;
      if (fimNome > buf.length) break;

      const nome = buf.subarray(pos + 46, fimNome).toString('utf8').replace(/\\/g, '/');
      nomes.add(nome);

      if (nome === '[Content_Types].xml' && !xmlContentTypes) {
        xmlContentTypes = _extrairEntradaZip(buf, offsetLocal, metodo, tamComprimido);
      }

      pos = fimNome + extraLen + comentarioLen;
      lidas++;
    }
  }

  // 2) Fallback: percorre cabeçalhos locais (PK\x03\x04) para ZIPs parciais/minimalistas.
  if (nomes.size === 0) {
    let pos = 0;
    let lidas = 0;
    while (lidas < MAX_ENTRADAS_ZIP && pos + 30 <= buf.length) {
      if (buf.readUInt32LE(pos) !== 0x04034b50) break;
      const flags = buf.readUInt16LE(pos + 6);
      const metodo = buf.readUInt16LE(pos + 8);
      const tamComprimido = buf.readUInt32LE(pos + 18);
      const nomeLen = buf.readUInt16LE(pos + 26);
      const extraLen = buf.readUInt16LE(pos + 28);
      const fimNome = pos + 30 + nomeLen;
      if (fimNome > buf.length) break;

      const nome = buf.subarray(pos + 30, fimNome).toString('utf8').replace(/\\/g, '/');
      nomes.add(nome);

      if (nome === '[Content_Types].xml' && !xmlContentTypes && (flags & 0x08) === 0) {
        xmlContentTypes = _extrairEntradaZip(buf, pos, metodo, tamComprimido);
      }

      if ((flags & 0x08) !== 0 && tamComprimido === 0) break;
      pos = fimNome + extraLen + tamComprimido;
      lidas++;
    }
  }

  return _detectarOoxmlPorXml(xmlContentTypes) || _detectarOoxmlPorNomes(nomes) || 'application/zip';
}

function _detectarTipoMp4(buf) {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return null;

  const major = buf.toString('ascii', 8, 12);
  if (BRANDS_AUDIO_MP4.has(major)) return 'audio/mp4';

  const boxSize = buf.readUInt32BE(0);
  const limiteBox = Math.min(buf.length, boxSize >= 12 ? boxSize : 64, 128);
  const compativeis = new Set();
  for (let i = 16; i + 4 <= limiteBox; i += 4) {
    compativeis.add(buf.toString('ascii', i, i + 4));
  }

  const temAudio = [...BRANDS_AUDIO_MP4].some((b) => compativeis.has(b));
  const temVideoExplicito = major === 'M4V ' || major === 'avc1' || major === 'qt  '
    || compativeis.has('M4V ') || compativeis.has('avc1');
  if (temAudio && !temVideoExplicito) return 'audio/mp4';

  if (BRANDS_VIDEO_MP4.has(major) || [...BRANDS_VIDEO_MP4].some((b) => compativeis.has(b))) {
    return 'video/mp4';
  }
  return 'video/mp4';
}

function _pareceTextoValido(buf) {
  // Recusa bytes nulos e bytes de controle não imprimíveis (mantém TAB, LF, VT, FF, CR).
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x00) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0b && b !== 0x0c && b !== 0x0d) {
      return false;
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch (_) {
    return false;
  }
}

function _sanitizarNome(nomeBruto) {
  const texto = String(nomeBruto || '').replace(/\\/g, '/').trim();
  const partes = texto.split('/').filter((p) => p && p !== '.' && p !== '..');
  let base = partes.length ? partes[partes.length - 1] : '';
  // Remove caracteres de controle e sequências residuais de travessia.
  base = base.replace(/[\x00-\x1f\x7f]/g, '').replace(/\.\.+/g, '.').trim();
  if (!base || base === '.' || base === '..') return 'arquivo';
  return base.slice(0, 255);
}

/**
 * Descobre o tipo real pelo conteúdo (assinatura de bytes), nunca pela
 * extensão nem pelo mime informado. Cobrir no mínimo: PNG, JPEG, WEBP, GIF,
 * PDF, ZIP/OOXML (xlsx, docx, pptx), OGG, MP3, MP4.
 * @param {Buffer} dados
 * @returns {string|null} mime detectado ou null se desconhecido
 */
function detectarMime(dados) {
  const buf = _paraBuffer(dados);
  if (!buf || buf.length === 0) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (_comecaCom(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // JPEG: FF D8 FF
  if (_comecaCom(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // GIF: GIF87a ou GIF89a
  if (buf.length >= 6) {
    const gif = buf.toString('ascii', 0, 6);
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  }

  // WEBP: RIFF....WEBP
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // PDF: %PDF-
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';

  // OGG: OggS
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';

  // ZIP / OOXML (xlsx, docx, pptx)
  if (_comecaCom(buf, [0x50, 0x4b, 0x03, 0x04])
    || _comecaCom(buf, [0x50, 0x4b, 0x05, 0x06])
    || _comecaCom(buf, [0x50, 0x4b, 0x07, 0x08])) {
    return _detectarTipoZip(buf);
  }

  // MP4 / M4A (ISO BMFF)
  const mp4 = _detectarTipoMp4(buf);
  if (mp4) return mp4;

  // MP3: cabeçalho ID3v2 ou frame sync MPEG Layer III
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (buf.length >= 2
    && buf[0] === 0xff
    && (buf[1] & 0xe0) === 0xe0
    && (buf[1] & 0x18) !== 0x08
    && (buf[1] & 0x06) === 0x02) {
    return 'audio/mpeg';
  }

  return null;
}

/**
 * Decodifica Base64 em modo estrito (recusa caractere inválido e verifica o
 * tamanho decodificado contra limiteBytes antes de alocar o Buffer completo).
 * Utilitário para a etapa C3 (API v1).
 * @param {string} base64
 * @param {number} [limiteBytes]
 * @returns {Buffer}
 * @throws {ErroMidia}
 */
function decodificarBase64Estrito(base64, limiteBytes = LIMITE_PADRAO_BYTES) {
  if (typeof base64 !== 'string') {
    throw new ErroMidia('arquivo_invalido', 'Conteúdo em base64 inválido.');
  }
  const limpo = base64.replace(/[\r\n]/g, '').trim();
  if (!limpo || limpo.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) {
    throw new ErroMidia('arquivo_invalido', 'Conteúdo em base64 malformado.');
  }
  const padding = limpo.endsWith('==') ? 2 : (limpo.endsWith('=') ? 1 : 0);
  const tamanhoEstimado = (limpo.length / 4) * 3 - padding;
  if (tamanhoEstimado <= 0) {
    throw new ErroMidia('arquivo_invalido', 'Arquivo vazio.');
  }
  if (typeof limiteBytes === 'number' && limiteBytes > 0 && tamanhoEstimado > limiteBytes) {
    throw new ErroMidia('arquivo_grande', `Arquivo excede o limite de ${limiteBytes} bytes.`);
  }
  const buf = Buffer.from(limpo, 'base64');
  // Re-encoda para garantir modo estrito (bits de padding não nulos).
  if (buf.toString('base64') !== limpo) {
    throw new ErroMidia('arquivo_invalido', 'Conteúdo em base64 inválido.');
  }
  return buf;
}

/**
 * Valida um arquivo antes de enviar.
 * @param {{ nome: string, mime: string, dados: Buffer }} arquivo
 * @param {{ mimesAceitos: string[], limiteBytes: number }} regras  (vêm das capacidades do canal)
 * @returns {{ ok: true, mime: string, tamanho: number, nome: string }
 *          | { ok: false, codigo: 'arquivo_invalido'|'tipo_nao_suportado'|'arquivo_grande', mensagem: string }}
 * Regras: nome sem caminho (remover / \ ..), mime informado deve bater com o
 * detectado (senão 'arquivo_invalido'), vazio = 'arquivo_invalido'.
 */
function validarArquivo(arquivo, regras) {
  if (!arquivo || typeof arquivo !== 'object') {
    return { ok: false, codigo: 'arquivo_invalido', mensagem: 'Arquivo não informado.' };
  }
  const dados = _paraBuffer(arquivo.dados);
  if (!dados || dados.length === 0) {
    return { ok: false, codigo: 'arquivo_invalido', mensagem: 'Arquivo vazio ou inválido.' };
  }

  const limiteBytes = Number(regras?.limiteBytes || 0);
  if (limiteBytes > 0 && dados.length > limiteBytes) {
    return {
      ok: false,
      codigo: 'arquivo_grande',
      mensagem: `Arquivo excede o limite permitido de ${limiteBytes} bytes.`,
    };
  }

  const mimeInformado = String(arquivo.mime || '').split(';')[0].trim().toLowerCase();
  if (!mimeInformado) {
    return { ok: false, codigo: 'arquivo_invalido', mensagem: 'Tipo MIME não informado.' };
  }

  const aceitos = new Set(
    Array.isArray(regras?.mimesAceitos)
      ? regras.mimesAceitos.map((m) => String(m || '').split(';')[0].trim().toLowerCase()).filter(Boolean)
      : []
  );

  const nome = _sanitizarNome(arquivo.nome);
  const mimeReal = detectarMime(dados);

  if (mimeReal) {
    if (mimeReal !== mimeInformado) {
      return {
        ok: false,
        codigo: 'arquivo_invalido',
        mensagem: `Conteúdo do arquivo (${mimeReal}) não corresponde ao tipo informado (${mimeInformado}).`,
      };
    }
    if (!aceitos.has(mimeReal)) {
      return {
        ok: false,
        codigo: 'tipo_nao_suportado',
        mensagem: `Tipo de arquivo não suportado por este canal (${mimeReal}).`,
      };
    }
    return { ok: true, mime: mimeReal, tamanho: dados.length, nome };
  }

  if (MIMES_TEXTO_SEM_ASSINATURA.has(mimeInformado)) {
    if (!_pareceTextoValido(dados)) {
      return {
        ok: false,
        codigo: 'arquivo_invalido',
        mensagem: 'Conteúdo não é um texto UTF-8 válido.',
      };
    }
    if (!aceitos.has(mimeInformado)) {
      return {
        ok: false,
        codigo: 'tipo_nao_suportado',
        mensagem: `Tipo de arquivo não suportado por este canal (${mimeInformado}).`,
      };
    }
    return { ok: true, mime: mimeInformado, tamanho: dados.length, nome };
  }

  return {
    ok: false,
    codigo: 'arquivo_invalido',
    mensagem: 'Não foi possível comprovar o tipo real do arquivo pelo conteúdo.',
  };
}

function _ipv4ParaInt(ip) {
  return ip.split('.').reduce((acc, parte) => (acc << 8) + Number(parte), 0) >>> 0;
}

function _ipv4NaFaixa(ipInt, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (_ipv4ParaInt(base) & mask);
}

function _ipv4IntBloqueado(ipInt) {
  return FAIIXAS_IPV4_BLOQUEADAS.some(([base, bits]) => _ipv4NaFaixa(ipInt, base, bits));
}

function _parsearIpv6(ip) {
  let texto = ip.toLowerCase();
  const idxZona = texto.indexOf('%');
  if (idxZona >= 0) texto = texto.slice(0, idxZona);

  // Converte eventual IPv4 embutido no final (ex.: ::ffff:127.0.0.1) em 2 hextets.
  const ultimoDoisPontos = texto.lastIndexOf(':');
  if (ultimoDoisPontos >= 0 && texto.slice(ultimoDoisPontos + 1).includes('.')) {
    const parteV4 = texto.slice(ultimoDoisPontos + 1);
    if (net.isIPv4(parteV4) === false) return null;
    const octetos = parteV4.split('.').map(Number);
    const h1 = ((octetos[0] << 8) | octetos[1]).toString(16);
    const h2 = ((octetos[2] << 8) | octetos[3]).toString(16);
    texto = `${texto.slice(0, ultimoDoisPontos)}:${h1}:${h2}`;
  }

  const lados = texto.split('::');
  if (lados.length > 2) return null;

  const esquerda = lados[0] ? lados[0].split(':') : [];
  const direita = lados.length === 2 && lados[1] ? lados[1].split(':') : [];
  const faltando = lados.length === 2 ? 8 - (esquerda.length + direita.length) : 0;
  if (faltando < 0 || (lados.length === 1 && esquerda.length !== 8)) return null;

  const grupos = [...esquerda, ...Array(faltando).fill('0'), ...direita];
  if (grupos.length !== 8) return null;

  const out = new Uint16Array(8);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(grupos[i])) return null;
    out[i] = parseInt(grupos[i], 16);
  }
  return out;
}

/**
 * true se o IP não pode ser destino de download: loopback, privados (10/8,
 * 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), CGNAT
 * (100.64/10), 0.0.0.0/8, multicast, ULA (fc00::/7), ::1, IPv4 mapeado em
 * IPv6 (::ffff:a.b.c.d) com qualquer um desses.
 * @param {string} ip
 * @returns {boolean}
 */
function ipBloqueado(ip) {
  if (typeof ip !== 'string') return true;
  let limpo = ip.trim();
  if (limpo.startsWith('[') && limpo.endsWith(']')) limpo = limpo.slice(1, -1);
  const idxZona = limpo.indexOf('%');
  const semZona = idxZona >= 0 ? limpo.slice(0, idxZona) : limpo;

  const familia = net.isIP(semZona);
  if (!familia) return true;

  if (familia === 4) {
    return _ipv4IntBloqueado(_ipv4ParaInt(semZona));
  }

  const g = _parsearIpv6(semZona);
  if (!g) return true;

  const primeirosSeisZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
  const primeirosCincoZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;

  // :: (não especificado) e ::1 (loopback)
  if (primeirosSeisZero && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;

  // ::ffff:0:0/96 (IPv4 mapeado em IPv6)
  if (primeirosCincoZero && g[5] === 0xffff) {
    const v4Int = ((g[6] << 16) | g[7]) >>> 0;
    return _ipv4IntBloqueado(v4Int);
  }

  // ::/96 (IPv4 compatível obsoleto)
  if (primeirosSeisZero) return true;

  // 64:ff9b::/96 e 64:ff9b:1::/48 (NAT64)
  if (g[0] === 0x0064 && g[1] === 0xff9b && ((g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) || g[2] === 1)) {
    const v4Int = ((g[6] << 16) | g[7]) >>> 0;
    return _ipv4IntBloqueado(v4Int);
  }

  // fc00::/7 (ULA)
  if ((g[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 (link-local) e fec0::/10 (site-local obsoleto)
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;

  // ff00::/8 (multicast)
  if ((g[0] & 0xff00) === 0xff00) return true;

  // 100::/64 (discard-only) e 2001:db8::/32 (documentação)
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;

  return false;
}

function _hostLocalBloqueado(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return !h
    || h === 'localhost'
    || h.endsWith('.localhost')
    || h.endsWith('.local')
    || h.endsWith('.internal');
}

function _normalizarEnderecosDns(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const item of lista) {
    const addr = typeof item === 'string' ? item.trim() : String(item?.address || '').trim();
    if (!addr) continue;
    const semColchetes = addr.startsWith('[') && addr.endsWith(']') ? addr.slice(1, -1) : addr;
    const fam = net.isIP(semColchetes);
    out.push({ address: semColchetes, family: fam || 4 });
  }
  return out;
}

async function _resolverDestinoSeguro(hostname, resolverDns) {
  const limpo = String(hostname || '').trim().replace(/^\[|\]$/g, '');
  if (!limpo) throw new ErroMidia('url_invalida', 'Endereço de destino inválido.');
  if (_hostLocalBloqueado(limpo)) {
    throw new ErroMidia('destino_bloqueado', 'Destino local ou interno não é permitido.');
  }

  const familiaLiteral = net.isIP(limpo);
  if (familiaLiteral) {
    if (ipBloqueado(limpo)) {
      throw new ErroMidia('destino_bloqueado', 'Endereço IP de destino não é permitido.');
    }
    return [{ address: limpo, family: familiaLiteral }];
  }

  let resolvidos;
  try {
    const bruto = resolverDns
      ? await resolverDns(limpo)
      : await dns.lookup(limpo, { all: true, verbatim: true });
    resolvidos = _normalizarEnderecosDns(bruto);
  } catch (err) {
    if (err instanceof ErroMidia) throw err;
    throw new ErroMidia('falha_download', 'Não foi possível resolver o endereço de destino.');
  }

  if (!resolvidos.length) {
    throw new ErroMidia('falha_download', 'Endereço de destino sem registros DNS válidos.');
  }

  for (const reg of resolvidos) {
    if (ipBloqueado(reg.address)) {
      throw new ErroMidia('destino_bloqueado', 'O endereço de destino resolveu para uma rede bloqueada.');
    }
  }
  return resolvidos;
}

function _nomeDoCabecalhoOuUrl(headers, parsedUrl) {
  const cd = String(headers?.['content-disposition'] || '');
  const mUtf8 = cd.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
  if (mUtf8) {
    try {
      return _sanitizarNome(decodeURIComponent(mUtf8[1].trim()));
    } catch (_) {}
  }
  const mSimples = cd.match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
  if (mSimples) {
    return _sanitizarNome(mSimples[1].trim());
  }
  try {
    const seg = decodeURIComponent(parsedUrl.pathname || '');
    return _sanitizarNome(seg);
  } catch (_) {
    return _sanitizarNome(parsedUrl.pathname || '');
  }
}

async function _baixarComPrazo(url, cfg, prazoFinalMs, saltos) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (_) {
    throw new ErroMidia('url_invalida', 'URL inválida.');
  }

  if (parsed.protocol !== 'https:') {
    throw new ErroMidia('url_invalida', 'Somente URLs HTTPS são permitidas.');
  }
  if (parsed.username || parsed.password) {
    throw new ErroMidia('url_invalida', 'URLs com credenciais embutidas não são permitidas.');
  }

  const enderecos = await _resolverDestinoSeguro(parsed.hostname, cfg.resolverDns);
  const restanteMs = prazoFinalMs - Date.now();
  if (restanteMs <= 0) {
    throw new ErroMidia('tempo_esgotado', 'Tempo limite de download excedido.');
  }

  const transporte = cfg._transporte || https;

  return new Promise((resolve, reject) => {
    let finalizado = false;
    const concluir = (fn, valor) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      fn(valor);
    };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new ErroMidia('tempo_esgotado', 'Tempo limite de download excedido.'));
    }, restanteMs);

    const req = transporte.request(
      {
        protocol: 'https:',
        hostname: parsed.hostname,
        servername: net.isIP(parsed.hostname.replace(/^\[|\]$/g, '')) ? undefined : parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        signal: controller.signal,
        // Padrão de safe-web-fetch-service.js: suporta lookup com options.all (Node 18+) e simples.
        lookup: (_host, options, cb) => {
          if (typeof options === 'function') {
            cb = options;
            options = {};
          }
          if (options?.all) return cb(null, enderecos);
          const escolhido = enderecos[0];
          return cb(null, escolhido.address, escolhido.family);
        },
        headers: {
          'User-Agent': 'IAHub-IA-Talk/1.0',
          Accept: '*/*',
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(status) && res.headers?.location) {
          res.resume();
          res.destroy();
          if (saltos >= cfg.maxRedirecionamentos) {
            return concluir(reject, new ErroMidia('falha_download', 'Limite de redirecionamentos excedido.'));
          }
          let proxima;
          try {
            proxima = new URL(res.headers.location, parsed).toString();
          } catch (_) {
            return concluir(reject, new ErroMidia('url_invalida', 'URL de redirecionamento inválida.'));
          }
          clearTimeout(timer);
          _baixarComPrazo(proxima, cfg, prazoFinalMs, saltos + 1)
            .then((r) => concluir(resolve, r))
            .catch((e) => concluir(reject, e));
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          res.destroy();
          return concluir(reject, new ErroMidia('falha_download', `Falha no download (HTTP ${status}).`));
        }

        const contentLength = Number(res.headers?.['content-length']);
        if (Number.isFinite(contentLength) && contentLength > cfg.limiteBytes) {
          res.resume();
          res.destroy();
          req.destroy();
          return concluir(reject, new ErroMidia('arquivo_grande', `Arquivo excede o limite de ${cfg.limiteBytes} bytes.`));
        }

        const chunks = [];
        let bytes = 0;

        res.on('data', (chunk) => {
          if (finalizado) return;
          bytes += chunk.length;
          if (bytes > cfg.limiteBytes) {
            const err = new ErroMidia('arquivo_grande', `Arquivo excede o limite de ${cfg.limiteBytes} bytes.`);
            concluir(reject, err);
            res.destroy();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

        res.on('error', () => {
          concluir(reject, new ErroMidia('falha_download', 'Erro ao receber dados da URL.'));
        });

        res.on('end', () => {
          if (finalizado) return;
          const dados = Buffer.concat(chunks);
          if (dados.length === 0) {
            return concluir(reject, new ErroMidia('arquivo_invalido', 'Arquivo retornado pela URL está vazio.'));
          }

          let mime = detectarMime(dados);
          if (!mime) {
            const ct = String(res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (MIMES_TEXTO_SEM_ASSINATURA.has(ct) && _pareceTextoValido(dados)) {
              mime = ct;
            } else {
              return concluir(reject, new ErroMidia('tipo_nao_suportado', 'Não foi possível identificar um tipo de mídia suportado.'));
            }
          }

          const nome = _nomeDoCabecalhoOuUrl(res.headers, parsed);
          concluir(resolve, { dados, mime, nome });
        });
      }
    );

    req.on('error', (err) => {
      if (controller.signal.aborted) {
        const motivo = controller.signal.reason;
        return concluir(
          reject,
          motivo instanceof ErroMidia ? motivo : new ErroMidia('tempo_esgotado', 'Tempo limite de download excedido.')
        );
      }
      if (err instanceof ErroMidia) return concluir(reject, err);
      concluir(reject, new ErroMidia('falha_download', 'Não foi possível concluir o download da URL.'));
    });

    req.end();
  });
}

/**
 * Baixa mídia de uma URL com proteção SSRF.
 * Regras: só https; resolve o DNS e recusa se QUALQUER endereço for
 * bloqueado; conecta no IP já conferido (evita troca de DNS no meio);
 * reconfere a cada redirecionamento; para ao passar de limiteBytes; não envia
 * cookies nem credenciais.
 * @param {string} url
 * @param {{ limiteBytes?: number, tempoMs?: number, maxRedirecionamentos?: number,
 *           resolverDns?: (host: string) => Promise<string[]> }} [opcoes]
 *        padrões: 16 MB, 15000 ms, 3 redirecionamentos, dns.promises.lookup(all)
 * @returns {Promise<{ dados: Buffer, mime: string, nome: string }>}
 * @throws {ErroMidia}
 */
async function baixarUrlSegura(url, opcoes = {}) {
  const cfg = {
    limiteBytes: Number(opcoes.limiteBytes) > 0 ? Number(opcoes.limiteBytes) : LIMITE_PADRAO_BYTES,
    tempoMs: Number(opcoes.tempoMs) > 0 ? Number(opcoes.tempoMs) : TEMPO_PADRAO_MS,
    maxRedirecionamentos: Number.isInteger(opcoes.maxRedirecionamentos) && opcoes.maxRedirecionamentos >= 0
      ? opcoes.maxRedirecionamentos
      : MAX_REDIRECIONAMENTOS_PADRAO,
    resolverDns: typeof opcoes.resolverDns === 'function' ? opcoes.resolverDns : null,
    _transporte: opcoes._transporte || null,
  };
  const prazoFinalMs = Date.now() + cfg.tempoMs;
  return _baixarComPrazo(url, cfg, prazoFinalMs, 0);
}

module.exports = {
  ErroMidia,
  detectarMime,
  validarArquivo,
  ipBloqueado,
  baixarUrlSegura,
  decodificarBase64Estrito,
};
