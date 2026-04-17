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
// modules/whatsapp-curriculo/frontend/ → páginas do módulo
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'whatsapp-curriculo', 'frontend')));
app.use(express.static(path.join(__dirname, 'modules', 'analisador-curriculos', 'frontend')));

// ── Log em arquivo e buffer para restaurar ao reconectar ─────────────────────
const LOG_FILE   = path.join(__dirname, 'whatscurriculo.log');
const logBuffer  = [];
const MAX_BUFFER = 500;

function registrarLog(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
  const linha = `[${entry.timestamp}] [${(entry.type || 'info').toUpperCase().padEnd(8)}] ${entry.message}\n`;
  try { fs.appendFileSync(LOG_FILE, linha, 'utf8'); } catch (_) {}
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Não autenticado' });
}

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    req.session.authenticated = true;
    req.session.user = user;
    return res.json({ ok: true, user });
  }
  res.status(401).json({ error: 'Usuário ou senha inválidos' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// ── Socket.IO — replay do buffer ao reconectar ────────────────────────────────
const whatsapp = require('./modules/whatsapp-curriculo/service');

io.on('connection', (socket) => {
  logBuffer.forEach(entry => socket.emit('log', entry));
  socket.emit('status', whatsapp.getStatus());
});

// ── Módulo WhatsApp Currículo ─────────────────────────────────────────────────
require('./modules/whatsapp-curriculo/routes')(app, { requireAuth, registrarLog, io });

// ── Módulo Analisador de Currículos ───────────────────────────────────────────
require('./modules/analisador-curriculos/routes')(app, { requireAuth });

// ── Inicia servidor ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌐 IAHub rodando em http://localhost:${PORT}\n`);
  console.log(`   Usuário: ${process.env.ADMIN_USER}`);
  console.log(`   Senha:   ${process.env.ADMIN_PASS}\n`);
  console.log(`   Log:     ${LOG_FILE}\n`);
});
