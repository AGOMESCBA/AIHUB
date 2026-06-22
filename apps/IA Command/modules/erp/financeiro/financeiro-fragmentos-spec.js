'use strict';

/**
 * Fragmentos de regrasTecnicas do financeiro, organizados por sub-operacao
 * (saldo bancario, fluxo projetado, fluxo realizado, a receber, a pagar, etc.)
 * em vez de um unico bloco monolitico.
 *
 * Cada fragmento e o texto LITERAL das secoes "## Titulo" correspondentes do
 * spec consolidado — a concatenacao de TODOS os fragmentos (fallback, quando
 * a pergunta nao classifica em nenhuma sub-operacao especifica) reproduz
 * exatamente o regrasTecnicas anterior, byte a byte, preservando os 44
 * arquivos de teste existentes.
 *
 * keywords: regex que, ao casar com a mensagem do usuario, aciona o fragmento.
 * excluiSe: regex que, se casar, desativa o fragmento mesmo que keywords tenha batido
 *           (resolve ambiguidade entre fragmentos vizinhos, ex: saldo_bancario vs fluxo_caixa_projetado).
 * requerJunto: outros fragmentos que devem ser injetados sempre que este for acionado
 *              (ex: fluxo_caixa_projetado depende de saldo_bancario + receber_posicao + pagar_posicao).
 */

function base({ usaFK1, usaFK2 }) {
  return `
## Campos de data padrao
- Vencimento a pagar: SE2.E2_VENCREA (ou SE2.E2_VENCTO se VENCREA nao existir).
- Vencimento a receber: SE1.E1_VENCREA (ou SE1.E1_VENCTO se VENCREA nao existir).
- Baixa/recebimento real: use o JOIN definido em "Joins padrao" (SE1->${usaFK1 ? 'FK1' : 'SE5'}), modelo deste tenant: ${usaFK1 ? 'FK1' : 'SE5'}. NUNCA use SE1.E1_BAIXA.
- Baixa/pagamento real: use o JOIN definido em "Joins padrao" (SE2->${usaFK2 ? 'FK2' : 'SE5'}), modelo deste tenant: ${usaFK2 ? 'FK2' : 'SE5'}. NUNCA use SE2.E2_BAIXA.
- Em aberto sem periodo explicito: consulte toda a carteira em aberto (sem BETWEEN).

## Tabelas padrao do modulo Financeiro
- SE1: contas a receber.
- SE2: contas a pagar.
- SE5: movimentos/baixas financeiras (modelo_baixas deste tenant).${usaFK1 || usaFK2 ? '\n- FK1/FK2: familia moderna de baixas/movimentos deste tenant.' : ''}
- SE8: saldos bancarios.
- SA1: clientes.
- SA2: fornecedores.
- SA3: vendedores.
- SA6: bancos/contas.
- SED: natureza financeira.

## Joins padrao
- SE1 -> SA1: SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA.
- SE2 -> SA2: SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA.
- SE1 -> SED: SE1.E1_NATUREZ = SED.ED_CODIGO.
- SE2 -> SED: SE2.E2_NATUREZ = SED.ED_CODIGO.
- SE1 -> SA3: SE1.E1_VEND1 = SA3.A3_COD quando a pergunta pedir vendedor.
- SE8 -> SA6: SE8.E8_BANCO = SA6.A6_COD AND SE8.E8_AGENCIA = SA6.A6_AGENCIA AND SE8.E8_CONTA = SA6.A6_NUMCON.${usaFK1 ? '\n- SE1 -> FK1 (recebimentos realizados, modelo FK moderno): JOIN FK1xxx FK1 ON FK1.FK1_FILIAL = SE1.E1_FILIAL AND FK1.FK1_PREFIXO = SE1.E1_PREFIXO AND FK1.FK1_NUM = SE1.E1_NUM AND FK1.FK1_PARCELA = SE1.E1_PARCELA AND FK1.FK1_TIPO = SE1.E1_TIPO AND FK1.D_E_L_E_T_ = \' \'; filtre FK1.FK1_DATA no periodo; some FK1.FK1_VALOR. OBRIGATORIO: WHERE da subquery deve incluir SE1.D_E_L_E_T_ = \' \'.' : '\n- SE1 -> SE5 (recebimentos realizados): JOIN SE5xxx SE5 ON SE5.E5_FILIAL = SE1.E1_FILIAL AND SE5.E5_PREFIXO = SE1.E1_PREFIXO AND SE5.E5_NUMERO = SE1.E1_NUM AND SE5.E5_PARCELA = SE1.E1_PARCELA AND SE5.E5_TIPO = SE1.E1_TIPO AND SE5.E5_CLIFOR = SE1.E1_CLIENTE AND SE5.E5_LOJA = SE1.E1_LOJA AND SE5.E5_RECPAG = \'R\' AND SE5.E5_SITUACAO <> \'C\' AND SE5.E5_TIPO NOT IN (\'EST\', \'ED\') AND SE5.D_E_L_E_T_ = \' \'; filtre SE5.E5_DATA no periodo; some SE5.E5_VALOR. NAO filtre SE1.E1_SITUACAO (titulo pode ter baixa parcial). OBRIGATORIO: WHERE da subquery deve incluir SE1.D_E_L_E_T_ = \' \'.'}${usaFK2 ? '\n- SE2 -> FK2 (pagamentos realizados, modelo FK moderno): JOIN FK2xxx FK2 ON FK2.FK2_FILIAL = SE2.E2_FILIAL AND FK2.FK2_PREFIXO = SE2.E2_PREFIXO AND FK2.FK2_NUM = SE2.E2_NUM AND FK2.FK2_PARCELA = SE2.E2_PARCELA AND FK2.FK2_TIPO = SE2.E2_TIPO AND FK2.D_E_L_E_T_ = \' \'; filtre FK2.FK2_DATA no periodo; some FK2.FK2_VALOR. OBRIGATORIO: WHERE da subquery deve incluir SE2.D_E_L_E_T_ = \' \'.' : '\n- SE2 -> SE5 (pagamentos realizados): JOIN SE5xxx SE5 ON SE5.E5_FILIAL = SE2.E2_FILIAL AND SE5.E5_PREFIXO = SE2.E2_PREFIXO AND SE5.E5_NUMERO = SE2.E2_NUM AND SE5.E5_PARCELA = SE2.E2_PARCELA AND SE5.E5_TIPO = SE2.E2_TIPO AND SE5.E5_CLIFOR = SE2.E2_FORNECE AND SE5.E5_LOJA = SE2.E2_LOJA AND SE5.E5_RECPAG = \'P\' AND SE5.E5_SITUACAO <> \'C\' AND SE5.E5_TIPO NOT IN (\'EST\', \'ED\') AND SE5.D_E_L_E_T_ = \' \'; filtre SE5.E5_DATA no periodo; some SE5.E5_VALOR. NAO filtre SE2.E2_SITUACAO (titulo pode ter baixa parcial). OBRIGATORIO: WHERE da subquery deve incluir SE2.D_E_L_E_T_ = \' \'.'}

## Regras obrigatorias de SQL
- Inicie sempre com SET ROWCOUNT 50000.
- Use aliases explicitos iguais a base da tabela: SE1, SE2, SE5, SE8, SA1, SA2, SA3, SA6, SED${usaFK1 || usaFK2 ? ', FK1, FK2' : ''}. Vale em toda query, inclusive dentro de subqueries escalares — o alias no FROM e o qualificador dos campos devem ser identicos.
- Qualifique campos sempre pelo alias base (SE2.E2_SALDO, nunca SE2990.E2_SALDO).
- Nao crie filtros cadastrais vazios do tipo IN (SELECT codigo FROM cadastro WHERE codigo IS NOT NULL).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.

## Exibicao de entidades
- fornecedor: SA2.A2_NOME AS fornecedor. Codigo/loja como cod_fornecedor e loja_fornecedor.
- cliente: SA1.A1_NOME AS cliente. Codigo/loja como cod_cliente e loja_cliente.
- natureza: SED.ED_DESCRIC AS natureza.
- vendedor: SA3.A3_NOME AS vendedor.
- banco: SA6.A6_NOME AS banco.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.
`;
}

function receberPosicao() {
  return `
## Contas a receber — posicao/em aberto
- Contas a receber usa SE1 e cliente SA1.
- Saldo a receber/em aberto: SE1.E1_SALDO, com SE1.E1_SALDO > 0. Titulos com E1_SALDO = 0 ja foram recebidos — nunca os inclua em consultas de aberto. Data padrao de vencimento: SE1.E1_VENCREA ou SE1.E1_VENCTO se VENCREA nao existir. NAO filtre SE1.E1_SITUACAO.
- Natureza financeira: SE1.E1_NATUREZ -> SED.ED_CODIGO.
- saldo_a_receber: COALESCE(SUM(SE1.E1_SALDO),0) AS saldo_a_receber.
- "por cliente": agrupe por SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
`;
}

function receberRealizado({ usaFK1 }) {
  return `
## Contas a receber — realizado
- Valor recebido/liquidado/baixado: use JOIN de "Joins padrao" (SE1->FK1 ou SE1->SE5) conforme modelo_baixas_receber. NUNCA filtre por E1_BAIXA, E1_EMISSAO, E1_VENCREA ou E1_VENCTO.
- valor_recebido: COALESCE(SUM(${usaFK1 ? 'FK1.FK1_VALOR' : 'SE5.E5_VALOR'}),0) AS valor_recebido via JOIN "${usaFK1 ? 'SE1 -> FK1' : 'SE1 -> SE5'}" de "Joins padrao".
`;
}

function pagarPosicao() {
  return `
## Contas a pagar — posicao/em aberto
- Contas a pagar usa SE2 e fornecedor SA2.
- Saldo a pagar/em aberto: SE2.E2_SALDO, com SE2.E2_SALDO > 0. Titulos com E2_SALDO = 0 ja foram pagos — nunca os inclua em consultas de aberto. Data padrao de vencimento: SE2.E2_VENCREA ou SE2.E2_VENCTO se VENCREA nao existir.
- Natureza financeira: SE2.E2_NATUREZ -> SED.ED_CODIGO.
- saldo_a_pagar: COALESCE(SUM(SE2.E2_SALDO),0) AS saldo_a_pagar.
- "por fornecedor": agrupe por SA2.A2_COD, SA2.A2_LOJA, SA2.A2_NOME.
`;
}

function pagarRealizado({ usaFK2 }) {
  return `
## Contas a pagar — realizado
- Valor pago/liquidado/baixado: use JOIN de "Joins padrao" (SE2->FK2 ou SE2->SE5) conforme modelo_baixas_pagar. NUNCA filtre por E2_BAIXA, E2_EMISSAO, E2_VENCREA ou E2_VENCTO.
- valor_pago: COALESCE(SUM(${usaFK2 ? 'FK2.FK2_VALOR' : 'SE5.E5_VALOR'}),0) AS valor_pago via JOIN "${usaFK2 ? 'SE2 -> FK2' : 'SE2 -> SE5'}" de "Joins padrao".
`;
}

function comparacaoPagarXReceber({ usaFK1, usaFK2 }) {
  return `
## Comparacao/combinacao pagar x receber
- REGRA ABSOLUTA — SE1 e SE2 sao carteiras independentes, nunca relacionadas entre si: PROIBIDO fazer JOIN (INNER, LEFT, RIGHT, CROSS ou qualquer tipo) entre SE1 e SE2, mesmo que as chaves parecam existir. Nao existe titulo a pagar que "corresponda" a um titulo a receber — qualquer JOIN entre elas produz produto cartesiano multiplicando os valores e gerando resultado incorreto.
- EXEMPLO ERRADO — nunca faca isso: SELECT SUM(SE2.E2_SALDO), SUM(SE1.E1_SALDO) FROM SE2xxx SE2 LEFT JOIN SE1xxx SE1 ON SE1.D_E_L_E_T_ = ' ' — mesmo com condicao no ON, o JOIN cruza todas as linhas de SE2 com todas as de SE1, inflando os valores.
- EXEMPLO CORRETO para total de ambas em posicao/em_aberto: use UNION ALL com dois SELECTs independentes — SELECT 'pagar' AS carteira, COALESCE(SUM(SE2.E2_SALDO),0) AS saldo FROM SE2xxx SE2 WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 UNION ALL SELECT 'receber', COALESCE(SUM(SE1.E1_SALDO),0) FROM SE1xxx SE1 WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0.
- Se o usuario pedir ambas realizadas (recebidas e pagas): gere UM UNICO SELECT com duas subqueries escalares — valor_recebido via SE1+SE5/${usaFK1 ? 'FK1' : 'SE5'} e valor_pago via SE2+SE5/${usaFK2 ? 'FK2' : 'SE5'}. PROIBIDO UNION ALL para realizados. Siga o plano estruturado query_plan_texto.
- Nao misture SA1 como fornecedor nem SA2 como cliente.
- "por cliente E fornecedor" simultaneamente (ex: "detalhe por cliente e fornecedor", "por entidade"): PROIBIDO combinar SE1 e SE2 em uma unica query. Gere UNION ALL com dois blocos independentes — bloco 1: SE1 agrupado por SA1.A1_NOME (carteira receber); bloco 2: SE2 agrupado por SA2.A2_NOME (carteira pagar). Inclua coluna carteira para distinguir os blocos. Herde o periodo do contexto anterior.
`;
}

function saldoBancario() {
  return `
## Saldo bancario
- Saldo bancario e operacao propria. Nao trate como simples contas a pagar/receber.
- Saldo bancario puro usa SOMENTE SE8 e SA6. Nao inclua SE1/SE2/SE5/FK em saldo bancario puro.

## Dicionario SE8 (saldos bancarios)
- E8_BANCO: codigo do banco (equivalente a SA6.A6_COD).
- E8_AGENCIA: agencia bancaria.
- E8_CONTA: numero da conta.
- E8_SALATUA: saldo atual da conta naquela data de posicao.
- E8_DTSALAT: data da posicao do saldo (formato YYYYMMDD). Cada conta pode ter multiplas linhas — uma por data de atualizacao.

## Regras tecnicas obrigatorias — SE8
- REGRA ABSOLUTA — posicao mais recente por conta: SE8 registra o saldo de cada conta por data — pode haver multiplas linhas por conta. E OBRIGATORIO filtrar sempre pela posicao mais recente usando ROW_NUMBER():
  data_referencia = data pedida pelo usuario (se informada) OU data_atual (se nao informada).
  Padrao obrigatorio:
    WITH saldo_recente AS (
      SELECT E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA, E8_SALATUA, E8_DTSALAT,
             ROW_NUMBER() OVER (PARTITION BY E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC) AS rn
      FROM SE8xxx SE8
      WHERE SE8.D_E_L_E_T_ = ' ' AND SE8.E8_DTSALAT <= 'data_referencia_YYYYMMDD'
    )
    SELECT ... FROM saldo_recente SE8 JOIN SA6xxx SA6 ... WHERE SE8.rn = 1
  Tambem e aceito subquery com MAX(E8_DTSALAT) GROUP BY (E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA).
  PROIBIDO retornar todas as linhas de SE8 sem esse filtro — gera saldo inflado por duplicidade de datas.
- REGRA CRITICA — filtro de banco: codigos de banco informados pelo usuario sao valores de SE8.E8_BANCO (e de SA6.A6_COD). NUNCA filtre por SA6.A6_NOME — o nome e descricao para exibicao, nao identificador. Aplique inclusao/exclusao sempre por codigo: SE8.E8_BANCO NOT IN (...).
- REGRA ABSOLUTA — bancos bloqueados: SEMPRE inclua AND SA6.A6_BLOCKED <> '1' no JOIN ou WHERE da SA6. Bancos bloqueados NUNCA devem aparecer em nenhuma consulta, independente do que o usuario pedir.
- PROIBIDO usar SE5/FK em saldo bancario puro.
`;
}

function fluxoCaixaProjetado() {
  return `
## Fluxo de caixa projetado
- Caso na pergunta do usuario esteja somente "fluxo de caixa" sem qualificador, entenda como fluxo de caixa projetado.
- Fluxo de caixa projetado e operacao propria. Nao trate como simples contas a pagar/receber.
- Fluxo de caixa projetado = saldo_bancario_base + saldo_a_receber_projetado - saldo_a_pagar_projetado. Fluxo projetado usa titulos em aberto: SE1.E1_SALDO > 0 e SE2.E2_SALDO > 0, por vencimento futuro/periodo solicitado. NUNCA use SE5/FK no fluxo projetado — SE5/FK sao baixas ja realizadas, nao projecao. Se o periodo projetado comecar antes da data atual, considere titulos a partir da data atual.
- REGRA ABSOLUTA — calcule cada componente em CTE/subquery ESCALAR SEPARADA, sem JOIN entre elas: uma CTE/subquery para saldo_bancario_base (SE8+SA6), outra para saldo_a_receber_projetado (SUM de SE1.E1_SALDO agrupado por data de vencimento, se detalhado por periodo), outra para saldo_a_pagar_projetado (SUM de SE2.E2_SALDO agrupado por data de vencimento). PROIBIDO fazer JOIN entre SE8 e SE1/SE2 — nao existe chave relacional entre saldo bancario (numero de conta) e titulos (data de vencimento). Combine os componentes apenas no SELECT final, por data quando detalhado por dia/mes, ou em uma unica linha quando sintetico.
- Datas SEMPRE no formato Protheus CHAR(8) YYYYMMDD (ex: '20260622'). PROIBIDO usar formato 'YYYY-MM-DD' ou CONVERT/CAST para DATE em comparacoes — os campos de data do Protheus sao strings YYYYMMDD, comparacao deve ser feita como string.
- O periodo (dia, mes, ano, ou intervalo arbitrario) e definido pela pergunta do usuario e deve ser aplicado de forma CONSISTENTE as fontes envolvidas — nunca calcule saldo bancario em uma data e receber/pagar em outra data diferente.
- saldo_bancario_base deve ser a ultima posicao SE8 menor ou igual a data atual ou data inicial projetada, conforme a pergunta.
- SQL de fluxo deve retornar aliases claros: saldo_bancario_base, total_a_receber, total_a_pagar, fluxo_liquido.
- Se SE8/SA6 nao estiverem disponiveis, retorne os componentes disponiveis e use saldo_bancario_base = 0 apenas deixando claro pelo alias que faltou saldo bancario.
- Granularidade da resposta (decidida pela pergunta do usuario, nao fixada aqui): sintetico = 1 linha com os componentes; por dia/mes = GROUP BY data de vencimento (de SE1/SE2, nunca de SE8) com saldo acumulado quando fizer sentido (SUM() OVER (ORDER BY data)); por fornecedor/cliente = decompoe o lado a pagar OU a receber por entidade, mantendo saldo bancario como referencia unica (nao duplicada por entidade); por titulo = lista linha a linha sem agregacao.
- PROIBIDO usar SE5/FK no fluxo de caixa projetado.
- PROIBIDO usar FULL OUTER JOIN em qualquer hipotese (nao suportado neste ambiente). Para combinar datas de receber e pagar que podem nao coincidir (ex: detalhado por dia/mes), use uma CTE "datas" com UNION das datas distintas de cada lado, e LEFT JOIN dessa CTE para receber e pagar — nunca JOIN direto entre as duas subqueries de receber/pagar.

### EXEMPLO CORRETO — fluxo de caixa projetado por dia, excluindo bancos
WITH saldo_recente AS (
  SELECT E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA, E8_SALATUA, E8_DTSALAT,
         ROW_NUMBER() OVER (PARTITION BY E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC) AS rn
  FROM SE8xxx SE8
  WHERE SE8.D_E_L_E_T_ = ' ' AND SE8.E8_DTSALAT <= '20260622' AND SE8.E8_BANCO NOT IN ('CX1', 'CX2')
),
saldo_base AS (
  SELECT COALESCE(SUM(E8_SALATUA), 0) AS saldo_bancario_base FROM saldo_recente WHERE rn = 1
),
datas AS (
  SELECT DISTINCT E1_VENCREA AS data_ref FROM SE1xxx WHERE D_E_L_E_T_ = ' ' AND E1_SALDO > 0 AND E1_VENCREA BETWEEN '20260622' AND '20260722'
  UNION
  SELECT DISTINCT E2_VENCREA FROM SE2xxx WHERE D_E_L_E_T_ = ' ' AND E2_SALDO > 0 AND E2_VENCREA BETWEEN '20260622' AND '20260722'
),
receber AS (
  SELECT SE1.E1_VENCREA AS data_ref, COALESCE(SUM(SE1.E1_SALDO), 0) AS total_a_receber
  FROM SE1xxx SE1
  WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SE1.E1_VENCREA BETWEEN '20260622' AND '20260722'
  GROUP BY SE1.E1_VENCREA
),
pagar AS (
  SELECT SE2.E2_VENCREA AS data_ref, COALESCE(SUM(SE2.E2_SALDO), 0) AS total_a_pagar
  FROM SE2xxx SE2
  WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SE2.E2_VENCREA BETWEEN '20260622' AND '20260722'
  GROUP BY SE2.E2_VENCREA
)
SELECT datas.data_ref AS dia,
       saldo_base.saldo_bancario_base,
       COALESCE(r.total_a_receber, 0) AS total_a_receber,
       COALESCE(p.total_a_pagar, 0) AS total_a_pagar,
       (saldo_base.saldo_bancario_base + COALESCE(r.total_a_receber, 0) - COALESCE(p.total_a_pagar, 0)) AS fluxo_liquido
FROM datas
LEFT JOIN receber r ON r.data_ref = datas.data_ref
LEFT JOIN pagar p ON p.data_ref = datas.data_ref
CROSS JOIN saldo_base
ORDER BY dia;
`;
}

function fluxoCaixaRealizado({ usaFK1, usaFK2 } = {}) {
  const tabReceber = usaFK1 ? 'FK1' : 'SE5';
  const campoDataReceber = usaFK1 ? 'FK1.FK1_DATA' : 'SE5.E5_DATA';
  const campoValorReceber = usaFK1 ? 'FK1.FK1_VALOR' : 'SE5.E5_VALOR';
  const tabPagar = usaFK2 ? 'FK2' : 'SE5';
  const campoDataPagar = usaFK2 ? 'FK2.FK2_DATA' : 'SE5.E5_DATA';
  const campoValorPagar = usaFK2 ? 'FK2.FK2_VALOR' : 'SE5.E5_VALOR';
  const filtroRecpagReceber = usaFK1 ? '' : " AND SE5.E5_RECPAG = 'R'";
  const filtroRecpagPagar = usaFK2 ? '' : " AND SE5.E5_RECPAG = 'P'";

  return `
## Fluxo de caixa realizado
- Fluxo de caixa realizado e operacao propria. Nao trate como simples contas a pagar/receber.
- Fluxo de caixa realizado = saldo_bancario_base + valor_recebido - valor_pago no periodo. Fluxo realizado usa baixas/movimentos reais: use os JOINs definidos em "Joins padrao" (SE1->FK1/SE5 para recebimentos, SE2->FK2/SE5 para pagamentos), conforme modelo_baixas_receber e modelo_baixas_pagar do contextoTecnico.
- REGRA ABSOLUTA — calcule cada componente em CTE/subquery ESCALAR SEPARADA, sem JOIN entre elas: uma para saldo_bancario_base (SE8+SA6), outra para valor_recebido (SE1+${tabReceber}, agrupado por data quando detalhado), outra para valor_pago (SE2+${tabPagar}, agrupado por data quando detalhado). PROIBIDO fazer JOIN entre SE8 e ${tabReceber}/${tabPagar} usando banco/agencia/conta — essas tabelas de baixa nao tem relacao com conta bancaria, sua chave e o titulo (SE1/SE2). Combine os componentes apenas no SELECT final.
- Datas SEMPRE no formato Protheus CHAR(8) YYYYMMDD (ex: '20260622'). PROIBIDO usar formato 'YYYY-MM-DD' ou CONVERT/CAST para DATE em comparacoes — os campos de data do Protheus sao strings YYYYMMDD, comparacao deve ser feita como string.
- O periodo (dia, mes, ano, ou intervalo arbitrario) e definido pela pergunta do usuario e deve ser aplicado de forma CONSISTENTE as fontes envolvidas — nunca calcule saldo bancario em uma data e receber/pagar em outra data diferente.
- saldo_bancario_base deve ser a ultima posicao SE8 menor ou igual ao inicio do periodo.
- SQL de fluxo deve retornar aliases claros: saldo_bancario_base, total_a_receber ou valor_recebido, total_a_pagar ou valor_pago, fluxo_liquido.
- Se SE8/SA6 nao estiverem disponiveis, retorne os componentes disponiveis e use saldo_bancario_base = 0 apenas deixando claro pelo alias que faltou saldo bancario.
- Granularidade da resposta (decidida pela pergunta do usuario, nao fixada aqui): sintetico = 1 linha com os componentes; por dia/mes = GROUP BY data da baixa (de ${tabReceber}/${tabPagar}, nunca de SE8) com saldo acumulado quando fizer sentido (SUM() OVER (ORDER BY data)); por fornecedor/cliente = decompoe o lado a pagar OU a receber por entidade, mantendo saldo bancario como referencia unica (nao duplicada por entidade); por titulo = lista linha a linha sem agregacao.
- PROIBIDO usar FULL OUTER JOIN em qualquer hipotese (nao suportado neste ambiente). Para combinar datas de receber e pagar que podem nao coincidir, use uma CTE "datas" com UNION das datas distintas de cada lado, e LEFT JOIN dessa CTE para receber e pagar — nunca JOIN direto entre as duas subqueries de receber/pagar.

### EXEMPLO CORRETO — fluxo de caixa realizado por dia (modelo deste tenant: receber=${tabReceber}, pagar=${tabPagar})
WITH saldo_recente AS (
  SELECT E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA, E8_SALATUA, E8_DTSALAT,
         ROW_NUMBER() OVER (PARTITION BY E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC) AS rn
  FROM SE8xxx SE8
  WHERE SE8.D_E_L_E_T_ = ' ' AND SE8.E8_DTSALAT <= '20260622'
),
saldo_base AS (
  SELECT COALESCE(SUM(E8_SALATUA), 0) AS saldo_bancario_base FROM saldo_recente WHERE rn = 1
),
datas AS (
  SELECT DISTINCT ${campoDataReceber} AS data_ref FROM ${tabReceber}xxx ${tabReceber} WHERE ${tabReceber}.D_E_L_E_T_ = ' '${filtroRecpagReceber} AND ${campoDataReceber} BETWEEN '20260622' AND '20260722'
  UNION
  SELECT DISTINCT ${campoDataPagar} FROM ${tabPagar}xxx ${tabPagar} WHERE ${tabPagar}.D_E_L_E_T_ = ' '${filtroRecpagPagar} AND ${campoDataPagar} BETWEEN '20260622' AND '20260722'
),
receber AS (
  SELECT ${campoDataReceber} AS data_ref, COALESCE(SUM(${campoValorReceber}), 0) AS valor_recebido
  FROM ${tabReceber}xxx ${tabReceber}
  WHERE ${tabReceber}.D_E_L_E_T_ = ' '${filtroRecpagReceber} AND ${campoDataReceber} BETWEEN '20260622' AND '20260722'
  GROUP BY ${campoDataReceber}
),
pagar AS (
  SELECT ${campoDataPagar} AS data_ref, COALESCE(SUM(${campoValorPagar}), 0) AS valor_pago
  FROM ${tabPagar}xxx ${tabPagar}
  WHERE ${tabPagar}.D_E_L_E_T_ = ' '${filtroRecpagPagar} AND ${campoDataPagar} BETWEEN '20260622' AND '20260722'
  GROUP BY ${campoDataPagar}
)
SELECT datas.data_ref AS dia,
       saldo_base.saldo_bancario_base,
       COALESCE(r.valor_recebido, 0) AS valor_recebido,
       COALESCE(p.valor_pago, 0) AS valor_pago,
       (saldo_base.saldo_bancario_base + COALESCE(r.valor_recebido, 0) - COALESCE(p.valor_pago, 0)) AS fluxo_liquido
FROM datas
LEFT JOIN receber r ON r.data_ref = datas.data_ref
LEFT JOIN pagar p ON p.data_ref = datas.data_ref
CROSS JOIN saldo_base
ORDER BY dia;
`;
}

function antecipacoesPaRa() {
  return `
## Antecipacoes PA/RA
- PA = pagamento antecipado em contas a pagar, normalmente SE2.E2_TIPO = 'PA'.
- RA = recebimento antecipado em contas a receber, normalmente SE1.E1_TIPO = 'RA'.
- Por padrao, NAO inclua PA nem RA nas metricas. Exclua PA em contas a pagar e RA em contas a receber quando o campo tipo existir.
- So considere/apresente PA ou RA quando o usuario pedir explicitamente: PA, RA, pagamento antecipado, recebimento antecipado, adiantamento, antecipacao.
- Mesmo quando pedido explicitamente, apresente PA/RA somente quando a pergunta estiver por fornecedor ou por cliente, ou quando houver fornecedor/cliente filtrado. Sem fornecedor/cliente, marque precisa_confirmacao=true perguntando qual fornecedor/cliente ou se deseja agrupar por entidade.
- Se considerar PA/RA por entidade, retorne colunas separadas: saldo_a_pagar/saldo_a_receber, pagamento_antecipado/recebimento_antecipado, total_liquido.
- Nao use PA para contas a receber. Nao use RA para contas a pagar.

## Titulos especiais — NDF, NCC
- NDF = nota de debito fornecedor em SE2.E2_TIPO. NCC = nota de credito cliente em SE1.E1_TIPO.
- Sao movimentos de compensacao, nao obrigacoes reais futuras. Seguem a mesma regra de opt-in: so considere/apresente quando o usuario pedir explicitamente NDF ou NCC.
`;
}

function mediaPorPeriodo() {
  return `
## Media por periodo (agrupamento temporal)
- "por mes": SUBSTRING(campo_data, 1, 6) AS competencia no SELECT e GROUP BY.
- Media mensal por ano (subquery 2 camadas, agrupado por ano):
  Subquery interna exporta DOIS aliases: SUBSTRING(campo_data,1,4) AS ano E SUBSTRING(campo_data,1,6) AS competencia. Query externa: SELECT h.ano, AVG(h.saldo) AS media_mensal FROM (...) AS h GROUP BY h.ano. Camada externa usa SOMENTE h.ano e h.saldo — NUNCA SE1.* ou SE2.*.
- Media mensal escalar (1 ano): subquery interna SUM por mes. Query externa AVG(h.saldo) sem GROUP BY.
- Media anual escalar: subquery interna SUM por ano → externa AVG dos totais. Alias externo: AS saldo.
- "por natureza": agrupe por SED.ED_CODIGO, SED.ED_DESCRIC.
`;
}

const FRAGMENTOS = {
  receber_posicao: {
    texto: receberPosicao,
    keywords: [/\ba\s+receber\b/i, /\brecebiv\w*/i, /\bem\s+aberto\b.*\b(receber|client)/i],
  },
  receber_realizado: {
    texto: receberRealizado,
    keywords: [/\brecebid[oa]s?\b/i, /\brecebiment\w*\s+(realizad|efetuad)/i, /\bvalor\s+recebido\b/i, /\brecebi\b/i],
  },
  pagar_posicao: {
    texto: pagarPosicao,
    keywords: [/\ba\s+pagar\b/i, /\bem\s+aberto\b.*\b(pagar|fornece)/i],
  },
  pagar_realizado: {
    texto: pagarRealizado,
    keywords: [/\bpag[oa]s?\b/i, /\bpagamento\s+(realizad|efetuad)/i, /\bvalor\s+pago\b/i, /\bpaguei\b/i],
  },
  comparacao_pagar_x_receber: {
    texto: comparacaoPagarXReceber,
    keywords: [
      /\bpagar\b.*\breceber\b/i, /\breceber\b.*\bpagar\b/i,
      /\bpagu\w*\b.*\brecebi\w*\b/i, /\brecebi\w*\b.*\bpagu\w*\b/i,
      /\bcompar\w*\b.*\b(pagar|receber)\b/i,
    ],
    requerJunto: ['receber_posicao', 'pagar_posicao'],
  },
  saldo_bancario: {
    texto: saldoBancario,
    keywords: [/\bsaldo\s+banc[aá]rio\b/i, /\bsaldo\s+(em|na|de)\s+conta\b/i, /\bposi[cç][aã]o\s+banc[aá]ria\b/i],
    excluiSe: [/\bprojetad\w*\b/i],
  },
  fluxo_caixa_projetado: {
    texto: fluxoCaixaProjetado,
    keywords: [
      /\bfluxo\s+de\s+caixa\b(?!.*\brealizad\w*\b)/i,
      /\bsaldo\s+(banc[aá]rio\s+)?projetad\w*\b/i,
      /\bprojec[aã]o\s+de\s+(saldo|caixa)\b/i,
      /\bprevis[aã]o\s+de\s+caixa\b/i,
    ],
    requerJunto: ['saldo_bancario', 'receber_posicao', 'pagar_posicao'],
  },
  fluxo_caixa_realizado: {
    texto: fluxoCaixaRealizado,
    keywords: [/\bfluxo\s+de\s+caixa\s+realizad\w*\b/i, /\bcaixa\s+realizad\w*\b/i, /\bmovimento\s+de\s+caixa\b/i],
    requerJunto: ['saldo_bancario', 'receber_realizado', 'pagar_realizado'],
  },
  antecipacoes_pa_ra: {
    texto: antecipacoesPaRa,
    keywords: [/\bPA\b/, /\bRA\b/, /\bantecipa\w*\b/i, /\badiantament\w*\b/i, /\bNDF\b/, /\bNCC\b/],
  },
  media_por_periodo: {
    texto: mediaPorPeriodo,
    keywords: [/\bm[eé]dia\b/i, /\bpor\s+m[eê]s\b/i, /\bpor\s+natureza\b/i],
  },
};

const ORDEM_FALLBACK = [
  'receber_posicao',
  'receber_realizado',
  'pagar_posicao',
  'pagar_realizado',
  'comparacao_pagar_x_receber',
  'saldo_bancario',
  'fluxo_caixa_projetado',
  'fluxo_caixa_realizado',
  'antecipacoes_pa_ra',
  'media_por_periodo',
];

module.exports = { base, FRAGMENTOS, ORDEM_FALLBACK };
