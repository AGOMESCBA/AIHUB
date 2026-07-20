'use strict';

/**
 * Testes de seguranca do modulo estoque: nao existe campo de vendedor/comprador
 * em nenhuma tabela (SB2, SB1, SD3), entao o modulo fica bloqueado integralmente
 * para o perfil vendedor. Gestor mantem acesso total.
 *
 * Usa o banco real da aplicacao com numeros de teste temporarios em
 * whatsapp_allowed_numbers (mesma abordagem de compras-seguranca-vendedor.test.js),
 * removidos ao final.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

process.chdir(ROOT);
const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();
const crud = require(path.join(ROOT, 'modules/database/crud'));

const estoqueSpec = require(path.join(ROOT, 'modules/erp/estoque/estoque-ia-owner-spec'));

const EMPRESA_ID = 1;
const SENDER_VENDEDOR = '5565900000201';
const SENDER_GESTOR = '5565900000202';
const SENDER_NAO_CADASTRADO = '5565900000203';

const db = getDB();
db.prepare(`DELETE FROM whatsapp_allowed_numbers WHERE numero IN (?, ?)`).run(SENDER_VENDEDOR, SENDER_GESTOR);
crud.criar('whatsapp_allowed_numbers', {
  empresa_id: EMPRESA_ID,
  nome: 'teste-vendedor-estoque',
  numero: SENDER_VENDEDOR,
  ativo: 1,
  erp_tipo: 'vendedor',
  erp_id: '000099',
});
crud.criar('whatsapp_allowed_numbers', {
  empresa_id: EMPRESA_ID,
  nome: 'teste-gestor-estoque',
  numero: SENDER_GESTOR,
  ativo: 1,
  erp_tipo: 'gestor',
  erp_id: null,
});

let passou = 0;
let falhou = 0;

function ok(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passou++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

console.log('\n[1] prepararIntent — bloqueio total para vendedor, acesso livre para gestor');

ok('sem remetente retorna objeto vazio (sem alterar intent)', () => {
  const r = estoqueSpec.prepararIntent({ intent: {}, empresaId: EMPRESA_ID, mensagem: 'saldo em estoque' });
  assert.deepStrictEqual(r, {});
});

ok('vendedor recebe retorno de bloqueio (acesso_negado_vendedor), sem gerar SQL', () => {
  const r = estoqueSpec.prepararIntent({
    intent: { _remetente: SENDER_VENDEDOR },
    empresaId: EMPRESA_ID,
    mensagem: 'saldo em estoque do produto 000001',
  });
  assert.ok(r.retorno, 'deveria retornar objeto de bloqueio');
  assert.strictEqual(r.retorno.tipo, 'erro');
  assert.strictEqual(r.retorno.subtipo, 'acesso_negado_vendedor');
});

ok('gestor nao recebe bloqueio (objeto vazio, segue fluxo normal)', () => {
  const r = estoqueSpec.prepararIntent({
    intent: { _remetente: SENDER_GESTOR },
    empresaId: EMPRESA_ID,
    mensagem: 'saldo em estoque por armazem',
  });
  assert.deepStrictEqual(r, {});
});

ok('numero nao cadastrado recebe bloqueio (nao_cadastrado)', () => {
  const r = estoqueSpec.prepararIntent({
    intent: { _remetente: SENDER_NAO_CADASTRADO },
    empresaId: EMPRESA_ID,
    mensagem: 'saldo em estoque',
  });
  assert.ok(r.retorno, 'deveria retornar objeto de bloqueio');
  assert.strictEqual(r.retorno.subtipo, 'nao_cadastrado');
});

db.prepare(`DELETE FROM whatsapp_allowed_numbers WHERE numero IN (?, ?)`).run(SENDER_VENDEDOR, SENDER_GESTOR);

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`estoque-seguranca-vendedor.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`estoque-seguranca-vendedor.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
