'use strict';

const http = require('http');
const specFeedbackStore = require('../ai/spec-feedback-store');
const whatsappManager = require('../whatsapp/service-manager');
const channels = require('../whatsapp/channel-store');
const usuariosDb = require('../../../../modules/usuarios/database');
const empresasDb = require('../../../../modules/empresas/database');

const DEFAULT_TIMEZONE = 'America/Manaus';
const DEFAULT_NOTIFY_TIME = '18:00';
const DEFAULT_ADMIN_NUMBER = '5565999875116';

let running = false;
let lastTickDateKey = null;
let lastResult = null;

function normalizarNumero(numero) {
  return String(numero || '').replace(/\D/g, '');
}

function safeTimeZone(value) {
  const timeZone = String(value || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch (_) {
    return DEFAULT_TIMEZONE;
  }
}

function partsInZone(date, timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const item of formatter.formatToParts(date)) {
    if (item.type !== 'literal') parts[item.type] = item.value;
  }
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeKey: `${parts.hour}:${parts.minute}`,
  };
}

function deveRodarAgora(now = new Date()) {
  const p = partsInZone(now, DEFAULT_TIMEZONE);
  if (p.timeKey < DEFAULT_NOTIFY_TIME) return { ok: false, dateKey: p.dateKey };
  if (lastTickDateKey === p.dateKey) return { ok: false, dateKey: p.dateKey };
  return { ok: true, dateKey: p.dateKey };
}

function numeroAdministrador() {
  const usuarios = usuariosDb.listar();
  const alessandro = usuarios.find(u =>
    u?.ativo !== false &&
    /alessandro/i.test(String(`${u.nome || ''} ${u.usuario || ''} ${u.email || ''}`))
  );
  return normalizarNumero(alessandro?.celular) || DEFAULT_ADMIN_NUMBER;
}

function nomeEmpresa(empresaId) {
  const empresa = empresasDb.buscarPorId(Number(empresaId));
  return empresa?.razao_social || empresa?.nome || `Empresa #${empresaId}`;
}

function montarMensagem({ empresaId, total }) {
  const plural = Number(total) === 1 ? 'proposta de correção confirmada' : 'propostas de correção confirmadas';
  return [
    '*IA Command - Feedback Técnico da IA*',
    '',
    `Existem *${total}* ${plural} pelo usuário aguardando validação administrativa.`,
    `Empresa: ${nomeEmpresa(empresaId)}`,
    '',
    'Acesse o IA Command e abra: Conhecimento da IA > Feedback Técnico da IA.',
  ].join('\n');
}

function postWorker(workerPort, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port: workerPort,
      path: '/send-message',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw || '{}');
          if (res.statusCode >= 400) return reject(new Error(parsed.erro || `HTTP ${res.statusCode}`));
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout ao enviar aviso diario de feedback tecnico.')); });
    req.write(body);
    req.end();
  });
}

async function enviarMensagem(empresaId, numero, mensagem) {
  const canal = channels.getDefaultForEmpresa(empresaId);
  if (!canal) throw new Error(`Empresa ${empresaId} sem canal WhatsApp padrao.`);

  if (canal.is_windows_service && canal.worker_port) {
    await postWorker(canal.worker_port, {
      empresaId,
      numero,
      resposta: mensagem,
      ok: true,
      jobNome: 'Feedback Técnico da IA',
    });
    return canal.id;
  }

  const svc = whatsappManager.get(canal.id);
  if (!svc || svc.getStatus() !== 'connected') {
    throw new Error(`Canal WhatsApp ${canal.nome || canal.id} nao esta conectado.`);
  }
  await svc.sendScheduledQuestionDelivery({
    empresaId,
    numero,
    resposta: mensagem,
    ok: true,
  });
  return canal.id;
}

async function tick(now = new Date()) {
  const gate = deveRodarAgora(now);
  if (!gate.ok || running) return { skipped: true, dateKey: gate.dateKey };

  running = true;
  const resultado = { skipped: false, dateKey: gate.dateKey, enviados: 0, semDados: 0, erros: [] };
  try {
    const numero = numeroAdministrador();
    const pendencias = specFeedbackStore.listarEmpresasComPendencias();
    if (!pendencias.length) {
      resultado.semDados = 1;
      lastTickDateKey = gate.dateKey;
      lastResult = resultado;
      return resultado;
    }

    for (const item of pendencias) {
      if (specFeedbackStore.avisoJaEnviado(item.empresa_id, gate.dateKey)) continue;
      try {
        const channelId = await enviarMensagem(item.empresa_id, numero, montarMensagem({
          empresaId: item.empresa_id,
          total: item.total,
        }));
        specFeedbackStore.registrarAvisoEnviado({
          empresaId: item.empresa_id,
          dataRef: gate.dateKey,
          numeroWa: numero,
          totalPendencias: item.total,
          channelId,
        });
        resultado.enviados++;
      } catch (err) {
        resultado.erros.push({ empresa_id: item.empresa_id, erro: err.message });
      }
    }

    lastTickDateKey = gate.dateKey;
    lastResult = resultado;
    return resultado;
  } finally {
    running = false;
  }
}

function status() {
  return {
    running,
    timezone: DEFAULT_TIMEZONE,
    notify_time: DEFAULT_NOTIFY_TIME,
    last_tick_date_key: lastTickDateKey,
    last_result: lastResult,
  };
}

module.exports = {
  tick,
  status,
  _test: {
    partsInZone,
    deveRodarAgora,
    montarMensagem,
    numeroAdministrador,
  },
};
