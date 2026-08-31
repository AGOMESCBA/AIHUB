'use strict';

const assert = require('assert');
const scheduledRunner = require('../modules/scheduler/scheduled-question-runner');

(async () => {
  const pergunta = 'Contas a pagar do dia por fornecedor, titulo, prefixo e tipo com valor e saldo do titulo';
  const intent = scheduledRunner._test.montarIntentSqlFixo({
    modulo: 'financeiro',
    pergunta,
    empresa_id: 1,
  });

  assert(intent.periodo?.dataInicio && intent.periodo?.dataFim, 'SQL fixo agendado deve resolver "do dia"');
  assert.strictEqual(intent.periodo.dataInicio, intent.periodo.dataFim, 'SQL fixo "do dia" deve resolver uma unica data');
  assert.deepStrictEqual(intent._periodoCanonicoResolvido, intent.periodo, 'SQL fixo agendado deve levar periodo canonico resolvido');

  assert.strictEqual(
    scheduledRunner._test.erroSqlFixoPermiteRetryIA({ tipo: 'erro', subtipo: 'contrato_query_plan_invalido' }),
    true,
    'rejeicao query_plan de SQL fixo deve permitir retry por IA',
  );
  assert.strictEqual(
    scheduledRunner._test.erroSqlFixoPermiteRetryIA({ tipo: 'erro', subtipo: 'acesso_negado_vendedor' }),
    false,
    'violacao de seguranca nao deve permitir retry por IA',
  );

  let chamouIa = false;
  const resultadoOriginal = {
    tipo: 'erro',
    subtipo: 'contrato_query_plan_invalido',
    resposta_direta: 'SQL rejeitado pelo query_plan',
  };
  const resultado = await scheduledRunner._test.tentarRetryIaAposSqlFixo({
    resultadoSqlFixo: resultadoOriginal,
    intent,
    empresaId: 1,
    handler: {
      async executar(intentRetry, empresaId) {
        chamouIa = true;
        assert.strictEqual(empresaId, 1);
        assert.strictEqual(intentRetry.origem, 'agendamento_sql_fixo_retry_ia');
        assert.strictEqual(intentRetry._skipIaSqlGeneration, false);
        assert.deepStrictEqual(intentRetry._periodoCanonicoResolvido, intent.periodo);
        return { tipo: 'sucesso_ai_sql', resposta_direta: 'ok', rows: [], duracao_ms: 1 };
      },
    },
  });

  assert.strictEqual(chamouIa, true, 'deve chamar IA quando SQL fixo falhar por guardrail corrigivel');
  assert.strictEqual(resultado.tipo, 'sucesso_ai_sql');
  assert.strictEqual(resultado._pipeline_origem, 'agendamento_sql_fixo_retry_ia');

  console.log('scheduled-question-sql-fixo-guardrail.test.js: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
