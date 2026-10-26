// O endereço público gera links; nunca redireciona ou desativa o acesso atual.
function normalizarUrlPublica(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Informe um endereço HTTP ou HTTPS válido.');
  if (!value.trim()) return null;
  let url;
  try {
    if (!/^https?:\/\//i.test(value.trim())) throw new Error();
    url = new URL(value.trim());
  } catch (_) { throw new Error('Informe um endereço completo, começando com http:// ou https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use somente o endereço HTTP ou HTTPS e a porta opcional, sem caminho, credenciais ou parâmetros.');
  }
  return url.origin;
}

function lerConfig(db) {
  const row = db.prepare('SELECT url_publica, versao, atualizado_em FROM platform_access_config WHERE id = 1').get();
  return { urlPublica: row?.url_publica || null, versao: row?.versao || 0, atualizadoEm: row?.atualizado_em || null };
}

// ── Sites autorizados a incorporar os chats públicos (iframe) — POR EMPRESA ───
// Cada empresa tem a sua lista e ela só libera os links DAQUELA empresa
// (apelido do IA Service / rota mascarada do IA Command). Rota sem empresa
// identificável, empresa sem lista ou falha de leitura = SAMEORIGIN (original).
// Só origens HTTPS: HTTP é bloqueado pelo navegador dentro de página HTTPS.
const MAX_ORIGENS_INCORPORACAO = 20;

function normalizarOrigensIncorporacao(value) {
  if (value == null || value === '') return [];
  if (!Array.isArray(value)) throw new Error('Envie a lista de sites autorizados.');
  if (value.length > MAX_ORIGENS_INCORPORACAO) throw new Error(`Informe no máximo ${MAX_ORIGENS_INCORPORACAO} sites autorizados.`);
  const origens = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) continue;
    let origem;
    try { origem = normalizarUrlPublica(item); }
    catch (_) { throw new Error(`Endereço inválido: ${String(item).slice(0, 120)}. Informe somente https://dominio, sem caminho.`); }
    if (!origem.startsWith('https://')) throw new Error(`Use HTTPS no site autorizado: ${origem}.`);
    if (!origens.includes(origem)) origens.push(origem);
  }
  return origens;
}

// Revalida na leitura: valor gravado fora da API nunca vira cabeçalho sem passar pela mesma regra.
function origensValidas(json) {
  try {
    const lista = JSON.parse(json || '[]');
    if (!Array.isArray(lista)) return [];
    return lista.filter(o => { try { return normalizarOrigensIncorporacao([o]).length === 1; } catch (_) { return false; } });
  } catch (_) { return []; }
}

function lerOrigensEmpresa(db, empresaId) {
  const row = db.prepare(`SELECT origens, versao, atualizado_em, atualizado_por
    FROM platform_embed_origins WHERE empresa_id = ?`).get(Number(empresaId));
  return {
    empresaId: Number(empresaId),
    origens: origensValidas(row?.origens),
    versao: row?.versao || 0,
    atualizadoEm: row?.atualizado_em || null,
    atualizadoPor: row?.atualizado_por || null,
  };
}

// Cache curto (30s) de todas as listas: o middleware roda em toda página de
// chat, e o prazo também cobre mais de um processo (cada um relê sozinho).
const CACHE_ORIGENS_MS = 30 * 1000;
let cacheOrigens = { mapa: null, em: 0 };
function invalidarCacheOrigens() { cacheOrigens = { mapa: null, em: 0 }; }

function origensDaEmpresaEmCache(getDB, empresaId) {
  if (!cacheOrigens.mapa || Date.now() - cacheOrigens.em >= CACHE_ORIGENS_MS) {
    const mapa = new Map();
    try {
      for (const row of getDB().prepare('SELECT empresa_id, origens FROM platform_embed_origins').all()) {
        const origens = origensValidas(row.origens);
        if (origens.length) mapa.set(Number(row.empresa_id), origens);
      }
    } catch (err) {
      console.error('[platform-access] Falha ao ler sites autorizados a incorporar o chat:', err.message);
    }
    cacheOrigens = { mapa, em: Date.now() }; // falha = mapa vazio = mantém SAMEORIGIN
  }
  return cacheOrigens.mapa.get(Number(empresaId)) || [];
}

const RE_LOGIN_IA_COMMAND = /^\/(?:entrar|acesso)\/[A-Za-z0-9_-]{3,80}$/;

// Descobre a empresa dona da página pública de chat pedida. Sem empresa = não libera.
// IA Command: a página do chat (pós-login) carrega o loginPath da empresa na URL;
// mesmo que alguém o troque, o chat só funciona com o token da própria aba, emitido
// pelo login daquela rota (que já é restrito à empresa da rota).
function empresaDaRotaChat(req, { empresaPorApelido, empresaPorLoginPath }) {
  const p = String(req.path || '').replace(/\/+$/, '') || '/';
  let m = p.match(/^\/iaservice\/([a-z0-9-]+)(?:\/(?:acesso|radar))?$/i);
  if (m && !/^(?:guia|assets)$/i.test(m[1])) return empresaPorApelido(m[1].toLowerCase());
  m = p.match(/^\/(?:entrar-servico|radar-externo)\/([a-z0-9-]+)$/i);
  if (m) return empresaPorApelido(m[1].toLowerCase());
  if (RE_LOGIN_IA_COMMAND.test(p)) return empresaPorLoginPath(p);
  if (p === '/api/ia-command/protheus/chat') {
    const loginPath = String(req.query?.loginPath || '').trim().replace(/\/+$/, '');
    if (RE_LOGIN_IA_COMMAND.test(loginPath)) return empresaPorLoginPath(loginPath);
  }
  return null;
}

function middlewareIncorporacaoChat({ getDB, empresaPorApelido, empresaPorLoginPath }) {
  return function incorporacaoChat(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let empresaId = null;
    try { empresaId = empresaDaRotaChat(req, { empresaPorApelido, empresaPorLoginPath }); }
    catch (err) { console.error('[platform-access] Falha ao identificar a empresa da rota de chat:', err.message); }
    if (!empresaId) return next();
    const origens = origensDaEmpresaEmCache(getDB, empresaId);
    if (!origens.length) return next();
    // frame-ancestors substitui o X-Frame-Options; removemos o XFO para não haver
    // ambiguidade em validadores de terceiros (ex.: SoftExpert).
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${origens.join(' ')}`);
    next();
  };
}

function registrarRotas(app, { requireAuth, requireAdmin, getDB, empresaIdDaReq, contextoEmpresa }) {
  app.get('/api/iahub/platform/access-config', requireAuth, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(lerConfig(getDB()));
  });
  app.post('/api/iahub/platform/access-config', requireAuth, requireAdmin, (req, res) => {
    let url;
    try { url = normalizarUrlPublica(req.body?.urlPublica); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'urlPublica')) {
      return res.status(400).json({ error: 'Informe o endereço público ou deixe-o vazio para remover a configuração.' });
    }
    const db = getDB();
    const resultado = db.transaction(() => {
      const atual = lerConfig(db);
      if (req.body.versao !== atual.versao) return null;
      db.prepare(`INSERT INTO platform_access_config (id, url_publica, versao, atualizado_em)
        VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        url_publica = excluded.url_publica, versao = excluded.versao, atualizado_em = excluded.atualizado_em`)
        .run(url, atual.versao + 1, new Date().toISOString());
      return lerConfig(db);
    }).immediate();
    if (!resultado) return res.status(409).json({ error: 'O endereço público foi alterado em outra sessão. Recarregue os dados antes de salvar.' });
    res.json(resultado);
  });

  if (!empresaIdDaReq) return;
  const comContexto = (dados) => {
    let ctx = {};
    try { ctx = (contextoEmpresa && contextoEmpresa(dados.empresaId)) || {}; }
    catch (err) { console.error('[platform-access] Falha ao montar contexto da empresa:', err.message); }
    return {
      ...dados,
      empresaNome: ctx.nome || null,
      links: { iaService: ctx.linkIaService || null, iaCommand: ctx.linkIaCommand || null },
    };
  };

  app.get('/api/iahub/platform/embed-origins', requireAuth, (req, res) => {
    const eid = Number(empresaIdDaReq(req));
    if (!eid) return res.status(400).json({ error: 'Empresa não definida.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(comContexto(lerOrigensEmpresa(getDB(), eid)));
  });

  app.post('/api/iahub/platform/embed-origins', requireAuth, requireAdmin, (req, res) => {
    const eid = Number(empresaIdDaReq(req));
    if (!eid) return res.status(400).json({ error: 'Empresa não definida.' });
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'origens')) {
      return res.status(400).json({ error: 'Informe a lista de sites autorizados (pode ser vazia).' });
    }
    let origens;
    try { origens = normalizarOrigensIncorporacao(req.body.origens); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    const usuario = String(req.session?.user || req.session?.user_id || '').slice(0, 120) || null;
    const db = getDB();
    const resultado = db.transaction(() => {
      const atual = lerOrigensEmpresa(db, eid);
      if (req.body.versao !== atual.versao) return null;
      db.prepare(`INSERT INTO platform_embed_origins (empresa_id, origens, versao, atualizado_em, atualizado_por)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(empresa_id) DO UPDATE SET
        origens = excluded.origens, versao = excluded.versao,
        atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`)
        .run(eid, JSON.stringify(origens), atual.versao + 1, new Date().toISOString(), usuario);
      return lerOrigensEmpresa(db, eid);
    }).immediate();
    if (!resultado) return res.status(409).json({ error: 'A lista desta empresa foi alterada em outra sessão. Recarregue os dados antes de salvar.' });
    invalidarCacheOrigens();
    console.log(`[platform-access] Empresa ${eid}: sites autorizados a incorporar o chat = ${resultado.origens.join(', ') || '(nenhum)'} (por ${usuario || '?'})`);
    res.json(comContexto(resultado));
  });
}

module.exports = {
  registrarRotas,
  normalizarUrlPublica,
  lerConfig,
  normalizarOrigensIncorporacao,
  lerOrigensEmpresa,
  empresaDaRotaChat,
  middlewareIncorporacaoChat,
  invalidarCacheOrigens,
};
