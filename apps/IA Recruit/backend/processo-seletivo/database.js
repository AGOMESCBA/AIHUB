const fs     = require('fs');
const crypto = require('crypto');
const { empresaDataFile, platformDataFile } = require('../data-paths');

function _file(empresaId) {
  if (!empresaId) throw new Error('empresa_id é obrigatório');
  return empresaDataFile(empresaId);
}

function load(empresaId) {
  const f = _file(empresaId);
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { return {}; }
}

function persist(empresaId, data) {
  fs.writeFileSync(_file(empresaId), JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  // ── Email Config ──────────────────────────────────────────────────────────────
  getEmailConfig(empresaId) {
    const d = load(empresaId);
    return {
      tipo: 'gmail', email: '', senha: '',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: true, family: 4,
      imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: true,
      imap_intervalo_min: 2,
      ...(d.email_config || {}),
    };
  },

  setEmailConfig(empresaId, cfg) {
    const d = load(empresaId);
    const current = this.getEmailConfig(empresaId);
    d.email_config = {
      ...current,
      ...cfg,
      senha: (cfg.senha && cfg.senha !== '••••••••') ? cfg.senha : current.senha,
    };
    persist(empresaId, d);
  },

  getSenhaReal(empresaId) {
    return load(empresaId).email_config?.senha || '';
  },

  // ── Email Geral Config ────────────────────────────────────────────────────────
  getEmailGeralConfig(empresaId) {
    const d = load(empresaId);
    return {
      tipo: 'gmail', email: '', senha: '',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: true, family: 4,
      imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: true,
      ...(d.email_geral_config || {}),
    };
  },

  setEmailGeralConfig(empresaId, cfg) {
    const d = load(empresaId);
    const current = this.getEmailGeralConfig(empresaId);
    d.email_geral_config = {
      ...current,
      ...cfg,
      senha: (cfg.senha && cfg.senha !== '••••••••') ? cfg.senha : current.senha,
    };
    persist(empresaId, d);
  },

  getSenhaGeralReal(empresaId) {
    return load(empresaId).email_geral_config?.senha || '';
  },

  // ── Email Templates ───────────────────────────────────────────────────────────
  getEmailTemplates(empresaId) {
    return load(empresaId).email_templates || {};
  },

  setEmailTemplates(empresaId, tpl) {
    const d = load(empresaId);
    d.email_templates = { ...(d.email_templates || {}), ...tpl };
    persist(empresaId, d);
  },

  // ── Token Público ─────────────────────────────────────────────────────────────
  getPublicToken(empresaId) {
    const d = load(empresaId);
    if (!d.ps_public_token) {
      d.ps_public_token = crypto.randomBytes(24).toString('hex');
      persist(empresaId, d);
    }
    return d.ps_public_token;
  },

  regenerateToken(empresaId) {
    const d = load(empresaId);
    d.ps_public_token = crypto.randomBytes(24).toString('hex');
    persist(empresaId, d);
    return d.ps_public_token;
  },

  // ── Slug ──────────────────────────────────────────────────────────────────────
  getSlug(empresaId) {
    return load(empresaId).ps_public_slug || null;
  },

  setSlug(empresaId, slug) {
    const d = load(empresaId);
    d.ps_public_slug = slug ? slug.toLowerCase().trim() : null;
    persist(empresaId, d);
  },

  resolveToToken(empresaId, identifier) {
    if (!identifier) return null;
    const d = load(empresaId);
    const t = d.ps_public_token;
    if (!t) return null;
    if (identifier === t) return t;
    if (d.ps_public_slug && identifier === d.ps_public_slug) return t;
    return null;
  },

  validateToken(empresaId, identifier) {
    return !!this.resolveToToken(empresaId, identifier);
  },

  // Busca o empresaId a partir de um token ou slug (percorre todos os arquivos de empresa)
  findEmpresaIdByToken(identifier) {
    if (!identifier) return null;
    const empresasFile = platformDataFile('empresas.json');
    if (!fs.existsSync(empresasFile)) return null;
    let empresas = [];
    try { empresas = JSON.parse(fs.readFileSync(empresasFile, 'utf8')) || []; } catch { return null; }
    for (const empresa of empresas) {
      const f = _file(empresa.id);
      if (!fs.existsSync(f)) continue;
      try {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!d.ps_public_token) continue;
        if (identifier === d.ps_public_token) return empresa.id;
        if (d.ps_public_slug && identifier === d.ps_public_slug) return empresa.id;
      } catch { continue; }
    }
    return null;
  },

  // ── Candidaturas ──────────────────────────────────────────────────────────────
  listCandidaturas(empresaId) {
    return (load(empresaId).vaga_candidaturas || []).slice().reverse();
  },

  listCandidaturasByVaga(empresaId, vagaId) {
    return (load(empresaId).vaga_candidaturas || []).filter(c => c.vaga_id === vagaId);
  },

  getCurriculoIdsByVaga(empresaId, vagaId) {
    return (load(empresaId).vaga_candidaturas || [])
      .filter(c => c.vaga_id === vagaId)
      .map(c => c.curriculo_id);
  },

  findCandidaturaByVagaAndCandidato(empresaId, vagaId, email, nome) {
    const lista = load(empresaId).vaga_candidaturas || [];
    return lista.find(c => {
      if (c.vaga_id !== Number(vagaId)) return false;
      if (email && c.candidato_email && c.candidato_email.toLowerCase() === email.toLowerCase()) return true;
      if (nome && c.candidato_nome && c.candidato_nome.toLowerCase() === nome.toLowerCase()) return true;
      return false;
    }) || null;
  },

  updateCandidaturaCurriculoId(empresaId, id, curriculo_id) {
    const d = load(empresaId);
    const c = (d.vaga_candidaturas || []).find(c => c.id === id);
    if (c) { c.curriculo_id = Number(curriculo_id); persist(empresaId, d); }
  },

  saveCandidatura(empresaId, { vaga_id, curriculo_id, canal, candidato_nome, candidato_email }) {
    const d = load(empresaId);
    if (!d.vaga_candidaturas)   d.vaga_candidaturas   = [];
    if (!d.next_candidatura_id) d.next_candidatura_id = 1;
    const id = d.next_candidatura_id++;
    d.vaga_candidaturas.push({
      id,
      empresa_id:      Number(empresaId),
      vaga_id:         Number(vaga_id),
      curriculo_id:    Number(curriculo_id),
      canal:           canal || 'email',
      candidato_nome:  candidato_nome  || null,
      candidato_email: candidato_email || null,
      data: new Date().toISOString(),
    });
    persist(empresaId, d);
    return id;
  },
};
