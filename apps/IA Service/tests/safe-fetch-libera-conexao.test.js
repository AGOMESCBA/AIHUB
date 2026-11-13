// Fase 1 (2026-11-12): página recusada (HTTP >= 400 ou Content-Type não
// aceito) libera a conexão na hora. Antes o corpo não era lido nem a resposta
// destruída, e o socket ficava preso até o servidor remoto fechar
// (etapa-v1-pesquisa-web-motor terminava com 6 conexões abertas com a TDN).
const assert = require('assert');
const dns = require('dns').promises;
const http = require('http');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const safeFetch = require('../backend/services/safe-web-fetch-service');

// Resposta que nunca termina sozinha: só é liberada se alguém destruí-la.
function respostaPendurada(statusCode, headers) {
  const res = new Readable({ read() {} });
  res.statusCode = statusCode;
  res.headers = headers;
  return res;
}

async function comResposta(res, fn) {
  const oldLookup = dns.lookup;
  const oldRequest = http.request;
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  http.request = (options, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => process.nextTick(() => cb(res));
    return req;
  };
  try { return await fn(); } finally { dns.lookup = oldLookup; http.request = oldRequest; }
}

async function main() {
  const erroHttp = respostaPendurada(404, { 'content-type': 'text/html' });
  await comResposta(erroHttp, () => assert.rejects(() => safeFetch.fetchTextoSeguro('http://public.test/x'), /HTTP 404/));
  assert.strictEqual(erroHttp.destroyed, true, 'resposta HTTP 404 deve ser destruída para liberar o socket');

  const tipoRecusado = respostaPendurada(200, { 'content-type': 'application/octet-stream' });
  await comResposta(tipoRecusado, () => assert.rejects(() => safeFetch.fetchTextoSeguro('http://public.test/bin'), /Content-Type nao permitido/));
  assert.strictEqual(tipoRecusado.destroyed, true, 'resposta com Content-Type recusado deve ser destruída');

  console.log('safe-fetch-libera-conexao.test.js: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
