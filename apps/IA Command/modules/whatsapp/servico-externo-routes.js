// Envio de WhatsApp server-to-server para outros apps do IAHub (ex.: IA
// Service, login externo por telefone/OTP). Rota publica para servidor, sem
// sessao de usuario, protegida por segredo compartilhado.

const crypto = require('crypto');
const http = require('http');
const channels = require('./channel-store');

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
        res.on('data', d => { resposta += d; });
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

async function enviarTextoServicoExterno({ empresaId, numero, texto }, deps = {}) {
  const workerJsonFn = deps.workerJsonFn || workerJson;
  const { canal, svc, workerPort, totalCanais } = await resolverCanalServicoExterno(empresaId, deps);
  if (!canal) throw new Error('Nenhum canal WhatsApp vinculado a esta empresa.');
  if (workerPort) {
    await workerJsonFn(workerPort, '/send-direct-message', { empresaId, numero, texto }, 30000);
    return { canalId: canal.id };
  }
  if (!svc) {
    throw new Error(totalCanais > 1
      ? 'Nenhum dos canais WhatsApp vinculados a esta empresa esta conectado.'
      : 'WhatsApp nao esta conectado para o canal vinculado a esta empresa.');
  }
  await svc.sendMessage(numero, texto);
  return { canalId: canal.id };
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
      await enviarTextoServicoExterno({ empresaId, numero, texto });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = registrarRotaServicoExterno;
module.exports._test = {
  resolverCanalServicoExterno,
  enviarTextoServicoExterno,
  primeiroCanalConectado,
  canaisGlobaisConectados,
  segredoAutorizado,
};
