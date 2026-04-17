const db   = require('./database');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

function isRateLimit(err) {
  return err?.status === 429 || err?.message?.includes('rate_limit') || err?.message?.includes('Rate limit');
}

async function chamarIA(systemPrompt, userPrompt, maxTokens = 2000) {
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile', temperature: 0.1, max_tokens: maxTokens,
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
  const model  = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
  return result.response.text().trim();
}

async function chamarIARapida(systemPrompt, userPrompt) {
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant', temperature: 0, max_tokens: 1500,
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
  const model  = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
  return result.response.text().trim();
}

function resumoCurriculo(c) {
  const exps = (c.experiencias || []).map(e =>
    `${e.cargo} em ${e.empresa} (${e.periodo})${e.descricao ? ': ' + e.descricao.slice(0, 150) : ''}`
  ).join(' | ');
  const form = (c.formacao || []).map(f => `${f.curso} - ${f.instituicao}`).join('; ');
  const habs = Array.isArray(c.habilidades) ? c.habilidades.join(', ') : '';
  const caps = Array.isArray(c.capacitacoes) ? c.capacitacoes.join(', ') : '';
  return `Nome:${c.nome||'—'} | Habilidades:${habs} | Capacitações:${caps} | Experiências:${exps} | Formação:${form} | Perfil:${(c.descricao||'').slice(0,200)}`;
}

function perfilFuncao(funcao) {
  return `
Função: ${funcao.nome}
Área: ${funcao.area || '—'}
Nível: ${funcao.nivel_experiencia || '—'}
Formação Necessária: ${funcao.formacao_necessaria || '—'}
Descrição: ${funcao.descricao || '—'}
Requisitos Obrigatórios: ${funcao.requisitos_obrigatorios || '—'}
Requisitos Desejáveis: ${funcao.requisitos_desejaveis || '—'}
Habilidades Técnicas: ${Array.isArray(funcao.habilidades_tecnicas) ? funcao.habilidades_tecnicas.join(', ') : (funcao.habilidades_tecnicas || '—')}
Palavras-chave: ${Array.isArray(funcao.palavras_chave) ? funcao.palavras_chave.join(', ') : (funcao.palavras_chave || '—')}`.trim();
}

// ── Etapa 1: Triagem eliminatória (lotes de 10, modelo rápido) ────────────────
async function triagem(funcao, curriculos) {
  const temCriterios = funcao.requisitos_obrigatorios ||
    (Array.isArray(funcao.habilidades_tecnicas) && funcao.habilidades_tecnicas.length);

  if (!temCriterios) return { aprovados: curriculos, eliminados: [] };

  const criterios = `
Requisitos OBRIGATÓRIOS (eliminatório — ausência = reprovado): ${funcao.requisitos_obrigatorios || '—'}
Habilidades Técnicas exigidas: ${Array.isArray(funcao.habilidades_tecnicas) ? funcao.habilidades_tecnicas.join(', ') : (funcao.habilidades_tecnicas || '—')}
Nível de Experiência: ${funcao.nivel_experiencia || '—'}
Formação Necessária: ${funcao.formacao_necessaria || '—'}`.trim();

  const system = `Você é um recrutador fazendo triagem inicial rigorosa. Verifique APENAS se o candidato menciona ou demonstra os requisitos obrigatórios. Seja criterioso: se não há evidência clara do requisito, reprove. Responda SOMENTE com JSON array válido, sem markdown.`;

  const BATCH = 10;
  const aprovados = [];
  const eliminados = [];

  for (let i = 0; i < curriculos.length; i += BATCH) {
    const batch = curriculos.slice(i, i + BATCH);
    const texto = batch.map((c, idx) =>
      `[${idx + 1}] ID:${c.id} | ${resumoCurriculo(c)}`
    ).join('\n');

    const user = `CRITÉRIOS MÍNIMOS DA VAGA:\n${criterios}\n\nCURRÍCULOS PARA TRIAGEM:\n${texto}\n\nPara cada currículo retorne:\n[{"id": ID, "apto": true/false, "motivo": "motivo objetivo em 1 frase"}]`;

    try {
      const resposta = await chamarIARapida(system, user);
      const match = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\[[\s\S]*\]/);
      if (match) {
        const resultados = JSON.parse(match[0]);
        for (const r of resultados) {
          const c = batch.find(c => c.id === r.id);
          if (!c) continue;
          if (r.apto) aprovados.push(c);
          else eliminados.push({ ...c, motivo_eliminacao: r.motivo });
        }
      } else {
        aprovados.push(...batch);
      }
    } catch {
      aprovados.push(...batch);
    }
  }

  return { aprovados, eliminados };
}

// ── Etapa 2: Análise profunda individual com pontuação ponderada ──────────────
async function analisarIndividual(funcao, curriculo) {
  const system = `Você é um recrutador especialista. Avalie o currículo abaixo com base no perfil da vaga usando a seguinte rubrica de pontuação obrigatória:

RUBRICA (total 100 pontos):
- Requisitos Obrigatórios (40 pts): O candidato atende plenamente (+40), parcialmente (+20) ou não atende (0 pts + score máximo final = 25)?
- Habilidades Técnicas (30 pts): Domina todas (+30), maioria (+20), algumas (+10), nenhuma (0)?
- Nível e Tempo de Experiência (15 pts): Corresponde exatamente (+15), aproximado (+8), não corresponde (0)?
- Formação Acadêmica (15 pts): Atende ou supera (+15), próxima (+8), não atende (0)?

REGRA CRÍTICA: Se o candidato NÃO atende algum requisito obrigatório, o score máximo é 25, independente dos demais critérios.

Responda SOMENTE com JSON válido, sem markdown.`;

  const user = `PERFIL DA VAGA:\n${perfilFuncao(funcao)}\n\nCURRÍCULO:\n${resumoCurriculo(curriculo)}\n\nRetorne:\n{"id":${curriculo.id},"score":0-100,"nivel":"Alto|Médio|Baixo","detalhes":{"requisitos_obrigatorios":0-40,"habilidades_tecnicas":0-30,"nivel_experiencia":0-15,"formacao":0-15},"pontos_positivos":["..."],"pontos_negativos":["..."],"resumo":"2 frases objetivas sobre aderência do candidato à vaga"}`;

  try {
    const resposta = await chamarIA(system, user, 1200);
    const match = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON inválido');
    return JSON.parse(match[0]);
  } catch {
    return { id: curriculo.id, score: 0, nivel: 'Baixo', detalhes: {}, pontos_positivos: [], pontos_negativos: ['Erro ao analisar'], resumo: '' };
  }
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
    if (!curriculos.length) return res.json({ resultados: [], eliminados: [], total: 0 });

    try {
      // Etapa 1: triagem eliminatória
      const { aprovados, eliminados } = await triagem(funcao, curriculos);

      // Etapa 2: análise profunda individual dos aprovados
      const resultados = [];
      for (const c of aprovados) {
        const r = await analisarIndividual(funcao, c);
        resultados.push({
          ...r,
          nome:      c.nome      || '—',
          telefone:  c.telefone  || '—',
          email:     c.email     || '—',
          remetente: c.remetente || '—',
        });
      }

      resultados.sort((a, b) => b.score - a.score);

      const eliminadosInfo = eliminados.map(c => ({
        id: c.id, nome: c.nome || '—', telefone: c.telefone || '—',
        email: c.email || '—', motivo: c.motivo_eliminacao,
      }));

      res.json({
        resultados,
        eliminados:       eliminadosInfo,
        total:            curriculos.length,
        total_aprovados:  aprovados.length,
        total_eliminados: eliminados.length,
        funcao:           funcao.nome,
        triagem_ativa:    !!(funcao.requisitos_obrigatorios || (Array.isArray(funcao.habilidades_tecnicas) && funcao.habilidades_tecnicas.length)),
      });
    } catch (err) {
      res.status(500).json({ error: `Erro na análise: ${err.message}` });
    }
  });
};
