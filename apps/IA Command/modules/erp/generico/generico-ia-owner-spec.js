'use strict';

/**
 * Spec GLOBAL enxuto — usado como fallback para perguntas que NAO pertencem a nenhum
 * dos modulos com spec dedicado (faturamento, compras, financeiro, comissao).
 *
 * Diferente do cross-module-spec-combiner (que soma os 4 specs completos e fica grande
 * demais para alguns providers), este spec contem SOMENTE conhecimento generico de
 * tabelas Protheus. A IA usa seu proprio conhecimento de Protheus para gerar o SQL —
 * este spec apenas fornece o minimo de contrato tecnico (D_E_L_E_T_, formato de datas)
 * para o restante do pipeline (sx2/sx3/execucao) funcionar.
 *
 * Cobre dominios ainda sem modulo proprio: estoque (SB2), RH, producao, etc.
 * A medida que esses dominios ganharem spec dedicado, devem sair daqui.
 */

const TABELAS = ['SB2', 'SB1', 'SBM'];

const CAMPOS_SX3_ESSENCIAIS = {
  SB2: ['B2_FILIAL', 'B2_COD', 'B2_LOCAL', 'B2_QATU', 'B2_QEMP', 'B2_RESERVA', 'D_E_L_E_T_'],
  SB1: ['B1_FILIAL', 'B1_COD', 'B1_DESC', 'B1_GRUPO', 'B1_UM', 'B1_TIPO', 'D_E_L_E_T_'],
  SBM: ['BM_FILIAL', 'BM_GRUPO', 'BM_DESC', 'D_E_L_E_T_'],
};

const regrasTecnicas = `
## Contexto Tecnico Generico Protheus
Voce esta respondendo uma pergunta sobre um dominio SEM spec dedicado neste sistema
(nao e faturamento, compras, financeiro nem comissao). Use seu proprio conhecimento
de tabelas padrao do Protheus (SB2, SB1, SBM, SRA, SRD, etc.) para montar o SQL.

Regras minimas obrigatorias, validas para qualquer tabela Protheus:
- Toda tabela no FROM ou JOIN deve filtrar alias.D_E_L_E_T_ = ' ' (tabela apagada logicamente).
- Datas Protheus sao armazenadas como CHAR(8) no formato AAAAMMDD (ex: '20260716'). Filtros de
  periodo devem comparar strings nesse formato, nunca CAST para DATE sem necessidade.
- SET ROWCOUNT deve ser usado para limitar volume quando a pergunta nao pedir agregacao.

## Saldo/posicao de estoque de produto (SB2)
- Saldo/posicao atual de estoque de um produto e SEMPRE SB2 (tabela de saldo por produto e
  armazem), nunca SD2 (que e movimentacao de saida/faturamento) nem SD1 (movimentacao de entrada).
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
Para qualquer tabela por filial (SB2, e demais tabelas de movimento/saldo), resolva a filial
NESTA ORDEM, sem nunca pausar a consulta para perguntar ao usuario:
1. Filial mencionada explicitamente na pergunta do usuario -> filtre SB2.B2_FILIAL = '<filial>'.
2. Sem mencao explicita, mas o contexto tecnico do prompt trouxer "filial_padrao" preenchida ->
   filtre SB2.B2_FILIAL = '<filial_padrao>'.
3. Sem mencao explicita e sem filial_padrao configurada -> NAO filtre filial. Agrupe o resultado
   por SB2.B2_FILIAL (GROUP BY incluindo B2_FILIAL) e projete a filial como coluna no SELECT,
   mostrando o saldo de cada filial separadamente. Nunca gere pergunta de confirmacao de filial.
Exemplo de fallback sem filial_padrao (produto '000001', sem filial mencionada e sem padrao):
SET ROWCOUNT 50; SELECT SB2.B2_FILIAL AS filial, SB1.B1_DESC AS produto, SUM(SB2.B2_QATU) AS saldo_atual
FROM SB2<sufixo> SB2 JOIN SB1<sufixo> SB1 ON SB2.B2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
WHERE SB2.B2_COD = '000001' AND SB2.D_E_L_E_T_ = ' ' GROUP BY SB2.B2_FILIAL, SB1.B1_DESC;
`.trim();

module.exports = {
  nome: 'generico',
  handlerName: 'generico-ia-owner',
  logPrefix: 'GenericoIAOwner',
  defaultMessage: 'consulta generica de ERP',
  tabelas: TABELAS,
  entityCatalog: { DEFINICOES: {}, TIPOS_POR_CONTEXTO: [], tiposParaTermo: () => [] },
  resolverEntidadesAntesDaIa: false,
  camposSx3Essenciais: CAMPOS_SX3_ESSENCIAIS,
  sqlMiddleware: {
    carregarConfig: () => ({}),
    processar: (sql) => ({ bloqueado: false, sql_processado: sql }),
  },
  regrasTecnicas,
  sx3PromptLimit: 60,
  maxTokens: 3000,
  sqlPatternsProibidos: [
    {
      // SB1 pode ser tabela compartilhada entre filiais (B1_FILIAL sempre em branco) enquanto
      // SB2 (saldo) e sempre por filial. Casar SB2.B2_FILIAL = SB1.B1_FILIAL zera o JOIN nesse
      // cenario. Defesa em profundidade: rejeita mesmo se a IA ignorar a instrucao do prompt.
      regex: /\bSB2\s*\.\s*B2_FILIAL\s*=\s*SB1\s*\.\s*B1_FILIAL\b|\bSB1\s*\.\s*B1_FILIAL\s*=\s*SB2\s*\.\s*B2_FILIAL\b/i,
      mensagem: "JOIN SB2->SB1 nao deve casar por filial (SB2.B2_FILIAL = SB1.B1_FILIAL). SB1 pode ser tabela compartilhada entre filiais nesta empresa, com B1_FILIAL sempre em branco — esse casamento zeraria o resultado. Use apenas: JOIN SB1<sufixo> SB1 ON SB2.B2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '.",
    },
  ],
  mensagensErro: {
    ia_indisponivel: 'Nao consigo processar sua consulta no momento. Tente novamente em breve.',
    sql_invalido: 'Tive uma inconsistencia ao interpretar sua consulta. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei dados para essa consulta.',
    erro_erp: 'Nao consegui buscar os dados no ERP. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao: 'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  },
  garantirIntencao: () => {},
  resolverEntidades: async () => ({ status: 'resolvido', entidades: [] }),
};
