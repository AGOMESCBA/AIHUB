require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const session    = require('express-session');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const fs         = require('fs');

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
  secret:            process.env.SESSION_SECRET || 'iahub-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
  },
});
app.use(sessionMiddleware);

// Compartilha a sessão Express com Socket.IO para saber qual empresa cada socket pertence
io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

// ── Arquivos estáticos ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'configuracoes',       'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'empresas',            'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'usuarios',            'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'whatsapp-curriculo',  'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'processo-seletivo',   'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'analisador-curriculos','frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'seguranca',             'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'integracoes', 'SECurriculo', 'frontend')));

// ── Log em arquivo ────────────────────────────────────────────────────────────
const LOG_DIR        = __dirname;
const EMAIL_LOG_FILE = path.join(__dirname, 'emailcurriculo.log');

function registrarLog(entry, empresaId) {
  const arquivo = empresaId
    ? path.join(LOG_DIR, `whatscurriculo_${empresaId}.log`)
    : path.join(LOG_DIR, 'whatscurriculo.log');
  const linha = `[${entry.timestamp}] [${(entry.type || 'info').toUpperCase().padEnd(8)}] ${entry.message}\n`;
  try { fs.appendFileSync(arquivo, linha, 'utf8'); } catch (_) {}
}

// ── Auth: middleware e inicialização ─────────────────────────────────────────
const { requireAuth }      = require('./modules/auth');
const { inicializarAdmin } = require('./modules/auth/database');
const { requireEmpresa }   = require('./modules/empresa-context');

inicializarAdmin().catch(err => console.error('[auth] Falha ao inicializar admin:', err));

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
require('./modules/configuracoes/routes')(app, { requireAuth });

// ── Módulo Empresa Context (deve vir ANTES de /empresas para não ser sobreposto por /:id) ──
require('./modules/empresa-context/routes')(app, { requireAuth });

// ── Módulo Empresas ───────────────────────────────────────────────────────────
require('./modules/empresas/routes')(app, { requireAuth });

// ── Módulo Usuários ───────────────────────────────────────────────────────────
require('./modules/usuarios/routes')(app, { requireAuth });

// ── Módulo Segurança ──────────────────────────────────────────────────────────
require('./modules/seguranca/routes')(app, { requireAuth });

// ── Módulo Monitoramento (WhatsApp Currículo) ─────────────────────────────────
require('./modules/whatsapp-curriculo/routes')(app, { requireAuth, requireEmpresa, registrarLog, io });

// ── Módulo Processo Seletivo ──────────────────────────────────────────────────
require('./modules/processo-seletivo/routes')(app, { requireAuth, requireEmpresa, registrarLog, io });

// ── Módulo Analisador de Currículos ───────────────────────────────────────────
require('./modules/analisador-curriculos/routes')(app, { requireAuth, requireEmpresa, registrarLog, io });

// ── Módulo Integrações › SE Currículo ─────────────────────────────────────────
require('./modules/integracoes/SECurriculo/routes')(app, { requireAuth, requireEmpresa, registrarLog });

// ── Inicia servidor ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌐 IAHub rodando em http://localhost:${PORT}\n`);
  console.log(`   Log WA:    ${LOG_DIR}/whatscurriculo_<empresa_id>.log`);
  console.log(`   Log Email: ${EMAIL_LOG_FILE}\n`);
});
