const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const ARQUIVO   = path.join(DATA_DIR, 'seguranca.json');
const AUDIT_LOG = path.join(DATA_DIR, 'auditoria.log');

// Valores padrão — usados quando seguranca.json ainda não existe
const DEFAULTS = {
  sessao_timeout_horas:   8,
  login_max_tentativas:   5,
  login_bloqueio_min:     15,
  senha_nivel_minimo:     'medio',  // 'basico' | 'medio' | 'forte'
};

function getConfig() {
  try {
    if (!fs.existsSync(ARQUIVO)) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function salvarConfig(dados) {
  const atual = getConfig();
  const novo  = {
    ...atual,
    sessao_timeout_horas: Number(dados.sessao_timeout_horas) || DEFAULTS.sessao_timeout_horas,
    login_max_tentativas: Number(dados.login_max_tentativas) || DEFAULTS.login_max_tentativas,
    login_bloqueio_min:   Number(dados.login_bloqueio_min)   || DEFAULTS.login_bloqueio_min,
    senha_nivel_minimo:   ['basico', 'medio', 'forte'].includes(dados.senha_nivel_minimo)
                            ? dados.senha_nivel_minimo
                            : DEFAULTS.senha_nivel_minimo,
    atualizado_em: new Date().toISOString(),
  };
  fs.writeFileSync(ARQUIVO, JSON.stringify(novo, null, 2), 'utf8');
  return novo;
}

// ── Log de auditoria (leitura) ───────────────────────────────────────────────

function getAuditoria({ limite = 200, usuario = '', acao = '', data_ini = '', data_fim = '' } = {}) {
  if (!fs.existsSync(AUDIT_LOG)) return [];

  const linhas = fs.readFileSync(AUDIT_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .reverse(); // mais recentes primeiro

  return linhas
    .filter(e => {
      if (usuario && !e.usuario?.toLowerCase().includes(usuario.toLowerCase())) return false;
      if (acao    && !e.acao?.toLowerCase().includes(acao.toLowerCase()))        return false;
      if (data_ini && e.ts < data_ini) return false;
      if (data_fim && e.ts > data_fim + 'T23:59:59') return false;
      return true;
    })
    .slice(0, limite);
}

module.exports = { getConfig, salvarConfig, getAuditoria, DEFAULTS };
