// Envio de WhatsApp server-to-server para outros apps do IAHub (ex.: IA
// Service, login externo por telefone/OTP). Rota publica para servidor, sem
// sessao de usuario, protegida por segredo compartilhado.

const crypto = require('crypto');
const http = require('http');
const channels = require('./channel-store');
const recipientGroups = require('./recipient-group-store');
const { formatarContatoParaLog } = require('./log-contact');

// Socket.IO do processo principal (para registrar no monitor quando nenhum canal está conectado).
let _io = null;

let manager;
function getManager() {
  if (!manager) manager = require('./service-manager');
  return manager;
}

function workerJson(workerPort, rota, payload = null, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: workerPort,
        path: rota,
        method: payload ? 'POST' : 'GET',
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        let resposta = '';
        res.setEncoding?.('utf8'); res.on('data', d => { resposta += d; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(resposta || '{}'); } catch (_) {}
          if (res.statusCode >= 400) {
            return reject(new Error(json.erro || json.error || `Worker WhatsApp retornou HTTP ${res.statusCode}`));
          }
          resolve(json);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao comunicar com o worker WhatsApp.')); });
    if (body) req.write(body);
    req.end();
  });
}

async function canalWorkerConectado(canal, workerJsonFn = workerJson) {
  if (!canal?.is_windows_service || !canal?.worker_port) return false;
  try {
    const health = await workerJsonFn(canal.worker_port, '/health', null, 2500);
    return String(health?.status || '').toLowerCase() === 'connected';
  } catch (_) {
    return false;
  }
}

function canalServiceConectado(canal, managerRef = getManager()) {
  const svcDireto = managerRef.get(canal.id);
  if (svcDireto && svcDireto.getStatus() === 'connected') return svcDireto;

  for (const svc of managerRef.getAll().values()) {
    if (!svc || svc.getStatus() !== 'connected') continue;
    const channelId = String(svc.getChannelId?.() || '');
    if (channelId && channelId === String(canal.id)) return svc;
  }
  return null;
}

async function primeiroCanalConectado(canais, deps = {}) {
  const managerRef = deps.manager || getManager();
  const workerJsonFn = deps.workerJsonFn || workerJson;

  for (const canal of canais) {
    const svc = canalServiceConectado(canal, managerRef);
    if (svc) return { canal, svc };
  }

  for (const canal of canais) {
    if (await canalWorkerConectado(canal, workerJsonFn)) {
      return { canal, svc: null, workerPort: canal.worker_port };
    }
  }

  return null;
}

function canalCandidatoServicoExterno(canal) {
  if (!canal || canal.ativo === 0) return false;
  if (canal.is_windows_service && canal.worker_port) return true;
  if (String(canal.auth_client_id || '').trim()) return true;
  return false;
}

function canaisGlobaisCandidatos(channelStore = channels) {
  const porSessao = typeof channelStore.listarAtivosComSessao === 'function'
    ? channelStore.listarAtivosComSessao()
    : [];
  const todosAtivos = typeof channelStore.listarTodosCanais === 'function'
    ? channelStore.listarTodosCanais().filter(canalCandidatoServicoExterno)
    : [];
  const porId = new Map();

  for (const canal of [...porSessao, ...todosAtivos]) {
    if (canal?.id && !porId.has(String(canal.id))) porId.set(String(canal.id), canal);
  }

  return [...porId.values()].map(canal => ({
    ...canal,
    empresas: Array.isArray(canal.empresas) ? canal.empresas : channelStore.listarEmpresasDoCanal(canal.id),
  }));
}

async function canaisGlobaisConectados(deps = {}) {
  const channelStore = deps.channelStore || channels;
  const managerRef = deps.manager || getManager();
  const workerJsonFn = deps.workerJsonFn || workerJson;
  const conectados = [];

  for (const canal of canaisGlobaisCandidatos(channelStore)) {
    const svc = canalServiceConectado(canal, managerRef);
    if (svc) {
      conectados.push({ canal, svc });
      continue;
    }
    if (await canalWorkerConectado(canal, workerJsonFn)) {
      conectados.push({ canal, svc: null, workerPort: canal.worker_port });
    }
  }

  return conectados;
}

async function resolverCanalServicoExterno(empresaId, deps = {}) {
  const channelStore = deps.channelStore || channels;
  const canaisEmpresa = channelStore.listarPorEmpresa(Number(empresaId));
  const conectadoDaEmpresa = await primeiroCanalConectado(canaisEmpresa, deps);
  if (conectadoDaEmpresa) {
    return { ...conectadoDaEmpresa, totalCanais: canaisEmpresa.length, origem: 'empresa' };
  }

  const globais = await canaisGlobaisConectados(deps);
  const idsEmpresa = new Set(canaisEmpresa.map(canal => String(canal.id)));
  const compartilhados = globais.filter(item => {
    if (idsEmpresa.has(String(item.canal.id))) return true;
    return Array.isArray(item.canal.empresas)
      && item.canal.empresas.some(emp => Number(emp?.empresa_id) === Number(empresaId));
  });

  if (compartilhados.length === 1) {
    return { ...compartilhados[0], totalCanais: canaisEmpresa.length || 1, origem: 'compartilhado' };
  }

  return { canal: canaisEmpresa[0] || null, svc: null, workerPort: null, totalCanais: canaisEmpresa.length };
}

async function enviarTextoServicoExterno({ empresaId, numero, texto, finalidadeEnvio = 'servico_externo' }, deps = {}) {
  const workerJsonFn = deps.workerJsonFn || workerJson;
  const { canal, svc, workerPort, totalCanais } = await resolverCanalServicoExterno(empresaId, deps);
  if (!canal) throw new Error('Nenhum canal WhatsApp vinculado a esta empresa.');
  if (workerPort) {
    // O worker registra o envio (e a falha) no histórico do canal.
    await workerJsonFn(workerPort, '/send-direct-message', { empresaId, numero, texto, finalidadeEnvio }, 30000);
    return { canalId: canal.id, registrado: true };
  }
  if (!svc) {
    throw new Error(totalCanais > 1
      ? 'Nenhum dos canais WhatsApp vinculados a esta empresa esta conectado.'
      : 'WhatsApp nao esta conectado para o canal vinculado a esta empresa.');
  }
  await svc.sendMessage(numero, texto);
  return { canalId: canal.id, registrado: false };
}

/**
 * Registro no histórico do canal da empresa (tela WhatsApp Services), como o
 * agendamento faz: canal no processo → svc.log; serviço do Windows → /log do
 * worker; nenhum conectado → só em tempo real pelo Socket.IO. Nunca lança.
 */
async function registrarNoCanal(empresaId, tipo, msg, deps = {}) {
  try {
    const workerJsonFn = deps.workerJsonFn || workerJson;
    const { canal, svc, workerPort } = await resolverCanalServicoExterno(empresaId, deps);
    if (svc) return svc.log(msg, tipo);
    if (workerPort) return await workerJsonFn(workerPort, '/log', { tipo, msg }, 3000);
    const io = deps.io || _io;
    if (io && canal?.id) {
      const entry = { channelId: canal.id, tipo, msg, ts: new Date().toISOString() };
      let destino = io.to(`channel_${canal.id}`);
      for (const emp of channels.listarEmpresasDoCanal(canal.id)) destino = destino.to(`emp_${emp.empresa_id}`);
      destino.emit('iac-log', entry);
    }
  } catch (err) {
    process.stdout.write(`[${new Date().toISOString()}] [WARN] Registro no monitor WhatsApp falhou: ${err.message}\n`);
  }
}

// Nome do envio a grupos no histórico do canal (só descrições conhecidas).
const ROTULOS_GRUPO = {
  iaservice_jade_pa_falha: 'Jade PA · aviso de chamados SEM PA',
  iaservice_jade_pa_sucesso: 'Jade PA · aviso de chamados COM PA',
};

/**
 * Mesmo texto para os membros ativos dos grupos (cadastro de Grupos do IA
 * Command): recebe todo membro com Acesso à empresa, sem exigir módulo — quem
 * entra no grupo é a escolha de quem recebe (decisão do usuário, 2026-11-20).
 * Número em mais de um grupo recebe uma vez. Falha de um número não impede os
 * outros; quem chamou decide pelo total enviado.
 */
async function enviarGrupoServicoExterno({ empresaId, grupoIds = [], texto, finalidadeEnvio = 'servico_externo', referencia = '' }, deps = {}) {
  const grupos = deps.recipientGroups || recipientGroups;
  const enviarFn = deps.enviarTextoFn || enviarTextoServicoExterno;
  const registrar = deps.registrarFn || ((tipo, msg) => registrarNoCanal(Number(empresaId), tipo, msg, deps));
  const contato = deps.formatarContatoFn || ((numero) => formatarContatoParaLog(numero, { empresaId: Number(empresaId) }));
  const rotulo = `${ROTULOS_GRUPO[finalidadeEnvio] || 'Envio a grupos'}${referencia ? ` (${String(referencia).slice(0, 60)})` : ''}`;
  const vistos = new Set();
  const membros = grupos.listarMembrosAtivosDosGrupos(Number(empresaId), grupoIds).filter((m) => {
    const digitos = String(m.numero || '').replace(/\D/g, '');
    if (!digitos || vistos.has(digitos)) return false;
    vistos.add(digitos);
    return true;
  });
  const nomesGrupos = (grupos.buscarGruposPorIds?.(Number(empresaId), grupoIds) || []).map(g => g.nome).join(', ') || 'grupos indisponíveis';
  if (!membros.length) {
    await registrar('warning', `⚠️ ${rotulo}: nenhum número com acesso à empresa nos grupos ${nomesGrupos}; mensagem não enviada.`);
    return { total: 0, enviados: 0, falhas: [] };
  }
  await registrar('info', `📣 ${rotulo}: enviando aos grupos ${nomesGrupos} (${membros.length} número(s)).`);
  const falhas = [];
  let enviados = 0;
  for (const m of membros) {
    try {
      const r = await enviarFn({ empresaId: Number(empresaId), numero: m.numero, texto, finalidadeEnvio }, deps);
      enviados++;
      if (!r?.registrado) await registrar('success', `✅ ${rotulo} → ${contato(m.numero)}`);
    } catch (err) {
      falhas.push({ nome: m.nome || null, erro: err.message });
      await registrar('error', `❌ ${rotulo} → ${contato(m.numero)}: ${err.message}`);
    }
  }
  await registrar(enviados === membros.length ? 'success' : enviados ? 'warning' : 'error',
    `${enviados === membros.length ? '✅' : enviados ? '⚠️' : '❌'} ${rotulo}: entregue a ${enviados} de ${membros.length} número(s).`);
  return { total: membros.length, enviados, falhas };
}

function segredoAutorizado(req) {
  const segredoEsperado = String(
    process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET
    || process.env.SVC_WHATSAPP_OTP_SECRET
    || ''
  ).trim();
  if (!segredoEsperado) return { ok: false, status: 503, error: 'Envio server-to-server nao configurado.' };

  const informado = Buffer.from(String(req.headers['x-servico-externo-secret'] || ''), 'utf8');
  const esperado = Buffer.from(segredoEsperado, 'utf8');
  const autenticado = informado.length === esperado.length && crypto.timingSafeEqual(informado, esperado);
  if (!autenticado) return { ok: false, status: 403, error: 'Nao autorizado.' };
  return { ok: true };
}

function registrarRotaServicoExterno(app) {
  app.post('/api/ia-command/whatsapp/enviar-servico-externo', async (req, res) => {
    const auth = segredoAutorizado(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const empresaId = Number(req.body?.empresaId || 0);
    const numero = String(req.body?.numero || '').trim();
    const texto = String(req.body?.texto || '').trim();
    if (!empresaId || !numero || !texto) {
      return res.status(400).json({ error: 'empresaId, numero e texto sao obrigatorios.' });
    }

    try {
      await enviarTextoServicoExterno({ empresaId, numero, texto, finalidadeEnvio: req.body?.finalidadeEnvio });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Grupos ativos da empresa, para outro app escolher os destinatários.
  app.get('/api/ia-command/whatsapp/grupos-servico-externo', (req, res) => {
    const auth = segredoAutorizado(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const empresaId = Number(req.query?.empresaId || 0);
    if (!empresaId) return res.status(400).json({ error: 'empresaId e obrigatorio.' });
    try {
      res.json(recipientGroups.listarGrupos(empresaId, { somenteAtivos: true })
        .map(g => ({ id: g.id, nome: g.nome, descricao: g.descricao || null, membros_count: g.membros_count })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/whatsapp/enviar-grupo-servico-externo', async (req, res) => {
    const auth = segredoAutorizado(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const empresaId = Number(req.body?.empresaId || 0);
    const grupoIds = Array.isArray(req.body?.grupoIds) ? req.body.grupoIds.map(String).filter(Boolean) : [];
    const texto = String(req.body?.texto || '').trim();
    if (!empresaId || !grupoIds.length || !texto) {
      return res.status(400).json({ error: 'empresaId, grupoIds e texto sao obrigatorios.' });
    }
    try {
      res.json({ ok: true, ...(await enviarGrupoServicoExterno({ empresaId, grupoIds, texto, finalidadeEnvio: req.body?.finalidadeEnvio, referencia: req.body?.referencia })) });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Passo de outro app que não chega a enviar (ex.: Jade em Simulação, sem
  // grupo escolhido) registrado no histórico do canal da empresa.
  app.post('/api/ia-command/whatsapp/registrar-servico-externo', async (req, res) => {
    const auth = segredoAutorizado(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const empresaId = Number(req.body?.empresaId || 0);
    const msg = String(req.body?.mensagem || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    const tipo = ['info', 'success', 'warning', 'error'].includes(req.body?.tipo) ? req.body.tipo : 'info';
    if (!empresaId || !msg) return res.status(400).json({ error: 'empresaId e mensagem sao obrigatorios.' });
    await registrarNoCanal(empresaId, tipo, msg);
    res.json({ ok: true });
  });
}

module.exports = function registrar(app, { io } = {}) {
  if (io) _io = io;
  return registrarRotaServicoExterno(app);
};
module.exports._test = {
  resolverCanalServicoExterno,
  enviarTextoServicoExterno,
  enviarGrupoServicoExterno,
  registrarNoCanal,
  primeiroCanalConectado,
  canaisGlobaisConectados,
  segredoAutorizado,
};
