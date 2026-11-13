'use strict';
// Coerência entre a decisão de pesquisa executada e o motivo auditado.
// Regressão do replay de 2026-11-12: com a mensagem sem sinal que as regras
// reconheçam (zona sem_evidencia_clara), o atalho de zona negava a pesquisa
// que o plano tinha decidido e gravava o motivo do plano ("ha evidencia/lacuna
// tecnica util para pesquisa externa"), sem consultar a interpretação
// semântica (d11 T2 e v05).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const MOTIVO_PLANO = 'ha evidencia/lacuna tecnica util para pesquisa externa';

function semantica(resultado) {
  const chamadas = [];
  return {
    chamadas,
    interpretarSemantico: async (args) => { chamadas.push(args.pre.zona); return { resultado }; },
  };
}
const RELEVANTE = { haMudancaInvestigativa: true, tipoMudanca: 'evidencia_nova', haEvidenciaNova: true, relevanciaParaPesquisa: 'alta', justificativa: 'erro novo', confiancaQualitativa: 'alta', pedidoInvestigacaoAnalista: 'nao' };
const SEM_NOVIDADE = { haMudancaInvestigativa: false, tipoMudanca: 'nenhuma_mudanca', haEvidenciaNova: false, relevanciaParaPesquisa: 'nenhuma', justificativa: 'nada novo', confiancaQualitativa: 'alta', pedidoInvestigacaoAnalista: 'nao' };
const PEDIDO = { ...SEM_NOVIDADE, pedidoInvestigacaoAnalista: 'sim' };

// d11 T2: o TSS foi reiniciado e o erro mudou.
const ctxD11 = () => ({
  chamado: { produto: 'Protheus', titulo: 'NF-e não transmite', descricao: 'Ao transmitir a NF-e o monitor retorna Connection refused ao acessar o TSS.' },
  mensagens: [
    { papel: 'customer', conteudo: 'Ao transmitir a NF-e o monitor retorna Connection refused ao acessar o TSS.' },
    { papel: 'consultor', conteudo: 'O que verifico primeiro?' },
    { papel: 'assistant', conteudo: 'Verifique se o serviço do TSS está ativo e o endereço configurado.' },
  ],
  texto: "O TSS estava parado. Reiniciamos e agora o erro mudou para 'Certificado digital vencido'.",
  turnoHumano: true,
  disciplina4B: true,
});

// v05: pedido do analista sem sinal técnico.
const ctxV05 = () => ({
  chamado: { produto: 'Protheus', titulo: 'Rotina de faturamento lenta', descricao: 'A geração de notas está lenta desde a atualização.' },
  mensagens: [{ papel: 'customer', conteudo: 'A geração de notas está lenta desde a atualização.' }],
  texto: 'Procure em todos os clientes chamados parecidos com esse e me diga o que fizeram.',
  turnoHumano: true,
  disciplina4B: false,
});

test('d11 T2: o plano que decide pesquisar não é negado em silêncio pelo atalho de zona', async () => {
  const s = semantica(RELEVANTE);
  const plano = await svc.planejarPesquisaComSemantica(ctxD11(), s);
  assert.deepEqual(s.chamadas, ['plano_pesquisaria_sem_evidencia_clara'], 'a interpretação semântica decide');
  assert.equal(plano.devePesquisar, true, plano.motivo);
  assert.match(plano.motivo, /reconhecida semanticamente: evidencia_nova/);
  assert.equal(plano.decisaoPlanejada, undefined, 'executada = planejada');
});

test('d11 T2: se a semântica não vê novidade, não pesquisa e o motivo diz isso', async () => {
  const plano = await svc.planejarPesquisaComSemantica(ctxD11(), semantica(SEM_NOVIDADE));
  assert.equal(plano.devePesquisar, false);
  assert.match(plano.motivo, /semantica nao justificou pesquisa externa: nenhuma_mudanca/);
  assert.notEqual(plano.motivo, MOTIVO_PLANO);
  assert.deepEqual(plano.decisaoPlanejada, { devePesquisar: true, motivo: MOTIVO_PLANO });
});

test('d11 T2: semântica indisponível mantém a decisão planejada, sem contradição', async () => {
  const plano = await svc.planejarPesquisaComSemantica(ctxD11(), { interpretarSemantico: async () => { throw new Error('timeout'); } });
  assert.equal(plano.interpretacaoSemantica.fallback, true);
  assert.equal(plano.devePesquisar, true, plano.motivo);
  assert.equal(plano.motivo, MOTIVO_PLANO);
});

test('v05: pedido do analista é reconhecido pela semântica mesmo com o plano decidindo pesquisar', async () => {
  const s = semantica(PEDIDO);
  const plano = await svc.planejarPesquisaComSemantica(ctxV05(), s);
  assert.equal(s.chamadas.length, 1);
  assert.equal(plano.devePesquisar, true, plano.motivo);
  assert.equal(plano.pedidoInvestigacaoAnalista, true);
});

test('cortesia: comportamento anterior preservado (zona administrativa, sem pesquisa)', async () => {
  // Em turno do analista a cortesia já passava pela semântica (resgate de
  // turno humano, decisão do usuário 2026-10); fora dele, fica no atalho.
  const humano = semantica(SEM_NOVIDADE);
  const p1 = await svc.planejarPesquisaComSemantica({ ...ctxD11(), texto: 'Ok, obrigado' }, humano);
  assert.deepEqual(humano.chamadas, ['turno_humano_administrativa']);
  assert.equal(p1.devePesquisar, false);
  const automatico = semantica(RELEVANTE);
  const p2 = await svc.planejarPesquisaComSemantica({ ...ctxD11(), turnoHumano: false, texto: 'Ok, obrigado' }, automatico);
  assert.equal(automatico.chamadas.length, 0);
  assert.equal(p2.devePesquisar, false);
  assert.match(p2.motivo, /administrativo/);
});

test('a correção só age quando o plano decidiu pesquisar', async () => {
  const s = semantica(RELEVANTE);
  const ctx = { ...ctxD11(), turnoHumano: false, texto: 'Seguimos acompanhando o caso.', disciplina4B: false,
    dossieOperacional: { texto: '', manifesto: { regressaoGuard: { testesExecutados: ['serviço reiniciado'] } } } };
  assert.equal(svc.planejarPesquisa(ctx).devePesquisar, false);
  await svc.planejarPesquisaComSemantica(ctx, s);
  assert.ok(!s.chamadas.includes('plano_pesquisaria_sem_evidencia_clara'));
});

test('nenhuma decisão executada de não pesquisar carrega o motivo de pesquisar', async () => {
  const cenarios = [
    [ctxD11(), SEM_NOVIDADE], [ctxV05(), SEM_NOVIDADE],
    [{ ...ctxD11(), texto: 'Certo, vou verificar' }, SEM_NOVIDADE],
    [{ ...ctxV05(), turnoHumano: false }, SEM_NOVIDADE],
  ];
  for (const [ctx, res] of cenarios) {
    const plano = await svc.planejarPesquisaComSemantica(ctx, semantica(res));
    if (!plano.devePesquisar) assert.notEqual(plano.motivo, MOTIVO_PLANO, `${ctx.texto}`);
  }
});
