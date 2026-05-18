const fs   = require('fs');
const { empresaDataFile } = require('../../data-paths');

function _file(empresaId) {
  if (!empresaId) throw new Error('empresa_id é obrigatório');
  return empresaDataFile(empresaId);
}

function load(empresaId) {
  const f = _file(empresaId);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { return {}; }
}

function persist(empresaId, data) {
  fs.writeFileSync(_file(empresaId), JSON.stringify(data, null, 2), 'utf8');
}

function nextSeq(empresaId) {
  const d = load(empresaId);
  return (d.integracoes_se_funcao || []).reduce((m, l) => Math.max(m, l._seq || 0), 0) + 1;
}

module.exports = {
  getConfig(empresaId) {
    return {
      integration_source: 'flow',
      se_api_flow_id:     null,
      ...(load(empresaId).se_funcao_config || {}),
    };
  },

  saveConfig(empresaId, cfg) {
    const d = load(empresaId);
    d.se_funcao_config = { ...(d.se_funcao_config || {}), ...cfg };
    persist(empresaId, d);
  },

  saveLog(empresaId, entry) {
    const d = load(empresaId);
    if (!d.integracoes_se_funcao) d.integracoes_se_funcao = [];
    entry._seq = nextSeq(empresaId);
    d.integracoes_se_funcao.unshift(entry);
    persist(empresaId, d);
    return entry;
  },

  listLogs(empresaId, { status, funcao_nome, data_inicio, data_fim, page = 1, limit = 50 } = {}) {
    const d    = load(empresaId);
    let   logs = d.integracoes_se_funcao || [];

    if (status)      logs = logs.filter(l => l.status === status);
    if (funcao_nome) { const q = funcao_nome.toLowerCase(); logs = logs.filter(l => (l.funcao_nome || '').toLowerCase().includes(q)); }
    if (data_inicio) logs = logs.filter(l => l.data_envio >= data_inicio);
    if (data_fim)    logs = logs.filter(l => l.data_envio <= data_fim + 'T23:59:59');

    const total    = logs.length;
    const offset   = (Number(page) - 1) * Number(limit);
    const pageLogs = logs.slice(offset, offset + Number(limit));
    return { logs: pageLogs, total, page: Number(page), limit: Number(limit) };
  },

  getLogBySeq(empresaId, seq) {
    return (load(empresaId).integracoes_se_funcao || []).find(l => l._seq === Number(seq)) || null;
  },

  getSeApiLogsByIds(empresaId, ids) {
    if (!ids || !ids.length) return [];
    const d = load(empresaId);
    return (d.se_api_logs || []).filter(l => ids.includes(l.id));
  },

  getStatusMapa(empresaId) {
    const logs = load(empresaId).integracoes_se_funcao || [];
    const mapa = {};
    for (const l of [...logs].reverse()) {
      if (!mapa[l.funcao_id]) mapa[l.funcao_id] = l.status;
    }
    return mapa;
  },

  resetarIntegracao(empresaId, seq) {
    const d    = load(empresaId);
    const logs = d.integracoes_se_funcao || [];
    const idx  = logs.findIndex(l => l._seq === Number(seq) && l.status === 'sucesso');
    if (idx === -1) return false;
    logs[idx].status       = 'revertido';
    logs[idx].revertido_em = new Date().toISOString();
    persist(empresaId, d);
    return true;
  },
};
