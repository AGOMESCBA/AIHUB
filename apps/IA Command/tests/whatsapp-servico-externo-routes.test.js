const assert = require('assert');

const servicoExternoRoutes = require('../modules/whatsapp/servico-externo-routes');
const { resolverCanalServicoExterno, enviarTextoServicoExterno, segredoAutorizado } = servicoExternoRoutes._test;

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

function canal(id, porta) {
  return {
    id,
    ativo: 1,
    is_windows_service: 1,
    worker_port: porta,
    auth_client_id: `iac_ch_${id}`,
  };
}

(async () => {
  const originalIacSecret = process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET;
  const originalSvcSecret = process.env.SVC_WHATSAPP_OTP_SECRET;

  try {
    {
      const vinculado = canal('j2a', 3101);
      const chamadas = [];
      const workerJsonFn = async (porta, rota, payload) => {
        chamadas.push({ porta, rota, payload });
        if (rota === '/health') return { status: 'connected' };
        return { ok: true };
      };

      const ret = await resolverCanalServicoExterno(5, {
        channelStore: channelStoreFake({ porEmpresa: { 5: [vinculado] } }),
        manager: managerVazio(),
        workerJsonFn,
      });

      assert.strictEqual(ret.canal.id, 'j2a');
      assert.strictEqual(ret.workerPort, 3101);
      assert.strictEqual(ret.origem, 'empresa');
    }

    {
      const compartilhado = canal('j2a', 3101);
      const enviados = [];
      const workerJsonFn = async (porta, rota, payload) => {
        if (rota === '/health') return { status: 'connected' };
        enviados.push({ porta, rota, payload });
        return { ok: true };
      };

      const ret = await enviarTextoServicoExterno(
        { empresaId: 5, numero: '5511999999999', texto: '123456' },
        {
          channelStore: channelStoreFake({
            porEmpresa: { 5: [] },
            globais: [compartilhado],
            empresasPorCanal: { j2a: [{ empresa_id: 5 }] },
          }),
          manager: managerVazio(),
          workerJsonFn,
        }
      );

      assert.strictEqual(ret.canalId, 'j2a');
      assert.strictEqual(enviados.length, 1);
      assert.strictEqual(enviados[0].porta, 3101);
      assert.strictEqual(enviados[0].rota, '/send-direct-message');
      assert.deepStrictEqual(enviados[0].payload, {
        empresaId: 5,
        numero: '5511999999999',
        texto: '123456',
      });
    }

    {
      delete process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET;
      process.env.SVC_WHATSAPP_OTP_SECRET = 'svc-secret';
      const ret = segredoAutorizado({ headers: { 'x-servico-externo-secret': 'svc-secret' } });
      assert.strictEqual(ret.ok, true, 'rota deve aceitar fallback SVC_WHATSAPP_OTP_SECRET usado pelo IA Service');
    }

    console.log('whatsapp-servico-externo-routes.test.js: ok');
  } finally {
    if (originalIacSecret === undefined) delete process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET;
    else process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET = originalIacSecret;

    if (originalSvcSecret === undefined) delete process.env.SVC_WHATSAPP_OTP_SECRET;
    else process.env.SVC_WHATSAPP_OTP_SECRET = originalSvcSecret;
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
