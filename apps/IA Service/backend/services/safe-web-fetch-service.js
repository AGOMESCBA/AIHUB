'use strict';

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { redigirUrl } = require('./redaction-service');

const DEFAULTS = {
  timeoutMs: Number(process.env.IA_SERVICE_SAFE_FETCH_TIMEOUT_MS || 8000),
  maxBytes: Number(process.env.IA_SERVICE_SAFE_FETCH_MAX_BYTES || 300000),
  maxRedirects: Number(process.env.IA_SERVICE_SAFE_FETCH_MAX_REDIRECTS || 3),
  contentTypes: ['text/html', 'text/plain', 'application/xhtml+xml', 'application/xml', 'text/xml', 'application/json'],
};

function _ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function _inCidr4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (_ipv4ToInt(ip) & mask) === (_ipv4ToInt(base) & mask);
}

function _normalizeIPv6(ip) {
  if (ip === '::1') return '::1';
  return ip.toLowerCase();
}

function isIpBloqueado(ip) {
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
      ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
      ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => _inCidr4(ip, base, bits));
  }
  const v6 = _normalizeIPv6(ip);
  return v6 === '::1'
    || v6 === '::'
    || v6.startsWith('fc') || v6.startsWith('fd')
    || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')
    || v6.startsWith('ff')
    || v6.startsWith('::ffff:127.')
    || v6.startsWith('::ffff:10.')
    || v6.startsWith('::ffff:192.168.')
    || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(v6);
}

async function resolverDestinoSeguro(hostname) {
  const host = String(hostname || '').trim();
  if (!host) throw new Error('Host vazio bloqueado.');
  if (/localhost$/i.test(host) || /\.localhost$/i.test(host) || /\.local$/i.test(host)) {
    throw new Error('Destino local/interno bloqueado.');
  }

  if (net.isIP(host)) {
    if (isIpBloqueado(host)) throw new Error(`Destino IP bloqueado: ${host}`);
    return [{ address: host, family: net.isIP(host) }];
  }

  const registros = await dns.lookup(host, { all: true, verbatim: true });
  if (!registros.length) throw new Error('DNS sem enderecos.');
  const bloqueado = registros.find(r => isIpBloqueado(r.address));
  if (bloqueado) throw new Error(`DNS resolveu destino bloqueado: ${bloqueado.address}`);
  return registros;
}

function validarProtocolo(parsed) {
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Protocolo nao permitido: ${parsed.protocol}`);
  }
}

function _contentTypeAceito(contentType, aceitos) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  return aceitos.includes(ct);
}

async function validarUrlSegura(url) {
  let parsed;
  try { parsed = new URL(url); } catch (_) { throw new Error('URL invalida.'); }
  validarProtocolo(parsed);
  const enderecos = await resolverDestinoSeguro(parsed.hostname);
  return { parsed, enderecos };
}

async function fetchTextoSeguro(url, opts = {}, _redirects = []) {
  const cfg = { ...DEFAULTS, ...opts };
  const { parsed, enderecos } = await validarUrlSegura(url);
  const lib = parsed.protocol === 'https:' ? https : http;
  const redactedUrl = redigirUrl(parsed.toString());

  return new Promise((resolve, reject) => {
    let finalizado = false;
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      timeout: cfg.timeoutMs,
      // BUG REAL CONFIRMADO POR TESTE CONTRA REDE REAL (2026-10): o `lookup`
      // custom do Node, quando `options.all` vem true (Node 18+ passa isso
      // por padrão em `https.request`), exige que o callback receba um ARRAY
      // de endereços (`cb(null, [{address, family}, ...])`), não um endereço
      // único (`cb(null, address, family)`). A forma antiga (endereço único)
      // nunca lançava erro em testes porque toda a suíte mockava
      // abrirResultados/fetchTextoSeguro — nunca bateu na rede real antes de
      // 2026-10 (Pesquisa Web multi-provider, validação contra Gemini real).
      // Suporta os dois formatos de chamada para não quebrar em versões mais
      // antigas do Node que ainda pedem endereço único.
      lookup: (hostname, options, cb) => {
        if (options?.all) return cb(null, enderecos);
        const escolhido = enderecos[0];
        cb(null, escolhido.address, escolhido.family);
      },
      headers: {
        'User-Agent': 'IAHub-IA-Service/1.0 safe-technical-research',
        Accept: cfg.contentTypes.join(','),
      },
    }, async (res) => {
      try {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (_redirects.length >= cfg.maxRedirects) throw new Error('Limite de redirects excedido.');
          const next = new URL(res.headers.location, parsed).toString();
          const redir = { de: redactedUrl, para: redigirUrl(next), statusCode: res.statusCode };
          const prox = await fetchTextoSeguro(next, cfg, [..._redirects, redir]);
          if (!finalizado) {
            finalizado = true;
            resolve({ ...prox, redirects: [..._redirects, redir, ...(prox.redirects || [])] });
          }
          return;
        }

        if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
        if (!_contentTypeAceito(res.headers['content-type'], cfg.contentTypes)) {
          throw new Error(`Content-Type nao permitido: ${res.headers['content-type'] || '(ausente)'}`);
        }

        let bytes = 0;
        const chunks = [];
        res.on('data', c => {
          bytes += c.length;
          if (bytes > cfg.maxBytes) {
            if (!finalizado) {
              finalizado = true;
              reject(new Error('Pagina excede limite de download.'));
            }
            req.destroy(new Error('Pagina excede limite de download.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (finalizado) return;
          finalizado = true;
          resolve({
            url: redactedUrl,
            finalUrl: redactedUrl,
            statusCode: res.statusCode,
            raw: Buffer.concat(chunks).toString('utf8'),
            bytes,
            contentType: res.headers['content-type'] || '',
            redirects: _redirects,
          });
        });
      } catch (err) {
        if (!finalizado) {
          finalizado = true;
          reject(err);
        }
      }
    });
    req.setTimeout(cfg.timeoutMs, () => req.destroy(new Error(`Timeout de ${Math.round(cfg.timeoutMs / 1000)}s ao abrir pagina.`)));
    req.on('error', err => {
      if (!finalizado) {
        finalizado = true;
        reject(err);
      }
    });
    req.end();
  });
}

// Resolve só a URL FINAL de uma cadeia de redirects, sem baixar o corpo —
// usado quando a origem (ex.: Gemini/groundingChunks) devolve um link de
// redirect (vertexaisearch.cloud.google.com/grounding-api-redirect/...) em
// vez da URL real da fonte, e precisamos da URL citável de verdade para
// auditoria/proveniência e para checar se é uma fonte oficial. Usa HEAD
// (mais leve que fetchTextoSeguro, que baixa o corpo inteiro) com o MESMO
// guard de segurança (validação de protocolo + resolução de DNS bloqueando
// IP privado) em cada salto da cadeia — nunca segue redirect para destino
// interno, mesma proteção de fetchTextoSeguro.
async function resolverRedirectFinal(url, opts = {}, _redirects = []) {
  const cfg = { ...DEFAULTS, ...opts };
  const { parsed, enderecos } = await validarUrlSegura(url);
  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let finalizado = false;
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'HEAD',
      timeout: cfg.timeoutMs,
      // Mesma correção de fetchTextoSeguro acima — ver comentário lá.
      lookup: (hostname, options, cb) => {
        if (options?.all) return cb(null, enderecos);
        const escolhido = enderecos[0];
        cb(null, escolhido.address, escolhido.family);
      },
      headers: { 'User-Agent': 'IAHub-IA-Service/1.0 safe-technical-research' },
    }, async (res) => {
      try {
        res.resume();
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (_redirects.length >= cfg.maxRedirects) throw new Error('Limite de redirects excedido.');
          const next = new URL(res.headers.location, parsed).toString();
          const final = await resolverRedirectFinal(next, cfg, [..._redirects, parsed.toString()]);
          if (!finalizado) { finalizado = true; resolve(final); }
          return;
        }
        if (!finalizado) { finalizado = true; resolve(parsed.toString()); }
      } catch (err) {
        if (!finalizado) { finalizado = true; reject(err); }
      }
    });
    req.setTimeout(cfg.timeoutMs, () => req.destroy(new Error(`Timeout de ${Math.round(cfg.timeoutMs / 1000)}s ao resolver redirect.`)));
    req.on('error', err => { if (!finalizado) { finalizado = true; reject(err); } });
    req.end();
  });
}

module.exports = {
  DEFAULTS,
  fetchTextoSeguro,
  resolverRedirectFinal,
  validarUrlSegura,
  resolverDestinoSeguro,
  isIpBloqueado,
};
