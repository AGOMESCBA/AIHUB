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
  return (d.integracoes_se || []).reduce((m, l) => Math.max(m, l._seq || 0), 0) + 1;
}

module.exports = {
  getConfig(empresaId) {
    return {
      se_url:              'https://j2a.c3isystems.com.br/apigateway/se/ws/fm_ws.php',
      se_token:            '',
      campo_empresa_id:    '',
      campo_empresa_nome:  '',
      integration_source:  'legacy',
      se_api_flow_id:      null,
      ...(load(empresaId).se_config || {}),
    };
  },

  saveConfig(empresaId, cfg) {
    const d = load(empresaId);
    d.se_config = { ...(d.se_config || {}), ...cfg };
    persist(empresaId, d);
  },

  saveLog(empresaId, entry) {
    const d = load(empresaId);
    if (!d.integracoes_se) d.integracoes_se = [];
    entry._seq = nextSeq(empresaId);
    d.integracoes_se.unshift(entry);
    persist(empresaId, d);
    return entry;
  },

  listLogs(empresaId, { status, curriculo_nome, analise_id, vaga_id, data_inicio, data_fim, page = 1, limit = 50 } = {}) {
    const d    = load(empresaId);
    const todos = d.integracoes_se || [];

    const integrados = new Set(
      todos.filter(l => l.status === 'sucesso').map(l => `${l.curriculo_id}|${l.analise_id}`)
    );

    let logs = todos;
    if (status)         logs = logs.filter(l => l.status === status);
    if (analise_id)     logs = logs.filter(l => l.analise_id === analise_id);
    if (vaga_id)        logs = logs.filter(l => l.vaga_id === Number(vaga_id));
    if (curriculo_nome) { const q = curriculo_nome.toLowerCase(); logs = logs.filter(l => (l.curriculo_nome || '').toLowerCase().includes(q)); }
    if (data_inicio)    logs = logs.filter(l => l.data_envio >= data_inicio);
    if (data_fim)       logs = logs.filter(l => l.data_envio <= data_fim + 'T23:59:59');

    const total    = logs.length;
    const offset   = (Number(page) - 1) * Number(limit);
    const page_logs = logs.slice(offset, offset + Number(limit)).map(l => ({
      ...l,
      ja_integrado: integrados.has(`${l.curriculo_id}|${l.analise_id}`),
    }));
    return { logs: page_logs, total, page: Number(page), limit: Number(limit) };
  },

  getResumoAnalises(empresaId, analise_ids) {
    const d    = load(empresaId);
    const logs = d.integracoes_se || [];
    const res  = {};
    for (const id of analise_ids) {
      const ls = logs.filter(l => l.analise_id === id);
      res[id] = {
        total:    ls.length,
        sucesso:  ls.filter(l => l.status === 'sucesso').length,
        erro:     ls.filter(l => l.status === 'erro').length,
        ignorado: ls.filter(l => l.status === 'ignorado').length,
      };
    }
    return res;
  },

  jaIntegrado(empresaId, curriculo_id, analise_id) {
    return (load(empresaId).integracoes_se || []).some(
      l => l.curriculo_id === curriculo_id && l.analise_id === analise_id && l.status === 'sucesso'
    );
  },

  resetarIntegracao(empresaId, curriculo_id, analise_id) {
    const d   = load(empresaId);
    const logs = d.integracoes_se || [];
    const idx = logs.findIndex(
      l => l.curriculo_id === curriculo_id && l.analise_id === analise_id && l.status === 'sucesso'
    );
    if (idx === -1) return false;
    logs[idx].status       = 'revertido';
    logs[idx].revertido_em = new Date().toISOString();
    persist(empresaId, d);
    return true;
  },

  marcarIntegradoManual(empresaId, entry) {
    return this.saveLog(empresaId, { ...entry, status: 'sucesso', origem: 'manual' });
  },

  getLogBySeq(empresaId, seq) {
    return (load(empresaId).integracoes_se || []).find(l => l._seq === Number(seq)) || null;
  },

  getSeApiLogsByIds(empresaId, ids) {
    if (!ids || !ids.length) return [];
    const d = load(empresaId);
    return (d.se_api_logs || []).filter(l => ids.includes(l.id));
  },
};
