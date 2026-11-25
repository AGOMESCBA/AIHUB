// Controle do serviço Windows IAHub-Jobs pela tela Jobs (aba Serviço), no mesmo
// modelo do WhatsApp (apps/IA Command/modules/whatsapp/windows-service):
// status pelo sc.exe; instalar/remover pelo NSSM; iniciar/parar pelo sc.exe.
// Funciona porque o site roda como serviço do Windows (conta Sistema). Tudo
// assíncrono: o site nunca trava esperando o Windows.
//
// A instalação faz o mesmo que deploy/6-instalar-servico-jobs.ps1.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const NOME = 'IAHub-Jobs';
const RAIZ = path.join(__dirname, '..', '..');
const ESTADOS = { 1: 'parado', 2: 'iniciando', 3: 'parando', 4: 'rodando', 5: 'continuando', 6: 'pausando', 7: 'pausado' };

function _rodar(exe, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      const saida = `${stdout || ''}${stderr || ''}`.trim();
      resolve({ ok: !err, codigo: err ? (err.code ?? null) : 0, saida: saida || err?.message || '' });
    });
  });
}

function _erro(status, mensagem) {
  return Object.assign(new Error(mensagem), { status });
}

/** Mensagem clara para os erros comuns do Windows. */
function _traduzir(r, acao) {
  if (/\b5\b|acesso negado|access is denied/i.test(r.saida)) {
    return `Sem permissão para ${acao}: o site precisa rodar como serviço do Windows (conta Sistema) ou como Administrador.`;
  }
  if (/1056|already running|já está em execução/i.test(r.saida)) return 'O serviço já está em execução.';
  if (/1062|has not been started|não foi iniciado/i.test(r.saida)) return 'O serviço já está parado.';
  return `Não foi possível ${acao}: ${r.saida.split('\n').filter(Boolean).slice(-2).join(' ')}`;
}

// Muda raramente: guardado por 1 min (cada consulta abre um processo).
let _nssmCache = { valor: null, em: 0 };
async function _nssmDisponivel() {
  if (_nssmCache.valor !== null && Date.now() - _nssmCache.em < 60000) return _nssmCache.valor;
  _nssmCache = { valor: (await _rodar('where', ['nssm'], { timeout: 10000 })).ok, em: Date.now() };
  return _nssmCache.valor;
}

/** Só o estado (um sc.exe): usado na espera entre ações. */
async function _estado() {
  const q = await _rodar('sc.exe', ['query', NOME], { timeout: 15000 });
  if (!q.ok) return q.codigo === 1060 || /1060/.test(q.saida) ? 'nao_instalado' : 'erro';
  const m = q.saida.match(/(?:STATE|ESTADO)[^:]*:\s+(\d+)/i);
  return (m && ESTADOS[Number(m[1])]) || 'desconhecido';
}

async function status() {
  if (process.platform !== 'win32') return { suportado: false, instalado: false, estado: 'nao_suportado', nome: NOME };
  const q = await _rodar('sc.exe', ['query', NOME], { timeout: 15000 });
  if (!q.ok) {
    if (q.codigo === 1060 || /1060/.test(q.saida)) return { suportado: true, instalado: false, estado: 'nao_instalado', nome: NOME, nssm: await _nssmDisponivel() };
    return { suportado: true, instalado: false, estado: 'erro', detalhe: q.saida, nome: NOME };
  }
  const m = q.saida.match(/(?:STATE|ESTADO)[^:]*:\s+(\d+)/i);
  const estado = (m && ESTADOS[Number(m[1])]) || 'desconhecido';
  const pidM = (await _rodar('sc.exe', ['queryex', NOME], { timeout: 15000 })).saida.match(/PID\s*:\s*(\d+)/i);
  const qc = await _rodar('sc.exe', ['qc', NOME], { timeout: 15000 });
  const tipo = (qc.saida.match(/START_TYPE\s*:\s*\d+\s+(\w+)/i) || [])[1] || '';
  const inicializacao = /AUTO/i.test(tipo) ? 'automatica' : /DEMAND/i.test(tipo) ? 'manual' : /DISABLED/i.test(tipo) ? 'desativada' : tipo.toLowerCase();
  return { suportado: true, instalado: true, estado, inicializacao, pid: pidM && Number(pidM[1]) ? Number(pidM[1]) : null, nome: NOME, nssm: await _nssmDisponivel() };
}

async function _esperar(estadoAlvo, segundos) {
  const ate = Date.now() + segundos * 1000;
  while (Date.now() < ate) {
    if (await _estado() === estadoAlvo) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  return status();
}

async function instalar() {
  if (process.platform !== 'win32') throw _erro(400, 'O serviço de jobs só pode ser instalado no Windows.');
  if (!await _nssmDisponivel()) throw _erro(400, 'NSSM não encontrado no servidor. Rode deploy\\1-instalar-dependencias.ps1 ou instale o NSSM e adicione ao PATH.');
  if (!fs.existsSync(path.join(RAIZ, 'jobs-servico.js'))) throw _erro(400, 'jobs-servico.js não encontrado na pasta do IAHub. Atualize os fontes antes.');
  const atual = await status();
  if (atual.instalado) throw _erro(409, 'O serviço já está instalado.');
  const logs = path.join(RAIZ, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const passos = [
    ['install', NOME, process.execPath],
    ['set', NOME, 'AppParameters', 'jobs-servico.js'],
    ['set', NOME, 'AppDirectory', RAIZ],
    ['set', NOME, 'AppStdout', path.join(logs, 'jobs-output.log')],
    ['set', NOME, 'AppStderr', path.join(logs, 'jobs-error.log')],
    ['set', NOME, 'AppRotateFiles', '1'],
    ['set', NOME, 'AppRotateOnline', '1'],
    ['set', NOME, 'AppRotateBytes', '10485760'],
    ['set', NOME, 'Start', 'SERVICE_AUTO_START'],
    ['set', NOME, 'DisplayName', 'IAHub - Jobs'],
    ['set', NOME, 'Description', 'Agendadores do IAHub (Jaade no Primeiro Atendimento e futuros jobs), fora do site'],
    ['set', NOME, 'AppExit', 'Default', 'Restart'],
    ['set', NOME, 'AppRestartDelay', '5000'],
    ['set', NOME, 'AppThrottle', '10000'],
    ['set', NOME, 'AppStopMethodConsole', '60000'],
    ['set', NOME, 'AppStopMethodWindow', '5000'],
    ['set', NOME, 'AppStopMethodThreads', '5000'],
    ['set', NOME, 'AppKillProcessTree', '1'],
    ['set', NOME, 'AppEnvironmentExtra', 'NODE_OPTIONS=--use-system-ca'],
  ];
  for (const args of passos) {
    const r = await _rodar('nssm', args);
    if (!r.ok) {
      // Instalou pela metade: remove para não deixar serviço quebrado.
      if (args[0] !== 'install') await _rodar('nssm', ['remove', NOME, 'confirm']);
      throw _erro(500, _traduzir(r, `instalar (nssm ${args[0]} ${args[2] || ''})`));
    }
  }
  return status();
}

async function iniciar() {
  const s = await status();
  if (!s.instalado) throw _erro(409, 'O serviço não está instalado.');
  if (s.estado === 'rodando') return s;
  const r = await _rodar('sc.exe', ['start', NOME]);
  if (!r.ok && !/1056/.test(r.saida)) throw _erro(500, _traduzir(r, 'iniciar o serviço'));
  return _esperar('rodando', 20);
}

/** Parada controlada: o serviço termina as execuções (até 45 s) e sai. */
async function parar() {
  const s = await status();
  if (!s.instalado) throw _erro(409, 'O serviço não está instalado.');
  if (s.estado === 'parado') return s;
  const r = await _rodar('sc.exe', ['stop', NOME]);
  if (!r.ok && !/1062/.test(r.saida)) throw _erro(500, _traduzir(r, 'parar o serviço'));
  return status();
}

async function desinstalar() {
  const s = await status();
  if (!s.instalado) throw _erro(409, 'O serviço não está instalado.');
  if (!await _nssmDisponivel()) throw _erro(400, 'NSSM não encontrado no servidor.');
  if (s.estado !== 'parado') {
    await _rodar('sc.exe', ['stop', NOME]);
    const parado = await _esperar('parado', 75);
    if (parado.estado !== 'parado') throw _erro(409, 'O serviço não parou a tempo; tente de novo em instantes.');
  }
  const r = await _rodar('nssm', ['remove', NOME, 'confirm']);
  if (!r.ok) throw _erro(500, _traduzir(r, 'desinstalar o serviço'));
  return _esperar('nao_instalado', 10);
}

module.exports = { NOME, status, instalar, iniciar, parar, desinstalar, _traduzir };
