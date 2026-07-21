'use strict';

/**
 * Fragmentos de regrasTecnicas de estoque, organizados por sub-operacao
 * (saldo/posicao, movimentacao interna, curva ABC/giro) em vez de um unico
 * bloco monolitico. Mesma arquitetura aplicada a compras/financeiro/faturamento.
 *
 * A concatenacao de TODOS os fragmentos (fallback, quando a pergunta nao
 * classifica em nenhuma sub-operacao especifica) cobre o mesmo escopo do
 * spec generico anterior (generico-ia-owner-spec.js), preservando as regras
 * de negocio ja validadas em producao.
 */

function base() {
  return `
## Tabelas padrao do modulo Estoque
- SB2: saldo/posicao de estoque por produto e armazem. Metrica principal: SB2.B2_QATU.
- SB1: cadastro de produto. SB1.B1_DESC e a descricao, SB1.B1_GRUPO o grupo.
- SBM: grupo de produtos. SBM.BM_DESC e a descricao do grupo.
- SD3: historico de movimentacao INTERNA de estoque (transferencia, requisicao, devolucao,
  perda/avaria, apontamento de producao, ajuste de inventario).

## REGRA CRITICA — JOIN SB2 -> SB1 (produto): NUNCA use B1_FILIAL no ON
- SB1 (cadastro de produto) pode estar configurada como tabela COMPARTILHADA entre filiais no
  Protheus desta empresa — quando compartilhada, SB1.B1_FILIAL fica SEMPRE em branco (' '),
  mesmo que SB2 (saldo, sempre por filial) tenha B2_FILIAL preenchido. Portanto o JOIN entre
  SB2 e SB1 e SEMPRE por codigo do produto apenas, NUNCA incluindo filial no ON:
  JOIN SB1<sufixo> SB1 ON SB2.B2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
  PROIBIDO: SB2.B2_FILIAL = SB1.B1_FILIAL — quando SB1 e compartilhada isso zera o JOIN
  (nenhuma linha retorna, pois B1_FILIAL nunca casa com B2_FILIAL preenchido); quando SB1 e
  exclusiva, o filtro correto de filial ja e feito diretamente em SB2 (ver regra de filial
  abaixo), tornando o casamento por B1_FILIAL redundante e arriscado nos dois cenarios.

## REGRA DE FILIAL — nunca pergunte, siga esta ordem de prioridade
Para qualquer tabela por filial (SB2, SD3, e demais tabelas de movimento/saldo), resolva a
filial NESTA ORDEM, sem nunca pausar a consulta para perguntar ao usuario:
1. Filial mencionada explicitamente na pergunta do usuario -> filtre pelo campo de filial da
   tabela (ex: SB2.B2_FILIAL = '<filial>').
2. Sem mencao explicita, mas o contexto tecnico do prompt trouxer "filial_padrao" preenchida ->
   filtre pelo campo de filial da tabela = '<filial_padrao>'.
3. Sem mencao explicita e sem filial_padrao configurada -> NAO filtre filial. Agrupe o resultado
   pelo campo de filial da tabela (GROUP BY incluindo a filial) e projete a filial como coluna no
   SELECT, mostrando o resultado de cada filial separadamente. Nunca gere pergunta de confirmacao
   de filial.
Exemplo de fallback sem filial_padrao (produto '000001', sem filial mencionada e sem padrao):
SET ROWCOUNT 50; SELECT SB2.B2_FILIAL AS filial, SB1.B1_DESC AS produto, SUM(SB2.B2_QATU) AS saldo_atual
FROM SB2<sufixo> SB2 JOIN SB1<sufixo> SB1 ON SB2.B2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
WHERE SB2.B2_COD = '000001' AND SB2.D_E_L_E_T_ = ' ' GROUP BY SB2.B2_FILIAL, SB1.B1_DESC;

## Regras obrigatorias de SQL
- Toda tabela no FROM ou JOIN deve filtrar alias.D_E_L_E_T_ = ' ' (tabela apagada logicamente).
- Datas Protheus sao armazenadas como CHAR(8) no formato AAAAMMDD (ex: '20260716'). Filtros de
  periodo devem comparar strings nesse formato, nunca CAST para DATE sem necessidade.
- Inicie sempre com SET ROWCOUNT quando a pergunta nao pedir agregacao escalar.
- Use aliases explicitos iguais a base da tabela: SB2, SB1, SBM, SD3.
- Qualifique campos sempre pelo alias base (SB2.B2_QATU, nunca SB2990.B2_QATU).
- Nunca use UPDATE, DELETE, INSERT, DROP, ALTER, TRUNCATE, EXEC, DECLARE, MERGE, SELECT INTO.

## Exibicao de entidades
- produto: SB1.B1_DESC AS produto. Codigo como cod_produto.
- grupo_produto: SBM.BM_DESC AS grupo_produto.
Se uma entidade estiver no GROUP BY, inclua sua descricao no SELECT e no GROUP BY.

## Entidades cadastrais
Quando precisar filtrar produto ou grupo_produto por nome citado pelo usuario, retorne em
entidades_necessarias. Depois que o sistema devolver entidades_resolvidas, filtre por codigo
interno, nao por LIKE de nome.
`;
}

function saldoPosicao() {
  return `
## Saldo/posicao de estoque de produto (SB2)
- Saldo/posicao atual de estoque de um produto e SEMPRE SB2 (tabela de saldo por produto e
  armazem), nunca SD2 (que e movimentacao de saida/faturamento), SD1 (movimentacao de entrada)
  nem SD3 (movimentacao interna — ver fragmento de movimentacao).
- Quantidade em estoque = SB2.B2_QATU (quantidade atual). Reservado = SB2.B2_RESERVA.
  Empenhado = SB2.B2_QEMP. Disponivel = B2_QATU - B2_RESERVA - B2_QEMP (some somente se a
  pergunta pedir "disponivel"; para "saldo em estoque" simples, use apenas B2_QATU).
- SB2 e por armazem (B2_LOCAL): se a pergunta nao especificar armazem, some B2_QATU de todos
  os armazens do produto (SUM), agrupando por B2_COD.
- NUNCA use SD2 (Itens de Nota Fiscal de Saida) para responder "saldo em estoque" — SD2 e
  movimentacao de faturamento, e mesmo que SF4.F4_ESTOQUE indique que uma nota MOVIMENTOU
  estoque, isso nao representa a POSICAO/SALDO atual do produto. Perguntas sobre quantidade
  MOVIMENTADA (vendida/carregada) sao do modulo Faturamento; perguntas sobre saldo/posicao
  ATUAL de estoque sao SEMPRE SB2.
`;
}

function movimentacaoInterna() {
  return `
## Movimentacao interna de estoque (SD3)
- SD3 e o HISTORICO de movimentacao INTERNA de estoque: transferencia entre armazens, requisicao,
  devolucao, perda/avaria, apontamento de producao (entrada/saida de Ordem de Producao), ajuste de
  inventario. Use SD3 quando a pergunta pedir o que MOVIMENTOU o estoque internamente (ex: "quanto
  foi requisitado", "transferencias do produto X", "consumo de producao", "perdas/avarias do mes").
- SD3 NUNCA responde "saldo atual" ou "posicao de estoque" — isso continua sendo SEMPRE SB2.B2_QATU.
  SD3 e movimentacao (fluxo, por documento/data), SB2 e saldo (posicao, foto do momento atual).
- D3_TM (tipo de movimento) distingue a natureza do lancamento: valores < 500 = Producao/Devolucao
  (entrada), valores >= 500 = Requisicao (saida). Nao assuma o sinal (entrada/saida) sem checar D3_TM
  ou o CF (D3_CF) do TES: filtre por faixa de D3_TM quando a pergunta pedir explicitamente entradas
  ou saidas internas.
- D3_ESTORNO = 'S' indica que o lancamento foi estornado — exclua (D3_ESTORNO <> 'S' ou = 'N') salvo
  se a pergunta pedir estornos explicitamente.
- D3_LOCAL e o armazem do movimento; D3_OP relaciona a Ordem de Producao quando o movimento vem de
  apontamento industrial; D3_CC e o centro de custo para apropriacao. Use apenas os campos que a
  pergunta exigir — nao adicione JOINs ou colunas nao solicitadas.
- Quantidade movimentada = SD3.D3_QUANT. Custo do movimento = SD3.D3_CUSTO1 (Moeda 1).
`;
}

function curvaAbcGiro() {
  return `
## Curva ABC / giro de estoque / cobertura
- "Curva ABC", "giro de estoque", "cobertura" e "ranking de produtos" sao perguntas analiticas
  que cruzam SALDO (SB2) com MOVIMENTACAO (SD3 e/ou SD2 de saida do faturamento), sempre por
  produto — nunca confunda com as perguntas simples de saldo ou de movimentacao isolada.
- Estrutura obrigatoria de DUAS CAMADAS por produto: (1) subquery/CTE que agrega, por
  SB2.B2_COD, o saldo atual (SUM(SB2.B2_QATU)) de um lado e o volume movimentado no periodo
  pedido de outro lado (SUM da tabela de movimentacao pertinente — SD3.D3_QUANT para
  movimentacao interna, ou SD2.D2_QUANT/quantidade de saida do faturamento para consumo por
  venda, conforme a pergunta); (2) query externa que calcula o indicador solicitado sobre os
  totais agregados da camada interna — nunca aplique AVG/RANK direto sobre a tabela fato bruta.
- Giro de estoque = quantidade movimentada (saida) no periodo / saldo medio ou saldo atual do
  produto no mesmo periodo. Cobertura (dias de estoque) = saldo atual / consumo medio diario no
  periodo. Calcule sempre a partir dos totais ja agregados por produto na camada interna.
- Curva ABC classifica produtos pelo percentual acumulado de participação (normalmente por valor
  ou quantidade movimentada): ordene os produtos pela metrica desc, calcule o percentual
  acumulado com SUM() OVER (ORDER BY metrica DESC) / SUM total, e classifique A (ate 80%
  acumulado), B (80% a 95%) ou C (acima de 95%) via CASE.
- PROIBIDO juntar SB2 (saldo, granularidade produto+armazem) diretamente com SD3 ou SD2
  (granularidade documento/item) sem agregar cada lado separadamente antes do JOIN — o JOIN
  direto sem agregacao previa multiplica o saldo pela quantidade de movimentos, inflando os
  numeros.
- Sempre agrupe/pareie os totais pelo mesmo produto (B2_COD = D3_COD ou B2_COD = D2_COD),
  usando LEFT JOIN entre as subqueries agregadas quando um produto puder ter saldo sem
  movimentacao no periodo (ou vice-versa), tratando ausencia como 0 via COALESCE.
`;
}

const FRAGMENTOS = {
  saldo_posicao: {
    texto: saldoPosicao,
    keywords: [/\bsaldo\b/i, /\bposi[cç][aã]o\b/i, /\bestoque\s+(atual|dispon[ií]vel)\b/i, /\bdispon[ií]vel\b/i, /\breservado\b/i, /\bempenhado\b/i],
  },
  movimentacao_interna: {
    texto: movimentacaoInterna,
    keywords: [/\brequisi[cç][aã]o\b/i, /\brequisitado\b/i, /\btransfer[êe]ncia(?:s)?\b/i, /\bperda(?:s)?\b/i, /\bavaria(?:s)?\b/i, /\bapontamento\b/i, /\bordem\s+de\s+produ[cç][aã]o\b/i, /\bajuste\s+de\s+invent[aá]rio\b/i, /\bconsumo\s+de\s+produ[cç][aã]o\b/i],
  },
  curva_abc_giro: {
    texto: curvaAbcGiro,
    keywords: [/\bcurva\s+abc\b/i, /\bgiro\b/i, /\bcobertura\b/i, /\branking\b/i, /\bclassifica[cç][aã]o\s+abc\b/i],
  },
};

const ORDEM_FALLBACK = ['saldo_posicao', 'movimentacao_interna', 'curva_abc_giro'];

module.exports = { base, FRAGMENTOS, ORDEM_FALLBACK };
