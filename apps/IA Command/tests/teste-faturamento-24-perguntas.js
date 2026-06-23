'use strict';
/**
 * Validacao manual da Fase 2 (fragmentacao do faturamento) — 2 perguntas reais
 * por fragmento, rodadas contra a IA real (empresa J2A).
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

const intentRouter = require(BASE_DIR + '/modules/erp/intent-router');
if (typeof intentRouter._verificarAutorizacaoModulo === 'function') {
  intentRouter._verificarAutorizacaoModulo = () => null;
}

svc._enviarResposta = async () => {};

const CASOS = [
  // metrica_valor_total
  { frag: 'metrica_valor_total', texto: 'Qual o faturamento do mes de junho de 2026?' },
  { frag: 'metrica_valor_total', texto: 'Faturamento total do ano de 2026 por cliente?' },
  // metrica_quantidade_item
  { frag: 'metrica_quantidade_item', texto: 'Qual a quantidade faturada em maio de 2026?' },
  { frag: 'metrica_quantidade_item', texto: 'Volume de vendas por produto em junho de 2026?' },
  // devolucoes
  { frag: 'devolucoes', texto: 'Faturamento liquido de junho de 2026 considerando devolucoes?' },
  { frag: 'devolucoes', texto: 'Quanto tivemos de devolucoes de vendas em maio de 2026?' },
  // cfop_tes_centro_custo
  { frag: 'cfop_tes_centro_custo', texto: 'Qual a quantidade carregada em junho de 2026?' },
  { frag: 'cfop_tes_centro_custo', texto: 'Quantidade de nota mae para entrega futura em maio de 2026?' },
  // frequencia_cliente
  { frag: 'frequencia_cliente', texto: 'Quais clientes tiveram faturamento em todos os meses de 2026?' },
  { frag: 'frequencia_cliente', texto: 'Lista de clientes com recorrencia de compra todo mes em 2026?' },
  // media_diaria
  { frag: 'media_diaria', texto: 'Qual a media diaria de faturamento em junho de 2026?' },
  { frag: 'media_diaria', texto: 'Faturamento medio por dia no mes de maio de 2026?' },
  // media_mensal
  { frag: 'media_mensal', texto: 'Qual o faturamento medio mensal de 2026?' },
  { frag: 'media_mensal', texto: 'Media mensal de faturamento por produto em 2026?' },
  // media_anual
  { frag: 'media_anual', texto: 'Qual a media anual de faturamento dos ultimos 2 anos?' },
  { frag: 'media_anual', texto: 'Faturamento medio anual considerando 2025 e 2026?' },
  // crescimento_diario
  { frag: 'crescimento_diario', texto: 'Qual o crescimento diario do faturamento em junho de 2026?' },
  { frag: 'crescimento_diario', texto: 'Variacao do faturamento dia a dia em maio de 2026?' },
  // crescimento_mensal
  { frag: 'crescimento_mensal', texto: 'Qual o crescimento mensal do faturamento em 2026?' },
  { frag: 'crescimento_mensal', texto: 'Faturamento por mes em 2026 demonstrando a evolucao mes a mes?' },
  // crescimento_anual
  { frag: 'crescimento_anual', texto: 'Qual o crescimento anual do faturamento entre os ultimos anos?' },
  { frag: 'crescimento_anual', texto: 'Evolucao do faturamento ano a ano?' },
  // comparativo_periodos
  { frag: 'comparativo_periodos', texto: 'Faturamento de junho de 2026 comparado com junho de 2025?' },
  { frag: 'comparativo_periodos', texto: 'Faturamento de 2024, 2025 e 2026 em relacao a cada ano?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO FASE 2 — 24 PERGUNTAS (FATURAMENTO)');
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
