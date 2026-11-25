// Valores dos Parâmetros por Empresa, no banco da IAHub Platform
// (iahub-platform.db). Segredos cifrados no mesmo formato da Platform
// (AES-256-GCM, prefixo iahub-aes-gcm:, mesma chave de platform-routes.js) e
// nunca devolvidos para a tela. Toda alteração fica no histórico com o usuário
// (segredo aparece só como "alterado").
const crypto = require('crypto');
const platform = require('../platform-store');
const catalogo = require('./catalogo');

const PREFIX = 'iahub-aes-gcm:';
let _tabelasOk = false;

function _db() {
  const db = platform.getDB();
  if (!_tabelasOk) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_parametros (
        empresa_id INTEGER NOT NULL,
        chave TEXT NOT NULL,
        valor TEXT,
        atualizado_em TEXT NOT NULL,
        atualizado_por TEXT,
        PRIMARY KEY (empresa_id, chave)
      );
      CREATE TABLE IF NOT EXISTS platform_parametros_historico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER NOT NULL,
        chave TEXT NOT NULL,
        acao TEXT NOT NULL,
        de TEXT,
        para TEXT,
        usuario TEXT,
        momento TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_platform_parametros_hist ON platform_parametros_historico (empresa_id, id DESC);
    `);
    _tabelasOk = true;
  }
  return db;
}

function _chaveCripto() {
  return crypto.createHash('sha256')
    .update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key')
    .digest();
}

function _cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', _chaveCripto(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function _decifrar(valor) {
  if (!valor || !String(valor).startsWith(PREFIX)) return valor || '';
  const raw = Buffer.from(String(valor).slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', _chaveCripto(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

function _erro(status, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { status, ...extra });
}

// ── Leitura ─────────────────────────────────────────────────────────────────

function _linhas(empresaId) {
  return new Map(_db().prepare('SELECT chave, valor, atualizado_em, atualizado_por FROM platform_parametros WHERE empresa_id = ?')
    .all(Number(empresaId)).map(r => [r.chave, r]));
}

function _ler(def, linha) {
  if (!linha || linha.valor == null) return def.padrao;
  try {
    return JSON.parse(def.tipo === 'segredo' ? _decifrar(linha.valor) : linha.valor);
  } catch (_) {
    return def.padrao;
  }
}

/** Valores efetivos (com padrão) para uso interno — segredos decifrados. */
function valores(empresaId) {
  const linhas = empresaId ? _linhas(empresaId) : new Map();
  const r = {};
  for (const def of catalogo.PARAMETROS) r[def.chave] = _ler(def, linhas.get(def.chave));
  return r;
}

/** Para a tela: catálogo + valor atual; segredo só diz se está definido. */
function paraTela(empresaId) {
  const linhas = _linhas(empresaId);
  const parametros = catalogo.PARAMETROS.map((def) => {
    const linha = linhas.get(def.chave);
    const { validar, ...semFuncao } = def;
    const base = { ...semFuncao, personalizado: !!linha, atualizadoEm: linha?.atualizado_em ?? null, atualizadoPor: linha?.atualizado_por ?? null };
    if (def.tipo === 'segredo') return { ...base, valor: null, definido: !!(linha && linha.valor) };
    return { ...base, valor: _ler(def, linha) };
  });
  return { grupos: catalogo.GRUPOS, parametros };
}

// ── Validação ───────────────────────────────────────────────────────────────

function _normalizar(def, bruto) {
  switch (def.tipo) {
    case 'booleano':
      if (typeof bruto === 'boolean') return { valor: bruto };
      return { erro: 'Escolha ligado ou desligado.' };
    case 'numero': {
      const n = Number(bruto);
      if (!Number.isInteger(n)) return { erro: 'Informe um número inteiro.' };
      if ((def.min != null && n < def.min) || (def.max != null && n > def.max)) return { erro: `Entre ${def.min} e ${def.max}.` };
      return { valor: n };
    }
    case 'opcoes': {
      const ok = (def.opcoes || []).some(o => o.valor === bruto);
      return ok ? { valor: bruto } : { erro: 'Escolha uma das opções.' };
    }
    case 'emails': {
      const lista = (Array.isArray(bruto) ? bruto : String(bruto ?? '').split(/[\s,;]+/)).map(e => String(e).trim()).filter(Boolean);
      const invalidos = lista.filter(e => !catalogo.EMAIL_RE.test(e));
      if (invalidos.length) return { erro: `E-mail inválido: ${invalidos.slice(0, 3).join(', ')}.` };
      if (def.max && lista.length > def.max) return { erro: `No máximo ${def.max} e-mails.` };
      return { valor: [...new Set(lista.map(e => e.toLowerCase()))] };
    }
    default: {
      const texto = String(bruto ?? '').trim();
      if (texto.length > 500) return { erro: 'Texto longo demais (máx. 500 caracteres).' };
      if (texto && def.validar) {
        const msg = def.validar(texto);
        if (msg) return { erro: msg };
      }
      return { valor: texto };
    }
  }
}

function _vazio(def, valor) {
  return valor == null || valor === '' || (Array.isArray(valor) && !valor.length);
}

function _resumo(def, valor) {
  if (def.tipo === 'segredo') return valor ? '•••• (alterado)' : '(vazio)';
  if (def.tipo === 'opcoes') return def.opcoes.find(o => o.valor === valor)?.rotulo || String(valor ?? '(vazio)');
  if (Array.isArray(valor)) return valor.join(', ') || '(vazio)';
  if (typeof valor === 'boolean') return valor ? 'ligado' : 'desligado';
  return valor === '' || valor == null ? '(vazio)' : String(valor);
}

// ── Gravação ────────────────────────────────────────────────────────────────

/**
 * alteracoes: { chave: valor } (segredo vazio = mantém o atual);
 * restaurar: [chave] (volta ao padrão; segredo é apagado). Valida tudo antes
 * de gravar: com erro, nada é salvo e `erros` traz a mensagem de cada campo.
 */
function salvar(empresaId, { alteracoes = {}, restaurar = [] } = {}, { usuario = null, agora = new Date() } = {}) {
  const emp = Number(empresaId);
  if (!emp) throw _erro(400, 'Empresa não informada.');
  const erros = {};
  const gravar = [];
  for (const [chave, bruto] of Object.entries(alteracoes || {})) {
    const def = catalogo.definicao(chave);
    if (!def) { erros[chave] = 'Parâmetro desconhecido.'; continue; }
    if (def.tipo === 'segredo' && String(bruto ?? '').trim() === '') continue;
    const r = _normalizar(def, def.tipo === 'segredo' ? String(bruto).trim() : bruto);
    if (r.erro) erros[chave] = r.erro; else gravar.push([def, r.valor]);
  }
  for (const chave of restaurar || []) if (!catalogo.definicao(chave)) erros[chave] = 'Parâmetro desconhecido.';
  if (Object.keys(erros).length) throw _erro(400, 'Há parâmetros com problema; nada foi salvo.', { erros });

  // Obrigatórios: com o canal ligado, o que ele precisa não pode ficar vazio.
  const atuais = valores(emp);
  const linhasAtuais = _linhas(emp);
  const futuro = { ...atuais };
  for (const [def, v] of gravar) futuro[def.chave] = v;
  for (const chave of restaurar || []) futuro[chave] = catalogo.definicao(chave).padrao;
  for (const def of catalogo.PARAMETROS) {
    if (!def.exigeQuando || futuro[def.exigeQuando] !== true) continue;
    const vazio = def.tipo === 'segredo'
      ? !((gravar.some(([d]) => d.chave === def.chave)) || (linhasAtuais.get(def.chave)?.valor && !(restaurar || []).includes(def.chave)))
      : _vazio(def, futuro[def.chave]);
    if (vazio) erros[def.chave] = `Obrigatório com "${catalogo.definicao(def.exigeQuando).titulo}" ligado.`;
  }
  if (Object.keys(erros).length) throw _erro(400, 'Há parâmetros obrigatórios em branco; nada foi salvo.', { erros });

  const db = _db();
  const agoraIso = agora.toISOString();
  const hist = db.prepare('INSERT INTO platform_parametros_historico (empresa_id, chave, acao, de, para, usuario, momento) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let alterados = 0;
  db.transaction(() => {
    for (const [def, v] of gravar) {
      const antes = atuais[def.chave];
      // Igual ao que já vale (inclusive o padrão): nada muda, nada no histórico.
      if (def.tipo !== 'segredo' && JSON.stringify(antes) === JSON.stringify(v)) continue;
      const guardado = def.tipo === 'segredo' ? _cifrar(JSON.stringify(v)) : JSON.stringify(v);
      db.prepare(`INSERT INTO platform_parametros (empresa_id, chave, valor, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (empresa_id, chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`)
        .run(emp, def.chave, guardado, agoraIso, usuario);
      hist.run(emp, def.chave, 'alterado', def.tipo === 'segredo' ? null : _resumo(def, antes), _resumo(def, v), usuario, agoraIso);
      alterados++;
    }
    for (const chave of restaurar || []) {
      const def = catalogo.definicao(chave);
      if (db.prepare('DELETE FROM platform_parametros WHERE empresa_id = ? AND chave = ?').run(emp, chave).changes) {
        hist.run(emp, chave, 'restaurado', def.tipo === 'segredo' ? null : _resumo(def, atuais[chave]), def.tipo === 'segredo' ? '(apagado)' : _resumo(def, def.padrao), usuario, agoraIso);
        alterados++;
      }
    }
  })();
  return { alterados, ...paraTela(emp) };
}

function historico(empresaId, { chave = null, limite = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 100, 1), 500);
  const sql = `SELECT id, chave, acao, de, para, usuario, momento FROM platform_parametros_historico
    WHERE empresa_id = ? ${chave ? 'AND chave = ?' : ''} ORDER BY id DESC LIMIT ?`;
  const p = chave ? [Number(empresaId), chave, lim] : [Number(empresaId), lim];
  return _db().prepare(sql).all(...p).map(h => ({ ...h, titulo: catalogo.definicao(h.chave)?.titulo || h.chave }));
}

module.exports = { valores, paraTela, salvar, historico, _cifrar, _decifrar };
