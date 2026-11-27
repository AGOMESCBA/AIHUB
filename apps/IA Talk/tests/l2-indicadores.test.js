'use strict';

// L2 — testes unitários da biblioteca pura backend/lib/indicadores-atendimento/index.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ESTADOS_RESPOSTA_COMPROVADA,
  tempoPrimeiraResposta,
  tempoEsperaAtual,
  duracaoAtendimento,
  resumir,
} = require('../backend/lib/indicadores-atendimento');

const MIN = 60 * 1000;
const BASE = Date.parse('2026-11-27T12:00:00.000Z');
const iso = (offsetMs) => new Date(BASE + offsetMs).toISOString();

function montarConversa(parcial = {}) {
  return {
    id: 'cv_1',
    setor: { id: 'set_suporte', nome: 'Suporte' },
    responsavel: { id: 'usr_carla', nome: 'Carla Souza' },
    situacao: 'aberta',
    aberta_em: iso(0),
    encerrada_em: null,
    aguardando_desde: null,
    itens: [],
    ...parcial,
  };
}

test('tempoPrimeiraResposta: sem resposta, resposta só do sistema (ignorada) e primeira resposta de atendente', () => {
  // Sem resposta
  const semResp = montarConversa({
    itens: [
      { categoria: 'evento', direcao: null, autor: { tipo: 'sistema' }, em: iso(0) },
      { categoria: 'mensagem', direcao: 'entrada', autor: { tipo: 'contato' }, em: iso(1 * MIN) },
      { categoria: 'nota', direcao: null, autor: { tipo: 'atendente' }, em: iso(2 * MIN) },
    ],
  });
  assert.equal(tempoPrimeiraResposta(semResp), null);

  // Resposta só do sistema (ex.: mensagem de fora do horário) não conta
  const soSistema = montarConversa({
    itens: [
      { categoria: 'mensagem', direcao: 'entrada', autor: { tipo: 'contato' }, em: iso(0) },
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'sistema' }, em: iso(1 * MIN) },
    ],
  });
  assert.equal(tempoPrimeiraResposta(soSistema), null);

  // Resposta do sistema aos 1 min + resposta do atendente aos 5 min (fora de ordem no array) -> 5 min
  const comAtendente = montarConversa({
    itens: [
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'sistema' }, estado: 'entregue', em: iso(1 * MIN) },
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, estado: 'lida', em: iso(9 * MIN) },
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, estado: 'enviada', em: iso(5 * MIN) },
    ],
  });
  assert.equal(tempoPrimeiraResposta(comAtendente), 5 * MIN);
});

test('tempoPrimeiraResposta: ignora falhou, desconhecida e mensagens ainda na fila; aceita só envio comprovado', () => {
  assert.deepEqual(ESTADOS_RESPOSTA_COMPROVADA, ['enviada', 'entregue', 'lida']);

  // Mensagens falhas, desconhecidas ou ainda não comprovadas na fila não contam como resposta
  for (const estadoNaoComprovado of ['falhou', 'desconhecida', 'aceita', 'aguardando', 'encaminhada', null]) {
    const cv = montarConversa({
      itens: [
        { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, estado: estadoNaoComprovado, em: iso(5 * MIN) },
      ],
    });
    assert.equal(tempoPrimeiraResposta(cv), null, `estado ${estadoNaoComprovado} não deve contar`);
  }

  // Estados de envio comprovado contam
  for (const estadoComprovado of ['enviada', 'entregue', 'lida']) {
    const cv = montarConversa({
      itens: [
        { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, estado: estadoComprovado, em: iso(4 * MIN) },
      ],
    });
    assert.equal(tempoPrimeiraResposta(cv), 4 * MIN, `estado ${estadoComprovado} deve contar`);
  }

  // Mensagem falha aos 5 min + mensagem na fila aos 6 min + mensagem comprovada aos 8 min -> 8 min
  const falhaDepoisSucesso = montarConversa({
    itens: [
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, estado: 'falhou', em: iso(5 * MIN) },
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, estado: 'aguardando', em: iso(6 * MIN) },
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, estado: 'entregue', em: iso(8 * MIN) },
    ],
  });
  assert.equal(tempoPrimeiraResposta(falhaDepoisSucesso), 8 * MIN);

  // Compatibilidade: quando o campo `estado` é omitido (undefined), continua contando
  const semEstado = montarConversa({
    itens: [
      { categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, em: iso(3 * MIN) },
    ],
  });
  assert.equal(tempoPrimeiraResposta(semEstado), 3 * MIN);
});

test('tempoEsperaAtual e duracaoAtendimento: aberta na espera, sem espera e encerrada', () => {
  const agora = iso(30 * MIN);

  const esperando = montarConversa({ situacao: 'aberta', aguardando_desde: iso(20 * MIN) });
  assert.equal(tempoEsperaAtual(esperando, agora), 10 * MIN);
  assert.equal(duracaoAtendimento(esperando), null);

  const semEspera = montarConversa({ situacao: 'aberta', aguardando_desde: null });
  assert.equal(tempoEsperaAtual(semEspera, agora), null);

  const encerrada = montarConversa({
    situacao: 'encerrada',
    aberta_em: iso(0),
    encerrada_em: iso(25 * MIN),
    aguardando_desde: iso(10 * MIN), // mesmo se preenchido, encerrada retorna null
  });
  assert.equal(tempoEsperaAtual(encerrada, agora), null);
  assert.equal(duracaoAtendimento(encerrada), 25 * MIN);
});

test('resumir: lista vazia retorna zeros e null nas estatísticas', () => {
  const r = resumir([], iso(10 * MIN));
  assert.deepEqual(r, {
    total: 0,
    abertas: 0,
    na_fila: 0,
    encerradas: 0,
    primeira_resposta: { mediana_ms: null, p90_ms: null, amostras: 0 },
    espera_atual: { maior_ms: null, mediana_ms: null },
    duracao: { mediana_ms: null, amostras: 0 },
  });

  const rAgrupado = resumir([], iso(10 * MIN), { agruparPor: 'responsavel' });
  assert.deepEqual(rAgrupado.grupos, []);
});

test('resumir: percentil p90 (nearest-rank) e mediana com 1, 2 e 10 amostras', () => {
  const fazerComResposta = (idx, respostaMin) => montarConversa({
    id: `cv_${idx}`,
    aberta_em: iso(0),
    itens: [{ categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, em: iso(respostaMin * MIN) }],
  });

  // 1 amostra: [4 min] -> mediana 4, p90 4
  const r1 = resumir([fazerComResposta(1, 4)], iso(60 * MIN));
  assert.equal(r1.primeira_resposta.amostras, 1);
  assert.equal(r1.primeira_resposta.mediana_ms, 4 * MIN);
  assert.equal(r1.primeira_resposta.p90_ms, 4 * MIN);

  // 2 amostras: [2 min, 8 min] -> mediana 5, p90 nearest-rank (ceil(1.8)=2º) = 8
  const r2 = resumir([fazerComResposta(1, 8), fazerComResposta(2, 2)], iso(60 * MIN));
  assert.equal(r2.primeira_resposta.amostras, 2);
  assert.equal(r2.primeira_resposta.mediana_ms, 5 * MIN);
  assert.equal(r2.primeira_resposta.p90_ms, 8 * MIN);

  // 10 amostras: 1..10 min (desordenadas) -> mediana (5+6)/2 = 5.5 min, p90 nearest-rank (ceil(9)=9º) = 9 min
  const dez = [7, 1, 10, 3, 5, 8, 2, 9, 4, 6].map((m, i) => fazerComResposta(i + 1, m));
  const r10 = resumir(dez, iso(60 * MIN));
  assert.equal(r10.primeira_resposta.amostras, 10);
  assert.equal(r10.primeira_resposta.mediana_ms, 5.5 * MIN);
  assert.equal(r10.primeira_resposta.p90_ms, 9 * MIN);
});

test('resumir: agrupamento por setor e por responsavel (com e sem responsável)', () => {
  const agora = iso(60 * MIN);
  const conversas = [
    // Aberta com Carla (Suporte), respondeu em 2 min, não está aguardando
    montarConversa({
      id: 'cv_1',
      setor: { id: 'set_suporte', nome: 'Suporte' },
      responsavel: { id: 'usr_carla', nome: 'Carla Souza' },
      situacao: 'aberta',
      aberta_em: iso(0),
      aguardando_desde: null,
      itens: [{ categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, em: iso(2 * MIN) }],
    }),
    // Na fila do Suporte (sem responsável), aguardando há 15 min, só sistema respondeu
    montarConversa({
      id: 'cv_2',
      setor: { id: 'set_suporte', nome: 'Suporte' },
      responsavel: null,
      situacao: 'aberta',
      aberta_em: iso(45 * MIN),
      aguardando_desde: iso(45 * MIN),
      itens: [{ categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'sistema' }, em: iso(45 * MIN) }],
    }),
    // Encerrada no Financeiro (Bruno), respondeu em 6 min, durou 20 min
    montarConversa({
      id: 'cv_3',
      setor: { id: 'set_financeiro', nome: 'Financeiro' },
      responsavel: { id: 'usr_bruno', nome: 'Bruno Lima' },
      situacao: 'encerrada',
      aberta_em: iso(10 * MIN),
      encerrada_em: iso(30 * MIN),
      aguardando_desde: null,
      itens: [{ categoria: 'mensagem', direcao: 'saida', autor: { tipo: 'atendente' }, em: iso(16 * MIN) }],
    }),
    // Na fila do Financeiro (sem responsável), aguardando há 5 min
    montarConversa({
      id: 'cv_4',
      setor: { id: 'set_financeiro', nome: 'Financeiro' },
      responsavel: null,
      situacao: 'aberta',
      aberta_em: iso(55 * MIN),
      aguardando_desde: iso(55 * MIN),
      itens: [],
    }),
  ];

  // Agrupado por responsável
  const porResp = resumir(conversas, agora, { agruparPor: 'responsavel' });
  assert.equal(porResp.total, 4);
  assert.equal(porResp.abertas, 3);
  assert.equal(porResp.na_fila, 2);
  assert.equal(porResp.encerradas, 1);
  assert.equal(porResp.primeira_resposta.amostras, 2);
  assert.equal(porResp.primeira_resposta.mediana_ms, 4 * MIN);
  assert.equal(porResp.primeira_resposta.p90_ms, 6 * MIN);
  assert.equal(porResp.espera_atual.maior_ms, 15 * MIN);
  assert.equal(porResp.espera_atual.mediana_ms, 10 * MIN);
  assert.equal(porResp.duracao.amostras, 1);
  assert.equal(porResp.duracao.mediana_ms, 20 * MIN);

  assert.equal(porResp.grupos.length, 3);
  assert.equal(porResp.grupos[0].nome, 'Bruno Lima');
  assert.equal(porResp.grupos[0].encerradas, 1);
  assert.equal(porResp.grupos[1].nome, 'Carla Souza');
  assert.equal(porResp.grupos[1].abertas, 1);
  assert.equal(porResp.grupos[2].id, null);
  assert.equal(porResp.grupos[2].nome, 'Sem responsável');
  assert.equal(porResp.grupos[2].na_fila, 2);
  assert.equal(porResp.grupos[2].espera_atual.maior_ms, 15 * MIN);

  // Agrupado por setor
  const porSetor = resumir(conversas, agora, { agruparPor: 'setor' });
  assert.equal(porSetor.grupos.length, 2);
  assert.equal(porSetor.grupos[0].id, 'set_financeiro');
  assert.equal(porSetor.grupos[0].abertas, 1);
  assert.equal(porSetor.grupos[0].na_fila, 1);
  assert.equal(porSetor.grupos[0].encerradas, 1);
  assert.equal(porSetor.grupos[1].id, 'set_suporte');
  assert.equal(porSetor.grupos[1].abertas, 2);
  assert.equal(porSetor.grupos[1].na_fila, 1);
});
