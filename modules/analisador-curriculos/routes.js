const db   = require('./database');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

function isRateLimit(err) {
  return err?.status === 429 || err?.message?.includes('rate_limit') || err?.message?.includes('Rate limit');
}

async function chamarIA(systemPrompt, userPrompt) {
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile', temperature: 0.1, max_tokens: 4000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
    });
    return res.choices[0].message.content.trim();
  } catch (e) {
    if (!isRateLimit(e)) throw e;
  }
  if (!gemini) throw new Error('Limite Groq atingido e GEMINI_API_KEY não configurada.');
  const model  = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
  return result.response.text().trim();
}

async function analisarBatch(funcao, curriculos) {
  const perfilVaga = `
VAGA / FUNÇÃO:
Nome: ${funcao.nome}
Área: ${funcao.area || '—'}
Nível: ${funcao.nivel_experiencia || '—'}
Descrição: ${funcao.descricao || '—'}
Requisitos Obrigatórios: ${funcao.requisitos_obrigatorios || '—'}
Requisitos Desejáveis: ${funcao.requisitos_desejaveis || '—'}
Habilidades Técnicas: ${Array.isArray(funcao.habilidades_tecnicas) ? funcao.habilidades_tecnicas.join(', ') : (funcao.habilidades_tecnicas || '—')}
Formação Necessária: ${funcao.formacao_necessaria || '—'}
Palavras-chave: ${Array.isArray(funcao.palavras_chave) ? funcao.palavras_chave.join(', ') : (funcao.palavras_chave || '—')}`.trim();

  const curriculosTexto = curriculos.map((c, i) => {
    const exps = (c.experiencias || []).map(e => `${e.cargo} em ${e.empresa} (${e.periodo})`).join('; ');
    const form = (c.formacao || []).map(f => `${f.curso} - ${f.instituicao}`).join('; ');
    const habs = Array.isArray(c.habilidades) ? c.habilidades.join(', ') : '';
    const caps = Array.isArray(c.capacitacoes) ? c.capacitacoes.join(', ') : '';
    return `[${i + 1}] ID:${c.id} | Nome:${c.nome || '—'} | Habilidades:${habs} | Capacitações:${caps} | Experiências:${exps} | Formação:${form} | Descrição:${(c.descricao || '').slice(0, 200)}`;
  }).join('\n');

  const system = `Você é um recrutador especialista. Avalie a compatibilidade de cada currículo com a vaga. Responda SOMENTE com JSON array válido, sem markdown.`;
  const user   = `${perfilVaga}\n\nCURRÍCULOS:\n${curriculosTexto}\n\nPara cada currículo retorne:\n[{"id": ID_DO_CURRICULO, "score": 0-100, "nivel": "Alto|Médio|Baixo", "pontos_positivos": ["..."], "pontos_negativos": ["..."], "resumo": "1-2 frases"}]`;

  const resposta = await chamarIA(system, user);
  const match    = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
}

module.exports = function registerVagasRoutes(app, { requireAuth }) {

  // ── Funções ──────────────────────────────────────────────────────────────────
  app.get   ('/api/funcoes',     requireAuth, (_req, res) => res.json(db.listFuncoes()));
  app.get   ('/api/funcoes/:id', requireAuth, (req, res) => {
    const f = db.getFuncao(Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Não encontrada' });
    res.json(f);
  });
  app.post  ('/api/funcoes',     requireAuth, (req, res) => {
    const id = db.saveFuncao(req.body);
    res.json({ ok: true, id });
  });
  app.put   ('/api/funcoes/:id', requireAuth, (req, res) => {
    const ok = db.updateFuncao(Number(req.params.id), req.body);
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });
  app.delete('/api/funcoes/:id', requireAuth, (req, res) => {
    const ok = db.deleteFuncao(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });

  // ── Vagas ────────────────────────────────────────────────────────────────────
  app.get   ('/api/vagas',     requireAuth, (_req, res) => res.json(db.listVagas()));
  app.get   ('/api/vagas/:id', requireAuth, (req, res) => {
    const v = db.getVaga(Number(req.params.id));
    if (!v) return res.status(404).json({ error: 'Não encontrada' });
    res.json(v);
  });
  app.post  ('/api/vagas',     requireAuth, (req, res) => {
    const id = db.saveVaga(req.body);
    res.json({ ok: true, id });
  });
  app.put   ('/api/vagas/:id', requireAuth, (req, res) => {
    const ok = db.updateVaga(Number(req.params.id), req.body);
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });
  app.delete('/api/vagas/:id', requireAuth, (req, res) => {
    const ok = db.deleteVaga(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });

  // ── Analisador ───────────────────────────────────────────────────────────────
  app.post('/api/analisador/analisar', requireAuth, async (req, res) => {
    const { funcao_id } = req.body;
    const funcao = db.getFuncao(Number(funcao_id));
    if (!funcao) return res.status(404).json({ error: 'Função não encontrada' });

    const curriculos = db.listCurriculos();
    if (!curriculos.length) return res.json({ resultados: [], total: 0 });

    try {
      const BATCH = 5;
      const resultados = [];
      for (let i = 0; i < curriculos.length; i += BATCH) {
        const batch   = curriculos.slice(i, i + BATCH);
        const parcial = await analisarBatch(funcao, batch);
        resultados.push(...parcial);
      }
      resultados.sort((a, b) => b.score - a.score);

      // Enriquecer com dados do currículo
      const enriquecidos = resultados.map(r => {
        const c = curriculos.find(c => c.id === r.id);
        return { ...r, nome: c?.nome || '—', telefone: c?.telefone || '—', email: c?.email || '—', remetente: c?.remetente || '—' };
      });

      res.json({ resultados: enriquecidos, total: enriquecidos.length, funcao: funcao.nome });
    } catch (err) {
      res.status(500).json({ error: `Erro na análise: ${err.message}` });
    }
  });
};
