require('dotenv').config();
const express          = require('express');
const http             = require('http');
const { Server }       = require('socket.io');
const session          = require('express-session');
const helmet           = require('helmet');
const rateLimit        = require('express-rate-limit');
const path             = require('path');
const fs               = require('fs');
const FileSessionStore = require('./modules/auth/session-store');
const { requireAuth, requireAdmin } = require('./modules/auth');
const { inicializarAdmin }          = require('./modules/auth/database');
const { requireEmpresa }            = require('./modules/empresa-context');
const { inicializarConfig }         = require('./modules/configuracoes/database');
const { inicializarSistemas }       = require('./modules/sistemas/database');
const { requireSystemAccess }       = require('./modules/sistemas/access');

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
  store:             new FileSessionStore({ clearOnStart: true }),
  secret:            process.env.SESSION_SECRET || 'iahub-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
  },
});
app.use(sessionMiddleware);

// Compartilha a sessão Express com Socket.IO para saber qual empresa cada socket pertence
io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

inicializarAdmin().catch(err => console.error('[auth] Falha ao inicializar admin:', err));
inicializarConfig();
inicializarSistemas();

const requireRecrutamento = requireSystemAccess('recrutamento');
const requireIaAdmin = requireSystemAccess('ia-admin');

const RECRUTAMENTO_PAGES = new Set([
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

app.get('/app/ia-recruit', requireRecrutamento, (req, res) => {
  res.redirect('/app/ia-recruit/shell.html');
});

app.get('/app/recrutamento', requireRecrutamento, (req, res) => {
  res.redirect('/app/ia-recruit/shell.html');
});

app.get('/app/ia-administracao', requireIaAdmin, (req, res) => {
  res.redirect('/app/ia-administracao/administracao.html');
});

app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'frontend')));
app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'whatsapp-curriculo', 'frontend')));
app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'processo-seletivo', 'frontend')));
app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'analisador-curriculos', 'frontend')));
app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SECurriculo', 'frontend')));
app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SEFuncao', 'frontend')));
app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SEVaga', 'frontend')));
app.use('/app/ia-recruit', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SEApiConfigurator', 'frontend')));

app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'frontend')));
app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'whatsapp-curriculo', 'frontend')));
app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'processo-seletivo', 'frontend')));
app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'analisador-curriculos', 'frontend')));
app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SECurriculo', 'frontend')));
app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SEFuncao', 'frontend')));
app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SEVaga', 'frontend')));
app.use('/app/recrutamento', requireRecrutamento, express.static(path.join(__dirname, 'modules', 'integracoes', 'SEApiConfigurator', 'frontend')));

app.use('/app/ia-administracao', requireIaAdmin, express.static(path.join(__dirname, 'frontend')));
app.use('/app/ia-administracao', requireIaAdmin, express.static(path.join(__dirname, 'modules', 'configuracoes', 'frontend')));
app.use('/app/ia-administracao', requireIaAdmin, express.static(path.join(__dirname, 'modules', 'empresas', 'frontend')));
app.use('/app/ia-administracao', requireIaAdmin, express.static(path.join(__dirname, 'modules', 'usuarios', 'frontend')));
app.use('/app/ia-administracao', requireIaAdmin, express.static(path.join(__dirname, 'modules', 'seguranca', 'frontend')));

// ── Arquivos estáticos ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));
app.use(express.static(path.join(__dirname, 'modules', 'configuracoes',       'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'empresas',            'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'usuarios',            'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'whatsapp-curriculo',  'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'processo-seletivo',   'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'analisador-curriculos','frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'seguranca',             'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'integracoes', 'SECurriculo', 'frontend')));

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
const waManager = require('./modules/whatsapp-curriculo/service-manager');
const emailSvcMgr = require('./modules/processo-seletivo/email-service-manager');
// Email log file is set per-instance when service starts

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
    });
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

// ── Inicia servidor ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌐 IAHub rodando em http://localhost:${PORT}\n`);
  console.log(`   Log WA:    ${LOG_DIR}/whatscurriculo_<empresa_id>.log`);
  console.log(`   Log Email: ${EMAIL_LOG_FILE}\n`);
});
