'use strict';

const path = require('path');

const EMPRESA_ID = 5;
const PERGUNTA = 'Faturamento do dia 06/08/2026 detalhado por cliente, nota fiscal, produto, TES (codigo e descrição) e CFOP, trazendo valor faturado e quantidade.';
const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

const { inicializarDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const intentRouter = require(path.join(BASE_DIR, 'modules/erp/core/intent-router'));
const faturamentoSpec = require(path.join(BASE_DIR, 'modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec'));

function checarSql(sql) {
  const texto = String(sql || '');
  const checks = [
    ['cliente', /\bSA1\s*\.\s*A1_NOME\s+AS\s+(?:nome_)?cliente\b/i],
    ['nota_fiscal', /\bSF2\s*\.\s*F2_DOC\s+AS\s+(?:numero_)?(?:nota|nota_fiscal|nf)/i],
    ['produto', /\bSB1\s*\.\s*B1_DESC\s+AS\s+(?:descricao_)?produto\b/i],
    ['tes_codigo', /\bSD2\s*\.\s*D2_TES\b|\bSF4\s*\.\s*F4_CODIGO\b/i],
    ['tes_descricao', /\bSF4\s*\.\s*F4_TEXTO\b/i],
    ['cfop', /\bSD2\s*\.\s*D2_CF\b/i],
    ['valor_faturado', /\bSUM\s*\(\s*SD2\s*\.\s*D2_TOTAL\s*\)|\bSD2\s*\.\s*D2_TOTAL\b/i],
    ['quantidade', /\bSUM\s*\(\s*SD2\s*\.\s*D2_QUANT\s*\)|\bSD2\s*\.\s*D2_QUANT\b/i],
    ['periodo_06082026', /20260806/i],
    ['tipo_normal', /\bSF2\s*\.\s*F2_TIPO\s*=\s*'N'/i],
    ['exclui_remessa', /NOT\s*\([\s\S]{0,120}D2_CF\s+LIKE\s+'59%'[\s\S]{0,80}OR[\s\S]{0,80}D2_CF\s+LIKE\s+'69%'/i],
    ['exclui_transferencia', /D2_CF\s+NOT\s+IN\s*\([\s\S]*'5151'[\s\S]*'6156'[\s\S]*\)/i],
    ['exclui_devolucao_compra', /NOT\s*\([\s\S]{0,120}D2_CF\s+LIKE\s+'52%'[\s\S]{0,80}OR[\s\S]{0,80}D2_CF\s+LIKE\s+'62%'/i],
    ['exclui_st', /D2_CF\s+NOT\s+IN\s*\([\s\S]*'5410'[\s\S]*'6413'[\s\S]*\)/i],
    ['exclui_ativo_uso_consumo', /NOT\s*\([\s\S]{0,120}D2_CF\s+LIKE\s+'55%'[\s\S]{0,80}OR[\s\S]{0,80}D2_CF\s+LIKE\s+'65%'/i],
    ['exclui_credito_icms', /NOT\s*\([\s\S]{0,120}D2_CF\s+LIKE\s+'56%'[\s\S]{0,80}OR[\s\S]{0,80}D2_CF\s+LIKE\s+'66%'/i],
  ];
  return checks.map(([nome, re]) => ({ nome, ok: re.test(texto) }));
}

(async () => {
  const intent = {
    intencao: 'faturamento_dinamico',
    acao: 'ai_text_to_sql',
    periodo: { tipo: 'personalizado', dataInicio: '20260806', dataFim: '20260806' },
    filtros: {},
    agrupar_por: null,
    ordenar_por: null,
    limite: null,
    _mensagemOriginal: PERGUNTA,
    _moduloDinamico: 'faturamento',
    _dynamicAiScope: true,
  };

  console.log(`Empresa ${EMPRESA_ID} (PLANTIVO)`);
  console.log(`Pergunta: ${PERGUNTA}`);

  const resultado = await intentRouter.rotear(intent, EMPRESA_ID);
  const sql = resultado?.sql_gerado || resultado?.sql_final_executado || resultado?.sql || '';
  const checks = checarSql(sql);
  const validacao = faturamentoSpec._test.validarExclusaoCfopReceita(sql, PERGUNTA);
  const rows = Array.isArray(resultado?.rows) ? resultado.rows : [];

  console.log('\nRESULTADO:');
  console.log(JSON.stringify({
    tipo: resultado?.tipo,
    subtipo: resultado?.subtipo,
    dataset_id: resultado?.dataset_id || null,
    dataset_nome: resultado?.dataset_nome || null,
    total_linhas: rows.length,
    resposta_direta: resultado?.resposta_direta || resultado?.mensagem || null,
    erro: resultado?.erro || null,
  }, null, 2));

  console.log('\nCHECKS_SQL:');
  console.log(JSON.stringify(checks, null, 2));

  console.log('\nVALIDACAO_CFOP_RECEITA:');
  console.log(validacao || 'ok');

  console.log('\nSQL:');
  console.log(sql || '(sem sql)');

  console.log('\nDADOS:');
  console.log(JSON.stringify({
    total_linhas: rows.length,
    primeiras_linhas: rows.slice(0, 50),
  }, null, 2));

  const falhas = checks.filter(c => !c.ok).map(c => c.nome);
  if (resultado?.tipo !== 'sucesso_ai_sql' && resultado?.tipo !== 'sucesso') {
    process.exit(1);
  }
  if (!sql || validacao || falhas.length) {
    console.error('\nFALHAS:', JSON.stringify({ falhas, validacao }, null, 2));
    process.exit(1);
  }
})();
