const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data.json');

function load() {
  if (!fs.existsSync(FILE)) return { funcoes: [], vagas: [], nextFuncaoId: 1, nextVagaId: 1 };
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!d.funcoes)      d.funcoes      = [];
    if (!d.vagas)        d.vagas        = [];
    if (!d.nextFuncaoId) d.nextFuncaoId = 1;
    if (!d.nextVagaId)   d.nextVagaId   = 1;
    return d;
  } catch { return { funcoes: [], vagas: [], nextFuncaoId: 1, nextVagaId: 1 }; }
}

function persist(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  // ── Funções ─────────────────────────────────────────────────────────────────
  listFuncoes() { return load().funcoes; },

  getFuncao(id) { return load().funcoes.find(f => f.id === id) || null; },

  saveFuncao(row) {
    const data = load();
    const id   = data.nextFuncaoId++;
    data.funcoes.push({ id, ...row, criado_em: new Date().toISOString() });
    persist(data);
    return id;
  },

  updateFuncao(id, row) {
    const data = load();
    const idx  = data.funcoes.findIndex(f => f.id === id);
    if (idx === -1) return false;
    data.funcoes[idx] = { ...data.funcoes[idx], ...row, id };
    persist(data);
    return true;
  },

  deleteFuncao(id) {
    const data = load();
    const idx  = data.funcoes.findIndex(f => f.id === id);
    if (idx === -1) return false;
    data.funcoes.splice(idx, 1);
    persist(data);
    return true;
  },

  // ── Vagas ────────────────────────────────────────────────────────────────────
  listVagas() {
    const data = load();
    return data.vagas.map(v => ({
      ...v,
      funcao: data.funcoes.find(f => f.id === v.funcao_id) || null,
    }));
  },

  getVaga(id) {
    const data = load();
    const v    = data.vagas.find(v => v.id === id);
    if (!v) return null;
    return { ...v, funcao: data.funcoes.find(f => f.id === v.funcao_id) || null };
  },

  saveVaga(row) {
    const data = load();
    const id   = data.nextVagaId++;
    data.vagas.push({ id, ...row, criado_em: new Date().toISOString() });
    persist(data);
    return id;
  },

  updateVaga(id, row) {
    const data = load();
    const idx  = data.vagas.findIndex(v => v.id === id);
    if (idx === -1) return false;
    data.vagas[idx] = { ...data.vagas[idx], ...row, id };
    persist(data);
    return true;
  },

  deleteVaga(id) {
    const data = load();
    const idx  = data.vagas.findIndex(v => v.id === id);
    if (idx === -1) return false;
    data.vagas.splice(idx, 1);
    persist(data);
    return true;
  },

  // ── Currículos (para o analisador) ───────────────────────────────────────────
  listCurriculos() { return load().curriculos || []; },
};
