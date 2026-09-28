'use strict';

const https = require('https');
const chamadoRepo = require('../repositories/chamado-repository');

const PERFIS = {
  protheus: {
    nome: 'TOTVS Protheus',
    termos: ['protheus', 'totvs', 'advpl', 'tlpp', 'appserver', 'dbaccess', 'smartclient', 'rpo', 'sx2', 'sx3', 'rest', 'soap', 'tss'],
    fontes: [
      { nome: 'TDN TOTVS', url: 'https://tdn.totvs.com/' },
      { nome: 'Busca TOTVS/TDN', url: 'https://www.google.com/search?q=site%3Atdn.totvs.com+{query}' },
      { nome: 'Central TOTVS', url: 'https://www.google.com/search?q=site%3Acentraldeatendimento.totvs.com+{query}' },
      { nome: 'Base TOTVS Protheus', url: 'https://www.google.com/search?q=site%3Atotvs.com+Protheus+{query}' },
      { nome: 'Busca geral Protheus', url: 'https://www.google.com/search?q={query}' },
    ],
    instrucao: 'Priorize documentação oficial TOTVS/TDN e evidências de ADVPL/TLPP, AppServer, DBAccess, SmartClient, RPO, dicionário SX e integrações REST/SOAP.',
  },
  softexpert: {
    nome: 'SoftExpert',
    termos: ['softexpert', 'workflow', 'wfprocess', 'dynitsm', 'dynitsmgridregistr', 'seblob', 'formulario', 'processo', 'aguardanretorno'],
    fontes: [
      { nome: 'Base oficial SoftExpert', url: 'https://www.google.com/search?q=site%3Asoftexpert.com+{query}' },
      { nome: 'Help/Docs SoftExpert', url: 'https://www.google.com/search?q=site%3Ahelp.softexpert.com+{query}' },
      { nome: 'Busca SoftExpert', url: 'https://www.google.com/search?q=SoftExpert+{query}' },
      { nome: 'Busca geral SoftExpert', url: 'https://www.google.com/search?q={query}' },
    ],
    instrucao: 'Priorize evidências de Workflow, formulários, regras do processo, permissões, anexos, status do processo e histórico de posicionamentos.',
  },
  integracao: {
    nome: 'Integração/API',
    termos: ['api', 'rest', 'soap', 'json', 'xml', 'http', 'token', 'timeout', 'payload', 'webservice', 'integração', 'integracao'],
    fontes: [
      { nome: 'Busca técnica integração', url: 'https://www.google.com/search?q={query}' },
    ],
    instrucao: 'Priorize payloads, códigos HTTP, autenticação, timeout, mapeamento de campos, logs de ida/volta e contrato da API.',
  },
  generico: {
    nome: 'Sistema genérico',
    termos: [],
    fontes: [
      { nome: 'Busca técnica geral', url: 'https://www.google.com/search?q={query}' },
    ],
    instrucao: 'Não presuma plataforma. Classifique evidências, peça dados técnicos mínimos e use a base histórica interna quando houver similaridade.',
  },
};

function _normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function _textoDoContexto({ chamado, atendimento, mensagens = [], anexos = [], texto = '' }) {
  return [
    chamado?.produto, chamado?.familia, chamado?.modulo, chamado?.servico,
    chamado?.tipoChamado, chamado?.tipoChamadoFinal, chamado?.titulo, chamado?.assunto,
    chamado?.breveDescricao, chamado?.descricao, chamado?.informacoesAdicionais,
    atendimento?.conteudoBruto, texto,
    ...mensagens.map(m => m.conteudo),
    ...anexos.map(a => `${a.nomeOriginal} ${a.conteudoExtraido || ''}`),
  ].filter(Boolean).join('\n');
}

// chamado.produto vem do cadastro estruturado do SoftExpert (ex. "Protheus"),
// não de texto livre — é um sinal confiável por si só, então pesa mais que
// uma palavra solta encontrada no meio da descrição. Sem isso, um chamado
// comum de usuário final (produto="Protheus" mas descrição em português,
// sem jargão como "ADVPL"/"TLPP") nunca batia o limiar de 2 pontos e caía
// em "genérico" (bug real encontrado em 2026-09, testado com chamado
// #036612: produto=Protheus, score=1, classificado errado como genérico).
const PESO_PRODUTO_ESTRUTURADO = 3;

function detectarDominio(ctx = {}) {
  const texto = _normalizar(_textoDoContexto(ctx));
  const produto = _normalizar(ctx.chamado?.produto || '');
  const scores = {};
  for (const [dominio, perfil] of Object.entries(PERFIS)) {
    if (dominio === 'generico') continue;
    let score = perfil.termos.reduce((acc, termo) => acc + (texto.includes(_normalizar(termo)) ? 1 : 0), 0);
    if (produto && perfil.termos.some(termo => produto.includes(_normalizar(termo)))) {
      score += PESO_PRODUTO_ESTRUTURADO;
    }
    scores[dominio] = score;
  }

  if ((scores.protheus || 0) >= 2) return { dominio: 'protheus', confianca: scores.protheus >= 4 ? 'alta' : 'media', scores };
  if ((scores.softexpert || 0) >= 2) return { dominio: 'softexpert', confianca: scores.softexpert >= 4 ? 'alta' : 'media', scores };
  if ((scores.integracao || 0) >= 2) return { dominio: 'integracao', confianca: 'media', scores };
  return { dominio: 'generico', confianca: 'baixa', scores };
}

function _termosRelevantes(texto, max = 10) {
  const stop = new Set(['para', 'com', 'sem', 'erro', 'chamado', 'problema', 'sistema', 'cliente', 'usuario', 'usuarios', 'tela', 'processo', 'quando', 'onde', 'este', 'esta', 'isso', 'nao', 'não', 'mais', 'pela', 'pelo', 'das', 'dos']);
  const words = _normalizar(texto)
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stop.has(w));
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, max);
}

function montarConsultas(ctx = {}) {
  const det = detectarDominio(ctx);
  const perfil = PERFIS[det.dominio] || PERFIS.generico;
  const texto = _textoDoContexto(ctx);
  const termos = _termosRelevantes(texto, 8);
  const base = termos.join(' ');
  const consultas = [];

  if (det.dominio === 'protheus') {
    consultas.push(`site:tdn.totvs.com Protheus ${base}`);
    consultas.push(`TOTVS Protheus ${base}`);
    consultas.push(`ADVPL TLPP ${base}`);
  } else if (det.dominio === 'softexpert') {
    consultas.push(`SoftExpert Workflow ${base}`);
    consultas.push(`SoftExpert ${base}`);
  } else if (det.dominio === 'integracao') {
    consultas.push(`integração API ${base}`);
    consultas.push(`REST SOAP ${base}`);
  } else {
    consultas.push(base || 'erro sistema suporte técnico');
  }

  const normalizadas = [...new Set(consultas.map(q => q.trim()).filter(Boolean))].slice(0, 4);
  const links = normalizadas.flatMap(q => perfil.fontes.map(f => ({
    fonte: f.nome,
    url: f.url.replace('{query}', encodeURIComponent(q)),
    consulta: q,
  })));

  return { dominio: det.dominio, confianca: det.confianca, perfil, consultas: normalizadas, links };
}

function _postJson({ hostname, path, headers, body, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), ...headers } }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = { raw: data }; }
        if (res.statusCode >= 400) return reject(new Error(parsed.message || parsed.error || `HTTP ${res.statusCode}`));
        resolve(parsed);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout de ${Math.round(timeoutMs / 1000)}s na pesquisa técnica.`)));
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

function _getJson({ hostname, path, headers, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = { raw: data }; }
        if (res.statusCode >= 400) return reject(new Error(parsed.message || parsed.error || `HTTP ${res.statusCode}`));
        resolve(parsed);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout de ${Math.round(timeoutMs / 1000)}s na pesquisa técnica.`)));
    req.on('error', reject);
    req.end();
  });
}

async function _buscarSerper(consultas, limitePorConsulta) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  const resultados = [];
  for (const q of consultas) {
    const data = await _postJson({
      hostname: 'google.serper.dev',
      path: '/search',
      headers: { 'X-API-KEY': key },
      body: { q, num: limitePorConsulta },
    });
    for (const item of data.organic || []) {
      resultados.push({ titulo: item.title, url: item.link, trecho: item.snippet, fonte: 'Serper/Google', consulta: q });
    }
  }
  return resultados;
}

async function _buscarBing(consultas, limitePorConsulta) {
  const key = process.env.BING_SEARCH_API_KEY;
  if (!key) return [];
  const resultados = [];
  for (const q of consultas) {
    const data = await _getJson({
      hostname: 'api.bing.microsoft.com',
      path: `/v7.0/search?q=${encodeURIComponent(q)}&count=${limitePorConsulta}&mkt=pt-BR`,
      headers: { 'Ocp-Apim-Subscription-Key': key },
    });
    for (const item of data.webPages?.value || []) {
      resultados.push({ titulo: item.name, url: item.url, trecho: item.snippet, fonte: 'Bing', consulta: q });
    }
  }
  return resultados;
}

async function pesquisar(ctx = {}, { limitePorConsulta = 3 } = {}) {
  const plano = montarConsultas(ctx);
  let resultados = [];
  let modo = 'links';
  let erroBusca = null;

  try {
    resultados = await _buscarSerper(plano.consultas, limitePorConsulta);
    if (!resultados.length) resultados = await _buscarBing(plano.consultas, limitePorConsulta);
    if (resultados.length) modo = 'web';
  } catch (err) {
    erroBusca = err.message;
  }

  return {
    dominio: plano.dominio,
    confianca: plano.confianca,
    perfil: { nome: plano.perfil.nome, instrucao: plano.perfil.instrucao },
    consultas: plano.consultas,
    links: plano.links,
    resultados: resultados.slice(0, 10),
    modo,
    erroBusca,
    configurado: !!(process.env.SERPER_API_KEY || process.env.BING_SEARCH_API_KEY),
  };
}

function _formatarChamadosRelacionados(relacionados = []) {
  return relacionados.map((r, i) => {
    const c = r.chamado || r;
    const pos = (r.posicionamentos || []).map(p => `    - ${p.dataPosicionamento || 'sem data'} | ${p.tecnicoNomeOrigem || 'sem autor'} | ${p.descricao || p.assunto || p.resultado || 'sem texto'}`).join('\n');
    return [
      `${i + 1}. Chamado #${c.numero || c.id} | score ${r.score ?? '-'} | ${[c.produto, c.familia, c.modulo].filter(Boolean).join(' / ')}`,
      c.titulo ? `   Título: ${c.titulo}` : null,
      c.descricao || c.breveDescricao || c.assunto ? `   Descrição: ${c.descricao || c.breveDescricao || c.assunto}` : null,
      c.solucaoAplicada ? `   Solução aplicada: ${c.solucaoAplicada}` : null,
      r.motivos?.length ? `   Similaridade: ${r.motivos.join('; ')}` : null,
      pos ? `   Posicionamentos recentes:\n${pos}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function formatarContextoParaPrompt(pesquisa, relacionados = []) {
  if (!pesquisa) return '';
  const linhas = [
    '## Pesquisa técnica assistida',
    `Domínio detectado: ${pesquisa.perfil?.nome || pesquisa.dominio} (confiança: ${pesquisa.confianca})`,
    pesquisa.perfil?.instrucao ? `Diretriz do domínio: ${pesquisa.perfil.instrucao}` : null,
    pesquisa.configurado
      ? `Busca web: ${pesquisa.modo === 'web' ? 'resultados recuperados automaticamente' : 'configurada, sem resultados nesta tentativa'}`
      : 'Busca web: não configurada; use as consultas e links sugeridos apenas como trilha de pesquisa, não como evidência confirmada.',
    pesquisa.resultados?.length ? '\nResultados técnicos recuperados:' : null,
    ...(pesquisa.resultados || []).map((r, i) => `${i + 1}. ${r.titulo}\n   Fonte: ${r.fonte}\n   URL: ${r.url}\n   Trecho: ${r.trecho || '(sem trecho)'}`),
    pesquisa.links?.length ? '\nConsultas rastreáveis sugeridas:' : null,
    ...(pesquisa.links || []).slice(0, 8).map((l, i) => `${i + 1}. ${l.fonte}: ${l.url}`),
    relacionados.length ? '\nChamados semelhantes da base interna:' : null,
    relacionados.length ? _formatarChamadosRelacionados(relacionados) : null,
  ];
  return linhas.filter(Boolean).join('\n');
}

async function pesquisarParaChamado(empresaId, chamadoId, extras = {}) {
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw new Error('Chamado não encontrado.');
  const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(empresaId, chamadoId);
  const relacionados = chamadoRepo.listarChamadosRelacionados(empresaId, chamadoId, { limite: extras.limiteRelacionados || 5 });
  const pesquisa = await pesquisar({ chamado, mensagens: posicionamentos.map(p => ({ conteudo: [p.assunto, p.descricao, p.resultado].filter(Boolean).join('\n') })) });
  return { pesquisa, relacionados };
}

module.exports = {
  PERFIS,
  detectarDominio,
  montarConsultas,
  pesquisar,
  pesquisarParaChamado,
  formatarContextoParaPrompt,
};
