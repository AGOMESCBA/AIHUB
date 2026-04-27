const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', '..', 'data.json');

function load() {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function persist(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  // ── Email Config ─────────────────────────────────────────────────────────────
  getEmailConfig() {
    const d = load();
    return {
      tipo: 'gmail', email: '', senha: '',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: true, family: 4,
      imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: true,
      imap_intervalo_min: 2,
      ...(d.email_config || {}),
    };
  },

  setEmailConfig(cfg) {
    const d = load();
    const current = this.getEmailConfig();
    d.email_config = {
      ...current,
      ...cfg,
      // Não sobrescreve senha se vier mascarada
      senha: (cfg.senha && cfg.senha !== '••••••••') ? cfg.senha : current.senha,
    };
    persist(d);
  },

  getSenhaReal() {
    return load().email_config?.senha || '';
  },

  // ── Email Geral Config ────────────────────────────────────────────────────────
  getEmailGeralConfig() {
    const d = load();
    return {
      tipo: 'gmail', email: '', senha: '',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: true, family: 4,
      imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: true,
      ...(d.email_geral_config || {}),
    };
  },

  setEmailGeralConfig(cfg) {
    const d = load();
    const current = this.getEmailGeralConfig();
    d.email_geral_config = {
      ...current,
      ...cfg,
      senha: (cfg.senha && cfg.senha !== '••••••••') ? cfg.senha : current.senha,
    };
    persist(d);
  },

  getSenhaGeralReal() {
    return load().email_geral_config?.senha || '';
  },

  // ── Email Templates ───────────────────────────────────────────────────────────
  getEmailTemplates() {
    return load().email_templates || {};
  },

  setEmailTemplates(tpl) {
    const d = load();
    d.email_templates = { ...(d.email_templates || {}), ...tpl };
    persist(d);
  },

  // ── Token Público ─────────────────────────────────────────────────────────────
  getPublicToken() {
    const d = load();
    if (!d.ps_public_token) {
      d.ps_public_token = crypto.randomBytes(24).toString('hex');
      persist(d);
    }
    return d.ps_public_token;
  },

  regenerateToken() {
    const d = load();
    d.ps_public_token = crypto.randomBytes(24).toString('hex');
    persist(d);
    return d.ps_public_token;
  },

  // ── Slug ──────────────────────────────────────────────────────────────────────
  getSlug() {
    return load().ps_public_slug || null;
  },

  setSlug(slug) {
    const d = load();
    d.ps_public_slug = slug ? slug.toLowerCase().trim() : null;
    persist(d);
  },

  // Resolve slug ou token UUID → token real (null se inválido)
  resolveToToken(identifier) {
    if (!identifier) return null;
    const d = load();
    const t = d.ps_public_token;
    if (!t) return null;
    if (identifier === t) return t;
    if (d.ps_public_slug && identifier === d.ps_public_slug) return t;
    return null;
  },

  validateToken(identifier) {
    return !!this.resolveToToken(identifier);
  },

  // ── Candidaturas ──────────────────────────────────────────────────────────────
  listCandidaturas() {
    return (load().vaga_candidaturas || []).slice().reverse();
  },

  listCandidaturasByVaga(vagaId) {
    return (load().vaga_candidaturas || []).filter(c => c.vaga_id === vagaId);
  },

  getCurriculoIdsByVaga(vagaId) {
    return (load().vaga_candidaturas || [])
      .filter(c => c.vaga_id === vagaId)
      .map(c => c.curriculo_id);
  },

  findCandidaturaByVagaAndCandidato(vagaId, email, nome) {
    const lista = load().vaga_candidaturas || [];
    return lista.find(c => {
      if (c.vaga_id !== Number(vagaId)) return false;
      if (email && c.candidato_email && c.candidato_email.toLowerCase() === email.toLowerCase()) return true;
      if (nome && c.candidato_nome && c.candidato_nome.toLowerCase() === nome.toLowerCase()) return true;
      return false;
    }) || null;
  },

  updateCandidaturaCurriculoId(id, curriculo_id) {
    const d = load();
    const c = (d.vaga_candidaturas || []).find(c => c.id === id);
    if (c) { c.curriculo_id = Number(curriculo_id); persist(d); }
  },

  saveCandidatura({ vaga_id, curriculo_id, canal, candidato_nome, candidato_email }) {
    const d = load();
    if (!d.vaga_candidaturas)   d.vaga_candidaturas   = [];
    if (!d.next_candidatura_id) d.next_candidatura_id = 1;
    const id = d.next_candidatura_id++;
    d.vaga_candidaturas.push({
      id,
      vaga_id:         Number(vaga_id),
      curriculo_id:    Number(curriculo_id),
      canal:           canal || 'email',
      candidato_nome:  candidato_nome  || null,
      candidato_email: candidato_email || null,
      data: new Date().toISOString(),
    });
    persist(d);
    return id;
  },
};
