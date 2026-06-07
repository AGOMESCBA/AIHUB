const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const channelStore = require(path.join(ROOT, 'modules/whatsapp/channel-store'));

const empresas = [
  { empresa_id: 2, nome: 'C3I', padrao: 1 },
  { empresa_id: 1, nome: 'J2A', padrao: 0 },
];

assert.strictEqual(
  channelStore.empresaProprietariaCanal({ id: 'emp_1', auth_client_id: 'iac_1' }, empresas)?.empresa_id,
  1,
  'canal legado deve preservar como proprietaria a empresa que criou o servico',
);

assert.strictEqual(
  channelStore.empresaProprietariaCanal({ id: 'canal-compartilhado', auth_client_id: 'iac_2' }, empresas)?.empresa_id,
  2,
  'auth_client_id deve identificar a proprietaria quando o id do canal nao identifica',
);

assert.strictEqual(
  channelStore.empresaProprietariaCanal({ id: 'canal-compartilhado', auth_client_id: 'sessao-livre' }, empresas),
  null,
  'canal sem referencia de empresa deve permitir fallback explicito',
);

console.log('whatsapp-empresa-proprietaria.test.js: ok');
