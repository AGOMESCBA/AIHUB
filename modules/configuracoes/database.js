const fs   = require('fs');
const path = require('path');

const DATA_DIR     = path.join(__dirname, '..', '..', 'data');
const GLOBAL_FILE  = path.join(DATA_DIR, 'config-sistema.json');

const DEFAULTS = {
  groq_api_key:   '',
  gemini_api_key: '',
  gemini_model:   'gemini-1.5-flash',
  sistema_nome:   'IAHUB',
  sistema_frase:  'Onde a gestão encontra a inteligência',
  sistema_versao: 'v2.0',
  login_logo_default_url: '',
  login_background_default_url: '',
};

function _arquivoEmpresa(empresaId) {
  return path.join(DATA_DIR, `config-empresa-${empresaId}.json`);
}

function _readJson(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return {};
}

function _ler(empresaId) {
  const globalCfg = _readJson(GLOBAL_FILE);

  if (empresaId) {
    const empresaCfg = _readJson(_arquivoEmpresa(empresaId));
    return {
      ...DEFAULTS,
      ...globalCfg,
      ...empresaCfg,
      // Empty company values must not shadow global keys migrated from .env.
      groq_api_key: empresaCfg.groq_api_key || globalCfg.groq_api_key || '',
      gemini_api_key: empresaCfg.gemini_api_key || globalCfg.gemini_api_key || '',
      gemini_model: empresaCfg.gemini_model || globalCfg.gemini_model || DEFAULTS.gemini_model,
    };
  }

  return { ...DEFAULTS, ...globalCfg };
}

function _salvar(dados, empresaId) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const arq = empresaId ? _arquivoEmpresa(empresaId) : GLOBAL_FILE;
  fs.writeFileSync(arq, JSON.stringify(dados, null, 2), 'utf8');
}

function getConfig(empresaId) {
  return _ler(empresaId);
}

function getApiKey(nome, empresaId) {
  return _ler(empresaId)[nome] || '';
}

function salvarConfig(patch, empresaId) {
  const atual = _ler(empresaId);
  const novo  = { ...atual, ...patch };
  _salvar(novo, empresaId);
  return novo;
}

function inicializarConfig() {
  const cfg = _ler(null);
  let modificado = false;

  if (!cfg.groq_api_key && process.env.GROQ_API_KEY) {
    cfg.groq_api_key = process.env.GROQ_API_KEY;
    modificado = true;
  }
  if (!cfg.gemini_api_key && process.env.GEMINI_API_KEY) {
    cfg.gemini_api_key = process.env.GEMINI_API_KEY;
    modificado = true;
  }
  if (!cfg.gemini_model && process.env.GEMINI_MODEL) {
    cfg.gemini_model = process.env.GEMINI_MODEL;
    modificado = true;
  }

  if (modificado) {
    _salvar(cfg, null);
    console.log('   [config] Chaves de API migradas do .env -> data/config-sistema.json');
  }
}

function maskKey(key) {
  if (!key || key.length < 8) return '';
  return key.slice(0, 6) + '••••••••••••' + key.slice(-4);
}

module.exports = { getConfig, getApiKey, salvarConfig, inicializarConfig, maskKey };
