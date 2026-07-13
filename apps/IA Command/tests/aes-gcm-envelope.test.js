const assert = require('assert');

const {
  decryptPayload,
  encryptPayload,
  generateKeyBase64,
  isEncryptedEnvelope,
  normalizeKey,
} = require('../modules/security/aes-gcm-envelope');

const key = generateKeyBase64();
const payload = {
  sql: "SELECT TOP 10 * FROM SF2010 WHERE D_E_L_E_T_ = ' '",
  limit: 10000,
  uuid: 'req-1',
  empresa_id: 123,
  iat: Date.now(),
};

assert.strictEqual(normalizeKey(key).length, 32, 'chave base64 gerada deve ter 32 bytes');

const env1 = encryptPayload(payload, key, { kid: '123' });
const env2 = encryptPayload(payload, key, { kid: '123' });

assert.ok(isEncryptedEnvelope(env1), 'payload criptografado deve ser envelope valido');
assert.notStrictEqual(env1.iv, env2.iv, 'IV deve ser diferente a cada criptografia');
assert.notStrictEqual(env1.data, env2.data, 'ciphertext deve variar por causa do IV');
assert.deepStrictEqual(decryptPayload(env1, key), payload, 'deve descriptografar para o payload original');

const adulterado = { ...env1, data: env1.data.slice(0, -2) + 'AA' };
assert.throws(() => decryptPayload(adulterado, key), /Unsupported state|authenticate|bad decrypt|invalid/i, 'payload adulterado deve falhar');

assert.throws(() => normalizeKey(Buffer.from('curta').toString('base64')), /32 bytes/, 'chave curta deve falhar');
assert.strictEqual(isEncryptedEnvelope({ sql: 'SELECT 1' }), false, 'payload claro nao deve ser envelope');

console.log('aes-gcm-envelope.test.js: ok');
