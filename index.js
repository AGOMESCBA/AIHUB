require('dotenv').config();
const express          = require('express');
const http             = require('http');
const { Server }       = require('socket.io');
const session          = require('express-session');
const helmet           = require('helmet');
const rateLimit        = require('express-rate-limit');
const path             = require('path');
const fs               = require('fs');
const util             = require('util');
const FileSessionStore = require('./modules/auth/session-store');
const { requireAuth, requireAdmin } = require('./modules/auth');
const { inicializarAdmin }          = require('./modules/auth/database');
const { requireEmpresa }            = require('./modules/empresa-context');
const { inicializarConfig }         = require('./modules/configuracoes/database');
const sistemasDb                    = require('./modules/sistemas/database');
const { inicializarSistemas }       = sistemasDb;
const { requireSystemAccess }       = require('./modules/sistemas/access');
const permissoesDb                  = require('./modules/permissoes/database');
const { APPS, LEGACY_STATIC_DIRS }   = require('./apps/registry');
const iahubData                     = require('./apps/IAHUB/backend/data-paths');

const STARTUP_PROFILER_T0 = Date.now();
function startupProfilerMark(label) {
  const elapsed = Date.now() - STARTUP_PROFILER_T0;
  console.log(`[startup-profiler] +${elapsed}ms ${label}`);
}

let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) {}

// ── Proteção contra crashes por exceções não tratadas ─────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  try {
    const logDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'crash.log'),
      `[${new Date().toISOString()}] uncaughtException: ${err?.stack || err}\n`, 'utf8');
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  try {
    const logDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'crash.log'),
      `[${new Date().toISOString()}] unhandledRejection: ${reason?.stack || reason}\n`, 'utf8');
  } catch (_) {}
});

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Console do Servidor — intercepta console.* e emite via Socket.IO ──────────
const _consoleBuffer = [];
const _CONSOLE_BUFFER_MAX = 500;
const _PIPELINE_TRACE_FILE = path.join(__dirname, 'logs', 'iac-whatsapp-pipeline.log');

function _appendProcessTrace(evento, dados = {}) {
  try {
    const mem = process.memoryUsage();
    fs.mkdirSync(path.dirname(_PIPELINE_TRACE_FILE), { recursive: true });
    fs.appendFileSync(
      _PIPELINE_TRACE_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        evento,
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
        ...dados,
      }) + '\n',
      'utf8',
    );
  } catch (_) {}
}

process.on('exit', (code) => _appendProcessTrace('process_exit', { code }));
process.on('beforeExit', (code) => _appendProcessTrace('process_before_exit', { code }));
process.on('SIGTERM', () => {
  _appendProcessTrace('process_sigterm');
  process.exit(143);
});
process.on('SIGINT', () => {
  _appendProcessTrace('process_sigint');
  process.exit(130);
});

function _consoleEmit(level, args) {
  try {
    const msg = args.map(_consoleArgToString).join(' ');
    const entry = { ts: new Date().toISOString(), level, msg };
    _consoleBuffer.push(entry);
    if (_consoleBuffer.length > _CONSOLE_BUFFER_MAX) _consoleBuffer.shift();
    try { io.to('iac-console').emit('iac-console', entry); } catch (_) {}
  } catch (err) {
    try {
      const fallback = { ts: new Date().toISOString(), level: 'error', msg: `[console-monitor] falha ao serializar log: ${err.message}` };
      _consoleBuffer.push(fallback);
      if (_consoleBuffer.length > _CONSOLE_BUFFER_MAX) _consoleBuffer.shift();
    } catch (_) {}
  }
}

function _consoleArgToString(arg) {
  if (arg instanceof Error) return arg.stack || arg.message || String(arg);
  if (typeof arg === 'bigint') return `${arg.toString()}n`;
  if (typeof arg !== 'object' || arg === null) return String(arg);
  try {
    const vistos = new WeakSet();
    return JSON.stringify(arg, (_k, v) => {
      if (typeof v === 'bigint') return `${v.toString()}n`;
      if (typeof v === 'object' && v !== null) {
        if (vistos.has(v)) return '[Circular]';
        vistos.add(v);
      }
      return v;
    });
  } catch (_) {
    return util.inspect(arg, { depth: 3, breakLength: 120, maxArrayLength: 80 });
  }
}
['log', 'info', 'warn', 'error'].forEach(level => {
  const orig = console[level].bind(console);
  console[level] = (...args) => { orig(...args); _consoleEmit(level === 'log' ? 'info' : level, args); };
});
startupProfilerMark('console-monitor pronto');

// ── Segurança: headers HTTP ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // desativado para não bloquear scripts inline das páginas atuais
}));

// ── Segurança: rate limit global (500 req/min por IP) ────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,
  max:      500,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
}));

// ── Rate limit reforçado na rota de login ─────────────────────────────────────
app.use('/api/login', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max:      20,
  message: { error: 'Muitas tentativas de login. Tente novamente mais tarde.' },
}));

app.use(express.json({ limit: '50mb' }));
const sessionMiddleware = session({
  store:             new FileSessionStore(),
  secret:            process.env.SESSION_SECRET || 'iahub-secret',
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 dias — monitores precisam sobreviver a restart do browser
  },
});
app.use(sessionMiddleware);

// Compartilha a sessão Express com Socket.IO para saber qual empresa cada socket pertence
io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

inicializarAdmin().catch(err => console.error('[auth] Falha ao inicializar admin:', err));
startupProfilerMark('inicializarAdmin disparado');
inicializarConfig();
startupProfilerMark('inicializarConfig concluido');
inicializarSistemas();
startupProfilerMark('inicializarSistemas concluido');

const requireRecrutamento = requireSystemAccess('recrutamento');
const requireIaAdmin      = requireSystemAccess('ia-admin');
const requireIaCommand    = requireSystemAccess('ia-command');

// Versão gerada a cada startup — usada para cache-busting de HTML e JS
const APP_VERSION = Date.now();
app.get('/api/version', (_req, res) => res.json({ v: APP_VERSION }));

// HTML e JS sempre revalidados com o servidor (no-cache).
// Se o arquivo não mudou → 304 (rápido, sem tráfego).
// Se mudou (após deploy + restart) → 200 com conteúdo novo.
const _noCacheExts = /\.(html|js)$/i;
function _staticOpts() {
  return {
    etag: true,
    lastModified: true,
    setHeaders(res, fp) {
      if (_noCacheExts.test(fp)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  };
}

function mountStaticDirs(route, middleware, dirs) {
  const opts = _staticOpts();
  for (const dir of dirs) {
    app.use(route, middleware, express.static(dir, opts));
  }
}

const RECRUTAMENTO_PAGES = new Set([
  '/shell.html',
  '/dashboard.html',
  '/monitores.html',
  '/monitor.html',
  '/monitor-email.html',
  '/curriculos.html',
  '/curriculo.html',
  '/funcoes.html',
  '/vagas.html',
  '/processoseletivo.html',
  '/analisador.html',
  '/historico.html',
  '/config-analisador.html',
  '/se-integracoes.html',
  '/se-integracoes-config.html',
  '/se-curriculos.html',
  '/se-funcoes.html',
  '/se-vagas.html',
  '/se-api-configurador.html',
]);

app.use((req, res, next) => {
  if (!RECRUTAMENTO_PAGES.has(req.path)) return next();
  requireRecrutamento(req, res, next);
});

const IA_ADMIN_PAGES = new Set([
  '/administracao.html',
]);

app.use((req, res, next) => {
  if (!IA_ADMIN_PAGES.has(req.path)) return next();
  requireIaAdmin(req, res, next);
});

// Páginas compartilhadas entre sistemas (IA Recruit + IA Command) — exigem apenas
// sessão autenticada, sem amarrar a um systemCode específico como requireSystemAccess faz.
function requireAuthenticatedPage(req, res, next) {
  if (req.session?.authenticated) return next();
  res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl || '/')}`);
}

// Migrar Dados copia dados inteiros entre empresas — restrito a administradores,
// igual às rotas /api/config/migracao/* que ela consome (requireAdmin no backend).
function requireAdminPage(req, res, next) {
  if (req.session?.authenticated && req.session?.role === 'admin') return next();
  if (!req.session?.authenticated) {
    return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl || '/')}`);
  }
  res.redirect('/iahub.html');
}

const SHARED_AUTH_PAGES = new Set([
  '/configuracoes.html',
]);

app.use((req, res, next) => {
  if (!SHARED_AUTH_PAGES.has(req.path)) return next();
  requireAuthenticatedPage(req, res, next);
});

const SHARED_ADMIN_PAGES = new Set([
  '/migrar-dados.html',
]);

app.use((req, res, next) => {
  if (!SHARED_ADMIN_PAGES.has(req.path)) return next();
  requireAdminPage(req, res, next);
});

app.get('/app/ia-recruit', requireRecrutamento, (req, res) => {
  res.redirect('/app/ia-recruit/shell.html');
});

app.get('/app/recrutamento', requireRecrutamento, (req, res) => {
  res.redirect('/app/ia-recruit/shell.html');
});

app.get('/app/ia-administracao', requireIaAdmin, (req, res) => {
  res.redirect('/app/ia-administracao/administracao.html');
});

app.get('/app/ia-command', requireIaCommand, (req, res) => {
  res.redirect('/app/ia-command/shell.html');
});

mountStaticDirs('/app/ia-recruit', requireRecrutamento, APPS.iaRecruit.legacyStaticDirs);
mountStaticDirs('/app/recrutamento', requireRecrutamento, APPS.iaRecruit.legacyStaticDirs);
mountStaticDirs('/app/ia-administracao', requireIaAdmin, APPS.iaAdministracao.legacyStaticDirs);
mountStaticDirs('/app/ia-command', requireIaCommand, APPS.iaCommand.staticDirs);

// ── Arquivos estáticos ────────────────────────────────────────────────────────
// Uploads têm timestamp no nome (imutáveis) — cache de 1 ano no browser.
app.use('/uploads', express.static(iahubData.appDataDir('uploads'), {
  etag: true,
  lastModified: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));
for (const dir of LEGACY_STATIC_DIRS) {
  app.use(express.static(dir, _staticOpts()));
}

// ── Log em arquivo ────────────────────────────────────────────────────────────
const LOG_DIR        = path.join(__dirname, 'logs');
const EMAIL_LOG_FILE = path.join(LOG_DIR, 'emailcurriculo_<empresa_id>.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

function migrarLogLegado(origemRelativa, destinoNome) {
  const origem = path.join(__dirname, origemRelativa);
  if (!fs.existsSync(origem)) return;

  let destino = path.join(LOG_DIR, destinoNome);
  if (fs.existsSync(destino)) {
    const ext = path.extname(destinoNome);
    const base = path.basename(destinoNome, ext);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    destino = path.join(LOG_DIR, `${base}_migrado_${stamp}${ext}`);
  }
  try { fs.renameSync(origem, destino); } catch (_) {}
}

migrarLogLegado('emailcurriculo.log', 'emailcurriculo.log');
migrarLogLegado(path.join('apps', 'IAHUB', 'data', 'auditoria.log'), 'auditoria.log');
migrarLogLegado(path.join('data', 'auditoria.log'), 'auditoria.log');
for (const file of fs.readdirSync(__dirname)) {
  if (/^whatscurriculo_\d+\.log$/i.test(file)) migrarLogLegado(file, file);
}
try {
  const legadoWa = path.join(__dirname, 'whatscurriculo.log');
  if (fs.existsSync(legadoWa)) fs.unlinkSync(legadoWa);
} catch (_) {}

function registrarLog(entry, empresaId) {
  const arquivo = empresaId
    ? path.join(LOG_DIR, `whatscurriculo_${empresaId}.log`)
    : path.join(LOG_DIR, 'system.log');
  const linha = `[${entry.timestamp}] [${(entry.type || 'info').toUpperCase().padEnd(8)}] ${entry.message}\n`;
  try { fs.appendFileSync(arquivo, linha, 'utf8'); } catch (_) {}
}

// ── Socket.IO — replay do buffer ao reconectar ────────────────────────────────
const waManager    = require('./modules/whatsapp-curriculo/service-manager');
const emailSvcMgr  = require('./modules/processo-seletivo/email-service-manager');
const iacWaManager = require('./apps/IA Command/modules/whatsapp/service-manager');
// Email log file is set per-instance when service starts

function sessaoPodeReceberIaCommand(sess, empresaId) {
  return !!(
    sess?.authenticated &&
    sess.system_code === 'ia-command' &&
    empresaId &&
    sistemasDb.hasUserSystem(sess.user_id, Number(empresaId), 'ia-command')
  );
}

function emitirReplayIaCommand(socket, empresaId) {
  if (!sessaoPodeReceberIaCommand(socket.request.session, empresaId)) return;

  const svc = iacWaManager.get(empresaId);
  if (svc) {
    svc.getLogBuffer().forEach(entry => socket.emit('iac-log', entry));
    socket.emit('iac-status', { status: svc.getStatus(), empresa_id: empresaId });
    const qr = svc.getQr();
    if (qr) socket.emit('iac-qr', qr);
  } else {
    socket.emit('iac-status', { status: 'stopped', empresa_id: empresaId });
  }
}

io.on('connection', (socket) => {
  const eid = socket.request.session?.empresa_id;

  if (eid) {
    // Entra na sala desta empresa para receber apenas os eventos dela
    socket.join(`emp_${eid}`);

    // Replay do log e status da empresa específica
    const svc = waManager.get(eid);
    if (svc) {
      svc.getLogBuffer().forEach(entry => socket.emit('log', entry));
      socket.emit('status', {
        status:       svc.getStatus(),
        empresa_id:   svc.getEmpresaId(),
        empresa_nome: svc.getEmpresaNome(),
      });
      const qr = svc.getQr();
      if (qr) socket.emit('qr', qr);
    } else {
      socket.emit('status', { status: 'stopped', empresa_id: null, empresa_nome: null });
    }
  }

  const emailSvc = eid ? emailSvcMgr.get(eid) : null;
  if (emailSvc) {
    emailSvc.getLogBuffer().forEach(entry => socket.emit('email-log', entry));
    socket.emit('email-status', emailSvc.getStatus());
  } else {
    socket.emit('email-status', 'stopped');
  }

  // IA Command — replay apenas quando o sistema selecionado for o IA Command.
  if (eid) emitirReplayIaCommand(socket, eid);

  // Permite monitorar uma empresa específica (ex.: ?empresa=2) independente da sessão ativa
  socket.on('join-empresa-monitor', ({ empresaId } = {}) => {
    if (!empresaId) return;
    // Usa a sessão já carregada na conexão (síncrono, sem risco de callback falhar)
    const sess = socket.request.session;
    const { empresas: acesso, role } = sess;
    const temAcesso = role === 'admin' || acesso === 'all' ||
      (Array.isArray(acesso) && acesso.includes(Number(empresaId)));
    if (!temAcesso) return;

    [...socket.rooms].filter(r => r !== socket.id && r.startsWith('emp_')).forEach(r => socket.leave(r));
    socket.join(`emp_${empresaId}`);

    // Limpa os logs/status errados que foram enviados na conexão inicial (empresa da sessão)
    socket.emit('clear-monitor');

    const svc = waManager.get(empresaId);
    if (svc) {
      svc.getLogBuffer().forEach(entry => socket.emit('log', entry));
      socket.emit('status', { status: svc.getStatus(), empresa_id: svc.getEmpresaId(), empresa_nome: svc.getEmpresaNome() });
      const qr = svc.getQr();
      if (qr) socket.emit('qr', qr);
    } else {
      socket.emit('status', { status: 'stopped', empresa_id: null, empresa_nome: null });
    }
    const emailSvc = emailSvcMgr.get(empresaId);
    if (emailSvc) {
      emailSvc.getLogBuffer().forEach(entry => socket.emit('email-log', entry));
      socket.emit('email-status', emailSvc.getStatus());
    } else {
      socket.emit('email-status', 'stopped');
    }

    emitirReplayIaCommand(socket, empresaId);
  });

  // Console do Servidor — cliente solicita entrar na sala e recebe replay do buffer
  socket.on('join-iac-console', () => {
    const sess = socket.request.session;
    if (!sess?.authenticated) return;
    if (sess.role !== 'admin') {
      const empresaId = Number(sess.empresa_id || 0);
      const rotinas = empresaId ? permissoesDb.getRotinas(sess.user_id, empresaId) : [];
      if (!Array.isArray(rotinas) || !rotinas.includes('iac-console-servidor')) return;
    }
    socket.join('iac-console');
    _consoleBuffer.forEach(entry => socket.emit('iac-console', entry));
  });

  // Permite que o frontend force o ingresso na sala correta após auth assincrona
  socket.on('join-empresa', () => {
    socket.request.session.reload((err) => {
      if (err) return;
      const freshEid = socket.request.session?.empresa_id;
      if (!freshEid) return;
      // Sai de salas antigas de empresa e entra na correta
      [...socket.rooms].filter(r => r !== socket.id && r.startsWith('emp_')).forEach(r => socket.leave(r));
      socket.join(`emp_${freshEid}`);
      // Envia replay para este socket
      const svc = waManager.get(freshEid);
      if (svc) {
        svc.getLogBuffer().forEach(entry => socket.emit('log', entry));
        socket.emit('status', {
          status:       svc.getStatus(),
          empresa_id:   svc.getEmpresaId(),
          empresa_nome: svc.getEmpresaNome(),
        });
        const qr = svc.getQr();
        if (qr) socket.emit('qr', qr);
      } else {
        socket.emit('status', { status: 'stopped', empresa_id: null, empresa_nome: null });
      }
      const freshEmailSvc = emailSvcMgr.get(freshEid);
      if (freshEmailSvc) {
        freshEmailSvc.getLogBuffer().forEach(entry => socket.emit('email-log', entry));
        socket.emit('email-status', freshEmailSvc.getStatus());
      } else {
        socket.emit('email-status', 'stopped');
      }

      emitirReplayIaCommand(socket, freshEid);
    });
  });

  // Permite que o frontend entre na sala de um canal específico (para monitorar WS workers)
  socket.on('join-channel', (channelId) => {
    if (!channelId || typeof channelId !== 'string') return;
    socket.join(`channel_${channelId}`);
  });

  socket.on('leave-channel', (channelId) => {
    if (!channelId || typeof channelId !== 'string') return;
    socket.leave(`channel_${channelId}`);
  });
});

// ── Módulo Auth ───────────────────────────────────────────────────────────────
require('./modules/auth/routes')(app);

// ── Módulo Configurações ──────────────────────────────────────────────────────
require('./modules/configuracoes/routes')(app, { requireAuth, requireAdmin, requireEmpresa });

// ── Módulo IA — uso, custos estimados e saldo manual ───────────────────────────
require('./modules/ia/routes')(app, { requireAuth, requireEmpresa });

// ── Módulo Empresa Context (deve vir ANTES de /empresas para não ser sobreposto por /:id) ──
require('./modules/empresa-context/routes')(app, { requireAuth });

// ── Módulo Empresas ───────────────────────────────────────────────────────────
require('./modules/empresas/routes')(app, { requireAuth });

// ── Módulo Usuários ───────────────────────────────────────────────────────────
require('./modules/usuarios/routes')(app, { requireAuth });

// ── Módulo Permissões ─────────────────────────────────────────────────────────
require('./modules/permissoes/routes')(app, { requireAuth });

// ── Módulo Sistemas ───────────────────────────────────────────────────────────
require('./modules/sistemas/routes')(app, { requireAuth, requireAdmin });

// ── Módulo Segurança ──────────────────────────────────────────────────────────
require('./modules/seguranca/routes')(app, { requireAuth });

// ── IA Command ────────────────────────────────────────────────────────────────
startupProfilerMark('IA Command DB inicio');
require('./apps/IA Command/modules/database').inicializarDB();
startupProfilerMark('IA Command DB fim');
startupProfilerMark('IA Command rotas inicio');
require('./apps/IA Command/modules/routes')(app, { requireAuth, requireIaCommand, io });
startupProfilerMark('IA Command rotas fim');

[
  '/api/service',
  '/api/config',
  '/api/meta',
  '/api/curriculos',
  '/api/stats',
  '/api/ps',
  '/api/email-geral',
  '/api/email-service',
  '/api/funcoes',
  '/api/vagas',
  '/api/analisador',
  '/api/pesos-pontuacao',
  '/api/analises',
  '/api/equivalencias',
  '/api/integracoes/se',
  '/api/integracoes/se-funcao',
  '/api/integracoes/se-vaga',
  '/api/se-api',
].forEach(prefix => app.use(prefix, requireRecrutamento));

// ── Módulo Monitoramento (WhatsApp Currículo) ─────────────────────────────────
startupProfilerMark('rotas IA Recruit inicio');
require('./modules/whatsapp-curriculo/routes')(app, { requireAuth, requireEmpresa, registrarLog, io });

// ── Módulo Processo Seletivo ──────────────────────────────────────────────────
require('./modules/processo-seletivo/routes')(app, { requireAuth, requireEmpresa, registrarLog, io });

// ── Módulo Analisador de Currículos ───────────────────────────────────────────
require('./modules/analisador-curriculos/routes')(app, { requireAuth, requireEmpresa, registrarLog, io });

// ── Módulo Integrações › SE Currículo ─────────────────────────────────────────
require('./modules/integracoes/SECurriculo/routes')(app, { requireAuth, requireEmpresa, registrarLog });

// ── Módulo Integrações › SE Função ────────────────────────────────────────────
app.use(require('express').static(require('path').join(__dirname, 'modules', 'integracoes', 'SEFuncao', 'frontend')));
require('./modules/integracoes/SEFuncao/routes')(app, { requireAuth, requireEmpresa, registrarLog });

// ── Módulo Integrações › SE Vaga ──────────────────────────────────────────────
app.use(require('express').static(require('path').join(__dirname, 'modules', 'integracoes', 'SEVaga', 'frontend')));
require('./modules/integracoes/SEVaga/routes')(app, { requireAuth, requireEmpresa, registrarLog });

// ── Módulo Integrações › SE API Configurador ──────────────────────────────────
app.use(require('express').static(require('path').join(__dirname, 'modules', 'integracoes', 'SEApiConfigurator', 'frontend')));
require('./modules/integracoes/SEApiConfigurator/routes')(app, { requireAuth, requireEmpresa, registrarLog });
startupProfilerMark('rotas IA Recruit fim');

// ── Exportação do Guia em PDF via Puppeteer ───────────────────────────────────
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

app.get('/guia/exportar-pdf', async (req, res) => {
  if (!puppeteer) return res.status(503).send('puppeteer-core não está instalado.');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-first-run', '--disable-extensions'],
    });
    const page = await browser.newPage();

    // Bloqueia websockets/socket.io para não impedir networkidle0
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (r.resourceType() === 'websocket' || r.url().includes('socket.io')) r.abort();
      else r.continue();
    });

    await page.goto(`http://127.0.0.1:${process.env.PORT || 3000}/guia/`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    const title = await page.title();
    console.log(`[Guia PDF] Página carregada: "${title}"`);

    // Aguarda carregarScreenshots() resolver todos os placeholders
    await page.waitForFunction(
      () => document.querySelectorAll('.screenshot-placeholder:not(.ph-loaded):not(.ph-empty)').length === 0,
      { timeout: 10000 }
    ).catch(() => {});

    const pdfRaw = await page.pdf({
      format: 'A4',
      margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
      printBackground: true,
    });
    const pdf = Buffer.from(pdfRaw);

    console.log(`[Guia PDF] Gerado: ${pdf.length} bytes | Header: ${pdf.slice(0,5).toString()}`);

    if (!pdf.slice(0, 4).toString().startsWith('%PDF')) {
      throw new Error('PDF gerado inválido — header incorreto');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="guia-iahub.pdf"');
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  } catch (err) {
    console.error('[Guia PDF] ERRO:', err.message);
    res.status(500).send(`Erro ao gerar o PDF: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
});

// ── Exportacao do Guia IA Command em PDF ─────────────────────────────────────
app.get('/app/ia-command/guia/exportar-pdf', requireIaCommand, async (req, res) => {
  if (!puppeteer) return res.status(503).send('puppeteer-core nao esta instalado.');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-first-run', '--disable-extensions'],
    });
    const page = await browser.newPage();
    if (req.headers.cookie) {
      await page.setExtraHTTPHeaders({ cookie: req.headers.cookie });
    }

    await page.setRequestInterception(true);
    page.on('request', r => {
      if (r.resourceType() === 'websocket' || r.url().includes('socket.io')) r.abort();
      else r.continue();
    });

    await page.goto(`http://127.0.0.1:${process.env.PORT || 3000}/app/ia-command/guia/index.html`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    const pdfRaw = await page.pdf({
      format: 'A4',
      margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
      printBackground: true,
    });
    const pdf = Buffer.from(pdfRaw);

    if (!pdf.slice(0, 4).toString().startsWith('%PDF')) {
      throw new Error('PDF gerado invalido - header incorreto');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="guia-ia-command.pdf"');
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  } catch (err) {
    console.error('[IA Command Guia PDF] ERRO:', err.message);
    res.status(500).send(`Erro ao gerar o PDF: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
});

// ── Inicia servidor ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
startupProfilerMark('server.listen inicio');
server.listen(PORT, () => {
  startupProfilerMark('server.listen callback');
  console.log(`\n🌐 IAHub rodando em http://localhost:${PORT}\n`);
  console.log(`   Log WA:    ${LOG_DIR}/whatscurriculo_<empresa_id>.log`);
  console.log(`   Log Email: ${EMAIL_LOG_FILE}\n`);
});
