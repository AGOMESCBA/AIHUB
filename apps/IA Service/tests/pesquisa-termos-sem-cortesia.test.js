'use strict';
// Termos da pesquisa externa vêm do problema, não de cortesia nem de mensagens
// padrão de atendimento (caso sintético baseado no padrão do #036566).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planejarPesquisa } = require('../backend/services/technical-research-service');
const { SYSTEM_PROMPT } = require('../backend/services/prompt-builder');

const titulo = 'Rotina manutenção de arquivos DIRF em branco';
const mensagens = [
  'Abertura do chamado por Fulana de Tal\n\nBoa tarde,\n\nPreciso de ajuda para que os colaboradores apareçam em tela em manutenção da DIRF',
  `${titulo}\n\nPrezado(a),\n\nGostaríamos de informar que seu chamado está sendo transferido para um analista especializado. Devido a essa mudança, o nível de atendimento foi atualizado para garantir um suporte mais adequado e eficiente.\n\nAgradecemos pela compreensão e estamos à disposição para qualquer dúvida.\n\nAtenciosamente,\n\nAtendente Exemplo`,
  `${titulo}\n\nBoa tarde.\n\nFoi realizado um chamado com o cliente.`,
  `${titulo}\n\nDevolvendo conforme alinhado`,
  `${titulo}\n\nTransferência.`,
].map(conteudo => ({ conteudo }));

test('consulta externa não usa cortesia, mensagem de transferência nem o objetivo interno', () => {
  const plano = planejarPesquisa({ chamado: { produto: 'Protheus', titulo }, mensagens, texto: 'Pesquise uma solucao para este chamado.' });
  assert.ok(plano.consultas.length > 0);
  for (const consulta of plano.consultas) {
    assert.match(consulta, /dirf/);
    for (const ruido of ['tarde', 'nivel', 'prezado', 'atenciosamente', 'agradecemos', 'transferencia', 'levantar', 'referencia']) {
      assert.ok(!new RegExp(`\\b${ruido}\\b`).test(consulta), `"${ruido}" em: ${consulta}`);
    }
  }
});

test('prompt principal trata print como tela, não como causa, e pede passos concretos', () => {
  assert.match(SYSTEM_PROMPT, /Um print mostra o que está na tela, não a causa/);
  assert.match(SYSTEM_PROMPT, /processo que gera esses dados não foi executado/);
  assert.match(SYSTEM_PROMPT, /Cada próximo passo deve apontar um objeto concreto/);
});

test('consulta não leva assinatura, nome de atendente nem verbos genéricos', () => {
  const plano = planejarPesquisa({ chamado: { produto: 'Protheus', titulo: 'Aprovação de contratos' }, mensagens: [
    { conteudo: 'Ao concluir o lançamento do contrato não gera link de aprovação e não libera medições.' },
    { conteudo: 'Favor fazer um entendimento antes, pode ser fonte ou pode ser alçada.\nAtt.:\nAtendente Exemplo' },
    { conteudo: 'Realizado a abertura de fabrica.\n\nAt,.\nOutro Atendente' },
  ], texto: '' });
  for (const consulta of plano.consultas) {
    for (const ruido of ['atendente', 'exemplo', 'outro', 'pode']) assert.ok(!new RegExp(`\\b${ruido}\\b`).test(consulta), `"${ruido}" em: ${consulta}`);
    assert.ok((consulta.match(/protheus/gi) || []).length <= 1, consulta);
  }
});

test('pesquisa não devolve links de busca não verificados', async () => {
  const { pesquisar } = require('../backend/services/technical-research-service');
  const r = await pesquisar({ chamado: { produto: 'Protheus', titulo }, mensagens, pesquisaExternaBloqueada: { responsavel: 'cliente' } });
  assert.deepEqual(r.links, []);
});

test('Objetiva sem Situação/Já feito e Técnica sem resumo do histórico', () => {
  const fonte = require('node:fs').readFileSync(require.resolve('../backend/services/resposta-humanizada-service'), 'utf8');
  assert.ok(!/Situação: uma ou duas frases|Já feito: itens curtos/.test(fonte));
  assert.match(fonte, /Não descreva o andamento do chamado/);
  assert.match(SYSTEM_PROMPT, /Não abra a resposta resumindo o histórico/);
});

test('prompt pede assertividade: causa mais provável, primeiro teste e no máximo 2 alternativas', () => {
  assert.match(SYSTEM_PROMPT, /Assertividade acima de quantidade/);
  assert.match(SYSTEM_PROMPT, /no maximo 2, em ordem de probabilidade/);
});
