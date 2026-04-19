const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data.json');

function load() {
  if (!fs.existsSync(FILE)) return { config: {}, curriculos: [], nextId: 1, processedIds: [] };
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!d.processedIds) d.processedIds = [];
    return d;
  }
  catch { return { config: {}, curriculos: [], nextId: 1, processedIds: [] }; }
}

function persist(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  getConfig(key) {
    return load().config[key] ?? null;
  },

  setConfig(key, value) {
    const data = load();
    data.config[key] = value;
    persist(data);
  },

  saveCurriculo(row) {
    const data = load();
    const id   = data.nextId++;
    data.curriculos.push({
      id,
      remetente:       row.remetente,
      nome:            row.nome            || null,
      telefone:        row.telefone        || null,
      email:           row.email           || null,
      endereco:        row.endereco        || null,
      linkedin:        row.linkedin        || null,
      descricao:       row.descricao       || null,
      experiencias:    row.experiencias    || [],
      formacao:        row.formacao        || [],
      capacitacoes:    row.capacitacoes    || [],
      habilidades:     row.habilidades     || [],
      dados_completos: row.dados_completos || null,
      pdf_base64:      row.pdf_base64      || null,
      pdf_nome:        row.pdf_nome        || null,
      recebido_em:     new Date().toISOString(),
    });
    persist(data);
    return id;
  },

  listCurriculos() {
    return load().curriculos
      .map(({ id, remetente, nome, telefone, email, recebido_em }) =>
        ({ id, remetente, nome, telefone, email, recebido_em }))
      .reverse();
  },

  getCurriculo(id) {
    return load().curriculos.find(c => c.id === id) || null;
  },

  findByPhoneOrEmail(telefone, email) {
    const data = load();
    return data.curriculos.find(c =>
      (telefone && c.telefone && c.telefone === telefone) ||
      (email    && c.email    && c.email.toLowerCase() === email.toLowerCase())
    ) || null;
  },

  deleteCurriculo(id) {
    const data = load();
    const idx  = data.curriculos.findIndex(c => c.id === id);
    if (idx === -1) return false;
    data.curriculos.splice(idx, 1);
    persist(data);
    return true;
  },

  isProcessed(messageId) {
    return load().processedIds.includes(messageId);
  },

  markProcessed(messageId) {
    const data = load();
    if (!data.processedIds.includes(messageId)) {
      data.processedIds.push(messageId);
      // Mantém apenas os últimos 2000 para o arquivo não crescer infinitamente
      if (data.processedIds.length > 2000) data.processedIds = data.processedIds.slice(-2000);
      persist(data);
    }
  },

  // ── Confirmações pendentes (SIM/NÃO) ─────────────────────────────────────
  savePendingUpdate(sender, pendingData) {
    const data = load();
    if (!data.pendingUpdates) data.pendingUpdates = [];
    // Remove entrada anterior do mesmo remetente (se houver)
    data.pendingUpdates = data.pendingUpdates.filter(p => p.sender !== sender);
    data.pendingUpdates.push({ sender, ...pendingData, criado_em: new Date().toISOString() });
    persist(data);
  },

  getPendingUpdate(sender) {
    const data = load();
    return (data.pendingUpdates || []).find(p => p.sender === sender) || null;
  },

  deletePendingUpdate(sender) {
    const data = load();
    if (!data.pendingUpdates) return;
    data.pendingUpdates = data.pendingUpdates.filter(p => p.sender !== sender);
    persist(data);
  },

  listPendingUpdates() {
    return load().pendingUpdates || [];
  },
};
