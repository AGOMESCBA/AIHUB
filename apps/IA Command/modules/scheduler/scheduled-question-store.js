const crypto = require('crypto');
const { getDB } = require('../database');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function agora() {
  return new Date().toISOString();
}

function normalizarNumero(numero) {
  return String(numero || '').replace(/\D/g, '');
}

function parseJson(valor, fallback) {
  if (!valor) return fallback;
  try { return JSON.parse(valor); } catch (_) { return fallback; }
}

function jobFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    empresa_id: Number(row.empresa_id),
    ativo: row.ativo ? 1 : 0,
    retry_max: Number(row.retry_max || 0),
    retry_interval_min: Number(row.retry_interval_min || 0),
    schedule_json: parseJson(row.schedule_json, {}),
    destinatarios_count: Number(row.destinatarios_count || 0),
    runs_count: Number(row.runs_count || 0),
  };
}

function recipientFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    empresa_id: Number(row.empresa_id),
    ativo: row.ativo ? 1 : 0,
  };
}

function runFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    empresa_id: Number(row.empresa_id),
    attempt: Number(row.attempt || 1),
    duration_ms: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
  };
}

function listarJobs(empresaId) {
  return getDB().prepare(`
    SELECT j.*,
      (SELECT COUNT(*) FROM scheduled_question_recipients r WHERE r.job_id = j.id AND r.ativo = 1) AS destinatarios_count,
      (SELECT COUNT(*) FROM scheduled_question_runs ru WHERE ru.job_id = j.id) AS runs_count,
      (SELECT ru.status FROM scheduled_question_runs ru WHERE ru.job_id = j.id ORDER BY ru.criado_em DESC LIMIT 1) AS ultimo_status
    FROM scheduled_question_jobs j
    WHERE j.empresa_id = ? AND j.status <> 'excluido'
    ORDER BY
      CASE WHEN j.next_run_at IS NULL THEN 1 ELSE 0 END,
      j.next_run_at ASC,
      j.atualizado_em DESC
  `).all(Number(empresaId)).map(jobFromRow);
}

function listarJobsVencidos(limit = 10, nowIso = agora()) {
  return getDB().prepare(`
    SELECT j.*,
      (SELECT COUNT(*) FROM scheduled_question_recipients r WHERE r.job_id = j.id AND r.ativo = 1) AS destinatarios_count,
      (SELECT COUNT(*) FROM scheduled_question_runs ru WHERE ru.job_id = j.id) AS runs_count
    FROM scheduled_question_jobs j
    WHERE j.ativo = 1
      AND j.status = 'ativo'
      AND j.next_run_at IS NOT NULL
      AND j.next_run_at <= ?
      AND (j.lock_until IS NULL OR j.lock_until < ?)
    ORDER BY j.next_run_at ASC
    LIMIT ?
  `).all(nowIso, nowIso, Math.max(1, Math.min(50, Number(limit) || 10))).map(jobFromRow);
}

function bloquearJobVencido(empresaId, id, token, lockUntilIso, nowIso = agora()) {
  const db = getDB();
  const result = db.prepare(`
    UPDATE scheduled_question_jobs
    SET lock_until = ?,
        running_token = ?,
        atualizado_em = ?
    WHERE empresa_id = ?
      AND id = ?
      AND ativo = 1
      AND status = 'ativo'
      AND next_run_at IS NOT NULL
      AND next_run_at <= ?
      AND (lock_until IS NULL OR lock_until < ?)
  `).run(lockUntilIso, token, nowIso, Number(empresaId), id, nowIso, nowIso);
  return result.changes ? buscarJob(empresaId, id) : null;
}

function finalizarJobBloqueado(empresaId, id, token, campos = {}) {
  const db = getDB();
  const allowed = ['next_run_at', 'last_run_at', 'ativo', 'status'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (campos[key] === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(key === 'ativo' ? (campos[key] ? 1 : 0) : campos[key]);
  }
  sets.push('lock_until = NULL');
  sets.push('running_token = NULL');
  sets.push('atualizado_em = ?');
  values.push(agora(), Number(empresaId), id, token);
  const result = db.prepare(`
    UPDATE scheduled_question_jobs
    SET ${sets.join(', ')}
    WHERE empresa_id = ? AND id = ? AND running_token = ?
  `).run(...values);
  return result.changes ? buscarJob(empresaId, id) : null;
}

function buscarJob(empresaId, id) {
  const job = jobFromRow(getDB().prepare(`
    SELECT j.*,
      (SELECT COUNT(*) FROM scheduled_question_recipients r WHERE r.job_id = j.id AND r.ativo = 1) AS destinatarios_count,
      (SELECT COUNT(*) FROM scheduled_question_runs ru WHERE ru.job_id = j.id) AS runs_count
    FROM scheduled_question_jobs j
    WHERE j.empresa_id = ? AND j.id = ? AND j.status <> 'excluido'
  `).get(Number(empresaId), id));
  if (!job) return null;
  job.destinatarios = listarDestinatarios(empresaId, id);
  return job;
}

function listarDestinatarios(empresaId, jobId) {
  return getDB().prepare(`
    SELECT *
    FROM scheduled_question_recipients
    WHERE empresa_id = ? AND job_id = ? AND ativo = 1
    ORDER BY nome COLLATE NOCASE ASC
  `).all(Number(empresaId), jobId).map(recipientFromRow);
}

function listarRuns(empresaId, jobId, limit = 50) {
  return getDB().prepare(`
    SELECT *
    FROM scheduled_question_runs
    WHERE empresa_id = ? AND job_id = ?
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(Number(empresaId), jobId, Math.max(1, Math.min(200, Number(limit) || 50))).map(runFromRow);
}

function listarRunsGerais(empresaId, { jobId = null, limit = 300 } = {}) {
  const values = [Number(empresaId)];
  let whereJob = '';
  if (jobId) {
    whereJob = 'AND r.job_id = ?';
    values.push(String(jobId));
  }
  values.push(Math.max(1, Math.min(1000, Number(limit) || 300)));
  return getDB().prepare(`
    SELECT r.*,
      j.nome AS job_nome,
      j.modulo AS job_modulo,
      j.schedule_tipo AS job_schedule_tipo,
      j.timezone AS job_timezone,
      (SELECT COUNT(*) FROM scheduled_question_deliveries d WHERE d.run_id = r.id) AS entregas_total,
      (SELECT COUNT(*) FROM scheduled_question_deliveries d WHERE d.run_id = r.id AND d.status = 'sucesso') AS entregas_sucesso,
      (SELECT COUNT(*) FROM scheduled_question_deliveries d WHERE d.run_id = r.id AND d.status = 'erro') AS entregas_erro
    FROM scheduled_question_runs r
    JOIN scheduled_question_jobs j ON j.id = r.job_id AND j.empresa_id = r.empresa_id
    WHERE r.empresa_id = ?
      ${whereJob}
    ORDER BY r.criado_em DESC
    LIMIT ?
  `).all(...values).map(row => ({
    ...runFromRow(row),
    entregas_total: Number(row.entregas_total || 0),
    entregas_sucesso: Number(row.entregas_sucesso || 0),
    entregas_erro: Number(row.entregas_erro || 0),
  }));
}

function listarEntregas(empresaId, runId) {
  return getDB().prepare(`
    SELECT d.*
    FROM scheduled_question_deliveries d
    JOIN scheduled_question_runs r ON r.id = d.run_id
    WHERE d.run_id = ? AND r.empresa_id = ?
    ORDER BY d.criado_em ASC
  `).all(runId, Number(empresaId));
}

function criarRun(empresaId, job, { trigger_tipo = 'manual', usuario = 'sistema' } = {}) {
  const db = getDB();
  const id = uuid();
  const now = agora();
  db.prepare(`
    INSERT INTO scheduled_question_runs (
      id, job_id, empresa_id, channel_id, trigger_tipo, status, pergunta,
      started_at, attempt, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, 'executando', ?, ?, 1, ?, ?)
  `).run(
    id,
    job.id,
    Number(empresaId),
    String(job.channel_id || ''),
    String(trigger_tipo || 'manual'),
    String(job.pergunta || ''),
    now,
    now,
    now
  );
  return buscarRun(empresaId, id);
}

function buscarRun(empresaId, id) {
  return runFromRow(getDB().prepare(`
    SELECT *
    FROM scheduled_question_runs
    WHERE empresa_id = ? AND id = ?
  `).get(Number(empresaId), id));
}

function atualizarRun(empresaId, id, campos = {}) {
  const db = getDB();
  const atual = buscarRun(empresaId, id);
  if (!atual) return null;
  const allowed = ['status', 'finished_at', 'duration_ms', 'interpretation_log_id', 'resposta', 'erro'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (campos[key] === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(campos[key]);
  }
  sets.push('atualizado_em = ?');
  values.push(agora(), Number(empresaId), id);
  db.prepare(`UPDATE scheduled_question_runs SET ${sets.join(', ')} WHERE empresa_id = ? AND id = ?`).run(...values);
  return buscarRun(empresaId, id);
}

function criarDelivery(empresaId, runId, jobId, recipient) {
  const db = getDB();
  const id = uuid();
  const now = agora();
  db.prepare(`
    INSERT INTO scheduled_question_deliveries (
      id, run_id, job_id, recipient_id, numero_id, nome, numero, status, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)
  `).run(
    id,
    runId,
    jobId,
    recipient.id,
    recipient.numero_id,
    recipient.nome,
    recipient.numero,
    now,
    now
  );
  return id;
}

function atualizarDelivery(id, campos = {}) {
  const db = getDB();
  const allowed = ['status', 'sent_at', 'erro'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (campos[key] === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(campos[key]);
  }
  if (!sets.length) return;
  sets.push('atualizado_em = ?');
  values.push(agora(), id);
  db.prepare(`UPDATE scheduled_question_deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function listarNumerosAutorizados(empresaId) {
  return getDB().prepare(`
    SELECT id, nome, numero, observacoes, modulo_financeiro, modulo_compras,
           modulo_faturamento, modulo_comissao, erp_tipo, erp_id
    FROM whatsapp_allowed_numbers
    WHERE empresa_id = ? AND ativo = 1
    ORDER BY nome COLLATE NOCASE ASC, numero ASC
  `).all(Number(empresaId)).map(row => ({ ...row, numero: normalizarNumero(row.numero) }));
}

function buscarNumerosAutorizadosPorIds(empresaId, ids = []) {
  const lista = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!lista.length) return [];
  const placeholders = lista.map(() => '?').join(',');
  return getDB().prepare(`
    SELECT id, nome, numero
    FROM whatsapp_allowed_numbers
    WHERE empresa_id = ? AND ativo = 1 AND id IN (${placeholders})
    ORDER BY nome COLLATE NOCASE ASC
  `).all(Number(empresaId), ...lista).map(row => ({ ...row, numero: normalizarNumero(row.numero) }));
}

function payloadJob(dados, empresaId, usuario, existing = {}) {
  const now = agora();
  const scheduleJson = dados.schedule_json !== undefined ? dados.schedule_json : (dados.schedule || existing.schedule_json || {});
  return {
    empresa_id: Number(empresaId),
    channel_id: String(dados.channel_id ?? existing.channel_id ?? '').trim(),
    nome: String(dados.nome ?? existing.nome ?? '').trim(),
    pergunta: String(dados.pergunta ?? existing.pergunta ?? '').trim(),
    modulo: dados.modulo === undefined ? (existing.modulo || null) : (String(dados.modulo || '').trim() || null),
    escopo_empresa: String(dados.escopo_empresa ?? existing.escopo_empresa ?? 'empresa_atual').trim() || 'empresa_atual',
    schedule_tipo: String(dados.schedule_tipo ?? existing.schedule_tipo ?? 'manual').trim() || 'manual',
    schedule_json: JSON.stringify(scheduleJson || {}),
    timezone: String(dados.timezone ?? existing.timezone ?? 'America/Manaus').trim() || 'America/Manaus',
    ativo: dados.ativo === undefined ? (existing.ativo === undefined ? 1 : Number(existing.ativo) ? 1 : 0) : (dados.ativo ? 1 : 0),
    status: dados.status || existing.status || 'ativo',
    next_run_at: dados.next_run_at === undefined ? (existing.next_run_at || null) : (dados.next_run_at || null),
    retry_max: Math.max(0, Math.min(10, Number(dados.retry_max ?? existing.retry_max ?? 2) || 0)),
    retry_interval_min: Math.max(1, Math.min(1440, Number(dados.retry_interval_min ?? existing.retry_interval_min ?? 5) || 5)),
    atualizado_por: usuario || 'sistema',
    atualizado_em: now,
  };
}

function criarJob(empresaId, dados, destinatarios, usuario) {
  const db = getDB();
  const tx = db.transaction(() => {
    const id = uuid();
    const now = agora();
    const job = {
      id,
      ...payloadJob(dados, empresaId, usuario),
      criado_por: usuario || 'sistema',
      criado_em: now,
    };
    db.prepare(`
      INSERT INTO scheduled_question_jobs (
        id, empresa_id, channel_id, nome, pergunta, modulo, escopo_empresa,
        schedule_tipo, schedule_json, timezone, ativo, status, next_run_at,
        retry_max, retry_interval_min, criado_por, atualizado_por, criado_em, atualizado_em
      ) VALUES (
        @id, @empresa_id, @channel_id, @nome, @pergunta, @modulo, @escopo_empresa,
        @schedule_tipo, @schedule_json, @timezone, @ativo, @status, @next_run_at,
        @retry_max, @retry_interval_min, @criado_por, @atualizado_por, @criado_em, @atualizado_em
      )
    `).run(job);
    substituirDestinatariosTx(db, empresaId, id, destinatarios);
    return buscarJob(empresaId, id);
  });
  return tx();
}

function atualizarJob(empresaId, id, dados, destinatarios, usuario) {
  const db = getDB();
  const tx = db.transaction(() => {
    const existing = buscarJob(empresaId, id);
    if (!existing) return null;
    const job = payloadJob(dados, empresaId, usuario, existing);
    db.prepare(`
      UPDATE scheduled_question_jobs
      SET channel_id = @channel_id,
          nome = @nome,
          pergunta = @pergunta,
          modulo = @modulo,
          escopo_empresa = @escopo_empresa,
          schedule_tipo = @schedule_tipo,
          schedule_json = @schedule_json,
          timezone = @timezone,
          ativo = @ativo,
          status = @status,
          next_run_at = @next_run_at,
          retry_max = @retry_max,
          retry_interval_min = @retry_interval_min,
          atualizado_por = @atualizado_por,
          atualizado_em = @atualizado_em
      WHERE id = @id AND empresa_id = @empresa_id
    `).run({ ...job, id });
    if (Array.isArray(destinatarios)) substituirDestinatariosTx(db, empresaId, id, destinatarios);
    return buscarJob(empresaId, id);
  });
  return tx();
}

function substituirDestinatariosTx(db, empresaId, jobId, destinatarios = []) {
  const now = agora();
  db.prepare('UPDATE scheduled_question_recipients SET ativo = 0, atualizado_em = ? WHERE job_id = ? AND empresa_id = ?')
    .run(now, jobId, Number(empresaId));

  const upsert = db.prepare(`
    INSERT INTO scheduled_question_recipients (id, job_id, empresa_id, numero_id, nome, numero, ativo, criado_em, atualizado_em)
    VALUES (@id, @job_id, @empresa_id, @numero_id, @nome, @numero, 1, @criado_em, @atualizado_em)
    ON CONFLICT(job_id, numero_id) DO UPDATE SET
      nome = excluded.nome,
      numero = excluded.numero,
      ativo = 1,
      atualizado_em = excluded.atualizado_em
  `);

  for (const item of destinatarios) {
    upsert.run({
      id: uuid(),
      job_id: jobId,
      empresa_id: Number(empresaId),
      numero_id: String(item.id || item.numero_id),
      nome: String(item.nome || '').trim(),
      numero: normalizarNumero(item.numero),
      criado_em: now,
      atualizado_em: now,
    });
  }
}

function alterarStatus(empresaId, id, { ativo, status }, usuario) {
  const db = getDB();
  const current = buscarJob(empresaId, id);
  if (!current) return null;
  db.prepare(`
    UPDATE scheduled_question_jobs
    SET ativo = ?, status = ?, atualizado_por = ?, atualizado_em = ?
    WHERE empresa_id = ? AND id = ?
  `).run(
    ativo === undefined ? current.ativo : (ativo ? 1 : 0),
    status || current.status,
    usuario || 'sistema',
    agora(),
    Number(empresaId),
    id
  );
  return buscarJob(empresaId, id);
}

function excluirJob(empresaId, id, usuario) {
  const job = buscarJob(empresaId, id);
  if (!job) return false;
  alterarStatus(empresaId, id, { ativo: 0, status: 'excluido' }, usuario);
  return true;
}

module.exports = {
  listarJobs,
  listarJobsVencidos,
  bloquearJobVencido,
  finalizarJobBloqueado,
  buscarJob,
  listarDestinatarios,
  listarRuns,
  listarRunsGerais,
  listarEntregas,
  criarRun,
  buscarRun,
  atualizarRun,
  criarDelivery,
  atualizarDelivery,
  listarNumerosAutorizados,
  buscarNumerosAutorizadosPorIds,
  criarJob,
  atualizarJob,
  alterarStatus,
  excluirJob,
};
