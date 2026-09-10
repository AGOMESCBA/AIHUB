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

// Mapa modulo -> tabelas, usado SOMENTE para o guard de roteamento abaixo (nao para dar
// conhecimento de dominio ao spec generico, que continua enxuto de proposito). Lido dos
// proprios specs dedicados (fonte unica de verdade) — nunca hardcoded aqui, para nao
// desatualizar se um modulo ganhar/perder tabela.
const MODULOS_COM_SPEC = {
  faturamento: () => require('../faturamento/faturamento-ia-owner-spec'),
  compras:     () => require('../compras/compras-ia-owner-spec'),
  financeiro:  () => require('../financeiro/financeiro-ia-owner-spec'),
  comissao:    () => require('../comissao/comissao-ia-owner-spec'),
  estoque:     () => require('../estoque/estoque-ia-owner-spec'),
};

function _tabelaPorModulo() {
  const mapa = new Map();
  for (const [modulo, loader] of Object.entries(MODULOS_COM_SPEC)) {
    let tabelas = [];
    try { tabelas = loader().tabelas || []; } catch (_) { tabelas = []; }
    for (const t of tabelas) {
      const chave = String(t || '').toUpperCase();
      if (!chave) continue;
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(modulo);
    }
  }
  return mapa;
}

// Exemplos de vocabulario por modulo, usados so para orientar a reformulacao na mensagem
// de erro do guard abaixo — nao tem nenhum efeito em SQL nem em classificacao.
const EXEMPLOS_POR_MODULO = {
  faturamento: '"faturamento do mês", "nota fiscal emitida" ou "vendas por cliente"',
  compras: '"pedido de compra", "nota de entrada" ou "compras por fornecedor"',
  financeiro: '"saldo bancário", "conta a pagar/receber" ou "fluxo de caixa"',
  comissao: '"comissão do vendedor" ou "comissão por período"',
  estoque: '"saldo de estoque", "posição de estoque" ou "produto por local"',
};

// Guard de ROTEAMENTO, nao de negocio: pergunta caiu em erp_generico (sem spec dedicado
// reconhecido pelo classificador), mas o SQL gerado referencia tabela que pertence a um
// modulo com spec proprio — sinal de que a classificacao de intencao errou o modulo, nao
// que o dominio realmente carece de spec (ex: RH, producao). Bloqueia e pede reformulacao
// em vez de deixar a IA gerar SQL sem nenhum guardrail de dominio (sqlPatternsProibidos
// deste spec e []).
function _construirGuardRoteamento() {
  const porTabela = _tabelaPorModulo();
  return {
    validar(sql) {
      const texto = String(sql || '').toUpperCase();
      const encontrados = new Map(); // tabela -> modulos
      for (const [tabela, modulos] of porTabela.entries()) {
        const re = new RegExp(`\\b${tabela}\\d*\\b`, 'i');
        if (re.test(texto)) encontrados.set(tabela, modulos);
      }
      if (!encontrados.size) return null;

      const exclusivas = [...encontrados.entries()].filter(([, modulos]) => modulos.length === 1);
      if (exclusivas.length) {
        const modulo = exclusivas[0][1][0];
        const exemplos = EXEMPLOS_POR_MODULO[modulo] || 'termos especificos do modulo correto';
        return (
          `Essa pergunta parece ser sobre ${modulo}, mas foi processada fora desse contexto. ` +
          `Tente reformular mencionando termos como ${exemplos}.`
        );
      }
      const modulosEnvolvidos = [...new Set([...encontrados.values()].flat())].sort();
      return (
        `Essa pergunta parece pertencer a um dos módulos do sistema (${modulosEnvolvidos.join(', ')}), mas não foi reconhecida corretamente. ` +
        `Tente reformular sendo mais específico sobre o assunto (ex: "vendas", "contas a pagar", "comissão de vendedor").`
      );
    },
  };
}

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
  sqlPatternsProibidos: [_construirGuardRoteamento()],
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
