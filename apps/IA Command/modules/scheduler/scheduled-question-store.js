const crypto = require('crypto');
const { getDB } = require('../database');
const usuariosDb = require('../../../../modules/usuarios/database');
const sistemasDb = require('../../../../modules/sistemas/database');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function agora() {
  return new Date().toISOString();
}

function normalizarNumero(numero) {
  return String(numero || '').replace(/\D/g, '');
}

function variantesNumeroUsuario(numero) {
  const base = normalizarNumero(numero);
  const out = new Set();
  if (base) out.add(base);
  if (base.startsWith('55') && base.length > 11) {
    out.add(base.slice(2));
    if (base.length === 13) out.add(base.slice(0, 4) + base.slice(5));
    if (base.length === 12) out.add(base.slice(0, 4) + '9' + base.slice(4));
  }
  if (!base.startsWith('55') && (base.length === 10 || base.length === 11)) {
    out.add(`55${base}`);
    if (base.length === 11) out.add(base.slice(0, 2) + base.slice(3));
    if (base.length === 10) out.add(base.slice(0, 2) + '9' + base.slice(2));
  }
  return out;
}

function usuariosPorNumero() {
  const mapa = new Map();
  for (const usuario of usuariosDb.listar()) {
    for (const numero of variantesNumeroUsuario(usuario.celular)) {
      if (!mapa.has(numero)) mapa.set(numero, []);
      mapa.get(numero).push(usuario);
    }
  }
  return mapa;
}

function usuarioTemEmpresa(usuario, empresaId) {
  if (!usuario?.ativo) return false;
  if (usuario.role === 'admin' || usuario.empresas === 'all') return true;
  return Array.isArray(usuario.empresas) && usuario.empresas.map(Number).includes(Number(empresaId));
}

function numeroElegivelParaEmpresa(row, empresaId, mapaUsuarios = usuariosPorNumero()) {
  const usuarios = [];
  for (const numero of variantesNumeroUsuario(row.numero)) {
    for (const usuario of mapaUsuarios.get(numero) || []) usuarios.push(usuario);
  }
  if (!usuarios.length) return true;
  const vistos = new Set();
  return usuarios
    .filter(usuario => usuario?.id && !vistos.has(usuario.id) && (vistos.add(usuario.id), true))
    .some(usuario =>
      usuarioTemEmpresa(usuario, empresaId) &&
      sistemasDb.hasUserSystem(usuario.id, empresaId, 'ia-command')
    );
}

function filtrarNumerosElegiveis(rows, empresaId) {
  const mapa = usuariosPorNumero();
  return rows.filter(row => numeroElegivelParaEmpresa(row, Number(empresaId), mapa));
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
  const status = row.status === 'sucesso' && row.interpretation_resultado_tipo === 'erro'
    ? 'erro'
    : row.status;
  const execucaoModo = row.execucao_modo
    || (row.job_sql_fixo || row.interpretation_origem === 'agendamento_sql_fixo' || row.interpretation_pipeline_origem === 'agendamento_sql_fixo'
      ? 'sql_fixo'
      : 'pergunta_ia');
  return {
    ...row,
    status,
    execucao_modo: execucaoModo,
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
      (SELECT CASE WHEN ru.status = 'sucesso' AND i.resultado_tipo = 'erro' THEN 'erro' ELSE ru.status END
         FROM scheduled_question_runs ru
         LEFT JOIN interpretation_log i ON i.id = ru.interpretation_log_id AND i.empresa_id = ru.empresa_id
        WHERE ru.job_id = j.id
        ORDER BY ru.criado_em DESC LIMIT 1) AS ultimo_status
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
  const rows = getDB().prepare(`
    SELECT r.*
    FROM scheduled_question_recipients r
    JOIN whatsapp_allowed_numbers n
      ON n.id = r.numero_id
     AND n.empresa_id = r.empresa_id
     AND n.ativo = 1
    WHERE r.empresa_id = ? AND r.job_id = ? AND r.ativo = 1
    ORDER BY nome COLLATE NOCASE ASC
  `).all(Number(empresaId), jobId).map(recipientFromRow);
  return filtrarNumerosElegiveis(rows, empresaId);
}

function listarRuns(empresaId, jobId, limit = 50) {
  return getDB().prepare(`
    SELECT r.*,
      j.sql_fixo AS job_sql_fixo,
      i.origem AS interpretation_origem,
      i.pipeline_origem AS interpretation_pipeline_origem,
      i.resultado_tipo AS interpretation_resultado_tipo,
      i.rows_count AS interpretation_rows_count,
      i.sql_canonico_original AS interpretation_sql_canonico_original,
      i.sql_auditoria_json AS interpretation_sql_auditoria_json,
      i.sql_gerado AS interpretation_sql_gerado,
      i.sql_final_executado AS interpretation_sql_final_executado,
      i.sql_validacao_erro AS interpretation_sql_validacao_erro,
      i.agente_url AS interpretation_agente_url
    FROM scheduled_question_runs r
    LEFT JOIN scheduled_question_jobs j ON j.id = r.job_id AND j.empresa_id = r.empresa_id
    LEFT JOIN interpretation_log i ON i.id = r.interpretation_log_id AND i.empresa_id = r.empresa_id
    WHERE r.empresa_id = ? AND r.job_id = ?
    ORDER BY r.criado_em DESC
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
      j.sql_fixo AS job_sql_fixo,
      j.schedule_tipo AS job_schedule_tipo,
      j.timezone AS job_timezone,
      i.origem AS interpretation_origem,
      i.pipeline_origem AS interpretation_pipeline_origem,
      i.resultado_tipo AS interpretation_resultado_tipo,
      i.rows_count AS interpretation_rows_count,
      i.sql_canonico_original AS interpretation_sql_canonico_original,
      i.sql_auditoria_json AS interpretation_sql_auditoria_json,
      i.sql_gerado AS interpretation_sql_gerado,
      i.sql_final_executado AS interpretation_sql_final_executado,
      i.sql_validacao_erro AS interpretation_sql_validacao_erro,
      i.agente_url AS interpretation_agente_url,
      (SELECT COUNT(*) FROM scheduled_question_deliveries d WHERE d.run_id = r.id) AS entregas_total,
      (SELECT COUNT(*) FROM scheduled_question_deliveries d WHERE d.run_id = r.id AND d.status = 'sucesso') AS entregas_sucesso,
      (SELECT COUNT(*) FROM scheduled_question_deliveries d WHERE d.run_id = r.id AND d.status = 'erro') AS entregas_erro
    FROM scheduled_question_runs r
    JOIN scheduled_question_jobs j ON j.id = r.job_id AND j.empresa_id = r.empresa_id
    LEFT JOIN interpretation_log i ON i.id = r.interpretation_log_id AND i.empresa_id = r.empresa_id
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

function excluirRunsPorIds(empresaId, ids = []) {
  const lista = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 200);
  if (!lista.length) return 0;
  const db = getDB();
  const placeholders = lista.map(() => '?').join(',');
  const tx = db.transaction(() => {
    const runs = db.prepare(`
      SELECT id
      FROM scheduled_question_runs
      WHERE empresa_id = ? AND id IN (${placeholders})
    `).all(Number(empresaId), ...lista).map(row => String(row.id));
    if (!runs.length) return 0;
    const runPlaceholders = runs.map(() => '?').join(',');
    db.prepare(`DELETE FROM scheduled_question_deliveries WHERE run_id IN (${runPlaceholders})`).run(...runs);
    const info = db.prepare(`
      DELETE FROM scheduled_question_runs
      WHERE empresa_id = ? AND id IN (${runPlaceholders})
    `).run(Number(empresaId), ...runs);
    return info.changes || 0;
  });
  return tx();
}

function limparRuns(empresaId, { inicio = null, fim = null, jobId = null } = {}) {
  const db = getDB();
  const wheres = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (jobId) {
    wheres.push('job_id = ?');
    params.push(String(jobId));
  }
  if (inicio) {
    wheres.push('criado_em >= ?');
    params.push(String(inicio));
  }
  if (fim) {
    wheres.push('criado_em <= ?');
    params.push(String(fim));
  }
  const where = wheres.join(' AND ');
  const tx = db.transaction(() => {
    const runs = db.prepare(`SELECT id FROM scheduled_question_runs WHERE ${where}`)
      .all(...params)
      .map(row => String(row.id));
    if (!runs.length) return 0;
    const placeholders = runs.map(() => '?').join(',');
    db.prepare(`DELETE FROM scheduled_question_deliveries WHERE run_id IN (${placeholders})`).run(...runs);
    const info = db.prepare(`DELETE FROM scheduled_question_runs WHERE ${where}`).run(...params);
    return info.changes || 0;
  });
  return tx();
}

function criarRun(empresaId, job, { trigger_tipo = 'manual', usuario = 'sistema', execucao_modo = null } = {}) {
  const db = getDB();
  const id = uuid();
  const now = agora();
  db.prepare(`
    INSERT INTO scheduled_question_runs (
      id, job_id, empresa_id, channel_id, trigger_tipo, status, pergunta,
      execucao_modo, started_at, attempt, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, 'executando', ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    job.id,
    Number(empresaId),
    String(job.channel_id || ''),
    String(trigger_tipo || 'manual'),
    String(job.pergunta || ''),
    execucao_modo || (job.sql_fixo ? 'sql_fixo' : 'pergunta_ia'),
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
  const rows = getDB().prepare(`
    SELECT id, nome, numero, observacoes, modulo_financeiro, modulo_compras,
           modulo_faturamento, modulo_comissao, erp_tipo, erp_id
    FROM whatsapp_allowed_numbers
    WHERE empresa_id = ? AND ativo = 1
    ORDER BY nome COLLATE NOCASE ASC, numero ASC
  `).all(Number(empresaId)).map(row => ({ ...row, numero: normalizarNumero(row.numero) }));
  return filtrarNumerosElegiveis(rows, empresaId);
}

function buscarNumerosAutorizadosPorIds(empresaId, ids = []) {
  const lista = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!lista.length) return [];
  const placeholders = lista.map(() => '?').join(',');
  const rows = getDB().prepare(`
    SELECT id, nome, numero
    FROM whatsapp_allowed_numbers
    WHERE empresa_id = ? AND ativo = 1 AND id IN (${placeholders})
    ORDER BY nome COLLATE NOCASE ASC
  `).all(Number(empresaId), ...lista).map(row => ({ ...row, numero: normalizarNumero(row.numero) }));
  return filtrarNumerosElegiveis(rows, empresaId);
}

function payloadJob(dados, empresaId, usuario, existing = {}) {
  const now = agora();
  const scheduleJson = dados.schedule_json !== undefined ? dados.schedule_json : (dados.schedule || existing.schedule_json || {});
  return {
    empresa_id: Number(empresaId),
    channel_id: String(dados.channel_id ?? existing.channel_id ?? '').trim(),
    nome: String(dados.nome ?? existing.nome ?? '').trim(),
    pergunta: String(dados.pergunta ?? existing.pergunta ?? '').trim(),
    sql_fixo: String(dados.sql_fixo ?? existing.sql_fixo ?? '').trim() || null,
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
        id, empresa_id, channel_id, nome, pergunta, sql_fixo, modulo, escopo_empresa,
        schedule_tipo, schedule_json, timezone, ativo, status, next_run_at,
        retry_max, retry_interval_min, criado_por, atualizado_por, criado_em, atualizado_em
      ) VALUES (
        @id, @empresa_id, @channel_id, @nome, @pergunta, @sql_fixo, @modulo, @escopo_empresa,
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
          sql_fixo = @sql_fixo,
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
  const db = getDB();
  const job = buscarJob(empresaId, id);
  if (!job) return null;
  const tx = db.transaction(() => {
    db.prepare(`
      DELETE FROM scheduled_question_deliveries
      WHERE job_id = ?
        AND run_id IN (SELECT id FROM scheduled_question_runs WHERE empresa_id = ? AND job_id = ?)
    `).run(id, Number(empresaId), id);
    const runsInfo = db.prepare(`
      DELETE FROM scheduled_question_runs
      WHERE empresa_id = ? AND job_id = ?
    `).run(Number(empresaId), id);
    db.prepare(`
      UPDATE scheduled_question_recipients
      SET ativo = 0, atualizado_em = ?
      WHERE empresa_id = ? AND job_id = ?
    `).run(agora(), Number(empresaId), id);
    db.prepare(`
      UPDATE scheduled_question_jobs
      SET ativo = 0,
          status = 'excluido',
          lock_until = NULL,
          running_token = NULL,
          atualizado_por = ?,
          atualizado_em = ?
      WHERE empresa_id = ? AND id = ?
    `).run(usuario || 'sistema', agora(), Number(empresaId), id);
    return { ok: true, historico_removido: runsInfo.changes || 0 };
  });
  return tx();
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
  excluirRunsPorIds,
  limparRuns,
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
