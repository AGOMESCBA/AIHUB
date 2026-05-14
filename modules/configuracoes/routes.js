const fs = require('fs');
const path = require('path');
const db = require('./database');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SISTEMA_UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'sistema');

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  return { mime, buffer };
}

function apagarArquivoPublico(url) {
  if (!url || !String(url).startsWith('/uploads/')) return;
  const rel = String(url).replace(/^\/uploads\//, '');
  const alvo = path.resolve(path.join(DATA_DIR, 'uploads', rel));
  const raiz = path.resolve(path.join(DATA_DIR, 'uploads'));
  if (!alvo.startsWith(raiz)) return;
  try { if (fs.existsSync(alvo)) fs.unlinkSync(alvo); } catch (_) {}
}

function _resolverEid(req) {
  const explicit = Number(req.body?.empresa_id || req.query?.empresa_id || 0);
  if (!explicit) return req.session.empresa_id;
  const { empresas: acesso, role } = req.session;
  const ok = role === 'admin' || acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(explicit));
  return ok ? explicit : req.session.empresa_id;
}

module.exports = function registerRoutes(app, { requireAuth, requireAdmin, requireEmpresa }) {

  app.get('/api/config/publico', (req, res) => {
    const cfg = db.getConfig(null);
    res.json({
      sistema_frase:  cfg.sistema_frase || 'Onde a gestão encontra a inteligência',
      sistema_nome:   cfg.sistema_nome || 'IAHUB',
      sistema_versao: cfg.sistema_versao || 'v2.0',
      login_logo_default_url: cfg.login_logo_default_url || '',
      login_background_default_url: cfg.login_background_default_url || '',
    });
  });

  app.get('/api/config/sistema', requireAuth, requireAdmin, (req, res) => {
    const cfg = db.getConfig(null);
    res.json({
      sistema_frase:  cfg.sistema_frase || 'Onde a gestão encontra a inteligência',
      sistema_nome:   cfg.sistema_nome || 'IAHUB',
      sistema_versao: cfg.sistema_versao || 'v2.0',
      login_logo_default_url: cfg.login_logo_default_url || '',
      login_background_default_url: cfg.login_background_default_url || '',
    });
  });

  app.put('/api/config/sistema', requireAuth, requireAdmin, (req, res) => {
    const { sistema_nome, sistema_frase, sistema_versao } = req.body || {};
    const cfg = db.salvarConfig({
      sistema_frase:  String(sistema_frase || '').trim() || 'Onde a gestão encontra a inteligência',
      sistema_nome:   String(sistema_nome || '').trim() || 'IAHUB',
      sistema_versao: String(sistema_versao || '').trim() || 'v2.0',
    }, null);
    res.json({
      ok: true,
      sistema_nome:   cfg.sistema_nome,
      sistema_frase:  cfg.sistema_frase,
      sistema_versao: cfg.sistema_versao,
      login_logo_default_url: cfg.login_logo_default_url || '',
      login_background_default_url: cfg.login_background_default_url || '',
    });
  });

  app.post('/api/config/sistema/login-logo', requireAuth, requireAdmin, (req, res) => {
    const arquivo = parseDataUrl(req.body?.dataUrl);
    const extensoes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!arquivo || !extensoes[arquivo.mime]) {
      return res.status(400).json({ error: 'Envie uma imagem em PNG, JPG ou WEBP.' });
    }
    if (arquivo.buffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'Arquivo muito grande. Limite: 4 MB.' });
    }

    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_logo_default_url);
    fs.mkdirSync(SISTEMA_UPLOAD_DIR, { recursive: true });

    const nome = `login-logo-default-${Date.now()}.${extensoes[arquivo.mime]}`;
    fs.writeFileSync(path.join(SISTEMA_UPLOAD_DIR, nome), arquivo.buffer);
    const url = `/uploads/sistema/${nome}`;
    const cfg = db.salvarConfig({ login_logo_default_url: url }, null);
    res.json({ ok: true, url, login_logo_default_url: cfg.login_logo_default_url });
  });

  app.delete('/api/config/sistema/login-logo', requireAuth, requireAdmin, (req, res) => {
    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_logo_default_url);
    const cfg = db.salvarConfig({ login_logo_default_url: '' }, null);
    res.json({ ok: true, login_logo_default_url: cfg.login_logo_default_url || '' });
  });

  app.post('/api/config/sistema/login-background', requireAuth, requireAdmin, (req, res) => {
    const arquivo = parseDataUrl(req.body?.dataUrl);
    const extensoes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!arquivo || !extensoes[arquivo.mime]) {
      return res.status(400).json({ error: 'Envie uma imagem em PNG, JPG ou WEBP.' });
    }
    if (arquivo.buffer.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Arquivo muito grande. Limite: 6 MB.' });
    }

    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_background_default_url);
    fs.mkdirSync(SISTEMA_UPLOAD_DIR, { recursive: true });

    const nome = `login-background-default-${Date.now()}.${extensoes[arquivo.mime]}`;
    fs.writeFileSync(path.join(SISTEMA_UPLOAD_DIR, nome), arquivo.buffer);
    const url = `/uploads/sistema/${nome}`;
    const cfg = db.salvarConfig({ login_background_default_url: url }, null);
    res.json({ ok: true, url, login_background_default_url: cfg.login_background_default_url });
  });

  app.delete('/api/config/sistema/login-background', requireAuth, requireAdmin, (req, res) => {
    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_background_default_url);
    const cfg = db.salvarConfig({ login_background_default_url: '' }, null);
    res.json({ ok: true, login_background_default_url: cfg.login_background_default_url || '' });
  });

  app.get('/api/config/apikeys', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = _resolverEid(req);
    const cfg = db.getConfig(empresaId);
    res.json({
      groq_api_key:       cfg.groq_api_key   ? db.maskKey(cfg.groq_api_key)   : '',
      gemini_api_key:     cfg.gemini_api_key ? db.maskKey(cfg.gemini_api_key) : '',
      gemini_model:       cfg.gemini_model || 'gemini-1.5-flash',
      groq_configurada:   !!cfg.groq_api_key,
      gemini_configurada: !!cfg.gemini_api_key,
    });
  });

  app.get('/api/config/apikeys/reveal', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = _resolverEid(req);
    const cfg = db.getConfig(empresaId);
    res.json({
      groq_api_key:   cfg.groq_api_key   || '',
      gemini_api_key: cfg.gemini_api_key || '',
    });
  });

  app.put('/api/config/apikeys', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = _resolverEid(req);
    const { groq_api_key, gemini_api_key, gemini_model } = req.body || {};
    const patch = {};

    // Empty fields mean "keep current key". Only non-empty, non-masked values overwrite.
    if (groq_api_key !== undefined) {
      const val = String(groq_api_key).trim();
      if (val && !val.includes('•')) patch.groq_api_key = val;
    }
    if (gemini_api_key !== undefined) {
      const val = String(gemini_api_key).trim();
      if (val && !val.includes('•')) patch.gemini_api_key = val;
    }
    if (gemini_model !== undefined)
      patch.gemini_model = (gemini_model || 'gemini-1.5-flash').trim();

    const cfg = db.salvarConfig(patch, empresaId);
    res.json({
      ok: true,
      groq_configurada:   !!cfg.groq_api_key,
      gemini_configurada: !!cfg.gemini_api_key,
    });
  });

};
