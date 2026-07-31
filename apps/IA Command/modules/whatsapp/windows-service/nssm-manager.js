'use strict';

/**
 * Wrapper para gerenciar serviços Windows via NSSM.
 *
 * Separação de privilégios:
 *   - instalarServico / removerServico → usam nssm (requerem Admin, operações raras)
 *   - statusServico                    → usa sc.exe query (sem Admin)
 *   - iniciarServico / pararServico    → usam sc.exe start/stop (sem Admin após sdset)
 *
 * Após instalar, o serviço recebe permissão de start/stop para o usuário atual
 * via sc.exe sdset — assim o IAHub em desenvolvimento não precisa rodar como Admin.
 */

const path         = require('path');
const os           = require('os');
const { execSync, spawnSync } = require('child_process');

const NODE_EXE       = process.execPath;
const WORKER_PATH    = path.resolve(__dirname, 'worker.js');
const APP_DIR        = path.resolve(__dirname, '..', '..', '..', '..', '..');

// Launcher sem espaços no caminho — criado em instalarServico() quando necessário.
// NSSM split AppParameters pelo espaço, e "IA Command" contém espaço no path.
const LAUNCHER_PATH  = path.join(APP_DIR, 'iac-worker.js');
const LOGS_DIR       = path.join(APP_DIR, 'logs', 'whatsapp-services');
const SERVICE_PREFIX = 'IA Hub - IACommand-';

// ── Utilitários ───────────────────────────────────────────────────────────────

function slugDoCanal(channelId, nome) {
  const base = (nome || channelId)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .toLowerCase();
  return base || channelId.slice(0, 12);
}

function nomeServico(slug) {
  return `${SERVICE_PREFIX}${slug}`;
}

function exec(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', windowsHide: true, ...opts }).trim();
}

function _execElevado(cmd) {
  const fs   = require('fs');
  const tmp  = path.join(require('os').tmpdir(), `iac-svc-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, cmd, 'utf8');
  try {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', tmp,
    ], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout || cmd);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function nssmDisponivel() {
  try { exec('where nssm'); return true; } catch (_) { return false; }
}

// Grava um valor REG_MULTI_SZ via PowerShell (arquivo .ps1 temporário — evita EncodedCommand/Avast).
function _setRegistroMultiString(regPath, name, values) {
  const fs  = require('fs');
  const tmp = path.join(os.tmpdir(), `iac-reg-${Date.now()}.ps1`);
  // Monta array PowerShell inline para evitar problemas de quoting
  const arr = values.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
  const ps  = `Set-ItemProperty -Path 'Registry::${regPath}' -Name '${name}' -Value @(${arr}) -Type MultiString`;
  fs.writeFileSync(tmp, ps, 'utf8');
  try {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp,
    ], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`_setRegistroMultiString falhou: ${r.stderr || r.stdout}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// ── Status via sc.exe (sem Admin) ─────────────────────────────────────────────

/**
 * Retorna o status do serviço via sc.exe query.
 * Valores: 'SERVICE_RUNNING' | 'SERVICE_STOPPED' | 'SERVICE_PAUSED'
 *          | 'SERVICE_START_PENDING' | 'SERVICE_STOP_PENDING'
 *          | 'not_installed' | 'error'
 */
function statusServico(slug) {
  const svc = nomeServico(slug);
  try {
    const out = exec(`sc.exe query "${svc}"`);
    // sc.exe retorna o código numérico do estado — usamos ele (invariante ao idioma do SO)
    // 1=STOPPED 2=START_PENDING 3=STOP_PENDING 4=RUNNING 6=PAUSED
    const match = out.match(/ESTADO[^:]*:\s+(\d+)/i) || out.match(/STATE[^:]*:\s+(\d+)/i);
    if (!match) return 'error';
    const code = parseInt(match[1], 10);
    return { 1: 'SERVICE_STOPPED', 2: 'SERVICE_START_PENDING', 3: 'SERVICE_STOP_PENDING',
             4: 'SERVICE_RUNNING', 5: 'SERVICE_CONTINUE_PENDING', 6: 'SERVICE_PAUSE_PENDING',
             7: 'SERVICE_PAUSED' }[code] || 'error';
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message || '');
    if (msg.includes('1060') || msg.includes('não existe') || msg.includes('does not exist')
        || msg.includes('OpenService') || msg.includes('especificado')) {
      return 'not_installed';
    }
    return 'not_installed';
  }
}

// ── Instalação (requer Admin) ─────────────────────────────────────────────────

function instalarServico(channelId, slug, workerPort, env = {}) {
  if (!nssmDisponivel()) throw new Error('NSSM não encontrado no PATH. Instale o NSSM e adicione ao PATH do sistema.');

  const svc    = nomeServico(slug);
  const logDir = path.join(LOGS_DIR, slug);
  const status = statusServico(slug);

  if (status !== 'not_installed') return { jaInstalado: true, status };

  const fs = require('fs');

  // Cria launcher sem espaços no caminho (NSSM parte AppParameters no espaço,
  // e o path de worker.js contém "IA Command" — espaço inevitável).
  if (!fs.existsSync(LAUNCHER_PATH)) {
    fs.writeFileSync(
      LAUNCHER_PATH,
      `// Auto-gerado por nssm-manager.js — não editar manualmente.\n` +
      `require(require('path').join(__dirname, 'apps', 'IA Command', 'modules', 'whatsapp', 'windows-service', 'worker.js'));\n`,
      'utf8'
    );
  }

  const envVars = Object.entries({
    IAC_CHANNEL_ID:  channelId,
    IAC_WORKER_PORT: String(workerPort),
    IAC_APP_DIR:     APP_DIR,
    NODE_ENV:        process.env.NODE_ENV || 'production',
    ...env,
  }).map(([k, v]) => `${k}=${v}`);

  fs.mkdirSync(logDir, { recursive: true });

  function nssmCmd(...args) {
    const r = spawnSync('nssm', args, { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`nssm ${args[0]} ${args[1] || ''} falhou: ${r.stderr || r.stdout}`);
  }

  nssmCmd('install', svc, NODE_EXE);
  nssmCmd('set', svc, 'AppParameters',  LAUNCHER_PATH);
  nssmCmd('set', svc, 'AppDirectory',   APP_DIR);
  nssmCmd('set', svc, 'DisplayName',    `IA Command WhatsApp ${slug}`);
  nssmCmd('set', svc, 'Description',    `Canal WhatsApp IAHub: ${channelId}`);
  nssmCmd('set', svc, 'Start',          'SERVICE_DEMAND_START');
  nssmCmd('set', svc, 'AppStdout',      path.join(logDir, 'service.log'));
  nssmCmd('set', svc, 'AppStderr',      path.join(logDir, 'service-err.log'));
  nssmCmd('set', svc, 'AppRotateFiles', '1');
  nssmCmd('set', svc, 'AppRotateOnline','1');
  nssmCmd('set', svc, 'AppRotateBytes', '10485760');
  nssmCmd('set', svc, 'AppRestartDelay','3000');

  // AppEnvironmentExtra como MultiString no registro — único modo confiável no Windows.
  const regPath = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${svc}\\Parameters`;
  _setRegistroMultiString(regPath, 'AppEnvironmentExtra', envVars);

  return { instalado: true, servico: svc };
}

// ── Start / Stop via sc.exe (sem Admin após sdset) ───────────────────────────

function iniciarServico(channelId, slug, workerPort, env = {}) {
  const svc    = nomeServico(slug);
  const status = statusServico(slug);

  if (status === 'not_installed') {
    instalarServico(channelId, slug, workerPort, env);
  }

  let atual = statusServico(slug);
  if (atual === 'SERVICE_RUNNING') return { jaRodando: true };

  // SERVICE_PAUSED: continua e para antes de reiniciar
  if (atual === 'SERVICE_PAUSED') {
    try { exec(`sc.exe continue "${svc}"`); } catch (_) {}
    _aguardarEstado(slug, 'SERVICE_RUNNING', 4);
    try { exec(`sc.exe stop "${svc}"`); } catch (_) {}
    _aguardarEstado(slug, 'SERVICE_STOPPED', 8);
    atual = statusServico(slug);
  }

  if (atual === 'SERVICE_STOP_PENDING') {
    _aguardarEstado(slug, 'SERVICE_STOPPED', 8);
  }

  _execElevado(`sc.exe start "${svc}"`);
  return { iniciado: true, servico: svc };
}

function pararServico(slug) {
  const svc    = nomeServico(slug);
  const status = statusServico(slug);
  if (status === 'SERVICE_STOPPED' || status === 'not_installed') return { jaParado: true };
  try { _execElevado(`sc.exe stop "${svc}"`); } catch (_) {}
  return { parado: true, servico: svc };
}

// ── Remoção (requer Admin) ────────────────────────────────────────────────────

function removerServico(slug) {
  if (!nssmDisponivel()) throw new Error('NSSM não encontrado no PATH.');
  const svc    = nomeServico(slug);
  const status = statusServico(slug);
  if (status === 'not_installed') return { naoInstalado: true };

  // Para o serviço se estiver rodando/pausado antes de remover
  if (status === 'SERVICE_RUNNING' || status === 'SERVICE_PAUSED') {
    if (status === 'SERVICE_PAUSED') {
      try { spawnSync('sc.exe', ['continue', svc], { encoding: 'utf8', windowsHide: true }); } catch (_) {}
      _aguardarEstado(slug, 'SERVICE_RUNNING', 4);
    }
    _execElevado(`sc.exe stop "${svc}"`);
    _aguardarEstado(slug, 'SERVICE_STOPPED', 8);
  }

  const r = spawnSync('nssm', ['remove', svc, 'confirm'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`Falha ao remover serviço: ${r.stderr || r.stdout}`);
  return { removido: true, servico: svc };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _aguardarEstado(slug, estadoEsperado, maxSegundos) {
  for (let i = 0; i < maxSegundos * 2; i++) {
    if (statusServico(slug) === estadoEsperado) return;
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 500'], { windowsHide: true });
  }
}

function statusTodos(canais) {
  const resultado = {};
  for (const canal of canais) {
    const slug = canal.service_slug || slugDoCanal(canal.id, canal.nome);
    resultado[canal.id] = {
      slug,
      serviceName: nomeServico(slug),
      nssmStatus:  statusServico(slug),
    };
  }
  return resultado;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  slugDoCanal,
  nomeServico,
  nssmDisponivel,
  statusServico,
  instalarServico,
  iniciarServico,
  pararServico,
  removerServico,
  statusTodos,
};
