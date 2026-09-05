'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const spec = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-ia-owner-spec'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));

const mensagem = 'Pedidos de compra aprovados neste mes agrupados por nome do aprovador, por dia e por numero do pedido de compra';

const sqlRuimCaieira = `SET ROWCOUNT 10000;
WITH liberacoes AS (
  SELECT DISTINCT SCR.CR_FILIAL, SCR.CR_NUM, SCR.CR_APROV, SCR.CR_DATALIB
  FROM SCR010 SCR
  WHERE SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03' AND SCR.D_E_L_E_T_ = ' '
)
SELECT COALESCE(SAK.AK_NOME, L.CR_APROV) AS aprovador,
       CONVERT(VARCHAR(10), CAST(L.CR_DATALIB AS DATE), 103) AS dia,
       L.CR_NUM AS numero_pedido,
       SUM(SC7.C7_TOTAL) AS valor_pedido
FROM liberacoes L
JOIN SC7010 SC7 ON L.CR_FILIAL = SC7.C7_FILIAL AND L.CR_NUM = SC7.C7_NUM AND SC7.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON L.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE L.CR_DATALIB BETWEEN '20260901' AND '20260930'
GROUP BY COALESCE(SAK.AK_NOME, L.CR_APROV), L.CR_DATALIB, L.CR_NUM
ORDER BY aprovador, dia, numero_pedido;`;

(async () => {
  const corrigido = await spec.validarCorrigirSqlGerado({
    sql: sqlRuimCaieira,
    mensagem,
    contexto: {
      periodo: null,
      sx2: { SC7010: {}, SCR010: {}, SAK010: {} },
    },
    fase1: { periodo: { dataInicio: '20260901', dataFim: '20260930' } },
    helpers: {
      tabelaFisicaSX2: (sx2, base) => ({ SC7: 'SC7010', SCR: 'SCR010', SAK: 'SAK010' }[base] || null),
    },
  });

  assert.ok(corrigido && corrigido.sql, 'esperava SQL deterministico corrigido');
  assert.ok(/FROM SC7010 SC7/i.test(corrigido.sql), 'esperava SC7 fisica');
  assert.ok(/FROM SCR010 SCR/i.test(corrigido.sql), 'esperava SCR fisica');
  assert.ok(/LEFT JOIN SAK010 SAK/i.test(corrigido.sql), 'esperava SAK fisica');
  assert.ok(/WITH pedidos AS/i.test(corrigido.sql), 'esperava CTE pedidos');
  assert.ok(/WITH pedidos AS[\s\S]*SUM\s*\(\s*SC7\s*\.\s*C7_TOTAL\s*\)\s+AS\s+valor_pedido/i.test(corrigido.sql), 'esperava soma apenas na CTE pedidos');
  assert.ok(/liberacoes AS[\s\S]*SELECT DISTINCT SCR\.CR_FILIAL/i.test(corrigido.sql), 'esperava SCR deduplicado');
  assert.ok(/SC7\.C7_CONAPRO\s+IN\s*\(\s*'L'\s*,\s*''\s*\)/i.test(corrigido.sql), 'esperava filtro C7_CONAPRO aprovado');
  assert.ok(!/SUM\s*\(\s*SC7\s*\.\s*C7_TOTAL\s*\)/i.test(spec._test.selectPrincipalSql(corrigido.sql)), 'nao deve somar SC7 no select principal');

  const validacao = runner._test.validarSqlIaOwnerBasico(
    corrigido.sql,
    spec,
    { SC7010: 'E', SCR010: 'E', SAK010: 'E' },
    mensagem,
  );

  assert.strictEqual(validacao.ok, true, `SQL corrigido deveria passar no contrato: ${JSON.stringify(validacao)}`);
  console.log('compras-validar-corrigir-systemprompt: ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
