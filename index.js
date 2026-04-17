require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const session   = require('express-session');
const path      = require('path');
const fs        = require('fs');
const db        = require('./database');
const whatsapp  = require('./whatsapp');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'iahub-secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 8 * 60 * 60 * 1000 }, // 8h
}));

app.use(express.static(path.join(__dirname, 'public')));

// ── Log em arquivo e buffer para restaurar ao reconectar ─────────────────────

const LOG_FILE   = path.join(__dirname, 'whatscurriculo.log');
const logBuffer  = []; // mantém os últimos 500 logs em memória
const MAX_BUFFER = 500;

function registrarLog(entry) {
  // Buffer em memória
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) logBuffer.shift();

  // Grava no arquivo automaticamente
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

// ── Socket.IO ─────────────────────────────────────────────────────────────────

// Quando o browser (re)conecta: envia o buffer de logs e o status atual
io.on('connection', (socket) => {
  logBuffer.forEach(entry => socket.emit('log', entry));
  socket.emit('status', whatsapp.getStatus());
});

// Repassa eventos do WhatsApp para o browser e grava no arquivo
whatsapp.on('log', (entry) => {
  registrarLog(entry);
  io.emit('log', entry);
});

whatsapp.on('status', (status) => io.emit('status', status));
whatsapp.on('qr',     (url)    => io.emit('qr', url));

whatsapp.on('curriculo', ({ remetente, dados, pdf_base64, pdf_nome }) => {
  const id = db.saveCurriculo({
    remetente,
    ...dados,
    dados_completos: JSON.stringify(dados),
    pdf_base64,
    pdf_nome,
  });
  const entry = {
    message:   `Currículo gravado. ID #${id} — ${dados.nome || remetente}`,
    type:      'saved',
    timestamp: new Date().toLocaleTimeString('pt-BR'),
  };
  registrarLog(entry);
  io.emit('log', entry);
});

// ── API (protegida) ───────────────────────────────────────────────────────────

app.post('/api/service/start',  requireAuth, (_req, res) => { whatsapp.start(); res.json({ ok: true }); });
app.post('/api/service/stop',   requireAuth, (_req, res) => { whatsapp.stop();  res.json({ ok: true }); });
app.get ('/api/service/status', requireAuth, (_req, res) => res.json({ status: whatsapp.getStatus() }));

app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    numero_destino: db.getConfig('numero_destino') || '',
    label:          db.getConfig('label')          || '',
  });
});

app.post('/api/config', requireAuth, (req, res) => {
  const { numero_destino, label } = req.body;
  if (numero_destino !== undefined) db.setConfig('numero_destino', numero_destino);
  if (label          !== undefined) db.setConfig('label', label);
  res.json({ ok: true });
});

app.get   ('/api/curriculos',     requireAuth, (_req, res) => res.json(db.listCurriculos()));
app.get   ('/api/curriculos/:id', requireAuth, (req, res) => {
  const row = db.getCurriculo(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  res.json(row);
});
app.delete('/api/curriculos/:id', requireAuth, (req, res) => {
  const ok = db.deleteCurriculo(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ ok: true });
});

app.get('/api/stats', requireAuth, (_req, res) => {
  const curriculos = db.listCurriculos();
  res.json({
    total:  curriculos.length,
    hoje:   curriculos.filter(c => c.recebido_em?.startsWith(new Date().toISOString().slice(0, 10))).length,
    status: whatsapp.getStatus(),
  });
});

// ── Inicia servidor ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌐 IAHub rodando em http://localhost:${PORT}\n`);
  console.log(`   Usuário: ${process.env.ADMIN_USER}`);
  console.log(`   Senha:   ${process.env.ADMIN_PASS}\n`);
  console.log(`   Log:     ${LOG_FILE}\n`);
});
