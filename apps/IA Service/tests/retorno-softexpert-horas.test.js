const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarHoras } = require('../backend/services/retorno-softexpert-horas');
const { mapearCampos } = require('../backend/services/retorno-softexpert-config');
const { validarContrato } = require('../backend/services/retorno-softexpert-config');
const exemplo = { HORAINI: '08:30', HORAINT: '00:30', HORAFIM: '11:00', DTAGEND: '2026-10-18', HRAGEND: '19:00' };

test('conversões em horas decimais e total são calculados no servidor, ignorando valores adulterados', () => {
  const r = normalizarHoras({ ...exemplo, HORAINICONV: '35', HORAINTCONV: '90', HORAFIMCONV: '999', HORATOTALNUM: '999' });
  assert.equal(r.HORAINICONV, '8.5'); assert.equal(r.HORAINTCONV, '0.5');
  assert.equal(r.HORAFIMCONV, '11'); assert.equal(r.HORATOTALNUM, '2');
  assert.equal(normalizarHoras({ HORAINI: '00:00', HORAINT: '00:00', HORAFIM: '00:00' }).HORATOTALNUM, '0');
});

test('horas obrigatórias, seleção de meia hora e total não negativo', () => {
  for (const patch of [{ HORAINI: '' }, { HORAFIM: '' }, { HORAINT: '' }, { HORAINI: '8:30' }, { HORAFIM: '24:00' }, { HORAINI: '08:15' }, { HORAINT: '00:01' }, { HORAFIM: '08:00' }, { HORAINT: '03:00' }]) assert.throws(() => normalizarHoras({ ...exemplo, ...patch }), { status: 400 });
});

test('agendamento opcional aceita dia ISO e HH:MM; rejeita datas impossíveis e segundos', () => {
  assert.equal(normalizarHoras({ ...exemplo, HRAGEND: '19:17' }).HRAGEND, '19:17');
  for (const patch of [{ DTAGEND: '18/10/2026' }, { DTAGEND: '2026-02-30' }, { DTAGEND: '2026-10-18T19:00:00' }, { HRAGEND: '19:00:30' }, { HRAGEND: '24:00' }]) assert.throws(() => normalizarHoras({ ...exemplo, ...patch }), { status: 400 });
});

test('mapeamento oficial inclui os três campos convertidos e total sem aceitar cálculo do cliente', () => {
  const campos = Object.fromEntries(['HORAINI', 'HORAINT', 'HORAFIM', 'HORAINICONV', 'HORAINTCONV', 'HORAFIMCONV', 'HORATOTALNUM', 'DTAGEND', 'HRAGEND'].map(k => [k, { id: k.toLowerCase(), tipo: k === 'DTAGEND' ? 'data' : k.endsWith('CONV') || k === 'HORATOTALNUM' ? 'decimal' : 'hora' }]));
  const r = mapearCampos({ ...exemplo, HORATOTALNUM: '999' }, { campos }, { chamado: {}, consultor: {}, instante: new Date().toISOString() });
  assert.deepEqual(r, { horaini: '08:30', horaint: '00:30', horafim: '11:00', horainiconv: '8.5', horaintconv: '0.5', horafimconv: '11', horatotalnum: '2', dtagend: '2026-10-18', hragend: '19:00' });
});

test('histórico nativo aceita conta de integração autorizada e continua exigindo autoria validada', () => {
  const contrato = { contratoValidado: true, envioHabilitado: true, origem: 'https://invalid.example', authorizationMode: 'jwt', encoding: 'utf8', mainEntityId: 'itsm', childRelationshipId: 'relagridregistr', evidenciaContrato: 'fixture', campos: { DESCRICAO: { id: 'descricao', tipo: 'texto' } }, autoria: { validada: true, modo: 'conta_integracao' }, historico: { modo: 'comentario_validado', equivalenciaValidada: true, evidencia: 'fixture', envioAutomatico: true, privado: true } };
  assert.equal(validarContrato(contrato).autoria.modo, 'conta_integracao');
  assert.throws(() => validarContrato({ ...contrato, autoria: { ...contrato.autoria, validada: false } }), /Autoria não validada/);
  assert.equal(validarContrato({ ...contrato, autoria: { ...contrato.autoria, modo: 'credencial_analista' } }).autoria.modo, 'credencial_analista');
});
