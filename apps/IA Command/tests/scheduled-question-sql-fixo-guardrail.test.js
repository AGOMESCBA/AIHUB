'use strict';

const assert = require('assert');
const scheduledRunner = require('../modules/scheduler/scheduled-question-runner');
const crud = require('../modules/database/crud');

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

  const listarOriginal = crud.listar;
  try {
    crud.listar = (tabela, filtros = {}) => {
      if (tabela === 'intentions') {
        return [{ empresa_id: filtros.empresa_id, ativo: 1, acao: 'ai_text_to_sql', modulo: 'chamados', erp: 'softexpert' }];
      }
      if (tabela === 'whatsapp_allowed_numbers') {
        return [{
          id: 'numero-1',
          empresa_id: filtros.empresa_id,
          erp_id: 'VEND01',
          cod_cliente_erp: 'CLI01',
          cod_aprov_erp: 'APRV01',
        }];
      }
      if (tabela === 'whatsapp_numero_modulos') {
        return [{
          numero_id: 'numero-1',
          erp: 'softexpert',
          modulo: 'chamados',
          papel: 'Analista',
          codigo_identidade: 'ANA123',
        }];
      }
      return listarOriginal(tabela, filtros);
    };

    const jobMacro = { empresa_id: 1, modulo: 'chamados' };
    const destinatario = [{ id: 'recipient-1', numero_id: 'numero-1', numero: '5565999875116' }];

    assert.strictEqual(
      scheduledRunner._test.sqlTemMacroDestinatario("SELECT * FROM base WHERE codigo_analista = '{{codigo_identidade}}'"),
      true,
      'macro de identidade em minusculo deve acionar execucao por destinatario',
    );
    assert.strictEqual(
      scheduledRunner._test.sqlTemMacroDestinatario("SELECT * FROM base WHERE data = '{{HOJE_ISO}}'"),
      false,
      'macro de data nao deve acionar execucao por destinatario',
    );

    const sqlMacros = [
      "codigo_analista = '{{codigo_identidade}}'",
      "perfil = '{{papel_identidade}}'",
      "sistema = '{{sistema_identidade}}'",
      "vendedor = '{{cod_vendedor_erp}}'",
      "cliente = '{{cod_cliente_erp}}'",
      "aprovador = '{{cod_aprovador_erp}}'",
    ].join(' AND ');
    const avaliacao = scheduledRunner._test.avaliarMacrosSql(`SELECT * FROM base WHERE ${sqlMacros}`, jobMacro, new Date('2026-09-08T12:00:00Z'), destinatario);
    assert.strictEqual(avaliacao.ok, true, 'macros do destinatario devem resolver para um destinatario unico');
    assert.ok(avaliacao.sqlResolvido.includes("codigo_analista = 'ANA123'"), avaliacao.sqlResolvido);
    assert.ok(avaliacao.sqlResolvido.includes("perfil = 'Analista'"), avaliacao.sqlResolvido);
    assert.ok(avaliacao.sqlResolvido.includes("sistema = 'softexpert'"), avaliacao.sqlResolvido);
    assert.ok(avaliacao.sqlResolvido.includes("vendedor = 'VEND01'"), avaliacao.sqlResolvido);
    assert.ok(avaliacao.sqlResolvido.includes("cliente = 'CLI01'"), avaliacao.sqlResolvido);
    assert.ok(avaliacao.sqlResolvido.includes("aprovador = 'APRV01'"), avaliacao.sqlResolvido);

    const avaliacaoMulti = scheduledRunner._test.avaliarMacrosSql(
      "SELECT * FROM base WHERE codigo_analista = '{{codigo_identidade}}'",
      jobMacro,
      new Date('2026-09-08T12:00:00Z'),
      [...destinatario, { id: 'recipient-2', numero_id: 'numero-2', numero: '5565000000000' }],
    );
    assert.strictEqual(avaliacaoMulti.ok, false, 'avaliacao direta com varios destinatarios nao deve resolver macro individual');
  } finally {
    crud.listar = listarOriginal;
  }

  console.log('scheduled-question-sql-fixo-guardrail.test.js: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
