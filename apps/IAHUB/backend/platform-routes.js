const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('./platform-schema');
const { importarNumerosJ2A } = require('./platform-import-ia-command');

const DB_PATH = path.join(__dirname, '..', 'data', 'iahub-platform.db');
const PREFIX = 'iahub-aes-gcm:';
const PROVIDERS = ['groq', 'openai', 'gemini', 'deepseek', 'claude'];

let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    ensurePlatformSchema(db);
  }
  return db;
}

function key() {
  return crypto.createHash('sha256')
    .update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key')
    .digest();
}

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(value) {
  if (!value) return '';
  if (!String(value).startsWith(PREFIX)) return String(value);
  const raw = Buffer.from(String(value).slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function empresaId(req) {
  const requested = req.params.empresaId || req.query.empresaId || req.body?.empresaId;
  if (req.session?.role === 'admin' && requested) return Number(requested);
  return Number(req.session?.empresa_id || requested || 0);
}
function requireEmpresa(req, res, next) {
  if (empresaId(req)) return next();
  res.status(400).json({ error: 'Empresa nao definida.' });
}
function hasSecret(row, col) { return !!(row && row[col]); }
function secretValue(row, col, reveal) {
  if (!reveal) return { configurado: hasSecret(row, col), valor: hasSecret(row, col) ? '***' : null };
  return hasSecret(row, col) ? decrypt(row[col]) : '';
}
function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}
function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}
// Mesma regra de slug já usada em apps/IA Service/backend/repositories/
// ai-config-repository.js:_normalizarApelido — minúsculas, só [a-z0-9-],
// sem hífen duplicado/nas pontas. Duplicada aqui de propósito: a Platform
// nunca importa módulos do IA Service em runtime (bancos fisicamente
// separados, regra do projeto).
function normalizarApelido(valor) {
  const limpo = String(valor || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return limpo || null;
}
function mapAi(row, reveal = false) {
  if (!row) return {
    empresaId: null,
    provider: 'groq',
    provedorPrimario: 'groq',
    fallbackOrdem: 'groq,deepseek,gemini,claude,openai',
    confiancaMinima: 0.6,
    whisperModel: 'whisper-large-v3',
    historicoTurnos: 5,
    modelos: {
      groq: 'openai/gpt-oss-20b',
      openai: 'gpt-4o-mini',
      gemini: 'gemini-3.5-flash',
      deepseek: 'deepseek-chat',
      claude: 'claude-haiku-4-5-20251001',
    },
    loginExternoApelido: null,
    secrets: {},
    configurado: false,
  };
  return {
    id: row.id,
    empresaId: row.empresa_id,
    provider: row.provider || 'groq',
    provedorPrimario: row.provedor_primario || row.provider || 'groq',
    fallbackOrdem: row.fallback_ordem || 'groq,deepseek,gemini,claude,openai',
    confiancaMinima: row.confianca_minima ?? 0.6,
    whisperModel: row.whisper_model || 'whisper-large-v3',
    historicoTurnos: row.historico_turnos ?? 5,
    modelos: {
      groq: row.groq_modelo || 'openai/gpt-oss-20b',
      openai: row.openai_modelo || 'gpt-4o-mini',
      gemini: row.gemini_modelo || 'gemini-3.5-flash',
      deepseek: row.deepseek_modelo || 'deepseek-chat',
      claude: row.claude_modelo || 'claude-haiku-4-5-20251001',
    },
    secrets: {
      groq_api_key: secretValue(row, 'groq_api_key_enc', reveal),
      openai_api_key: secretValue(row, 'openai_api_key_enc', reveal),
      gemini_api_key: secretValue(row, 'gemini_api_key_enc', reveal),
      deepseek_api_key: secretValue(row, 'deepseek_api_key_enc', reveal),
      claude_api_key: secretValue(row, 'claude_api_key_enc', reveal),
    },
    loginExternoApelido: row.login_externo_apelido || null,
    configurado: true,
  };
}
function getAiRow(eid) {
  return getDB().prepare('SELECT * FROM platform_ai_configs WHERE empresa_id = ?').get(Number(eid));
}
function getAgentRow(eid) {
  return getDB().prepare('SELECT * FROM platform_agent_configs WHERE empresa_id = ?').get(Number(eid));
}

module.exports = function registrarPlatformRoutes(app, { requireAuth, requireAdmin }) {
  app.get('/api/iahub/platform/ai-config', requireAuth, requireEmpresa, (req, res) => {
    res.json(mapAi(getAiRow(empresaId(req))));
  });

  app.post('/api/iahub/platform/ai-config', requireAuth, requireAdmin, requireEmpresa, (req, res) => {
    const eid = empresaId(req);
    const atual = getAiRow(eid);
    const body = req.body || {};

    let apelido = atual?.login_externo_apelido ?? null;
    if (body.loginExternoApelido !== undefined) {
      apelido = normalizarApelido(body.loginExternoApelido);
      if (apelido) {
        const emUso = getDB().prepare(`
          SELECT empresa_id FROM platform_ai_configs WHERE login_externo_apelido = ? AND empresa_id != ?
        `).get(apelido, eid);
        if (emUso) return res.status(409).json({ error: `O apelido "${apelido}" já está em uso por outra empresa.` });
      }
    }

    const data = {
      id: atual?.id || uuid(),
      provider: body.provider || body.provedorPrimario || atual?.provider || 'groq',
      modelo: body.modelo || atual?.modelo || body.groqModelo || 'openai/gpt-oss-20b',
      provedor_primario: body.provedorPrimario || body.provedor_primario || atual?.provedor_primario || 'groq',
      fallback_ordem: body.fallbackOrdem || body.fallback_ordem || atual?.fallback_ordem || 'groq,deepseek,gemini,claude,openai',
      confianca_minima: body.confiancaMinima ?? body.confianca_minima ?? atual?.confianca_minima ?? 0.6,
      whisper_model: body.whisperModel || body.whisper_model || atual?.whisper_model || 'whisper-large-v3',
      historico_turnos: body.historicoTurnos ?? body.historico_turnos ?? atual?.historico_turnos ?? 5,
      groq_modelo: body.groqModelo || body.groq_modelo || atual?.groq_modelo || 'openai/gpt-oss-20b',
      openai_modelo: body.openaiModelo || body.openai_modelo || atual?.openai_modelo || 'gpt-4o-mini',
      gemini_modelo: body.geminiModelo || body.gemini_modelo || atual?.gemini_modelo || 'gemini-3.5-flash',
      deepseek_modelo: body.deepseekModelo || body.deepseek_modelo || atual?.deepseek_modelo || 'deepseek-chat',
      claude_modelo: body.claudeModelo || body.claude_modelo || atual?.claude_modelo || 'claude-haiku-4-5-20251001',
      groq_api_key_enc: body.groq_api_key ? encrypt(body.groq_api_key) : atual?.groq_api_key_enc || null,
      openai_api_key_enc: body.openai_api_key ? encrypt(body.openai_api_key) : atual?.openai_api_key_enc || null,
      gemini_api_key_enc: body.gemini_api_key ? encrypt(body.gemini_api_key) : atual?.gemini_api_key_enc || null,
      deepseek_api_key_enc: body.deepseek_api_key ? encrypt(body.deepseek_api_key) : atual?.deepseek_api_key_enc || null,
      claude_api_key_enc: body.claude_api_key ? encrypt(body.claude_api_key) : atual?.claude_api_key_enc || null,
      atualizado_em: now(),
    };
    if (atual) {
      getDB().prepare(`
        UPDATE platform_ai_configs
           SET provider = ?, modelo = ?, provedor_primario = ?, fallback_ordem = ?, confianca_minima = ?,
               whisper_model = ?, historico_turnos = ?, groq_api_key_enc = ?, openai_api_key_enc = ?,
               gemini_api_key_enc = ?, deepseek_api_key_enc = ?, claude_api_key_enc = ?, groq_modelo = ?,
               openai_modelo = ?, gemini_modelo = ?, deepseek_modelo = ?, claude_modelo = ?,
               login_externo_apelido = ?, atualizado_em = ?
         WHERE empresa_id = ?
      `).run(data.provider, data.modelo, data.provedor_primario, data.fallback_ordem, data.confianca_minima,
        data.whisper_model, data.historico_turnos, data.groq_api_key_enc, data.openai_api_key_enc,
        data.gemini_api_key_enc, data.deepseek_api_key_enc, data.claude_api_key_enc, data.groq_modelo,
        data.openai_modelo, data.gemini_modelo, data.deepseek_modelo, data.claude_modelo, apelido, data.atualizado_em, eid);
    } else {
      getDB().prepare(`
        INSERT INTO platform_ai_configs (
          id, empresa_id, provider, modelo, provedor_primario, fallback_ordem, confianca_minima,
          whisper_model, historico_turnos, groq_api_key_enc, openai_api_key_enc, gemini_api_key_enc,
          deepseek_api_key_enc, claude_api_key_enc, groq_modelo, openai_modelo, gemini_modelo,
          deepseek_modelo, claude_modelo, login_externo_apelido, ativo, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(data.id, eid, data.provider, data.modelo, data.provedor_primario, data.fallback_ordem, data.confianca_minima,
        data.whisper_model, data.historico_turnos, data.groq_api_key_enc, data.openai_api_key_enc, data.gemini_api_key_enc,
        data.deepseek_api_key_enc, data.claude_api_key_enc, data.groq_modelo, data.openai_modelo, data.gemini_modelo,
        data.deepseek_modelo, data.claude_modelo, apelido, data.atualizado_em, data.atualizado_em);
    }
    res.json(mapAi(getAiRow(eid)));
  });

  app.post('/api/iahub/platform/ai-config/test', requireAuth, requireAdmin, requireEmpresa, async (req, res) => {
    const provedor = PROVIDERS.includes(req.body?.provedor) ? req.body.provedor : 'groq';
    const row = getAiRow(empresaId(req));
    const field = `${provedor}_api_key_enc`;
    const apiKey = String(req.body?.api_key || '').trim() || decrypt(row?.[field]);
    if (!apiKey) return res.status(400).json({ ok: false, erro: 'Informe uma chave ou salve uma chave para este provedor.' });
    try {
      const msg = 'Qual o faturamento deste mes?';
      let result;
      if (provedor === 'gemini') result = await require('../../IA Command/modules/ai/providers/gemini').classificarIntencao(msg, apiKey, [], [], null, row?.gemini_modelo);
      else if (provedor === 'deepseek') result = await require('../../IA Command/modules/ai/providers/deepseek').classificarIntencao(msg, apiKey);
      else if (provedor === 'claude') result = await require('../../IA Command/modules/ai/providers/claude').classificarIntencao(msg, apiKey, [], [], null, row?.claude_modelo);
      else if (provedor === 'openai') result = await require('../../IA Command/modules/ai/providers/openai').classificarIntencao(msg, apiKey);
      else result = await require('../../IA Command/modules/ai/providers/groq').classificarIntencao(msg, apiKey);
      res.json({ ok: true, intencao: result?.intencao || null, confianca: result?.confianca ?? null });
    } catch (err) {
      res.status(500).json({ ok: false, erro: err.message || 'Falha ao testar provedor.' });
    }
  });

  app.get('/api/iahub/platform/agent-config', requireAuth, requireEmpresa, (req, res) => {
    const row = getAgentRow(empresaId(req));
    res.json(row ? {
      id: row.id,
      empresaId: row.empresa_id,
      agenteLocalUrl: row.agente_local_url || '',
      agenteLocalAtivo: !!row.agente_local_ativo,
      agenteLocalTokenConfigurado: !!row.agente_local_token_enc,
      agenteLocalCryptoAtivo: !!row.agente_local_crypto_ativo,
      agenteLocalCryptoKeyConfigurada: !!row.agente_local_crypto_key_enc,
    } : {});
  });

  app.get('/api/iahub/platform/whatsapp-identities', requireAuth, requireEmpresa, (req, res) => {
    const eid = empresaId(req);
    const rows = getDB().prepare('SELECT * FROM platform_whatsapp_identities WHERE empresa_id = ? ORDER BY nome COLLATE NOCASE ASC').all(eid);
    const includeRoles = req.query.includeRoles === '1' || req.query.includeRoles === 'true';
    res.json(rows.map(row => {
      const item = {
        id: row.id,
        empresaId: row.empresa_id,
        nome: row.nome,
        numero: row.numero,
        numeroNormalizado: row.numero_normalizado,
        observacoes: row.observacoes || '',
        ativo: !!row.ativo,
        origemSistema: row.origem_sistema || '',
        criadoEm: row.criado_em || null,
        atualizadoEm: row.atualizado_em || null,
        metadata: parseJson(row.metadata_json, {}),
      };
      if (includeRoles) {
        item.roles = getDB().prepare('SELECT * FROM platform_identity_roles WHERE empresa_id = ? AND identity_id = ? ORDER BY sistema, modulo, papel').all(eid, row.id).map(r => ({
          id: r.id,
          sistema: r.sistema,
          modulo: r.modulo,
          papel: r.papel,
          codigoIdentidade: r.codigo_identidade,
          liberado: !!r.liberado,
          metadata: parseJson(r.metadata_json, {}),
        }));
      }
      return item;
    }));
  });

  app.post('/api/iahub/platform/whatsapp-identities', requireAuth, requireAdmin, requireEmpresa, (req, res) => {
    const eid = empresaId(req);
    const body = req.body || {};
    const normalized = normalizePhone(body.numero || body.numeroNormalizado);
    if (!normalized) return res.status(400).json({ error: 'Numero obrigatorio.' });
    const atual = body.id
      ? getDB().prepare('SELECT * FROM platform_whatsapp_identities WHERE empresa_id = ? AND id = ?').get(eid, body.id)
      : getDB().prepare('SELECT * FROM platform_whatsapp_identities WHERE empresa_id = ? AND numero_normalizado = ?').get(eid, normalized);
    const id = atual?.id || body.id || uuid();
    const stamp = now();
    if (atual) {
      getDB().prepare('UPDATE platform_whatsapp_identities SET nome=?, numero=?, numero_normalizado=?, observacoes=?, ativo=?, metadata_json=?, atualizado_em=? WHERE empresa_id=? AND id=?')
        .run(body.nome || normalized, body.numero || normalized, normalized, body.observacoes || '', body.ativo === false ? 0 : 1, JSON.stringify(body.metadata || {}), stamp, eid, id);
    } else {
      getDB().prepare('INSERT INTO platform_whatsapp_identities (id, empresa_id, nome, numero, numero_normalizado, observacoes, ativo, metadata_json, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, eid, body.nome || normalized, body.numero || normalized, normalized, body.observacoes || '', body.ativo === false ? 0 : 1, JSON.stringify(body.metadata || {}), stamp, stamp);
    }
    res.json({ id, empresaId: eid });
  });

  app.put('/api/iahub/platform/whatsapp-identities/:id/roles', requireAuth, requireAdmin, requireEmpresa, (req, res) => {
    const eid = empresaId(req);
    const identityId = req.params.id;
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
    const tx = getDB().transaction(() => {
      getDB().prepare('DELETE FROM platform_identity_roles WHERE empresa_id = ? AND identity_id = ?').run(eid, identityId);
      for (const role of roles) {
        getDB().prepare('INSERT INTO platform_identity_roles (id, identity_id, empresa_id, sistema, modulo, papel, codigo_identidade, liberado, metadata_json, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(uuid(), identityId, eid, role.sistema || 'ia-service', role.modulo || 'chat-web', role.papel || 'analista', role.codigoIdentidade || null, role.liberado === false ? 0 : 1, JSON.stringify(role.metadata || {}), now(), now());
      }
    });
    tx();
    res.json({ ok: true });
  });

  app.delete('/api/iahub/platform/whatsapp-identities/:id', requireAuth, requireAdmin, requireEmpresa, (req, res) => {
    const eid = empresaId(req);
    const identityId = req.params.id;
    const tx = getDB().transaction(() => {
      getDB().prepare('DELETE FROM platform_identity_roles WHERE empresa_id = ? AND identity_id = ?').run(eid, identityId);
      const result = getDB().prepare('DELETE FROM platform_whatsapp_identities WHERE empresa_id = ? AND id = ?').run(eid, identityId);
      return result.changes;
    });
    const changes = tx();
    if (!changes) return res.status(404).json({ error: 'Numero nao encontrado.' });
    res.json({ ok: true });
  });

  app.get('/api/iahub/platform/import/runs', requireAuth, requireAdmin, (req, res) => {
    const eid = req.query.empresaId ? Number(req.query.empresaId) : null;
    const rows = eid
      ? getDB().prepare('SELECT * FROM platform_import_runs WHERE empresa_id = ? ORDER BY iniciado_em DESC LIMIT 50').all(eid)
      : getDB().prepare('SELECT * FROM platform_import_runs ORDER BY iniciado_em DESC LIMIT 50').all();
    res.json(rows.map(r => ({
      id: r.id,
      empresaId: r.empresa_id,
      status: r.status,
      resumo: parseJson(r.resumo_json, {}),
      erro: r.erro || '',
      iniciadoEm: r.iniciado_em,
      finalizadoEm: r.finalizado_em,
    })));
  });

  app.post('/api/iahub/platform/import/ia-command-j2a', requireAuth, requireAdmin, (req, res) => {
    try {
      res.json(importarNumerosJ2A());
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Falha ao importar numeros da J2A.' });
    }
  });
};
