'use strict';

/**
 * Testes do guardrail sqlPatternsProibidos que detecta confusao entre SC7.C7_CONAPRO
 * (status de ALCADA/aprovacao) e SC7.C7_APROV (status de ATENDIMENTO/recebimento) —
 * bug real confirmado em producao: pergunta "Meus pedidos de compras aprovados no mes
 * passado" gerou SQL com SC7.C7_APROV = 'L' (campo errado) em vez de
 * SC7.C7_CONAPRO IN ('L','') (campo correto para status de alcada).
 *
 * Causa raiz: o prompt (compras-fragmentos-spec.js) ensinava que C7_CONAPRO usa o valor
 * 'A' para aprovado — esse valor NAO EXISTE no dominio real do campo (confirmado contra
 * documentacao oficial do Protheus: os valores validos sao 'L'/vazio = liberado/aprovado,
 * 'B' = bloqueado, 'R' = rejeitado). Isso, somado a nomenclatura parecida entre C7_APROV
 * e C7_CONAPRO, levou a IA a usar o campo errado com o valor certo ('L').
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const spec = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-ia-owner-spec'));

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

function validar(sql, mensagem) {
  const erros = [];
  for (const regra of spec.sqlPatternsProibidos || []) {
    if (typeof regra.validar === 'function') {
      const msg = regra.validar(sql, mensagem);
      if (msg) erros.push(msg);
    }
  }
  return erros;
}

console.log('\n[1] Bug real: pergunta sobre status de alcada usando C7_APROV em vez de C7_CONAPRO');

ok('"Meus pedidos de compras aprovados no mes passado" + C7_APROV = \'L\' e rejeitado', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_APROV = 'L'
  AND (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0
  AND SC7.C7_EMISSAO BETWEEN '20260801' AND '20260831';`;
  const erros = validar(sql, 'Meus pedidos de compras aprovados no mes passado');
  assert.ok(
    erros.some(e => /C7_APROV/.test(e) && /C7_CONAPRO/.test(e)),
    `esperava erro apontando a troca de campo, obteve: ${JSON.stringify(erros)}`,
  );
});

ok('"pedidos liberados na alcada" + C7_APROV = \'L\' tambem e rejeitado', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7 WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_APROV = 'L';`;
  const erros = validar(sql, 'pedidos liberados na alcada este mes');
  assert.ok(erros.some(e => /C7_APROV/.test(e) && /C7_CONAPRO/.test(e)), `obteve: ${JSON.stringify(erros)}`);
});

console.log('\n[2] Valor inexistente C7_CONAPRO = \'A\'');

ok('C7_CONAPRO = \'A\' e rejeitado (valor nao existe no dominio do campo)', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7 WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO = 'A';`;
  const erros = validar(sql, 'pedidos aprovados');
  assert.ok(erros.some(e => /C7_CONAPRO.*'A'/.test(e) && /INEXISTENTE/i.test(e)), `obteve: ${JSON.stringify(erros)}`);
});

console.log('\n[3] SQL correto — nao deve disparar nenhum dos dois guards novos');

ok('C7_CONAPRO IN (\'L\',\'\') para "pedidos aprovados" passa sem erro', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO IN ('L', '')
  AND SC7.C7_EMISSAO BETWEEN '20260801' AND '20260831';`;
  const erros = validar(sql, 'Meus pedidos de compras aprovados no mes passado');
  assert.ok(!erros.some(e => /C7_CONAPRO/.test(e)), `nao deveria disparar guard de CONAPRO: ${JSON.stringify(erros)}`);
});

ok('C7_APROV = \'L\' para pergunta sobre ATENDIMENTO (nao alcada) nao dispara o guard de troca de campo', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_APROV = 'L'
  AND (SC7.C7_QUANT - SC7.C7_QUJE - SC7.C7_RESIDUO) > 0;`;
  const erros = validar(sql, 'pedidos de compra em aberto para receber nota fiscal');
  assert.ok(!erros.some(e => /C7_APROV/.test(e) && /C7_CONAPRO/.test(e)), `nao deveria disparar: ${JSON.stringify(erros)}`);
});

ok('C7_CONAPRO = \'B\' (bloqueado, valor real e correto) nao dispara nenhum guard novo', () => {
  const sql = `SELECT SC7.C7_NUM FROM SC7990 SC7 WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO = 'B';`;
  const erros = validar(sql, 'pedidos bloqueados');
  assert.ok(!erros.some(e => /C7_CONAPRO.*'A'/.test(e) || (/C7_APROV/.test(e) && /C7_CONAPRO/.test(e))), `obteve: ${JSON.stringify(erros)}`);
});

console.log('\n[4] Campo inexistente SCR.CR_LOJA no JOIN SC7<->SCR');

// Bug real confirmado em producao (intermitente): "Pedidos de compras aprovados no mes
// passado agrupado por dia, aprovador, pedido e valor" gerou SQL com
// SC7.C7_LOJA = SCR.CR_LOJA no JOIN — CR_LOJA nao existe em SCR (confirmado no SX3 real).
// SCR e cabecalho de fluxo de aprovacao (chave: CR_FILIAL + CR_NUM), sem conceito de loja.
ok('JOIN SC7<->SCR usando C7_LOJA = CR_LOJA e rejeitado com erro especifico', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT CONVERT(VARCHAR(10), CAST(SC7.C7_EMISSAO AS DATE), 103) AS dia, SCR.CR_APROV AS aprovador, SC7.C7_NUM AS pedido, SUM(SC7.C7_TOTAL) AS valor
FROM SC7010 SC7
JOIN SCR010 SCR ON SC7.C7_NUM = SCR.CR_NUM AND SC7.C7_LOJA = SCR.CR_LOJA AND SCR.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO IN ('L', '') AND SC7.C7_EMISSAO BETWEEN '20260801' AND '20260831' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY SC7.C7_EMISSAO, SCR.CR_APROV, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados no mes passado agrupado por dia, aprovador, pedido e valor');
  assert.ok(erros.some(e => /CR_LOJA/.test(e) && /INEXISTENTE/i.test(e)), `esperava erro sobre CR_LOJA inexistente, obteve: ${JSON.stringify(erros)}`);
});

ok('JOIN SC7<->SCR correto (so filial+numero) nao dispara o guard de CR_LOJA', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SCR.CR_APROV AS aprovador, SC7.C7_NUM AS pedido, SUM(SC7.C7_TOTAL) AS valor
FROM SCR010 SCR
JOIN SC7010 SC7 ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SC7.C7_CONAPRO IN ('L','') AND SC7.D_E_L_E_T_ = ' '
WHERE SCR.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY SCR.CR_APROV, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados no mes passado agrupado por aprovador, pedido e valor');
  assert.ok(!erros.some(e => /CR_LOJA/.test(e)), `nao deveria disparar guard de CR_LOJA: ${JSON.stringify(erros)}`);
});

console.log('\n[5] COUNT(*) usado em vez de SUM(valor) ao agrupar por numero de pedido');

// Bug real confirmado em producao, intermitente: "Pedidos de compras aprovados do mes
// agrupados por nome do aprovador e numero de pedido" gerou SQL com COUNT(*) AS total,
// exibido como "R$ 181,00" — era contagem de 47 documentos, nao valor monetario somado.
ok('SC7 agrupado por numero de pedido com COUNT(*) e rejeitado quando a pergunta nao pede contagem', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SCR.CR_APROV AS aprovador, SC7.C7_NUM AS pedido, COUNT(*) AS total
FROM SC7010 SC7
JOIN SCR010 SCR ON SC7.C7_NUM = SCR.CR_NUM AND SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03' AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY SCR.CR_APROV, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados do mes agrupados por nome do aprovador e numero de pedido');
  assert.ok(erros.some(e => /COUNT\(\*\)/.test(e) && /SUM/.test(e)), `esperava erro de COUNT(*) vs SUM, obteve: ${JSON.stringify(erros)}`);
});

ok('SC7 agrupado por numero de pedido com SUM(valor) correto nao dispara o guard quando nao pede nome', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SCR.CR_APROV AS aprovador, SC7.C7_NUM AS pedido, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SC7010 SC7
JOIN SCR010 SCR ON SC7.C7_NUM = SCR.CR_NUM AND SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY SCR.CR_APROV, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados do mes agrupados por aprovador e numero de pedido');
  assert.ok(!erros.some(e => /COUNT\(\*\)/.test(e)), `nao deveria disparar: ${JSON.stringify(erros)}`);
});

ok('"quantos pedidos" com COUNT(*) nao dispara o guard (contagem foi pedida explicitamente)', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SCR.CR_APROV AS aprovador, SC7.C7_NUM AS pedido, COUNT(*) AS total
FROM SC7010 SC7
JOIN SCR010 SCR ON SC7.C7_NUM = SCR.CR_NUM AND SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY SCR.CR_APROV, SC7.C7_NUM;`;
  const erros = validar(sql, 'Quantos pedidos de compra foram aprovados por aprovador e numero de pedido');
  assert.ok(!erros.some(e => /COUNT\(\*\)/.test(e)), `nao deveria disparar quando a pergunta pede contagem explicita: ${JSON.stringify(erros)}`);
});

ok('pedidos aprovados por nome do aprovador e dia com COUNT(*) e rejeitado quando nao pede contagem', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SC7.C7_EMISSAO AS dia, COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, COUNT(*) AS total_pedidos
FROM SC7010 SC7
JOIN SCR010 SCR ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03' AND SCR.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY SC7.C7_EMISSAO, SAK.AK_NOME, SCR.CR_APROV
ORDER BY SC7.C7_EMISSAO;`;
  const erros = validar(sql, 'Pedidos de compras aprovados neste mes agrupado por nome do aprovador e por dia');
  assert.ok(erros.some(e => /COUNT\(\*\)/.test(e) && /SUM\(SC7\.C7_TOTAL\)/.test(e)), `esperava erro de COUNT(*) vs SUM, obteve: ${JSON.stringify(erros)}`);
});

console.log('\n[6] Qualquer alias "AS aprovador" sem tabela SCR e rejeitado, nao so C7_CONAPRO/C7_APROV');

// Bug real confirmado em producao, RECORRENTE (2 ocorrencias reais): apos o guard [1]
// bloquear C7_CONAPRO/C7_APROV como "aprovador", a IA arranjou uma TERCEIRA fonte errada:
// SA2.A2_NOME (nome do FORNECEDOR do pedido, via JOIN SC7->SA2, sem nenhum SCR) projetado
// com o mesmo alias mentiroso "AS aprovador". A resposta mostrou nomes de FORNECEDOR como
// se fossem aprovadores (ex.: "SILMAR BATISTA CAMILO", "COPABO INDUSTRIA...").
ok('SA2.A2_NOME AS aprovador (fornecedor disfarcado, sem JOIN com SCR) e rejeitado', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SC7.C7_NUM AS pedido, SC7.C7_TOTAL AS valor, SA2.A2_NOME AS aprovador
FROM SC7010 SC7
JOIN SA2010 SA2 ON SC7.C7_FORNECE = SA2.A2_COD AND SC7.C7_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' ' AND SC7.C7_CONAPRO IN ('L', '') AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY SC7.C7_NUM, SC7.C7_TOTAL, SA2.A2_NOME;`;
  const erros = validar(sql, 'Pedidos de compras aprovados no mes agrupados por nome do aprovador, numero de pedido e valor');
  assert.ok(
    erros.some(e => /SA2\.A2_NOME/.test(e) && /SCR/.test(e)),
    `esperava erro apontando fonte errada sem SCR, obteve: ${JSON.stringify(erros)}`,
  );
});

ok('qualquer campo AS aprovador sem SCR e rejeitado, mesmo campos nao previstos explicitamente', () => {
  const sql = `SELECT SC7.C7_FORNECE AS aprovador, SC7.C7_NUM AS pedido FROM SC7990 SC7 WHERE SC7.D_E_L_E_T_ = ' ';`;
  const erros = validar(sql, 'pedidos aprovados por aprovador');
  assert.ok(erros.some(e => /SC7\.C7_FORNECE/.test(e) && /SCR/.test(e)), `obteve: ${JSON.stringify(erros)}`);
});

ok('SC7.C7_CONAPRO AS nome_do_aprovador e rejeitado (status disfarcado de pessoa)', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SC7.C7_NUM AS numero_pedido, SC7.C7_EMISSAO AS dia, SC7.C7_CONAPRO AS nome_do_aprovador
FROM SC7010 SC7
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_CONAPRO IN ('L', '')
  AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY SC7.C7_CONAPRO, SC7.C7_EMISSAO, SC7.C7_NUM
ORDER BY SC7.C7_EMISSAO, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados neste mes agrupado por nome do aprovador, por dia e numero de pedido');
  assert.ok(erros.some(e => /C7_CONAPRO/.test(e) && /STATUS/.test(e) && /SAK/.test(e)), `esperava erro sobre status como aprovador, obteve: ${JSON.stringify(erros)}`);
});

ok('SQL correto com SCR e SAK.AK_NOME AS aprovador nao dispara o guard', () => {
  const sql = `SELECT COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, SC7.C7_NUM AS pedido, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SCR010 SCR
JOIN SC7010 SC7 ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SC7.C7_CONAPRO IN ('L','') AND SC7.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SCR.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY COALESCE(SAK.AK_NOME, SCR.CR_APROV), SC7.C7_NUM;`;
  const erros = validar(sql, 'pedidos aprovados por nome do aprovador');
  assert.ok(!erros.some(e => /AS aprovador/.test(e) && /fonte ERRADA/.test(e)), `nao deveria disparar: ${JSON.stringify(erros)}`);
});

console.log('\n[7] Nome do aprovador exige SAK.AK_NOME quando pedido explicitamente');

ok('SCR.CR_APROV AS aprovador e rejeitado quando o usuario pede nome do aprovador', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SCR.CR_APROV AS aprovador, SC7.C7_NUM AS pedido, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SCR010 SCR
JOIN SC7010 SC7 ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SC7.C7_CONAPRO IN ('L','') AND SC7.D_E_L_E_T_ = ' '
WHERE SCR.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY SCR.CR_APROV, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados do mes agrupados por nome do aprovador e numero de pedido');
  assert.ok(erros.some(e => /NOME do aprovador/i.test(e) && /SAK\.AK_NOME/.test(e)), `esperava erro exigindo SAK.AK_NOME, obteve: ${JSON.stringify(erros)}`);
});

ok('SCR.CR_APROV AS nome_do_aprovador tambem e rejeitado quando usuario pede nome', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SCR.CR_APROV AS nome_do_aprovador, SC7.C7_NUM AS pedido, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SCR010 SCR
JOIN SC7010 SC7 ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SC7.C7_CONAPRO IN ('L','') AND SC7.D_E_L_E_T_ = ' '
WHERE SCR.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY SCR.CR_APROV, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados do mes agrupados por nome do aprovador e numero de pedido');
  assert.ok(erros.some(e => /NOME do aprovador/i.test(e) && /SAK\.AK_NOME/.test(e)), `esperava erro exigindo SAK.AK_NOME, obteve: ${JSON.stringify(erros)}`);
});

ok('COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador passa quando usuario pede nome do aprovador', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, SC7.C7_NUM AS pedido, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SCR010 SCR
JOIN SC7010 SC7 ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SC7.C7_CONAPRO IN ('L','') AND SC7.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SCR.D_E_L_E_T_ = ' ' AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'
GROUP BY COALESCE(SAK.AK_NOME, SCR.CR_APROV), SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compras aprovados do mes agrupados por nome do aprovador e numero de pedido');
  assert.ok(!erros.some(e => /NOME do aprovador/i.test(e) && /SAK\.AK_NOME/.test(e)), `nao deveria disparar guard de nome: ${JSON.stringify(erros)}`);
});

console.log('\n[8] SCR em pedido de compra exige CR_TIPO=PC e, para aprovados, CR_STATUS=03');

// Bug real confirmado entre canais: a mesma pergunta no WhatsApp trouxe CR_STATUS = '03',
// enquanto o Chat Protheus omitiu esse filtro e inflou SUM(SC7.C7_TOTAL) por repetir o
// pedido em varias linhas/status do fluxo SCR.
ok('SQL do Chat sem SCR.CR_STATUS = \'03\' e rejeitado para pedidos aprovados', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT CONVERT(VARCHAR(10), CAST(SC7.C7_EMISSAO AS DATE), 103) AS dia, SC7.C7_NUM AS numero_pedido, COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SC7010 SC7
JOIN SCR010 SCR ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SCR.CR_TIPO = 'PC' AND SCR.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY CONVERT(VARCHAR(10), CAST(SC7.C7_EMISSAO AS DATE), 103), SC7.C7_NUM, SCR.CR_APROV, SAK.AK_NOME
ORDER BY dia, numero_pedido;`;
  const erros = validar(sql, 'Pedidos de compra aprovados neste mes agrupado por nome do aprovador, por dia e por numero do pedido de compra');
  assert.ok(erros.some(e => /CR_STATUS\s*=\s*'03'/.test(e) && /infla SUM/.test(e)), `esperava erro exigindo CR_STATUS, obteve: ${JSON.stringify(erros)}`);
});

ok('SQL com SCR em pedido de compra sem SCR.CR_TIPO = \'PC\' e rejeitado', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SC7.C7_NUM AS numero_pedido, SC7.C7_EMISSAO AS dia, COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SC7010 SC7
JOIN SCR010 SCR ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SCR.CR_STATUS = '03' AND SCR.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY SC7.C7_NUM, SC7.C7_EMISSAO, SAK.AK_NOME, SCR.CR_APROV;`;
  const erros = validar(sql, 'Pedidos de compra aprovados neste mes agrupado por nome do aprovador, por dia e por numero do pedido de compra');
  assert.ok(erros.some(e => /CR_TIPO\s*=\s*'PC'/.test(e)), `esperava erro exigindo CR_TIPO=PC, obteve: ${JSON.stringify(erros)}`);
});

ok('SQL real com LEFT JOIN SCR incompleto e dia por emissao e rejeitado com orientacoes especificas', () => {
  const sql = `SET ROWCOUNT 50000;
SELECT COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, CONVERT(VARCHAR(10), CAST(SC7.C7_EMISSAO AS DATE), 103) AS dia, SC7.C7_NUM AS numero_pedido, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SC7010 SC7
LEFT JOIN SCR010 SCR ON SC7.C7_NUM = SCR.CR_NUM AND SC7.C7_FILIAL = SCR.CR_FILIAL AND SCR.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_CONAPRO IN ('L', '')
  AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY COALESCE(SAK.AK_NOME, SCR.CR_APROV), SC7.C7_EMISSAO, SC7.C7_NUM
ORDER BY aprovador, dia, numero_pedido;`;
  const erros = validar(sql, 'Pedidos de compra aprovados neste mes agrupado por nome do aprovador, por dia e por numero do pedido de compra');
  assert.ok(erros.some(e => /CR_STATUS\s*=\s*'03'/.test(e)), `esperava erro exigindo CR_STATUS=03, obteve: ${JSON.stringify(erros)}`);
  assert.ok(erros.some(e => /CR_TIPO\s*=\s*'PC'/.test(e)), `esperava erro exigindo CR_TIPO=PC, obteve: ${JSON.stringify(erros)}`);
  assert.ok(erros.some(e => /SC7\.C7_EMISSAO/.test(e) && /SCR\.CR_DATALIB/.test(e)), `esperava erro exigindo dia por CR_DATALIB, obteve: ${JSON.stringify(erros)}`);
});

ok('SQL de pedidos aprovados com SCR.CR_TIPO = \'PC\' e SCR.CR_STATUS = \'03\' passa', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT SC7.C7_NUM AS numero_pedido, CONVERT(VARCHAR(10), CAST(SCR.CR_DATALIB AS DATE), 103) AS dia, COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, SUM(SC7.C7_TOTAL) AS valor_pedido
FROM SC7010 SC7
JOIN SCR010 SCR ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03' AND SCR.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SCR.CR_DATALIB BETWEEN '20260901' AND '20260930'
GROUP BY SC7.C7_NUM, SCR.CR_DATALIB, SAK.AK_NOME, SCR.CR_APROV
ORDER BY dia, aprovador;`;
  const erros = validar(sql, 'Pedidos de compra aprovados neste mes agrupado por nome do aprovador, por dia e por numero do pedido de compra');
  assert.ok(!erros.some(e => /CR_STATUS\s*=\s*'03'|CR_TIPO\s*=\s*'PC'|SCR\.CR_DATALIB/.test(e)), `nao deveria disparar guard de filtros SCR/data: ${JSON.stringify(erros)}`);
});

console.log('\n[9] SCR nao aceita campos C7_* e pedido agrupado precisa de valor');

ok('JOIN SC7<->SCR usando SCR.C7_NUM e rejeitado com erro especifico', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, CONVERT(VARCHAR(10), CAST(SC7.C7_EMISSAO AS DATE), 103) AS dia, SC7.C7_NUM AS numero_pedido
FROM SC7010 SC7
LEFT JOIN SCR SCR ON SC7.C7_NUM = SCR.C7_NUM AND SCR.D_E_L_E_T_ = ' '
LEFT JOIN SAK SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_CONAPRO IN ('L', '')
  AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
  AND SCR.CR_STATUS = '03'
  AND SCR.CR_TIPO = 'PC'
GROUP BY COALESCE(SAK.AK_NOME, SCR.CR_APROV), SC7.C7_EMISSAO, SC7.C7_NUM
ORDER BY SC7.C7_EMISSAO, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compra aprovados neste mes agrupado por nome do aprovador, por dia e por numero do pedido de compra');
  assert.ok(erros.some(e => /SCR\.C7_NUM/.test(e) && /INEXISTENTE/.test(e) && /SCR\.CR_NUM/.test(e)), `esperava erro de SCR.C7_NUM inexistente, obteve: ${JSON.stringify(erros)}`);
});

ok('pedido aprovado agrupado por pedido/dia/aprovador sem SUM(SC7.C7_TOTAL) e rejeitado', () => {
  const sql = `SET ROWCOUNT 10000;
SELECT COALESCE(SAK.AK_NOME, SCR.CR_APROV) AS aprovador, CONVERT(VARCHAR(10), CAST(SC7.C7_EMISSAO AS DATE), 103) AS dia, SC7.C7_NUM AS numero_pedido
FROM SC7010 SC7
JOIN SCR010 SCR ON SCR.CR_FILIAL = SC7.C7_FILIAL AND SCR.CR_NUM = SC7.C7_NUM AND SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03' AND SCR.D_E_L_E_T_ = ' '
LEFT JOIN SAK010 SAK ON SCR.CR_APROV = SAK.AK_COD AND SAK.D_E_L_E_T_ = ' '
WHERE SC7.D_E_L_E_T_ = ' '
  AND SC7.C7_CONAPRO IN ('L', '')
  AND SC7.C7_EMISSAO BETWEEN '20260901' AND '20260930'
GROUP BY COALESCE(SAK.AK_NOME, SCR.CR_APROV), SC7.C7_EMISSAO, SC7.C7_NUM
ORDER BY SC7.C7_EMISSAO, SC7.C7_NUM;`;
  const erros = validar(sql, 'Pedidos de compra aprovados neste mes agrupado por nome do aprovador, por dia e por numero do pedido de compra');
  assert.ok(erros.some(e => /sem exibir o valor do pedido/.test(e) && /SUM\(SC7\.C7_TOTAL\)/.test(e)), `esperava erro exigindo valor_pedido, obteve: ${JSON.stringify(erros)}`);
});

if (falhou === 0) {
  console.log(`\n${'─'.repeat(60)}\ncompras-conapro-vs-aprov.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`\n${'─'.repeat(60)}\ncompras-conapro-vs-aprov.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
