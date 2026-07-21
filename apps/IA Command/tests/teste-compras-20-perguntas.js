'use strict';
/**
 * Validacao manual da fragmentacao de compras — 2 perguntas reais por fragmento,
 * rodadas contra a IA real (empresa J2A).
 */

const EMPRESA_ID = 1;
const SENDER     = '5565999875116';
const BASE_DIR = require('path').resolve(__dirname, '..');

process.chdir(BASE_DIR);

const { inicializarDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();

const IACWhatsAppService = require(BASE_DIR + '/modules/whatsapp/service');
const svc = new IACWhatsAppService();
svc._empresaId  = EMPRESA_ID;
svc._channelId  = 'emp_1';
svc._channelName = 'J2A Consultoria';
svc._isSenderAuthorized = () => true;

const intentRouter = require(BASE_DIR + '/modules/erp/core/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const CASOS = [
  { frag: 'metrica_valor_total', texto: 'Qual o total de compras do mes de junho de 2026?' },
  { frag: 'metrica_valor_total', texto: 'Compras totais do ano de 2026 por fornecedor?' },
  { frag: 'metrica_quantidade_item', texto: 'Qual a quantidade comprada em maio de 2026?' },
  { frag: 'metrica_quantidade_item', texto: 'Volume de compras por produto em junho de 2026?' },
  { frag: 'devolucoes', texto: 'Compras liquidas de junho de 2026 considerando devolucoes?' },
  { frag: 'devolucoes', texto: 'Quanto tivemos de devolucoes de compras em maio de 2026?' },
  { frag: 'cfop_tes', texto: 'Quais compras de junho de 2026 geraram movimentacao de estoque?' },
  { frag: 'cfop_tes', texto: 'Total de compras em maio de 2026 excluindo remessas e transferencias?' },
  { frag: 'media_diaria', texto: 'Qual a media diaria de compras em junho de 2026?' },
  { frag: 'media_diaria', texto: 'Compras medias por dia no mes de maio de 2026?' },
  { frag: 'media_mensal', texto: 'Qual a media mensal de compras de 2026?' },
  { frag: 'media_mensal', texto: 'Media mensal de compras por fornecedor em 2026?' },
  { frag: 'media_anual', texto: 'Qual a media anual de compras dos ultimos 2 anos?' },
  { frag: 'media_anual', texto: 'Compras medias anuais considerando 2025 e 2026?' },
  { frag: 'crescimento_diario', texto: 'Qual o crescimento diario das compras em junho de 2026?' },
  { frag: 'crescimento_diario', texto: 'Variacao das compras dia a dia em maio de 2026?' },
  { frag: 'crescimento_mensal', texto: 'Qual o crescimento mensal das compras em 2026?' },
  { frag: 'crescimento_mensal', texto: 'Compras por mes em 2026 demonstrando evolucao mes a mes?' },
  { frag: 'comparativo_periodos', texto: 'Compras de junho de 2026 comparado com junho de 2025?' },
  { frag: 'comparativo_periodos', texto: 'Compras de 2024, 2025 e 2026 em relacao a cada ano?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO FRAGMENTACAO — 20 PERGUNTAS (COMPRAS)');
  console.log(`Empresa: ${EMPRESA_ID} (J2A)`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < CASOS.length; i++) {
    const { frag, texto } = CASOS[i];
    console.log(`[${i + 1}/${CASOS.length}] [${frag}] ${texto}`);
    try {
      await svc._pipelineAll(texto, [{ empresa_id: EMPRESA_ID, nome: 'J2A Consultoria' }], SENDER, {});
      console.log('  OK');
    } catch (e) {
      console.error('  ERRO:', e.message);
    }
    if (i < CASOS.length - 1) await new Promise(r => setTimeout(r, 1200));
  }

  const { getDB } = require(BASE_DIR + '/modules/database/index');
  const d = getDB();
  console.log(`\n${'─'.repeat(60)}`);
  console.log('SQL GERADO POR PERGUNTA\n');
  for (const { frag, texto } of CASOS) {
    const row = d.prepare(`
      SELECT modulo, resultado_tipo, sql_final_executado, sql_ia_bruto, sql_validacao_erro
      FROM interpretation_log
      WHERE empresa_id = ? AND texto_original = ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(EMPRESA_ID, texto);
    console.log(`\n### [${frag}] ${texto}`);
    if (!row) { console.log('(nao encontrado)'); continue; }
    console.log(`modulo=${row.modulo} tipo=${row.resultado_tipo}`);
    console.log(row.sql_final_executado || row.sql_ia_bruto || '(sem sql)');
    if (row.sql_validacao_erro) console.log('ERRO VALIDACAO:', row.sql_validacao_erro);
  }
  process.exit(0);
})();
