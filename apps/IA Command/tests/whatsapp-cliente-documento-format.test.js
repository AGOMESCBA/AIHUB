'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const chatFormatter = require(path.join(ROOT, 'modules/ai/chat/whatsapp-formatter'));
const responseFormatter = require(path.join(ROOT, 'modules/erp/core/response-formatter'));
const WhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));

const rows = [
  { cliente: 'BIPAR ENERGIA, TELECOMUNICACAO E IND.METALURGICA S.A.', documento: '004750', valor_total: 4906.62 },
  { cliente: 'BIPAR ENERGIA, TELECOMUNICACAO E IND.METALURGICA S.A.', documento: '004767', valor_total: 12000 },
  { cliente: 'ABACO TECNOLOGIA DE INFORMACAO LTDA', documento: '004765', valor_total: 4117.05 },
];

const pergunta = 'detalhamento do faturamento do mes por cliente e nota fiscal emitida';

const direto = chatFormatter._formatarFallback(rows, pergunta);
assert(direto.includes('*BIPAR ENERGIA, TELECOMUNICACAO E IND.METALURGICA S.A.*: R$'), 'deve exibir cliente');
assert(direto.includes('Doc. 004750: R$'), 'deve exibir documento 004750');
assert(direto.includes('Doc. 004767: R$'), 'deve exibir documento 004767');
assert(direto.indexOf('Doc. 004750') > direto.indexOf('*BIPAR'), 'documento 004750 deve ficar apos BIPAR');
assert(direto.indexOf('Doc. 004767') > direto.indexOf('*BIPAR'), 'documento 004767 deve ficar apos BIPAR');
assert(direto.indexOf('Doc. 004765') > direto.indexOf('*ABACO'), 'documento 004765 deve ficar apos ABACO');

const local = responseFormatter.formatarAiSqlLocal(rows, {
  group_by: ['cliente', 'documento'],
});
assert(local.includes('*Por Cliente e Documento*'), 'formatter local deve reconhecer agrupamento composto');
assert(local.includes('*004750*: *R$'), 'formatter local deve preservar documento 004750');
assert(local.includes('*004767*: *R$'), 'formatter local deve preservar documento 004767');
assert.strictEqual(
  responseFormatter.detectarDimensaoCategorica({ documento: '004750', valor_total: 4906.62 }),
  'documento',
  'documento deve ser reconhecido como dimensao categorica',
);

const svc = Object.create(WhatsAppService.prototype);
const consolidado = svc._formatarConsolidadoDinamicoAll({
  _mensagemOriginal: pergunta,
}, [
  { nomeEmpresa: 'J2A Consultoria', rows },
]);
assert(consolidado.includes('*Consolidado'), 'deve formatar consolidado');
assert(consolidado.includes('Doc. 004750'), 'consolidado deve preservar documento 004750');
assert(consolidado.includes('Doc. 004767'), 'consolidado deve preservar documento 004767');

console.log('whatsapp-cliente-documento-format.test.js: ok');
