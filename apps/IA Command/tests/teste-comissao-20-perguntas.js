'use strict';
/**
 * Validacao da fragmentacao de comissao — 2 perguntas reais por fragmento
 * (exceto identidade_vendedor, ja validado em teste-comissao-seguranca-real.js).
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
  { frag: 'carteira_status', texto: 'Quais comissoes estao em aberto este mes?' },
  { frag: 'carteira_status', texto: 'Comissoes pagas em junho de 2026?' },
  { frag: 'pagamento_real', texto: 'Qual a data de pagamento da comissao deste mes?' },
  { frag: 'pagamento_real', texto: 'Comissao paga por data de baixa em maio de 2026?' },
  { frag: 'media_diaria', texto: 'Qual a media diaria de comissao em junho de 2026?' },
  { frag: 'media_diaria', texto: 'Comissao media por dia no mes de maio de 2026?' },
  { frag: 'media_mensal', texto: 'Qual a media mensal de comissao de 2026?' },
  { frag: 'media_mensal', texto: 'Media mensal de comissao por vendedor em 2026?' },
  { frag: 'media_anual', texto: 'Qual a media anual de comissao dos ultimos 2 anos?' },
  { frag: 'media_anual', texto: 'Comissao media anual considerando 2025 e 2026?' },
  { frag: 'crescimento_diario', texto: 'Qual o crescimento diario da comissao em junho de 2026?' },
  { frag: 'crescimento_diario', texto: 'Variacao da comissao dia a dia em maio de 2026?' },
  { frag: 'crescimento_mensal', texto: 'Qual o crescimento mensal da comissao em 2026?' },
  { frag: 'crescimento_mensal', texto: 'Comissao por mes em 2026 demonstrando evolucao mes a mes?' },
  { frag: 'crescimento_anual', texto: 'Qual o crescimento anual da comissao entre os ultimos anos?' },
  { frag: 'crescimento_anual', texto: 'Evolucao da comissao ano a ano?' },
  { frag: 'comparativo_periodos', texto: 'Comissao de junho de 2026 comparado com junho de 2025?' },
  { frag: 'comparativo_periodos', texto: 'Comissao de 2024, 2025 e 2026 em relacao a cada ano?' },
];

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VALIDACAO FRAGMENTACAO — COMISSAO (18 PERGUNTAS)');
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
