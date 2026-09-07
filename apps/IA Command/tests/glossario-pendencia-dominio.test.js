'use strict';

// Item 6 do glossario analitico: quando o sistema pergunta "sobre qual dado — Faturamento,
// Compras, ..." (glossario nao sabe o dominio de um termo tecnico como "markup"), a resposta
// curta do usuario ("Vendas") precisa ser entendida como resposta aquela pergunta, nao como
// consulta nova. Estes testes cobrem a parte deterministica/testavel sem depender de
// whatsapp/service.js (que nao carrega neste ambiente por falta da dependencia puppeteer,
// limitacao pre-existente e documentada — ver outros 13 arquivos *.test.js que dependem dele).
//
// Cobertura:
// - Ponto de origem 1 (intent-router.js): pergunta classificada como "desconhecido", glossario
//   reconhece o termo mas nao ha dominio explicito na pergunta -> retorna _glossarioDominioPendente.
// - extrairDominioExplicito (reaproveitado pelo handler de service.js para interpretar a
//   resposta curta do usuario): "Vendas" mapeia para o dominio "faturamento".
// - resolverConceitoPorFalhaSql: preserva termo + definicao pre-extraida no retorno de
//   precisaConfirmacao (testado tambem em analytic-glossary.test.js; aqui confirma o contrato
//   exato que os dois pontos de origem repassam para service.js).

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const intentRouter = require(path.join(ROOT, 'modules/erp/core/intent-router'));
const resolver = require(path.join(ROOT, 'modules/ai/analytic-glossary-resolver'));
const aiProviderClient = require(path.join(ROOT, 'modules/erp/core/ai-provider-client'));
const { getDB } = require(path.join(ROOT, 'modules/database'));

let passou = 0;
let falhou = 0;
function ok(desc, fn) {
  try {
    fn();
    console.log(`  ok - ${desc}`);
    passou++;
  } catch (e) {
    console.error(`  fail - ${desc}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}
async function okAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ok - ${desc}`);
    passou++;
  } catch (e) {
    console.error(`  fail - ${desc}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

(async () => {
  // ── Ponto de origem 1: intent-router.js (pergunta ja classificada "desconhecido") ─────────
  await okAsync('intent-router.js: pergunta desconhecida com termo de glossario sem dominio retorna _glossarioDominioPendente', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => JSON.stringify({
      termo_encontrado: 'markup',
      definicao_tecnica: 'Markup e o percentual aplicado sobre o custo do item para formar o preco de venda.',
    });
    try {
      const intent = { intencao: 'desconhecido', _mensagemOriginal: 'Qual o markup deste item?', _erro: 'nao entendi' };
      const resultado = await intentRouter.rotear(intent, -9992);

      assert.strictEqual(resultado.tipo, 'desconhecido');
      assert.ok(resultado._glossarioDominioPendente, 'resultado deve carregar _glossarioDominioPendente para service.js armar a pendencia');
      assert.strictEqual(resultado._glossarioDominioPendente.termo, 'markup');
      assert.strictEqual(resultado._glossarioDominioPendente.mensagemOriginal, 'Qual o markup deste item?');
      assert.strictEqual(
        resultado._glossarioDominioPendente.definicaoTecnicaPreExtraida,
        'Markup e o percentual aplicado sobre o custo do item para formar o preco de venda.',
        'a definicao ja extraida na mesma chamada de IA nao deveria ser descartada'
      );
      assert.ok(resultado.mensagem.includes('markup'), 'a pergunta de esclarecimento devolvida ao usuario deve citar o termo');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    }
  });

  await okAsync('intent-router.js: NAO seta _glossarioDominioPendente quando a pergunta ja e reconhecida como ERP comum (regressao)', async () => {
    const intent = { intencao: 'desconhecido', _mensagemOriginal: 'faturamento de hoje', _erro: 'nao entendi' };
    const resultado = await intentRouter.rotear(intent, -9992);
    assert.ok(!resultado._glossarioDominioPendente, '"faturamento de hoje" tem sinal de ERP (_parecePerguntaErp) — nao deveria passar pelo caminho de glossario');
  });

  // ── extrairDominioExplicito: mecanismo reaproveitado por service.js para interpretar a ──
  // ── resposta curta do usuario a pendencia ("Vendas" -> dominio "faturamento") ────────────
  ok('extrairDominioExplicito: "Vendas" mapeia para o dominio faturamento (resposta esperada a pendencia)', () => {
    const dominio = resolver.extrairDominioExplicito('Vendas');
    assert.ok(dominio);
    assert.strictEqual(dominio.chave, 'faturamento');
    assert.deepStrictEqual(dominio.labels, ['Faturamento/Vendas']);
  });

  ok('extrairDominioExplicito: "Compras" mapeia para o dominio compras', () => {
    const dominio = resolver.extrairDominioExplicito('Compras');
    assert.ok(dominio);
    assert.strictEqual(dominio.chave, 'compras');
  });

  ok('extrairDominioExplicito: "Financeiro" mapeia para o dominio financeiro', () => {
    const dominio = resolver.extrairDominioExplicito('Financeiro');
    assert.ok(dominio);
    assert.strictEqual(dominio.chave, 'financeiro');
  });

  ok('extrairDominioExplicito: resposta invalida ("banana") retorna null — handler deve pedir opcao valida sem chamar IA', () => {
    const dominio = resolver.extrairDominioExplicito('banana');
    assert.strictEqual(dominio, null);
  });

  ok('extrairDominioExplicito: pergunta original remontada com o dominio confirmado e reconhecida (contrato do handler de retomada)', () => {
    // O handler em service.js remonta a pergunta como
    // `${mensagemOriginal} (${dominio.labels.join(' e ')})` antes de reprocessar — confirma que
    // esse texto reconstruido ainda e reconhecido normalmente por extrairDominioExplicito.
    const dominio = resolver.extrairDominioExplicito('Qual o markup deste item? (Faturamento/Vendas)');
    assert.ok(dominio);
    assert.strictEqual(dominio.chave, 'faturamento');
  });

  // ── Ordem de checagem no handler (_responderGlossarioDominioPendente em service.js) ───────
  // Confirma, sobre as MESMAS funcoes puras usadas la (_textoCancelaPendente/
  // _textoPareceNovaConsulta, copiadas aqui porque service.js nao carrega neste ambiente —
  // ver nota no topo do arquivo), o motivo exato pelo qual a ordem de checagem tem que ser
  // diferente da usada em _responderFilialPendente/_responderEntidadePendente: la, "nova
  // consulta" e checado ANTES de interpretar a resposta; aqui isso quebraria o caso comum,
  // porque a resposta esperada ("Vendas"/"Compras"/"Financeiro") e capturada por
  // _textoPareceNovaConsulta. Por isso o handler tenta extrairDominioExplicito() PRIMEIRO.
  function _textoCancelaPendente(texto) {
    const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return /^(0|cancelar|cancela|nenhuma|nenhum|nova pergunta|nova consulta|novo tema|outro assunto|recomecar|resetar|reset|limpar contexto)$/.test(t);
  }
  function _textoPareceNovaConsulta(texto) {
    const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (!t || /^\d+$/.test(t)) return false;
    return /\b(faturamento|vendas?|compras?|financeiro|comissao|saldo bancario|fluxo de caixa|contas? a pagar|contas? a receber|pedido|fornecedor|cliente|produto|banco|mes|ano)\b/.test(t);
  }

  ok('regressao de design: "Vendas"/"Compras"/"Financeiro" NAO sao reconhecidos como cancelamento (seguro checar cancelamento primeiro)', () => {
    assert.strictEqual(_textoCancelaPendente('Vendas'), false);
    assert.strictEqual(_textoCancelaPendente('Compras'), false);
    assert.strictEqual(_textoCancelaPendente('Financeiro'), false);
  });

  ok('regressao de design: "Vendas"/"Compras"/"Financeiro" SAO reconhecidos como "nova consulta" pelo detector generico — por isso o handler NAO pode checar isso antes de tentar extrairDominioExplicito', () => {
    // Esta e a armadilha central do item 6: se o handler seguisse a MESMA ordem de
    // _responderFilialPendente/_responderEntidadePendente (checar nova-consulta antes de
    // interpretar a resposta), a resposta esperada do usuario seria descartada por engano.
    assert.strictEqual(_textoPareceNovaConsulta('Vendas'), true);
    assert.strictEqual(_textoPareceNovaConsulta('Compras'), true);
    assert.strictEqual(_textoPareceNovaConsulta('Financeiro'), true);
  });

  // ── Bug real encontrado em teste de producao (07/09/2026, empresa CAIEIRA) ────────────────
  // "Me envie a analise horizontal desse mes" (termo reconhecido pelo glossario, mas SEM
  // dominio explicito na frase) retornava, no WhatsApp, a mensagem generica de "sem chave de
  // IA configurada" em vez da pergunta real de esclarecimento de dominio. Causa raiz: quando
  // o glossario pede esclarecimento, intent-service.js retorna _provedor='nenhum' (nao chamou
  // IA principal porque o glossario resolveu antes) — mas service.js tratava QUALQUER
  // _provedor='nenhum' como "IA falhou/sem chave", silenciando a pergunta real. Corrigido
  // checando intent._erroTipo === 'conceito_analitico_ambiguo' ANTES desse bloco generico.
  // Este teste confirma o contrato exato que intent-service.js produz e que service.js passou
  // a verificar — trava contra reintroducao do bug.
  const intentService = require(path.join(ROOT, 'modules/ai/intent-service'));
  await okAsync('intent-service.js: "analise horizontal" sem dominio produz o contrato exato que service.js precisa distinguir de "sem chave de IA"', async () => {
    const intent = await intentService.classificar('Me envie a analise horizontal desse mes', -9992);
    assert.strictEqual(intent.precisa_confirmacao, true);
    assert.strictEqual(intent._provedor, 'nenhum', 'mesmo valor usado para "sem chave de IA" — por isso a checagem de _erroTipo e obrigatoria antes');
    assert.strictEqual(intent._erroTipo, 'conceito_analitico_ambiguo', 'campo que service.js usa para diferenciar este caso do bloco generico de falha de IA');
    assert.ok(typeof intent._erro === 'string' && intent._erro.includes('analise horizontal'), 'a pergunta de esclarecimento real deve estar em _erro, pronta para ser devolvida ao usuario');
  });

  console.log(`\nglossario-pendencia-dominio.test.js: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
