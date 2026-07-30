'use strict';

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

const SENDER = '5565999988066'; // Almir Weder
const EMPRESAS = [
  { empresa_id: 1, nome: 'J2A Consultoria', alias: 'J2A' },
  { empresa_id: 2, nome: 'C3I', alias: 'C3I' },
];

const { inicializarDB, getDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const IACWhatsAppService = require(path.join(BASE_DIR, 'modules/whatsapp/service'));
const svc = new IACWhatsAppService();
svc._empresaId = 1;
svc._channelId = 'emp_1';
svc._channelName = 'WhatsApp J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(path.join(BASE_DIR, 'modules/erp/core/intent-router'));
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

const respostas = [];
svc._enviarResposta = async (_sender, texto) => {
  respostas.push(String(texto || ''));
};

const CASOS = [
  {
    modulo: 'faturamento',
    nome: 'Faturamento comparativo mensal',
    texto: 'Compare o faturamento de junho do ano passado com julho do ano passado',
    reset: true,
  },
  {
    modulo: 'faturamento',
    nome: 'Continuidade por cliente',
    texto: 'Agora detalhe por cliente',
  },
  {
    modulo: 'compras_faturamento',
    nome: 'Cross-over compras x faturamento',
    texto: 'Compare compras e faturamento por mes nos ultimos 6 meses',
    reset: true,
  },
  {
    modulo: 'financeiro',
    nome: 'Financeiro faixa de atraso',
    texto: 'Qual o total de contas a receber vencidas por empresa e por faixa de atraso?',
    reset: true,
  },
  {
    modulo: 'financeiro',
    nome: 'Continuidade financeiro por cliente',
    texto: 'Agora detalhe por cliente somente a faixa acima de 60 dias',
  },
  {
    modulo: 'compras_faturamento',
    nome: 'Repeticao para cache/reuso',
    texto: 'Compare compras e faturamento por mes nos ultimos 6 meses',
    reset: true,
  },
];

function oneLine(v, max = 260) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseJson(v) {
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}

function ultimosLogs(texto, desdeIso) {
  const db = getDB();
  return db.prepare(`
    SELECT id, empresa_id, modulo, resultado_tipo, rows_count, duracao_ms,
           pipeline_origem, origem, sql_canonico_origem, cache_hit,
           formatacao_caminho, dataset_nome, sql_validacao_erro,
           intent_canonico_hash, chave_cache, sql_template,
           sql_final_executado, sql_gerado, resposta_entregue, criado_em
      FROM interpretation_log
     WHERE texto_original = ?
       AND criado_em >= ?
     ORDER BY criado_em DESC
     LIMIT 8
  `).all(texto, desdeIso);
}

function shadowLogs(desdeIso) {
  const db = getDB();
  return db.prepare(`
    SELECT empresa_id, module, candidate_score, comparacao_resultado,
           classificacao_auto, classificacao_efetiva, criado_em
      FROM nlsql_semantic_shadow_log
     WHERE criado_em >= ?
     ORDER BY criado_em DESC
     LIMIT 12
  `).all(desdeIso);
}

function resumoAprendizado(desdeIso) {
  const db = getDB();
  const interp = db.prepare(`
    SELECT
      COUNT(*) total,
      SUM(CASE WHEN pipeline_origem = 'canonico_reuso'
             OR sql_canonico_origem IN ('whatsapp_all_reuso', 'ia_owner_reuso')
             THEN 1 ELSE 0 END) reuso_canonico,
      SUM(CASE WHEN origem = 'dataset_semantico' OR dataset_nome IS NOT NULL
             THEN 1 ELSE 0 END) dataset,
      SUM(CASE WHEN intent_canonico_hash IS NOT NULL OR chave_cache IS NOT NULL
             THEN 1 ELSE 0 END) canonico_gravado
      FROM interpretation_log
     WHERE criado_em >= ?
  `).get(desdeIso);
  const shadow = db.prepare(`
    SELECT COUNT(*) total
      FROM nlsql_semantic_shadow_log
     WHERE criado_em >= ?
  `).get(desdeIso);
  return { ...interp, shadow: shadow.total };
}

(async () => {
  const inicio = new Date(Date.now() - 1000).toISOString();
  console.log('TESTE REAL WHATSAPP + IA + APRENDIZADO');
  console.log(`Canal: ${svc._channelId} | Sender: ${SENDER}`);
  console.log(`Empresas: ${EMPRESAS.map(e => `${e.nome} (#${e.empresa_id})`).join(' + ')}`);
  console.log(`Inicio: ${inicio}`);

  for (let i = 0; i < CASOS.length; i += 1) {
    const caso = CASOS[i];
    if (caso.reset && typeof svc._clearLastIntent === 'function') svc._clearLastIntent(SENDER);
    respostas.length = 0;
    const t0 = Date.now();
    console.log(`\n[${i + 1}/${CASOS.length}] ${caso.nome}`);
    console.log(`Pergunta: ${caso.texto}`);
    try {
      await svc._pipelineAll(caso.texto, EMPRESAS, SENDER, {});
      console.log(`Status: OK em ${Date.now() - t0}ms`);
    } catch (err) {
      console.log(`Status: ERRO em ${Date.now() - t0}ms`);
      console.log(`Erro: ${err.stack || err.message}`);
    }

    const resposta = respostas[respostas.length - 1] || '';
    if (resposta) console.log(`Resposta: ${oneLine(resposta, 700)}`);

    const logs = ultimosLogs(caso.texto, inicio);
    console.log(`Logs: ${logs.length}`);
    for (const row of logs.slice().reverse()) {
      const intent = parseJson(row.intent_canonico_hash ? null : null);
      console.log(`- empresa=${row.empresa_id} modulo=${row.modulo || '-'} tipo=${row.resultado_tipo || '-'} rows=${row.rows_count ?? '-'} ms=${row.duracao_ms ?? '-'}`);
      console.log(`  origem=${row.origem || '-'} pipeline=${row.pipeline_origem || '-'} canonico=${row.sql_canonico_origem || '-'} cache_hit=${row.cache_hit ?? '-'} dataset=${row.dataset_nome || '-'}`);
      console.log(`  hash=${row.intent_canonico_hash || '-'} chave=${row.chave_cache || '-'}`);
      if (row.sql_validacao_erro) console.log(`  ERRO_SQL=${oneLine(row.sql_validacao_erro, 500)}`);
      const sql = row.sql_final_executado || row.sql_gerado || '';
      if (sql) console.log(`  SQL=${oneLine(sql, 900)}`);
    }

    if (i < CASOS.length - 1) await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log('\nRESUMO APRENDIZADO DA BATERIA');
  console.log(JSON.stringify(resumoAprendizado(inicio), null, 2));

  const shadows = shadowLogs(inicio);
  console.log('\nSHADOW MODE GERADO');
  if (!shadows.length) console.log('(nenhum registro de shadow no periodo do teste)');
  for (const s of shadows) {
    console.log(`- empresa=${s.empresa_id} modulo=${s.module} score=${s.candidate_score ?? '-'} resultado=${s.comparacao_resultado} auto=${s.classificacao_auto || '-'} efetiva=${s.classificacao_efetiva || '-'} em=${s.criado_em}`);
  }
})();
