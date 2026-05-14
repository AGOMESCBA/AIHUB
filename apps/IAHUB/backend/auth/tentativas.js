// Controle em memória de tentativas de login falhas e bloqueio por IP.
// Lê MAX_TENTATIVAS e BLOQUEAR_MS dinamicamente de data/seguranca.json,
// com fallback para variáveis de ambiente e depois para os defaults.

const _mapa = new Map(); // ip → { count, bloqueado_ate }

function _cfg() {
  try {
    // Importação lazy para evitar dependência circular na inicialização
    return require('../seguranca/database').getConfig();
  } catch {
    return { login_max_tentativas: 5, login_bloqueio_min: 15 };
  }
}

function _agora() { return Date.now(); }

function estaBloqueado(ip) {
  const e = _mapa.get(ip);
  if (!e?.bloqueado_ate) return false;
  if (_agora() < e.bloqueado_ate) return true;
  _mapa.delete(ip);
  return false;
}

function registrarFalha(ip) {
  const cfg = _cfg();
  const max  = cfg.login_max_tentativas;
  const msBloquear = cfg.login_bloqueio_min * 60 * 1000;

  const e = _mapa.get(ip) || { count: 0, bloqueado_ate: null };
  e.count += 1;
  if (e.count >= max) e.bloqueado_ate = _agora() + msBloquear;
  _mapa.set(ip, e);
  return { count: e.count, bloqueado: !!e.bloqueado_ate };
}

function resetar(ip) {
  _mapa.delete(ip);
}

function minutosRestantes(ip) {
  const e = _mapa.get(ip);
  if (!e?.bloqueado_ate) return 0;
  return Math.max(1, Math.ceil((e.bloqueado_ate - _agora()) / 60000));
}

module.exports = { estaBloqueado, registrarFalha, resetar, minutosRestantes };
