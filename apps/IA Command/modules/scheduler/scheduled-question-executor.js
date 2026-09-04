const crypto = require('crypto');
const store = require('./scheduled-question-store');

const DEFAULT_INTERVAL_MS = 30000;
const DEFAULT_LOCK_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 10;

let timer = null;
let runningTick = false;
let intervalMs = DEFAULT_INTERVAL_MS;
let startedAt = null;
let lastTickAt = null;
let lastRunAt = null;
let lastError = null;
let totalTicks = 0;
let totalExecutions = 0;
let runner = null;
let specFeedbackNotifier = null;

function getRunner() {
  if (!runner) runner = require('./scheduled-question-runner');
  return runner;
}

function getSpecFeedbackNotifier() {
  if (!specFeedbackNotifier) specFeedbackNotifier = require('./spec-feedback-daily-notifier');
  return specFeedbackNotifier;
}

function token() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function iso(date) {
  return date.toISOString();
}

function parseTime(value) {
  const match = String(value || '08:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: 8, minute: 0 };
  return {
    hour: Math.max(0, Math.min(23, Number(match[1]) || 0)),
    minute: Math.max(0, Math.min(59, Number(match[2]) || 0)),
  };
}

function safeTimeZone(value) {
  const timeZone = String(value || 'America/Manaus').trim() || 'America/Manaus';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch (_) {
    return 'America/Manaus';
  }
}

function partsInZone(date, timeZone) {
  timeZone = safeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const item of formatter.formatToParts(date)) {
    if (item.type !== 'literal') parts[item.type] = item.value;
  }
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays[parts.weekday] ?? 0,
  };
}

function zoneOffsetMs(date, timeZone) {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

function zonedDateToUtc({ year, month, day, hour, minute }, timeZone) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  let offset = zoneOffsetMs(guess, timeZone);
  guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offset);
  const adjustedOffset = zoneOffsetMs(guess, timeZone);
  if (adjustedOffset !== offset) {
    guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - adjustedOffset);
  }
  return guess;
}

function addDaysParts(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextDaily(job, from) {
  const timeZone = safeTimeZone(job.timezone);
  const time = parseTime(job.schedule_json?.time);
  const now = partsInZone(from, timeZone);
  for (let add = 0; add <= 370; add++) {
    const day = addDaysParts(now, add);
    const candidate = zonedDateToUtc({ ...day, ...time }, timeZone);
    if (candidate.getTime() > from.getTime()) return iso(candidate);
  }
  return null;
}

function nextWeekly(job, from) {
  const timeZone = safeTimeZone(job.timezone);
  const time = parseTime(job.schedule_json?.time);
  const selected = (job.schedule_json?.weekdays || []).map(Number).filter(v => v >= 0 && v <= 6);
  const weekdays = selected.length ? selected : [partsInZone(from, timeZone).weekday];
  const now = partsInZone(from, timeZone);
  for (let add = 0; add <= 370; add++) {
    const day = addDaysParts(now, add);
    const noon = zonedDateToUtc({ ...day, hour: 12, minute: 0 }, timeZone);
    const weekday = partsInZone(noon, timeZone).weekday;
    if (!weekdays.includes(weekday)) continue;
    const candidate = zonedDateToUtc({ ...day, ...time }, timeZone);
    if (candidate.getTime() > from.getTime()) return iso(candidate);
  }
  return null;
}

function nextMonthly(job, from) {
  const timeZone = safeTimeZone(job.timezone);
  const time = parseTime(job.schedule_json?.time);
  const wantedDay = Math.max(1, Math.min(31, Number(job.schedule_json?.month_day || 1)));
  const now = partsInZone(from, timeZone);
  for (let add = 0; add <= 48; add++) {
    const monthIndex = now.month - 1 + add;
    const year = now.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = Math.min(wantedDay, lastDayOfMonth(year, month));
    const candidate = zonedDateToUtc({ year, month, day, ...time }, timeZone);
    if (candidate.getTime() > from.getTime()) return iso(candidate);
  }
  return null;
}

function calcularProximaExecucao(job, from = new Date()) {
  const tipo = String(job.schedule_tipo || 'manual').toLowerCase();
  if (tipo === 'daily') return nextDaily(job, from);
  if (tipo === 'weekly') return nextWeekly(job, from);
  if (tipo === 'monthly') return nextMonthly(job, from);
  return null;
}

function retryAt(job) {
  const minutes = Math.max(1, Math.min(1440, Number(job.retry_interval_min || 5) || 5));
  return iso(new Date(Date.now() + minutes * 60000));
}

async function processarJob(job) {
  const now = new Date();
  const lockToken = token();
  const locked = store.bloquearJobVencido(
    job.empresa_id,
    job.id,
    lockToken,
    iso(new Date(Date.now() + DEFAULT_LOCK_MS)),
    iso(now)
  );
  if (!locked) return null;

  const emRetry = Number(locked.retry_count || 0) > 0;

  try {
    const run = await getRunner().executarJob(locked.empresa_id, locked, {
      trigger_tipo: emRetry ? 'schedule_retry' : 'schedule',
      usuario: 'scheduler',
    });
    totalExecutions++;
    lastRunAt = new Date().toISOString();
    const next = calcularProximaExecucao(locked, new Date());
    const once = String(locked.schedule_tipo || '').toLowerCase() === 'once';
    store.finalizarJobBloqueado(locked.empresa_id, locked.id, lockToken, {
      last_run_at: new Date().toISOString(),
      next_run_at: once ? null : next,
      ativo: once ? 0 : 1,
      status: once ? 'pausado' : 'ativo',
      retry_count: 0,
      retry_recipient_ids: null,
    });
    return run;
  } catch (err) {
    lastError = { at: new Date().toISOString(), job_id: locked.id, message: err.message };
    const retryMax = Math.max(0, Number(locked.retry_max || 0));
    const retryCountAtual = Number(locked.retry_count || 0);
    const temDestinatariosFalhos = Array.isArray(err.recipientIdsFalhos) && err.recipientIdsFalhos.length > 0;

    if (!temDestinatariosFalhos) {
      // Erro "duro" fora do fluxo de envio (ex: canal desconectado, job sem destinatarios) —
      // mantem o retry indefinido por tempo fixo, como ja funcionava, sem consumir retry_max.
      store.finalizarJobBloqueado(locked.empresa_id, locked.id, lockToken, {
        next_run_at: retryAt(locked),
        status: 'ativo',
      });
      return null;
    }

    if (retryCountAtual >= retryMax) {
      // Excedeu as tentativas configuradas: registra o job para revisao manual e retoma o
      // schedule normal (nao fica tentando de novo indefinidamente por causa de 1 destinatario).
      const next = calcularProximaExecucao(locked, new Date());
      const once = String(locked.schedule_tipo || '').toLowerCase() === 'once';
      store.finalizarJobBloqueado(locked.empresa_id, locked.id, lockToken, {
        next_run_at: once ? null : next,
        ativo: once ? 0 : 1,
        status: once ? 'pausado' : 'ativo',
        retry_count: 0,
        retry_recipient_ids: null,
      });
      return null;
    }

    store.finalizarJobBloqueado(locked.empresa_id, locked.id, lockToken, {
      next_run_at: retryAt(locked),
      status: 'ativo',
      retry_count: retryCountAtual + 1,
      retry_recipient_ids: err.recipientIdsFalhos || null,
    });
    return null;
  }
}

async function tick() {
  if (runningTick) return { skipped: true };
  runningTick = true;
  totalTicks++;
  lastTickAt = new Date().toISOString();
  let processed = 0;
  try {
    const due = store.listarJobsVencidos(DEFAULT_LIMIT);
    for (const job of due) {
      await processarJob(job);
      processed++;
    }
    try {
      await getSpecFeedbackNotifier().tick();
    } catch (err) {
      lastError = { at: new Date().toISOString(), source: 'spec_feedback_notifier', message: err.message };
    }
    return { skipped: false, processed };
  } finally {
    runningTick = false;
  }
}

function scheduleNext() {
  if (!timer) return;
  timer = setTimeout(async () => {
    try { await tick(); } catch (err) { lastError = { at: new Date().toISOString(), message: err.message }; }
    scheduleNext();
  }, intervalMs);
  timer.unref?.();
}

function start(opts = {}) {
  intervalMs = Math.max(5000, Number(opts.intervalMs || intervalMs || DEFAULT_INTERVAL_MS));
  if (timer) return status();
  startedAt = new Date().toISOString();
  timer = setTimeout(async () => {
    try { await tick(); } catch (err) { lastError = { at: new Date().toISOString(), message: err.message }; }
    scheduleNext();
  }, 1000);
  timer.unref?.();
  return status();
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  return status();
}

function status() {
  return {
    running: !!timer,
    executing: runningTick,
    interval_ms: intervalMs,
    started_at: startedAt,
    last_tick_at: lastTickAt,
    last_run_at: lastRunAt,
    last_error: lastError,
    total_ticks: totalTicks,
    total_executions: totalExecutions,
    spec_feedback_notifier: getSpecFeedbackNotifier().status(),
  };
}

module.exports = {
  start,
  stop,
  status,
  tick,
  calcularProximaExecucao,
};
