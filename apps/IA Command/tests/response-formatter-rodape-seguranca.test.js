'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const formatter = require(path.join(ROOT, 'modules/erp/core/response-formatter'));

// Vendedor restrito (entidadeSeguranca vendedor_fixo_seguranca): a resposta deve
// deixar explicito ao usuario que os dados sao filtrados pelo codigo do vendedor —
// caso real: rodape ausente na resposta do WhatsApp mesmo com o filtro aplicado no SQL.
const respostaVendedor = formatter.formatar({
  tipo: 'sucesso_ai_sql',
  resposta_direta: 'Comissao total: R$ 4.988,02',
  rows: [{ comissao_total: 4988.02 }],
  _entidadesResolvidas: [{ tipo: 'vendedor_fixo_seguranca', codigo: '000007', nome: 'Fulano' }],
}, {}, { humanizarResposta: false });
assert(
  respostaVendedor.includes('_Filtrado por Vendedor: 000007_'),
  'resposta de vendedor restrito deve conter rodape de filtro de seguranca',
);

// Cliente restrito (entidadeSeguranca cliente_fixo_seguranca).
const respostaCliente = formatter.formatar({
  tipo: 'sucesso_ai_sql',
  resposta_direta: 'Total: R$ 100',
  rows: [{ a: 1 }],
  _entidadesResolvidas: [{ tipo: 'cliente_fixo_seguranca', codigo: '000037', nome: 'Cliente X' }],
}, {}, { humanizarResposta: false });
assert(
  respostaCliente.includes('_Filtrado por Cliente: 000037_'),
  'resposta de cliente restrito deve conter rodape de filtro de seguranca',
);

// Gestor / sem restricao: nao deve inventar rodape.
const respostaGestor = formatter.formatar({
  tipo: 'sucesso_ai_sql',
  resposta_direta: 'Total: R$ 100',
  rows: [{ a: 1 }],
}, {}, { humanizarResposta: false });
assert(
  !respostaGestor.includes('_Filtrado por'),
  'resposta sem entidadeSeguranca nao deve conter rodape',
);

// resposta_direta que ja veio com o rodape (ex: caminho legado) nao deve duplicar.
const respostaJaComRodape = formatter.formatar({
  tipo: 'sucesso_ai_sql',
  resposta_direta: 'Total: R$ 100\n\n_Filtrado por Vendedor: 000007_',
  rows: [{ a: 1 }],
  _entidadesResolvidas: [{ tipo: 'vendedor_fixo_seguranca', codigo: '000007' }],
}, {}, { humanizarResposta: false });
const ocorrencias = (respostaJaComRodape.match(/_Filtrado por Vendedor: 000007_/g) || []).length;
assert.strictEqual(ocorrencias, 1, 'rodape nao deve ser duplicado quando ja presente na resposta_direta');

console.log('response-formatter-rodape-seguranca.test.js: ok');
