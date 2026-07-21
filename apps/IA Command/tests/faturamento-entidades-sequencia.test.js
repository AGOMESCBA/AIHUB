'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const entitySqlGuard = require(path.join(ROOT, 'modules/erp/totvs_protheus/guards/entity-sql-guard'));
const entityResolver = require(path.join(ROOT, 'modules/ai/entity-resolver'));
const faturamentoSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec'));
const entityCatalog = require(path.join(ROOT, 'modules/erp/totvs_protheus/faturamento/entity-catalog'));

async function main() {
  assert.strictEqual(faturamentoSpec.resolverEntidadesAntesDaIa, true, 'faturamento deve resolver entidades antes da primeira IA-OWNER');

  const termosSemEmpresa = runner._test.deduplicarTermosEntidade([
    { texto: 'J2A', tipo_sugerido: 'desconhecido', origem: 'ia' },
    { texto: 'Plantivo', tipo_sugerido: 'desconhecido', origem: 'ia' },
  ], {
    _empresasMencionadasTextos: ['J2A'],
  }, []);
  assert.deepStrictEqual(termosSemEmpresa.map(t => t.texto), ['Plantivo'], 'empresa IAHub nunca deve seguir para busca cadastral');

  const termosPreviosTenant = await runner._test.extrairTermosEntidadesAntesIa(
    faturamentoSpec,
    {},
    {},
    'Faturamento da empresa J2A',
    {
      filtros: { cliente: 'J2A' },
      _empresasMencionadasTextos: ['J2A'],
    },
    [],
  );
  assert.deepStrictEqual(termosPreviosTenant, [], 'tenant IAHub deve ser removido mesmo quando vier incorretamente em filtros.cliente');

  const mensagemAnalitica = 'Faturamento do ano, por mes, por produto e unidade de medida totalizando por por valor e por quantidade';
  assert.deepStrictEqual(
    entityResolver.extrairExplicitos(mensagemAnalitica),
    [],
    'dimensoes e metricas analiticas nao devem ser interpretadas como nome de produto',
  );

  const intentSemFiltroHerdado = runner._test.limparFiltrosEntidadeHerdadosDaConsultaAtual(
    faturamentoSpec,
    {
      filtros: { cliente: 'Aster', filial: 'TODAS', empresa: 'J2A' },
      _herdouFiltros: true,
      _empresasMencionadasTextos: ['J2A'],
      _entidadesResolvidas: [{ tipo: 'cliente', codigo: '000001', nome: 'ASTER' }],
      _orquestradorContrato: { filtros: { cliente: 'Aster', filial: 'TODAS', empresa: 'J2A' } },
    },
    mensagemAnalitica,
  );
  assert.deepStrictEqual(
    intentSemFiltroHerdado.filtros,
    { filial: 'TODAS', empresa: 'J2A' },
    'consulta nova explicita deve remover somente entidade cadastral herdada',
  );
  assert.strictEqual(intentSemFiltroHerdado._empresasMencionadasTextos[0], 'J2A', 'regra de empresa/tenant deve ser preservada');
  assert.deepStrictEqual(intentSemFiltroHerdado._entidadesResolvidas, [], 'entidade resolvida herdada removida nao deve contaminar a IA');
  assert.deepStrictEqual(
    intentSemFiltroHerdado._orquestradorContrato.filtros,
    { filial: 'TODAS', empresa: 'J2A' },
    'contrato deve preservar empresa e filial ao remover entidade herdada',
  );

  const intentComEntidadeRepetida = runner._test.limparFiltrosEntidadeHerdadosDaConsultaAtual(
    faturamentoSpec,
    { filtros: { cliente: 'Aster' }, _herdouFiltros: true },
    'Faturamento do cliente Aster no ano',
  );
  assert.strictEqual(intentComEntidadeRepetida.filtros.cliente, 'Aster', 'entidade citada na mensagem atual deve ser preservada');

  const intentRefinamento = runner._test.limparFiltrosEntidadeHerdadosDaConsultaAtual(
    faturamentoSpec,
    { filtros: { cliente: 'Aster' }, _herdouFiltros: true },
    'por mes',
  );
  assert.strictEqual(intentRefinamento.filtros.cliente, 'Aster', 'refinamento curto deve continuar herdando entidade anterior');

  const intentCetiqt = runner._test.normalizarFiltroEmpresaComoEntidade(
    faturamentoSpec,
    {
      filtros: { empresa: 'CETIQT' },
      _orquestradorContrato: { filtros: { empresa: 'CETIQT' } },
    },
    'Agora me de o faturamento da CETIQT',
  );
  assert.deepStrictEqual(intentCetiqt.filtros, { cliente: 'CETIQT' }, 'nome sem palavra empresa deve virar cliente no faturamento');
  assert.deepStrictEqual(intentCetiqt._filtroEntidadeExplicitaMensagem, { cliente: 'CETIQT' }, 'CETIQT deve seguir para resolucao cadastral antes da IA');
  assert.deepStrictEqual(intentCetiqt._orquestradorContrato.filtros, { cliente: 'CETIQT' }, 'contrato nao deve continuar apresentando CETIQT como tenant');

  const intentEmpresaExplicita = runner._test.normalizarFiltroEmpresaComoEntidade(
    faturamentoSpec,
    { filtros: { empresa: 'ASTER' } },
    'Faturamento do ano da empresa ASTER',
  );
  // Comportamento esperado: sem tenant validado, "empresa ASTER" vira filtros.cliente
  // (fallback para entidade cadastral quando o nome não existe no tenant IAHub)
  assert.deepStrictEqual(intentEmpresaExplicita.filtros, { cliente: 'ASTER' }, 'empresa nao encontrada no tenant deve virar cliente no modulo faturamento');
  assert.strictEqual(intentEmpresaExplicita._filtroEmpresaReclassificadoComoEntidade?.tipo, 'cliente', 'reclassificacao deve ser registrada');

  const intentTenantValidado = runner._test.normalizarFiltroEmpresaComoEntidade(
    faturamentoSpec,
    { filtros: { empresa: 'J2A' }, _empresaMencionadaId: 2, _empresaMencionadaTexto: 'J2A' },
    'Faturamento do ano da empresa J2A',
  );
  assert.deepStrictEqual(intentTenantValidado.filtros, { empresa: 'J2A' }, 'tenant validado pelo canal deve permanecer escopo IAHub');

  const termosSemAsterHerdado = await runner._test.extrairTermosEntidadesAntesIa(
    faturamentoSpec,
    {},
    {},
    mensagemAnalitica,
    { filtros: { cliente: 'Aster' }, _herdouFiltros: true },
    [],
  );
  assert.deepStrictEqual(termosSemAsterHerdado, [], 'filtro cadastral herdado nao deve bloquear uma nova consulta antes da IA');

  const diagnosticoNaoEncontrado = runner._test.diagnosticoResolucaoEntidade({
    status: 'nao_encontrado',
    texto: 'Aster',
    origem: 'explicito',
  });
  assert.strictEqual(diagnosticoNaoEncontrado.status, 'nao_encontrado', 'falha da busca auxiliar deve virar diagnostico para a IA');
  assert(diagnosticoNaoEncontrado.instrucao.includes('gere o SQL pela IA'), 'diagnostico deve orientar o encaminhamento para a IA');
  const diagnosticoAmbiguo = runner._test.diagnosticoResolucaoEntidade({
    status: 'ambigua',
    texto: 'Aster',
    candidatos: [{ codigo: '001' }, { codigo: '002' }],
  });
  assert.strictEqual(diagnosticoAmbiguo.candidatos.length, 2, 'ambiguidades devem seguir como contexto para a IA decidir');
  assert.strictEqual(
    runner._test.diagnosticoResolucaoEntidade({ status: 'resolvido', entidades: [] }),
    null,
    'resolucao bem-sucedida nao precisa de diagnostico de fallback',
  );

  const sqls = [];
  const helpers = {
    tabelaFisicaSX2: (_sx2, base) => `${base}990`,
    escapeSqlLiteral: valor => String(valor || '').replace(/'/g, "''"),
    connectionFactory: {
      carregarConexao: () => ({}),
      executar: async (_conn, sql) => {
        sqls.push(sql);
        if (sql.includes('SA1990 SA1')) {
          return [
            { codigo: '000016', loja: '01', nome: 'PLANTIVO' },
            { codigo: '000016', loja: '01', nome: 'PLANTIVO' },
          ];
        }
        return [];
      },
    },
  };

  const resolucaoLivre = await faturamentoSpec._test.resolverEntidades({
    pedidos: [{ texto: 'Plantivo', tipo: 'desconhecido', tipo_sugerido: 'desconhecido', origem: 'ia' }],
    empresaId: 1,
    sx2: { SF2990: 'E', SD2990: 'E', SA1990: 'E', SB1990: 'E' },
    periodo: { dataInicio: '20260101', dataFim: '20261231' },
    filial: 'TODAS',
    helpers,
  });
  assert.strictEqual(resolucaoLivre.status, 'resolvido', 'termo livre deve ser resolvido');
  assert.strictEqual(resolucaoLivre.entidades[0].tipo, 'cliente', 'faturamento deve resolver cliente antes das demais entidades');
  assert.strictEqual(resolucaoLivre.entidades[0].termoBusca, 'Plantivo', 'faturamento deve preservar o termo para resolver novamente em outro tenant');
  assert.strictEqual(sqls.length, 1, 'deve parar a sequencia assim que cliente for encontrado');
  assert(sqls[0].includes('SA1990 SA1'), 'primeira busca cadastral deve ser cliente/SA1');
  assert(!sqls[0].includes('SELECT DISTINCT SA1.'), 'lookup direto de cliente nao deve usar DISTINCT que faz o agente local retornar vazio');
  assert(!sqls[0].includes('SF2990 SF2'), 'cliente deve ser resolvido direto no cadastro SA1, sem depender de faturamento no periodo');
  assert(!sqls[0].includes('20260101'), 'lookup cadastral de cliente nao deve ser limitado pelo periodo da consulta');
  assert.strictEqual(resolucaoLivre.entidades.length, 1, 'duplicatas do cadastro devem ser eliminadas no Node');

  assert.strictEqual(
    runner._test.confirmacaoPodeEncerrarPlano({
      precisa_confirmacao: true,
      entidades_necessarias: [{ tipo: 'cliente', texto: 'CETIQT' }],
    }),
    false,
    'confirmacao nao pode encerrar o fluxo antes de resolver cliente CETIQT',
  );
  assert.strictEqual(
    runner._test.confirmacaoPodeEncerrarPlano({ precisa_confirmacao: true, entidades_necessarias: [] }),
    true,
    'confirmacao real sem entidade pendente pode encerrar o fluxo',
  );

  const cliente = { tipo: 'cliente', codigo: '000016', loja: '01', nome: 'PLANTIVO' };
  const semCodigo = entitySqlGuard.validarSqlEntidadesResolvidas(
    "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.D_E_L_E_T_ = ' '",
    { entidades: [cliente] },
    entityCatalog.DEFINICOES,
  );
  assert.strictEqual(semCodigo.ok, false, 'SQL sem codigo do cliente resolvido deve ser rejeitado');

  const comCodigo = entitySqlGuard.validarSqlEntidadesResolvidas(
    "SET ROWCOUNT 50000; SELECT SUM(SF2.F2_VALBRUT) FROM SF2990 SF2 WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_CLIENTE = '000016' AND SF2.F2_LOJA = '01'",
    { entidades: [cliente] },
    entityCatalog.DEFINICOES,
  );
  assert.strictEqual(comCodigo.ok, true, `SQL com codigo/loja resolvidos deve ser aceito: ${comCodigo.erros.join(' | ')}`);

  const retryEntidade = runner._test.buildRetryTecnicoIaOwner({
    erro: Object.assign(new Error('SQL nao aplicou entidades resolvidas: SQL nao aplicou filtro de codigo do cliente 000048.'), {
      _tipo: 'contrato_entidade_invalido',
    }),
    entidadesResolvidas: [{ tipo: 'cliente', codigo: '000048', nome: 'ASTER', _todos: true }],
  });
  assert(retryEntidade.includes('RETRY TECNICO IA-OWNER'), 'retry deve ter cabecalho tecnico explicito');
  assert(retryEntidade.includes('cliente: codigo 000048'), 'retry de entidade deve explicitar codigo resolvido');
  assert(retryEntidade.includes('nao filtre loja fixa'), 'retry de _todos deve proibir filtro fixo de loja');
  assert(retryEntidade.includes('Nao filtrar por nome'), 'retry de entidade deve proibir nome/LIKE');

  const retryDelete = runner._test.buildRetryTecnicoIaOwner({
    erro: Object.assign(new Error("JOIN SA1990 SA1 deve filtrar SA1.D_E_L_E_T_ = ' ' na condicao ON do JOIN."), {
      _tipo: 'contrato_ia_owner_invalido',
    }),
    entidadesResolvidas: [{ tipo: 'cliente', codigo: '000048', _todos: true }],
  });
  assert(retryDelete.includes("Tabelas em JOIN: filtro dentro do ON"), 'retry de D_E_L_E_T_ deve orientar filtro no ON');
  assert(retryDelete.includes('Preserve periodo, metrica, entidades resolvidas'), 'retry de D_E_L_E_T_ deve preservar entidades');

  console.log('faturamento-entidades-sequencia.test.js: ok');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
