'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const intentMerger = require(path.join(ROOT, 'modules/ai/intent-merger'));
const intentRouter = require(path.join(ROOT, 'modules/erp/intent-router'));
const iaOwnerRunner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const faturamentoHandlerV2 = require(path.join(ROOT, 'modules/erp/faturamento/ai-sql-handler-v2'));
const WhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));

const fornecedorSoftexpert = {
  tipo: 'fornecedor',
  codigo: '000123',
  loja: '01',
  nome: 'SOFTEXPERT SOFTWARE S/A',
};

const clienteFranciosi = {
  tipo: 'cliente',
  codigo: '000016',
  nome: 'FRANCIOSI',
};

const clientePlantivo = {
  tipo: 'cliente',
  codigo: '000016',
  nome: 'PLANTIVO',
};

const anterior = {
  intencao: 'financeiro_dinamico',
  periodo: { tipo: 'ano', dataInicio: '20260101', dataFim: '20261231' },
  filtros: {},
  group_by: null,
  agrupar_por: null,
  _dynamicAiScope: true,
  _moduloDinamico: 'financeiro',
  _mensagemOriginal: 'Contas a pagar do ano da Softexpert',
  _entidadesResolvidas: [fornecedorSoftexpert],
  _nivel_contexto: 1,
};

const atual = {
  intencao: 'financeiro_dinamico',
  periodo: { tipo: 'nenhum' },
  filtros: {},
  group_by: ['mes'],
  agrupar_por: 'mes',
  confianca: 0.9,
  _dynamicAiScope: true,
  _moduloDinamico: 'financeiro',
  _mensagemOriginal: 'Detalhe por mes',
};

const merged = intentMerger.mesclar(atual, anterior, Date.now(), 'Detalhe por mes');
assert.deepStrictEqual(merged._entidadesResolvidas, [fornecedorSoftexpert], 'refinamento deve herdar fornecedor resolvido');
assert.strictEqual(merged._herdouEntidadesResolvidas, true, 'deve marcar heranca de entidades');

const anteriorPlantivo = {
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'ano', dataInicio: '20260101', dataFim: '20261231' },
  filtros: { cliente: 'Plantivo' },
  _dynamicAiScope: true,
  _moduloDinamico: 'faturamento',
  _mensagemOriginal: 'Faturamento da Plantivo do ano',
  _entidadesResolvidas: [clientePlantivo],
  _entidadesResolvidasPorEmpresa: { 1: [clientePlantivo] },
  _nivel_contexto: 1,
};

const atualAster = {
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'nenhum' },
  filtros: { cliente: 'ASTER' },
  group_by: ['mes'],
  agrupar_por: 'mes',
  confianca: 0.9,
  _dynamicAiScope: true,
  _moduloDinamico: 'faturamento',
  _mensagemOriginal: 'Me detalhe por mes',
};

const mergedAster = intentMerger.mesclar(atualAster, anteriorPlantivo, Date.now(), 'Me detalhe por mes');
assert.strictEqual(mergedAster.filtros.cliente, 'ASTER', 'filtro atual de cliente deve prevalecer');
assert.strictEqual(mergedAster._entidadesResolvidas, undefined, 'troca de cliente deve descartar entidade resolvida anterior');
assert.strictEqual(mergedAster._entidadesResolvidasPorEmpresa, undefined, 'troca de cliente deve descartar entidades por empresa anteriores');

const atualAsterCurto = {
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'nenhum' },
  filtros: {},
  group_by: ['mes'],
  agrupar_por: 'mes',
  confianca: 0.9,
  _dynamicAiScope: true,
  _moduloDinamico: 'faturamento',
  _mensagemOriginal: 'Me detalhe o da ASTER',
};

const mergedAsterCurto = intentMerger.mesclar(atualAsterCurto, anteriorPlantivo, Date.now(), 'Me detalhe o da ASTER');
assert.strictEqual(mergedAsterCurto.filtros.cliente, 'ASTER', 'nome em "da ASTER" deve substituir cliente herdado');
assert.strictEqual(mergedAsterCurto._entidadesResolvidas, undefined, 'entidade antiga nao deve ser herdada quando frase curta troca cliente');
assert.strictEqual(mergedAsterCurto._entidadesResolvidasPorEmpresa, undefined, 'entidades por empresa antigas nao devem ser herdadas quando frase curta troca cliente');

const atualAsterComFiltroAntigoDaIa = {
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'nenhum' },
  filtros: { cliente: 'Plantivo' },
  group_by: ['mes'],
  agrupar_por: 'mes',
  confianca: 0.9,
  _dynamicAiScope: true,
  _moduloDinamico: 'faturamento',
  _mensagemOriginal: 'Me detalhe por mes da ASTER',
};

const mergedAsterComFiltroAntigoDaIa = intentMerger.mesclar(atualAsterComFiltroAntigoDaIa, anteriorPlantivo, Date.now(), 'Me detalhe por mes da ASTER');
assert.strictEqual(mergedAsterComFiltroAntigoDaIa.filtros.cliente, 'ASTER', 'nome explicito em "da ASTER" deve sobrescrever filtro antigo retornado pela IA');
assert.strictEqual(mergedAsterComFiltroAntigoDaIa._entidadesResolvidas, undefined, 'entidade Plantivo nao deve sobreviver quando mensagem explicita ASTER');

const atualDetalhePorMes = {
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'nenhum' },
  filtros: {},
  group_by: ['mes'],
  agrupar_por: 'mes',
  confianca: 0.9,
  _dynamicAiScope: true,
  _moduloDinamico: 'faturamento',
  _mensagemOriginal: 'ME DETALHE POR MES',
};

const mergedDetalhePorMes = intentMerger.mesclar(atualDetalhePorMes, anteriorPlantivo, Date.now(), 'ME DETALHE POR MES');
assert.strictEqual(mergedDetalhePorMes.filtros.cliente, 'Plantivo', 'refinamento por mes deve herdar cliente anterior');
assert.deepStrictEqual(mergedDetalhePorMes._entidadesResolvidas, [clientePlantivo], 'refinamento por mes deve manter cliente ja resolvido');
assert.strictEqual(mergedDetalhePorMes._herdouFiltros, true, 'refinamento por mes deve marcar filtros herdados');

const decidirEntidades = faturamentoHandlerV2._test._decidirEntidadesParaFase2;
const entidadesNomeadasDosFiltros = faturamentoHandlerV2._test._entidadesNomeadasDosFiltros;
const sincronizarFiltrosComEntidadesFase1 = faturamentoHandlerV2._test._sincronizarFiltrosComEntidadesFase1;
const entidadesPlantivoDosFiltros = entidadesNomeadasDosFiltros(mergedDetalhePorMes.filtros);
const decisaoPlantivoPorMes = decidirEntidades(
  mergedDetalhePorMes,
  { entidades_nomeadas: entidadesPlantivoDosFiltros },
  entidadesPlantivoDosFiltros,
);
assert.strictEqual(decisaoPlantivoPorMes.podeReusarEntidadeCompativel, true, 'filtro herdado compativel deve reusar entidade resolvida');
assert.strictEqual(decisaoPlantivoPorMes.lookupObrigatorioEntidadeAtual, false, 'filtro herdado compativel nao deve abrir ambiguidade novamente');
assert.deepStrictEqual(decisaoPlantivoPorMes.entidadesResolvidas, [clientePlantivo], 'decisao deve manter Plantivo resolvida');

const decisaoPlantivoClassificadorRepetiuFiltro = decidirEntidades(
  {
    filtros: { cliente: 'Plantivo' },
    _entidadesResolvidas: [clientePlantivo],
  },
  { entidades_nomeadas: [{ texto: 'Plantivo', tipo_sugerido: 'cliente' }] },
  [{ texto: 'Plantivo', tipo_sugerido: 'cliente' }],
);
assert.strictEqual(decisaoPlantivoClassificadorRepetiuFiltro.podeReusarEntidadeCompativel, true, 'entidade compativel deve ser reusada mesmo quando classificador repetir o filtro textual');
assert.strictEqual(decisaoPlantivoClassificadorRepetiuFiltro.lookupObrigatorioEntidadeAtual, false, 'classificador repetir filtro textual nao deve reabrir ambiguidade');

const decisaoPlantivoEscolhidaAgora = decidirEntidades(
  {
    filtros: { cliente: 'Plantivo' },
    _entidadesResolvidas: [clientePlantivo],
    _entidadeEscolhidaManualmente: true,
  },
  { entidades_nomeadas: [{ texto: 'Plantivo', tipo_sugerido: 'cliente' }] },
  [{ texto: 'Plantivo', tipo_sugerido: 'cliente' }],
);
assert.strictEqual(decisaoPlantivoEscolhidaAgora.lookupObrigatorioEntidadeAtual, false, 'entidade escolhida manualmente nao deve abrir ambiguidade ao reprocessar');
assert.deepStrictEqual(decisaoPlantivoEscolhidaAgora.entidadesResolvidas, [clientePlantivo], 'entidade escolhida manualmente deve ser usada diretamente');

const decisaoAsterNova = decidirEntidades(
  {
    filtros: { cliente: 'ASTER' },
    _filtroEntidadeExplicitaMensagem: { cliente: 'ASTER' },
    _entidadesResolvidas: [clientePlantivo],
  },
  { entidades_nomeadas: [{ texto: 'ASTER', tipo_sugerido: 'cliente' }] },
  [{ texto: 'ASTER', tipo_sugerido: 'cliente' }],
);
assert.strictEqual(decisaoAsterNova.podeReusarEntidadeCompativel, false, 'cliente explicitamente novo nao deve reusar entidade antiga');
assert.strictEqual(decisaoAsterNova.lookupObrigatorioEntidadeAtual, true, 'cliente explicitamente novo deve forcar lookup');
assert.deepStrictEqual(decisaoAsterNova.entidadesResolvidas, [], 'cliente explicitamente novo deve limpar entidade antiga antes do lookup');

const syncAsterSobrePlantivo = sincronizarFiltrosComEntidadesFase1(
  {
    filtros: { cliente: 'Plantivo' },
    _entidadesResolvidas: [clientePlantivo],
  },
  { entidades_nomeadas: [{ texto: 'ASTER', tipo_sugerido: 'cliente' }] },
);
assert.strictEqual(syncAsterSobrePlantivo.intent.filtros.cliente, 'ASTER', 'Fase 1 com ASTER deve sobrescrever filtro herdado Plantivo no handler');
assert.deepStrictEqual(syncAsterSobrePlantivo.intent._filtroEntidadeExplicitaMensagem, { cliente: 'ASTER' }, 'handler deve marcar ASTER como entidade explicita atual');

const svc = new WhatsAppService();
svc._empresaId = 1;
const senderFallback = 'teste-fallback-dinamico@wa';
svc._saveLastIntent(senderFallback, anteriorPlantivo, 1);
const contextoFallbackAll = svc._getScopedLastIntent(senderFallback, '__all__', {
  texto: 'Detalhe por mes',
  allowCompatibleFallback: true,
});
assert.strictEqual(contextoFallbackAll.intent, anteriorPlantivo, 'refinamento em __all__ deve recuperar contexto dinamico salvo na empresa');
assert.strictEqual(contextoFallbackAll.fallbackEscopo, true, 'contexto dinamico de empresa deve ser fallback valido para __all__');
const contextoCrescimentoAll = svc._getScopedLastIntent(senderFallback, '__all__', {
  texto: 'Crescimento do faturamento dos meses de Janeiro a maio dos anos de 2025 e 2026',
  allowCompatibleFallback: true,
});
assert.strictEqual(contextoCrescimentoAll.intent, anteriorPlantivo, 'comparativo/crescimento deve ser tratado como continuacao analitica e recuperar ultimo cliente');
assert.strictEqual(
  svc._isPedidoContinuacaoAnalitica('Crescimento do faturamento dos meses de Janeiro a maio dos anos de 2025 e 2026'),
  true,
  'crescimento/comparativo de faturamento deve preservar contexto de entidade',
);
const senderFallbackRecente = 'teste-fallback-recente@wa';
const anteriorAster = {
  ...anteriorPlantivo,
  filtros: { cliente: 'Aster' },
  _entidadesResolvidas: [{ tipo: 'cliente', codigo: '000048', nome: 'ASTER' }],
  _mensagemOriginal: 'Faturamento da Aster do ano',
};
const anteriorFranciosi = {
  ...anteriorPlantivo,
  filtros: { cliente: 'Franciosi' },
  _entidadesResolvidas: [clienteFranciosi],
  _mensagemOriginal: 'Agora detalhe o da Franciosi',
};
svc._saveLastIntent(senderFallbackRecente, anteriorAster, '__all__');
svc._saveLastIntent(senderFallbackRecente, anteriorFranciosi, 1);
const contextoCrescimentoMaisRecente = svc._getScopedLastIntent(senderFallbackRecente, '__all__', {
  texto: 'Crescimento do faturamento dos meses de Janeiro a maio dos anos de 2025 e 2026',
  allowCompatibleFallback: true,
});
assert.strictEqual(contextoCrescimentoMaisRecente.intent, anteriorFranciosi, 'continuidade em __all__ deve usar o contexto mais recente, nao um __all__ antigo');

const enriquecido = svc._intentComContextoDoResultado(atual, {
  tipo: 'sucesso_ai_sql',
  _entidadesResolvidas: [fornecedorSoftexpert],
}, 7);

assert.deepStrictEqual(enriquecido._entidadesResolvidas, [fornecedorSoftexpert], 'resultado do modulo deve enriquecer intent salvo');
assert.deepStrictEqual(enriquecido._entidadesResolvidasPorEmpresa['7'], [fornecedorSoftexpert], 'deve preservar entidade por empresa');

assert.strictEqual(
  svc._podeReusarSqlCanonicoComEntidades([], { alterou: false, parametros: [] }).ok,
  true,
  'sql canonico sem entidade pode ser reutilizado',
);
assert.strictEqual(
  svc._podeReusarSqlCanonicoComEntidades([fornecedorSoftexpert], { alterou: false, parametros: [] }).ok,
  false,
  'sql canonico com entidade nao parametrizada nao pode ser reutilizado',
);
assert.strictEqual(
  svc._podeReusarSqlCanonicoComEntidades([fornecedorSoftexpert], {
    alterou: true,
    parametros: [{ tipo: 'fornecedor', campo: 'codigo' }],
  }).ok,
  false,
  'sql canonico com fornecedor e loja exige codigo e loja parametrizados',
);
assert.strictEqual(
  svc._podeReusarSqlCanonicoComEntidades([fornecedorSoftexpert], {
    alterou: true,
    parametros: [{ tipo: 'fornecedor', campo: 'codigo' }, { tipo: 'fornecedor', campo: 'loja' }],
  }).ok,
  true,
  'sql canonico com entidade completamente parametrizada pode ser reutilizado',
);
assert.strictEqual(
  svc._sqlCanonicoTemParametroEntidade("WHERE SA1.A1_COD = '{{iac:cliente:codigo}}'"),
  true,
  'deve detectar placeholder de entidade no sql canonico',
);
assert.strictEqual(
  svc._sqlCanonicoTemParametroEntidade("WHERE SA1.A1_COD = '000123'"),
  false,
  'sql sem placeholder de entidade nao deve acionar fallback de entidades do canonico',
);
const entidadesCanonicasOutroTenant = svc._entidadesParaExecucaoAll(
    { filtros: { cliente: 'Franciosi' } },
    99,
    [],
    "WHERE SF2.F2_CLIENTE = '{{iac:cliente:codigo}}'",
    [clienteFranciosi],
);
assert.strictEqual(entidadesCanonicasOutroTenant[0]._resolverNoTenantAtual, true, 'entidade do canonico deve ser resolvida novamente no tenant alvo');
assert.strictEqual(entidadesCanonicasOutroTenant[0].codigo, clienteFranciosi.codigo, 'codigo origem fica apenas como referencia de auditoria ate a resolucao local');
assert.deepStrictEqual(
  iaOwnerRunner._test.pedidosEntidadesParaResolverNoTenant([
    { ...clienteFranciosi, termoBusca: 'Franciosi', _resolverNoTenantAtual: true },
  ]),
  [{ texto: 'Franciosi', tipo: 'cliente', tipo_sugerido: 'cliente', origem: 'filtro_estruturado' }],
  'reuso deve reconstruir pedido pelo termo original para localizar codigo/loja no tenant alvo',
);
const entidadesCanonicasComHistoricoTenant = svc._entidadesParaExecucaoAll(
    {
      filtros: { cliente: 'Franciosi' },
      _entidadesResolvidasPorEmpresa: { 99: [{ ...clientePlantivo, codigo: '000999' }] },
    },
    99,
    [{ entidades_resolvidas: [{ ...clientePlantivo, codigo: '000888' }] }],
    "WHERE SF2.F2_CLIENTE = '{{iac:cliente:codigo}}'",
    [clienteFranciosi],
);
assert.strictEqual(entidadesCanonicasComHistoricoTenant[0].nome, clienteFranciosi.nome, 'entidade da pergunta canonica atual deve prevalecer sobre entidade antiga do tenant');
assert.strictEqual(entidadesCanonicasComHistoricoTenant[0]._resolverNoTenantAtual, true, 'entidade canonica atual deve ser resolvida no tenant antes da execucao');
assert.strictEqual(entidadesCanonicasComHistoricoTenant[0].codigo, clienteFranciosi.codigo, 'codigo historico de outra entidade nao pode contaminar o SQL canonico atual');
for (const entidadeAtual of [
  { tipo: 'fornecedor', codigo: 'F001', loja: '01', nome: 'FORNECEDOR ATUAL', termoBusca: 'Fornecedor Atual' },
  { tipo: 'vendedor', codigo: 'V001', nome: 'VENDEDOR ATUAL', termoBusca: 'Vendedor Atual' },
  { tipo: 'produto', codigo: 'P001', nome: 'PRODUTO ATUAL', termoBusca: 'Produto Atual' },
]) {
  const entidadeTransversal = svc._entidadesParaExecucaoAll(
    { _entidadesResolvidasPorEmpresa: { 99: [{ tipo: entidadeAtual.tipo, codigo: 'ANTIGO', nome: 'ENTIDADE ANTIGA' }] } },
    99,
    [],
    `WHERE CAMPO = '{{iac:${entidadeAtual.tipo}:codigo}}'`,
    [entidadeAtual],
  );
  assert.strictEqual(entidadeTransversal[0].codigo, entidadeAtual.codigo, `canonico de ${entidadeAtual.tipo} deve prevalecer sobre historico`);
  assert.strictEqual(entidadeTransversal[0]._resolverNoTenantAtual, true, `canonico de ${entidadeAtual.tipo} deve ser resolvido no tenant atual`);
}
assert.deepStrictEqual(
  svc._ordenarEmpresasPipelineAll([
    { empresa_id: 2, nome: 'C3I', padrao: 1 },
    { empresa_id: 1, nome: 'J2A', padrao: 0 },
  ]).map(e => e.empresa_id),
  [1, 2],
  'empresa que iniciou o servico deve gerar primeiro o canonico do whatsapp_all',
);
assert.strictEqual(
  svc._empresaConsolidadoId(
    [{ empresa_id: 2, nome: 'C3I', padrao: 1 }],
    [{ empresa_id: 2, nome: 'C3I', padrao: 1 }, { empresa_id: 1, nome: 'J2A', padrao: 0 }],
  ),
  1,
  'registro consolidado deve pertencer a empresa que iniciou o servico, mesmo quando outra executa primeiro',
);
assert.strictEqual(
  intentRouter._temFiltroEntidadeDinamica({ filtros: { cliente: 'ASTER' } }),
  true,
  'filtro textual de cliente deve ser reconhecido como entidade dinamica para resolver codigo',
);
assert.strictEqual(
  intentRouter._temFiltroEntidadeDinamica({ filtros: { filial: '01' } }),
  false,
  'filtro operacional sem entidade nao deve ser tratado como entidade dinamica',
);

const removerClienteNaoSolicitado = faturamentoHandlerV2._test._removerDimensaoClienteNaoSolicitadaSql;
const sqlClienteAgrupadoIndevido = `SET ROWCOUNT 50000; SELECT
  SA1.A1_NOME AS cliente,
  SUM(SD2.D2_TOTAL) AS faturamento,
  SUM(SD2.D2_QUANT) AS quantidade
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_DOC = SF2.F2_DOC AND SF2.D_E_L_E_T_ = ' '
INNER JOIN SA1990 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.F2_CLIENTE = '000016'
GROUP BY SA1.A1_NOME
ORDER BY cliente;`;
const sqlClienteConsolidado = removerClienteNaoSolicitado(
  sqlClienteAgrupadoIndevido,
  { agrupamentos: [] },
  [{ tipo: 'cliente', codigo: '000016', _todos: true }],
);
assert.ok(!/\bA1_NOME\b/i.test(sqlClienteConsolidado), 'cliente filtrado sem agrupamento nao deve ficar no SELECT/GROUP BY');
assert.ok(!/\bGROUP\s+BY\b/i.test(sqlClienteConsolidado), 'GROUP BY somente por cliente deve ser removido para total consolidado');

const aplicarParametrosEntidades = faturamentoHandlerV2._test._aplicarParametrosEntidadesObrigatorios;
const sqlCanonicoComPlaceholder = "SELECT * FROM SF2990 SF2 WHERE SF2.F2_CLIENTE = '{{iac:cliente:codigo}}'";
const sqlCanonicoParametrizado = aplicarParametrosEntidades(
  sqlCanonicoComPlaceholder,
  [{ tipo: 'cliente', codigo: '000048', nome: 'ASTER' }],
);
assert.strictEqual(sqlCanonicoParametrizado.ok, true, 'placeholder de cliente deve ser preenchido quando entidade esta resolvida');
assert.ok(sqlCanonicoParametrizado.sql.includes("'000048'"), 'SQL canonico reutilizado deve receber codigo da ASTER');
assert.ok(!sqlCanonicoParametrizado.sql.includes('{{iac:cliente:codigo}}'), 'SQL final nao pode manter placeholder de entidade');
const sqlCanonicoSemEntidade = aplicarParametrosEntidades(sqlCanonicoComPlaceholder, []);
assert.strictEqual(sqlCanonicoSemEntidade.ok, false, 'placeholder de entidade sem entidade resolvida deve bloquear execucao');

console.log('heranca-entidades-resolvidas.test.js: ok');
