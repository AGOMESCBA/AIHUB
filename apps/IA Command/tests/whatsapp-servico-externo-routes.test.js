const assert = require('assert');

const servicoExternoRoutes = require('../modules/whatsapp/servico-externo-routes');
const { resolverCanalServicoExterno, enviarTextoServicoExterno, enviarGrupoServicoExterno, segredoAutorizado } = servicoExternoRoutes._test;

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
        finalidadeEnvio: 'servico_externo',
      });

      for (const finalidadeEnvio of ['iaservice_aviso_acesso', 'iaservice_codigo_acesso']) {
        await enviarTextoServicoExterno(
          { empresaId: 5, numero: '5511999999999', texto: 'mensagem', finalidadeEnvio },
          {
            channelStore: channelStoreFake({ porEmpresa: { 5: [compartilhado] } }),
            manager: managerVazio(), workerJsonFn,
          }
        );
        assert.strictEqual(enviados.at(-1).payload.finalidadeEnvio, finalidadeEnvio);
        assert.strictEqual(enviados.at(-1).payload.texto, 'mensagem');
      }
    }

    {
      // Envio para grupos: número em dois grupos recebe uma vez; falha de um não para os outros.
      const pedidos = [];
      const recipientGroups = {
        listarMembrosAtivosDosGrupos: (empresaId, grupoIds) => {
          pedidos.push({ empresaId, grupoIds });
          return [
            { id: 'n1', nome: 'Ana', numero: '5511999990001' },
            { id: 'n2', nome: 'Bruno', numero: '5511999990002' },
            { id: 'n3', nome: 'Ana (outro grupo)', numero: '+55 11 99999-0001' },
            { id: 'n4', nome: 'Caio', numero: '5511999990004' },
          ];
        },
      };
      recipientGroups.buscarGruposPorIds = () => [{ nome: 'Líderes' }, { nome: 'Triagem' }];
      const enviadosGrupo = [];
      const enviarTextoFn = async (payload) => {
        if (payload.numero === '5511999990002') throw new Error('Numero nao autorizado para esta empresa.');
        enviadosGrupo.push(payload);
        return { registrado: payload.numero === '5511999990004' };
      };
      // Cada passo vai ao histórico do canal (WhatsApp Services).
      const registros = [];
      const registrarFn = async (tipo, msg) => { registros.push([tipo, msg]); };
      const formatarContatoFn = (n) => `contato ${String(n).slice(-4)}`;

      const ret = await enviarGrupoServicoExterno(
        { empresaId: '5', grupoIds: ['g1', 'g2'], texto: 'aviso', finalidadeEnvio: 'iaservice_jade_pa_sucesso', referencia: 'lote #7' },
        { recipientGroups, enviarTextoFn, registrarFn, formatarContatoFn }
      );
      assert.deepStrictEqual(registros, [
        ['info', '📣 Jaade IA · aviso de PA respondido (lote #7): enviando aos grupos Líderes, Triagem (3 número(s)).'],
        ['success', '✅ Jaade IA · aviso de PA respondido (lote #7) → contato 0001'],
        ['error', '❌ Jaade IA · aviso de PA respondido (lote #7) → contato 0002: Numero nao autorizado para esta empresa.'],
        // contato 0004 já foi registrado pelo worker (registrado: true): sem linha repetida.
        ['warning', '⚠️ Jaade IA · aviso de PA respondido (lote #7): entregue a 2 de 3 número(s).'],
      ]);

      assert.deepStrictEqual(pedidos, [{ empresaId: 5, grupoIds: ['g1', 'g2'] }]);
      assert.strictEqual(ret.total, 3);
      assert.strictEqual(ret.enviados, 2);
      assert.deepStrictEqual(ret.falhas, [{ nome: 'Bruno', erro: 'Numero nao autorizado para esta empresa.' }]);
      assert.deepStrictEqual(enviadosGrupo.map(p => p.numero), ['5511999990001', '5511999990004']);
      assert.ok(enviadosGrupo.every(p => p.empresaId === 5 && p.texto === 'aviso' && p.finalidadeEnvio === 'iaservice_jade_pa_sucesso'));

      const vazio = await enviarGrupoServicoExterno(
        { empresaId: 5, grupoIds: ['g9'], texto: 'aviso', finalidadeEnvio: 'iaservice_jade_pa_falha' },
        { recipientGroups: { listarMembrosAtivosDosGrupos: () => [] }, enviarTextoFn, registrarFn }
      );
      assert.deepStrictEqual(vazio, { total: 0, enviados: 0, falhas: [] });
      assert.deepStrictEqual(registros.at(-1)[0], 'warning');
      assert.match(registros.at(-1)[1], /nenhum número com acesso à empresa nos grupos grupos indisponíveis; mensagem não enviada/);
    }

    {
      delete process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET;
      process.env.SVC_WHATSAPP_OTP_SECRET = 'svc-secret';
      const local = { remoteAddress: '127.0.0.1' };
      const ret = segredoAutorizado({ headers: { 'x-servico-externo-secret': 'svc-secret' }, socket: local });
      assert.strictEqual(ret.ok, true, 'rota deve aceitar fallback SVC_WHATSAPP_OTP_SECRET usado pelo IA Service');

      const ipv6 = segredoAutorizado({ headers: { 'x-servico-externo-secret': 'svc-secret' }, socket: { remoteAddress: '::ffff:127.0.0.1' } });
      assert.strictEqual(ipv6.ok, true, 'loopback em IPv6 mapeado também é chamada interna');

      // Pelo nginx: chega de 127.0.0.1, mas com os cabeçalhos que ele sempre põe.
      const viaNginx = segredoAutorizado({
        headers: { 'x-servico-externo-secret': 'svc-secret', 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' },
        socket: local,
      });
      assert.deepStrictEqual([viaNginx.ok, viaNginx.status], [false, 403], 'segredo certo vindo da internet deve ser recusado');

      const soForwarded = segredoAutorizado({ headers: { 'x-servico-externo-secret': 'svc-secret', 'x-forwarded-for': '10.0.0.5' }, socket: local });
      assert.strictEqual(soForwarded.ok, false, 'qualquer cabeçalho de proxy basta para recusar');

      const externo = segredoAutorizado({ headers: { 'x-servico-externo-secret': 'svc-secret' }, socket: { remoteAddress: '198.51.100.7' } });
      assert.deepStrictEqual([externo.ok, externo.status], [false, 403], 'acesso direto à porta 3000 de fora deve ser recusado');

      const semSocket = segredoAutorizado({ headers: { 'x-servico-externo-secret': 'svc-secret' } });
      assert.strictEqual(semSocket.ok, false, 'sem origem conhecida não é chamada interna');

      const errado = segredoAutorizado({ headers: { 'x-servico-externo-secret': 'outro' }, socket: local });
      assert.deepStrictEqual([errado.ok, errado.status], [false, 403], 'segredo errado continua recusado');

      delete process.env.SVC_WHATSAPP_OTP_SECRET;
      const semConfig = segredoAutorizado({ headers: {}, socket: local });
      assert.deepStrictEqual([semConfig.ok, semConfig.status], [false, 503], 'sem segredo configurado a rota fica fechada');
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
