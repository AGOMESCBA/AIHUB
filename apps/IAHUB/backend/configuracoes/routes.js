const fs = require('fs');
const path = require('path');
const db = require('./database');
const { APP_DATA_DIR, appDataDir } = require('../data-paths');
const empresasDb = require('../empresas/database');
const { empresaDataFile } = require('../../../IA Recruit/backend/data-paths');

const DATA_DIR = APP_DATA_DIR;
const SISTEMA_UPLOAD_DIR = appDataDir('uploads', 'sistema');

const MIGRACAO_TABELAS = {
  config:             { grupo: 'Configuracoes', label: 'WhatsApp Curriculo', campos: ['config'], defaults: { config: {} }, default: true },
  email_config:       { grupo: 'Configuracoes', label: 'E-mail por vaga', campos: ['email_config'], defaults: { email_config: {} }, default: true },
  email_geral_config: { grupo: 'Configuracoes', label: 'E-mail avulso', campos: ['email_geral_config'], defaults: { email_geral_config: {} }, default: true },
  email_templates:    { grupo: 'Configuracoes', label: 'Templates de e-mail', campos: ['email_templates'], defaults: { email_templates: {} }, default: true },
  analisador_config:  { grupo: 'Regras', label: 'Classificacao do analisador', campos: ['analisador_config'], defaults: { analisador_config: {} }, default: true },
  pesos_pontuacao:    { grupo: 'Regras', label: 'Pesos de pontuacao', campos: ['pesos_pontuacao'], defaults: { pesos_pontuacao: {} }, default: true },
  equivalencias:      { grupo: 'Regras', label: 'Equivalencias', campos: ['equivalencias'], defaults: { equivalencias: [] }, default: true },
  funcoes:            { grupo: 'Cadastros', label: 'Funcoes', campos: ['funcoes', 'nextFuncaoId'], defaults: { funcoes: [], nextFuncaoId: 1 } },
  vagas:              { grupo: 'Cadastros', label: 'Vagas', campos: ['vagas', 'nextVagaId'], defaults: { vagas: [], nextVagaId: 1 } },
  curriculos:         { grupo: 'Operacao', label: 'Curriculos', campos: ['curriculos', 'nextId', 'processedIds', 'pendingUpdates'], defaults: { curriculos: [], nextId: 1, processedIds: [], pendingUpdates: [] } },
  vaga_candidaturas:  { grupo: 'Operacao', label: 'Candidaturas do PS', campos: ['vaga_candidaturas', 'nextCandidaturaId', 'next_candidatura_id'], defaults: { vaga_candidaturas: [], nextCandidaturaId: 1, next_candidatura_id: 1 } },
  analises:           { grupo: 'Operacao', label: 'Historico de analises', campos: ['analises'], defaults: { analises: [] } },
  integracoes_se:     { grupo: 'Integracoes SE', label: 'SE Curriculos - historico', campos: ['integracoes_se'], defaults: { integracoes_se: [] } },
  se_config:          { grupo: 'Integracoes SE', label: 'SE Curriculos - configuracao', campos: ['se_config'], defaults: { se_config: {} }, default: true },
  se_funcao_config:   { grupo: 'Integracoes SE', label: 'SE Funcoes - configuracao', campos: ['se_funcao_config'], defaults: { se_funcao_config: {} }, default: true },
  se_vaga_config:     { grupo: 'Integracoes SE', label: 'SE Vagas - configuracao', campos: ['se_vaga_config'], defaults: { se_vaga_config: {} }, default: true },
  se_api_templates:   { grupo: 'SE API Configurador', label: 'Templates', campos: ['se_api_templates'], defaults: { se_api_templates: [] }, default: true },
  se_api_configs:     { grupo: 'SE API Configurador', label: 'Configuracoes de endpoint', campos: ['se_api_configs'], defaults: { se_api_configs: [] }, default: true },
  se_api_headers:     { grupo: 'SE API Configurador', label: 'Headers', campos: ['se_api_headers'], defaults: { se_api_headers: [] }, default: true },
  se_api_mappings:    { grupo: 'SE API Configurador', label: 'Mapeamentos', campos: ['se_api_mappings'], defaults: { se_api_mappings: [] }, default: true },
  se_api_flows:       { grupo: 'SE API Configurador', label: 'Fluxos', campos: ['se_api_flows'], defaults: { se_api_flows: [] }, default: true },
  se_api_flow_steps:  { grupo: 'SE API Configurador', label: 'Passos de fluxo', campos: ['se_api_flow_steps'], defaults: { se_api_flow_steps: [] }, default: true },
  se_api_logs:        { grupo: 'SE API Configurador', label: 'Logs', campos: ['se_api_logs', '_se_api_log_id'], defaults: { se_api_logs: [], _se_api_log_id: 1 } },
};

function readEmpresaData(empresaId) {
  const file = empresaDataFile(empresaId);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; }
}

function saveEmpresaData(empresaId, data) {
  fs.writeFileSync(empresaDataFile(empresaId), JSON.stringify(data, null, 2), 'utf8');
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function countCampo(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length ? 1 : 0;
  return value === undefined || value === null || value === '' ? 0 : 1;
}

function previewTabela(data, tabela) {
  const def = MIGRACAO_TABELAS[tabela];
  const principal = def.campos[0];
  return countCampo(data[principal]);
}

function normalizarEmpresa(value, destinoId, destinoNome) {
  if (Array.isArray(value)) {
    return value.map(item => normalizarEmpresa(item, destinoId, destinoNome));
  }
  if (!value || typeof value !== 'object') return value;

  const next = { ...value };
  if (Object.prototype.hasOwnProperty.call(next, 'empresa_id')) next.empresa_id = Number(destinoId);
  if (Object.prototype.hasOwnProperty.call(next, 'empresa_nome')) next.empresa_nome = destinoNome || null;
  return next;
}

function criarBackupDestino(destinoId) {
  const file = empresaDataFile(destinoId);
  if (!fs.existsSync(file)) return null;

  const backupDir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `empresa_${destinoId}_antes_migracao_${stamp}.json`);
  fs.copyFileSync(file, backupFile);
  return backupFile;
}

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

  app.get('/api/config/migracao/meta', requireAuth, requireAdmin, (req, res) => {
    const empresas = empresasDb.listar().map(e => ({
      id: e.id,
      nome: e.razao_social || e.nome || `Empresa ${e.id}`,
    }));

    const tabelas = Object.entries(MIGRACAO_TABELAS).map(([id, def]) => ({
      id,
      grupo: def.grupo,
      label: def.label,
      campos: def.campos,
      default: !!def.default,
    }));

    res.json({ empresas, tabelas });
  });

  app.get('/api/config/migracao/preview', requireAuth, requireAdmin, (req, res) => {
    const origemId = Number(req.query.origem_id || 0);
    const destinoId = Number(req.query.destino_id || 0);

    if (!origemId || !destinoId) {
      return res.status(400).json({ error: 'Informe empresa origem e destino.' });
    }
    if (origemId === destinoId) {
      return res.status(400).json({ error: 'Origem e destino devem ser empresas diferentes.' });
    }

    const origem = empresasDb.buscarPorId(origemId);
    const destino = empresasDb.buscarPorId(destinoId);
    if (!origem || !destino) return res.status(404).json({ error: 'Empresa origem ou destino nao encontrada.' });

    const origemData = readEmpresaData(origemId);
    const destinoData = readEmpresaData(destinoId);

    res.json({
      origem: { id: origem.id, nome: origem.razao_social || origem.nome || `Empresa ${origem.id}` },
      destino: { id: destino.id, nome: destino.razao_social || destino.nome || `Empresa ${destino.id}` },
      tabelas: Object.entries(MIGRACAO_TABELAS).map(([id, def]) => ({
        id,
        grupo: def.grupo,
        label: def.label,
        origem: previewTabela(origemData, id),
        destino: previewTabela(destinoData, id),
      })),
    });
  });

  app.post('/api/config/migracao/executar', requireAuth, requireAdmin, (req, res) => {
    const origemId = Number(req.body?.origem_id || 0);
    const destinoId = Number(req.body?.destino_id || 0);
    const tabelas = Array.isArray(req.body?.tabelas) ? req.body.tabelas : [];
    const confirmar = String(req.body?.confirmar || '').toUpperCase().trim();

    if (!origemId || !destinoId || !tabelas.length) {
      return res.status(400).json({ error: 'Informe origem, destino e ao menos uma tabela.' });
    }
    if (origemId === destinoId) {
      return res.status(400).json({ error: 'Origem e destino devem ser empresas diferentes.' });
    }
    if (confirmar !== 'MIGRAR') {
      return res.status(400).json({ error: 'Digite MIGRAR para confirmar a operacao.' });
    }

    const origem = empresasDb.buscarPorId(origemId);
    const destino = empresasDb.buscarPorId(destinoId);
    if (!origem || !destino) return res.status(404).json({ error: 'Empresa origem ou destino nao encontrada.' });

    const invalidas = tabelas.filter(t => !MIGRACAO_TABELAS[t]);
    if (invalidas.length) {
      return res.status(400).json({ error: `Tabela invalida: ${invalidas.join(', ')}` });
    }

    const origemData = readEmpresaData(origemId);
    const destinoData = readEmpresaData(destinoId);
    const destinoNome = destino.razao_social || destino.nome || `Empresa ${destino.id}`;
    const backup = criarBackupDestino(destinoId);
    const migradas = [];

    for (const tabela of tabelas) {
      const def = MIGRACAO_TABELAS[tabela];
      for (const campo of def.campos) {
        const valor = Object.prototype.hasOwnProperty.call(origemData, campo)
          ? clone(origemData[campo])
          : clone(def.defaults[campo]);
        destinoData[campo] = normalizarEmpresa(valor, destinoId, destinoNome);
      }
      migradas.push({
        id: tabela,
        label: def.label,
        origem: previewTabela(origemData, tabela),
      });
    }

    saveEmpresaData(destinoId, destinoData);
    res.json({ ok: true, migradas, backup });
  });

};
