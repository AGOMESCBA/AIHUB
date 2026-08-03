const fs = require('fs');
const path = require('path');
const db = require('./database');
const { APP_DATA_DIR, appDataDir } = require('../data-paths');
const empresasDb = require('../empresas/database');
const { empresaDataFile } = require('../../../IA Recruit/backend/data-paths');

const DATA_DIR = APP_DATA_DIR;
const SISTEMA_UPLOAD_DIR = appDataDir('uploads', 'sistema');

// --- IA Command SQLite helpers ---

const crypto = require('crypto');

let _iacDb = null;
function getIacDb() {
  if (_iacDb) return _iacDb;
  try {
    const { getDB } = require('../../../IA Command/modules/database/index');
    _iacDb = getDB();
  } catch (_) { _iacDb = null; }
  return _iacDb;
}

function countIacTabela(iacDb, tabela, empresaId, empresaIdComoTexto = false) {
  try {
    const valor = empresaIdComoTexto ? String(empresaId) : empresaId;
    return iacDb.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE empresa_id = ?`).get(valor)?.n ?? 0;
  } catch (_) { return 0; }
}

// Gera ID determinístico para a empresa destino a partir do ID original.
// Garante que origem e destino NUNCA compartilham o mesmo PK, evitando
// que INSERT OR REPLACE sobrescreva registros da empresa origem.
function remapId(oldId, destinoId) {
  if (!oldId) return oldId;
  const h = crypto.createHash('sha256').update(`iac_copy:${destinoId}:${oldId}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

// opts.autoincPk  = true  → tabela tem PK INTEGER AUTOINCREMENT, não remapeia id
// opts.camposRef  = ['campo'] → campos TEXT que referenciam IDs de outra tabela
//                               e devem ser remapeados com o mesmo remapId
// opts.empresaIdComoTexto = true → empresa_id é armazenado como TEXT nessa tabela
//                                  (ex.: chat_history) — grava String(destinoId) em vez de Number.
function migrarIacSimples(iacDb, tabela, origemId, destinoId, opts = {}) {
  const { autoincPk = false, camposRef = [], empresaIdComoTexto = false } = opts;
  const linhas = iacDb.prepare(`SELECT * FROM ${tabela} WHERE empresa_id = ?`).all(origemId);
  iacDb.prepare(`DELETE FROM ${tabela} WHERE empresa_id = ?`).run(empresaIdComoTexto ? String(destinoId) : destinoId);
  if (!linhas.length) return;

  const allCols = Object.keys(linhas[0]);
  const cols    = autoincPk ? allCols.filter(c => c !== 'id') : allCols;
  const stmt    = iacDb.prepare(
    `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  );

  const tx = iacDb.transaction(() => {
    for (const row of linhas) {
      const r = { ...row };
      if (!autoincPk) r.id = remapId(row.id, destinoId);
      r.empresa_id = empresaIdComoTexto ? String(destinoId) : destinoId;
      for (const campo of camposRef) {
        if (r[campo]) r[campo] = remapId(r[campo], destinoId);
      }
      stmt.run(cols.map(c => r[c]));
    }
  });
  tx();
}

// Migra tabela cuja PK é a própria empresa_id (1 linha por empresa, sem remapeamento de id).
function migrarIacPorEmpresa(iacDb, tabela, origemId, destinoId) {
  const linha = iacDb.prepare(`SELECT * FROM ${tabela} WHERE empresa_id = ?`).get(origemId);
  iacDb.prepare(`DELETE FROM ${tabela} WHERE empresa_id = ?`).run(destinoId);
  if (!linha) return;

  const cols = Object.keys(linha);
  const stmt = iacDb.prepare(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  const r = { ...linha, empresa_id: destinoId };
  stmt.run(cols.map(c => r[c]));
}

// Migra scheduled_question_jobs + recipients/runs dependentes (FK job_id).
function migrarScheduledQuestions(iacDb, origemId, destinoId) {
  const jobs = iacDb.prepare('SELECT * FROM scheduled_question_jobs WHERE empresa_id = ?').all(origemId);
  const jobIdMap = {};
  for (const j of jobs) jobIdMap[j.id] = remapId(j.id, destinoId);

  const oldJobIds = jobs.map(j => j.id);
  const ph = oldJobIds.length ? oldJobIds.map(() => '?').join(', ') : "'__noop__'";
  const recipients = iacDb.prepare(`SELECT * FROM scheduled_question_recipients WHERE job_id IN (${ph})`).all(...oldJobIds);
  const runs        = iacDb.prepare(`SELECT * FROM scheduled_question_runs WHERE job_id IN (${ph})`).all(...oldJobIds);

  const tx = iacDb.transaction(() => {
    iacDb.prepare('DELETE FROM scheduled_question_runs WHERE empresa_id = ?').run(destinoId);
    iacDb.prepare('DELETE FROM scheduled_question_recipients WHERE empresa_id = ?').run(destinoId);
    iacDb.prepare('DELETE FROM scheduled_question_jobs WHERE empresa_id = ?').run(destinoId);

    if (jobs.length) {
      const cols = Object.keys(jobs[0]);
      const stmt = iacDb.prepare(`INSERT INTO scheduled_question_jobs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of jobs) {
        const r = { ...row, id: jobIdMap[row.id], empresa_id: destinoId };
        stmt.run(cols.map(c => r[c]));
      }
    }
    if (recipients.length) {
      const cols = Object.keys(recipients[0]);
      const stmt = iacDb.prepare(`INSERT INTO scheduled_question_recipients (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of recipients) {
        const r = { ...row, id: remapId(row.id, destinoId), job_id: jobIdMap[row.job_id] ?? row.job_id, empresa_id: destinoId };
        stmt.run(cols.map(c => r[c]));
      }
    }
    if (runs.length) {
      const cols = Object.keys(runs[0]);
      const stmt = iacDb.prepare(`INSERT INTO scheduled_question_runs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of runs) {
        const r = { ...row, id: remapId(row.id, destinoId), job_id: jobIdMap[row.job_id] ?? row.job_id, empresa_id: destinoId };
        stmt.run(cols.map(c => r[c]));
      }
    }
  });
  tx();
}

// Migra protheus_sx2 ou protheus_sx3 individualmente.
// PK é AUTOINCREMENT; connection_id precisa ser remapeado igual ao feito em migrarConexoes.
function migrarSxDict(iacDb, tabela, origemId, destinoId) {
  const conns = iacDb.prepare('SELECT id FROM connections WHERE empresa_id = ?').all(origemId);
  const connIdMap = {};
  for (const c of conns) connIdMap[c.id] = remapId(c.id, destinoId);

  // Valida que as conexões remapeadas já existem no destino (FK obrigatória).
  if (conns.length > 0) {
    const newIds = Object.values(connIdMap);
    const ph = newIds.map(() => '?').join(', ');
    const existentes = iacDb.prepare(`SELECT id FROM connections WHERE id IN (${ph})`).all(...newIds);
    if (existentes.length === 0) {
      throw new Error(
        `Dicionário SX depende das Conexões ERP. Marque também "Conexões ERP + config Protheus" e execute novamente.`
      );
    }
  }

  const linhas = iacDb.prepare(`SELECT * FROM ${tabela} WHERE empresa_id = ?`).all(origemId);
  iacDb.prepare(`DELETE FROM ${tabela} WHERE empresa_id = ?`).run(destinoId);
  if (!linhas.length) return;

  const cols = Object.keys(linhas[0]).filter(c => c !== 'id');
  const stmt = iacDb.prepare(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  const tx   = iacDb.transaction(() => {
    for (const row of linhas) {
      const r = { ...row };
      r.empresa_id   = destinoId;
      r.connection_id = connIdMap[row.connection_id] ?? row.connection_id;
      stmt.run(cols.map(c => r[c]));
    }
  });
  tx();
}

function migrarConexoes(iacDb, origemId, destinoId) {
  const conns    = iacDb.prepare('SELECT * FROM connections WHERE empresa_id = ?').all(origemId);
  const oldIds   = conns.map(c => c.id);
  const ph       = oldIds.length ? oldIds.map(() => '?').join(', ') : "'__noop__'";

  // Constrói mapa de remapeamento de IDs de conexão: oldId → newId
  const connIdMap = {};
  for (const c of conns) connIdMap[c.id] = remapId(c.id, destinoId);
  const newIds = Object.values(connIdMap);

  const phConfigs  = iacDb.prepare(`SELECT * FROM protheus_config WHERE connection_id IN (${ph})`).all(...oldIds);
  const erpConfigs = iacDb.prepare('SELECT * FROM erp_config WHERE empresa_id = ?').all(origemId);
  const sx2        = iacDb.prepare(`SELECT * FROM protheus_sx2 WHERE connection_id IN (${ph})`).all(...oldIds);
  const sx3        = iacDb.prepare(`SELECT * FROM protheus_sx3 WHERE connection_id IN (${ph})`).all(...oldIds);

  const tx = iacDb.transaction(() => {
    // Apaga destino (CASCADE em protheus_config, sx2, sx3)
    iacDb.prepare('DELETE FROM connections WHERE empresa_id = ?').run(destinoId);
    // Apaga também quaisquer conexões cujos novos IDs já existam (migração anterior)
    if (newIds.length) {
      const phNew = newIds.map(() => '?').join(', ');
      iacDb.prepare(`DELETE FROM connections WHERE id IN (${phNew})`).run(...newIds);
    }
    iacDb.prepare('DELETE FROM erp_config WHERE empresa_id = ?').run(destinoId);

    // Insere conexões com IDs remapeados
    if (conns.length) {
      const cols = Object.keys(conns[0]);
      const stmt = iacDb.prepare(`INSERT INTO connections (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of conns) {
        const r = { ...row };
        r.id = connIdMap[row.id];
        r.empresa_id = destinoId;
        stmt.run(cols.map(c => r[c]));
      }
    }

    // protheus_config — PK AUTOINCREMENT, remapeia apenas connection_id
    if (phConfigs.length) {
      const cols = Object.keys(phConfigs[0]).filter(c => c !== 'id');
      const stmt = iacDb.prepare(`INSERT INTO protheus_config (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of phConfigs) {
        const r = { ...row };
        r.connection_id = connIdMap[row.connection_id] ?? row.connection_id;
        stmt.run(cols.map(c => r[c]));
      }
    }

    // erp_config — id TEXT, empresa_id e connection_id remapeados
    if (erpConfigs.length) {
      const cols = Object.keys(erpConfigs[0]);
      const stmt = iacDb.prepare(`INSERT INTO erp_config (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of erpConfigs) {
        const r = { ...row };
        r.id = remapId(row.id, destinoId);
        r.empresa_id = destinoId;
        if (r.connection_id) r.connection_id = connIdMap[row.connection_id] ?? row.connection_id;
        stmt.run(cols.map(c => r[c]));
      }
    }

    // protheus_sx2 / sx3 — PK AUTOINCREMENT, remapeia connection_id e empresa_id
    for (const [tabela, linhas] of [['protheus_sx2', sx2], ['protheus_sx3', sx3]]) {
      if (!linhas.length) continue;
      const cols = Object.keys(linhas[0]).filter(c => c !== 'id');
      const stmt = iacDb.prepare(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const row of linhas) {
        const r = { ...row };
        r.empresa_id    = destinoId;
        r.connection_id = connIdMap[row.connection_id] ?? row.connection_id;
        stmt.run(cols.map(c => r[c]));
      }
    }
  });
  tx();
}

// Tabelas do IA Command disponíveis para migração
// opts.autoincPk = true  → PK é INTEGER AUTOINCREMENT (ai_config, audio_config, whatsapp_config)
// opts.camposRef = [...]  → campos TEXT que referenciam IDs de outras tabelas IAC e devem ser remapeados
const IAC_TABELAS = {
  // Configuração IA — PK AUTOINCREMENT, sem referências cruzadas
  iac_ai_config:    { sistema: 'iac', grupo: 'Configuração IA', label: 'Configuração de IA',       tabela: 'ai_config',    tipo: 'simples', default: true,  opts: { autoincPk: true } },
  iac_audio_config: { sistema: 'iac', grupo: 'Configuração IA', label: 'Configuração de áudio',    tabela: 'audio_config', tipo: 'simples', default: true,  opts: { autoincPk: true } },

  // IA / NLP — PK TEXT; intentions referencia intention_modules.id e datasets.id
  iac_intention_modules: { sistema: 'iac', grupo: 'IA / NLP', label: 'Módulos de intenção',        tabela: 'intention_modules',     tipo: 'simples', default: true, opts: {} },
  iac_datasets:          { sistema: 'iac', grupo: 'IA / NLP', label: 'Datasets',                   tabela: 'datasets',              tipo: 'simples', default: true, opts: {} },
  iac_intentions:        { sistema: 'iac', grupo: 'IA / NLP', label: 'Intenções',                  tabela: 'intentions',            tipo: 'simples', default: true, opts: { camposRef: ['modulo', 'dataset_id'] } },
  iac_synonyms:          { sistema: 'iac', grupo: 'IA / NLP', label: 'Sinônimos / equivalências',  tabela: 'synonyms',              tipo: 'simples', default: true, opts: {} },
  iac_conv_dialogs:      { sistema: 'iac', grupo: 'IA / NLP', label: 'Diálogos conversacionais',  tabela: 'conversational_dialogs', tipo: 'simples', default: true, opts: {} },

  // WhatsApp — config tem PK AUTOINCREMENT; demais têm PK TEXT
  iac_wa_config:    { sistema: 'iac', grupo: 'WhatsApp', label: 'Configuração WhatsApp', tabela: 'whatsapp_config',            tipo: 'simples', default: true,  opts: { autoincPk: true } },
  iac_wa_numeros:   { sistema: 'iac', grupo: 'WhatsApp', label: 'Números autorizados',   tabela: 'whatsapp_allowed_numbers',   tipo: 'simples', default: true,  opts: {} },
  iac_wa_templates: { sistema: 'iac', grupo: 'WhatsApp', label: 'Templates de mensagem', tabela: 'whatsapp_message_templates', tipo: 'simples', default: true,  opts: {} },
  iac_wa_canais:    { sistema: 'iac', grupo: 'WhatsApp', label: 'Canais — associações',  tabela: 'whatsapp_channel_companies', tipo: 'simples', default: false, opts: {} },
  // whatsapp_sessions: PK é a própria empresa_id (1 sessão por empresa) — sem remapeamento de id.
  iac_wa_sessions:  { sistema: 'iac', grupo: 'WhatsApp', label: 'Sessão WhatsApp (status/QR)', tabela: 'whatsapp_sessions', tipo: 'porempresa', default: true, opts: {} },

  // Conexão ERP — migração especial: cascateia protheus_config e erp_config
  iac_conexoes: { sistema: 'iac', grupo: 'Conexão ERP', label: 'Conexões ERP + config Protheus',              tabela: 'connections',  tipo: 'conexoes', default: true },
  // Dicionários Protheus — migrados individualmente; dependem de connections existir no destino
  iac_sx2: { sistema: 'iac', grupo: 'Conexão ERP', label: 'Dicionário SX2 — compartilhamento de tabelas', tabela: 'protheus_sx2', tipo: 'sx',      default: true,  opts: {} },
  iac_sx3: { sistema: 'iac', grupo: 'Conexão ERP', label: 'Dicionário SX3 — campos do Protheus',          tabela: 'protheus_sx3', tipo: 'sx',      default: false, opts: {} },

  // Agendamento — jobs + recipients/runs dependentes (FK job_id), migrados juntos em cascata.
  iac_scheduled_questions: { sistema: 'iac', grupo: 'Agendamento', label: 'Perguntas agendadas + destinatários + histórico de execuções', tabela: 'scheduled_question_jobs', tipo: 'scheduled', default: true },

  // Aprendizado de IA / NL-SQL — exemplos, políticas e configurações aprendidas pelo motor semântico
  iac_nlsql_examples: { sistema: 'iac', grupo: 'Aprendizado de IA', label: 'Exemplos semânticos (NL-SQL)',        tabela: 'nlsql_semantic_examples',   tipo: 'simples',   default: true, opts: {} },
  iac_nlsql_policies: { sistema: 'iac', grupo: 'Aprendizado de IA', label: 'Políticas semânticas',                tabela: 'nlsql_semantic_policies',   tipo: 'simples',   default: true, opts: {} },
  // nlsql_semantic_settings: PK é a própria empresa_id — sem remapeamento de id.
  iac_nlsql_settings: { sistema: 'iac', grupo: 'Aprendizado de IA', label: 'Configurações do motor semântico',    tabela: 'nlsql_semantic_settings',   tipo: 'porempresa', default: true, opts: {} },
  iac_nlsql_shadow:   { sistema: 'iac', grupo: 'Aprendizado de IA', label: 'Log de shadow-testing semântico',     tabela: 'nlsql_semantic_shadow_log', tipo: 'simples',   default: false, opts: {} },

  // Logs — desligado por padrão
  iac_exec_log:   { sistema: 'iac', grupo: 'Logs', label: 'Log de execuções',      tabela: 'execution_log',      tipo: 'simples', default: false, opts: {} },
  iac_interp_log: { sistema: 'iac', grupo: 'Logs', label: 'Log de interpretações', tabela: 'interpretation_log', tipo: 'simples', default: false, opts: {} },
  iac_unmatched:  { sistema: 'iac', grupo: 'Logs', label: 'Mensagens sem resposta', tabela: 'unmatched_messages', tipo: 'simples', default: false, opts: {} },
  iac_audit_log:  { sistema: 'iac', grupo: 'Logs', label: 'Log de auditoria',       tabela: 'audit_log',          tipo: 'simples', default: false, opts: {} },
  iac_chat_history: { sistema: 'iac', grupo: 'Logs', label: 'Histórico de conversas (chat)', tabela: 'chat_history', tipo: 'simples', default: false, opts: { autoincPk: true, empresaIdComoTexto: true } },

  // Propostas de correção de spec (revisão humana das sugestões da IA)
  iac_spec_feedback: { sistema: 'iac', grupo: 'IA / NLP', label: 'Propostas de correção de spec', tabela: 'spec_feedback_propostas', tipo: 'simples', default: true, opts: {} },
};

const MIGRACAO_TABELAS = {
  config:             { grupo: 'Configuracoes', label: 'WhatsApp Curriculo', campos: ['config'], defaults: { config: {} }, default: true },
  email_config:       { grupo: 'Configuracoes', label: 'E-mail por vaga', campos: ['email_config'], defaults: { email_config: {} }, default: true },
  email_geral_config: { grupo: 'Configuracoes', label: 'E-mail avulso', campos: ['email_geral_config'], defaults: { email_geral_config: {} }, default: true },
  email_templates:    { grupo: 'Configuracoes', label: 'Templates de e-mail', campos: ['email_templates'], defaults: { email_templates: {} }, default: true },
  analisador_config:  { grupo: 'Regras', label: 'Classificacao do analisador', campos: ['analisador_config'], defaults: { analisador_config: {} }, default: true },
  pesos_pontuacao:    { grupo: 'Regras', label: 'Pesos de pontuacao', campos: ['pesos_pontuacao'], defaults: { pesos_pontuacao: {} }, default: true },
  equivalencias:      { grupo: 'Regras', label: 'Equivalencias', campos: ['equivalencias'], defaults: { equivalencias: [] }, default: true },
  funcoes:            { grupo: 'Cadastros', label: 'Funcoes', campos: ['funcoes', 'nextFuncaoId'], defaults: { funcoes: [], nextFuncaoId: 1 } },
  vagas:              { grupo: 'Cadastros', label: 'Vagas', campos: ['vagas', 'nextVagaId'], defaults: { vagas: [], nextVagaId: 1 } },
  curriculos:         { grupo: 'Operacao', label: 'Curriculos', campos: ['curriculos', 'nextId', 'processedIds', 'pendingUpdates'], defaults: { curriculos: [], nextId: 1, processedIds: [], pendingUpdates: [] } },
  vaga_candidaturas:  { grupo: 'Operacao', label: 'Candidaturas do PS', campos: ['vaga_candidaturas', 'nextCandidaturaId', 'next_candidatura_id'], defaults: { vaga_candidaturas: [], nextCandidaturaId: 1, next_candidatura_id: 1 } },
  analises:           { grupo: 'Operacao', label: 'Historico de analises', campos: ['analises'], defaults: { analises: [] } },
  integracoes_se:     { grupo: 'Integracoes SE', label: 'SE Curriculos - historico', campos: ['integracoes_se'], defaults: { integracoes_se: [] } },
  se_config:          { grupo: 'Integracoes SE', label: 'SE Curriculos - configuracao', campos: ['se_config'], defaults: { se_config: {} }, default: true },
  se_funcao_config:   { grupo: 'Integracoes SE', label: 'SE Funcoes - configuracao', campos: ['se_funcao_config'], defaults: { se_funcao_config: {} }, default: true },
  se_vaga_config:     { grupo: 'Integracoes SE', label: 'SE Vagas - configuracao', campos: ['se_vaga_config'], defaults: { se_vaga_config: {} }, default: true },
  se_api_templates:   { grupo: 'SE API Configurador', label: 'Templates', campos: ['se_api_templates'], defaults: { se_api_templates: [] }, default: true },
  se_api_configs:     { grupo: 'SE API Configurador', label: 'Configuracoes de endpoint', campos: ['se_api_configs'], defaults: { se_api_configs: [] }, default: true },
  se_api_headers:     { grupo: 'SE API Configurador', label: 'Headers', campos: ['se_api_headers'], defaults: { se_api_headers: [] }, default: true },
  se_api_mappings:    { grupo: 'SE API Configurador', label: 'Mapeamentos', campos: ['se_api_mappings'], defaults: { se_api_mappings: [] }, default: true },
  se_api_flows:       { grupo: 'SE API Configurador', label: 'Fluxos', campos: ['se_api_flows'], defaults: { se_api_flows: [] }, default: true },
  se_api_flow_steps:  { grupo: 'SE API Configurador', label: 'Passos de fluxo', campos: ['se_api_flow_steps'], defaults: { se_api_flow_steps: [] }, default: true },
  se_api_logs:        { grupo: 'SE API Configurador', label: 'Logs', campos: ['se_api_logs', '_se_api_log_id'], defaults: { se_api_logs: [], _se_api_log_id: 1 } },
};

function readEmpresaData(empresaId) {
  const file = empresaDataFile(empresaId);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; }
}

function saveEmpresaData(empresaId, data) {
  fs.writeFileSync(empresaDataFile(empresaId), JSON.stringify(data, null, 2), 'utf8');
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function countCampo(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length ? 1 : 0;
  return value === undefined || value === null || value === '' ? 0 : 1;
}

function previewTabela(data, tabela) {
  const def = MIGRACAO_TABELAS[tabela];
  const principal = def.campos[0];
  return countCampo(data[principal]);
}

function normalizarEmpresa(value, destinoId, destinoNome) {
  if (Array.isArray(value)) {
    return value.map(item => normalizarEmpresa(item, destinoId, destinoNome));
  }
  if (!value || typeof value !== 'object') return value;

  const next = { ...value };
  if (Object.prototype.hasOwnProperty.call(next, 'empresa_id')) next.empresa_id = Number(destinoId);
  if (Object.prototype.hasOwnProperty.call(next, 'empresa_nome')) next.empresa_nome = destinoNome || null;
  return next;
}

// O frontend chama /executar uma vez por tabela marcada (para mostrar progresso item a item),
// mas todas as chamadas de uma mesma migração compartilham o mesmo lote_id. Por isso o backup
// só é criado na primeira chamada de cada lote — as demais reaproveitam o arquivo já gerado,
// evitando 1 backup por tabela quando o usuário só fez "uma migração" do ponto de vista dele.
const _lotesComBackupIahub = new Set();
const _lotesComBackupIac   = new Set();

// Evita crescimento indefinido em memória — cada lote é só algumas strings,
// mas o processo roda dias/semanas sem reiniciar.
function _limitarSetDeLotes(set, limite = 1000) {
  if (set.size <= limite) return;
  const excedente = set.size - limite;
  const it = set.values();
  for (let i = 0; i < excedente; i++) set.delete(it.next().value);
}

function criarBackupDestino(destinoId, loteId) {
  if (loteId && _lotesComBackupIahub.has(loteId)) return null;

  const file = empresaDataFile(destinoId);
  if (!fs.existsSync(file)) {
    if (loteId) _lotesComBackupIahub.add(loteId);
    return null;
  }

  const backupDir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `empresa_${destinoId}_antes_migracao_${stamp}.json`);
  fs.copyFileSync(file, backupFile);
  if (loteId) { _lotesComBackupIahub.add(loteId); _limitarSetDeLotes(_lotesComBackupIahub); }
  return backupFile;
}

// Backup do banco SQLite do IA Command antes de migrar tabelas iac_*.
// O banco é único e compartilhado por todas as empresas (não há arquivo por empresa),
// então o backup cobre o banco inteiro — usa iacDb.backup(), forma segura de copiar
// um banco em modo WAL sem risco de corrupção (ao contrário de fs.copyFileSync).
async function criarBackupIacDb(iacDb, destinoId, loteId) {
  if (loteId && _lotesComBackupIac.has(loteId)) return null;

  const dbPath = iacDb.name;
  if (!dbPath || !fs.existsSync(dbPath)) {
    if (loteId) _lotesComBackupIac.add(loteId);
    return null;
  }

  const backupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `ia-command_antes_migracao_empresa_${destinoId}_${stamp}.db`);
  await iacDb.backup(backupFile);
  if (loteId) { _lotesComBackupIac.add(loteId); _limitarSetDeLotes(_lotesComBackupIac); }
  return backupFile;
}

// Diretórios onde os backups de migração são gravados — usados pela tela de
// gerenciamento de backups (listar/apagar) em /api/config/migracao/backups.
function dirsBackupMigracao() {
  const dirs = [];

  // IAHub/IA Recruit — backup por empresa (empresa_{id}_antes_migracao_*.json)
  try {
    const arquivoQualquer = empresaDataFile(1);
    dirs.push({ origem: 'iahub', dir: path.join(path.dirname(arquivoQualquer), 'backups') });
  } catch (_) {}

  // IA Command — backup do banco inteiro (ia-command_antes_migracao_empresa_*.db)
  const iacDb = getIacDb();
  if (iacDb?.name) {
    dirs.push({ origem: 'iac', dir: path.join(path.dirname(iacDb.name), 'backups') });
  }

  return dirs;
}

function listarBackupsMigracao() {
  const resultado = [];
  for (const { origem, dir } of dirsBackupMigracao()) {
    if (!fs.existsSync(dir)) continue;
    for (const nome of fs.readdirSync(dir)) {
      const caminho = path.join(dir, nome);
      let stat;
      try { stat = fs.statSync(caminho); } catch (_) { continue; }
      if (!stat.isFile()) continue;
      resultado.push({
        origem,
        nome,
        tamanho: stat.size,
        criado_em: stat.mtime.toISOString(),
      });
    }
  }
  resultado.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  return resultado;
}

// Resolve o caminho físico de um backup validando origem + nome contra path traversal
// (o nome do arquivo vem da URL — nunca concatenar sem checar que o resultado
// continua dentro do diretório de backups esperado).
function resolverArquivoBackup(origem, nome) {
  const entrada = dirsBackupMigracao().find(d => d.origem === origem);
  if (!entrada) return null;
  if (!nome || nome.includes('..') || nome.includes('/') || nome.includes('\\')) return null;

  const caminho = path.join(entrada.dir, nome);
  const raiz = path.resolve(entrada.dir);
  if (!path.resolve(caminho).startsWith(raiz + path.sep)) return null;
  if (!fs.existsSync(caminho)) return null;
  return caminho;
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  return { mime, buffer };
}

function apagarArquivoPublico(url) {
  if (!url || !String(url).startsWith('/uploads/')) return;
  const rel = String(url).replace(/^\/uploads\//, '');
  const alvo = path.resolve(path.join(DATA_DIR, 'uploads', rel));
  const raiz = path.resolve(path.join(DATA_DIR, 'uploads'));
  if (!alvo.startsWith(raiz)) return;
  try { if (fs.existsSync(alvo)) fs.unlinkSync(alvo); } catch (_) {}
}

function _resolverEid(req) {
  const explicit = Number(req.body?.empresa_id || req.query?.empresa_id || 0);
  if (!explicit) return req.session.empresa_id;
  const { empresas: acesso, role } = req.session;
  const ok = role === 'admin' || acesso === 'all' ||
    (Array.isArray(acesso) && acesso.includes(explicit));
  return ok ? explicit : req.session.empresa_id;
}

module.exports = function registerRoutes(app, { requireAuth, requireAdmin, requireEmpresa }) {

  app.get('/api/config/publico', (req, res) => {
    const cfg = db.getConfig(null);
    // Cache de 5 minutos — configuração muda raramente; elimina latência na tela de login.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      sistema_frase:  cfg.sistema_frase || 'Onde a gestão encontra a inteligência',
      sistema_nome:   cfg.sistema_nome || 'IAHUB',
      sistema_versao: cfg.sistema_versao || 'v2.0',
      login_logo_default_url: cfg.login_logo_default_url || '',
      login_background_default_url: cfg.login_background_default_url || '',
    });
  });

  app.get('/api/config/sistema', requireAuth, requireAdmin, (req, res) => {
    const cfg = db.getConfig(null);
    res.json({
      sistema_frase:  cfg.sistema_frase || 'Onde a gestão encontra a inteligência',
      sistema_nome:   cfg.sistema_nome || 'IAHUB',
      sistema_versao: cfg.sistema_versao || 'v2.0',
      login_logo_default_url: cfg.login_logo_default_url || '',
      login_background_default_url: cfg.login_background_default_url || '',
    });
  });

  app.put('/api/config/sistema', requireAuth, requireAdmin, (req, res) => {
    const { sistema_nome, sistema_frase, sistema_versao } = req.body || {};
    const cfg = db.salvarConfig({
      sistema_frase:  String(sistema_frase || '').trim() || 'Onde a gestão encontra a inteligência',
      sistema_nome:   String(sistema_nome || '').trim() || 'IAHUB',
      sistema_versao: String(sistema_versao || '').trim() || 'v2.0',
    }, null);
    res.json({
      ok: true,
      sistema_nome:   cfg.sistema_nome,
      sistema_frase:  cfg.sistema_frase,
      sistema_versao: cfg.sistema_versao,
      login_logo_default_url: cfg.login_logo_default_url || '',
      login_background_default_url: cfg.login_background_default_url || '',
    });
  });

  app.post('/api/config/sistema/login-logo', requireAuth, requireAdmin, (req, res) => {
    const arquivo = parseDataUrl(req.body?.dataUrl);
    const extensoes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!arquivo || !extensoes[arquivo.mime]) {
      return res.status(400).json({ error: 'Envie uma imagem em PNG, JPG ou WEBP.' });
    }
    if (arquivo.buffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'Arquivo muito grande. Limite: 4 MB.' });
    }

    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_logo_default_url);
    fs.mkdirSync(SISTEMA_UPLOAD_DIR, { recursive: true });

    const nome = `login-logo-default-${Date.now()}.${extensoes[arquivo.mime]}`;
    fs.writeFileSync(path.join(SISTEMA_UPLOAD_DIR, nome), arquivo.buffer);
    const url = `/uploads/sistema/${nome}`;
    const cfg = db.salvarConfig({ login_logo_default_url: url }, null);
    res.json({ ok: true, url, login_logo_default_url: cfg.login_logo_default_url });
  });

  app.delete('/api/config/sistema/login-logo', requireAuth, requireAdmin, (req, res) => {
    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_logo_default_url);
    const cfg = db.salvarConfig({ login_logo_default_url: '' }, null);
    res.json({ ok: true, login_logo_default_url: cfg.login_logo_default_url || '' });
  });

  app.post('/api/config/sistema/login-background', requireAuth, requireAdmin, (req, res) => {
    const arquivo = parseDataUrl(req.body?.dataUrl);
    const extensoes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!arquivo || !extensoes[arquivo.mime]) {
      return res.status(400).json({ error: 'Envie uma imagem em PNG, JPG ou WEBP.' });
    }
    if (arquivo.buffer.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Arquivo muito grande. Limite: 6 MB.' });
    }

    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_background_default_url);
    fs.mkdirSync(SISTEMA_UPLOAD_DIR, { recursive: true });

    const nome = `login-background-default-${Date.now()}.${extensoes[arquivo.mime]}`;
    fs.writeFileSync(path.join(SISTEMA_UPLOAD_DIR, nome), arquivo.buffer);
    const url = `/uploads/sistema/${nome}`;
    const cfg = db.salvarConfig({ login_background_default_url: url }, null);
    res.json({ ok: true, url, login_background_default_url: cfg.login_background_default_url });
  });

  app.delete('/api/config/sistema/login-background', requireAuth, requireAdmin, (req, res) => {
    const atual = db.getConfig(null);
    apagarArquivoPublico(atual.login_background_default_url);
    const cfg = db.salvarConfig({ login_background_default_url: '' }, null);
    res.json({ ok: true, login_background_default_url: cfg.login_background_default_url || '' });
  });

  app.get('/api/config/apikeys', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = _resolverEid(req);
    const cfg = db.getConfig(empresaId);
    res.json({
      groq_api_key:       cfg.groq_api_key   ? db.maskKey(cfg.groq_api_key)   : '',
      gemini_api_key:     cfg.gemini_api_key ? db.maskKey(cfg.gemini_api_key) : '',
      gemini_model:       cfg.gemini_model || 'gemini-1.5-flash',
      groq_configurada:   !!cfg.groq_api_key,
      gemini_configurada: !!cfg.gemini_api_key,
    });
  });

  app.get('/api/config/apikeys/reveal', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = _resolverEid(req);
    const cfg = db.getConfig(empresaId);
    res.json({
      groq_api_key:   cfg.groq_api_key   || '',
      gemini_api_key: cfg.gemini_api_key || '',
    });
  });

  app.put('/api/config/apikeys', requireAuth, requireEmpresa, (req, res) => {
    const empresaId = _resolverEid(req);
    const { groq_api_key, gemini_api_key, gemini_model } = req.body || {};
    const patch = {};

    // Empty fields mean "keep current key". Only non-empty, non-masked values overwrite.
    if (groq_api_key !== undefined) {
      const val = String(groq_api_key).trim();
      if (val && !val.includes('•')) patch.groq_api_key = val;
    }
    if (gemini_api_key !== undefined) {
      const val = String(gemini_api_key).trim();
      if (val && !val.includes('•')) patch.gemini_api_key = val;
    }
    if (gemini_model !== undefined)
      patch.gemini_model = (gemini_model || 'gemini-1.5-flash').trim();

    const cfg = db.salvarConfig(patch, empresaId);
    res.json({
      ok: true,
      groq_configurada:   !!cfg.groq_api_key,
      gemini_configurada: !!cfg.gemini_api_key,
    });
  });

  app.get('/api/config/migracao/meta', requireAuth, requireAdmin, (req, res) => {
    const empresas = empresasDb.listar().map(e => ({
      id: e.id,
      nome: e.razao_social || e.nome || `Empresa ${e.id}`,
    }));

    const tabelas = [
      ...Object.entries(MIGRACAO_TABELAS).map(([id, def]) => ({
        id,
        sistema: 'iahub',
        grupo: def.grupo,
        label: def.label,
        default: !!def.default,
      })),
      ...Object.entries(IAC_TABELAS).map(([id, def]) => ({
        id,
        sistema: 'iac',
        grupo: def.grupo,
        label: def.label,
        default: !!def.default,
      })),
    ];

    res.json({ empresas, tabelas });
  });

  app.get('/api/config/migracao/preview', requireAuth, requireAdmin, (req, res) => {
    const origemId = Number(req.query.origem_id || 0);
    const destinoId = Number(req.query.destino_id || 0);

    if (!origemId || !destinoId) {
      return res.status(400).json({ error: 'Informe empresa origem e destino.' });
    }
    if (origemId === destinoId) {
      return res.status(400).json({ error: 'Origem e destino devem ser empresas diferentes.' });
    }

    const origem = empresasDb.buscarPorId(origemId);
    const destino = empresasDb.buscarPorId(destinoId);
    if (!origem || !destino) return res.status(404).json({ error: 'Empresa origem ou destino nao encontrada.' });

    const origemData = readEmpresaData(origemId);
    const destinoData = readEmpresaData(destinoId);
    const iacDb = getIacDb();

    const tabelasIahub = Object.entries(MIGRACAO_TABELAS).map(([id, def]) => ({
      id,
      grupo: def.grupo,
      label: def.label,
      origem: previewTabela(origemData, id),
      destino: previewTabela(destinoData, id),
    }));

    const tabelasIac = Object.entries(IAC_TABELAS).map(([id, def]) => ({
      id,
      grupo: def.grupo,
      label: def.label,
      origem: iacDb ? countIacTabela(iacDb, def.tabela, origemId, def.opts?.empresaIdComoTexto) : null,
      destino: iacDb ? countIacTabela(iacDb, def.tabela, destinoId, def.opts?.empresaIdComoTexto) : null,
    }));

    res.json({
      origem: { id: origem.id, nome: origem.razao_social || origem.nome || `Empresa ${origem.id}` },
      destino: { id: destino.id, nome: destino.razao_social || destino.nome || `Empresa ${destino.id}` },
      tabelas: [...tabelasIahub, ...tabelasIac],
    });
  });

  app.post('/api/config/migracao/executar', requireAuth, requireAdmin, async (req, res) => {
    const origemId = Number(req.body?.origem_id || 0);
    const destinoId = Number(req.body?.destino_id || 0);
    const tabelas = Array.isArray(req.body?.tabelas) ? req.body.tabelas : [];
    const confirmar = String(req.body?.confirmar || '').toUpperCase().trim();
    const loteId = req.body?.lote_id ? String(req.body.lote_id) : null;

    if (!origemId || !destinoId || !tabelas.length) {
      return res.status(400).json({ error: 'Informe origem, destino e ao menos uma tabela.' });
    }
    if (origemId === destinoId) {
      return res.status(400).json({ error: 'Origem e destino devem ser empresas diferentes.' });
    }
    if (confirmar !== 'MIGRAR') {
      return res.status(400).json({ error: 'Digite MIGRAR para confirmar a operacao.' });
    }

    const origem = empresasDb.buscarPorId(origemId);
    const destino = empresasDb.buscarPorId(destinoId);
    if (!origem || !destino) return res.status(404).json({ error: 'Empresa origem ou destino nao encontrada.' });

    const invalidas = tabelas.filter(t => !MIGRACAO_TABELAS[t] && !IAC_TABELAS[t]);
    if (invalidas.length) {
      return res.status(400).json({ error: `Tabela invalida: ${invalidas.join(', ')}` });
    }

    const tabelasIahub = tabelas.filter(t => MIGRACAO_TABELAS[t]);
    const tabelasIac   = tabelas.filter(t => IAC_TABELAS[t]);

    const migradas = [];

    try {
      // --- migrar IAHub (JSON) ---
      if (tabelasIahub.length) {
        const origemData = readEmpresaData(origemId);
        const destinoData = readEmpresaData(destinoId);
        const destinoNome = destino.razao_social || destino.nome || `Empresa ${destino.id}`;
        criarBackupDestino(destinoId, loteId);

        for (const tabela of tabelasIahub) {
          const def = MIGRACAO_TABELAS[tabela];
          for (const campo of def.campos) {
            const valor = Object.prototype.hasOwnProperty.call(origemData, campo)
              ? clone(origemData[campo])
              : clone(def.defaults[campo]);
            destinoData[campo] = normalizarEmpresa(valor, destinoId, destinoNome);
          }
          migradas.push({ id: tabela, label: def.label, sistema: 'iahub' });
        }
        saveEmpresaData(destinoId, destinoData);
      }

      // --- migrar IA Command (SQLite) ---
      if (tabelasIac.length) {
        const iacDb = getIacDb();
        if (!iacDb) {
          return res.status(503).json({ error: 'IA Command nao disponivel. Verifique se o modulo esta ativo.' });
        }
        await criarBackupIacDb(iacDb, destinoId, loteId);
        for (const tabela of tabelasIac) {
          const def = IAC_TABELAS[tabela];
          if (def.tipo === 'conexoes') {
            migrarConexoes(iacDb, origemId, destinoId);
          } else if (def.tipo === 'sx') {
            migrarSxDict(iacDb, def.tabela, origemId, destinoId);
          } else if (def.tipo === 'porempresa') {
            migrarIacPorEmpresa(iacDb, def.tabela, origemId, destinoId);
          } else if (def.tipo === 'scheduled') {
            migrarScheduledQuestions(iacDb, origemId, destinoId);
          } else {
            migrarIacSimples(iacDb, def.tabela, origemId, destinoId, def.opts || {});
          }
          migradas.push({ id: tabela, label: def.label, sistema: 'iac' });
        }
      }
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Erro interno ao migrar dados.' });
    }

    res.json({ ok: true, migradas });
  });

  app.get('/api/config/migracao/backups', requireAuth, requireAdmin, (req, res) => {
    res.json({ backups: listarBackupsMigracao() });
  });

  app.delete('/api/config/migracao/backups/:origem/:nome', requireAuth, requireAdmin, (req, res) => {
    const { origem, nome } = req.params;
    const caminho = resolverArquivoBackup(origem, decodeURIComponent(nome));
    if (!caminho) return res.status(404).json({ error: 'Backup nao encontrado.' });

    try {
      fs.unlinkSync(caminho);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erro ao apagar backup.' });
    }
  });

};
