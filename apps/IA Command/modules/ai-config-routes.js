const crud = require('./database/crud');

module.exports = function registrarRotasAIConfig(app, { requireAuth, requireIaCommand }) {

  function eid(req) { return req.session.empresa_id; }

  // ── GET config ───────────────────────────────────────────────────────────────
  app.get('/api/ia-command/ai-config', requireAuth, requireIaCommand, (req, res) => {
    const row = crud.buscarPor('ai_config', 'empresa_id', eid(req));
    if (!row) return res.json({});
    res.json({
      ...row,
      groq_api_key:   row.groq_api_key   ? '***' : null,
      gemini_api_key: row.gemini_api_key ? '***' : null,
    });
  });

  // ── SAVE / UPDATE config ─────────────────────────────────────────────────────
  app.post('/api/ia-command/ai-config', requireAuth, requireIaCommand, (req, res) => {
    const {
      groq_api_key, gemini_api_key,
      provedor_primario, confianca_minima,
      whisper_model, audio_idioma,
    } = req.body;

    const existing = crud.buscarPor('ai_config', 'empresa_id', eid(req));

    const dados = {
      provedor_primario: provedor_primario || 'groq',
      confianca_minima:  parseFloat(confianca_minima) || 0.6,
      whisper_model:     whisper_model     || 'whisper-large-v3',
      audio_idioma:      audio_idioma      || 'pt',
    };

    // Only update keys if non-empty strings were sent (not '***')
    if (groq_api_key   && groq_api_key   !== '***') dados.groq_api_key   = groq_api_key;
    if (gemini_api_key && gemini_api_key !== '***') dados.gemini_api_key = gemini_api_key;

    let row;
    if (existing) {
      row = crud.atualizar('ai_config', existing.id, dados);
    } else {
      row = crud.criar('ai_config', { empresa_id: eid(req), ...dados });
    }

    res.json({
      ...row,
      groq_api_key:   row.groq_api_key   ? '***' : null,
      gemini_api_key: row.gemini_api_key ? '***' : null,
    });
  });

  // ── TEST AI key (quick classify test) ───────────────────────────────────────
  app.post('/api/ia-command/ai-config/test', requireAuth, requireIaCommand, async (req, res) => {
    const { provedor, api_key } = req.body;
    const testMsg = 'Qual o faturamento deste mês?';

    try {
      let result;
      if (provedor === 'gemini') {
        result = await require('./ai/providers/gemini').classificarIntencao(testMsg, api_key);
      } else {
        result = await require('./ai/providers/groq').classificarIntencao(testMsg, api_key);
      }
      res.json({ ok: true, intencao: result.intencao, confianca: result.confianca });
    } catch (err) {
      res.status(400).json({ ok: false, mensagem: err.message });
    }
  });
};
