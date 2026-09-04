'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));

const respostaRaNcc = runner._test.respostaGuardrailUsuario(
  "SQL rejeitado por contrato IA-OWNER: filtro incorreto: usou SE1.E1_NATUREZ IN ('RA','NCC'), mas RA/NCC devem ser filtrados por SE1.E1_TIPO.",
  'contrato_ia_owner_invalido',
);

assert(respostaRaNcc.includes('bloqueada por uma regra de validação'), 'deve deixar claro que foi guardrail');
assert(respostaRaNcc.includes('Motivo:'), 'deve mostrar o motivo da rejeicao');
assert(respostaRaNcc.includes("SE1.E1_TIPO IN ('RA','NCC')"), 'deve orientar o campo correto para RA/NCC');
assert(!respostaRaNcc.includes('Tivemos uma inconsistencia'), 'nao deve voltar ao texto generico antigo');

const respostaBaixa = runner._test.respostaGuardrailUsuario(
  'A pergunta pede recebimentos antecipados/RA/NCC isolado, que e SEMPRE consulta de titulo EM ABERTO, mas o SQL faz JOIN com tabela de baixa (SE5/FK1/FK7).',
  'contrato_ia_owner_invalido',
);

assert(respostaBaixa.includes('remova joins com tabelas de baixa') || respostaBaixa.includes('Remova o JOIN'), 'deve orientar remocao de baixa');

console.log('ia-owner-guardrail-resposta-usuario.test.js: ok');
