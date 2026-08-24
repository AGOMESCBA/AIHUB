const assert = require('assert');

const routes = require('../modules/protheus_whatsapp/routes');
const { resolverCanalWhatsAppConectado } = routes._test;

function managerVazio() {
  return {
    get: () => null,
    getAll: () => new Map(),
  };
}

function channelStoreFake({ porEmpresa = {}, globais = [], todos = [], empresasPorCanal = {} }) {
  return {
    listarPorEmpresa: (empresaId) => porEmpresa[Number(empresaId)] || [],
    listarAtivosComSessao: () => globais,
    listarTodosCanais: () => todos,
    listarEmpresasDoCanal: (channelId) => empresasPorCanal[String(channelId)] || [],
  };
}

function workerConectado(portasConectadas) {
  const portas = new Set(portasConectadas.map(Number));
  return async (porta) => ({
    status: portas.has(Number(porta)) ? 'connected' : 'disconnected',
  });
}

function canal(id, porta) {
  return {
    id,
    is_windows_service: 1,
    worker_port: porta,
    auth_client_id: `iac_ch_${id}`,
  };
}

(async () => {
  {
    const vinculado = canal('j2a', 3101);
    const ret = await resolverCanalWhatsAppConectado(5, {
      channelStore: channelStoreFake({ porEmpresa: { 5: [vinculado] } }),
      manager: managerVazio(),
      workerJsonFn: workerConectado([3101]),
    });
    assert.strictEqual(ret.canal.id, 'j2a');
    assert.strictEqual(ret.workerPort, 3101);
    assert.strictEqual(ret.origem, 'empresa');
  }

  {
    const j2a = canal('j2a', 3101);
    const outro = canal('outro', 3102);
    const ret = await resolverCanalWhatsAppConectado(5, {
      channelStore: channelStoreFake({
        porEmpresa: { 5: [] },
        globais: [j2a, outro],
        empresasPorCanal: {
          j2a: [{ empresa_id: 1 }, { empresa_id: 5 }],
          outro: [{ empresa_id: 9 }],
        },
      }),
      manager: managerVazio(),
      workerJsonFn: workerConectado([3101, 3102]),
    });
    assert.strictEqual(ret.canal.id, 'j2a');
    assert.strictEqual(ret.origem, 'compartilhado');
  }

  {
    const unico = canal('j2a', 3101);
    const ret = await resolverCanalWhatsAppConectado(5, {
      channelStore: channelStoreFake({ porEmpresa: { 5: [] }, globais: [unico] }),
      manager: managerVazio(),
      workerJsonFn: workerConectado([3101]),
    });
    assert.strictEqual(ret.canal, null);
    assert.strictEqual(ret.workerPort, null);
  }

  {
    const unico = canal('j2a', 3101);
    const ret = await resolverCanalWhatsAppConectado(5, {
      channelStore: channelStoreFake({ porEmpresa: { 5: [] }, globais: [], todos: [unico] }),
      manager: managerVazio(),
      workerJsonFn: workerConectado([3101]),
    });
    assert.strictEqual(ret.canal, null);
    assert.strictEqual(ret.workerPort, null);
  }

  {
    const j2a = canal('j2a', 3101);
    const outro = canal('outro', 3102);
    const ret = await resolverCanalWhatsAppConectado(5, {
      channelStore: channelStoreFake({ porEmpresa: { 5: [] }, globais: [j2a, outro] }),
      manager: managerVazio(),
      workerJsonFn: workerConectado([3101, 3102]),
    });
    assert.strictEqual(ret.canal, null);
    assert.strictEqual(ret.workerPort, null);
  }

  {
    const j2a = canal('j2a', 3101);
    const outro = canal('outro', 3102);
    const ret = await resolverCanalWhatsAppConectado(5, {
      channelStore: channelStoreFake({
        porEmpresa: { 5: [] },
        globais: [j2a, outro],
        empresasPorCanal: {
          j2a: [{ empresa_id: 1 }],
          outro: [{ empresa_id: 9 }],
        },
      }),
      manager: managerVazio(),
      workerJsonFn: workerConectado([3101, 3102]),
    });
    assert.strictEqual(ret.canal, null);
    assert.strictEqual(ret.workerPort, null);
  }

  console.log('protheus forward channel resolution ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
