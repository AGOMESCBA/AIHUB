'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('serviço do chat define a origem após o merge e a transporta ao lote multiempresa', async () => {
  const saved = new Map();
  const capturados = [];
  const estado = { modo: 'especifica', chaves: ['0100', '0101', '0102'] };
  function mock(path, exports) {
    const id = require.resolve(path);
    saved.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  mock('../modules/database', { getDB: () => ({}) });
  mock('../modules/ai/intent-service', { classificar: async () => ({ intencao: 'faturamento_dinamico', _origemExecucao: 'IA' }) });
  mock('../modules/ai/intent-merger', { mesclar: intent => ({ ...intent, _origemExecucao: 'historico' }) });
  mock('../modules/erp/core/intent-router', { rotear: async intent => {
    capturados.push(intent);
    return { tipo: 'sucesso_ai_sql', rows: null };
  } });
  mock('../modules/erp/core/response-formatter', {
    formatar: () => 'ok', montarApresentacaoResposta: () => ({}), textoApresentacao: () => 'ok',
  });
  mock('../modules/protheus_whatsapp/session-store', {
    ultimoIntent: () => ({ _origemExecucao: 'whatsapp' }),
    salvarTurno: () => ({ perguntaId: 'pergunta', respostaId: 'resposta' }),
    vincularInterpretacao() {},
  });
  mock('../modules/ai/interpretation-pipeline', { registrarInterpretacao: () => 'log-teste' });
  mock('../modules/erp/totvs_protheus/SX/lobo-guara-filial-resolver', {
    contextoLoboGuara: () => ({ connectionId: 'caieira' }), resolverDaMensagem: () => estado,
  });
  mock('../modules/whatsapp/service', class {
    async _pipelineAll(texto, empresas, celular, options) {
      capturados.push(options);
      return 'ok';
    }
  });
  const serviceId = require.resolve('../modules/protheus_whatsapp/service');
  saved.set(serviceId, require.cache[serviceId]);
  delete require.cache[serviceId];
  try {
    const service = require(serviceId);
    await service.processarMensagem({ empresaId: 4, celular: 'teste', sessaoId: 'sessao', texto: 'Qual o faturamento da semana?' });
    assert.equal(capturados[0]._origemExecucao, 'chat');
    assert.deepEqual(capturados[0]._filialLoboGuara, estado);
    await service.processarMensagem({
      empresaId: 4, celular: 'teste', sessaoId: 'sessao', texto: 'Qual o faturamento da semana?',
      empresasSelecionadas: [{ empresa_id: 4 }, { empresa_id: 5 }],
    });
    assert.equal(capturados[1]._origemExecucao, 'chat');
  } finally {
    for (const [id, previous] of saved) {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    }
  }
});
