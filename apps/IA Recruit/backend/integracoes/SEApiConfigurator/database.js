const fs   = require('fs');
const { empresaDataFile } = require('../../data-paths');

// ── Tabelas de origem disponíveis para carregamento automático ────────────────
const SOURCE_TABLES = {
  curriculos: {
    label:    'Currículos',
    file_key: 'curriculos',
    id_field: 'id',
    fields: [
      'id','empresa_id','empresa_nome','remetente',
      'nome','telefone','email','endereco','linkedin',
      'descricao','experiencias','formacao','capacitacoes',
      'habilidades','dados_completos', 'outros',
      'pdf_base64','pdf_nome',
      'recebido_em',
    ],
  },
  vagas: {
    label:    'Vagas',
    file_key: 'vagas',
    id_field: 'id',
    fields: ['id','titulo','descricao','funcao_id','status','se_workflow_id','criado_em'],
  },
  funcoes: {
    label:    'Funções',
    file_key: 'funcoes',
    id_field: 'id',
    fields: ['id','nome','descricao','criado_em'],
  },
  candidaturas: {
    label:    'Candidaturas',
    file_key: 'vaga_candidaturas',
    id_field: 'id',
    fields: ['id','vaga_id','curriculo_id','canal','candidato_nome','candidato_email','data'],
  },
  resultados_analise: {
    label:    'Resultados da Analise',
    virtual:  true,
    id_field: 'resultado_id',
    fields: [
      'resultado_id','analise_id','vaga_id','funcao_id','funcao_nome',
      'curriculo_id','finalista',
      'score','peso','nivel','nivel_candidato','resumo',
      'pontos_positivos','pontos_positivos_texto',
      'pontos_negativos','pontos_a_avaliar','pontos_a_avaliar_texto',
      'motivo_eliminacao',
      'detalhes','requisitos_obrigatorios','requisitos_desejados','formacao_score','habilidades_tecnicas','nivel_experiencia_score',
      'empresa_id','empresa_nome','remetente',
      'nome','telefone','email','endereco','linkedin',
      'descricao','experiencias','formacao','capacitacoes',
      'habilidades','dados_completos','outros',
      'pdf_base64','pdf_nome','recebido_em',
    ],
  },
};

// ── Helpers por empresa ───────────────────────────────────────────────────────

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

function nextId(lista) {
  if (!lista || !lista.length) return 1;
  return Math.max(...lista.map(i => i.id || 0)) + 1;
}

function memoList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(v => `- ${v}`).join('\n');
  return value || '';
}

function buildResultadoAnaliseRecord(empresaId, analise, resultado, curriculo, eliminado) {
  const detalhes = resultado.detalhes || {};
  const curriculoId = resultado.id ?? curriculo?.id ?? eliminado?.id;
  const pontosNegativos = resultado.pontos_negativos || [];
  const record = {
    ...(curriculo || {}),
    ...resultado,
    empresa_id: Number(empresaId),
    empresa_nome: analise.empresa_nome || curriculo?.empresa_nome || null,
    resultado_id: `${analise.id}:${curriculoId}`,
    analise_id: analise.id,
    vaga_id: analise.vaga_id ?? null,
    funcao_id: analise.funcao_id ?? null,
    funcao_nome: analise.funcao_nome || null,
    curriculo_id: curriculoId,
    finalista: (analise.finalistas_ids || []).map(Number).includes(Number(curriculoId)),
    peso: resultado.score ?? null,
    pontos_positivos_texto: memoList(resultado.pontos_positivos),
    pontos_a_avaliar: pontosNegativos,
    pontos_a_avaliar_texto: memoList(pontosNegativos),
    motivo_eliminacao: eliminado?.motivo || resultado.motivo_eliminacao || null,
    requisitos_obrigatorios: detalhes.requisitos_obrigatorios ?? null,
    requisitos_desejados: detalhes.requisitos_desejados ?? null,
    formacao_score: detalhes.formacao ?? null,
    habilidades_tecnicas: detalhes.habilidades_tecnicas ?? null,
    nivel_experiencia_score: detalhes.nivel_experiencia ?? null,
  };
  record.id = record.resultado_id;
  return record;
}

function loadResultadoAnaliseRecord(empresaId, recordId) {
  const d = load(empresaId);
  const analises = d.analises || [];
  const curriculos = d.curriculos || [];
  const wanted = String(recordId);
  const [wantedAnaliseId, wantedCurriculoId] = wanted.includes(':') ? wanted.split(':') : [null, wanted];

  for (const analise of analises) {
    if (wantedAnaliseId && String(analise.id) !== wantedAnaliseId) continue;

    const resultados = analise.resultados || [];
    for (const resultado of resultados) {
      const curriculoId = resultado.id;
      const resultadoId = `${analise.id}:${curriculoId}`;
      if (resultadoId !== wanted && String(curriculoId) !== wanted) continue;

      const curriculo = curriculos.find(c => String(c.id) === String(curriculoId)) || null;
      const eliminado = (analise.eliminados || []).find(e => String(e.id) === String(curriculoId)) || null;
      return buildResultadoAnaliseRecord(empresaId, analise, resultado, curriculo, eliminado);
    }

    const eliminado = (analise.eliminados || []).find(e => `${analise.id}:${e.id}` === wanted || String(e.id) === wanted);
    if (eliminado) {
      const curriculo = curriculos.find(c => String(c.id) === String(eliminado.id)) || null;
      return buildResultadoAnaliseRecord(empresaId, analise, { id: eliminado.id }, curriculo, eliminado);
    }
  }

  throw new Error(`Registro ID ${recordId} nao encontrado na tabela "Resultados da Analise"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATES (por empresa)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {

  listTemplates(empresaId) {
    return load(empresaId).se_api_templates || [];
  },

  getTemplate(empresaId, id) {
    return (load(empresaId).se_api_templates || []).find(t => t.id === Number(id)) || null;
  },

  createTemplate(empresaId, row) {
    const d = load(empresaId);
    if (!d.se_api_templates) d.se_api_templates = [];
    const novo = {
      id: nextId(d.se_api_templates),
      empresa_id: Number(empresaId),
      ...row,
      criado_em: new Date().toISOString(),
    };
    d.se_api_templates.push(novo);
    persist(empresaId, d);
    return novo;
  },

  updateTemplate(empresaId, id, row) {
    const d    = load(empresaId);
    const list = d.se_api_templates || [];
    const idx  = list.findIndex(t => t.id === Number(id));
    if (idx === -1) return null;
    const { id: _id, criado_em: _c, empresa_id: _e, ...patch } = row;
    list[idx] = { ...list[idx], ...patch, atualizado_em: new Date().toISOString() };
    d.se_api_templates = list;
    persist(empresaId, d);
    return list[idx];
  },

  deleteTemplate(empresaId, id) {
    const d    = load(empresaId);
    const list = d.se_api_templates || [];
    const idx  = list.findIndex(t => t.id === Number(id));
    if (idx === -1) return false;
    list.splice(idx, 1);
    d.se_api_templates = list;
    persist(empresaId, d);
    return true;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIGS (por empresa)
  // ─────────────────────────────────────────────────────────────────────────

  listConfigs(empresaId) {
    return load(empresaId).se_api_configs || [];
  },

  getConfig(empresaId, id) {
    return (load(empresaId).se_api_configs || []).find(c => c.id === Number(id)) || null;
  },

  createConfig(empresaId, row) {
    const d = load(empresaId);
    if (!d.se_api_configs) d.se_api_configs = [];
    const novo = {
      id: nextId(d.se_api_configs),
      empresa_id: Number(empresaId),
      ativo: true,
      ...row,
      criado_em: new Date().toISOString(),
    };
    d.se_api_configs.push(novo);
    persist(empresaId, d);
    return novo;
  },

  updateConfig(empresaId, id, row) {
    const d    = load(empresaId);
    const list = d.se_api_configs || [];
    const idx  = list.findIndex(c => c.id === Number(id));
    if (idx === -1) return null;
    const { id: _id, criado_em: _c, empresa_id: _e, ...patch } = row;
    list[idx] = { ...list[idx], ...patch, atualizado_em: new Date().toISOString() };
    d.se_api_configs = list;
    persist(empresaId, d);
    return list[idx];
  },

  deleteConfig(empresaId, id) {
    const d    = load(empresaId);
    const list = d.se_api_configs || [];
    const idx  = list.findIndex(c => c.id === Number(id));
    if (idx === -1) return false;
    list.splice(idx, 1);
    d.se_api_configs = list;
    // Limpa headers e mappings orphans
    d.se_api_headers  = (d.se_api_headers  || []).filter(h => h.config_id !== Number(id));
    d.se_api_mappings = (d.se_api_mappings || []).filter(m => m.config_id !== Number(id));
    persist(empresaId, d);
    return true;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HEADERS (por config, por empresa)
  // ─────────────────────────────────────────────────────────────────────────

  listHeaders(empresaId, configId) {
    return (load(empresaId).se_api_headers || [])
      .filter(h => h.config_id === Number(configId));
  },

  setHeaders(empresaId, configId, headers) {
    const d      = load(empresaId);
    const outros = (d.se_api_headers || []).filter(h => h.config_id !== Number(configId));
    d.se_api_headers = [
      ...outros,
      ...headers.map(h => ({ key: h.key, value: h.value, config_id: Number(configId) })),
    ];
    persist(empresaId, d);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MAPPINGS (por config, por empresa)
  // ─────────────────────────────────────────────────────────────────────────

  listMappings(empresaId, configId) {
    return (load(empresaId).se_api_mappings || [])
      .filter(m => m.config_id === Number(configId));
  },

  setMappings(empresaId, configId, mappings) {
    const d      = load(empresaId);
    const outros = (d.se_api_mappings || []).filter(m => m.config_id !== Number(configId));
    d.se_api_mappings = [
      ...outros,
      ...mappings.map(m => ({
        source_field:  m.source_field,
        se_field_id:   m.se_field_id   ?? null,
        placeholder:   m.placeholder   ?? null,
        default_value: m.default_value ?? null,
        config_id:     Number(configId),
      })),
    ];
    persist(empresaId, d);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FLOWS (por empresa)
  // ─────────────────────────────────────────────────────────────────────────

  listFlows(empresaId) {
    return load(empresaId).se_api_flows || [];
  },

  getFlow(empresaId, id) {
    return (load(empresaId).se_api_flows || []).find(f => f.id === Number(id)) || null;
  },

  createFlow(empresaId, row) {
    const d = load(empresaId);
    if (!d.se_api_flows) d.se_api_flows = [];
    const novo = {
      id: nextId(d.se_api_flows),
      empresa_id: Number(empresaId),
      ...row,
      criado_em: new Date().toISOString(),
    };
    d.se_api_flows.push(novo);
    persist(empresaId, d);
    return novo;
  },

  updateFlow(empresaId, id, row) {
    const d    = load(empresaId);
    const list = d.se_api_flows || [];
    const idx  = list.findIndex(f => f.id === Number(id));
    if (idx === -1) return null;
    const { id: _id, criado_em: _c, empresa_id: _e, ...patch } = row;
    list[idx] = { ...list[idx], ...patch, atualizado_em: new Date().toISOString() };
    d.se_api_flows = list;
    persist(empresaId, d);
    return list[idx];
  },

  deleteFlow(empresaId, id) {
    const d    = load(empresaId);
    const list = d.se_api_flows || [];
    const idx  = list.findIndex(f => f.id === Number(id));
    if (idx === -1) return false;
    list.splice(idx, 1);
    d.se_api_flows      = list;
    d.se_api_flow_steps = (d.se_api_flow_steps || []).filter(s => s.flow_id !== Number(id));
    persist(empresaId, d);
    return true;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FLOW STEPS (por flow, por empresa)
  // ─────────────────────────────────────────────────────────────────────────

  listFlowSteps(empresaId, flowId) {
    return (load(empresaId).se_api_flow_steps || [])
      .filter(s => s.flow_id === Number(flowId))
      .sort((a, b) => a.ordem - b.ordem);
  },

  setFlowSteps(empresaId, flowId, steps) {
    const d      = load(empresaId);
    const outros = (d.se_api_flow_steps || []).filter(s => s.flow_id !== Number(flowId));
    d.se_api_flow_steps = [
      ...outros,
      ...steps.map((s, i) => ({
        config_id: Number(s.config_id),
        flow_id:   Number(flowId),
        ordem:     i + 1,
        parar_em_erro: s.parar_em_erro !== false,
      })),
    ];
    persist(empresaId, d);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SOURCE TABLES — catálogo + carregamento de registros
  // ─────────────────────────────────────────────────────────────────────────

  listSourceTables() {
    return Object.entries(SOURCE_TABLES).map(([key, meta]) => ({
      key,
      label:    meta.label,
      id_field: meta.id_field,
      fields:   meta.fields,
    }));
  },

  getSourceTableMeta(tableKey) {
    return SOURCE_TABLES[tableKey] || null;
  },

  loadSourceRecord(empresaId, tableKey, recordId) {
    const meta = SOURCE_TABLES[tableKey];
    if (!meta) throw new Error(`Tabela de origem desconhecida: "${tableKey}"`);
    if (tableKey === 'resultados_analise') return loadResultadoAnaliseRecord(empresaId, recordId);
    const d    = load(empresaId);
    const list = d[meta.file_key] || [];
    const id   = isNaN(recordId) ? recordId : Number(recordId);
    const rec  = list.find(r => r[meta.id_field] === id || String(r[meta.id_field]) === String(recordId));
    if (!rec) throw new Error(`Registro ID ${recordId} não encontrado na tabela "${meta.label}"`);
    return rec;
  },

  updateSourceRecord(empresaId, tableKey, recordId, fields) {
    const meta = SOURCE_TABLES[tableKey];
    if (!meta) throw new Error(`Tabela de origem desconhecida: "${tableKey}"`);
    if (meta.virtual) throw new Error(`Tabela de origem "${meta.label}" nao permite atualizacao direta`);
    const d    = load(empresaId);
    const list = d[meta.file_key] || [];
    const id   = isNaN(recordId) ? recordId : Number(recordId);
    const idx  = list.findIndex(r => r[meta.id_field] === id || String(r[meta.id_field]) === String(recordId));
    if (idx === -1) throw new Error(`Registro ID ${recordId} não encontrado na tabela "${meta.label}"`);
    list[idx] = { ...list[idx], ...fields };
    d[meta.file_key] = list;
    persist(empresaId, d);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LOGS (por empresa)
  // ─────────────────────────────────────────────────────────────────────────

  saveLog(empresaId, entry) {
    const d = load(empresaId);
    if (!d.se_api_logs)    d.se_api_logs    = [];
    if (!d._se_api_log_id) d._se_api_log_id = 1;
    const log = { id: d._se_api_log_id++, data: new Date().toISOString(), ...entry };
    d.se_api_logs.unshift(log);
    if (d.se_api_logs.length > 1000) d.se_api_logs = d.se_api_logs.slice(0, 1000);
    persist(empresaId, d);
    return log;
  },

  listLogs(empresaId, { status, config_nome, flow_id, tipo, data_inicio, data_fim, page = 1, limit = 200 } = {}) {
    const d    = load(empresaId);
    let   logs = d.se_api_logs || [];

    if (status)      logs = logs.filter(l => l.status === status);
    if (flow_id)     logs = logs.filter(l => l.flow_id === Number(flow_id));
    if (tipo)        logs = logs.filter(l => l.tipo === tipo);
    if (config_nome) { const q = config_nome.toLowerCase(); logs = logs.filter(l => (l.config_nome || '').toLowerCase().includes(q)); }
    if (data_inicio) logs = logs.filter(l => l.data >= data_inicio);
    if (data_fim)    logs = logs.filter(l => l.data <= data_fim + 'T23:59:59');

    const total  = logs.length;
    const offset = (Number(page) - 1) * Number(limit);
    return { logs: logs.slice(offset, offset + Number(limit)), total, page: Number(page), limit: Number(limit) };
  },

  getLogStats(empresaId) {
    const logs = load(empresaId).se_api_logs || [];
    const total   = logs.length;
    const sucesso = logs.filter(l => l.status === 'sucesso').length;
    const erro    = logs.filter(l => l.status === 'erro').length;
    const durMs   = logs.filter(l => l.duracao_ms).map(l => l.duracao_ms);
    const mediaMs = durMs.length ? Math.round(durMs.reduce((a, b) => a + b, 0) / durMs.length) : 0;
    return { total, sucesso, erro, media_ms: mediaMs };
  },
};
