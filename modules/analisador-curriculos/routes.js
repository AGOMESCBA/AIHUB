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

// ── Cálculo de experiência por período ────────────────────────────────────────
function parsePeriodoMeses(periodo) {
  if (!periodo) return 0;
  const partes = periodo.split(/\s*[-–]\s*/);
  if (partes.length < 2) return 0;

  const parseData = (str) => {
    const s = (str || '').trim().toLowerCase();
    if (['atual', 'presente', 'current', 'o momento', 'atualmente', 'hoje'].some(w => s.includes(w))) {
      return new Date();
    }
    const m = s.match(/^(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let ano = parseInt(m[2]);
      if (ano < 100) ano += ano >= 50 ? 1900 : 2000;
      return new Date(ano, parseInt(m[1]) - 1, 1);
    }
    // Só ano: ex "2020"
    const apenasAno = s.match(/^(\d{4})$/);
    if (apenasAno) return new Date(parseInt(apenasAno[1]), 0, 1);
    return null;
  };

  const inicio = parseData(partes[0]);
  const fim    = parseData(partes[1]);
  if (!inicio || !fim) return 0;
  const meses = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth());
  return Math.max(0, meses);
}

function calcularExperiencia(curriculo) {
  let totalMeses = 0;
  for (const exp of (curriculo.experiencias || [])) {
    totalMeses += parsePeriodoMeses(exp.periodo);
  }

  let nivel;
  if (totalMeses < 12)      nivel = 'Júnior';   // 0–1 ano
  else if (totalMeses < 36) nivel = 'Pleno';    // 1–3 anos
  else                       nivel = 'Sênior';  // 3+ anos

  const anos   = Math.floor(totalMeses / 12);
  const mesesR = totalMeses % 12;
  const texto  = anos > 0
    ? `${anos} ano${anos !== 1 ? 's' : ''}${mesesR > 0 ? ` e ${mesesR} mês${mesesR !== 1 ? 'es' : ''}` : ''}`
    : `${totalMeses} mês${totalMeses !== 1 ? 'es' : ''}`;

  return { totalMeses, nivel, texto };
}

// ── Texto completo do currículo (sem truncamento) ─────────────────────────────
function curriculoCompleto(c) {
  const exp   = calcularExperiencia(c);
  const habs  = Array.isArray(c.habilidades)   ? c.habilidades.join('\n  • ')   : '—';
  const caps  = Array.isArray(c.capacitacoes)  ? c.capacitacoes.join('\n  • ')  : '—';
  const form  = (c.formacao || []).map(f => `  • ${f.curso} — ${f.instituicao} (${f.periodo || '—'})`).join('\n');
  const exps  = (c.experiencias || []).map(e => {
    const ativ = (e.atividades || []).map(a => `      – ${a}`).join('\n');
    return `  → ${e.cargo} | ${e.empresa} | ${e.periodo || '—'}` +
      (e.descricao ? `\n    Descrição: ${e.descricao}` : '') +
      (ativ        ? `\n    Atividades:\n${ativ}` : '');
  }).join('\n\n');

  return `NOME: ${c.nome || '—'}
EXPERIÊNCIA TOTAL CALCULADA: ${exp.texto} → Nível estimado pelo sistema: ${exp.nivel}

PERFIL / OBJETIVO:
${c.descricao || '—'}

HABILIDADES E COMPETÊNCIAS:
  • ${habs}

CAPACITAÇÕES E CERTIFICAÇÕES:
  • ${caps}

FORMAÇÃO ACADÊMICA:
${form || '  —'}

HISTÓRICO PROFISSIONAL:
${exps || '  —'}`;
}

// ── Texto resumido para triagem em lote ──────────────────────────────────────
function curriculoResumo(c) {
  const exp  = calcularExperiencia(c);
  const habs = Array.isArray(c.habilidades) ? c.habilidades.join(' | ') : '';
  const caps = Array.isArray(c.capacitacoes) ? c.capacitacoes.join(', ') : '';
  const exps = (c.experiencias || []).map(e => {
    const ativ = (e.atividades || []).slice(0, 6).join('; ');
    return `${e.cargo} em ${e.empresa} (${e.periodo})`
      + (e.descricao ? ': ' + e.descricao.slice(0, 300) : '')
      + (ativ        ? ' | Atividades: ' + ativ : '');
  }).join('\n');
  const form = (c.formacao || []).map(f => `${f.curso} — ${f.instituicao}`).join('; ');

  return `Nome: ${c.nome || '—'} | Exp.Total: ${exp.texto} (${exp.nivel})
Perfil: ${(c.descricao || '').slice(0, 350)}
Habilidades: ${habs}
Capacitações: ${caps}
Formação: ${form}
Experiências:
${exps}`;
}

function perfilFuncao(funcao) {
  return `Função: ${funcao.nome}
Área: ${funcao.area || '—'}
Nível exigido: ${funcao.nivel_experiencia || '—'}
Formação Necessária: ${funcao.formacao_necessaria || '—'}
Descrição: ${funcao.descricao || '—'}
Requisitos Obrigatórios: ${funcao.requisitos_obrigatorios || '—'}
Requisitos Desejáveis: ${funcao.requisitos_desejaveis || '—'}
Habilidades Técnicas: ${Array.isArray(funcao.habilidades_tecnicas) ? funcao.habilidades_tecnicas.join(', ') : (funcao.habilidades_tecnicas || '—')}
Palavras-chave: ${Array.isArray(funcao.palavras_chave) ? funcao.palavras_chave.join(', ') : (funcao.palavras_chave || '—')}`;
}

// ── Etapa 1: Triagem eliminatória ─────────────────────────────────────────────
async function triagem(funcao, curriculos) {
  const temCriterios = funcao.requisitos_obrigatorios ||
    (Array.isArray(funcao.habilidades_tecnicas) && funcao.habilidades_tecnicas.length);

  if (!temCriterios) return { aprovados: curriculos, eliminados: [] };

  const criterios = `Requisitos OBRIGATÓRIOS: ${funcao.requisitos_obrigatorios || '—'}
Habilidades Técnicas exigidas: ${Array.isArray(funcao.habilidades_tecnicas) ? funcao.habilidades_tecnicas.join(', ') : (funcao.habilidades_tecnicas || '—')}
Nível exigido: ${funcao.nivel_experiencia || '—'}
Formação Necessária: ${funcao.formacao_necessaria || '—'}`;

  const system = `Você é um recrutador especialista fazendo triagem inicial de currículos.
Analise TODAS as informações do currículo (perfil, habilidades, capacitações, descrições e atividades de cada experiência) para verificar se o candidato possui evidência dos requisitos obrigatórios.
REGRAS:
- Considere variações de nome, siglas e produtos equivalentes (ex: "SE SUITE" = "SoftExpert"; "SQL" inclui "MySQL"/"PostgreSQL"; "Processos" inclui "BPM"/"BPMN"/"mapeamento de processos").
- Aprove se houver qualquer evidência em QUALQUER parte do currículo. Reprove apenas se não houver NENHUMA evidência em nenhuma seção.
Responda SOMENTE com JSON array válido, sem markdown.`;

  const BATCH = 5;
  const aprovados  = [];
  const eliminados = [];

  for (let i = 0; i < curriculos.length; i += BATCH) {
    const batch = curriculos.slice(i, i + BATCH);
    const texto = batch.map((c, idx) =>
      `=== CANDIDATO ${idx + 1} (ID:${c.id}) ===\n${curriculoResumo(c)}`
    ).join('\n\n');

    const user = `CRITÉRIOS MÍNIMOS DA VAGA:\n${criterios}\n\nCURRÍCULOS:\n${texto}\n\nRetorne JSON array — um objeto por candidato:\n[{"id": ID_EXATO, "apto": true/false, "motivo": "motivo objetivo em 1 frase"}]`;

    try {
      const resposta = await chamarIA(system, user, 1500);
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

// ── Etapa 2: Análise profunda individual ─────────────────────────────────────
async function analisarIndividual(funcao, curriculo) {
  const expCalc = calcularExperiencia(curriculo);

  const system = `Você é um recrutador sênior experiente. Avalie o currículo completo abaixo com base no perfil da vaga.

RUBRICA DE PONTUAÇÃO (total 100 pts):

1. REQUISITOS OBRIGATÓRIOS — até 40 pts
   Percorra TODAS as seções do currículo (perfil, habilidades, capacitações, descrições e atividades de cada experiência).
   • Atende todos os requisitos com evidência clara → 40 pts
   • Atende a maioria (>50%) → 20–35 pts (proporcional)
   • Atende poucos (<50%) → 5–15 pts
   • Não atende nenhum → 0 pts + SCORE MÁXIMO FINAL = 25 pts (regra crítica)

2. HABILIDADES TÉCNICAS — até 30 pts
   Percorra TODAS as seções do currículo. Considere equivalências (ex: SE SUITE = SoftExpert).
   • Domina todas → 30 pts  |  Domina maioria → 20 pts  |  Domina algumas → 10 pts  |  Nenhuma → 0 pts

3. NÍVEL E TEMPO DE EXPERIÊNCIA RELEVANTE — até 15 pts
   O sistema calculou a experiência TOTAL do candidato: ${expCalc.texto} (${expCalc.nivel} pelo tempo total).
   Avalie o tempo de experiência RELEVANTE para esta vaga especificamente.
   Classifique o candidato como:
   • Júnior: menos de 1 ano de experiência relevante
   • Pleno: de 1 a 3 anos de experiência relevante
   • Sênior: mais de 3 anos de experiência relevante
   Compare ao nível exigido pela vaga:
   • Nível idêntico ou candidato é Sênior para vaga Pleno → 15 pts
   • Um nível abaixo (ex: Pleno para vaga Sênior) → 8 pts
   • Dois níveis abaixo (ex: Júnior para vaga Sênior) → 0 pts

4. FORMAÇÃO ACADÊMICA — até 15 pts
   • Atende ou supera o exigido → 15 pts  |  Próxima da área → 8 pts  |  Não atende → 0 pts

REGRA CRÍTICA: Se requisitos_obrigatorios = 0, o score final máximo é 25.

Responda SOMENTE com JSON válido, sem markdown.`;

  const user = `PERFIL DA VAGA:\n${perfilFuncao(funcao)}\n\nCURRÍCULO COMPLETO:\n${curriculoCompleto(curriculo)}\n\nRetorne:\n{"id":${curriculo.id},"score":0-100,"nivel":"Alto|Médio|Baixo","nivel_candidato":"Júnior|Pleno|Sênior","meses_relevantes":0,"detalhes":{"requisitos_obrigatorios":0-40,"habilidades_tecnicas":0-30,"nivel_experiencia":0-15,"formacao":0-15},"pontos_positivos":["..."],"pontos_negativos":["..."],"resumo":"2 frases objetivas sobre a aderência do candidato à vaga"}`;

  try {
    const resposta = await chamarIA(system, user, 1500);
    const match = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON inválido');
    return JSON.parse(match[0]);
  } catch {
    return { id: curriculo.id, score: 0, nivel: 'Baixo', nivel_candidato: '—', meses_relevantes: 0, detalhes: {}, pontos_positivos: [], pontos_negativos: ['Erro ao analisar'], resumo: '' };
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
      const { aprovados, eliminados } = await triagem(funcao, curriculos);

      const resultados = [];
      for (const c of aprovados) {
        const r = await analisarIndividual(funcao, c);
        const enriquecido = {
          ...r,
          nome:      c.nome      || '—',
          telefone:  c.telefone  || '—',
          email:     c.email     || '—',
          remetente: c.remetente || '—',
          exp_total: calcularExperiencia(c).texto,
        };
        if ((r.detalhes?.requisitos_obrigatorios === 0) || r.score <= 25) {
          eliminados.push({ ...c, motivo_eliminacao: r.resumo || 'Não atende os requisitos obrigatórios' });
        } else {
          resultados.push(enriquecido);
        }
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
