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

function _joinBaixaReceber({ usaFK7Receber, usaFK1 }) {
  if (usaFK7Receber) {
    return `JOIN FK7<sufixo> FK7
    ON  FK7.FK7_FILIAL  = SE1.E1_FILIAL
    AND FK7.FK7_PREFIX  = SE1.E1_PREFIXO
    AND FK7.FK7_NUM     = SE1.E1_NUM
    AND FK7.FK7_PARCEL  = SE1.E1_PARCELA
    AND FK7.FK7_TIPO    = SE1.E1_TIPO
    AND FK7.FK7_CLIFOR  = SE1.E1_CLIENTE
    AND FK7.FK7_LOJA    = SE1.E1_LOJA
    AND FK7.D_E_L_E_T_  = ' '
JOIN FK1<sufixo> FK1
    ON  FK1.FK1_FILIAL  = FK7.FK7_FILIAL
    AND FK1.FK1_IDDOC   = FK7.FK7_IDDOC
    AND FK1.D_E_L_E_T_  = ' '`;
  }
  if (usaFK1) {
    return `JOIN FK1<sufixo> FK1
    ON  FK1.FK1_FILIAL  = SE1.E1_FILIAL
    AND FK1.FK1_PREFIXO = SE1.E1_PREFIXO
    AND FK1.FK1_NUM     = SE1.E1_NUM
    AND FK1.FK1_PARCELA = SE1.E1_PARCELA
    AND FK1.FK1_TIPO    = SE1.E1_TIPO
    AND FK1.D_E_L_E_T_  = ' '`;
  }
  return `JOIN SE5<sufixo> SE5
    ON  SE5.E5_FILIAL   = SE1.E1_FILIAL
    AND SE5.E5_PREFIXO  = SE1.E1_PREFIXO
    AND SE5.E5_NUMERO   = SE1.E1_NUM
    AND SE5.E5_PARCELA  = SE1.E1_PARCELA
    AND SE5.E5_TIPO     = SE1.E1_TIPO
    AND SE5.E5_CLIFOR   = SE1.E1_CLIENTE
    AND SE5.E5_LOJA     = SE1.E1_LOJA
    AND SE5.E5_RECPAG   = 'R'
    AND SE5.E5_SITUACA <> 'C'
    AND SE5.E5_TIPO NOT IN ('EST', 'ED')
    AND SE5.D_E_L_E_T_  = ' '`;
}

function _joinBaixaPagar({ usaFK7Pagar, usaFK2 }) {
  if (usaFK7Pagar) {
    return `JOIN FK7<sufixo> FK7
    ON  FK7.FK7_FILIAL  = SE2.E2_FILIAL
    AND FK7.FK7_PREFIX  = SE2.E2_PREFIXO
    AND FK7.FK7_NUM     = SE2.E2_NUM
    AND FK7.FK7_PARCEL  = SE2.E2_PARCELA
    AND FK7.FK7_TIPO    = SE2.E2_TIPO
    AND FK7.FK7_CLIFOR  = SE2.E2_FORNECE
    AND FK7.FK7_LOJA    = SE2.E2_LOJA
    AND FK7.D_E_L_E_T_  = ' '
JOIN FK2<sufixo> FK2
    ON  FK2.FK2_FILIAL  = FK7.FK7_FILIAL
    AND FK2.FK2_IDDOC   = FK7.FK7_IDDOC
    AND FK2.D_E_L_E_T_  = ' '`;
  }
  if (usaFK2) {
    return `JOIN FK2<sufixo> FK2
    ON  FK2.FK2_FILIAL  = SE2.E2_FILIAL
    AND FK2.FK2_PREFIXO = SE2.E2_PREFIXO
    AND FK2.FK2_NUM     = SE2.E2_NUM
    AND FK2.FK2_PARCELA = SE2.E2_PARCELA
    AND FK2.FK2_TIPO    = SE2.E2_TIPO
    AND FK2.D_E_L_E_T_  = ' '`;
  }
  return `JOIN SE5<sufixo> SE5
    ON  SE5.E5_FILIAL   = SE2.E2_FILIAL
    AND SE5.E5_PREFIXO  = SE2.E2_PREFIXO
    AND SE5.E5_NUMERO   = SE2.E2_NUM
    AND SE5.E5_PARCELA  = SE2.E2_PARCELA
    AND SE5.E5_TIPO     = SE2.E2_TIPO
    AND SE5.E5_CLIFOR   = SE2.E2_FORNECE
    AND SE5.E5_LOJA     = SE2.E2_LOJA
    AND SE5.E5_RECPAG   = 'P'
    AND SE5.E5_SITUACA <> 'C'
    AND SE5.E5_TIPO NOT IN ('EST', 'ED')
    AND SE5.D_E_L_E_T_  = ' '`;
}

function base({ usaFK1, usaFK2, usaFK7, usaFK7Receber, usaFK7Pagar }) {
  const modeloReceber = usaFK7Receber ? 'SE1 -> FK7 -> FK1' : usaFK1 ? 'SE1 -> FK1' : 'SE1 -> SE5';
  const modeloPagar   = usaFK7Pagar   ? 'SE2 -> FK7 -> FK2' : usaFK2 ? 'SE2 -> FK2' : 'SE2 -> SE5';
  const tabBaixaReceber = usaFK1 ? 'FK1' : 'SE5';
  const tabBaixaPagar   = usaFK2 ? 'FK2' : 'SE5';

  return `
## Campos de data padrao
- REGRA ABSOLUTA — vencimento a pagar: use SEMPRE SE2.E2_VENCREA (vencimento real do titulo, que considera sabado/domingo/feriado). PROIBIDO usar SE2.E2_VENCTO em qualquer filtro, GROUP BY ou ORDER BY de contas a pagar — E2_VENCTO e o vencimento nominal/contratual, sem ajuste de dia nao util, e NUNCA deve ser usado como vencimento de fato neste ambiente.
- REGRA ABSOLUTA — vencimento a receber: use SEMPRE SE1.E1_VENCREA (vencimento real do titulo, que considera sabado/domingo/feriado). PROIBIDO usar SE1.E1_VENCTO em qualquer filtro, GROUP BY ou ORDER BY de contas a receber — E1_VENCTO e o vencimento nominal/contratual, sem ajuste de dia nao util, e NUNCA deve ser usado como vencimento de fato neste ambiente.
- Baixa/recebimento real: modelo deste tenant: ${modeloReceber}. NUNCA use SE1.E1_BAIXA.
- Baixa/pagamento real: modelo deste tenant: ${modeloPagar}. NUNCA use SE2.E2_BAIXA.
- Em aberto sem periodo explicito: consulte toda a carteira em aberto (sem BETWEEN).

## Tabelas padrao do modulo Financeiro
- SE1: contas a receber.
- SE2: contas a pagar.${usaFK1 || usaFK2 ? `\n- FK1/FK2: baixas realizadas deste tenant.` : '\n- SE5: movimentos/baixas financeiras deste tenant.'}${usaFK7 ? '\n- FK7: tabela de relacionamento titulo->baixa (chave: FK7_IDDOC). OBRIGATORIO no modelo deste tenant.' : ''}
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
- SE8 -> SA6: SE8.E8_BANCO = SA6.A6_COD AND SE8.E8_AGENCIA = SA6.A6_AGENCIA AND SE8.E8_CONTA = SA6.A6_NUMCON.
- ${modeloReceber} (recebimentos realizados): veja fragmento "Contas a receber — realizado" para o JOIN completo.
- ${modeloPagar} (pagamentos realizados): veja fragmento "Contas a pagar — realizado" para o JOIN completo.

## Regras obrigatorias de SQL
- Inicie sempre com SET ROWCOUNT 50000.
- Use aliases explicitos iguais a base da tabela: SE1, SE2, SE8, SA1, SA2, SA3, SA6, SED${usaFK1 || usaFK2 ? ', FK1, FK2' : ', SE5'}${usaFK7 ? ', FK7' : ''}. Vale em toda query, inclusive dentro de subqueries escalares.
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
- Saldo a receber/em aberto: SE1.E1_SALDO, com SE1.E1_SALDO > 0. Titulos com E1_SALDO = 0 ja foram recebidos — nunca os inclua em consultas de aberto. Vencimento SEMPRE SE1.E1_VENCREA — PROIBIDO usar SE1.E1_VENCTO. NAO filtre SE1.E1_SITUACA.
- REGRA ABSOLUTA — periodo/data especifica em posicao/em aberto: filtre DIRETAMENTE SE1.E1_VENCREA (ex: SE1.E1_VENCREA = '20260629' ou BETWEEN). PROIBIDO fazer JOIN com a tabela de baixas/movimentos (SE5 ou equivalente) para aplicar filtro de data nesta operacao — baixas/movimentos sao da operacao "Contas a receber — realizado" (outro fragmento, dados JA PAGOS/RECEBIDOS), sem relacao com vencimento em aberto. Misturar E1_SALDO > 0 (saldo aberto) com filtro pela data de baixa produz resultado sem sentido de negocio.
- Natureza financeira: SE1.E1_NATUREZ -> SED.ED_CODIGO.
- saldo_a_receber: COALESCE(SUM(SE1.E1_SALDO),0) AS saldo_a_receber.
- Agrupamento e granularidade sao decididos pela pergunta, sem padrao fixo. Exemplo por cliente: GROUP BY SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME.
- REGRA ABSOLUTA — quando a pergunta usar "vencimento", "com vencimento", "a vencer", "por vencimento" ou "prazo": projete SE1.E1_VENCREA AS vencimento no SELECT e liste cada titulo individualmente SEM GROUP BY por cliente. So agrupe por cliente se o usuario pedir explicitamente "por cliente" junto com vencimento.
`;
}

function receberRealizado({ usaFK1, usaFK7Receber }) {
  const joinCompleto = _joinBaixaReceber({ usaFK7Receber, usaFK1 });
  const campoValor   = usaFK1 ? 'FK1.FK1_VALOR' : 'SE5.E5_VALOR';
  const campoData    = usaFK1 ? 'FK1.FK1_DATA'  : 'SE5.E5_DATA';
  const modeloDesc   = usaFK7Receber ? 'SE1 -> FK7 -> FK1' : usaFK1 ? 'SE1 -> FK1' : 'SE1 -> SE5';

  return `
## Contas a receber — realizado
- Modelo de baixas deste tenant: ${modeloDesc}. NUNCA use SE1.E1_BAIXA, E1_EMISSAO, E1_VENCREA ou E1_VENCTO para identificar recebimentos.
- O JOIN DEVE seguir exatamente a estrutura abaixo — omitir qualquer campo de chave gera produto cartesiano e valores incorretos:
${joinCompleto}
- Filtre o periodo em ${campoData} (data real do recebimento). Some ${campoValor} AS valor_recebido.
- OBRIGATORIO: o WHERE da query deve incluir SE1.D_E_L_E_T_ = ' '.
- NAO filtre SE1.E1_SITUACA — o titulo pode ter baixa parcial e ainda estar em aberto.

-- MODELO SQL (adapte sufixos, periodo e agrupamento conforme a pergunta):
/*
SET ROWCOUNT 50000;
SELECT
    SA1.A1_NOME AS cliente,
    COALESCE(SUM(${campoValor}), 0) AS valor_recebido
FROM SE1<sufixo> SE1
${joinCompleto}
JOIN SA1<sufixo> SA1
    ON  SA1.A1_COD      = SE1.E1_CLIENTE
    AND SA1.A1_LOJA     = SE1.E1_LOJA
    AND SA1.D_E_L_E_T_  = ' '
WHERE SE1.D_E_L_E_T_ = ' '
  AND ${campoData} BETWEEN '<YYYYMMDD_inicio>' AND '<YYYYMMDD_fim>'
GROUP BY SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME
ORDER BY SA1.A1_NOME;
*/
`;
}

function pagarPosicao() {
  return `
## Contas a pagar — posicao/em aberto
- Contas a pagar usa SE2 e fornecedor SA2.
- Saldo a pagar/em aberto: SE2.E2_SALDO, com SE2.E2_SALDO > 0. Titulos com E2_SALDO = 0 ja foram pagos — nunca os inclua em consultas de aberto. Vencimento SEMPRE SE2.E2_VENCREA — PROIBIDO usar SE2.E2_VENCTO.
- REGRA ABSOLUTA — periodo/data especifica em posicao/em aberto: filtre DIRETAMENTE SE2.E2_VENCREA (ex: SE2.E2_VENCREA = '20260629' ou BETWEEN). PROIBIDO fazer JOIN com a tabela de baixas/movimentos (SE5 ou equivalente) para aplicar filtro de data nesta operacao — baixas/movimentos sao da operacao "Contas a pagar — realizado" (outro fragmento, dados JA PAGOS), sem relacao com vencimento em aberto. Misturar E2_SALDO > 0 (saldo aberto) com filtro pela data de baixa produz resultado sem sentido de negocio — "tem conta a pagar em [data]" e sobre vencimento, nao sobre quando foi pago.
- Natureza financeira: SE2.E2_NATUREZ -> SED.ED_CODIGO.
- saldo_a_pagar: COALESCE(SUM(SE2.E2_SALDO),0) AS saldo_a_pagar.
- Agrupamento e granularidade sao decididos pela pergunta, sem padrao fixo. Exemplo por fornecedor: GROUP BY SA2.A2_COD, SA2.A2_LOJA, SA2.A2_NOME.
- REGRA ABSOLUTA — quando a pergunta usar "vencimento", "com vencimento", "a vencer", "por vencimento" ou "prazo": projete SE2.E2_VENCREA AS vencimento no SELECT e liste cada titulo individualmente SEM GROUP BY por fornecedor. So agrupe por fornecedor se o usuario pedir explicitamente "por fornecedor" junto com vencimento.
`;
}

function pagarRealizado({ usaFK2, usaFK7Pagar }) {
  const joinCompleto = _joinBaixaPagar({ usaFK7Pagar, usaFK2 });
  const campoValor   = usaFK2 ? 'FK2.FK2_VALOR' : 'SE5.E5_VALOR';
  const campoData    = usaFK2 ? 'FK2.FK2_DATA'  : 'SE5.E5_DATA';
  const modeloDesc   = usaFK7Pagar ? 'SE2 -> FK7 -> FK2' : usaFK2 ? 'SE2 -> FK2' : 'SE2 -> SE5';

  return `
## Contas a pagar — realizado
- Modelo de baixas deste tenant: ${modeloDesc}. NUNCA use SE2.E2_BAIXA, E2_EMISSAO, E2_VENCREA ou E2_VENCTO para identificar pagamentos.
- O JOIN DEVE seguir exatamente a estrutura abaixo — omitir qualquer campo de chave gera produto cartesiano e valores incorretos:
${joinCompleto}
- Filtre o periodo em ${campoData} (data real do pagamento). Some ${campoValor} AS valor_pago.
- OBRIGATORIO: o WHERE da query deve incluir SE2.D_E_L_E_T_ = ' '.
- NAO filtre SE2.E2_SITUACA — o titulo pode ter baixa parcial e ainda estar em aberto.

-- MODELO SQL (adapte sufixos, periodo e agrupamento conforme a pergunta):
/*
SET ROWCOUNT 50000;
SELECT
    SA2.A2_NOME AS fornecedor,
    COALESCE(SUM(${campoValor}), 0) AS valor_pago
FROM SE2<sufixo> SE2
${joinCompleto}
JOIN SA2<sufixo> SA2
    ON  SA2.A2_COD      = SE2.E2_FORNECE
    AND SA2.A2_LOJA     = SE2.E2_LOJA
    AND SA2.D_E_L_E_T_  = ' '
WHERE SE2.D_E_L_E_T_ = ' '
  AND ${campoData} BETWEEN '<YYYYMMDD_inicio>' AND '<YYYYMMDD_fim>'
GROUP BY SA2.A2_COD, SA2.A2_LOJA, SA2.A2_NOME
ORDER BY SA2.A2_NOME;
*/
`;
}

function comparacaoPagarXReceber({ usaFK1, usaFK2, usaFK7Receber, usaFK7Pagar }) {
  const modeloReceber = usaFK7Receber ? 'SE1->FK7->FK1' : usaFK1 ? 'SE1->FK1' : 'SE1->SE5';
  const modeloPagar   = usaFK7Pagar   ? 'SE2->FK7->FK2' : usaFK2 ? 'SE2->FK2' : 'SE2->SE5';
  return `
## Comparacao/combinacao pagar x receber
- REGRA ABSOLUTA — SE1 e SE2 sao carteiras independentes, nunca relacionadas entre si: PROIBIDO fazer JOIN (INNER, LEFT, RIGHT, CROSS ou qualquer tipo) entre SE1 e SE2, mesmo que as chaves parecam existir. Nao existe titulo a pagar que "corresponda" a um titulo a receber — qualquer JOIN entre elas produz produto cartesiano multiplicando os valores e gerando resultado incorreto.
- EXEMPLO ERRADO — nunca faca isso: SELECT SUM(SE2.E2_SALDO), SUM(SE1.E1_SALDO) FROM SE2xxx SE2 LEFT JOIN SE1xxx SE1 ON SE1.D_E_L_E_T_ = ' ' — mesmo com condicao no ON, o JOIN cruza todas as linhas de SE2 com todas as de SE1, inflando os valores.
- EXEMPLO CORRETO para total de ambas em posicao/em_aberto: use UNION ALL com dois SELECTs independentes — SELECT 'pagar' AS carteira, COALESCE(SUM(SE2.E2_SALDO),0) AS saldo FROM SE2xxx SE2 WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 UNION ALL SELECT 'receber', COALESCE(SUM(SE1.E1_SALDO),0) FROM SE1xxx SE1 WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0.
- Se o usuario pedir ambas realizadas (recebidas e pagas): gere UM UNICO SELECT com duas subqueries escalares — valor_recebido via ${modeloReceber} e valor_pago via ${modeloPagar}. Use o JOIN completo do fragmento "realizado" correspondente dentro de cada subquery. PROIBIDO UNION ALL para realizados. Siga o plano estruturado query_plan_texto.
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
- REGRA ABSOLUTA — saldo_bancario_base e SEMPRE a ultima posicao SE8 menor ou igual a data_atual (hoje), independente do periodo de projecao pedido. O fluxo e PROJETADO a partir de hoje: o ponto de partida nunca pode ser uma data futura do periodo solicitado (ex: "proximos 90 dias" usa data_atual como referencia de SE8, NUNCA a data final do periodo de 90 dias). Filtre SE8.E8_DTSALAT <= 'data_atual_YYYYMMDD', nunca <= data final do periodo projetado.
- SQL de fluxo deve retornar aliases claros: saldo_bancario_base, total_a_receber, total_a_pagar, fluxo_liquido.
- Se SE8/SA6 nao estiverem disponiveis, retorne os componentes disponiveis e use saldo_bancario_base = 0 apenas deixando claro pelo alias que faltou saldo bancario.
- Granularidade da resposta (decidida pela pergunta do usuario, nao fixada aqui): sintetico = 1 linha com os componentes; por fornecedor/cliente = decompoe o lado a pagar OU a receber por entidade, mantendo saldo bancario como referencia unica (nao duplicada por entidade); por titulo = lista linha a linha sem agregacao.
- REGRA OBRIGATORIA — projecao por dia/mes (multiplas linhas): o saldo bancario projetado e CUMULATIVO ao longo do periodo, NUNCA o mesmo valor fixo repetido em todas as linhas. O fluxo_liquido de cada linha deve se somar ao saldo acumulado das linhas anteriores, nao sempre ao saldo_bancario_base original. Use SUM(total_a_receber - total_a_pagar) OVER (ORDER BY data_ref) para calcular o delta acumulado, e some saldo_bancario_base a esse acumulado: saldo_projetado_na_data = saldo_bancario_base + SUM(total_a_receber - total_a_pagar) OVER (ORDER BY data_ref ROWS UNBOUNDED PRECEDING). PROIBIDO fazer CROSS JOIN do saldo_bancario_base fixo em cada linha sem acumular o delta das linhas anteriores — isso faz cada mes/dia parecer uma projecao isolada do saldo de hoje, em vez de uma projecao progressiva.
- REGRA ABSOLUTA — nomenclatura do alias de data/competencia no SELECT final: quando detalhado por dia, use AS dia (valor YYYYMMDD). Quando detalhado por mes, use AS competencia (valor YYYYMM, formato SUBSTRING(campo,1,6)) — NUNCA use o alias "mes" sozinho. O formatador de WhatsApp identifica a coluna "mes" apenas quando o valor e um numero de 1 a 12 (mes do calendario); um valor YYYYMM com alias "mes" e mal interpretado e quebra a quebra por linha da resposta.
- PROIBIDO usar SE5/FK no fluxo de caixa projetado.
- PROIBIDO usar FULL OUTER JOIN em qualquer hipotese (nao suportado neste ambiente). Para combinar datas de receber e pagar que podem nao coincidir (ex: detalhado por dia/mes), use uma CTE "datas" com UNION das datas distintas de cada lado, e LEFT JOIN dessa CTE para receber e pagar — nunca JOIN direto entre as duas subqueries de receber/pagar.

### EXEMPLO CORRETO — fluxo de caixa projetado por dia, excluindo bancos
### (data_atual = '20260622'; periodo projetado pedido = proximos 30 dias, '20260622' a '20260722')
### Observe: SE8 usa data_atual ('20260622'), NUNCA a data final do periodo ('20260722').
### Observe: saldo_acumulado usa SUM() OVER para acumular o delta de cada linha anterior — NUNCA repete saldo_bancario_base fixo.
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
),
fluxo AS (
  SELECT datas.data_ref AS dia,
         COALESCE(r.total_a_receber, 0) AS total_a_receber,
         COALESCE(p.total_a_pagar, 0) AS total_a_pagar,
         (COALESCE(r.total_a_receber, 0) - COALESCE(p.total_a_pagar, 0)) AS delta_dia
  FROM datas
  LEFT JOIN receber r ON r.data_ref = datas.data_ref
  LEFT JOIN pagar p ON p.data_ref = datas.data_ref
)
SELECT fluxo.dia,
       saldo_base.saldo_bancario_base,
       fluxo.total_a_receber,
       fluxo.total_a_pagar,
       (saldo_base.saldo_bancario_base + SUM(fluxo.delta_dia) OVER (ORDER BY fluxo.dia ROWS UNBOUNDED PRECEDING)) AS fluxo_liquido
FROM fluxo
CROSS JOIN saldo_base
ORDER BY fluxo.dia;

### EXEMPLO CORRETO — fluxo de caixa projetado por MES (mesma estrutura, granularidade diferente)
### REGRA CRITICA: a CTE "datas" e as CTEs "receber"/"pagar" devem usar a MESMA expressao de truncamento de data.
### Se a granularidade e mensal, TODAS usam SUBSTRING(campo,1,6) — nunca deixe "datas" com a data completa
### enquanto "receber"/"pagar" truncam para competencia; o LEFT JOIN nao vai casar e os valores ficam zerados.
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
  SELECT DISTINCT SUBSTRING(E1_VENCREA, 1, 6) AS competencia FROM SE1xxx WHERE D_E_L_E_T_ = ' ' AND E1_SALDO > 0 AND E1_VENCREA BETWEEN '20260622' AND '20260920'
  UNION
  SELECT DISTINCT SUBSTRING(E2_VENCREA, 1, 6) FROM SE2xxx WHERE D_E_L_E_T_ = ' ' AND E2_SALDO > 0 AND E2_VENCREA BETWEEN '20260622' AND '20260920'
),
receber AS (
  SELECT SUBSTRING(SE1.E1_VENCREA, 1, 6) AS competencia, COALESCE(SUM(SE1.E1_SALDO), 0) AS total_a_receber
  FROM SE1xxx SE1
  WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SE1.E1_VENCREA BETWEEN '20260622' AND '20260920'
  GROUP BY SUBSTRING(SE1.E1_VENCREA, 1, 6)
),
pagar AS (
  SELECT SUBSTRING(SE2.E2_VENCREA, 1, 6) AS competencia, COALESCE(SUM(SE2.E2_SALDO), 0) AS total_a_pagar
  FROM SE2xxx SE2
  WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SE2.E2_VENCREA BETWEEN '20260622' AND '20260920'
  GROUP BY SUBSTRING(SE2.E2_VENCREA, 1, 6)
),
fluxo AS (
  SELECT datas.competencia,
         COALESCE(r.total_a_receber, 0) AS total_a_receber,
         COALESCE(p.total_a_pagar, 0) AS total_a_pagar,
         (COALESCE(r.total_a_receber, 0) - COALESCE(p.total_a_pagar, 0)) AS delta_mes
  FROM datas
  LEFT JOIN receber r ON r.competencia = datas.competencia
  LEFT JOIN pagar p ON p.competencia = datas.competencia
)
SELECT fluxo.competencia,
       saldo_base.saldo_bancario_base,
       fluxo.total_a_receber,
       fluxo.total_a_pagar,
       (saldo_base.saldo_bancario_base + SUM(fluxo.delta_mes) OVER (ORDER BY fluxo.competencia ROWS UNBOUNDED PRECEDING)) AS fluxo_liquido
FROM fluxo
CROSS JOIN saldo_base
ORDER BY fluxo.competencia;
`;
}

function fluxoCaixaRealizado({ usaFK1, usaFK2, usaFK7Receber, usaFK7Pagar } = {}) {
  const tabReceber        = usaFK1 ? 'FK1' : 'SE5';
  const campoDataReceber  = usaFK1 ? 'FK1.FK1_DATA'  : 'SE5.E5_DATA';
  const campoValorReceber = usaFK1 ? 'FK1.FK1_VALOR' : 'SE5.E5_VALOR';
  const tabPagar          = usaFK2 ? 'FK2' : 'SE5';
  const campoDataPagar    = usaFK2 ? 'FK2.FK2_DATA'  : 'SE5.E5_DATA';
  const campoValorPagar   = usaFK2 ? 'FK2.FK2_VALOR' : 'SE5.E5_VALOR';
  const filtroRecpagReceber = usaFK1 ? '' : " AND SE5.E5_RECPAG = 'R'";
  const filtroRecpagPagar   = usaFK2 ? '' : " AND SE5.E5_RECPAG = 'P'";
  const modeloReceber = usaFK7Receber ? 'SE1->FK7->FK1' : usaFK1 ? 'SE1->FK1' : 'SE1->SE5';
  const modeloPagar   = usaFK7Pagar   ? 'SE2->FK7->FK2' : usaFK2 ? 'SE2->FK2' : 'SE2->SE5';
  const joinReceber   = _joinBaixaReceber({ usaFK7Receber, usaFK1 });
  const joinPagar     = _joinBaixaPagar({ usaFK7Pagar, usaFK2 });

  return `
## Fluxo de caixa realizado
- Fluxo de caixa realizado e operacao propria. Nao trate como simples contas a pagar/receber.
- Fluxo de caixa realizado = saldo_bancario_base + valor_recebido - valor_pago no periodo.
- Modelo de baixas deste tenant: receber=${modeloReceber}, pagar=${modeloPagar}. Use o JOIN completo de cada modelo (veja fragmentos "realizado") dentro das CTEs receber/pagar.
- REGRA ABSOLUTA — calcule cada componente em CTE SEPARADA: saldo_bancario_base (SE8+SA6), valor_recebido (SE1+cadeia receber), valor_pago (SE2+cadeia pagar). PROIBIDO JOIN entre SE8 e tabelas de baixa — nao ha relacao por conta bancaria.
- Datas SEMPRE no formato Protheus CHAR(8) YYYYMMDD. PROIBIDO 'YYYY-MM-DD' ou CONVERT/CAST para DATE em comparacoes.
- saldo_bancario_base deve ser a ultima posicao SE8 menor ou igual ao inicio do periodo.
- SQL de fluxo deve retornar aliases claros: saldo_bancario_base, valor_recebido, valor_pago, fluxo_liquido.
- REGRA OBRIGATORIA — por dia/mes: saldo bancario CUMULATIVO. Use SUM(valor_recebido - valor_pago) OVER (ORDER BY data_ref ROWS UNBOUNDED PRECEDING) + saldo_bancario_base. PROIBIDO CROSS JOIN sem acumular delta.
- REGRA ABSOLUTA — alias de data: por dia → AS dia (YYYYMMDD). Por mes → AS competencia (YYYYMM). NUNCA alias "mes".
- PROIBIDO FULL OUTER JOIN. Para datas de receber/pagar que nao coincidem: CTE "datas" com UNION + LEFT JOIN.

### EXEMPLO CORRETO — fluxo de caixa realizado por dia (modelo deste tenant: receber=${modeloReceber}, pagar=${modeloPagar})
WITH saldo_recente AS (
  SELECT E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA, E8_SALATUA, E8_DTSALAT,
         ROW_NUMBER() OVER (PARTITION BY E8_FILIAL, E8_BANCO, E8_AGENCIA, E8_CONTA ORDER BY E8_DTSALAT DESC) AS rn
  FROM SE8<sufixo> SE8
  WHERE SE8.D_E_L_E_T_ = ' ' AND SE8.E8_DTSALAT <= '<data_inicio>'
),
saldo_base AS (
  SELECT COALESCE(SUM(E8_SALATUA), 0) AS saldo_bancario_base FROM saldo_recente WHERE rn = 1
),
receber AS (
  SELECT ${campoDataReceber} AS data_ref, COALESCE(SUM(${campoValorReceber}), 0) AS valor_recebido
  FROM SE1<sufixo> SE1
  ${joinReceber}
  WHERE SE1.D_E_L_E_T_ = ' ' AND ${campoDataReceber} BETWEEN '<data_inicio>' AND '<data_fim>'
  GROUP BY ${campoDataReceber}
),
pagar AS (
  SELECT ${campoDataPagar} AS data_ref, COALESCE(SUM(${campoValorPagar}), 0) AS valor_pago
  FROM SE2<sufixo> SE2
  ${joinPagar}
  WHERE SE2.D_E_L_E_T_ = ' ' AND ${campoDataPagar} BETWEEN '<data_inicio>' AND '<data_fim>'
  GROUP BY ${campoDataPagar}
),
datas AS (
  SELECT data_ref FROM receber
  UNION
  SELECT data_ref FROM pagar
),
fluxo AS (
  SELECT datas.data_ref AS dia,
         COALESCE(r.valor_recebido, 0) AS valor_recebido,
         COALESCE(p.valor_pago, 0) AS valor_pago,
         (COALESCE(r.valor_recebido, 0) - COALESCE(p.valor_pago, 0)) AS delta_dia
  FROM datas
  LEFT JOIN receber r ON r.data_ref = datas.data_ref
  LEFT JOIN pagar  p ON p.data_ref = datas.data_ref
)
SELECT fluxo.dia,
       saldo_base.saldo_bancario_base,
       fluxo.valor_recebido,
       fluxo.valor_pago,
       (saldo_base.saldo_bancario_base + SUM(fluxo.delta_dia) OVER (ORDER BY fluxo.dia ROWS UNBOUNDED PRECEDING)) AS fluxo_liquido
FROM fluxo
CROSS JOIN saldo_base
ORDER BY fluxo.dia;
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

function identidadeVendedor() {
  return `
## Identidade do vendedor — REGRA DE SEGURANCA OBRIGATORIA
- Se o contexto tecnico trouxer vendedorFixo, aplique OBRIGATORIAMENTE o filtro desse vendedor em TODA query de SE1, cobrindo as 5 posicoes de rateio com OR: AND (SE1.E1_VEND1 = '<codigo>' OR SE1.E1_VEND2 = '<codigo>' OR SE1.E1_VEND3 = '<codigo>' OR SE1.E1_VEND4 = '<codigo>' OR SE1.E1_VEND5 = '<codigo>').
- PROIBIDO filtrar apenas SE1.E1_VEND1 sozinho — titulos rateados podem ter o vendedor autorizado em qualquer uma das 5 posicoes; filtrar so uma esconde titulos legitimos do proprio vendedor.
- Nunca use SE2 (contas a pagar) quando vendedorFixo estiver presente — SE2 nao possui campo de vendedor e e proibido para este perfil. Se a pergunta pedir contas a pagar, recuse com precisa_confirmacao=true.
- Nunca retorne dados de outros vendedores quando vendedorFixo estiver presente, mesmo que o usuario nao cite vendedor (agregados gerais tambem devem ser filtrados pelo vendedorFixo).
- REGRA ABSOLUTA: se entidades_resolvidas contiver um vendedor com codigo DIFERENTE do vendedorFixo, NAO gere SQL algum. Retorne precisa_confirmacao=true com pergunta_confirmacao recusando o pedido.
- Quando vendedorFixo NAO estiver presente (quem pergunta e gestor), a consulta pode abranger todos os vendedores e SE1/SE2 normalmente, sem filtro de vendedor.
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
  // identidade_vendedor nao tem keywords: e sempre injetado pelo classificador,
  // independente do texto da pergunta (regra de seguranca, nao de assunto).
  identidade_vendedor: {
    texto: identidadeVendedor,
    sempre: true,
  },
  receber_posicao: {
    texto: receberPosicao,
    keywords: [/\ba\s+receber\b/i, /\brecebiv\w*/i, /\bem\s+aberto\b.*\b(receber|client)/i],
  },
  receber_realizado: {
    texto: receberRealizado,
    // "contas pagas por cliente"/"paguei por cliente" e ambiguo: no contexto de
    // recebimento de vendedor/cliente, "pago" significa titulo do cliente ja quitado,
    // nao pagamento a fornecedor. Sem esta keyword, a pergunta so aciona pagar_realizado
    // (join SE2/fornecedor) e a IA reconstroi de memoria o join SE1->SE5, omitindo
    // E5_NUMERO=E1_NUM — bug real observado em producao (join casa com titulo errado).
    keywords: [/\brecebid[oa]s?\b/i, /\brecebiment\w*\s+(realizad|efetuad)/i, /\bvalor\s+recebido\b/i, /\brecebi\b/i, /\bpag[oa]s?\b.*\bclient\w*\b/i, /\bclient\w*\b.*\bpag[oa]s?\b/i],
  },
  pagar_posicao: {
    texto: pagarPosicao,
    keywords: [/\ba\s+pagar\b/i, /\bem\s+aberto\b.*\b(pagar|fornece)/i],
  },
  pagar_realizado: {
    texto: pagarRealizado,
    keywords: [/\bpag[oa]s?\b/i, /\bpagamento\s+(realizad|efetuad)/i, /\bvalor\s+pago\b/i, /\bpaguei\b/i],
    // Quando a pergunta menciona cliente e nao menciona fornecedor, o "pago/pagas"
    // se refere a titulo de RECEBER ja quitado pelo cliente, nao pagamento a
    // fornecedor — exclui pagar_realizado para nao injetar o join SE2 errado junto
    // com receber_realizado (que ja cobre esse caso via keyword acima).
    excluiSe: [/\bclient\w*\b(?![\s\S]*\bfornece\w*\b)/i],
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
  'identidade_vendedor',
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
