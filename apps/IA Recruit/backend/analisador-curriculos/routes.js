const db       = require('./database');
const Groq     = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const configDb = require('../configuracoes/database');
const usageDb  = require('../ia/usage-db');

const RICH_TEXT_FIELDS_FUNCAO = ['descricao', 'requisitos_obrigatorios', 'requisitos_desejaveis'];
const RICH_TEXT_FIELDS_VAGA = ['observacoes'];

function sanitizeRichText(value) {
  if (value === undefined || value === null) return '';
  const html = String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  return html
    .replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (full, rawTag, attrs) => {
      const tag = String(rawTag || '').toLowerCase();
      if (!['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'span'].includes(tag)) return '';
      if (tag !== 'span') return `<${tag}>`;

      const color = String(attrs || '').match(/color\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i);
      return color ? `<span style="color:${color[1]}">` : '<span>';
    })
    .replace(/<\/([a-z][a-z0-9]*)\s*>/gi, (full, rawTag) => {
      const tag = String(rawTag || '').toLowerCase();
      return ['p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'span'].includes(tag) ? `</${tag}>` : '';
    })
    .replace(/<br>\s*<\/br>/gi, '<br>')
    .replace(/<p>\s*<\/p>/gi, '<p><br></p>')
    .trim();
}

function richTextToPlain(value) {
  return sanitizeRichText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(?:p|strong|b|em|i|u|ul|ol|span)[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizePayload(body, fields) {
  const clean = { ...(body || {}) };
  for (const field of fields) {
    if (field in clean) clean[field] = sanitizeRichText(clean[field]);
  }
  return clean;
}

function _getGroq(empresaId) {
  const key = configDb.getApiKey('groq_api_key', empresaId) || process.env.GROQ_API_KEY;
  if (!key) throw new Error('Chave Groq não configurada. Acesse Configurações → Chaves de API.');
  return new Groq({ apiKey: key });
}

function _getGemini(empresaId) {
  const key = configDb.getApiKey('gemini_api_key', empresaId) || process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

function isRateLimit(err) {
  return err?.status === 429 || err?.message?.includes('rate_limit') || err?.message?.includes('Rate limit');
}

async function chamarIA(systemPrompt, userPrompt, maxTokens = 2000, empresaId) {
  const groq = _getGroq(empresaId);
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile', temperature: 0.1, max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
    });
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      usage: res.usage,
      ok: true,
    });
    return res.choices[0].message.content.trim();
  } catch (e) {
    usageDb.recordUsage(empresaId, {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      usage: null,
      ok: false,
      error: e.message,
    });
    console.error(`[chamarIA] Groq erro: ${e.status || ''} ${e.message}`);
    if (!isRateLimit(e)) throw e;
  }
  const gemini = _getGemini(empresaId);
  if (!gemini) throw new Error('Limite Groq atingido e chave Gemini não configurada.');
  try {
    const modelName = 'gemini-2.0-flash';
    const model  = gemini.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    usageDb.recordUsage(empresaId, {
      provider: 'gemini',
      model: modelName,
      usage: result.response?.usageMetadata,
      ok: true,
    });
    return result.response.text().trim();
  } catch (e) {
    usageDb.recordUsage(empresaId, {
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      usage: null,
      ok: false,
      error: e.message,
    });
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
      (e.descricao ? `\n    Descrição: ${richTextToPlain(e.descricao).slice(0, 500)}` : '') +
      (ativ        ? `\n    Atividades:\n${ativ}` : '');
  }).join('\n\n');

  // Quando experiencias está vazio o conteúdo está todo em descricao (parsing fallback)
  const perfilSection = (c.experiencias || []).length === 0 && c.descricao
    ? richTextToPlain(c.descricao)  // usa o texto completo sem truncamento
    : (richTextToPlain(c.descricao) || '—');

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
      + (e.descricao ? ': ' + richTextToPlain(e.descricao).slice(0, 300) : '')
      + (ativ        ? ' | Atividades: ' + ativ.slice(0, 400) : '');
  }).join('\n');
  const form = (c.formacao || []).map(f => `${f.curso || f.nome || '—'} — ${f.instituicao || f['instituição'] || f.institution || '—'}`).join('; ');

  // Quando experiencias está vazio, o currículo foi salvo em modo texto livre —
  // usa o descricao completo para não esconder informações relevantes
  const semExps  = (c.experiencias || []).length === 0;
  const descricao = semExps
    ? richTextToPlain(c.descricao || '').slice(0, 800)
    : richTextToPlain(c.descricao || '').slice(0, 350);

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
Descrição: ${richTextToPlain(funcao.descricao) || '—'}
Requisitos Obrigatórios: ${richTextToPlain(funcao.requisitos_obrigatorios) || '—'}
Requisitos Desejáveis: ${richTextToPlain(funcao.requisitos_desejaveis) || '—'}
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

function getMergedEquivalencias(empresaId) {
  const merged = {};
  for (const [k, v] of Object.entries(EQUIVALENCIAS))
    merged[k.toLowerCase()] = v.map(s => s.toLowerCase());
  for (const entry of db.listEquivalencias(empresaId))
    merged[entry.keyword.toLowerCase()] = entry.variantes.map(s => String(s).toLowerCase());
  return merged;
}

function curriculoTextoCompleto(c) {
  return [
    c.nome || '',
    richTextToPlain(c.descricao || ''),
    (c.habilidades || []).join(' '),
    (c.capacitacoes || []).map(stringifyCap).join(' '),
    (c.formacao || []).map(f => `${f.curso || f.nome || ''} ${f.instituicao || f['instituição'] || ''}`).join(' '),
    (c.experiencias || []).map(e => [
      e.cargo || '', e.empresa || '', richTextToPlain(e.descricao || ''),
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

// ── Etapa 1: Triagem por palavras-chave — apenas informativa, não elimina ─────
function triagem(funcao, curriculos) {
  // A triagem não elimina candidatos; a pontuação da IA com corte_minimo decide quem passa.
  return { aprovados: curriculos, eliminados: [] };
}

// ── Etapa 2: Análise profunda individual ─────────────────────────────────────
async function analisarIndividual(funcao, curriculo, cfg, pesos, empresaId) {
  const P = pesos;

  const system = `Você é um recrutador sênior experiente. Avalie o currículo completo abaixo com base no perfil da vaga.

RUBRICA DE PONTUAÇÃO (total 100 pts):

1. REQUISITOS OBRIGATÓRIOS — até ${P.requisitos_obrigatorios} pts
   Percorra TODAS as seções do currículo (perfil, habilidades, capacitações, descrições e atividades de cada experiência).
   Pontuação proporcional: (requisitos atendidos ÷ total de requisitos) × ${P.requisitos_obrigatorios}
   • Atende todos → ${P.requisitos_obrigatorios} pts
   • Não atende nenhum → 0 pts — sem penalidade adicional.

2. REQUISITOS DESEJÁVEIS — até ${P.requisitos_desejados} pts
   Percorra TODAS as seções do currículo.
   Pontuação proporcional: (desejáveis atendidos ÷ total de desejáveis) × ${P.requisitos_desejados}
   • Não atende nenhum → 0 pts — sem penalidade.

3. FORMAÇÃO ACADÊMICA — até ${P.formacao} pts
   • Atende ou supera o exigido → ${P.formacao} pts
   • Próxima da área → ${Math.round(P.formacao * 0.6)} pts
   • Não atende → 0 pts

4. HABILIDADES TÉCNICAS — até ${P.habilidades} pts
   Percorra TODAS as seções do currículo. Considere equivalências (ex: SE SUITE = SoftExpert).
   Pontuação proporcional: (habilidades dominadas ÷ total listadas) × ${P.habilidades}
   • Nenhuma → 0 pts — sem penalidade.

IMPORTANTE: Não há penalidade por ausência de requisitos. Candidatos que não atendem um critério simplesmente não ganham os pontos daquele critério.
Candidatos com score ≥ ${P.corte_minimo} pts são selecionados; abaixo disso são desclassificados.

Responda SOMENTE com JSON válido, sem markdown.`;

  const user = `PERFIL DA VAGA:\n${perfilFuncao(funcao)}\n\nCURRÍCULO COMPLETO:\n${curriculoCompleto(curriculo)}\n\nRetorne:\n{"id":${curriculo.id},"score":0-100,"nivel":"Alto|Médio|Baixo","nivel_candidato":"Júnior|Pleno|Sênior","detalhes":{"requisitos_obrigatorios":0-${P.requisitos_obrigatorios},"requisitos_desejados":0-${P.requisitos_desejados},"formacao":0-${P.formacao},"habilidades_tecnicas":0-${P.habilidades}},"pontos_positivos":["..."],"pontos_negativos":["..."],"resumo":"2 frases objetivas sobre a aderência do candidato à vaga"}`;

  try {
    const resposta = await chamarIA(system, user, 1500, empresaId);
    const match = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`JSON inválido — resposta: ${resposta.slice(0, 200)}`);
    return JSON.parse(match[0]);
  } catch (err) {
    console.error(`[analisarIndividual] ID ${curriculo.id} (${curriculo.nome}): ${err.message}`);
    const erroResumido = err.message?.includes('429') || err.message?.includes('rate_limit') || err.message?.includes('quota')
      ? 'Limite de uso da IA atingido (quota/rate limit)'
      : `Falha na IA: ${err.message?.slice(0, 80) || 'erro desconhecido'}`;
    return { id: curriculo.id, score: 0, nivel: 'Baixo', nivel_candidato: '—', detalhes: {}, pontos_positivos: [], pontos_negativos: [erroResumido], resumo: erroResumido, ia_falha: true, ia_erro: erroResumido };
  }
}

// ── Resolvedores de contexto de empresa (suporte MDI per-tab) ────────────────
const _crud = require('../crud');

function _resolverEid(req) {
  const explicit = Number(req.body?.empresa_id || req.query?.empresa_id || 0);
  if (!explicit) return req.session.empresa_id;
  const { empresas: acesso, role } = req.session;
  const ok = role === 'admin' || acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(explicit));
  return ok ? explicit : req.session.empresa_id;
}

function _resolverEnome(req) {
  const eid = _resolverEid(req);
  if (String(eid) === String(req.session.empresa_id)) return req.session.empresa_nome || '';
  const emp = _crud.buscarPorId('empresas', eid);
  return emp?.razao_social || '';
}

module.exports = function registerVagasRoutes(app, { requireAuth, requireEmpresa, registrarLog, io }) {

  function logMonitor(message, type = 'warning') {
    const entry = { message, type, timestamp: new Date().toLocaleTimeString('pt-BR') };
    if (registrarLog) registrarLog(entry);
    if (io) io.emit('log', entry);
  }

  // ── Funções ──────────────────────────────────────────────────────────────────
  app.get   ('/api/funcoes',     requireAuth, requireEmpresa, (req, res) => res.json(db.listFuncoes(_resolverEid(req))));
  app.get   ('/api/funcoes/:id', requireAuth, requireEmpresa, (req, res) => {
    const f = db.getFuncao(_resolverEid(req), Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Não encontrada' });
    res.json(f);
  });
  app.post  ('/api/funcoes',     requireAuth, requireEmpresa, (req, res) => {
    const id = db.saveFuncao(_resolverEid(req), sanitizePayload(req.body, RICH_TEXT_FIELDS_FUNCAO));
    res.json({ ok: true, id });
  });
  app.put   ('/api/funcoes/:id', requireAuth, requireEmpresa, (req, res) => {
    const ok = db.updateFuncao(_resolverEid(req), Number(req.params.id), sanitizePayload(req.body, RICH_TEXT_FIELDS_FUNCAO));
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });
  app.delete('/api/funcoes/:id', requireAuth, requireEmpresa, (req, res) => {
    const ok = db.deleteFuncao(_resolverEid(req), Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });

  // ── Vagas ────────────────────────────────────────────────────────────────────
  app.get   ('/api/vagas',     requireAuth, requireEmpresa, (req, res) => res.json(db.listVagas(_resolverEid(req))));
  app.get   ('/api/vagas/:id', requireAuth, requireEmpresa, (req, res) => {
    const v = db.getVaga(_resolverEid(req), Number(req.params.id));
    if (!v) return res.status(404).json({ error: 'Não encontrada' });
    res.json(v);
  });
  app.post  ('/api/vagas',     requireAuth, requireEmpresa, (req, res) => {
    const id = db.saveVaga(_resolverEid(req), sanitizePayload(req.body, RICH_TEXT_FIELDS_VAGA));
    res.json({ ok: true, id });
  });
  app.put   ('/api/vagas/:id', requireAuth, requireEmpresa, (req, res) => {
    const ok = db.updateVaga(_resolverEid(req), Number(req.params.id), sanitizePayload(req.body, RICH_TEXT_FIELDS_VAGA));
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });
  app.delete('/api/vagas/:id', requireAuth, requireEmpresa, (req, res) => {
    const ok = db.deleteVaga(_resolverEid(req), Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });

  // ── Config do analisador ──────────────────────────────────────────────────────
  app.get ('/api/analisador/config', requireAuth, requireEmpresa, (req, res) => res.json(db.getAnalisadorConfig(_resolverEid(req))));
  app.post('/api/analisador/config', requireAuth, requireEmpresa, (req, res) => {
    const { junior_max_meses, pleno_max_meses } = req.body;
    if (!junior_max_meses || !pleno_max_meses) return res.status(400).json({ error: 'Campos obrigatórios' });
    if (Number(junior_max_meses) >= Number(pleno_max_meses)) return res.status(400).json({ error: 'Limite Júnior deve ser menor que Pleno' });
    db.setAnalisadorConfig(_resolverEid(req), { junior_max_meses: Number(junior_max_meses), pleno_max_meses: Number(pleno_max_meses) });
    res.json({ ok: true });
  });

  // ── Pesos de Pontuação ────────────────────────────────────────────────────────
  app.get('/api/pesos-pontuacao', requireAuth, requireEmpresa, (req, res) => {
    res.json(db.getPesosPontuacao(_resolverEid(req)));
  });

  app.post('/api/pesos-pontuacao', requireAuth, requireEmpresa, (req, res) => {
    const { requisitos_obrigatorios, requisitos_desejados, formacao, habilidades, corte_minimo } = req.body;
    const campos = { requisitos_obrigatorios, requisitos_desejados, formacao, habilidades };
    for (const [k, v] of Object.entries(campos)) {
      if (v === undefined || v === null || isNaN(Number(v)) || Number(v) < 0)
        return res.status(400).json({ error: `Campo inválido: ${k}` });
    }
    const soma = Object.values(campos).reduce((s, v) => s + Number(v), 0);
    if (soma !== 100)
      return res.status(400).json({ error: `A soma dos pesos deve ser exatamente 100. Atual: ${soma}` });
    if (!corte_minimo || isNaN(Number(corte_minimo)) || Number(corte_minimo) < 1 || Number(corte_minimo) > 99)
      return res.status(400).json({ error: 'Pontuação mínima deve ser entre 1 e 99' });
    db.setPesosPontuacao(_resolverEid(req), {
      requisitos_obrigatorios: Number(requisitos_obrigatorios),
      requisitos_desejados:    Number(requisitos_desejados),
      formacao:                Number(formacao),
      habilidades:             Number(habilidades),
      corte_minimo:            Number(corte_minimo),
    });
    res.json({ ok: true });
  });

  // ── Análises Salvas ──────────────────────────────────────────────────────────
  app.get('/api/analises', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const empresaNome = _resolverEnome(req);
    db.backfillAnalisesEmpresa(eid, empresaNome);
    res.json(db.listAnalises(eid));
  });

  app.get('/api/analises/:id', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    db.backfillAnalisesEmpresa(eid, _resolverEnome(req));
    const a = db.getAnalise(eid, req.params.id);
    if (!a) return res.status(404).json({ error: 'Não encontrada' });
    res.json(a);
  });

  app.post('/api/analises', requireAuth, requireEmpresa, (req, res) => {
    const eid = _resolverEid(req);
    const { force, ...analise } = req.body;
    if (!analise.id) return res.status(400).json({ error: 'ID obrigatório' });
    const existingByVaga = analise.vaga_id ? db.getAnaliseByVaga(eid, analise.vaga_id) : null;
    if (existingByVaga) {
      return res.status(409).json({
        conflict: true,
        vaga_ja_analisada: true,
        analise_id: existingByVaga.id,
        data_existente: existingByVaga.data,
        funcao_nome: existingByVaga.funcao_nome,
        error: 'Esta vaga ja possui uma analise salva no historico.',
      });
    }
    const existing = db.getAnalise(eid, analise.id);
    if (existing && !force) {
      return res.status(409).json({
        conflict: true,
        data_existente: existing.data,
        funcao_nome:    existing.funcao_nome,
      });
    }
    db.saveAnalise(eid, {
      ...analise,
      empresa_id: Number(eid),
      empresa_nome: _resolverEnome(req),
      data: new Date().toISOString(),
    });
    res.json({ ok: true });
  });

  app.delete('/api/analises/:id', requireAuth, requireEmpresa, (req, res) => {
    const ok = db.deleteAnalise(_resolverEid(req), req.params.id);
    if (!ok) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ ok: true });
  });

  // ── Analisador ───────────────────────────────────────────────────────────────
  app.post('/api/analisador/analisar', requireAuth, requireEmpresa, async (req, res) => {
    const eid = _resolverEid(req);
    const { funcao_id, vaga_id, somente_vaga } = req.body;
    const funcao = db.getFuncao(eid, Number(funcao_id));
    const analiseExistente = vaga_id ? db.getAnaliseByVaga(eid, vaga_id) : null;
    if (analiseExistente) {
      return res.status(409).json({
        error: 'Esta vaga ja possui uma analise salva no historico.',
        vaga_ja_analisada: true,
        analise_id: analiseExistente.id,
        data_existente: analiseExistente.data,
      });
    }
    if (!funcao) return res.status(404).json({ error: 'Função não encontrada' });

    let curriculos = db.listCurriculos(eid);

    if (somente_vaga && vaga_id) {
      const psDb = require('../processo-seletivo/database');
      const ids  = psDb.getCurriculoIdsByVaga(eid, Number(vaga_id));
      curriculos = curriculos.filter(c => ids.includes(c.id));
    }

    if (!curriculos.length) return res.json({ resultados: [], eliminados: [], total: 0 });

    try {
      const cfg   = db.getAnalisadorConfig(eid);
      const pesos = db.getPesosPontuacao(eid);
      const { aprovados, eliminados } = triagem(funcao, curriculos);

      const resultados = [];
      for (const c of aprovados) {
        const r = await analisarIndividual(funcao, c, cfg, pesos, eid);

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
          resultados.push({ ...enriquecido, score: pesos.corte_minimo, nivel: 'Indefinido', resumo: `⚠️ ${r.ia_erro}` });
        } else if (r.score < pesos.corte_minimo) {
          eliminados.push({ ...c, motivo_eliminacao: r.resumo || `Pontuação abaixo do mínimo (${r.score}/${pesos.corte_minimo} pts)` });
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
        pesos,
      });
    } catch (err) {
      res.status(500).json({ error: `Erro na análise: ${err.message}` });
    }
  });

  // ── Equivalências ─────────────────────────────────────────────────────────────
  app.get('/api/equivalencias', requireAuth, requireEmpresa, (req, res) => {
    const eid       = _resolverEid(req);
    const dbEntries = db.listEquivalencias(eid);
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

  app.post('/api/equivalencias', requireAuth, requireEmpresa, (req, res) => {
    const { keyword, variantes } = req.body;
    if (!keyword?.trim() || !Array.isArray(variantes))
      return res.status(400).json({ error: 'keyword e variantes[] obrigatórios' });
    db.saveEquivalencia(_resolverEid(req), { keyword, variantes });
    res.json({ ok: true });
  });

  app.delete('/api/equivalencias/:keyword', requireAuth, requireEmpresa, (req, res) => {
    db.deleteEquivalencia(_resolverEid(req), req.params.keyword);
    res.json({ ok: true });
  });

  // ── Sugerir equivalências via IA (keyword única — modal de Configurações) ─────
  app.post('/api/equivalencias/sugerir', requireAuth, requireEmpresa, async (req, res) => {
    const eid = _resolverEid(req);
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
      const resposta  = await chamarIA(system, user, 400, eid);
      const match     = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Resposta da IA não retornou JSON válido');
      const variantes = JSON.parse(match[0]).map(v => String(v).toLowerCase().trim()).filter(Boolean);
      res.json({ variantes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sugerir equivalências em lote via IA (salva automaticamente as novas) ─────
  app.post('/api/equivalencias/sugerir-lote', requireAuth, requireEmpresa, async (req, res) => {
    const eid              = _resolverEid(req);
    const { keywords, preview } = req.body;
    if (!Array.isArray(keywords) || !keywords.length)
      return res.status(400).json({ error: 'keywords[] obrigatório' });

    const equiv        = getMergedEquivalencias(eid);
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
      const resposta = await chamarIA(system, user, 1000, eid);
      const match    = resposta.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Resposta da IA não retornou JSON válido');

      const parsed  = JSON.parse(match[0]);
      const geradas = {};

      for (const [kw, variantes] of Object.entries(parsed)) {
        if (!Array.isArray(variantes)) continue;
        const keyword = kw.toLowerCase().trim();
        const vars    = variantes.map(v => String(v).toLowerCase().trim()).filter(Boolean);
        if (!keyword || !vars.length) continue;
        if (!preview) db.saveEquivalencia(eid, { keyword, variantes: vars });
        geradas[keyword] = vars;
      }

      res.json({ geradas, ja_existentes: jaExistentes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
