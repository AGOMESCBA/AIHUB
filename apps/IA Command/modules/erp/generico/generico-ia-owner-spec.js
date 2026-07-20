'use strict';

/**
 * Spec GLOBAL enxuto — usado como fallback para perguntas que NAO pertencem a nenhum
 * dos modulos com spec dedicado (faturamento, compras, financeiro, comissao, estoque).
 *
 * Diferente do cross-module-spec-combiner (que soma os specs completos e fica grande
 * demais para alguns providers), este spec contem SOMENTE conhecimento generico de
 * tabelas Protheus. A IA usa seu proprio conhecimento de Protheus para gerar o SQL —
 * este spec apenas fornece o minimo de contrato tecnico (D_E_L_E_T_, formato de datas)
 * para o restante do pipeline (sx2/sx3/execucao) funcionar.
 *
 * Cobre dominios ainda sem modulo proprio: RH, producao, etc.
 * A medida que esses dominios ganharem spec dedicado, devem sair daqui.
 */

const TABELAS = [];

const CAMPOS_SX3_ESSENCIAIS = {};

const regrasTecnicas = `
## Contexto Tecnico Generico Protheus
Voce esta respondendo uma pergunta sobre um dominio SEM spec dedicado neste sistema
(nao e faturamento, compras, financeiro, comissao nem estoque). Use seu proprio
conhecimento de tabelas padrao do Protheus para montar o SQL.

Regras minimas obrigatorias, validas para qualquer tabela Protheus:
- Toda tabela no FROM ou JOIN deve filtrar alias.D_E_L_E_T_ = ' ' (tabela apagada logicamente).
- Datas Protheus sao armazenadas como CHAR(8) no formato AAAAMMDD (ex: '20260716'). Filtros de
  periodo devem comparar strings nesse formato, nunca CAST para DATE sem necessidade.
- SET ROWCOUNT deve ser usado para limitar volume quando a pergunta nao pedir agregacao.
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
  sqlPatternsProibidos: [],
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
