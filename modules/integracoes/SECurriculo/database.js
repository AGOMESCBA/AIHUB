const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', '..', 'data.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function persist(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

let _seqCache = null;
function nextSeq() {
  if (_seqCache === null) {
    const d = load();
    _seqCache = (d.integracoes_se || []).reduce((m, l) => Math.max(m, l._seq || 0), 0) + 1;
  }
  return _seqCache++;
}

module.exports = {
  getConfig() {
    return load().se_config || {
      se_url:   'https://j2a.c3isystems.com.br/apigateway/se/ws/fm_ws.php',
      se_token: '',
    };
  },

  saveConfig(cfg) {
    const d = load();
    d.se_config = { ...(d.se_config || {}), ...cfg };
    persist(d);
  },

  saveLog(entry) {
    const d = load();
    if (!d.integracoes_se) d.integracoes_se = [];
    entry._seq = nextSeq();
    d.integracoes_se.unshift(entry);
    persist(d);
    return entry;
  },

  listLogs({ status, curriculo_nome, analise_id, vaga_id, data_inicio, data_fim, page = 1, limit = 50 } = {}) {
    const d    = load();
    const todos = d.integracoes_se || [];

    // Conjunto de combinações curriculo+analise que já têm sucesso ativo
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

    const total  = logs.length;
    const offset = (Number(page) - 1) * Number(limit);
    const page_logs = logs.slice(offset, offset + Number(limit)).map(l => ({
      ...l,
      ja_integrado: integrados.has(`${l.curriculo_id}|${l.analise_id}`),
    }));
    return { logs: page_logs, total, page: Number(page), limit: Number(limit) };
  },

  getResumoAnalises(analise_ids) {
    const d    = load();
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

  jaIntegrado(curriculo_id, analise_id) {
    return (load().integracoes_se || []).some(
      l => l.curriculo_id === curriculo_id && l.analise_id === analise_id && l.status === 'sucesso'
    );
  },

  // Desflagging: muda o registro 'sucesso' para 'revertido' → jaIntegrado passa a retornar false
  resetarIntegracao(curriculo_id, analise_id) {
    const d = load();
    const logs = d.integracoes_se || [];
    const idx = logs.findIndex(
      l => l.curriculo_id === curriculo_id && l.analise_id === analise_id && l.status === 'sucesso'
    );
    if (idx === -1) return false;
    logs[idx].status      = 'revertido';
    logs[idx].revertido_em = new Date().toISOString();
    persist(d);
    return true;
  },

  // Flagar manualmente como integrado sem enviar para o SE
  marcarIntegradoManual(entry) {
    return this.saveLog({ ...entry, status: 'sucesso', origem: 'manual' });
  },
};
