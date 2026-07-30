'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const IACWhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));

const service = Object.create(IACWhatsAppService.prototype);
service.log = () => {};
service._senderContext = new Map();
service._channelId = 'emp_1';
service._normalizarNumeroWa = v => String(v || '');
service._historicoTurnosConfig = () => 5;

function aplicar(intent, contextoAnterior, texto) {
  return service._aplicarGroupByHerdadoContinuidade(intent, contextoAnterior, texto);
}

{
  const intent = {
    intencao: 'faturamento_dinamico',
    group_by: null,
    agrupar_por: null,
    _contextoAplicado: true,
    _orquestradorContrato: { modulo: 'faturamento', herdou_contexto: true },
  };
  const contextoAnterior = {
    intencao: 'faturamento_dinamico',
    group_by: ['cliente'],
    agrupar_por: 'cliente',
  };
  const out = aplicar(intent, contextoAnterior, 'Compare esse resultado com julho do ano passado.');
  assert.deepStrictEqual(out.group_by, ['cliente']);
  assert.strictEqual(out.agrupar_por, 'cliente');
  assert.strictEqual(out._groupByHerdadoContinuidade, true);
  assert.deepStrictEqual(out._orquestradorContrato.group_by, ['cliente']);
}

{
  const intent = {
    intencao: 'faturamento_dinamico',
    group_by: null,
    _contextoAplicado: true,
  };
  const contextoAnterior = {
    intencao: 'faturamento_dinamico',
    group_by: ['empresa'],
    agrupar_por: 'empresa',
  };
  const out = aplicar(intent, contextoAnterior, 'Compare esse resultado com julho do ano passado.');
  assert.strictEqual(out.group_by, null);
  assert.strictEqual(out._groupByHerdadoContinuidade, undefined);
}

{
  const intent = {
    intencao: 'faturamento_dinamico',
    group_by: ['produto'],
    agrupar_por: 'produto',
    _contextoAplicado: true,
  };
  const contextoAnterior = {
    intencao: 'faturamento_dinamico',
    group_by: ['cliente'],
  };
  const out = aplicar(intent, contextoAnterior, 'Compare esse resultado com julho do ano passado.');
  assert.deepStrictEqual(out.group_by, ['produto']);
  assert.strictEqual(out.agrupar_por, 'produto');
  assert.strictEqual(out._groupByHerdadoContinuidade, undefined);
}

{
  const resultado = {
    _periodoCanonicoResolvido: {
      tipo: 'personalizado',
      dataInicio: '20250601',
      dataFim: '20250731',
      periodos_comparativos: [
        { label: '202506', dataInicio: '20250601', dataFim: '20250630' },
        { label: '202507', dataInicio: '20250701', dataFim: '20250731' },
      ],
      meses: [6, 7],
      anos: [2025],
    },
  };
  const intent = service._intentComContextoDoResultado({
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'personalizado', dataInicio: '20250601', dataFim: '20250731' },
    _mensagemOriginal: 'Compare o faturamento de junho do ano passado com julho do ano passado',
  }, resultado, 1);

  service._saveLastIntent('559999999999', intent, '__all__');
  const historico = service._buildHistoricoResumido('559999999999', 1, 5);
  assert.strictEqual(historico.length, 1);
  assert.strictEqual(historico[0].periodo.dataInicio, '20250601');
  assert.strictEqual(historico[0].periodo.dataFim, '20250731');
  assert.deepStrictEqual(historico[0].periodo.meses, [6, 7]);
  assert.strictEqual(historico[0].periodo.periodos_comparativos.length, 2);
}

console.log('whatsapp-continuidade-groupby ok');
