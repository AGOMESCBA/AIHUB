const fs   = require('fs');
const path = require('path');
const db   = require('./database');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function loadEmpresa(eid) {
  const f = path.join(DATA_DIR, `empresa_${eid}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function saveEmpresa(eid, data) {
  fs.writeFileSync(path.join(DATA_DIR, `empresa_${eid}.json`), JSON.stringify(data, null, 2), 'utf8');
}

function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Acesso restrito a administradores.' });
}

// Tabelas zeráveis e seus campos no JSON
const TABELAS = {
  curriculos:         { label: 'Currículos',                campos: ['curriculos', 'nextId', 'processedIds'],   defaults: { curriculos: [], nextId: 1, processedIds: [] } },
  vaga_candidaturas:  { label: 'Candidaturas do PS',        campos: ['vaga_candidaturas', 'nextCandidaturaId'], defaults: { vaga_candidaturas: [], nextCandidaturaId: 1 } },
  vagas:              { label: 'Vagas',                     campos: ['vagas', 'nextVagaId'],                    defaults: { vagas: [], nextVagaId: 1 } },
  funcoes:            { label: 'Funções',                   campos: ['funcoes', 'nextFuncaoId'],                defaults: { funcoes: [], nextFuncaoId: 1 } },
  equivalencias:      { label: 'Equivalências',             campos: ['equivalencias'],                          defaults: { equivalencias: [] } },
  // SE Currículos
  integracoes_se:     { label: 'SE Currículos — Histórico',  campos: ['integracoes_se'],                         defaults: { integracoes_se: [] } },
  // SE API Configurador
  se_api_templates:   { label: 'SE API — Templates',        campos: ['se_api_templates'],                      defaults: { se_api_templates: [] } },
  se_api_configs:     { label: 'SE API — Configurações',    campos: ['se_api_configs'],                        defaults: { se_api_configs: [] } },
  se_api_headers:     { label: 'SE API — Headers',          campos: ['se_api_headers'],                        defaults: { se_api_headers: [] } },
  se_api_mappings:    { label: 'SE API — Mapeamentos',      campos: ['se_api_mappings'],                       defaults: { se_api_mappings: [] } },
  se_api_flows:       { label: 'SE API — Fluxos',           campos: ['se_api_flows'],                          defaults: { se_api_flows: [] } },
  se_api_flow_steps:  { label: 'SE API — Passos de Fluxo',  campos: ['se_api_flow_steps'],                     defaults: { se_api_flow_steps: [] } },
  se_api_logs:        { label: 'SE API — Logs',             campos: ['se_api_logs', '_se_api_log_id'],         defaults: { se_api_logs: [], _se_api_log_id: 1 } },
};

// Cascade: zerar X força o zero de Y
const CASCADE = {
  funcoes:         ['vagas', 'vaga_candidaturas'],
  vagas:           ['vaga_candidaturas'],
  curriculos:      ['vaga_candidaturas'],
  se_api_configs:  ['se_api_headers', 'se_api_mappings'],
  se_api_flows:    ['se_api_flow_steps'],
};

function contagens(data) {
  return {
    curriculos:        (data.curriculos        || []).length,
    vaga_candidaturas: (data.vaga_candidaturas || []).length,
    vagas:             (data.vagas             || []).length,
    funcoes:           (data.funcoes           || []).length,
    equivalencias:     (data.equivalencias     || []).length,
    integracoes_se:    (data.integracoes_se    || []).length,
    se_api_templates:  (data.se_api_templates  || []).length,
    se_api_configs:    (data.se_api_configs    || []).length,
    se_api_headers:    (data.se_api_headers    || []).length,
    se_api_mappings:   (data.se_api_mappings   || []).length,
    se_api_flows:      (data.se_api_flows      || []).length,
    se_api_flow_steps: (data.se_api_flow_steps || []).length,
    se_api_logs:       (data.se_api_logs       || []).length,
  };
}

module.exports = function registerRoutes(app, { requireAuth }) {

  // ── Listar ─────────────────────────────────────────────────────────────────
  app.get('/api/empresas', requireAuth, (req, res) => {
    res.json(db.listar());
  });

  // ── Buscar por ID ──────────────────────────────────────────────────────────
  app.get('/api/empresas/:id', requireAuth, (req, res) => {
    const empresa = db.buscarPorId(req.params.id);
    if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(empresa);
  });

  // ── Criar ──────────────────────────────────────────────────────────────────
  app.post('/api/empresas', requireAuth, (req, res) => {
    const { razao_social, documento, site, telefone, email, endereco } = req.body || {};

    if (!razao_social?.trim()) {
      return res.status(400).json({ error: 'Razão Social é obrigatória' });
    }

    const nova = db.criar({
      razao_social: razao_social.trim(),
      documento:    (documento  || '').trim(),
      site:         (site       || '').trim(),
      telefone:     (telefone   || '').trim(),
      email:        (email      || '').trim(),
      endereco:     (endereco   || '').trim(),
    });

    res.status(201).json(nova);
  });

  // ── Atualizar ──────────────────────────────────────────────────────────────
  app.put('/api/empresas/:id', requireAuth, (req, res) => {
    const { razao_social, documento, site, telefone, email, endereco } = req.body || {};

    if (!razao_social?.trim()) {
      return res.status(400).json({ error: 'Razão Social é obrigatória' });
    }

    const atualizada = db.atualizar(req.params.id, {
      razao_social: razao_social.trim(),
      documento:    (documento  || '').trim(),
      site:         (site       || '').trim(),
      telefone:     (telefone   || '').trim(),
      email:        (email      || '').trim(),
      endereco:     (endereco   || '').trim(),
    });

    if (!atualizada) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(atualizada);
  });

  // ── Excluir ────────────────────────────────────────────────────────────────
  app.delete('/api/empresas/:id', requireAuth, (req, res) => {
    const ok = db.excluir(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json({ ok: true });
  });

  // ── Reset de Dados: preview de contagens ──────────────────────────────────
  app.get('/api/admin/reset-preview/:empresaId', requireAuth, requireAdmin, (req, res) => {
    const eid  = Number(req.params.empresaId);
    const data = loadEmpresa(eid);
    if (!data) return res.status(404).json({ error: 'Arquivo da empresa não encontrado.' });
    res.json(contagens(data));
  });

  // ── Reset de Dados: execução ──────────────────────────────────────────────
  app.post('/api/admin/reset-dados', requireAuth, requireAdmin, (req, res) => {
    const { empresa_id, tabelas } = req.body || {};
    if (!empresa_id || !Array.isArray(tabelas) || !tabelas.length)
      return res.status(400).json({ error: 'empresa_id e tabelas são obrigatórios.' });

    const eid  = Number(empresa_id);
    const data = loadEmpresa(eid);
    if (!data) return res.status(404).json({ error: 'Arquivo da empresa não encontrado.' });

    // Expande cascades
    const alvo = new Set(tabelas);
    for (const t of tabelas) {
      (CASCADE[t] || []).forEach(c => alvo.add(c));
    }

    // Aplica zeros
    for (const t of alvo) {
      const def = TABELAS[t];
      if (!def) continue;
      Object.assign(data, def.defaults);
    }

    saveEmpresa(eid, data);
    res.json({ ok: true, zeradas: [...alvo] });
  });

};
