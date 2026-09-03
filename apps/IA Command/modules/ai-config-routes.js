const crud = require('./database/crud');
const { requireRotina } = require('./permissions');
const { getEmpresaId } = require('./empresa-context');
const https = require('https');
const { getDB } = require('./database');

const PROVIDERS = [
  { id: 'groq',     label: 'Groq',         keyField: 'groq_api_key',     painelUrl: 'https://console.groq.com/settings/billing' },
  { id: 'gemini',   label: 'Gemini',       keyField: 'gemini_api_key',   painelUrl: 'https://console.cloud.google.com/billing' },
  { id: 'deepseek', label: 'DeepSeek',     keyField: 'deepseek_api_key', painelUrl: 'https://platform.deepseek.com/top_up' },
  { id: 'claude',   label: 'Claude',       keyField: 'claude_api_key',   painelUrl: 'https://console.anthropic.com/settings/billing' },
  { id: 'openai',   label: 'OpenAI / GPT', keyField: 'openai_api_key',   painelUrl: 'https://platform.openai.com/account/billing' },
];

const WEB_LOGIN_DEFAULT_PATH = '/api/ia-command/protheus/web-login';

function normalizarWebLoginPath(valor) {
  const pathLogin = String(valor || '').trim();
  if (!pathLogin) return '';
  if (!pathLogin.startsWith('/')) return '';
  if (pathLogin.includes('?') || pathLogin.includes('#') || pathLogin.includes('..')) return '';
  if (!/^\/[A-Za-z0-9/_-]+$/.test(pathLogin)) return '';
  return pathLogin.replace(/\/+$/g, '') || '';
}

function clampInt(valor, min, max, padrao) {
  const n = parseInt(valor, 10);
  if (Number.isNaN(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

function aplicarDefaultsChat(row = {}) {
  return {
    protheus_web_login_ativo: row.protheus_web_login_ativo == null ? 1 : Number(row.protheus_web_login_ativo) ? 1 : 0,
    protheus_web_login_path: row.protheus_web_login_path || WEB_LOGIN_DEFAULT_PATH,
    protheus_web_login_access_key: row.protheus_web_login_access_key ? '***' : null,
    protheus_web_login_access_key_configurada: row.protheus_web_login_access_key ? 1 : 0,
    protheus_chat_secret: row.protheus_chat_secret ? '***' : null,
    protheus_chat_secret_configurado: row.protheus_chat_secret ? 1 : 0,
    protheus_web_login_otp_ttl_min: row.protheus_web_login_otp_ttl_min || 5,
    protheus_web_login_max_tentativas: row.protheus_web_login_max_tentativas || 5,
    protheus_web_login_exigir_https: Number(row.protheus_web_login_exigir_https || 0) ? 1 : 0,
  };
}

function _getJson({ hostname, path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', rejectUnauthorized: false, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = parsed?.error?.message || parsed?.message || `HTTP ${res.statusCode}`;
          const err = new Error(msg);
          err.statusCode = res.statusCode;
          err.payload = parsed;
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error('Tempo limite ao consultar saldo.')));
    req.on('error', reject);
    req.end();
  });
}

async function _consultarSaldoDeepSeek(apiKey) {
  const data = await _getJson({
    hostname: 'api.deepseek.com',
    path: '/user/balance',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const balances = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  const principal = balances.find(b => b.currency === 'USD') || balances[0] || null;
  return {
    disponivel: data?.is_available === true,
    unidade: principal?.currency || '',
    valor: principal?.total_balance ?? null,
    detalhe: principal
      ? `Créditos: ${principal.total_balance} ${principal.currency}`
      : (data?.is_available ? 'Conta disponível para chamadas' : 'Sem saldo disponível'),
  };
}

module.exports = function registrarRotasAIConfig(app, { requireAuth, requireIaCommand }) {

  function eid(req) { return getEmpresaId(req); }
  const canConfigIa = requireRotina('iac-config-ia');

  // ── GET config ───────────────────────────────────────────────────────────────
  app.get('/api/ia-command/ai-config', requireAuth, requireIaCommand, canConfigIa, (req, res) => {
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    if (!row) return res.json(aplicarDefaultsChat({}));
    res.json({
      ...row,
      groq_api_key:     row.groq_api_key     ? '***' : null,
      gemini_api_key:   row.gemini_api_key   ? '***' : null,
      deepseek_api_key: row.deepseek_api_key ? '***' : null,
      claude_api_key:   row.claude_api_key   ? '***' : null,
      openai_api_key:   row.openai_api_key   ? '***' : null,
      groq_modelo:      row.groq_modelo      || 'openai/gpt-oss-20b',
      openai_modelo:    row.openai_modelo    || 'gpt-4o-mini',
      gemini_modelo:    row.gemini_modelo    || 'gemini-3.5-flash',
      deepseek_modelo:  row.deepseek_modelo  || 'deepseek-chat',
      claude_modelo:    row.claude_modelo    || 'claude-haiku-4-5-20251001',
      ...aplicarDefaultsChat(row),
    });
  });

  app.get('/api/ia-command/ai-config/chat-secret/:campo', requireAuth, requireIaCommand, canConfigIa, (req, res) => {
    const camposPermitidos = {
      protheus_web_login_access_key: 'protheus_web_login_access_key',
      protheus_chat_secret: 'protheus_chat_secret',
    };
    const campo = camposPermitidos[req.params.campo];
    if (!campo) return res.status(404).json({ error: 'Campo nao encontrado.' });
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    res.json({ valor: row?.[campo] || '' });
  });

  // ── SAVE / UPDATE config ─────────────────────────────────────────────────────
  app.post('/api/ia-command/ai-config', requireAuth, requireIaCommand, canConfigIa, (req, res) => {
    const {
      groq_api_key, gemini_api_key, deepseek_api_key, claude_api_key, openai_api_key,
      groq_modelo, openai_modelo, gemini_modelo, deepseek_modelo, claude_modelo,
      provedor_primario, fallback_ordem, confianca_minima,
      whisper_model, audio_idioma, historico_turnos,
      protheus_web_login_ativo,
      protheus_web_login_path,
      protheus_web_login_access_key,
      protheus_chat_secret,
      protheus_web_login_otp_ttl_min,
      protheus_web_login_max_tentativas,
      protheus_web_login_exigir_https,
    } = req.body;

    const existing = crud.buscarPor('ai_config', 'empresa_id', eid(req));

    const turnosVal = parseInt(historico_turnos, 10);
    const dados = {
      provedor_primario: provedor_primario || 'groq',
      fallback_ordem:    fallback_ordem    || 'groq,deepseek,gemini,claude,openai',
      confianca_minima:  parseFloat(confianca_minima) || 0.6,
      whisper_model:     whisper_model     || 'whisper-large-v3',
      audio_idioma:      audio_idioma      || 'pt',
      historico_turnos:  (!isNaN(turnosVal) && turnosVal >= 1 && turnosVal <= 10) ? turnosVal : 5,
    };

    const chatPath = normalizarWebLoginPath(protheus_web_login_path || existing?.protheus_web_login_path || WEB_LOGIN_DEFAULT_PATH);
    if (!chatPath) return res.status(400).json({ error: 'Informe uma rota publica valida iniciando com /.' });
    if (chatPath !== WEB_LOGIN_DEFAULT_PATH && !/^\/(entrar|acesso)\/[A-Za-z0-9_-]{3,80}$/.test(chatPath)) {
      return res.status(400).json({ error: 'Use uma rota mascarada no formato /entrar/seu-codigo ou /acesso/seu-codigo, com 3 a 80 caracteres.' });
    }
    if (chatPath !== WEB_LOGIN_DEFAULT_PATH) {
      const rotaExistente = getDB().prepare(`
        SELECT empresa_id
          FROM ai_config
         WHERE protheus_web_login_path = ?
           AND empresa_id <> ?
         LIMIT 1
      `).get(chatPath, eid(req));
      if (rotaExistente) {
        return res.status(409).json({ error: 'Esta rota ja esta em uso por outra empresa. Escolha outro nome.' });
      }
    }
    dados.protheus_web_login_ativo = Number(protheus_web_login_ativo) ? 1 : 0;
    dados.protheus_web_login_path = chatPath;
    dados.protheus_web_login_otp_ttl_min = clampInt(protheus_web_login_otp_ttl_min, 1, 30, 5);
    dados.protheus_web_login_max_tentativas = clampInt(protheus_web_login_max_tentativas, 1, 10, 5);
    dados.protheus_web_login_exigir_https = Number(protheus_web_login_exigir_https) ? 1 : 0;

    // Only update keys if non-empty strings were sent (not '***')
    if (groq_api_key     && groq_api_key     !== '***') dados.groq_api_key     = groq_api_key;
    if (gemini_api_key   && gemini_api_key   !== '***') dados.gemini_api_key   = gemini_api_key;
    if (deepseek_api_key && deepseek_api_key !== '***') dados.deepseek_api_key = deepseek_api_key;
    if (claude_api_key   && claude_api_key   !== '***') dados.claude_api_key   = claude_api_key;
    if (openai_api_key   && openai_api_key   !== '***') dados.openai_api_key   = openai_api_key;
    if (protheus_web_login_access_key && protheus_web_login_access_key !== '***') {
      dados.protheus_web_login_access_key = String(protheus_web_login_access_key).trim();
    }
    if (protheus_chat_secret && protheus_chat_secret !== '***') {
      dados.protheus_chat_secret = String(protheus_chat_secret).trim();
    }

    // Update modelos if provided (não são secrets)
    if (groq_modelo)     dados.groq_modelo     = groq_modelo;
    if (openai_modelo)   dados.openai_modelo   = openai_modelo;
    if (gemini_modelo)   dados.gemini_modelo   = gemini_modelo;
    if (deepseek_modelo) dados.deepseek_modelo = deepseek_modelo;
    if (claude_modelo)   dados.claude_modelo   = claude_modelo;

    let row;
    if (existing) {
      row = crud.atualizar('ai_config', existing.id, dados);
    } else {
      row = crud.criar('ai_config', { empresa_id: eid(req), ...dados });
    }
    try { require('./ai/intent-service').invalidateCache(eid(req)); } catch (_) {}

    res.json({
      ...row,
      groq_api_key:     row.groq_api_key     ? '***' : null,
      gemini_api_key:   row.gemini_api_key   ? '***' : null,
      deepseek_api_key: row.deepseek_api_key ? '***' : null,
      claude_api_key:   row.claude_api_key   ? '***' : null,
      openai_api_key:   row.openai_api_key   ? '***' : null,
      groq_modelo:      row.groq_modelo      || 'openai/gpt-oss-20b',
      openai_modelo:    row.openai_modelo    || 'gpt-4o-mini',
      gemini_modelo:    row.gemini_modelo    || 'gemini-3.5-flash',
      deepseek_modelo:  row.deepseek_modelo  || 'deepseek-chat',
      claude_modelo:    row.claude_modelo    || 'claude-haiku-4-5-20251001',
      ...aplicarDefaultsChat(row),
    });
  });

  // ── TEST AI key (quick classify test) ───────────────────────────────────────
  app.post('/api/ia-command/ai-config/test', requireAuth, requireIaCommand, canConfigIa, async (req, res) => {
    const { provedor, api_key } = req.body;
    const testMsg = 'Qual o faturamento deste mês?';
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));

    try {
      let result;
      if (provedor === 'gemini') {
        result = await require('./ai/providers/gemini').classificarIntencao(testMsg, api_key, [], [], null, row?.gemini_modelo);
      } else if (provedor === 'deepseek') {
        result = await require('./ai/providers/deepseek').classificarIntencao(testMsg, api_key);
      } else if (provedor === 'claude') {
        result = await require('./ai/providers/claude').classificarIntencao(testMsg, api_key, [], [], null, row?.claude_modelo);
      } else if (provedor === 'openai') {
        result = await require('./ai/providers/openai').classificarIntencao(testMsg, api_key);
      } else {
        result = await require('./ai/providers/groq').classificarIntencao(testMsg, api_key);
      }
      res.json({ ok: true, intencao: result.intencao, confianca: result.confianca });
    } catch (err) {
      res.status(500).json({ ok: false, erro: err.message || 'Falha ao testar provedor.' });
    }
  });

  app.get('/api/ia-command/ai-config/saldo', requireAuth, requireIaCommand, canConfigIa, async (req, res) => {
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    if (!row) return res.json({ configurados: 0, consultados: 0, provedores: [] });

    const provedores = await Promise.all(PROVIDERS.map(async (p) => {
      const configurado = !!row[p.keyField];
      const base = {
        id: p.id,
        nome: p.label,
        painel_url: p.painelUrl,
        configurado,
        disponivel: null,
        consultado: false,
        valor: null,
        unidade: '',
        detalhe: 'Saldo não consultado por API.',
      };

      if (!configurado) return base;

      if (p.id === 'deepseek') {
        try {
          return { ...base, consultado: true, ...(await _consultarSaldoDeepSeek(row[p.keyField])) };
        } catch (err) {
          return base;
        }
      }

      return base;
    }));

    const configurados = provedores.filter(p => p.configurado).length;
    const consultados = provedores.filter(p => p.configurado && p.consultado).length;
    res.json({ configurados, consultados, provedores });
  });

  // ── TESTAR todos os provedores ao vivo ──────────────────────────────────────
  app.get('/api/ia-command/ai-config/testar-provedores', requireAuth, requireIaCommand, canConfigIa, async (req, res) => {
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    if (!row) return res.json({ provedores: [], primario: null });

    const PROVIDER_MODULES = {
      groq:     () => require('./ai/providers/groq'),
      gemini:   () => require('./ai/providers/gemini'),
      deepseek: () => require('./ai/providers/deepseek'),
      claude:   () => require('./ai/providers/claude'),
      openai:   () => require('./ai/providers/openai'),
    };

    const testMsg = 'Faturamento do mês';
    const TIMEOUT_MS = 20000;

    function _classificarStatus(msg = '') {
      const m = msg.toLowerCase();
      if (m.includes('quota') || m.includes('rate limit') || m.includes('free_tier') || m.includes('exceeded') || m.includes('429')) return 'cota_esgotada';
      if (m.includes('unauthorized') || m.includes('invalid key') || m.includes('authentication') || m.includes('401')) return 'chave_invalida';
      if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
      return 'erro';
    }

    const resultados = await Promise.all(PROVIDERS.map(async (p) => {
      const chave = row[p.keyField];
      if (!chave) return { id: p.id, nome: p.label, painel_url: p.painelUrl, status: 'sem_chave', latencia_ms: null, detalhe: null };

      const t0 = Date.now();
      try {
        const mod = PROVIDER_MODULES[p.id]?.();
        const modeloConfigurado = p.id === 'claude' ? row.claude_modelo
          : p.id === 'gemini' ? row.gemini_modelo
          : null;
        const promessa = modeloConfigurado
          ? mod.classificarIntencao(testMsg, chave, [], [], null, modeloConfigurado)
          : mod.classificarIntencao(testMsg, chave, [], []);
        const timeout  = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout de ${TIMEOUT_MS / 1000}s excedido.`)), TIMEOUT_MS));
        await Promise.race([promessa, timeout]);
        return { id: p.id, nome: p.label, painel_url: p.painelUrl, status: 'operacional', latencia_ms: Date.now() - t0, detalhe: null };
      } catch (err) {
        return { id: p.id, nome: p.label, painel_url: p.painelUrl, status: _classificarStatus(err.message), latencia_ms: Date.now() - t0, detalhe: err.message };
      }
    }));

    res.json({ provedores: resultados, primario: row.provedor_primario || 'groq' });
  });

  // ── REVEAL raw keys (autenticado, somente para a empresa da sessão) ──────────
  app.get('/api/ia-command/ai-config/reveal', requireAuth, requireIaCommand, canConfigIa, (req, res) => {
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    if (!row) return res.json({ groq_api_key: null, gemini_api_key: null, deepseek_api_key: null, claude_api_key: null, openai_api_key: null });
    res.json({
      groq_api_key:     row.groq_api_key     || null,
      gemini_api_key:   row.gemini_api_key   || null,
      deepseek_api_key: row.deepseek_api_key || null,
      claude_api_key:   row.claude_api_key   || null,
      openai_api_key:   row.openai_api_key   || null,
    });
  });
};
