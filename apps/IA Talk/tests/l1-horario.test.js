'use strict';

// L1 — testes unitários da biblioteca pura backend/lib/horario/index.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JANELA_AVISO_PADRAO_MS,
  validarHorario,
  dentroDoHorario,
  proximaAbertura,
  podeAvisarForaDoHorario,
} = require('../backend/lib/horario');

const HORARIO_COMERCIAL_CUIABA = {
  ligado: true,
  fuso: 'America/Cuiaba',
  dias: [
    // Segunda a sexta com intervalo de almoço (dois intervalos no dia)
    { dia: 1, inicio: '08:00', fim: '12:00' },
    { dia: 1, inicio: '13:00', fim: '18:00' },
    { dia: 2, inicio: '08:00', fim: '18:00' },
    { dia: 3, inicio: '08:00', fim: '18:00' },
    { dia: 4, inicio: '08:00', fim: '18:00' },
    { dia: 5, inicio: '08:00', fim: '18:00' },
  ],
};

test('validarHorario: aceita horário válido e recusa cada tipo de erro com mensagem em pt-BR', () => {
  assert.equal(validarHorario(HORARIO_COMERCIAL_CUIABA), null);
  assert.equal(validarHorario({ ligado: false, fuso: 'America/Cuiaba', dias: [] }), null);
  // Intervalos encostados (12:00 exclusivo) não se sobrepõem
  assert.equal(validarHorario({
    ligado: true,
    fuso: 'America/Cuiaba',
    dias: [
      { dia: 1, inicio: '08:00', fim: '12:00' },
      { dia: 1, inicio: '12:00', fim: '18:00' },
    ],
  }), null);

  assert.equal(typeof validarHorario(null), 'string');
  assert.equal(typeof validarHorario({ ligado: 'sim', fuso: 'America/Cuiaba', dias: [] }), 'string');
  assert.equal(typeof validarHorario({ ligado: false, fuso: 'Fuso/Inexistente', dias: [] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: 'nao-array' }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 7, inicio: '08:00', fim: '18:00' }] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: -1, inicio: '08:00', fim: '18:00' }] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1.5, inicio: '08:00', fim: '18:00' }] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '8:00', fim: '18:00' }] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '08:00', fim: '24:00' }] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '18:00', fim: '18:00' }] }), 'string');
  assert.equal(typeof validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '18:00', fim: '08:00' }] }), 'string');
  assert.equal(typeof validarHorario({
    ligado: true,
    fuso: 'America/Cuiaba',
    dias: [
      { dia: 1, inicio: '08:00', fim: '12:30' },
      { dia: 1, inicio: '12:00', fim: '18:00' },
    ],
  }), 'string');
});

test('dentroDoHorario: desligado sempre true, dois intervalos no dia, fim exclusivo e domingo', () => {
  const desligado = { ligado: false, fuso: 'America/Cuiaba', dias: [] };
  assert.equal(dentroDoHorario(desligado, '2026-11-29T05:00:00.000Z'), true);

  // 2026-11-30 é segunda-feira. America/Cuiaba = UTC-4.
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T11:59:59.000Z'), false); // 07:59:59 local
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T12:00:00.000Z'), true);  // 08:00:00 local (início inclusivo)
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T15:59:59.000Z'), true);  // 11:59:59 local
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T16:00:00.000Z'), false); // 12:00:00 local (fim exclusivo)
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T16:30:00.000Z'), false); // 12:30:00 almoço
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T17:00:00.000Z'), true);  // 13:00:00 2º intervalo
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T21:59:59.000Z'), true);  // 17:59:59 local
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-30T22:00:00.000Z'), false); // 18:00:00 local (fim exclusivo)

  // 2026-11-29 é domingo (dia 0)
  assert.equal(dentroDoHorario(HORARIO_COMERCIAL_CUIABA, '2026-11-29T14:00:00.000Z'), false);
  const comDomingo = {
    ligado: true,
    fuso: 'America/Cuiaba',
    dias: [{ dia: 0, inicio: '09:00', fim: '13:00' }],
  };
  assert.equal(dentroDoHorario(comDomingo, '2026-11-29T13:00:00.000Z'), true);  // 09:00 Cuiabá
  assert.equal(dentroDoHorario(comDomingo, '2026-11-29T17:00:00.000Z'), false); // 13:00 Cuiabá (exclusivo)
});

test('dentroDoHorario: mesmo instante UTC dentro em America/Cuiaba e fora em America/Sao_Paulo, e virada da meia-noite', () => {
  // 2026-11-30T21:30:00Z = 17:30 em America/Cuiaba (UTC-4) e 18:30 em America/Sao_Paulo (UTC-3)
  const instanteUtc = '2026-11-30T21:30:00.000Z';
  const emCuiaba = { ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '08:00', fim: '18:00' }] };
  const emSaoPaulo = { ligado: true, fuso: 'America/Sao_Paulo', dias: [{ dia: 1, inicio: '08:00', fim: '18:00' }] };

  assert.equal(dentroDoHorario(emCuiaba, instanteUtc), true);
  assert.equal(dentroDoHorario(emSaoPaulo, instanteUtc), false);

  // Virada da meia-noite UTC vs fuso local:
  // 2026-12-01T02:30:00Z ainda é segunda-feira 22:30 em America/Cuiaba (dia 1), mas já é terça 02:30 em UTC!
  const plantaoNoturno = {
    ligado: true,
    fuso: 'America/Cuiaba',
    dias: [{ dia: 1, inicio: '22:00', fim: '23:59' }],
  };
  assert.equal(dentroDoHorario(plantaoNoturno, '2026-12-01T02:30:00.000Z'), true);  // seg 22:30 Cuiabá
  assert.equal(dentroDoHorario(plantaoNoturno, '2026-12-01T04:00:00.000Z'), false); // ter 00:00 Cuiabá
});

test('proximaAbertura: almoço, fim de semana, ciclo de 7 dias, já dentro e desligado', () => {
  // Desligado ou já dentro -> null
  assert.equal(proximaAbertura({ ligado: false, fuso: 'America/Cuiaba', dias: [] }, '2026-11-30T16:30:00.000Z'), null);
  assert.equal(proximaAbertura(HORARIO_COMERCIAL_CUIABA, '2026-11-30T14:00:00.000Z'), null);

  // No almoço de segunda (12:30 Cuiabá = 16:30Z) -> reabre 13:00 Cuiabá (17:00Z)
  assert.equal(proximaAbertura(HORARIO_COMERCIAL_CUIABA, '2026-11-30T16:30:00.000Z'), '2026-11-30T17:00:00.000Z');

  // Sexta 2026-11-27 às 18:00 Cuiabá (22:00Z, fim exclusivo) -> abre segunda 2026-11-30 08:00 Cuiabá (12:00Z)
  assert.equal(proximaAbertura(HORARIO_COMERCIAL_CUIABA, '2026-11-27T22:00:00.000Z'), '2026-11-30T12:00:00.000Z');

  // Domingo 2026-11-29 10:00 Cuiabá (14:00Z) -> abre segunda 2026-11-30 08:00 Cuiabá (12:00Z)
  assert.equal(proximaAbertura(HORARIO_COMERCIAL_CUIABA, '2026-11-29T14:00:00.000Z'), '2026-11-30T12:00:00.000Z');

  // Somente segunda-feira: na própria segunda após fechar (19:00 Cuiabá = 23:00Z) -> próxima segunda (+7 dias calendário)
  const soSegunda = { ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '08:00', fim: '18:00' }] };
  assert.equal(proximaAbertura(soSegunda, '2026-11-30T23:00:00.000Z'), '2026-12-07T12:00:00.000Z');

  // Virada da meia-noite UTC: 2026-12-01T01:00:00Z = segunda 21:00 Cuiabá -> abre terça 08:00 Cuiabá (2026-12-01T12:00:00Z)
  assert.equal(proximaAbertura(HORARIO_COMERCIAL_CUIABA, '2026-12-01T01:00:00.000Z'), '2026-12-01T12:00:00.000Z');
});

test('proximaAbertura em horário de verão (America/New_York): horário inexistente em março e repetido em novembro', () => {
  // 1) Spring-forward (2026-03-08 em America/New_York): 01:59:59 EST pula para 03:00:00 EDT (07:00:00Z).
  // Intervalo 02:30–05:00 no domingo: 02:30 não existe, então a abertura efetiva ocorre às 03:00 EDT (07:00Z),
  // instante em que dentroDoHorario passa a ser true.
  const nySpring = {
    ligado: true,
    fuso: 'America/New_York',
    dias: [{ dia: 0, inicio: '02:30', fim: '05:00' }],
  };
  const aberturaSpring = proximaAbertura(nySpring, '2026-03-08T06:00:00.000Z'); // 01:00 EST
  assert.equal(aberturaSpring, '2026-03-08T07:00:00.000Z');
  assert.equal(dentroDoHorario(nySpring, aberturaSpring), true);
  assert.equal(dentroDoHorario(nySpring, Date.parse(aberturaSpring) - 1), false);

  // Intervalo inteiro dentro da faixa inexistente (02:15–02:45): não abre em 2026-03-08,
  // pula para o domingo seguinte (2026-03-15 02:15 EDT = 06:15Z).
  const nyGapTotal = {
    ligado: true,
    fuso: 'America/New_York',
    dias: [{ dia: 0, inicio: '02:15', fim: '02:45' }],
  };
  const aberturaGapTotal = proximaAbertura(nyGapTotal, '2026-03-08T06:00:00.000Z');
  assert.equal(aberturaGapTotal, '2026-03-15T06:15:00.000Z');
  assert.equal(dentroDoHorario(nyGapTotal, aberturaGapTotal), true);

  // 2) Fall-back (2026-11-01 em America/New_York): 01:59:59 EDT (05:59:59Z) volta para 01:00:00 EST (06:00:00Z).
  // Intervalo 01:30–01:45 ocorre duas vezes no mesmo domingo: 05:30Z (EDT) e 06:30Z (EST).
  const nyFall = {
    ligado: true,
    fuso: 'America/New_York',
    dias: [{ dia: 0, inicio: '01:30', fim: '01:45' }],
  };
  // Antes da 1ª ocorrência (01:00 EDT = 05:00Z) -> 1ª ocorrência às 05:30Z
  const primeiraOcorrencia = proximaAbertura(nyFall, '2026-11-01T05:00:00.000Z');
  assert.equal(primeiraOcorrencia, '2026-11-01T05:30:00.000Z');
  assert.equal(dentroDoHorario(nyFall, primeiraOcorrencia), true);

  // Após a 1ª ocorrência (01:50 EDT = 05:50Z) -> 2ª ocorrência no mesmo dia às 06:30Z (01:30 EST)
  const segundaOcorrencia = proximaAbertura(nyFall, '2026-11-01T05:50:00.000Z');
  assert.equal(segundaOcorrencia, '2026-11-01T06:30:00.000Z');
  assert.equal(dentroDoHorario(nyFall, segundaOcorrencia), true);

  // Após a 2ª ocorrência (01:50 EST = 06:50Z) -> próximo domingo (2026-11-08 01:30 EST = 06:30Z)
  const semanaSeguinte = proximaAbertura(nyFall, '2026-11-01T06:50:00.000Z');
  assert.equal(semanaSeguinte, '2026-11-08T06:30:00.000Z');
  assert.equal(dentroDoHorario(nyFall, semanaSeguinte), true);

  // 3) Reentrada causada pelo recuo do relógio no fall-back:
  // Intervalo 00:30–01:15 fecha às 01:15 EDT (05:15Z), mas reabre às 01:00 EST (06:00Z) quando o relógio recua.
  const nyReentrada = {
    ligado: true,
    fuso: 'America/New_York',
    dias: [{ dia: 0, inicio: '00:30', fim: '01:15' }],
  };
  const reabertura = proximaAbertura(nyReentrada, '2026-11-01T05:30:00.000Z'); // 01:30 EDT (fora)
  assert.equal(reabertura, '2026-11-01T06:00:00.000Z'); // 01:00 EST (dentro novamente)
  assert.equal(dentroDoHorario(nyReentrada, reabertura), true);
  assert.equal(dentroDoHorario(nyReentrada, Date.parse(reabertura) - 1), false);
});

test('podeAvisarForaDoHorario: nunca avisou e limite exato da janela de 12 h', () => {
  assert.equal(JANELA_AVISO_PADRAO_MS, 12 * 60 * 60 * 1000);
  const t0 = '2026-11-27T20:00:00.000Z';

  assert.equal(podeAvisarForaDoHorario({ ultimoAvisoEm: null, instanteIso: t0 }), true);
  assert.equal(podeAvisarForaDoHorario({ ultimoAvisoEm: undefined, instanteIso: t0 }), true);

  // 11h59m59.999s depois -> false
  assert.equal(podeAvisarForaDoHorario({
    ultimoAvisoEm: t0,
    instanteIso: new Date(Date.parse(t0) + JANELA_AVISO_PADRAO_MS - 1).toISOString(),
  }), false);

  // Exatamente 12h00m00.000s depois -> true
  assert.equal(podeAvisarForaDoHorario({
    ultimoAvisoEm: t0,
    instanteIso: new Date(Date.parse(t0) + JANELA_AVISO_PADRAO_MS).toISOString(),
  }), true);

  // Janela customizada
  assert.equal(podeAvisarForaDoHorario({
    ultimoAvisoEm: t0,
    instanteIso: '2026-11-27T20:30:00.000Z',
    janelaMs: 30 * 60 * 1000,
  }), true);
});
