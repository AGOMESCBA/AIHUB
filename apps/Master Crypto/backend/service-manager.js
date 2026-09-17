const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const IAHUB_ROOT = path.join(__dirname, '..', '..', '..');
const backendDir = process.env.MASTER_CRYPTO_BACKEND_DIR || 'C:\\Apps\\mobile\\master_crypto\\backend';
const pythonExe = process.env.MASTER_CRYPTO_PYTHON || path.join(backendDir, '.venv', 'Scripts', 'python.exe');
const host = process.env.MASTER_CRYPTO_HOST || '127.0.0.1';
const port = Number(process.env.MASTER_CRYPTO_PORT || 8000);
const logFile = process.env.MASTER_CRYPTO_LOG_FILE || path.join(IAHUB_ROOT, 'logs', 'master-crypto-python.log');

let child = null;
let startedByIahub = false;
let lastStatus = {
  state: 'stopped',
  pid: null,
  url: `http://${host}:${port}`,
  backendDir,
  message: 'Nao iniciado',
  checkedAt: null,
};

function updateStatus(patch) {
  lastStatus = {
    ...lastStatus,
    ...patch,
    checkedAt: new Date().toISOString(),
  };
}

function appendLog(line) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch (_) {}
}

function healthCheck(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/health', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function start() {
  if (process.env.MASTER_CRYPTO_AUTOSTART === '0') {
    updateStatus({ state: 'disabled', message: 'Autostart desabilitado por MASTER_CRYPTO_AUTOSTART=0' });
    return lastStatus;
  }

  if (child && !child.killed) {
    updateStatus({ state: 'running', pid: child.pid, message: 'Motor Python ja iniciado pelo IAHUB' });
    return lastStatus;
  }

  if (await healthCheck()) {
    updateStatus({ state: 'running-external', pid: null, message: `Motor Python ja responde em ${host}:${port}` });
    return lastStatus;
  }

  if (!fs.existsSync(backendDir)) {
    updateStatus({ state: 'missing', message: `Diretorio do backend nao encontrado: ${backendDir}` });
    appendLog(lastStatus.message);
    return lastStatus;
  }

  if (!fs.existsSync(pythonExe)) {
    updateStatus({ state: 'missing', message: `Python do Master Crypto nao encontrado: ${pythonExe}` });
    appendLog(lastStatus.message);
    return lastStatus;
  }

  try {
    child = spawn(pythonExe, ['-m', 'uvicorn', 'app.main:app', '--host', host, '--port', String(port)], {
      cwd: backendDir,
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    startedByIahub = true;
    updateStatus({ state: 'starting', pid: child.pid, message: `Iniciando motor Python em ${host}:${port}` });
    appendLog(`START pid=${child.pid} cwd=${backendDir}`);

    child.stdout.on('data', (chunk) => appendLog(chunk.toString().trimEnd()));
    child.stderr.on('data', (chunk) => appendLog(chunk.toString().trimEnd()));
    child.on('exit', (code, signal) => {
      appendLog(`EXIT pid=${child?.pid || '-'} code=${code} signal=${signal || '-'}`);
      updateStatus({ state: 'stopped', pid: null, message: `Motor Python finalizado code=${code} signal=${signal || '-'}` });
      child = null;
      startedByIahub = false;
    });

    setTimeout(async () => {
      if (await healthCheck(1800)) {
        updateStatus({ state: 'running', pid: child?.pid || null, message: `Motor Python ativo em ${host}:${port}` });
      }
    }, 1500);
  } catch (err) {
    updateStatus({ state: 'error', pid: null, message: err.message });
    appendLog(`ERROR ${err.stack || err.message}`);
  }

  return lastStatus;
}

function stop() {
  if (!child || child.killed) return false;
  appendLog(`STOP pid=${child.pid}`);
  child.kill();
  return true;
}

function getStatus() {
  return {
    ...lastStatus,
    pid: child?.pid || lastStatus.pid,
    startedByIahub,
    logFile,
  };
}

function getInternalApiBaseUrl() {
  return `http://${host}:${port}/api/v1`;
}

function registerShutdownHook(signalName) {
  process.prependOnceListener(signalName, () => {
    stop();
  });
}

registerShutdownHook('SIGINT');
registerShutdownHook('SIGTERM');
process.once('exit', () => stop());

module.exports = {
  start,
  stop,
  getStatus,
  healthCheck,
  getInternalApiBaseUrl,
};
