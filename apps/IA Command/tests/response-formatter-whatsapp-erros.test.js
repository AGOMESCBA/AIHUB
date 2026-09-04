'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const formatter = require(path.join(ROOT, 'modules/erp/core/response-formatter'));

const semDados = formatter.formatar({
  tipo: 'sucesso_ai_sql',
  resposta_direta: 'Nao encontrei registros para essa consulta.',
  rows: [],
  periodo: { dataInicio: '20260101', dataFim: '20260131' },
}, {
  filtros: { cliente: 'ACME' },
}, { humanizarResposta: false });

assert(semDados.includes('Entendi sua consulta'), 'sem dados deve reconhecer a consulta');
assert(semDados.includes('Periodo: 01/01/2026 a 31/01/2026'), 'sem dados deve mostrar periodo');
assert(semDados.includes('Filtros: Cliente: *ACME*'), 'sem dados deve mostrar filtros');
assert(semDados.includes('período maior'), 'sem dados deve sugerir proximo passo');

const guardrail = formatter.formatar({
  tipo: 'erro',
  subtipo: 'contrato_ia_owner_invalido',
  mensagem: 'SQL rejeitado por contrato IA-OWNER',
}, {}, { humanizarResposta: false });

assert(guardrail.includes('Não consegui montar essa consulta com segurança'), 'guardrail deve ser amigavel');
assert(!guardrail.includes('SQL rejeitado'), 'guardrail nao deve vazar detalhe tecnico bruto');

const semConexao = formatter.formatar({
  tipo: 'erro',
  subtipo: 'sem_conexao',
  mensagem: 'timeout ao chamar o agente',
}, {}, { humanizarResposta: false });

assert(semConexao.includes('acessar o ERP'), 'erro de conexao deve orientar sobre ERP/agente');

console.log('response-formatter-whatsapp-erros.test.js: ok');
