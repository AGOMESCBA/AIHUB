'use strict';

const path = require('path');

const EMPRESA_ID = 5;
const EMPRESA_NOME = 'PLANTIVO';
const SENDER = '5565999875116';
const PERGUNTA = 'Faturamento do dia 06/08/2026 detalhado por cliente, nota fiscal, produto, TES (codigo e descrição) e CFOP, trazendo valor faturado e quantidade.';

const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

const { inicializarDB, getDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const IACWhatsAppService = require(path.join(BASE_DIR, 'modules/whatsapp/service'));
const intentRouter = require(path.join(BASE_DIR, 'modules/erp/core/intent-router'));
const faturamentoSpec = require(path.join(BASE_DIR, 'modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec'));

if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

function ultimoLog(pergunta, desdeIso) {
  return getDB().prepare(`
    SELECT id, empresa_id, modulo, intencao, resultado_tipo, texto_original,
           sql_ia_bruto, sql_final_executado, sql_validacao_erro, criado_em
      FROM interpretation_log
     WHERE empresa_id = ?
       AND texto_original = ?
       AND criado_em >= ?
     ORDER BY criado_em DESC
     LIMIT 1
  `).get(EMPRESA_ID, pergunta, desdeIso);
}

function checarSql(sql) {
  const texto = String(sql || '');
  const checks = [
    ['cliente', /\bSA1\s*\.\s*A1_NOME\s+AS\s+cliente\b/i],
    ['nota_fiscal', /\bSF2\s*\.\s*F2_DOC\b[\s\S]{0,40}\bnota/i],
    ['produto', /\bSB1\s*\.\s*B1_DESC\s+AS\s+produto\b/i],
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
  const inicio = new Date().toISOString();
  const svc = new IACWhatsAppService();
  svc._empresaId = EMPRESA_ID;
  svc._channelId = 'emp_5';
  svc._channelName = `01 - Id 5 - ${EMPRESA_NOME}`;
  svc._isSenderAuthorized = () => true;
  svc._enviarResposta = async () => {};

  console.log(`Empresa ${EMPRESA_ID} (${EMPRESA_NOME})`);
  console.log(`Pergunta: ${PERGUNTA}`);

  let resposta;
  try {
    resposta = await svc._pipelineAll(PERGUNTA, [{ empresa_id: EMPRESA_ID, empresaId: EMPRESA_ID, nome: EMPRESA_NOME }], SENDER, {});
  } catch (e) {
    console.error('ERRO_PIPELINE:', e && e.stack ? e.stack : e);
  }

  const log = ultimoLog(PERGUNTA, inicio);
  const sql = log?.sql_final_executado || log?.sql_ia_bruto || resposta?.sql_gerado || '';
  const validacao = faturamentoSpec._test.validarExclusaoCfopReceita(sql, PERGUNTA);
  const checks = checarSql(sql);

  console.log('\nRESULTADO_PIPELINE:');
  console.log(JSON.stringify({
    tipo: resposta?.tipo,
    subtipo: resposta?.subtipo,
    ok: resposta?.ok,
    rowCount: Array.isArray(resposta?.rows) ? resposta.rows.length : null,
    respostaDireta: resposta?.resposta_direta || resposta?.resposta || null,
  }, null, 2));

  console.log('\nLOG:');
  console.log(JSON.stringify(log ? {
    id: log.id,
    empresa_id: log.empresa_id,
    modulo: log.modulo,
    intencao: log.intencao,
    resultado_tipo: log.resultado_tipo,
    sql_validacao_erro: log.sql_validacao_erro,
    criado_em: log.criado_em,
  } : null, null, 2));

  console.log('\nCHECKS_SQL:');
  console.log(JSON.stringify(checks, null, 2));

  console.log('\nVALIDACAO_CFOP_RECEITA:');
  console.log(validacao || 'ok');

  console.log('\nSQL:');
  console.log(sql || '(sem sql)');

  console.log('\nDADOS:');
  if (Array.isArray(resposta?.rows)) {
    console.log(JSON.stringify({
      total_linhas: resposta.rows.length,
      primeiras_linhas: resposta.rows.slice(0, 20),
    }, null, 2));
  } else if (Array.isArray(resposta?.interpretacoes)) {
    console.log(JSON.stringify(resposta.interpretacoes.map(item => ({
      empresaId: item.empresaId || item.empresa_id,
      nome: item.nome || item.empresaNome || item.empresa,
      tipo: item.resultado?.tipo || item.tipo,
      total_linhas: Array.isArray(item.resultado?.rows) ? item.resultado.rows.length : null,
      primeiras_linhas: Array.isArray(item.resultado?.rows) ? item.resultado.rows.slice(0, 20) : null,
      resposta_direta: item.resultado?.resposta_direta || item.resposta_direta || null,
    })), null, 2));
  } else {
    console.log(JSON.stringify(resposta || null, null, 2));
  }

  const falhas = checks.filter(c => !c.ok).map(c => c.nome);
  if (!sql || validacao || falhas.length || log?.sql_validacao_erro) {
    console.error('\nFALHAS:', JSON.stringify({ falhas, validacao, sql_validacao_erro: log?.sql_validacao_erro || null }, null, 2));
    process.exit(1);
  }

  process.exit(0);
})();
