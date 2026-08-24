'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const cfgModule = require(path.join(ROOT, 'modules/whatsapp/whatsapp-response-config'));

const EMPRESA_TESTE = -9992;

function limpar() {
  getDB().prepare('DELETE FROM whatsapp_response_config WHERE empresa_id = ?').run(EMPRESA_TESTE);
  cfgModule.invalidarCache(EMPRESA_TESTE);
}

limpar();

// 1. sem linha na tabela -> defaults
const cfgDefault = cfgModule.obterConfigWhatsapp(EMPRESA_TESTE);
assert.deepStrictEqual(cfgDefault, cfgModule.DEFAULTS, 'sem linha na tabela deve retornar exatamente os DEFAULTS');

// 2. com linha parcial -> merge (campos preenchidos sobrepõem, resto usa default)
const agora = new Date().toISOString();
getDB().prepare(`
  INSERT INTO whatsapp_response_config
    (empresa_id, limite_parte_whatsapp, formato_padrao_anexo, criado_em, atualizado_em)
  VALUES (?, ?, ?, ?, ?)
`).run(EMPRESA_TESTE, 2000, 'pdf', agora, agora);

cfgModule.invalidarCache(EMPRESA_TESTE);
const cfgParcial = cfgModule.obterConfigWhatsapp(EMPRESA_TESTE);
assert.strictEqual(cfgParcial.limite_parte_whatsapp, 2000);
assert.strictEqual(cfgParcial.formato_padrao_anexo, 'pdf');
assert.strictEqual(cfgParcial.limite_pergunta_anexo_caracteres, cfgModule.DEFAULTS.limite_pergunta_anexo_caracteres, 'campo nao preenchido deve manter default');

// 3. cache em memória: alterar o banco direto não reflete até invalidar
getDB().prepare('UPDATE whatsapp_response_config SET limite_parte_whatsapp = 999 WHERE empresa_id = ?').run(EMPRESA_TESTE);
const cfgAindaCacheada = cfgModule.obterConfigWhatsapp(EMPRESA_TESTE);
assert.strictEqual(cfgAindaCacheada.limite_parte_whatsapp, 2000, 'deve continuar servindo do cache ate invalidar');

cfgModule.invalidarCache(EMPRESA_TESTE);
const cfgAposInvalidar = cfgModule.obterConfigWhatsapp(EMPRESA_TESTE);
assert.strictEqual(cfgAposInvalidar.limite_parte_whatsapp, 999, 'apos invalidar cache deve refletir o valor novo do banco');

// 4. isolamento entre empresas
const cfgOutraEmpresa = cfgModule.obterConfigWhatsapp(EMPRESA_TESTE + 1);
assert.deepStrictEqual(cfgOutraEmpresa, cfgModule.DEFAULTS, 'outra empresa sem linha propria deve receber defaults, nao a config da empresa de teste');

limpar();
console.log('whatsapp-response-config.test.js: ok');
