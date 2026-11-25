const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const internalToken = require('../modules/whatsapp/windows-service/internal-token');
const { _lerOuCriar } = internalToken._test;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iac-token-'));
const arquivo = path.join(dir, 'sub', '.iac-internal-token');

try {
  // Sem variável: gera no arquivo e reaproveita nas próximas leituras (hub e worker).
  const gerado = internalToken.obterToken({ env: {}, arquivo });
  assert.match(gerado, /^[0-9a-f]{64}$/, 'token gerado deve ter 32 bytes em hex');
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8'), gerado, 'token deve ficar gravado em disco');
  assert.strictEqual(internalToken.obterToken({ env: {}, arquivo }), gerado, 'segunda leitura devolve o mesmo token');

  // Quem sobe depois (ex.: worker junto com o hub) lê o que já existe.
  assert.strictEqual(_lerOuCriar(arquivo), gerado);

  // A variável do .env tem prioridade e não toca no arquivo.
  assert.strictEqual(internalToken.obterToken({ env: { IAC_HUB_INTERNAL_TOKEN: ' do-env ' }, arquivo }), 'do-env');
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8'), gerado);

  // Comparação.
  assert.strictEqual(internalToken.tokenConfere(gerado, gerado), true);
  assert.strictEqual(internalToken.tokenConfere('x' + gerado.slice(1), gerado), false, 'token diferente');
  assert.strictEqual(internalToken.tokenConfere(gerado.slice(0, 10), gerado), false, 'tamanho diferente');
  assert.strictEqual(internalToken.tokenConfere('', gerado), false, 'cabeçalho ausente');
  assert.strictEqual(internalToken.tokenConfere(undefined, gerado), false, 'cabeçalho ausente');
  assert.strictEqual(internalToken.tokenConfere('', ''), false, 'esperado vazio nunca libera (antes liberava)');

  console.log('whatsapp-internal-token.test.js: ok');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
