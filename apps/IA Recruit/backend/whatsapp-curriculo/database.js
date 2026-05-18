const fs   = require('fs');
const { empresaDataFile } = require('../data-paths');

function _file(empresaId) {
  if (!empresaId) throw new Error('empresa_id é obrigatório');
  return empresaDataFile(empresaId);
}

function load(empresaId) {
  const f = _file(empresaId);
  if (!fs.existsSync(f)) return { config: {}, curriculos: [], nextId: 1, processedIds: [] };
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!d.config)       d.config       = {};
    if (!d.curriculos)   d.curriculos   = [];
    if (!d.nextId)       d.nextId       = 1;
    if (!d.processedIds) d.processedIds = [];
    return d;
  }
  catch { return { config: {}, curriculos: [], nextId: 1, processedIds: [] }; }
}

function persist(empresaId, data) {
  fs.writeFileSync(_file(empresaId), JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  getConfig(empresaId, key) {
    return load(empresaId).config[key] ?? null;
  },

  setConfig(empresaId, key, value) {
    const data = load(empresaId);
    data.config[key] = value;
    persist(empresaId, data);
  },

  saveCurriculo(empresaId, row) {
    const data = load(empresaId);
    const id   = data.nextId++;
    data.curriculos.push({
      id,
      empresa_id:      Number(empresaId),
      empresa_nome:    row.empresa_nome    || null,
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
    persist(empresaId, data);
    return id;
  },

  listCurriculos(empresaId) {
    return load(empresaId).curriculos
      .map(({ id, remetente, nome, telefone, email, recebido_em }) =>
        ({ id, remetente, nome, telefone, email, recebido_em }))
      .reverse();
  },

  getCurriculo(empresaId, id) {
    return load(empresaId).curriculos.find(c => c.id === id) || null;
  },

  findByPhoneOrEmail(empresaId, telefone, email) {
    const data = load(empresaId);
    return data.curriculos.find(c =>
      (telefone && c.telefone && c.telefone === telefone) ||
      (email    && c.email    && c.email.toLowerCase() === email.toLowerCase())
    ) || null;
  },

  deleteCurriculo(empresaId, id) {
    const data = load(empresaId);
    const idx  = data.curriculos.findIndex(c => c.id === id);
    if (idx === -1) return false;
    data.curriculos.splice(idx, 1);
    persist(empresaId, data);
    return true;
  },

  isProcessed(empresaId, messageId) {
    return load(empresaId).processedIds.includes(messageId);
  },

  markProcessed(empresaId, messageId) {
    const data = load(empresaId);
    if (!data.processedIds.includes(messageId)) {
      data.processedIds.push(messageId);
      if (data.processedIds.length > 2000) data.processedIds = data.processedIds.slice(-2000);
      persist(empresaId, data);
    }
  },

  savePendingUpdate(empresaId, sender, pendingData) {
    const data = load(empresaId);
    if (!data.pendingUpdates) data.pendingUpdates = [];
    data.pendingUpdates = data.pendingUpdates.filter(p => p.sender !== sender);
    data.pendingUpdates.push({ sender, ...pendingData, criado_em: new Date().toISOString() });
    persist(empresaId, data);
  },

  getPendingUpdate(empresaId, sender) {
    const data = load(empresaId);
    return (data.pendingUpdates || []).find(p => p.sender === sender) || null;
  },

  deletePendingUpdate(empresaId, sender) {
    const data = load(empresaId);
    if (!data.pendingUpdates) return;
    data.pendingUpdates = data.pendingUpdates.filter(p => p.sender !== sender);
    persist(empresaId, data);
  },

  listPendingUpdates(empresaId) {
    return load(empresaId).pendingUpdates || [];
  },
};
