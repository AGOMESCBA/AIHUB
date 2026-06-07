const crud = require('./database/crud');
const { requireRotina } = require('./permissions');
const { getEmpresaId } = require('./empresa-context');
const https = require('https');

const PROVIDERS = [
  { id: 'groq',     label: 'Groq',         keyField: 'groq_api_key',     painelUrl: 'https://console.groq.com/settings/billing' },
  { id: 'gemini',   label: 'Gemini',       keyField: 'gemini_api_key',   painelUrl: 'https://console.cloud.google.com/billing' },
  { id: 'deepseek', label: 'DeepSeek',     keyField: 'deepseek_api_key', painelUrl: 'https://platform.deepseek.com/top_up' },
  { id: 'claude',   label: 'Claude',       keyField: 'claude_api_key',   painelUrl: 'https://console.anthropic.com/settings/billing' },
  { id: 'openai',   label: 'OpenAI / GPT', keyField: 'openai_api_key',   painelUrl: 'https://platform.openai.com/account/billing' },
];

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

async function _consultarSaldoOpenAI(apiKey) {
  const now = new Date();
  await _getJson({
    hostname: 'api.openai.com',
    path: '/v1/models',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const startTime = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), 1) / 1000);

  try {
    const costs = await _getJson({
      hostname: 'api.openai.com',
      path: `/v1/organization/costs?start_time=${startTime}&limit=31`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const buckets = Array.isArray(costs?.data) ? costs.data : [];
    const total = buckets.reduce((sum, bucket) => {
      const results = Array.isArray(bucket?.results) ? bucket.results : [];
      return sum + results.reduce((acc, item) => acc + (Number(item?.amount?.value) || 0), 0);
    }, 0);
    return {
      disponivel: true,
      unidade: 'USD',
      valor: parseFloat(total.toFixed(4)),
      detalhe: `API operacional. Custo do mês: $${total.toFixed(4)}.`,
    };
  } catch (err) {
    return {
      disponivel: true,
      unidade: 'USD',
      valor: null,
      detalhe: err.statusCode === 403
        ? 'API operacional. A chave não tem permissão api.usage.read para consultar custos; veja o saldo no painel OpenAI.'
        : 'API operacional. Consulte o painel OpenAI para saldo/custos atualizados.',
    };
  }
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
    if (!row) return res.json({});
    res.json({
      ...row,
      groq_api_key:     row.groq_api_key     ? '***' : null,
      gemini_api_key:   row.gemini_api_key   ? '***' : null,
      deepseek_api_key: row.deepseek_api_key ? '***' : null,
      claude_api_key:   row.claude_api_key   ? '***' : null,
      openai_api_key:   row.openai_api_key   ? '***' : null,
    });
  });

  // ── SAVE / UPDATE config ─────────────────────────────────────────────────────
  app.post('/api/ia-command/ai-config', requireAuth, requireIaCommand, canConfigIa, (req, res) => {
    const {
      groq_api_key, gemini_api_key, deepseek_api_key, claude_api_key, openai_api_key,
      provedor_primario, fallback_ordem, confianca_minima,
      whisper_model, audio_idioma, historico_turnos,
    } = req.body;

    const existing = crud.buscarPor('ai_config', 'empresa_id', eid(req));

    const turnosVal = parseInt(historico_turnos, 10);
    const dados = {
      provedor_primario: provedor_primario || 'groq',
      fallback_ordem:    fallback_ordem    || 'groq,openai,gemini,deepseek,claude',
      confianca_minima:  parseFloat(confianca_minima) || 0.6,
      whisper_model:     whisper_model     || 'whisper-large-v3',
      audio_idioma:      audio_idioma      || 'pt',
      historico_turnos:  (!isNaN(turnosVal) && turnosVal >= 1 && turnosVal <= 10) ? turnosVal : 5,
    };

    // Only update keys if non-empty strings were sent (not '***')
    if (groq_api_key     && groq_api_key     !== '***') dados.groq_api_key     = groq_api_key;
    if (gemini_api_key   && gemini_api_key   !== '***') dados.gemini_api_key   = gemini_api_key;
    if (deepseek_api_key && deepseek_api_key !== '***') dados.deepseek_api_key = deepseek_api_key;
    if (claude_api_key   && claude_api_key   !== '***') dados.claude_api_key   = claude_api_key;
    if (openai_api_key   && openai_api_key   !== '***') dados.openai_api_key   = openai_api_key;

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
    });
  });

  // ── TEST AI key (quick classify test) ───────────────────────────────────────
  app.post('/api/ia-command/ai-config/test', requireAuth, requireIaCommand, canConfigIa, async (req, res) => {
    const { provedor, api_key } = req.body;
    const testMsg = 'Qual o faturamento deste mês?';

    try {
      let result;
      if (provedor === 'gemini') {
        result = await require('./ai/providers/gemini').classificarIntencao(testMsg, api_key);
      } else if (provedor === 'deepseek') {
        result = await require('./ai/providers/deepseek').classificarIntencao(testMsg, api_key);
      } else if (provedor === 'claude') {
        result = await require('./ai/providers/claude').classificarIntencao(testMsg, api_key);
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

      if (p.id === 'openai') {
        try {
          return { ...base, consultado: true, ...(await _consultarSaldoOpenAI(row[p.keyField])) };
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
    const TIMEOUT_MS = 8000;

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
        const promessa = mod.classificarIntencao(testMsg, chave, [], []);
        const timeout  = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 8s excedido.')), TIMEOUT_MS));
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
