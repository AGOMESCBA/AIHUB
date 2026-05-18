const fs   = require('fs');
const { empresaDataFile } = require('../data-paths');

function _file(empresaId) {
  if (!empresaId) throw new Error('empresa_id é obrigatório');
  return empresaDataFile(empresaId);
}

function load(empresaId) {
  const f = _file(empresaId);
  if (!fs.existsSync(f)) return { funcoes: [], vagas: [], nextFuncaoId: 1, nextVagaId: 1 };
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!d.funcoes)      d.funcoes      = [];
    if (!d.vagas)        d.vagas        = [];
    if (!d.nextFuncaoId) d.nextFuncaoId = 1;
    if (!d.nextVagaId)   d.nextVagaId   = 1;
    return d;
  } catch { return { funcoes: [], vagas: [], nextFuncaoId: 1, nextVagaId: 1 }; }
}

function persist(empresaId, data) {
  fs.writeFileSync(_file(empresaId), JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  // ── Funções ──────────────────────────────────────────────────────────────────
  listFuncoes(empresaId) { return load(empresaId).funcoes; },

  getFuncao(empresaId, id) { return load(empresaId).funcoes.find(f => f.id === id) || null; },

  saveFuncao(empresaId, row) {
    const data = load(empresaId);
    const id   = data.nextFuncaoId++;
    data.funcoes.push({ id, empresa_id: Number(empresaId), ...row, criado_em: new Date().toISOString() });
    persist(empresaId, data);
    return id;
  },

  updateFuncao(empresaId, id, row) {
    const data = load(empresaId);
    const idx  = data.funcoes.findIndex(f => f.id === id);
    if (idx === -1) return false;
    data.funcoes[idx] = { ...data.funcoes[idx], ...row, id };
    persist(empresaId, data);
    return true;
  },

  deleteFuncao(empresaId, id) {
    const data = load(empresaId);
    const idx  = data.funcoes.findIndex(f => f.id === id);
    if (idx === -1) return false;
    data.funcoes.splice(idx, 1);
    persist(empresaId, data);
    return true;
  },

  // ── Vagas ────────────────────────────────────────────────────────────────────
  listVagas(empresaId) {
    const data = load(empresaId);
    return data.vagas.map(v => ({
      ...v,
      funcao: data.funcoes.find(f => f.id === v.funcao_id) || null,
    }));
  },

  getVaga(empresaId, id) {
    const data = load(empresaId);
    const v    = data.vagas.find(v => v.id === id);
    if (!v) return null;
    return { ...v, funcao: data.funcoes.find(f => f.id === v.funcao_id) || null };
  },

  saveVaga(empresaId, row) {
    const data = load(empresaId);
    const id   = data.nextVagaId++;
    data.vagas.push({ id, empresa_id: Number(empresaId), ...row, criado_em: new Date().toISOString() });
    persist(empresaId, data);
    return id;
  },

  updateVaga(empresaId, id, row) {
    const data = load(empresaId);
    const idx  = data.vagas.findIndex(v => v.id === id);
    if (idx === -1) return false;
    data.vagas[idx] = { ...data.vagas[idx], ...row, id };
    persist(empresaId, data);
    return true;
  },

  deleteVaga(empresaId, id) {
    const data = load(empresaId);
    const idx  = data.vagas.findIndex(v => v.id === id);
    if (idx === -1) return false;
    data.vagas.splice(idx, 1);
    persist(empresaId, data);
    return true;
  },

  // ── Currículos (lidos do mesmo arquivo empresa — gravados pelo whatsapp-curriculo) ──
  listCurriculos(empresaId) { return load(empresaId).curriculos || []; },

  // ── Configuração do analisador ────────────────────────────────────────────────
  getAnalisadorConfig(empresaId) {
    const d = load(empresaId);
    return { junior_max_meses: 12, pleno_max_meses: 36, ...(d.analisador_config || {}) };
  },

  setAnalisadorConfig(empresaId, cfg) {
    const d = load(empresaId);
    d.analisador_config = { ...this.getAnalisadorConfig(empresaId), ...cfg };
    persist(empresaId, d);
  },

  // ── Análises Salvas ───────────────────────────────────────────────────────────
  listAnalises(empresaId) {
    const d = load(empresaId);
    return ((d.analises || []))
      .map(a => ({
        id:               a.id,
        empresa_id:       a.empresa_id ?? Number(empresaId),
        empresa_nome:     a.empresa_nome || null,
        data:             a.data,
        vaga_id:          a.vaga_id,
        funcao_id:        a.funcao_id,
        funcao_nome:      a.funcao_nome,
        total_curriculos: a.total_curriculos,
        total_analisados: a.total_analisados,
        total_eliminados: a.total_eliminados,
        finalistas_count: (a.finalistas_ids || []).length,
        status:           a.status,
      }))
      .sort((a, b) => b.data.localeCompare(a.data));
  },

  getAnalise(empresaId, id) {
    return (load(empresaId).analises || []).find(a => a.id === id) || null;
  },

  getAnaliseByVaga(empresaId, vagaId) {
    const id = Number(vagaId);
    return (load(empresaId).analises || []).find(a => Number(a.vaga_id) === id) || null;
  },

  backfillAnalisesEmpresa(empresaId, empresaNome) {
    const d = load(empresaId);
    if (!Array.isArray(d.analises) || !d.analises.length) return false;

    let changed = false;
    for (const a of d.analises) {
      if (a.empresa_id === undefined || a.empresa_id === null || a.empresa_id === '') {
        a.empresa_id = Number(empresaId);
        changed = true;
      }
      if (!a.empresa_nome && empresaNome) {
        a.empresa_nome = empresaNome;
        changed = true;
      }
    }

    if (changed) persist(empresaId, d);
    return changed;
  },

  saveAnalise(empresaId, analise) {
    const d = load(empresaId);
    if (!d.analises) d.analises = [];
    const idx = d.analises.findIndex(a => a.id === analise.id);
    if (idx >= 0) d.analises[idx] = analise;
    else d.analises.push(analise);
    persist(empresaId, d);
    return analise;
  },

  deleteAnalise(empresaId, id) {
    const d = load(empresaId);
    if (!d.analises) return false;
    const idx = d.analises.findIndex(a => a.id === id);
    if (idx === -1) return false;
    d.analises.splice(idx, 1);
    persist(empresaId, d);
    return true;
  },

  // ── Pesos de Pontuação ────────────────────────────────────────────────────────
  getPesosPontuacao(empresaId) {
    const d = load(empresaId);
    return {
      requisitos_obrigatorios: 50,
      requisitos_desejados:    30,
      formacao:                10,
      habilidades:             10,
      corte_minimo:            50,
      ...(d.pesos_pontuacao || {}),
    };
  },

  setPesosPontuacao(empresaId, pesos) {
    const d = load(empresaId);
    d.pesos_pontuacao = { ...pesos, atualizado_em: new Date().toISOString() };
    persist(empresaId, d);
  },

  // ── Equivalências de Palavras-chave ───────────────────────────────────────────
  listEquivalencias(empresaId) { return load(empresaId).equivalencias || []; },

  saveEquivalencia(empresaId, { keyword, variantes }) {
    const d   = load(empresaId);
    if (!d.equivalencias) d.equivalencias = [];
    const kw  = keyword.toLowerCase().trim();
    const idx = d.equivalencias.findIndex(e => e.keyword === kw);
    const entry = { keyword: kw, variantes: variantes.map(v => v.toLowerCase().trim()).filter(Boolean) };
    if (idx >= 0) d.equivalencias[idx] = entry;
    else d.equivalencias.push(entry);
    persist(empresaId, d);
  },

  deleteEquivalencia(empresaId, keyword) {
    const d   = load(empresaId);
    if (!d.equivalencias) return false;
    const idx = d.equivalencias.findIndex(e => e.keyword === keyword.toLowerCase().trim());
    if (idx === -1) return false;
    d.equivalencias.splice(idx, 1);
    persist(empresaId, d);
    return true;
  },
};
