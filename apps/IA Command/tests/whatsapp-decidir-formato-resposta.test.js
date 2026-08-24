'use strict';
// Teste isolado de WhatsAppService.prototype._decidirFormatoResposta, sem conectar ao
// WhatsApp real nem abrir o Chromium do whatsapp-web.js (service.js exporta a CLASSE,
// nao uma instancia — pegamos o metodo direto do prototype e chamamos com `this` fake).
//
// Regra de negocio central (revisada): o texto NUNCA e resumido/cortado. So muda se o
// sistema oferece (ou anexa automaticamente) PDF/Excel ao final. Um cabecalho tipo card
// (pergunta + resumo, igual ao chat HTML) e adicionado no fluxo interativo (nao em
// agendamento, que dispara varias perguntas em sequencia).

const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const WhatsAppServiceModule = require(path.join(ROOT, 'modules/whatsapp/service'));
const whatsappResponseConfig = require(path.join(ROOT, 'modules/whatsapp/whatsapp-response-config'));
const responseFormatter = require(path.join(ROOT, 'modules/erp/core/response-formatter'));

const EMPRESA_TESTE = -9993;
const SENDER_TESTE = '5599888888888@c.us_teste_decidir';

function limpar() {
  getDB().prepare('DELETE FROM whatsapp_query_cache WHERE empresa_id = ?').run(EMPRESA_TESTE);
  getDB().prepare('DELETE FROM whatsapp_response_config WHERE empresa_id = ?').run(EMPRESA_TESTE);
  whatsappResponseConfig.invalidarCache(EMPRESA_TESTE);
}
limpar();

assert.strictEqual(typeof WhatsAppServiceModule, 'function', 'service.js deve exportar a classe IACWhatsAppService');
const ServiceProto = WhatsAppServiceModule.prototype;
assert(typeof ServiceProto._decidirFormatoResposta === 'function', 'metodo _decidirFormatoResposta deve existir no prototype');
assert(typeof ServiceProto._montarCabecalhoPergunta === 'function', 'metodo _montarCabecalhoPergunta deve existir no prototype');

// `this` fake: reaproveita os metodos reais da classe (_decidirFormatoResposta chama
// this._montarCabecalhoPergunta internamente) + so precisa de log() e _setSenderContext().
const fakeSelf = {
  log: () => {},
  _montarCabecalhoPergunta: ServiceProto._montarCabecalhoPergunta,
  _senderContextMap: new Map(),
  _setSenderContext(sender, patch) {
    this._senderContextMap.set(sender, { ...(this._senderContextMap.get(sender) || {}), ...patch });
  },
};

async function rodar() {
  // 1. Resposta pequena — nao deve persistir nem oferecer anexo
  {
    const rows = [{ cliente: 'A', faturamento: 100 }];
    const resultado = { rows };
    const texto = 'Resposta curta de teste';
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, {}, texto, { empresaId: EMPRESA_TESTE, sender: SENDER_TESTE });
    assert(decisao.texto.includes(texto), 'texto original deve estar presente na resposta');
    assert.strictEqual(decisao.anexoBuffer, null);
    assert(!fakeSelf._senderContextMap.get(SENDER_TESTE)?._aguardandoRespostaAnexo, 'nao deve marcar oferta pendente para resposta pequena');
  }

  // 2. Resposta media (abaixo do limite de oferta) — sem oferta, texto completo
  {
    const rows = [{ cliente: 'A', faturamento: 100 }];
    const resultado = { rows };
    const texto = 'X'.repeat(5000); // < 8000 (default limite_pergunta_anexo_caracteres)
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, {}, texto, { empresaId: EMPRESA_TESTE, sender: SENDER_TESTE });
    assert(decisao.texto.includes(texto), 'deve manter o texto original completo');
    assert.strictEqual(decisao.anexoBuffer, null);
    assert(!fakeSelf._senderContextMap.get(SENDER_TESTE)?._aguardandoRespostaAnexo, 'nao deve oferecer anexo em resposta media');
  }

  // 3. Resposta grande (> limite_pergunta_anexo_caracteres) — oferece anexo, mantem TEXTO
  // COMPLETO (regra central: nunca resume/corta, mesmo com muitas linhas)
  {
    const rows = Array.from({ length: 300 }, (_, i) => ({ cliente: `Cliente ${i}`, faturamento: 100 * i }));
    const resultado = { rows };
    const texto = 'Y'.repeat(30000); // bem acima de 8000 e de qualquer limiar antigo — deve permanecer intacto
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, {}, texto, { empresaId: EMPRESA_TESTE, sender: SENDER_TESTE });
    assert(decisao.texto.includes('1 - PDF'), 'resposta grande deve incluir a oferta de anexo');
    assert(decisao.texto.includes(texto), 'resposta grande NUNCA deve cortar o texto — o texto original completo deve estar presente inteiro');
    assert.strictEqual(decisao.anexoBuffer, null, 'sem config de anexo automatico, nao deve gerar buffer');
    const ctx = fakeSelf._senderContextMap.get(SENDER_TESTE);
    assert.strictEqual(ctx._aguardandoRespostaAnexo, true, 'deve marcar oferta pendente');
    assert(ctx._anexoQueryCacheId, 'deve guardar o id do cache');

    const cached = getDB().prepare('SELECT rows_count FROM whatsapp_query_cache WHERE id = ?').get(ctx._anexoQueryCacheId);
    assert.strictEqual(cached.rows_count, 300, 'deve ter persistido as 300 rows completas no cache');
  }

  // 4. Cabecalho (pergunta + resumo) so aparece quando resultado.tipo='sucesso_ai_sql'
  // (unico tipo suportado por montarApresentacaoResposta) e ha intent._mensagemOriginal
  {
    const rows = [{ cliente: 'A', faturamento: 1000 }, { cliente: 'B', faturamento: 2000 }];
    const resultado = { tipo: 'sucesso_ai_sql', rows, resposta_direta: 'Fake resposta da IA' };
    const intent = { _mensagemOriginal: 'faturamento por cliente hoje' };
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, intent, 'Fake resposta da IA', { empresaId: EMPRESA_TESTE, sender: SENDER_TESTE + '_cab' });
    assert(decisao.texto.includes('❓ *Pergunta:*'), 'deve incluir o cabecalho de pergunta quando tipo=sucesso_ai_sql');
    assert(decisao.texto.includes('faturamento por cliente hoje'), 'cabecalho deve conter a pergunta original');
    assert(decisao.texto.includes('Leitura rapida'), 'cabecalho deve incluir o resumo/leitura rapida');
  }

  // 4b. ANTI-DUPLICACAO: quando o texto de entrada ja vem passado por
  // humanizarResposta/textoApresentacao (fluxo real via _formatarRespostaResultado), o
  // resumo/leitura-rapida ja esta embutido no FINAL desse texto — o cabecalho novo nao pode
  // duplicar essa mesma linha (uma vez no topo, outra vez no fim).
  {
    const rows = [
      { cliente: 'Cliente A', faturamento_total: 1000 },
      { cliente: 'Cliente B', faturamento_total: 2000 },
    ];
    const resultado = { tipo: 'sucesso_ai_sql', rows, resposta_direta: 'Lista de clientes:\n1. Cliente A\n2. Cliente B' };
    const intent = { _mensagemOriginal: 'faturamento por cliente' };
    // Simula o texto real como _formatarRespostaResultado produz (via humanizarResposta,
    // internamente montarApresentacaoResposta + textoApresentacao) — introducao + detalhe +
    // resumo concatenados numa string so, resumo por ultimo.
    const apresentacaoSimulada = responseFormatter.montarApresentacaoResposta(
      resultado.resposta_direta, resultado, intent, { sugerirComparacao: false }
    );
    const textoComResumoEmbutido = responseFormatter.textoApresentacao(apresentacaoSimulada, resultado.resposta_direta);
    assert(textoComResumoEmbutido.includes('Leitura rapida'), 'pre-condicao do teste: o texto simulado precisa conter o resumo embutido, como no fluxo real');

    const decisaoDup = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, intent, textoComResumoEmbutido, { empresaId: EMPRESA_TESTE, sender: SENDER_TESTE + '_dedup' });
    const ocorrencias = decisaoDup.texto.split('Leitura rapida').length - 1;
    assert.strictEqual(ocorrencias, 1, `resumo "Leitura rapida" deve aparecer exatamente 1 vez, apareceu ${ocorrencias}`);
    assert(decisaoDup.texto.startsWith('❓ *Pergunta:*'), 'cabecalho deve vir no topo');
  }

  // 5. Sem tipo='sucesso_ai_sql' (ex: tipo='sucesso', agrupamento deterministico) — mostra
  // a PERGUNTA (sempre que ha rows), mas NAO o resumo/leitura-rapida (so o motor de IA sabe
  // montar isso hoje via montarApresentacaoResposta) — evita duplicar o resumo que o
  // formatador deterministico ja embute no proprio texto.
  {
    const rows = [{ cliente: 'A', faturamento: 1000 }];
    const resultado = { tipo: 'sucesso', rows };
    const intent = { _mensagemOriginal: 'faturamento por cliente hoje' };
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, intent, 'Texto ja formatado deterministicamente', { empresaId: EMPRESA_TESTE, sender: SENDER_TESTE + '_semcab' });
    assert(decisao.texto.includes('❓ *Pergunta:*'), 'pergunta deve aparecer mesmo no formatador deterministico, sempre que ha rows');
    assert(!decisao.texto.includes('Leitura rapida'), 'nao deve duplicar o resumo/leitura-rapida quando o formatador deterministico ja monta seu proprio resumo');
  }

  // 6. Config de anexo automatico — nao deve oferecer, deve gerar buffer direto
  {
    const agora = new Date().toISOString();
    getDB().prepare(`
      INSERT INTO whatsapp_response_config (empresa_id, anexar_excel_automatico_acima_de, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?)
    `).run(EMPRESA_TESTE, 3, agora, agora);
    whatsappResponseConfig.invalidarCache(EMPRESA_TESTE);

    const rows = Array.from({ length: 5 }, (_, i) => ({ cliente: `Cliente ${i}`, faturamento: 100 * i }));
    const resultado = { rows };
    const texto = 'V'.repeat(9000);
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, {}, texto, { empresaId: EMPRESA_TESTE, sender: SENDER_TESTE + '_auto' });
    assert(decisao.anexoBuffer, 'com anexar_excel_automatico_acima_de=3 e 5 rows, deve gerar buffer automaticamente');
    assert.strictEqual(decisao.anexoFormato, 'excel');
    assert(!decisao.texto.includes('1 - PDF'), 'com anexo automatico, NAO deve incluir a oferta interativa');
    assert(!fakeSelf._senderContextMap.get(SENDER_TESTE + '_auto')?._aguardandoRespostaAnexo, 'nao deve marcar oferta pendente quando o anexo ja foi automatico');
  }

  // 7. Agendamento (origem='agendamento') SEM config de anexo automatico — preserva o
  // comportamento de sempre: texto completo, SEM cabecalho, sem resumo, sem oferta.
  {
    limpar();
    const senderAgendamento = SENDER_TESTE + '_agendamento_sem_config';
    const rows = Array.from({ length: 250 }, (_, i) => ({ cliente: `Cliente ${i}`, faturamento: i }));
    const resultado = { tipo: 'sucesso_ai_sql', rows, resposta_direta: 'texto' };
    const intent = { _mensagemOriginal: 'faturamento por cliente' };
    const texto = 'A'.repeat(21000);
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, intent, texto, { empresaId: EMPRESA_TESTE, sender: senderAgendamento, origem: 'agendamento' });
    assert.strictEqual(decisao.texto, texto, 'agendamento sem anexo automatico deve manter o texto EXATAMENTE identico (sem cabecalho, sem oferta)');
    assert(!decisao.texto.includes('❓ *Pergunta:*'), 'agendamento NUNCA deve ganhar o cabecalho de pergunta/resumo (varias perguntas em sequencia ficariam pesadas de ler)');
    assert.strictEqual(decisao.anexoBuffer, null);
    assert(!fakeSelf._senderContextMap.get(senderAgendamento)?._aguardandoRespostaAnexo, 'agendamento nunca deve marcar oferta interativa pendente');
  }

  // 8. Agendamento COM config de anexo automatico — gera anexo, sem cabecalho, sem oferta
  {
    const agora = new Date().toISOString();
    getDB().prepare(`
      INSERT INTO whatsapp_response_config (empresa_id, anexar_pdf_automatico_acima_de, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?)
    `).run(EMPRESA_TESTE, 100, agora, agora);
    whatsappResponseConfig.invalidarCache(EMPRESA_TESTE);

    const senderAgendamentoAuto = SENDER_TESTE + '_agendamento_auto';
    const rows = Array.from({ length: 150 }, (_, i) => ({ cliente: `Cliente ${i}`, faturamento: i }));
    const resultado = { tipo: 'sucesso_ai_sql', rows, resposta_direta: 'texto' };
    const intent = { _mensagemOriginal: 'faturamento por cliente' };
    const texto = 'B'.repeat(9000);
    const decisao = await ServiceProto._decidirFormatoResposta.call(fakeSelf, resultado, intent, texto, { empresaId: EMPRESA_TESTE, sender: senderAgendamentoAuto, origem: 'agendamento' });
    assert(decisao.anexoBuffer, 'agendamento com anexar_pdf_automatico_acima_de=100 e 150 rows deve gerar PDF automaticamente');
    assert.strictEqual(decisao.anexoFormato, 'pdf');
    assert.strictEqual(decisao.texto, texto, 'texto de agendamento deve permanecer identico, mesmo com anexo automatico');
    assert(!decisao.texto.includes('❓ *Pergunta:*'), 'agendamento nunca deve incluir o cabecalho, mesmo com anexo automatico');
    assert(!fakeSelf._senderContextMap.get(senderAgendamentoAuto)?._aguardandoRespostaAnexo, 'agendamento nunca deve marcar oferta pendente');
  }

  limpar();
  console.log('whatsapp-decidir-formato-resposta.test.js: ok');
}

rodar().catch(err => {
  console.error('FALHOU:', err);
  process.exit(1);
});
