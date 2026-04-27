require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const session   = require('express-session');
const path      = require('path');
const fs        = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'iahub-secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 8 * 60 * 60 * 1000 },
}));

// ── Arquivos estáticos ────────────────────────────────────────────────────────
// frontend/ → login, CSS, JS global
// modules/*/frontend/ → páginas de cada módulo
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'configuracoes', 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'whatsapp-curriculo', 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'processo-seletivo', 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'analisador-curriculos', 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'integracoes', 'SECurriculo', 'frontend')));

// ── Log em arquivo e buffer para restaurar ao reconectar ─────────────────────
const LOG_FILE       = path.join(__dirname, 'whatscurriculo.log');
const EMAIL_LOG_FILE = path.join(__dirname, 'emailcurriculo.log');
const logBuffer  = [];
const MAX_BUFFER = 500;

function registrarLog(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
  const linha = `[${entry.timestamp}] [${(entry.type || 'info').toUpperCase().padEnd(8)}] ${entry.message}\n`;
  try { fs.appendFileSync(LOG_FILE, linha, 'utf8'); } catch (_) {}
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Não autenticado' });
}

// ── Socket.IO — replay do buffer ao reconectar ────────────────────────────────
const whatsapp  = require('./modules/whatsapp-curriculo/service');
const emailImap = require('./modules/processo-seletivo/email-imap');
emailImap.setLogFile(EMAIL_LOG_FILE);

io.on('connection', (socket) => {
  // Replay WhatsApp
  logBuffer.forEach(entry => socket.emit('log', entry));
  socket.emit('status', whatsapp.getStatus());
  const qr = whatsapp.getQr();
  if (qr) socket.emit('qr', qr);

  // Replay Email
  emailImap.getLogBuffer().forEach(entry => socket.emit('email-log', entry));
  socket.emit('email-status', emailImap.getStatus());
});

// ── Módulo Configurações (auth + tela de configurações) ───────────────────────
require('./modules/configuracoes/routes')(app, { requireAuth });

// ── Módulo Monitoramento (WhatsApp Currículo) ─────────────────────────────────
require('./modules/whatsapp-curriculo/routes')(app, { requireAuth, registrarLog, io });

// ── Módulo Processo Seletivo ──────────────────────────────────────────────────
require('./modules/processo-seletivo/routes')(app, { requireAuth, registrarLog, io });

// ── Módulo Analisador de Currículos ───────────────────────────────────────────
require('./modules/analisador-curriculos/routes')(app, { requireAuth, registrarLog, io });

// ── Módulo Integrações › SE Currículo ─────────────────────────────────────────
require('./modules/integracoes/SECurriculo/routes')(app, { requireAuth, registrarLog });

// ── Inicia servidor ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌐 IAHub rodando em http://localhost:${PORT}\n`);
  console.log(`   Usuário: ${process.env.ADMIN_USER}`);
  console.log(`   Senha:   ${process.env.ADMIN_PASS}\n`);
  console.log(`   Log WA:  ${LOG_FILE}`);
  console.log(`   Log Email: ${EMAIL_LOG_FILE}\n`);
});
