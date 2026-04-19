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
    console.error(`[chamarIA] Groq erro: ${e.status || ''} ${e.message}`);
    if (!isRateLimit(e)) throw e;
  }
  if (!gemini) throw new Error('Limite Groq atingido e GEMINI_API_KEY não configurada.');
  try {
    const model  = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    return result.response.text().trim();
  } catch (e) {
    console.error(`[chamarIA] Gemini erro: ${e.status || ''} ${e.message}`);
    throw e;
  }
}

// ── Cálculo de experiência por período ────────────────────────────────────────
function parsePeriodoMeses(periodo) {
  if (!periodo) return 0;

  let p = periodo.trim();

  // "desde DD/MM/YYYY" ou "desde MM/YYYY" → "DD/MM/YYYY - Atual"
  const desdeMatch = p.match(/^desde\s+(.+)$/i);
  if (desdeMatch) p = desdeMatch[1].trim() + ' - Atual';

  // Remove prefixo "de " / "from "
  p = p.replace(/^de\s+/i, '');

  // Substitui separador português " à " / " ao " por " - "
  p = p.replace(/\s+[àa]\s+/i, ' - ');

  const partes = p.split(/\s*[-–]\s*/);
  if (partes.length < 2) return 0;

  const parseData = (str) => {
    const s = (str || '').trim().toLowerCase();
    if (['atual', 'presente', 'current', 'o momento', 'atualmente', 'hoje', 'now'].some(w => s.includes(w))) {
      return new Date();
    }
    // DD/MM/YYYY ou D/M/YYYY
    const fullDate = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (fullDate) {
      let ano = parseInt(fullDate[3]);
      if (ano < 100) ano += ano >= 50 ? 1900 : 2000;
      return new Date(ano, parseInt(fullDate[2]) - 1, 1);
    }
    // MM/YYYY ou M/YYYY
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

// Normaliza atividades para sempre ser array (a IA às vezes retorna string)
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.trim() ? [val] : [];
  return [];
}

// Converte capacitação que pode ser string ou objeto {curso, periodo}
function stringifyCap(cap) {
  if (!cap) return '';
  if (typeof cap === 'string') return cap;
  if (typeof cap === 'object') {
    const parts = [cap.curso || cap.nome || cap.titulo || ''];
    if (cap.periodo || cap.data) parts.push(`(${cap.periodo || cap.data})`);
    return parts.filter(Boolean).join(' ').trim();
  }
  return String(cap);
}

function calcularExperiencia(curriculo, cfg = { junior_max_meses: 12, pleno_max_meses: 36 }) {
  let totalMeses = 0;
  for (const exp of (curriculo.experiencias || [])) {
    totalMeses += parsePeriodoMeses(exp.periodo);
  }

  let nivel;
  if (totalMeses < cfg.junior_max_meses)      nivel = 'Júnior';
  else if (totalMeses < cfg.pleno_max_meses)  nivel = 'Pleno';
  else                                         nivel = 'Sênior';

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
  const habs  = Array.isArray(c.habilidades)  ? c.habilidades.join('\n  • ')                    : '—';
  const caps  = Array.isArray(c.capacitacoes) ? c.capacitacoes.map(stringifyCap).join('\n  • ') : '—';
  const form  = (c.formacao || []).map(f => `  • ${f.curso || f.nome || '—'} — ${f.instituicao || f['instituição'] || f.institution || '—'} (${f.periodo || '—'})`).join('\n');
  const exps  = (c.experiencias || []).map(e => {
    const ativ = toArray(e.atividades).map(a => `      – ${String(a).slice(0, 400)}`).join('\n');
    return `  → ${e.cargo} | ${e.empresa} | ${e.periodo || '—'}` +
      (e.descricao ? `\n    Descrição: ${e.descricao.slice(0, 500)}` : '') +
      (ativ        ? `\n    Atividades:\n${ativ}` : '');
  }).join('\n\n');

  // Quando experiencias está vazio o conteúdo está todo em descricao (parsing fallback)
  const perfilSection = (c.experiencias || []).length === 0 && c.descricao
    ? c.descricao  // usa o texto completo sem truncamento
    : (c.descricao || '—');

  return `NOME: ${c.nome || '—'}
EXPERIÊNCIA TOTAL CALCULADA: ${exp.texto} → Nível estimado pelo sistema: ${exp.nivel}

PERFIL / OBJETIVO:
${perfilSection}

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
  const habs = Array.isArray(c.habilidades)  ? c.habilidades.join(' | ')                    : '';
  const caps = Array.isArray(c.capacitacoes) ? c.capacitacoes.map(stringifyCap).join(', ')  : '';
  const exps = (c.experiencias || []).map(e => {
    // Trunca cada atividade individualmente para evitar explosão de tokens
    const ativ = toArray(e.atividades).slice(0, 6).map(a => String(a).slice(0, 150)).join('; ');
    return `${e.cargo} em ${e.empresa} (${e.periodo})`
      + (e.descricao ? ': ' + e.descricao.slice(0, 300) : '')
      + (ativ        ? ' | Atividades: ' + ativ.slice(0, 400) : '');
  }).join('\n');
  const form = (c.formacao || []).map(f => `${f.curso || f.nome || '—'} — ${f.instituicao || f['instituição'] || f.institution || '—'}`).join('; ');

  // Quando experiencias está vazio, o currículo foi salvo em modo texto livre —
  // usa o descricao completo para não esconder informações relevantes
  const semExps  = (c.experiencias || []).length === 0;
  const descricao = semExps
    ? (c.descricao || '').slice(0, 800)
    : (c.descricao || '').slice(0, 350);

  return `Nome: ${c.nome || '—'} | Exp.Total: ${exp.texto} (${exp.nivel})
Perfil: ${descricao}
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

// ── Tabela de equivalências para triagem por palavras-chave ──────────────────
const EQUIVALENCIAS = {
  softexpert:  ['softexpert', 'se suite', 'se-suite', 'se suíte', 'se-suíte', 'sesuite', 'se_suite'],
  sql:         ['sql', 'mysql', 'postgresql', 'oracle', 'sql server', 'sqlserver', 'db2', 'tsql', 'pl/sql', 'plsql'],
  processos:   ['processos', 'processo', 'bpm', 'bpmn', 'workflow', 'fluxo de trabalho', 'mapeamento de processo'],
  bpm:         ['bpm', 'bpmn', 'processos', 'processo', 'workflow', 'fluxo de trabalho'],
  ged:         ['ged', 'gestão de documentos', 'gerenciamento de documentos', 'ecm'],
  sap:         ['sap', 'sap erp', 'sap r/3', 'sap hana', 'abap', 'sap sd', 'sap fi', 'sap mm'],
  totvs:       ['totvs', 'protheus', 'rm totvs', 'rm protheus', 'advpl', 'microsiga', 'erp totvs'],
  advpl:       ['advpl', 'totvs', 'protheus', 'rm', 'microsiga', 'erp totvs'],
  protheus:    ['protheus', 'totvs', 'advpl', 'microsiga', 'rm protheus'],
  excel:       ['excel', 'planilha', 'spreadsheet', 'vba', 'excel avançado'],
  python:      ['python', 'py', 'django', 'flask', 'fastapi'],
  javascript:  ['javascript', 'js', 'typescript', 'ts', 'node', 'nodejs', 'node.js', 'react', 'vue', 'angular'],
  java:        ['java', 'spring', 'spring boot', 'springboot', 'maven', 'gradle', 'jsf'],
  csharp:      ['c#', 'csharp', '.net', 'dotnet', 'asp.net', 'net core'],
  powerbi:     ['power bi', 'powerbi', 'bi', 'business intelligence', 'tableau', 'qlik', 'looker'],
  aws:         ['aws', 'amazon web services', 'ec2', 's3', 'lambda', 'cloud aws'],
  azure:       ['azure', 'microsoft azure', 'azure devops', 'cloud azure'],
  linux:       ['linux', 'unix', 'ubuntu', 'debian', 'centos', 'rhel', 'shell', 'bash'],
  docker:      ['docker', 'kubernetes', 'k8s', 'container', 'containerização'],
  oracle_db:   ['oracle', 'oracle database', 'pl/sql', 'plsql', 'oracle erp'],
  scrum:       ['scrum', 'agile', 'ágil', 'kanban', 'jira', 'metodologia ágil', 'sprint'],
};

function getMergedEquivalencias() {
  const merged = {};
  for (const [k, v] of Object.entries(EQUIVALENCIAS))
    merged[k.toLowerCase()] = v.map(s => s.toLowerCase());
  for (const entry of db.listEquivalencias())
    merged[entry.keyword.toLowerCase()] = entry.variantes.map(s => String(s).toLowerCase());
  return merged;
}

function curriculoTextoCompleto(c) {
  return [
    c.nome || '',
    c.descricao || '',
    (c.habilidades || []).join(' '),
    (c.capacitacoes || []).map(stringifyCap).join(' '),
    (c.formacao || []).map(f => `${f.curso || f.nome || ''} ${f.instituicao || f['instituição'] || ''}`).join(' '),
    (c.experiencias || []).map(e => [
      e.cargo || '', e.empresa || '', e.descricao || '',
      ...toArray(e.atividades),
    ].join(' ')).join(' '),
  ].join(' ').toLowerCase();
}

const STOP_WORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'com', 'para', 'por', 'ao', 'à', 'ou']);

function temKeyword(textoLower, kw, equiv) {
  const kwLower = kw.toLowerCase().trim();

  // 1. Equivalência exata para a frase completa
  if (equiv[kwLower]) return equiv[kwLower].some(v => textoLower.includes(v));

  // 2. Tenta equivalência por cada palavra significativa da frase
  const palavras = kwLower.split(/\s+/).filter(p => p.length > 2 && !STOP_WORDS.has(p));
  for (const p of palavras) {
    if (equiv[p] && equiv[p].some(v => textoLower.includes(v))) return true;
  }

  // 3. Fallback: frase literal no texto
  return textoLower.includes(kwLower);
}

// ── Etapa 1: Triagem eliminatória por palavras-chave (determinística) ─────────
function triagem(funcao, curriculos) {
  const temCriterios = funcao.requisitos_obrigatorios ||
    (Array.isArray(funcao.habilidades_tecnicas) && funcao.habilidades_tecnicas.length);

  if (!temCriterios) return { aprovados: curriculos, eliminados: [] };

  // Extrai keywords obrigatórias do campo requisitos_obrigatorios
  const kwObrigatorias = (funcao.requisitos_obrigatorios || '')
    .split(/[\n,;]+/)
    .map(s => s.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean);

  const equiv    = getMergedEquivalencias();
  const aprovados  = [];
  const eliminados = [];

  for (const c of curriculos) {
    const texto   = curriculoTextoCompleto(c);
    const faltando = kwObrigatorias.filter(kw => !temKeyword(texto, kw, equiv));

    if (faltando.length === 0) {
      aprovados.push(c);
    } else {
      eliminados.push({ ...c, motivo_eliminacao: `Não apresenta evidência de: ${faltando.join(', ')}` });
    }
  }

  return { aprovados, eliminados };
}

// ── Etapa 2: Análise profunda individual ─────────────────────────────────────
async function analisarIndividual(funcao, curriculo, cfg) {
  const expCalc = calcularExperiencia(curriculo, cfg);

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
   Classifique o candidato como (critérios configurados pelo recrutador):
   • Júnior: menos de ${cfg.junior_max_meses} meses de experiência relevante
   • Pleno: de ${cfg.junior_max_meses} a ${cfg.pleno_max_meses} meses de experiência relevante
   • Sênior: mais de ${cfg.pleno_max_meses} meses de experiência relevante
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
    if (!match) throw new Error(`JSON inválido — resposta: ${resposta.slice(0, 200)}`);
    return JSON.parse(match[0]);
  } catch (err) {
    console.error(`[analisarIndividual] ID ${curriculo.id} (${curriculo.nome}): ${err.message}`);
    const erroResumido = err.message?.includes('429') || err.message?.includes('rate_limit') || err.message?.includes('quota')
      ? 'Limite de uso da IA atingido (quota/rate limit)'
      : `Falha na IA: ${err.message?.slice(0, 80) || 'erro desconhecido'}`;
    return { id: curriculo.id, score: 0, nivel: 'Baixo', nivel_candidato: '—', meses_relevantes: 0, detalhes: {}, pontos_positivos: [], pontos_negativos: [erroResumido], resumo: erroResumido, ia_falha: true, ia_erro: erroResumido };
  }
}

module.exports = function registerVagasRoutes(app, { requireAuth, registrarLog, io }) {

  function logMonitor(message, type = 'warning') {
    const entry = { message, type, timestamp: new Date().toLocaleTimeString('pt-BR') };
    if (registrarLog) registrarLog(entry);
    if (io) io.emit('log', entry);
  }

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

  // ── Config do analisador ──────────────────────────────────────────────────────
  app.get ('/api/analisador/config', requireAuth, (_req, res) => res.json(db.getAnalisadorConfig()));
  app.post('/api/analisador/config', requireAuth, (req, res) => {
    const { junior_max_meses, pleno_max_meses } = req.body;
    if (!junior_max_meses || !pleno_max_meses) return res.status(400).json({ error: 'Campos obrigatórios' });
    if (Number(junior_max_meses) >= Number(pleno_max_meses)) return res.status(400).json({ error: 'Limite Júnior deve ser menor que Pleno' });
    db.setAnalisadorConfig({ junior_max_meses: Number(junior_max_meses), pleno_max_meses: Number(pleno_max_meses) });
    res.json({ ok: true });
  });

  // ── Análises Salvas ──────────────────────────────────────────────────────────
  app.get('/api/analises', requireAuth, (_req, res) => {
    res.json(db.listAnalises());
  });

  app.get('/api/analises/:id', requireAuth, (req, res) => {
    const a = db.getAnalise(req.params.id);
    if (!a) return res.status(404).json({ error: 'Não encontrada' });
    res.json(a);
  });

  app.post('/api/analises', requireAuth, (req, res) => {
    const { force, ...analise } = req.body;
    if (!analise.id) return res.status(400).json({ error: 'ID obrigatório' });
    const existing = db.getAnalise(analise.id);
    if (existing && !force) {
      return res.status(409).json({
        conflict: true,
        data_existente: existing.data,
        funcao_nome:    existing.funcao_nome,
      });
    }
    db.saveAnalise({ ...analise, data: new Date().toISOString() });
    res.json({ ok: true });
  });

  app.delete('/api/analises/:id', requireAuth, (req, res) => {
    const ok = db.deleteAnalise(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });

  // ── Analisador ───────────────────────────────────────────────────────────────
  app.post('/api/analisador/analisar', requireAuth, async (req, res) => {
    const { funcao_id, vaga_id } = req.body;
    const funcao = db.getFuncao(Number(funcao_id));
    if (!funcao) return res.status(404).json({ error: 'Função não encontrada' });

    const curriculos = db.listCurriculos();
    if (!curriculos.length) return res.json({ resultados: [], eliminados: [], total: 0 });

    try {
      const cfg = db.getAnalisadorConfig();
      const { aprovados, eliminados } = triagem(funcao, curriculos);

      const resultados = [];
      for (const c of aprovados) {
        const r = await analisarIndividual(funcao, c, cfg);

        if (r.ia_falha) {
          logMonitor(`[Analisador] Falha IA ao analisar "${c.nome || c.id}" para vaga "${funcao.nome}": ${r.ia_erro}`, 'error');
        }

        const enriquecido = {
          ...r,
          nome:      c.nome      || '—',
          telefone:  c.telefone  || '—',
          email:     c.email     || '—',
          remetente: c.remetente || '—',
          exp_total: calcularExperiencia(c, cfg).texto,
        };

        if (r.ia_falha) {
          // IA falhou: mantém o candidato nos aprovados com score neutro
          resultados.push({ ...enriquecido, score: 50, nivel: 'Indefinido', resumo: `⚠️ ${r.ia_erro}` });
        } else if ((r.detalhes?.requisitos_obrigatorios === 0) || r.score <= 25) {
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
        funcao_id:        funcao.id,
        vaga_id:          vaga_id ? Number(vaga_id) : null,
        triagem_ativa:    !!(funcao.requisitos_obrigatorios || (Array.isArray(funcao.habilidades_tecnicas) && funcao.habilidades_tecnicas.length)),
      });
    } catch (err) {
      res.status(500).json({ error: `Erro na análise: ${err.message}` });
    }
  });

  // ── Equivalências ─────────────────────────────────────────────────────────────
  app.get('/api/equivalencias', requireAuth, (_req, res) => {
    const dbEntries = db.listEquivalencias();
    const dbMap     = new Map(dbEntries.map(e => [e.keyword, e.variantes]));
    const result    = [];

    for (const [keyword, builtinVar] of Object.entries(EQUIVALENCIAS)) {
      if (dbMap.has(keyword)) {
        result.push({ keyword, variantes: dbMap.get(keyword), builtin: true, overridden: true });
      } else {
        result.push({ keyword, variantes: builtinVar, builtin: true, overridden: false });
      }
    }
    for (const entry of dbEntries) {
      if (!EQUIVALENCIAS[entry.keyword]) {
        result.push({ keyword: entry.keyword, variantes: entry.variantes, builtin: false, overridden: false });
      }
    }
    result.sort((a, b) => a.keyword.localeCompare(b.keyword));
    res.json(result);
  });

  app.post('/api/equivalencias', requireAuth, (req, res) => {
    const { keyword, variantes } = req.body;
    if (!keyword?.trim() || !Array.isArray(variantes))
      return res.status(400).json({ error: 'keyword e variantes[] obrigatórios' });
    db.saveEquivalencia({ keyword, variantes });
    res.json({ ok: true });
  });

  app.delete('/api/equivalencias/:keyword', requireAuth, (req, res) => {
    db.deleteEquivalencia(req.params.keyword);
    res.json({ ok: true });
  });

  // ── Sugerir equivalências via IA (keyword única — modal de Configurações) ─────
  app.post('/api/equivalencias/sugerir', requireAuth, async (req, res) => {
    const { keyword } = req.body;
    if (!keyword?.trim()) return res.status(400).json({ error: 'keyword obrigatório' });

    const system = `Você é especialista em recrutamento no Brasil.
Para uma habilidade ou tecnologia, retorne os termos equivalentes que aparecem em currículos brasileiros: variações de nome, siglas, produtos da mesma família, versões ou nomenclaturas alternativas.
Responda SOMENTE com JSON array de strings em minúsculo, sem markdown, sem explicações.`;

    const user = `Habilidade: "${keyword.trim()}"
Retorne array JSON com 5 a 10 termos equivalentes/relacionados que recrutadores encontrariam em currículos no Brasil.
Exemplo para "advpl": ["totvs","protheus","microsiga","rm protheus","erp totvs","advpl 12"]
Responda apenas o array JSON.`;

    try {
      const resposta  = await chamarIA(system, user, 400);
      const match     = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Resposta da IA não retornou JSON válido');
      const variantes = JSON.parse(match[0]).map(v => String(v).toLowerCase().trim()).filter(Boolean);
      res.json({ variantes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sugerir equivalências em lote via IA (salva automaticamente as novas) ─────
  app.post('/api/equivalencias/sugerir-lote', requireAuth, async (req, res) => {
    const { keywords, preview } = req.body;
    if (!Array.isArray(keywords) || !keywords.length)
      return res.status(400).json({ error: 'keywords[] obrigatório' });

    const equiv        = getMergedEquivalencias();
    const novas        = keywords.filter(kw => !equiv[kw.toLowerCase().trim()]).map(kw => kw.trim());
    const jaExistentes = keywords.filter(kw =>  equiv[kw.toLowerCase().trim()]).map(kw => kw.toLowerCase());

    if (!novas.length) return res.json({ geradas: {}, ja_existentes: jaExistentes });

    const system = `Você é especialista em recrutamento no Brasil.
Para cada habilidade/tecnologia listada, retorne os termos equivalentes que aparecem em currículos brasileiros: variações de nome, siglas, produtos da mesma família, versões, tecnologias relacionadas.
Responda SOMENTE com JSON objeto válido, sem markdown, sem explicações.`;

    const user = `Habilidades: ${JSON.stringify(novas)}
Para cada uma, retorne 5 a 10 equivalentes em minúsculo.
Formato exato: {"keyword1":["var1","var2",...],"keyword2":[...]}`;

    try {
      const resposta = await chamarIA(system, user, 1000);
      const match    = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Resposta da IA não retornou JSON válido');

      const parsed  = JSON.parse(match[0]);
      const geradas = {};

      for (const [kw, variantes] of Object.entries(parsed)) {
        if (!Array.isArray(variantes)) continue;
        const keyword = kw.toLowerCase().trim();
        const vars    = variantes.map(v => String(v).toLowerCase().trim()).filter(Boolean);
        if (!keyword || !vars.length) continue;
        if (!preview) db.saveEquivalencia({ keyword, variantes: vars });
        geradas[keyword] = vars;
      }

      res.json({ geradas, ja_existentes: jaExistentes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
